import {
  anyImage,
  applied,
  changedBy,
  check,
  described,
  equals,
  listed,
  podRunning,
  present,
  selectorMatchesTemplate,
  serviceHasEndpoints,
  valueAt,
  valuesAt,
  workloadReady,
} from '../checks';
import { findObject, objectsOf } from '../../sim/cluster';
import type { CommandRecord, GuidedStep, Lesson, ManifestCheck } from '../types';
import type { SimState } from '../../sim/types';

const deploymentYaml = (name: string, replicas: number | string, app: string, containerExtra = '') => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
spec:
  replicas: ${replicas}
  selector:
    matchLabels:
      app: ${app}
  template:
    metadata:
      labels:
        app: ${app}
    spec:
      containers:
        - name: nginx
          image: nginx:stable
          ports:
            - containerPort: 80
${containerExtra}`;

const deploymentChecks = (name: string, replicas: number): ManifestCheck[] => [
  equals('apiVersion', 'apps/v1', '`apiVersion` is apps/v1'),
  equals('kind', 'Deployment', '`kind` is Deployment'),
  equals('metadata.name', name, `named ${name}`),
  equals('spec.replicas', replicas, `\`spec.replicas\` is ${replicas}`),
  selectorMatchesTemplate('spec.selector.matchLabels', 'spec.template.metadata.labels'),
  anyImage('spec.template.spec.containers[*].image', 'nginx'),
];

const ran = (pred: (r: CommandRecord) => boolean) => (log: readonly CommandRecord[]) => log.some((r) => r.result.ok && pred(r));
const verb = (v: string, kind?: string, name?: (n: string) => boolean) => ran((r) => r.result.effects.some((e) => e.verb === v && (!kind || e.kind === kind) && (!name || (!!e.name && name(e.name)))));

const deploymentSetup = (name: string, app: string, replicas: number, file = 'deployment.yaml') => ({
  description: `the ${name} Deployment (${replicas} replicas)`,
  needed: (s: SimState) => !findObject(s, 'Deployment', name),
  files: { [file]: deploymentYaml(name, replicas, app) },
  commands: [`kubectl apply -f ${file}`],
});

// ---------------------------------------------------------------------------
// L04 · Deployment
// ---------------------------------------------------------------------------

const deploymentGuided: GuidedStep[] = [
  {
    title: 'Kind and name',
    explain: ['Deployments live in the `apps` group, like ReplicaSets.'],
    instruction: 'Write `apiVersion: apps/v1`, `kind: Deployment` and name it `frontend`.',
    fields: ['apiVersion', 'kind', 'metadata.name'],
    checks: [equals('apiVersion', 'apps/v1', '`apiVersion` is apps/v1'), equals('kind', 'Deployment', '`kind` is Deployment'), equals('metadata.name', 'frontend', 'named frontend')],
    snippet: 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: frontend',
  },
  {
    title: 'Replicas and selector',
    explain: ['The spec looks just like a ReplicaSet\'s: `replicas` and a `selector`. The Deployment passes them on to the ReplicaSets it creates.'],
    instruction: 'Add `replicas: 3` and `selector.matchLabels` with `app: frontend`.',
    fields: ['spec.replicas', 'spec.selector'],
    checks: [equals('spec.replicas', 3, '`spec.replicas` is 3'), equals('spec.selector.matchLabels.app', 'frontend', 'the selector matches `app: frontend`')],
    snippet: 'spec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: frontend',
  },
  {
    title: 'The Pod template',
    explain: ['The template is the version of your app. Changing it is what triggers a rollout.'],
    instruction: 'Add a `template` labelled `app: frontend` with an nginx container.',
    fields: ['spec.template', 'spec.template.spec.containers'],
    checks: [selectorMatchesTemplate('spec.selector.matchLabels', 'spec.template.metadata.labels'), anyImage('spec.template.spec.containers[*].image', 'nginx')],
    snippet: '  template:\n    metadata:\n      labels:\n        app: frontend\n    spec:\n      containers:\n        - name: nginx\n          image: nginx:stable',
  },
];

const frontendRollout = (s: SimState) => {
  const dep = findObject(s, 'Deployment', 'frontend');
  if (!dep) return 'No Deployment named frontend yet.';
  const image = dep.spec.template.spec.containers[0]?.image ?? '';
  if (image === 'nginx:stable') return 'Change the image in deployment.yaml (for example to `nginx:1.27`) and apply it again.';
  const owned = objectsOf(s, 'ReplicaSet').filter((rs) => rs.metadata.ownerReferences.some((o) => o.uid === dep.metadata.uid));
  if (owned.length < 2) return 'Waiting for the Deployment to create a new ReplicaSet…';
  return dep.status.updatedReplicas >= dep.spec.replicas && dep.status.readyReplicas >= dep.spec.replicas && dep.status.replicas === dep.spec.replicas ? null : 'Rolling out: new Pods start, old ones are removed…';
};

export const deployment: Lesson = {
  id: 'deployment',
  number: 4,
  title: 'Deployments',
  tagline: 'Versioned rollouts on top of ReplicaSets.',
  summary: 'Run 3 replicas through a Deployment, see the ReplicaSet it creates, then roll out a new image version.',
  level: 'Beginner',
  minutes: 15,
  concepts: ['Deployment', 'rollout', 'pod-template-hash', 'ownership chain'],
  prerequisites: ['replicaset'],
  depth: 'interactive',
  simulationNotes: ['Rollouts follow the RollingUpdate strategy (maxSurge/maxUnavailable) one reconcile pass at a time; rollout history and `kubectl rollout` are not simulated.'],
  steps: [
    {
      id: 'what',
      kind: 'read',
      phase: 'understand',
      title: 'Deployment → ReplicaSet → Pods',
      cards: [
        {
          title: 'A manager of ReplicaSets',
          body: [
            'A Deployment owns one ReplicaSet per version of its Pod template. The ReplicaSet owns the Pods. You only edit the Deployment.',
            'When you change the template, the Deployment creates a new ReplicaSet and gradually shifts replicas from the old one to the new one: a rolling update.',
          ],
          more: 'The ReplicaSet name ends with a hash of the Pod template (the pod-template-hash label). Same template, same hash: scaling never creates a new ReplicaSet, only a template change does.',
        },
      ],
    },
    {
      id: 'write',
      kind: 'write',
      phase: 'write',
      title: 'Write deployment.yaml',
      exercise: {
        file: 'deployment.yaml',
        kind: 'Deployment',
        objective: 'A Deployment named frontend running 3 nginx replicas labelled app: frontend.',
        checks: deploymentChecks('frontend', 3),
        modes: { guided: deploymentGuided, complete: deploymentYaml('frontend', '___', '___').replace('image: nginx:stable', 'image: ___'), scratch: '' },
        hints: [
          'A Deployment\'s spec has the same three parts as a ReplicaSet\'s.',
          'You need `replicas: 3`, a `selector.matchLabels`, and a `template` whose labels match it and whose spec has an nginx container.',
          deploymentYaml('frontend', 3, 'frontend'),
        ],
        solution: deploymentYaml('frontend', 3, 'frontend'),
        solutionNotes: [
          { field: 'kind', note: 'Deployment: the object you normally write for stateless apps.' },
          { field: 'spec.template', note: 'Each distinct template becomes its own ReplicaSet.' },
        ],
      },
    },
    { id: 'apply', kind: 'command', phase: 'deploy', title: 'Deploy it', body: ['Apply the Deployment.'], command: 'kubectl apply -f deployment.yaml', check: applied('Deployment', 'frontend'), hint: 'Run `kubectl apply -f deployment.yaml`.' },
    { id: 'ready', kind: 'cluster', phase: 'observe', title: 'Three replicas', body: ['The Deployment creates a ReplicaSet, which creates the Pods.'], check: workloadReady('Deployment', 'frontend', 3), hint: 'Check the apply output for errors.' },
    {
      id: 'chain',
      kind: 'command',
      phase: 'observe',
      title: 'See the whole chain',
      body: ['`kubectl get all` lists Pods, Services, Deployments and ReplicaSets together.'],
      command: 'kubectl get all',
      check: listed('ReplicaSet'),
      hint: 'Run `kubectl get all`, or `kubectl get rs`.',
      explain: ['Notice the ReplicaSet named frontend-<hash>, and Pods named frontend-<hash>-<suffix>: the names spell out the ownership chain.'],
    },
    {
      id: 'rollout',
      kind: 'cluster',
      phase: 'verify',
      title: 'Roll out a new version',
      body: ['Edit deployment.yaml: change the image to `nginx:1.27`, then apply it. Watch a second ReplicaSet scale up while the first scales down.'],
      check: frontendRollout,
      hint: 'Edit the `image:` line, then run `kubectl apply -f deployment.yaml` and `kubectl get rs`.',
      explain: ['The old ReplicaSet is kept at 0 replicas: it is the rollback target if the new version misbehaves.'],
    },
  ],
};

// ---------------------------------------------------------------------------
// L05 · Scaling
// ---------------------------------------------------------------------------

export const scaling: Lesson = {
  id: 'scaling',
  number: 5,
  title: 'Scaling',
  tagline: 'From 2 to 5 replicas, declaratively.',
  summary: 'Change replicas in the manifest, apply it and watch the Deployment scale; compare with `kubectl scale`.',
  level: 'Beginner',
  minutes: 8,
  concepts: ['replicas', 'declarative vs imperative', 'kubectl scale'],
  prerequisites: ['deployment'],
  depth: 'interactive',
  setup: deploymentSetup('frontend', 'frontend', 2),
  steps: [
    {
      id: 'what',
      kind: 'read',
      phase: 'understand',
      title: 'Scaling is just a number',
      cards: [
        {
          title: 'Change replicas, apply',
          body: ['To scale, change `spec.replicas` and apply. The Deployment updates its ReplicaSet\'s replicas; the template is unchanged, so no new ReplicaSet appears.'],
          more: '`kubectl scale deployment frontend --replicas=5` does the same imperatively, but your file then disagrees with the cluster: the next `apply` of the old file scales back. Keeping the file as the source of truth is the declarative way.',
        },
      ],
    },
    {
      id: 'write',
      kind: 'write',
      phase: 'write',
      title: 'Scale to 5',
      exercise: {
        file: 'deployment.yaml',
        kind: 'Deployment',
        objective: 'The frontend Deployment asks for 5 replicas.',
        checks: deploymentChecks('frontend', 5),
        modes: {
          guided: [
            {
              title: 'Find the replicas field',
              explain: ['The manifest from the previous lesson is in the editor, with 2 replicas.'],
              instruction: 'Change `spec.replicas` to 5.',
              fields: ['spec.replicas'],
              checks: [equals('metadata.name', 'frontend', 'named frontend'), equals('spec.replicas', 5, '`spec.replicas` is 5')],
              snippet: 'spec:\n  replicas: 5',
            },
          ],
          guidedStarter: deploymentYaml('frontend', 2, 'frontend'),
          complete: deploymentYaml('frontend', '___', 'frontend'),
          scratch: '',
        },
        hints: ['Only one number needs to change.', 'It is `spec.replicas`.', 'spec:\n  replicas: 5'],
        solution: deploymentYaml('frontend', 5, 'frontend'),
        solutionNotes: [{ field: 'spec.replicas', note: 'The only change: the template, and so the ReplicaSet, stays the same.' }],
      },
    },
    { id: 'apply', kind: 'command', phase: 'deploy', title: 'Apply', body: ['Apply the updated file.'], command: 'kubectl apply -f deployment.yaml', check: changedBy('Deployment', 'frontend'), hint: 'Run `kubectl apply -f deployment.yaml`.' },
    { id: 'ready', kind: 'cluster', phase: 'observe', title: 'Five replicas', body: ['New Pods are scheduled across the workers.'], check: workloadReady('Deployment', 'frontend', 5), hint: 'Watch My Cluster or run `kubectl get deploy`.' },
    {
      id: 'imperative',
      kind: 'command',
      phase: 'verify',
      title: 'Try the imperative way',
      body: ['Scale back down with a command instead of the file.'],
      command: 'kubectl scale deployment frontend --replicas=2',
      check: verb('scale', 'Deployment'),
      hint: 'Run `kubectl scale deployment frontend --replicas=2`.',
      explain: ['It works instantly, but deployment.yaml still says 5. Applying it again would scale back up. Prefer editing the file.'],
    },
  ],
};

// ---------------------------------------------------------------------------
// L06 · ClusterIP Service
// ---------------------------------------------------------------------------

const SERVICE_SOLUTION = `apiVersion: v1
kind: Service
metadata:
  name: frontend
spec:
  type: ClusterIP
  selector:
    app: frontend
  ports:
    - port: 80
      targetPort: 80
`;

export const service: Lesson = {
  id: 'service',
  number: 6,
  title: 'ClusterIP Services',
  tagline: 'One stable address in front of changing Pods.',
  summary: 'Give the frontend Pods a stable virtual IP and DNS name, and see how the Service selects its endpoints.',
  level: 'Beginner',
  minutes: 10,
  concepts: ['Service', 'ClusterIP', 'endpoints', 'port / targetPort'],
  prerequisites: ['deployment'],
  depth: 'interactive',
  setup: deploymentSetup('frontend', 'frontend', 3),
  simulationNotes: ['No packets flow in the Playground: endpoints are computed from ready Pods matching the selector, and the ClusterIP is allocated, but nothing is actually served.'],
  steps: [
    {
      id: 'what',
      kind: 'read',
      phase: 'understand',
      title: 'Why Services',
      cards: [
        {
          title: 'Pods come and go',
          body: [
            'Every Pod gets its own IP, but Pods are replaced all the time. Clients need something stable.',
            'A Service has a fixed virtual IP (the ClusterIP) and a DNS name. It forwards to the ready Pods matching its `selector`: its endpoints.',
          ],
          code: 'spec:\n  selector:\n    app: frontend\n  ports:\n    - port: 80        # the Service port\n      targetPort: 80  # the container port',
          more: 'ClusterIP is reachable only inside the cluster. NodePort and LoadBalancer expose a Service outside; they build on ClusterIP.',
        },
      ],
    },
    {
      id: 'write',
      kind: 'write',
      phase: 'write',
      title: 'Write service.yaml',
      exercise: {
        file: 'service.yaml',
        kind: 'Service',
        objective: 'A ClusterIP Service named frontend selecting app: frontend on port 80.',
        checks: [
          equals('apiVersion', 'v1', '`apiVersion` is v1'),
          equals('kind', 'Service', '`kind` is Service'),
          equals('metadata.name', 'frontend', 'named frontend'),
          equals('spec.selector.app', 'frontend', 'selects `app: frontend`', 'Add `spec.selector` with `app: frontend` (no matchLabels for Services).'),
          check('port', 'it exposes port 80', (d) => (valuesAt(d, 'spec.ports[*].port').includes(80) ? null : 'Add `spec.ports` with an item `port: 80`.')),
          check('type', 'type is ClusterIP (or left to the default)', (d) => {
            const t = valueAt(d, 'spec.type');
            return t === undefined || t === 'ClusterIP' ? null : `This lesson is about ClusterIP; \`spec.type\` is "${String(t)}".`;
          }),
        ],
        modes: {
          guided: [
            {
              title: 'Kind and name',
              explain: ['Services are core API objects: `apiVersion: v1`. The name becomes the DNS name, so it must start with a letter.'],
              instruction: 'Write `apiVersion: v1`, `kind: Service`, name `frontend`.',
              fields: ['apiVersion', 'kind', 'metadata.name'],
              checks: [equals('kind', 'Service', '`kind` is Service'), equals('metadata.name', 'frontend', 'named frontend')],
              snippet: 'apiVersion: v1\nkind: Service\nmetadata:\n  name: frontend',
            },
            {
              title: 'Select the Pods',
              explain: ['A Service selector is a plain label mapping, without `matchLabels`.'],
              instruction: 'Add `spec.selector` with `app: frontend`.',
              fields: ['spec.selector'],
              checks: [equals('spec.selector.app', 'frontend', 'selects `app: frontend`')],
              snippet: 'spec:\n  selector:\n    app: frontend',
            },
            {
              title: 'Ports',
              explain: ['`port` is what clients connect to; `targetPort` is where the container listens. It defaults to the same number.'],
              instruction: 'Add `ports` with `port: 80` and `targetPort: 80`.',
              fields: ['spec.ports', 'spec.ports.port', 'spec.ports.targetPort'],
              checks: [check('port', 'it exposes port 80', (d) => (valuesAt(d, 'spec.ports[*].port').includes(80) ? null : 'Add `spec.ports` with an item `port: 80`.'))],
              snippet: '  ports:\n    - port: 80\n      targetPort: 80',
            },
          ],
          complete: SERVICE_SOLUTION.replace('app: frontend', 'app: ___').replace('    - port: 80', '    - port: ___'),
          scratch: '',
        },
        hints: ['A Service needs to know which Pods to send to and on which port.', '`spec.selector` (labels of the Pods) and `spec.ports` (a list with `port`).', SERVICE_SOLUTION],
        solution: SERVICE_SOLUTION,
        solutionNotes: [
          { field: 'spec.selector', note: 'Matches the Deployment\'s template labels.' },
          { field: 'spec.ports.targetPort', note: 'The container port; can also be a named port.' },
        ],
      },
    },
    { id: 'apply', kind: 'command', phase: 'deploy', title: 'Create the Service', body: ['Apply service.yaml.'], command: 'kubectl apply -f service.yaml', check: applied('Service', 'frontend'), hint: 'Run `kubectl apply -f service.yaml`.' },
    { id: 'endpoints', kind: 'cluster', phase: 'observe', title: 'Endpoints appear', body: ['The Service finds the ready frontend Pods.'], check: serviceHasEndpoints('frontend', 1), hint: 'Does the Service selector match the Pods\' labels? Compare with `kubectl get pods --show-labels`.' },
    {
      id: 'describe',
      kind: 'command',
      phase: 'verify',
      title: 'Inspect it',
      body: ['Describe the Service to see its ClusterIP and the Pod IPs behind it.'],
      command: 'kubectl describe svc frontend',
      check: described('Service', 'frontend'),
      hint: 'Run `kubectl describe svc frontend`, then compare the Endpoints with `kubectl get pods -o wide`.',
      explain: ['Inside the cluster, `frontend` (or `frontend.default.svc.cluster.local`) now resolves to the ClusterIP, whichever Pods are behind it.'],
    },
  ],
};

// ---------------------------------------------------------------------------
// L07 · ConfigMap
// ---------------------------------------------------------------------------

const CM_SOLUTION = `apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  GREETING: "Hello from a ConfigMap"
  LOG_LEVEL: info
`;

const CONFIG_POD_SOLUTION = `apiVersion: v1
kind: Pod
metadata:
  name: config-demo
spec:
  containers:
    - name: web
      image: nginx:stable
      env:
        - name: GREETING
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: GREETING
      envFrom:
        - configMapRef:
            name: app-config
`;

const usesConfigMap: ManifestCheck = check('uses-cm', 'the container reads app-config into its environment', (d) => {
  const refs = [...valuesAt(d, 'spec.containers[*].env[*].valueFrom.configMapKeyRef.name'), ...valuesAt(d, 'spec.containers[*].envFrom[*].configMapRef.name')];
  if (refs.length === 0) return 'Add `env` with `valueFrom.configMapKeyRef`, or `envFrom` with `configMapRef`, pointing at app-config.';
  return refs.includes('app-config') ? null : `The container references ${refs.map((r) => `"${String(r)}"`).join(', ')}; the ConfigMap is named app-config.`;
});

export const configMap: Lesson = {
  id: 'configmap',
  number: 7,
  title: 'ConfigMaps',
  tagline: 'Configuration outside the image.',
  summary: 'Store settings in a ConfigMap and inject them into a container as environment variables.',
  level: 'Intermediate',
  minutes: 12,
  concepts: ['ConfigMap', 'env', 'valueFrom', 'envFrom'],
  prerequisites: ['first-pod'],
  depth: 'interactive',
  simulationNotes: ['Environment variables are resolved when the container starts, as in Kubernetes: editing the ConfigMap later does not change a running container. `kubectl exec … -- env` prints the simulated environment.'],
  steps: [
    {
      id: 'what',
      kind: 'read',
      phase: 'understand',
      title: 'Separate config from code',
      cards: [
        {
          title: 'Key/value configuration',
          body: [
            'A ConfigMap holds non-secret settings as string keys and values under `data`. The same image can then run with different configuration in each environment.',
            'A container can read one key with `env[].valueFrom.configMapKeyRef`, or all keys with `envFrom`.',
          ],
          more: 'If the ConfigMap is missing, the container cannot start (CreateContainerConfigError) until it exists. For passwords and tokens use a Secret, which works the same way.',
        },
      ],
    },
    {
      id: 'write-cm',
      kind: 'write',
      phase: 'write',
      title: 'Write configmap.yaml',
      exercise: {
        file: 'configmap.yaml',
        kind: 'ConfigMap',
        objective: 'A ConfigMap named app-config with a GREETING key.',
        checks: [equals('kind', 'ConfigMap', '`kind` is ConfigMap'), equals('metadata.name', 'app-config', 'named app-config'), present('data.GREETING', 'it has a GREETING key', 'Add `data:` with a `GREETING` key.')],
        modes: {
          guided: [
            {
              title: 'Kind and name',
              explain: ['ConfigMaps are core objects (`v1`). They have `data` instead of `spec`.'],
              instruction: 'Write the ConfigMap header with name `app-config`.',
              fields: ['kind', 'metadata.name'],
              checks: [equals('kind', 'ConfigMap', '`kind` is ConfigMap'), equals('metadata.name', 'app-config', 'named app-config')],
              snippet: 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: app-config',
            },
            {
              title: 'The data',
              explain: ['Values are strings. Quote anything YAML would read as a number or boolean.'],
              instruction: 'Add `data` with `GREETING` and any other keys you like.',
              fields: ['data'],
              checks: [present('data.GREETING', 'it has a GREETING key')],
              snippet: 'data:\n  GREETING: "Hello from a ConfigMap"',
            },
          ],
          complete: CM_SOLUTION.replace('name: app-config', 'name: ___').replace('GREETING: "Hello from a ConfigMap"', 'GREETING: ___'),
          scratch: '',
        },
        hints: ['A ConfigMap is just named data.', 'Top-level `data:` mapping instead of `spec`.', CM_SOLUTION],
        solution: CM_SOLUTION,
        solutionNotes: [{ field: 'data', note: 'String keys to string values.' }],
      },
    },
    {
      id: 'write-pod',
      kind: 'write',
      phase: 'write',
      title: 'Consume it from a Pod',
      exercise: {
        file: 'config-pod.yaml',
        kind: 'Pod',
        objective: 'A Pod named config-demo whose container gets GREETING from app-config.',
        checks: [equals('kind', 'Pod', '`kind` is Pod'), equals('metadata.name', 'config-demo', 'named config-demo'), anyImage('spec.containers[*].image', 'nginx'), usesConfigMap],
        modes: {
          guided: [
            {
              title: 'A basic Pod',
              explain: ['Start from the Pod you know.'],
              instruction: 'Write a Pod named `config-demo` with an nginx container named `web`.',
              fields: ['metadata.name', 'spec.containers'],
              checks: [equals('metadata.name', 'config-demo', 'named config-demo'), anyImage('spec.containers[*].image', 'nginx')],
              snippet: 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: config-demo\nspec:\n  containers:\n    - name: web\n      image: nginx:stable',
            },
            {
              title: 'Reference the ConfigMap',
              explain: ['`env` is a list of variables. `valueFrom.configMapKeyRef` takes the value from a ConfigMap key instead of writing it inline.'],
              instruction: 'Add `env` with a `GREETING` variable taken from app-config (or use `envFrom`).',
              fields: ['spec.containers.env', 'spec.containers.envFrom'],
              checks: [usesConfigMap],
              snippet: '      env:\n        - name: GREETING\n          valueFrom:\n            configMapKeyRef:\n              name: app-config\n              key: GREETING',
            },
          ],
          complete: CONFIG_POD_SOLUTION.replace('              name: app-config', '              name: ___').replace('key: GREETING', 'key: ___'),
          scratch: '',
        },
        hints: ['Environment variables can come from other objects.', '`env[].valueFrom.configMapKeyRef` with `name` and `key`, or `envFrom[].configMapRef.name`.', CONFIG_POD_SOLUTION],
        solution: CONFIG_POD_SOLUTION,
        solutionNotes: [
          { field: 'spec.containers.env', note: 'One variable, from one key.' },
          { field: 'spec.containers.envFrom', note: 'Every key of the ConfigMap becomes a variable.' },
        ],
      },
    },
    {
      id: 'apply',
      kind: 'command',
      phase: 'deploy',
      title: 'Apply both',
      body: ['Apply the ConfigMap and the Pod. Try the Pod first to see what happens when its ConfigMap is missing.'],
      command: 'kubectl apply -f configmap.yaml -f config-pod.yaml',
      check: (log) => applied('ConfigMap', 'app-config')(log) && applied('Pod', 'config-demo')(log),
      hint: 'Run `kubectl apply -f configmap.yaml` and `kubectl apply -f config-pod.yaml`.',
    },
    { id: 'running', kind: 'cluster', phase: 'observe', title: 'The Pod starts', body: ['The kubelet resolves the variables before starting the container.'], check: podRunning('config-demo'), hint: 'If it shows CreateContainerConfigError, the ConfigMap (or key) it references does not exist yet.' },
    {
      id: 'env',
      kind: 'command',
      phase: 'verify',
      title: 'Read the environment',
      body: ['Run `env` inside the container.'],
      command: 'kubectl exec config-demo -- env',
      check: verb('exec', 'Pod', (n) => n === 'config-demo'),
      hint: 'Run `kubectl exec config-demo -- env` and look for GREETING.',
    },
  ],
};

// ---------------------------------------------------------------------------
// L08 · PersistentVolumeClaim
// ---------------------------------------------------------------------------

const PVC_SOLUTION = `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
`;

const STORAGE_POD_SOLUTION = `apiVersion: v1
kind: Pod
metadata:
  name: writer
spec:
  containers:
    - name: web
      image: nginx:stable
      volumeMounts:
        - name: data
          mountPath: /usr/share/nginx/html
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: data
`;

const mountsClaim: ManifestCheck = check('mounts-claim', 'a volume from claim "data" is mounted in the container', (d) => {
  const vols = (valueAt(d, 'spec.volumes') as { name?: string; persistentVolumeClaim?: { claimName?: string } }[] | undefined) ?? [];
  const vol = Array.isArray(vols) ? vols.find((v) => v?.persistentVolumeClaim?.claimName === 'data') : undefined;
  if (!vol) return 'Add `spec.volumes` with an item using `persistentVolumeClaim.claimName: data`.';
  return valuesAt(d, 'spec.containers[*].volumeMounts[*].name').includes(vol.name) ? null : `Mount the volume "${String(vol.name)}" in the container with \`volumeMounts\` (name and mountPath).`;
});

export const storage: Lesson = {
  id: 'storage',
  number: 8,
  title: 'Persistent storage',
  tagline: 'Claim storage, mount it in a Pod.',
  summary: 'Request a volume with a PersistentVolumeClaim, watch it bind, and mount it into a Pod.',
  level: 'Intermediate',
  minutes: 12,
  concepts: ['PersistentVolumeClaim', 'PersistentVolume', 'volumes', 'volumeMounts'],
  prerequisites: ['first-pod'],
  depth: 'interactive',
  simulationNotes: [
    'Storage is simulated: the pretend `standard` StorageClass binds each claim to a generated PersistentVolume, but no data is ever written or kept.',
    'Scheduling waits for the claim to be bound, as in Kubernetes. Access modes and capacity are recorded, not enforced.',
  ],
  steps: [
    {
      id: 'what',
      kind: 'read',
      phase: 'understand',
      title: 'Claims and volumes',
      cards: [
        {
          title: 'Ask for storage, don\'t build it',
          body: [
            'Container files vanish when the container is replaced. To keep data, a Pod mounts a volume backed by real storage.',
            'You request storage with a PersistentVolumeClaim (size and access mode). A provisioner creates a PersistentVolume and binds it to the claim. The Pod refers only to the claim.',
          ],
          more: 'ReadWriteOnce means one node can mount it read-write at a time. StorageClasses decide what kind of disk is provisioned; clusters usually have a default one.',
        },
      ],
    },
    {
      id: 'write-pvc',
      kind: 'write',
      phase: 'write',
      title: 'Write pvc.yaml',
      exercise: {
        file: 'pvc.yaml',
        kind: 'PersistentVolumeClaim',
        objective: 'A claim named data for 1Gi, ReadWriteOnce.',
        checks: [
          equals('kind', 'PersistentVolumeClaim', '`kind` is PersistentVolumeClaim'),
          equals('metadata.name', 'data', 'named data'),
          check('rwo', 'access mode ReadWriteOnce', (d) => (valuesAt(d, 'spec.accessModes[*]').includes('ReadWriteOnce') ? null : 'Add `spec.accessModes` with `- ReadWriteOnce`.')),
          present('spec.resources.requests.storage', 'it requests a size', 'Add `spec.resources.requests.storage: 1Gi`.'),
        ],
        modes: {
          guided: [
            {
              title: 'Kind and name',
              explain: ['PersistentVolumeClaims are core objects.'],
              instruction: 'Write the header: `kind: PersistentVolumeClaim`, name `data`.',
              fields: ['kind', 'metadata.name'],
              checks: [equals('kind', 'PersistentVolumeClaim', '`kind` is PersistentVolumeClaim'), equals('metadata.name', 'data', 'named data')],
              snippet: 'apiVersion: v1\nkind: PersistentVolumeClaim\nmetadata:\n  name: data',
            },
            {
              title: 'Access and size',
              explain: ['The claim says how it will be used and how much space it needs.'],
              instruction: 'Add `accessModes: [ReadWriteOnce]` and `resources.requests.storage: 1Gi`.',
              fields: ['spec.accessModes', 'spec.resources'],
              checks: [present('spec.resources.requests.storage', 'it requests a size')],
              snippet: 'spec:\n  accessModes:\n    - ReadWriteOnce\n  resources:\n    requests:\n      storage: 1Gi',
            },
          ],
          complete: PVC_SOLUTION.replace('- ReadWriteOnce', '- ___').replace('storage: 1Gi', 'storage: ___'),
          scratch: '',
        },
        hints: ['A claim states an access mode and a size.', '`spec.accessModes` (a list) and `spec.resources.requests.storage`.', PVC_SOLUTION],
        solution: PVC_SOLUTION,
        solutionNotes: [{ field: 'spec.resources.requests.storage', note: 'Quantities use binary suffixes: Mi, Gi.' }],
      },
    },
    {
      id: 'write-pod',
      kind: 'write',
      phase: 'write',
      title: 'Mount it',
      exercise: {
        file: 'storage-pod.yaml',
        kind: 'Pod',
        objective: 'A Pod named writer that mounts the data claim.',
        checks: [equals('kind', 'Pod', '`kind` is Pod'), equals('metadata.name', 'writer', 'named writer'), anyImage('spec.containers[*].image', 'nginx'), mountsClaim],
        modes: {
          guided: [
            {
              title: 'Declare the volume',
              explain: ['Pod-level `volumes` say where storage comes from. This one comes from the claim.'],
              instruction: 'Write a Pod named `writer` (nginx), with `spec.volumes` using `persistentVolumeClaim.claimName: data`.',
              fields: ['spec.volumes'],
              checks: [equals('metadata.name', 'writer', 'named writer'), check('vol', 'a volume uses claim data', (d) => (valuesAt(d, 'spec.volumes[*].persistentVolumeClaim.claimName').includes('data') ? null : 'Add a volume with `persistentVolumeClaim.claimName: data`.'))],
              snippet: '  volumes:\n    - name: data\n      persistentVolumeClaim:\n        claimName: data',
            },
            {
              title: 'Mount it in the container',
              explain: ['`volumeMounts` choose where the volume appears inside the container, by volume name.'],
              instruction: 'Add `volumeMounts` to the container with the volume\'s name and a `mountPath`.',
              fields: ['spec.containers.volumeMounts'],
              checks: [mountsClaim],
              snippet: '      volumeMounts:\n        - name: data\n          mountPath: /usr/share/nginx/html',
            },
          ],
          complete: STORAGE_POD_SOLUTION.replace('claimName: data', 'claimName: ___').replace('mountPath: /usr/share/nginx/html', 'mountPath: ___'),
          scratch: '',
        },
        hints: ['Two parts: where the storage comes from, and where it appears in the container.', '`spec.volumes[].persistentVolumeClaim.claimName` and `spec.containers[].volumeMounts[]` with the same name.', STORAGE_POD_SOLUTION],
        solution: STORAGE_POD_SOLUTION,
        solutionNotes: [
          { field: 'spec.volumes', note: 'Named volume backed by the claim.' },
          { field: 'spec.containers.volumeMounts', note: 'Mounted by name at a path.' },
        ],
      },
    },
    {
      id: 'apply',
      kind: 'command',
      phase: 'deploy',
      title: 'Apply both',
      body: ['Apply the claim and the Pod.'],
      command: 'kubectl apply -f pvc.yaml -f storage-pod.yaml',
      check: (log) => applied('PersistentVolumeClaim', 'data')(log) && applied('Pod', 'writer')(log),
      hint: 'Run `kubectl apply -f pvc.yaml -f storage-pod.yaml`.',
    },
    {
      id: 'bound',
      kind: 'cluster',
      phase: 'observe',
      title: 'Bound and running',
      body: ['The claim binds to a new volume, then the Pod can be scheduled.'],
      check: (s) => {
        const pvc = findObject(s, 'PersistentVolumeClaim', 'data');
        if (!pvc) return 'No claim named data yet.';
        if (pvc.status.phase !== 'Bound') return 'The claim is Pending: waiting for a volume.';
        return podRunning('writer')(s);
      },
      hint: 'If the Pod is Pending, `kubectl describe pod writer` says why.',
    },
    { id: 'get', kind: 'command', phase: 'verify', title: 'See the binding', body: ['List claims and volumes.'], command: 'kubectl get pvc', check: listed('PersistentVolumeClaim'), hint: 'Run `kubectl get pvc`, then `kubectl get pv`.' },
  ],
};

// ---------------------------------------------------------------------------
// L09 · Probes
// ---------------------------------------------------------------------------

const PROBES_SOLUTION = deploymentYaml(
  'health',
  2,
  'health',
  `          readinessProbe:
            httpGet:
              path: /
              port: 80
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 5
`,
);

const probeChecks: ManifestCheck[] = [
  present('spec.template.spec.containers[0].readinessProbe', 'the container has a readinessProbe', 'Add a `readinessProbe` to the container.'),
  present('spec.template.spec.containers[0].livenessProbe', 'the container has a livenessProbe', 'Add a `livenessProbe` to the container.'),
];

export const probes: Lesson = {
  id: 'probes',
  number: 9,
  title: 'Readiness and liveness',
  tagline: 'Teach Kubernetes when your app is healthy.',
  summary: 'Add probes so traffic only reaches ready Pods and stuck containers are restarted.',
  level: 'Intermediate',
  minutes: 12,
  concepts: ['readinessProbe', 'livenessProbe', 'httpGet', 'restarts'],
  prerequisites: ['deployment'],
  depth: 'interactive',
  simulationNotes: ['Probes are evaluated against a model of the image: nginx answers 200 on `/` and `/index.html`, 404 elsewhere; closed ports refuse connections. Timing is approximate (one check per simulated second).'],
  steps: [
    {
      id: 'what',
      kind: 'read',
      phase: 'understand',
      title: 'Two different questions',
      cards: [
        {
          title: 'Ready? Alive?',
          body: [
            'A readinessProbe asks "can this Pod receive traffic now?" Until it passes, the Pod is not Ready and Services skip it.',
            'A livenessProbe asks "is this container stuck?" If it fails repeatedly, the kubelet restarts the container.',
          ],
          code: 'readinessProbe:\n  httpGet:\n    path: /\n    port: 80',
          more: 'A wrong liveness probe is dangerous: it restarts healthy containers forever. A failing readiness probe during a rollout stops it safely, because old Pods stay until new ones are Ready.',
        },
      ],
    },
    {
      id: 'write',
      kind: 'write',
      phase: 'write',
      title: 'Add probes',
      exercise: {
        file: 'probes.yaml',
        kind: 'Deployment',
        objective: 'A Deployment named health (2 replicas) whose nginx container has readiness and liveness probes.',
        checks: [...deploymentChecks('health', 2), ...probeChecks],
        modes: {
          guided: [
            {
              title: 'Start from a Deployment',
              explain: ['The Deployment is in the editor. Probes belong to the container, in the Pod template.'],
              instruction: 'Keep the health Deployment as it is for now.',
              fields: ['spec.template.spec.containers'],
              checks: [equals('metadata.name', 'health', 'named health')],
              snippet: deploymentYaml('health', 2, 'health'),
            },
            {
              title: 'Readiness',
              explain: ['An `httpGet` probe passes when the path answers with a 2xx or 3xx status.'],
              instruction: 'Add a `readinessProbe` with `httpGet` on path `/`, port 80.',
              fields: ['spec.template.spec.containers.readinessProbe'],
              checks: [probeChecks[0]!],
              snippet: '          readinessProbe:\n            httpGet:\n              path: /\n              port: 80',
            },
            {
              title: 'Liveness',
              explain: ['Give the app time to start with `initialDelaySeconds`.'],
              instruction: 'Add a `livenessProbe`, also `httpGet` on `/` port 80.',
              fields: ['spec.template.spec.containers.livenessProbe'],
              checks: [probeChecks[1]!],
              snippet: '          livenessProbe:\n            httpGet:\n              path: /\n              port: 80\n            initialDelaySeconds: 5',
            },
          ],
          guidedStarter: deploymentYaml('health', 2, 'health'),
          complete: PROBES_SOLUTION.replace(/path: \//g, 'path: ___'),
          scratch: '',
        },
        hints: ['Probes are settings of the container.', 'Add `readinessProbe` and `livenessProbe`, each with `httpGet: {path, port}`, aligned with `image`.', PROBES_SOLUTION],
        solution: PROBES_SOLUTION,
        solutionNotes: [
          { field: 'spec.template.spec.containers.readinessProbe', note: 'Gates traffic.' },
          { field: 'spec.template.spec.containers.livenessProbe', note: 'Triggers restarts.' },
        ],
      },
    },
    { id: 'apply', kind: 'command', phase: 'deploy', title: 'Apply', body: ['Apply probes.yaml.'], command: 'kubectl apply -f probes.yaml', check: applied('Deployment', 'health'), hint: 'Run `kubectl apply -f probes.yaml`.' },
    { id: 'ready', kind: 'cluster', phase: 'observe', title: 'Ready after the probe passes', body: ['Pods become Ready only once the readiness probe succeeds.'], check: workloadReady('Deployment', 'health', 2), hint: 'If Pods stay 0/1, describe one: the Events show the probe failures.' },
    {
      id: 'describe',
      kind: 'command',
      phase: 'verify',
      title: 'See the probes',
      body: ['Describe one of the health Pods: the Readiness and Liveness lines show the configuration.'],
      command: 'kubectl describe pod health-…',
      check: described('Pod', (n) => n.startsWith('health-')),
      hint: 'Run `kubectl get pods`, then `kubectl describe pod <a health-… name>`.',
      explain: ['Experiment: change the readiness path to `/healthz` and apply. The new Pods never become Ready, and the rollout stops with the old Pods still serving.'],
    },
  ],
};

// ---------------------------------------------------------------------------
// L10 · Resources and QoS
// ---------------------------------------------------------------------------

const RESOURCES_SOLUTION = `apiVersion: v1
kind: Pod
metadata:
  name: sized
spec:
  containers:
    - name: web
      image: nginx:stable
      resources:
        requests:
          cpu: 250m
          memory: 128Mi
        limits:
          cpu: 500m
          memory: 256Mi
`;

export const resources: Lesson = {
  id: 'resources',
  number: 10,
  title: 'Requests, limits and QoS',
  tagline: 'Tell the scheduler what your container needs.',
  summary: 'Set CPU and memory requests and limits, see how they drive scheduling and the Pod\'s QoS class.',
  level: 'Intermediate',
  minutes: 12,
  concepts: ['requests', 'limits', 'QoS class', 'scheduling'],
  prerequisites: ['first-pod'],
  depth: 'interactive',
  simulationNotes: ['Requests drive scheduling against each node\'s allocatable CPU and memory. Usage is not simulated, so limits are never hit: no CPU throttling and no OOMKilled.'],
  steps: [
    {
      id: 'what',
      kind: 'read',
      phase: 'understand',
      title: 'Requests vs limits',
      cards: [
        {
          title: 'Reserve and cap',
          body: [
            '`requests` is what the scheduler reserves on a node for the container. A Pod only goes to a node with enough unreserved CPU and memory.',
            '`limits` is the maximum the container may use. Requests must not exceed limits.',
          ],
          code: 'resources:\n  requests:\n    cpu: 250m      # a quarter of a CPU\n    memory: 128Mi\n  limits:\n    cpu: 500m\n    memory: 256Mi',
          more: 'QoS classes follow from them: Guaranteed (requests = limits for every container), Burstable (some requests or limits), BestEffort (none). Under memory pressure, BestEffort Pods are evicted first.',
        },
      ],
    },
    {
      id: 'write',
      kind: 'write',
      phase: 'write',
      title: 'Size a container',
      exercise: {
        file: 'resources.yaml',
        kind: 'Pod',
        objective: 'A Pod named sized whose container sets CPU and memory requests and limits.',
        checks: [
          equals('metadata.name', 'sized', 'named sized'),
          anyImage('spec.containers[*].image', 'nginx'),
          present('spec.containers[0].resources.requests.cpu', 'it requests CPU', 'Add `resources.requests.cpu`, e.g. `250m`.'),
          present('spec.containers[0].resources.requests.memory', 'it requests memory', 'Add `resources.requests.memory`, e.g. `128Mi`.'),
          present('spec.containers[0].resources.limits.cpu', 'it limits CPU', 'Add `resources.limits.cpu`.'),
          present('spec.containers[0].resources.limits.memory', 'it limits memory', 'Add `resources.limits.memory`.'),
        ],
        modes: {
          guided: [
            {
              title: 'A basic Pod',
              explain: ['Resources are set per container.'],
              instruction: 'Write a Pod named `sized` with an nginx container.',
              fields: ['metadata.name', 'spec.containers'],
              checks: [equals('metadata.name', 'sized', 'named sized'), anyImage('spec.containers[*].image', 'nginx')],
              snippet: 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: sized\nspec:\n  containers:\n    - name: web\n      image: nginx:stable',
            },
            {
              title: 'Requests',
              explain: ['CPU is in cores or millicores (`250m` = 0.25). Memory uses `Mi` and `Gi`.'],
              instruction: 'Add `resources.requests` with `cpu` and `memory`.',
              fields: ['spec.containers.resources', 'spec.containers.resources.requests'],
              checks: [present('spec.containers[0].resources.requests.cpu', 'it requests CPU'), present('spec.containers[0].resources.requests.memory', 'it requests memory')],
              snippet: '      resources:\n        requests:\n          cpu: 250m\n          memory: 128Mi',
            },
            {
              title: 'Limits',
              explain: ['Limits must be at least the requests.'],
              instruction: 'Add `resources.limits` with `cpu` and `memory`.',
              fields: ['spec.containers.resources.limits'],
              checks: [present('spec.containers[0].resources.limits.cpu', 'it limits CPU'), present('spec.containers[0].resources.limits.memory', 'it limits memory')],
              snippet: '        limits:\n          cpu: 500m\n          memory: 256Mi',
            },
          ],
          complete: RESOURCES_SOLUTION.replace('cpu: 250m', 'cpu: ___').replace('memory: 256Mi', 'memory: ___'),
          scratch: '',
        },
        hints: ['Resources belong to the container.', '`resources.requests` and `resources.limits`, each with `cpu` and `memory`.', RESOURCES_SOLUTION],
        solution: RESOURCES_SOLUTION,
        solutionNotes: [
          { field: 'spec.containers.resources.requests', note: 'Reserved on the node; used for scheduling.' },
          { field: 'spec.containers.resources.limits', note: 'The cap. Different from requests, so the Pod is Burstable.' },
        ],
      },
    },
    { id: 'apply', kind: 'command', phase: 'deploy', title: 'Apply', body: ['Apply resources.yaml.'], command: 'kubectl apply -f resources.yaml', check: applied('Pod', 'sized'), hint: 'Run `kubectl apply -f resources.yaml`.' },
    { id: 'running', kind: 'cluster', phase: 'observe', title: 'Scheduled with its reservation', body: ['The scheduler chose a node with enough room.'], check: podRunning('sized'), hint: 'If it stays Pending, the requests may be larger than any node can offer: `kubectl describe pod sized`.' },
    {
      id: 'qos',
      kind: 'command',
      phase: 'verify',
      title: 'Find the QoS class',
      body: ['Describe the Pod and find its QoS Class near the bottom.'],
      command: 'kubectl describe pod sized',
      check: described('Pod', 'sized'),
      hint: 'Run `kubectl describe pod sized`.',
      explain: ['Requests below limits make it Burstable. Set them equal for Guaranteed. Try requesting `cpu: "8"` in another Pod: no node has that much, so it stays Pending with "Insufficient cpu".'],
    },
  ],
};