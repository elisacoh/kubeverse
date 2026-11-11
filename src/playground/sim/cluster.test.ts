import { describe, expect, it } from 'vitest';
import { applyObject, deleteObject, findObject, initialState, isPodReady, objectsOf, reconcile, serviceEndpoints, settle, tick } from './cluster';
import { readManifests } from './manifest';
import type { SimState } from './types';

const apply = (s: SimState, yaml: string) => {
  const { objects, issues } = readManifests(yaml);
  expect(issues).toEqual([]);
  let state = s;
  for (const { desired } of objects) {
    const r = applyObject(state, desired);
    if (!r.ok) throw new Error(r.error);
    state = r.state;
  }
  return state;
};

const POD = `apiVersion: v1
kind: Pod
metadata:
  name: hello-pod
spec:
  containers:
    - name: nginx
      image: nginx:stable
`;

const RS = `apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: web-rs
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: nginx
          image: nginx:stable
`;

const deployment = (replicas: number, image = 'nginx:stable') => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: ${replicas}
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: nginx
          image: ${image}
          ports:
            - containerPort: 80
`;

describe('Pod lifecycle', () => {
  it('goes Pending → Scheduled → ContainerCreating → Running and Ready, one step per pass', () => {
    let s = apply(initialState(), POD);
    const stage = () => findObject(s, 'Pod', 'hello-pod')!.status.stage;
    expect(stage()).toBe('Pending');
    s = tick(s);
    expect(stage()).toBe('Scheduled');
    expect(findObject(s, 'Pod', 'hello-pod')!.status.nodeName).toMatch(/^worker-/);
    s = tick(s);
    expect(stage()).toBe('ContainerCreating');
    s = tick(s);
    expect(stage()).toBe('Running');
    s = settle(s);
    expect(isPodReady(findObject(s, 'Pod', 'hello-pod')!)).toBe(true);
  });

  it('applying the same manifest twice is unchanged; changing labels configures', () => {
    const s = settle(apply(initialState(), POD));
    const { objects } = readManifests(POD);
    const again = applyObject(s, objects[0]!.desired);
    expect(again.ok && again.action).toBe('unchanged');
    const labelled = readManifests(POD.replace('  name: hello-pod', '  name: hello-pod\n  labels:\n    app: hello')).objects[0]!.desired;
    const r = applyObject(s, labelled);
    expect(r.ok && r.action).toBe('configured');
    expect(findObject(r.state, 'Pod', 'hello-pod')!.metadata.labels).toEqual({ app: 'hello' });
  });

  it('refuses to change an immutable Pod field', () => {
    const s = settle(apply(initialState(), POD));
    const changed = readManifests(POD.replace('image: nginx:stable', 'image: nginx:stable\n      ports:\n        - containerPort: 80')).objects[0]!.desired;
    const r = applyObject(s, changed);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/Forbidden: pod updates may not change fields/);
      expect(r.hint).toMatch(/`spec\.containers\[0\]\.ports`/);
    }
  });

  it('a deleted Pod terminates, then disappears, and nothing recreates it', () => {
    let s = settle(apply(initialState(), POD));
    const r = deleteObject(s, 'Pod', 'hello-pod');
    expect(r.ok).toBe(true);
    s = r.state;
    expect(findObject(s, 'Pod', 'hello-pod')!.metadata.deletionTime).toBeDefined();
    s = settle(s);
    expect(findObject(s, 'Pod', 'hello-pod')).toBeUndefined();
  });
});

describe('ReplicaSet controller', () => {
  it('creates and maintains the desired number of Pods', () => {
    let s = settle(apply(initialState(), RS));
    const pods = () => objectsOf(s, 'Pod').filter((p) => p.metadata.deletionTime === undefined);
    expect(pods()).toHaveLength(3);
    expect(pods().every((p) => p.metadata.ownerReferences[0]?.name === 'web-rs')).toBe(true);
    expect(pods().every(isPodReady)).toBe(true);
    expect(findObject(s, 'ReplicaSet', 'web-rs')!.status.readyReplicas).toBe(3);

    const victim = pods()[0]!.metadata.name;
    s = deleteObject(s, 'Pod', victim).state;
    s = settle(s);
    expect(pods()).toHaveLength(3);
    expect(pods().some((p) => p.metadata.name === victim)).toBe(false);
  });

  it('adopts an orphan Pod whose labels match its selector', () => {
    let s = settle(apply(initialState(), POD.replace('  name: hello-pod', '  name: hello-pod\n  labels:\n    app: web')));
    s = settle(apply(s, RS));
    const owned = objectsOf(s, 'Pod').filter((p) => p.metadata.ownerReferences.some((r) => r.name === 'web-rs'));
    expect(owned).toHaveLength(3);
    expect(owned.some((p) => p.metadata.name === 'hello-pod')).toBe(true);
  });

  it('deleting the ReplicaSet garbage-collects its Pods', () => {
    let s = settle(apply(initialState(), RS));
    s = settle(deleteObject(s, 'ReplicaSet', 'web-rs').state);
    expect(objectsOf(s, 'Pod')).toHaveLength(0);
  });
});

describe('Deployment controller', () => {
  it('manages a ReplicaSet, which manages the Pods', () => {
    const s = settle(apply(initialState(), deployment(3)));
    const rs = objectsOf(s, 'ReplicaSet');
    expect(rs).toHaveLength(1);
    expect(rs[0]!.metadata.ownerReferences[0]).toMatchObject({ kind: 'Deployment', name: 'web' });
    expect(rs[0]!.metadata.name).toMatch(/^web-[a-z0-9]{10}$/);
    const pods = objectsOf(s, 'Pod');
    expect(pods).toHaveLength(3);
    expect(pods.every((p) => p.metadata.ownerReferences[0]?.uid === rs[0]!.metadata.uid)).toBe(true);
    expect(findObject(s, 'Deployment', 'web')!.status).toMatchObject({ readyReplicas: 3, updatedReplicas: 3 });
  });

  it('scaling changes replicas without a new ReplicaSet', () => {
    let s = settle(apply(initialState(), deployment(2)));
    s = settle(apply(s, deployment(5)));
    expect(objectsOf(s, 'ReplicaSet')).toHaveLength(1);
    expect(objectsOf(s, 'Pod').filter(isPodReady)).toHaveLength(5);
  });

  it('a template change rolls out to a new ReplicaSet', () => {
    let s = settle(apply(initialState(), deployment(3)));
    s = settle(apply(s, deployment(3, 'nginx:1.27')));
    const rss = objectsOf(s, 'ReplicaSet');
    expect(rss).toHaveLength(2);
    const pods = objectsOf(s, 'Pod');
    expect(pods).toHaveLength(3);
    expect(pods.every((p) => p.spec.containers[0]!.image === 'nginx:1.27')).toBe(true);
  });

  it('is deterministic', () => {
    const run = () => settle(apply(initialState(), deployment(3)));
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('reconcile returns the same state once settled', () => {
    const s = settle(apply(initialState(), deployment(2)));
    expect(reconcile(s)).toBe(s);
  });
});

describe('Services, ConfigMaps, storage, probes, resources', () => {
  it('a Service selects ready Pods as endpoints', () => {
    let s = settle(apply(initialState(), deployment(2)));
    s = apply(s, `apiVersion: v1
kind: Service
metadata:
  name: web-svc
spec:
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 80
`);
    const svc = findObject(s, 'Service', 'web-svc')!;
    expect(svc.spec.clusterIP).toMatch(/^10\.96\./);
    expect(serviceEndpoints(s, svc).filter((e) => e.ready)).toHaveLength(2);
  });

  it('a Pod waits for its ConfigMap, then starts', () => {
    const pod = `apiVersion: v1
kind: Pod
metadata:
  name: configured
spec:
  containers:
    - name: app
      image: busybox:1.36
      env:
        - name: GREETING
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: GREETING
`;
    let s = settle(apply(initialState(), pod));
    const status = () => findObject(s, 'Pod', 'configured')!.status;
    expect(status().containerStatuses[0]!.reason).toBe('CreateContainerConfigError');
    s = settle(apply(s, `apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  GREETING: hello
`));
    expect(status().stage).toBe('Running');
  });

  it('a Pod mounting a claim schedules once the claim is bound', () => {
    let s = apply(initialState(), `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 1Gi
---
apiVersion: v1
kind: Pod
metadata:
  name: writer
spec:
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: data
  containers:
    - name: app
      image: nginx:stable
      volumeMounts:
        - name: data
          mountPath: /data
`);
    s = settle(s);
    expect(findObject(s, 'PersistentVolumeClaim', 'data')!.status.phase).toBe('Bound');
    expect(isPodReady(findObject(s, 'Pod', 'writer')!)).toBe(true);
  });

  it('a readiness probe on a closed port keeps the Pod not Ready', () => {
    const s = settle(apply(initialState(), POD.replace('image: nginx:stable', 'image: nginx:stable\n      readinessProbe:\n        httpGet:\n          path: /\n          port: 8080')));
    const pod = findObject(s, 'Pod', 'hello-pod')!;
    expect(pod.status.stage).toBe('Running');
    expect(isPodReady(pod)).toBe(false);
  });

  it('requests larger than any Node leave the Pod Pending, with the reason', () => {
    const s = settle(apply(initialState(), POD.replace('image: nginx:stable', 'image: nginx:stable\n      resources:\n        requests:\n          cpu: "8"')));
    const pod = findObject(s, 'Pod', 'hello-pod')!;
    expect(pod.status.stage).toBe('Pending');
    expect(pod.status.message).toMatch(/Insufficient cpu/);
  });

  it('computes QoS classes', () => {
    const qos = (resources: string) =>
      findObject(apply(initialState(), POD.replace('image: nginx:stable', `image: nginx:stable\n      resources:\n${resources}`)), 'Pod', 'hello-pod')!.status.qosClass;
    expect(qos('        requests:\n          cpu: 100m')).toBe('Burstable');
    expect(qos('        limits:\n          cpu: 100m\n          memory: 64Mi')).toBe('Guaranteed');
    expect(findObject(apply(initialState(), POD), 'Pod', 'hello-pod')!.status.qosClass).toBe('BestEffort');
  });
});
