/**
 * The shape of each supported kind, with the documentation of every field.
 *
 * One registry serves three purposes: schema validation of applied manifests,
 * the field explanations shown in the editor, and `kubectl explain`. The same
 * key can mean different things in different places (`selector` on a Service
 * is a plain map, on a Deployment a LabelSelector), so docs hang off the
 * position in the tree, never off the key alone.
 */
import type { Kind } from './types';

export interface FieldDoc {
  /** What the field means, in one or two sentences. */
  summary: string;
  /** Why it is needed. */
  why?: string;
  /** What values it accepts. */
  values?: string;
  /** How Kubernetes uses it. */
  how?: string;
  example?: string;
  /** Deeper information, shown on demand. */
  details?: string;
}

export type StringFormat = 'dns-subdomain' | 'dns-label' | 'image' | 'cpu' | 'memory' | 'storage' | 'path' | 'env-name';

export type SchemaNode =
  | { type: 'object'; name: string; fields: Record<string, Field> }
  | { type: 'array'; items: SchemaNode }
  | { type: 'map'; name: string }
  | { type: 'string'; enum?: readonly string[]; format?: StringFormat }
  | { type: 'integer'; min?: number; max?: number }
  | { type: 'int-or-string' }
  | { type: 'boolean' }
  /** Any mapping, e.g. `emptyDir: {}`. */
  | { type: 'free'; name: string };

export interface Field {
  node: SchemaNode;
  required?: boolean;
  doc: FieldDoc;
}

const f = (node: SchemaNode, doc: FieldDoc, required = false): Field => ({ node, doc, required });
const str = (format?: StringFormat): SchemaNode => (format ? { type: 'string', format } : { type: 'string' });
const obj = (name: string, fields: Record<string, Field>): SchemaNode => ({ type: 'object', name, fields });
const arr = (items: SchemaNode): SchemaNode => ({ type: 'array', items });
const map = (name: string): SchemaNode => ({ type: 'map', name });

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

const labelsDoc: FieldDoc = {
  summary: 'Key/value tags attached to the object, used to identify and group it.',
  why: 'Labels are how Kubernetes objects find each other: Services, ReplicaSets and Deployments pick their Pods by label, never by name.',
  values: 'A mapping of keys to string values. Keys and values: up to 63 characters, letters, digits, "-", "_" and ".", starting and ending with a letter or digit. Keys may have a prefix like "app.kubernetes.io/".',
  how: 'Stored with the object. Selectors (`kubectl get pods -l app=web`, a Service selector, a ReplicaSet matchLabels) compare them.',
  example: 'labels:\n  app: web\n  tier: frontend',
  details: 'Common conventions: `app` (application name), `tier` or `component` (its role), `environment`, and the recommended `app.kubernetes.io/name`. Values must be strings: quote numbers such as `"1"`.',
};

const metadataFields = (who: string): Record<string, Field> => ({
  name: f(str('dns-subdomain'), {
    summary: `The ${who}'s name, unique among ${who}s of the same namespace.`,
    why: 'It is the identity you use in commands: `kubectl get`, `describe`, `delete`. Applying a manifest with the same name updates the existing object instead of creating a new one.',
    values: 'Lowercase letters, digits, "-" and ".", starting and ending with a letter or digit, up to 253 characters.',
    how: 'The API server stores the object under its kind, namespace and name.',
    example: 'name: hello-pod',
  }, true),
  namespace: f(str('dns-label'), {
    summary: 'The namespace the object lives in: a named partition of the cluster.',
    why: 'Namespaces separate teams or environments and scope names: two objects can share a name in different namespaces.',
    values: 'An existing namespace. When omitted, `default`. In this Playground: `default`.',
    how: 'Names only need to be unique within their namespace, and most commands work on one namespace at a time (`-n`).',
  }),
  labels: f(map('labels'), labelsDoc),
  annotations: f(map('annotations'), {
    summary: 'Non-identifying key/value notes attached to the object.',
    why: 'Tools store information here (descriptions, build ids, configuration hints). Unlike labels, nothing selects by annotation.',
    values: 'A mapping of keys to string values; values can be long.',
  }),
});

const metadata = (who: string, summary?: string): Field =>
  f(obj('ObjectMeta', metadataFields(who)), {
    summary: summary ?? `Identity of the ${who}: its name, namespace, labels and annotations.`,
    why: 'Every Kubernetes object needs at least a name so the API can store it and you can refer to it.',
    values: 'A mapping with `name` (required), and optionally `namespace`, `labels`, `annotations`.',
    how: 'The server adds more fields when it stores the object: uid, creationTimestamp, generation, ownerReferences…',
    example: 'metadata:\n  name: hello-pod\n  labels:\n    app: hello',
  }, true);

const apiVersion = (value: string, kind: string): Field =>
  f(str(), {
    summary: `The API group and version used to interpret this object. For a ${kind}: \`${value}\`.`,
    why: 'The API is split into groups (core, `apps`, `batch`…) that each evolve through versions, from `v1alpha1` to `v1beta1` to stable `v1`. The version tells the API server which schema to read the rest of the manifest with.',
    values: value === 'v1' ? '`v1`: the core group, which has no name, at its stable version.' : `\`${value}\`: group \`${value.split('/')[0]}\`, stable version \`${value.split('/')[1]}\`. Old forms like \`extensions/v1beta1\` were removed and are rejected.`,
    how: 'Together, apiVersion and kind select the exact resource type: `kubectl api-resources` lists them all.',
    example: `apiVersion: ${value}`,
  }, true);

const kindField = (kind: string, summary: string): Field =>
  f(str(), {
    summary: `The type of resource this manifest describes: \`${kind}\`. ${summary}`,
    why: 'The API server needs to know what kind of object to create; each kind has its own spec.',
    values: 'A resource type name in PascalCase: Pod, ReplicaSet, Deployment, Service, ConfigMap, PersistentVolumeClaim…',
    how: 'Combined with apiVersion, it picks the schema and the controller responsible for the object.',
    example: `kind: ${kind}`,
  }, true);

const portRef: SchemaNode = { type: 'int-or-string' };

const probe = (purpose: 'readiness' | 'liveness'): Field =>
  f(
    obj('Probe', {
      httpGet: f(
        obj('HTTPGetAction', {
          path: f(str('path'), { summary: 'The HTTP path to request, e.g. `/` or `/healthz`.', values: 'A path starting with "/". Default "/".' }),
          port: f(portRef, { summary: 'The container port to call: a number, or the name of one of its declared ports.', values: 'Integer 1-65535, or a port name.' }, true),
        }),
        { summary: 'Probe by sending an HTTP GET request; any status from 200 to 399 is a success.', example: 'httpGet:\n  path: /\n  port: 80' },
      ),
      tcpSocket: f(obj('TCPSocketAction', { port: f(portRef, { summary: 'The port to open a TCP connection to.' }, true) }), {
        summary: 'Probe by opening a TCP connection: success if the port accepts it.',
      }),
      exec: f(obj('ExecAction', { command: f(arr(str()), { summary: 'Command run inside the container; exit code 0 is a success.' }) }), {
        summary: 'Probe by running a command inside the container.',
      }),
      initialDelaySeconds: f({ type: 'integer', min: 0 }, {
        summary: 'Seconds to wait after the container starts before the first probe.',
        why: 'Gives slow applications time to boot before they are judged.',
        values: 'Integer ≥ 0. Default 0.',
      }),
      periodSeconds: f({ type: 'integer', min: 1 }, { summary: 'How often (in seconds) to probe.', values: 'Integer ≥ 1. Default 10.' }),
      failureThreshold: f({ type: 'integer', min: 1 }, {
        summary: 'Consecutive failures before the probe counts as failed.',
        values: 'Integer ≥ 1. Default 3.',
      }),
    }),
    purpose === 'readiness'
      ? {
          summary: 'Checks whether the container is ready to receive traffic.',
          why: 'A process can be running but still loading. Until readiness passes, the Pod is not Ready and Services send it no traffic.',
          values: 'A probe: one of `httpGet`, `tcpSocket` or `exec`, plus timing fields.',
          how: 'The kubelet runs it periodically. Failing readiness never restarts the container; it only removes the Pod from Service endpoints.',
          example: 'readinessProbe:\n  httpGet:\n    path: /\n    port: 80\n  initialDelaySeconds: 3',
        }
      : {
          summary: 'Checks whether the container is still alive (not stuck).',
          why: 'A deadlocked process keeps running but serves nothing. A liveness probe lets Kubernetes detect it and restart the container.',
          values: 'A probe: one of `httpGet`, `tcpSocket` or `exec`, plus timing fields.',
          how: 'The kubelet runs it periodically. After `failureThreshold` failures in a row, it kills and restarts the container (RESTARTS goes up).',
          example: 'livenessProbe:\n  httpGet:\n    path: /\n    port: 80\n  periodSeconds: 10',
        },
  );

const resourceList = (which: 'requests' | 'limits'): Field =>
  f(
    obj('ResourceList', {
      cpu: f(str('cpu'), {
        summary: which === 'requests' ? 'CPU reserved for the container.' : 'Maximum CPU the container may use.',
        values: 'CPU units: `1` is one core, `500m` (millicores) is half a core, `250m` a quarter.',
        how: which === 'requests' ? 'The scheduler only places the Pod on a Node with this much unreserved CPU.' : 'Above the limit, the container is throttled (slowed down), not killed.',
      }),
      memory: f(str('memory'), {
        summary: which === 'requests' ? 'Memory reserved for the container.' : 'Maximum memory the container may use.',
        values: 'Bytes with a suffix: `128Mi`, `512Mi`, `1Gi` (powers of 1024) or `500M`, `1G` (powers of 1000).',
        how: which === 'requests' ? 'The scheduler only places the Pod on a Node with this much unreserved memory.' : 'Above the limit, the kernel kills the process (OOMKilled) and the container restarts.',
      }),
    }),
    which === 'requests'
      ? {
          summary: 'The minimum resources the container needs: what the scheduler reserves for it.',
          why: 'Without requests, the scheduler cannot tell whether a Node has room, and the Pod gets the lowest QoS class.',
          values: '`cpu` and/or `memory` quantities.',
          how: 'The scheduler adds up the requests of every Pod on a Node and only places a new Pod where they fit in the Node\'s allocatable capacity.',
          example: 'requests:\n  cpu: 250m\n  memory: 128Mi',
        }
      : {
          summary: 'The maximum resources the container may use.',
          why: 'Limits stop one container from starving its neighbours on the same Node.',
          values: '`cpu` and/or `memory` quantities, each at least the matching request.',
          how: 'Enforced by the kernel (cgroups) through the container runtime: CPU is throttled, memory overuse is killed.',
          example: 'limits:\n  cpu: 500m\n  memory: 256Mi',
        },
  );

const container: SchemaNode = obj('Container', {
  name: f(str('dns-label'), {
    summary: 'The container\'s name, unique within the Pod.',
    why: 'Identifies the container in commands (`kubectl logs pod -c name`), statuses and events.',
    values: 'Lowercase letters, digits and "-", up to 63 characters.',
    example: 'name: nginx',
  }, true),
  image: f(str('image'), {
    summary: 'The container image to run: the packaged application and its files.',
    why: 'This is what actually runs. Kubernetes does not build software; it runs images built elsewhere.',
    values: '`[registry/]repository[:tag]`, e.g. `nginx:stable`, `nginx:1.27`, `ghcr.io/org/app:2.1`. Without a tag, `latest` is assumed (avoid it: it changes over time).',
    how: 'The kubelet on the chosen Node asks the container runtime to pull the image, then to create and start the container.',
    example: 'image: nginx:stable',
  }, true),
  command: f(arr(str()), { summary: 'Overrides the image\'s entrypoint (Docker ENTRYPOINT).', example: 'command: ["sh", "-c"]' }),
  args: f(arr(str()), { summary: 'Arguments passed to the entrypoint (overrides Docker CMD).' }),
  ports: f(
    arr(
      obj('ContainerPort', {
        containerPort: f({ type: 'integer', min: 1, max: 65535 }, {
          summary: 'The port the application listens on inside the container.',
          values: 'Integer 1-65535. nginx listens on 80.',
          how: 'Mostly informational: the container can listen on any port. Declaring it documents it and lets Services and probes refer to it by name.',
        }, true),
        name: f(str('dns-label'), { summary: 'A name for the port (e.g. `http`), usable as targetPort or probe port.', values: 'Up to 15 lowercase characters.' }),
        protocol: f({ type: 'string', enum: ['TCP', 'UDP', 'SCTP'] }, { summary: 'Network protocol.', values: 'TCP (default), UDP or SCTP.' }),
      }),
    ),
    {
      summary: 'Ports the container exposes.',
      why: 'Documents what the application listens on, and gives Services and probes a port to target by name.',
      values: 'A list of ports, each with `containerPort`.',
      example: 'ports:\n  - containerPort: 80',
    },
  ),
  env: f(
    arr(
      obj('EnvVar', {
        name: f(str('env-name'), { summary: 'The environment variable\'s name, e.g. `GREETING`.' }, true),
        value: f(str(), { summary: 'A literal value for the variable.' }),
        valueFrom: f(
          obj('EnvVarSource', {
            configMapKeyRef: f(
              obj('ConfigMapKeySelector', {
                name: f(str('dns-subdomain'), { summary: 'The ConfigMap to read from.' }, true),
                key: f(str(), { summary: 'The key inside the ConfigMap\'s `data` whose value becomes the variable\'s value.' }, true),
              }),
              { summary: 'Take the value from one key of a ConfigMap.', example: 'configMapKeyRef:\n  name: app-config\n  key: GREETING' },
            ),
          }),
          { summary: 'Take the value from another object instead of writing it here.' },
        ),
      }),
    ),
    {
      summary: 'Environment variables set in the container.',
      why: 'The standard way to pass configuration to an application without rebuilding its image.',
      values: 'A list of `name` with either `value` or `valueFrom`.',
      how: 'The kubelet resolves the values (reading ConfigMaps if needed) when it creates the container. Changing a ConfigMap later does not update a running container\'s variables.',
      example: 'env:\n  - name: GREETING\n    valueFrom:\n      configMapKeyRef:\n        name: app-config\n        key: GREETING',
    },
  ),
  envFrom: f(
    arr(
      obj('EnvFromSource', {
        configMapRef: f(obj('ConfigMapEnvSource', { name: f(str('dns-subdomain'), { summary: 'The ConfigMap whose keys all become variables.' }, true) }), {
          summary: 'Import every key of a ConfigMap as an environment variable.',
        }),
      }),
    ),
    { summary: 'Import all keys of a ConfigMap as environment variables at once.', example: 'envFrom:\n  - configMapRef:\n      name: app-config' },
  ),
  resources: f(
    obj('ResourceRequirements', { requests: resourceList('requests'), limits: resourceList('limits') }),
    {
      summary: 'CPU and memory the container requests (reserved) and is limited to (maximum).',
      why: 'Requests drive scheduling; limits protect neighbours. Together they decide the Pod\'s QoS class.',
      values: '`requests` and/or `limits`, each with `cpu` and/or `memory`.',
      how: 'QoS classes: Guaranteed (requests = limits for CPU and memory in every container), Burstable (some requests or limits), BestEffort (none). Under memory pressure, BestEffort Pods are evicted first.',
      example: 'resources:\n  requests:\n    cpu: 250m\n    memory: 128Mi\n  limits:\n    cpu: 500m\n    memory: 256Mi',
    },
  ),
  readinessProbe: probe('readiness'),
  livenessProbe: probe('liveness'),
  volumeMounts: f(
    arr(
      obj('VolumeMount', {
        name: f(str('dns-label'), { summary: 'Which Pod volume to mount: must match a name under `spec.volumes`.' }, true),
        mountPath: f(str('path'), { summary: 'Where the volume appears inside the container, e.g. `/usr/share/nginx/html`.' }, true),
        readOnly: f({ type: 'boolean' }, { summary: 'Mount the volume read-only.' }),
      }),
    ),
    {
      summary: 'Where the Pod\'s volumes appear in this container\'s filesystem.',
      why: 'A volume declared on the Pod is invisible to a container until the container mounts it.',
      values: 'A list of `name` (a Pod volume) and `mountPath`.',
      example: 'volumeMounts:\n  - name: data\n    mountPath: /data',
    },
  ),
});

const podSpec = (inTemplate: boolean): SchemaNode =>
  obj('PodSpec', {
    containers: f(arr(container), {
      summary: inTemplate ? 'The containers each Pod created from this template will run.' : 'The containers that run inside this Pod.',
      why: 'A Pod exists to run containers: at least one is required.',
      values: 'A YAML list: each item starts with `-` and needs at least a `name` and an `image`.',
      how: 'All containers of a Pod run on the same Node and share its network (same IP, localhost) and its volumes.',
      example: 'containers:\n  - name: nginx\n    image: nginx:stable',
    }, true),
    volumes: f(
      arr(
        obj('Volume', {
          name: f(str('dns-label'), { summary: 'The volume\'s name, referenced by containers\' `volumeMounts`.' }, true),
          emptyDir: f({ type: 'free', name: 'EmptyDirVolumeSource' }, { summary: 'A scratch directory created empty with the Pod and deleted with it.', example: 'emptyDir: {}' }),
          configMap: f(obj('ConfigMapVolumeSource', { name: f(str('dns-subdomain'), { summary: 'The ConfigMap to project as files.' }, true) }), {
            summary: 'Expose a ConfigMap as files: one file per key.',
          }),
          persistentVolumeClaim: f(
            obj('PersistentVolumeClaimVolumeSource', {
              claimName: f(str('dns-subdomain'), { summary: 'The name of a PersistentVolumeClaim in the same namespace.' }, true),
              readOnly: f({ type: 'boolean' }, { summary: 'Mount the claim read-only.' }),
            }),
            {
              summary: 'Use the storage bound to a PersistentVolumeClaim.',
              why: 'Unlike emptyDir, this storage outlives the Pod: a replacement Pod mounting the same claim finds the same data.',
              example: 'persistentVolumeClaim:\n  claimName: data-pvc',
            },
          ),
        }),
      ),
      {
        summary: 'Storage the Pod makes available to its containers.',
        why: 'A container\'s own filesystem disappears when it restarts. Volumes keep or share files.',
        values: 'A list of named volumes, each with exactly one source (emptyDir, configMap, persistentVolumeClaim…).',
        how: 'The kubelet prepares each volume before starting the containers; containers then mount them by name.',
        example: 'volumes:\n  - name: data\n    persistentVolumeClaim:\n      claimName: data-pvc',
      },
    ),
    restartPolicy: f({ type: 'string', enum: ['Always', 'OnFailure', 'Never'] }, {
      summary: 'What the kubelet does when a container exits.',
      values: 'Always (default), OnFailure, Never. Pods managed by ReplicaSets and Deployments must use Always.',
    }),
  });

const selectorDoc = (owner: 'ReplicaSet' | 'Deployment'): FieldDoc => ({
  summary: `How the ${owner} recognises the Pods it is responsible for.`,
  why: `A ${owner} does not track Pods by name: it counts every Pod whose labels match this selector. It must match the template's labels, or the Pods it creates would not count.`,
  values: '`matchLabels`: a map of labels a Pod must all carry.',
  how: owner === 'ReplicaSet'
    ? 'The ReplicaSet controller lists Pods matching the selector, compares the count with `replicas`, and creates or deletes Pods to close the gap. It is immutable after creation.'
    : 'The Deployment passes it on to its ReplicaSets (adding a pod-template-hash label to tell revisions apart). It is immutable after creation.',
  example: 'selector:\n  matchLabels:\n    app: web',
});

const labelSelector = (owner: 'ReplicaSet' | 'Deployment'): Field =>
  f(
    obj('LabelSelector', {
      matchLabels: f(map('matchLabels'), {
        summary: 'Labels a Pod must carry (all of them) to be selected.',
        why: 'This is the link between the controller and its Pods.',
        values: 'A map of label keys to values.',
        how: 'Every key/value here must appear in `spec.template.metadata.labels`, otherwise the API server rejects the manifest.',
        example: 'matchLabels:\n  app: web',
        details: 'Real Kubernetes also accepts `matchExpressions` next to it: rules with an operator (`In`, `NotIn`, `Exists`, `DoesNotExist`), such as `{key: tier, operator: In, values: [frontend, backend]}`. The Playground simulates `matchLabels` only.',
      }, true),
    }),
    selectorDoc(owner),
    true,
  );

const template = (owner: 'ReplicaSet' | 'Deployment'): Field =>
  f(
    obj('PodTemplateSpec', {
      metadata: f(
        obj('ObjectMeta', {
          labels: f(map('labels'), {
            ...labelsDoc,
            summary: 'Labels every Pod created from this template will carry.',
            why: `They must include the selector's matchLabels: that is how the ${owner} recognises the Pods it created.`,
          }, true),
          annotations: f(map('annotations'), { summary: 'Annotations given to every Pod created from the template.' }),
        }),
        {
          summary: 'Metadata for the Pods created from this template: mostly their labels.',
          why: 'Generated Pods get their names from the controller; what you choose here is how they are labelled.',
          example: 'metadata:\n  labels:\n    app: web',
        },
        true,
      ),
      spec: f(podSpec(true), {
        summary: 'The Pod spec each new Pod gets: the same fields as a Pod\'s `spec`.',
        why: 'This is the blueprint the controller stamps out.',
        example: 'spec:\n  containers:\n    - name: nginx\n      image: nginx:stable',
      }, true),
    }),
    {
      summary: `The blueprint for the Pods this ${owner} creates.`,
      why: 'When a Pod is missing, the controller needs to know exactly what to create.',
      values: 'A Pod template: `metadata` (labels) and `spec` (containers…), without apiVersion, kind or name.',
      how: owner === 'Deployment'
        ? 'Changing the template (e.g. the image) makes the Deployment create a new ReplicaSet and roll Pods over to it. Changing only `replicas` does not.'
        : 'Only used when creating new Pods: editing it does not change Pods that already exist.',
    },
    true,
  );

const replicas = (owner: 'ReplicaSet' | 'Deployment'): Field =>
  f({ type: 'integer', min: 0 }, {
    summary: 'The desired number of Pods.',
    why: 'This is desired state: you say how many, the controller makes it so and keeps it so.',
    values: 'Integer ≥ 0. Default 1.',
    how: owner === 'Deployment'
      ? 'The Deployment controller sets the replicas of its current ReplicaSet; the ReplicaSet controller then creates or deletes Pods until the count matches.'
      : 'The ReplicaSet controller compares it with the number of matching Pods and creates or deletes Pods until they agree.',
    example: 'replicas: 3',
  });

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

export const KIND_API_VERSION: Record<Kind, string> = {
  Pod: 'v1',
  Service: 'v1',
  ConfigMap: 'v1',
  PersistentVolumeClaim: 'v1',
  ReplicaSet: 'apps/v1',
  Deployment: 'apps/v1',
};

export const KINDS = Object.keys(KIND_API_VERSION) as Kind[];

export const SCHEMAS: Record<Kind, SchemaNode> = {
  Pod: obj('Pod', {
    apiVersion: apiVersion('v1', 'Pod'),
    kind: kindField('Pod', 'A Pod is the smallest deployable unit: one or more containers that run together on one Node.'),
    metadata: metadata('Pod'),
    spec: f(podSpec(false), {
      summary: 'The desired configuration of the Pod: which containers to run, and how.',
      why: 'The spec is what you want; Kubernetes works to make reality match it.',
      values: 'A PodSpec: `containers` (required), and optionally `volumes`, `restartPolicy`…',
      how: 'The scheduler reads it to pick a Node, then that Node\'s kubelet starts the containers it lists.',
      example: 'spec:\n  containers:\n    - name: nginx\n      image: nginx:stable',
    }, true),
  }),
  ReplicaSet: obj('ReplicaSet', {
    apiVersion: apiVersion('apps/v1', 'ReplicaSet'),
    kind: kindField('ReplicaSet', 'A ReplicaSet keeps a fixed number of identical Pods running.'),
    metadata: metadata('ReplicaSet'),
    spec: f(obj('ReplicaSetSpec', { replicas: replicas('ReplicaSet'), selector: labelSelector('ReplicaSet'), template: template('ReplicaSet') }), {
      summary: 'Desired state of the ReplicaSet: how many Pods, which ones count, and how to make new ones.',
      why: 'Without a spec, the controller would not know what to maintain.',
      values: '`replicas`, `selector` and `template`.',
    }, true),
  }),
  Deployment: obj('Deployment', {
    apiVersion: apiVersion('apps/v1', 'Deployment'),
    kind: kindField('Deployment', 'A Deployment manages ReplicaSets to run, scale and update a stateless application.'),
    metadata: metadata('Deployment'),
    spec: f(
      obj('DeploymentSpec', {
        replicas: replicas('Deployment'),
        selector: labelSelector('Deployment'),
        template: template('Deployment'),
        strategy: f(
          obj('DeploymentStrategy', {
            type: f({ type: 'string', enum: ['RollingUpdate', 'Recreate'] }, {
              summary: 'How Pods are replaced when the template changes.',
              values: 'RollingUpdate (default: gradually, keeping the app available) or Recreate (stop all, then start new).',
            }),
          }),
          { summary: 'How the Deployment replaces old Pods with new ones when the template changes.' },
        ),
      }),
      {
        summary: 'Desired state of the Deployment: replicas, selector and the Pod template.',
        why: 'You describe the application once; the Deployment keeps it running and rolls out changes.',
        values: '`replicas`, `selector`, `template`, optionally `strategy`.',
        how: 'The Deployment controller creates a ReplicaSet per template version and scales them; ReplicaSets create the Pods.',
      },
      true,
    ),
  }),
  Service: obj('Service', {
    apiVersion: apiVersion('v1', 'Service'),
    kind: kindField('Service', 'A Service gives a stable name and IP address to a changing set of Pods.'),
    metadata: metadata('Service'),
    spec: f(
      obj('ServiceSpec', {
        type: f({ type: 'string', enum: ['ClusterIP', 'NodePort', 'LoadBalancer'] }, {
          summary: 'How the Service is exposed.',
          values: 'ClusterIP (default: a virtual IP reachable inside the cluster), NodePort (also a port on every Node), LoadBalancer (also an external load balancer, from a cloud provider).',
          how: 'ClusterIP is the base of every type: the others add ways in from outside.',
        }),
        selector: f(map('selector'), {
          summary: 'Labels that pick the Pods receiving this Service\'s traffic.',
          why: 'Pods come and go and change IP. The Service follows labels, so it always targets the current Pods.',
          values: 'A plain map of labels (no `matchLabels` here, unlike Deployments).',
          how: 'The endpoints controller lists Ready Pods carrying all these labels and records their IPs as the Service\'s endpoints.',
          example: 'selector:\n  app: web',
        }),
        ports: f(
          arr(
            obj('ServicePort', {
              name: f(str('dns-label'), { summary: 'A name for the port, required when there are several.' }),
              port: f({ type: 'integer', min: 1, max: 65535 }, {
                summary: 'The port the Service listens on (on its ClusterIP).',
                values: 'Integer 1-65535.',
                how: 'Clients connect to `<service-name>:<port>`.',
              }, true),
              targetPort: f(portRef, {
                summary: 'The port on the Pods that traffic is forwarded to.',
                why: 'The Service port and the application port can differ (e.g. Service 80 → container 8080).',
                values: 'A port number, or the name of a container port. Defaults to `port`.',
                how: 'kube-proxy forwards connections from the Service\'s port to this port on one of the endpoints.',
              }),
              protocol: f({ type: 'string', enum: ['TCP', 'UDP', 'SCTP'] }, { summary: 'Network protocol. Default TCP.' }),
              nodePort: f({ type: 'integer', min: 30000, max: 32767 }, { summary: 'For NodePort/LoadBalancer: the port opened on every Node (30000-32767).' }),
            }),
          ),
          {
            summary: 'The ports the Service exposes and where each one forwards.',
            values: 'A list of `port` (and usually `targetPort`).',
            example: 'ports:\n  - port: 80\n    targetPort: 80',
          },
          true,
        ),
      }),
      {
        summary: 'Desired state of the Service: which Pods, which ports.',
        values: '`selector`, `ports`, optionally `type`.',
      },
      true,
    ),
  }),
  ConfigMap: obj('ConfigMap', {
    apiVersion: apiVersion('v1', 'ConfigMap'),
    kind: kindField('ConfigMap', 'A ConfigMap stores non-secret configuration as key/value pairs.'),
    metadata: metadata('ConfigMap'),
    data: f(map('data'), {
      summary: 'The configuration itself: keys and their string values.',
      why: 'Keeping configuration out of the image lets the same image run in every environment.',
      values: 'A map of keys (letters, digits, "-", "_", ".") to strings. Quote numbers and booleans: `"8080"`, `"true"`.',
      how: 'Pods consume it as environment variables (`env.valueFrom`, `envFrom`) or as files (a `configMap` volume).',
      example: 'data:\n  GREETING: "Hello from a ConfigMap"\n  LOG_LEVEL: info',
    }),
  }),
  PersistentVolumeClaim: obj('PersistentVolumeClaim', {
    apiVersion: apiVersion('v1', 'PersistentVolumeClaim'),
    kind: kindField('PersistentVolumeClaim', 'A PersistentVolumeClaim is a request for storage that outlives Pods.'),
    metadata: metadata('PersistentVolumeClaim'),
    spec: f(
      obj('PersistentVolumeClaimSpec', {
        accessModes: f(arr({ type: 'string', enum: ['ReadWriteOnce', 'ReadOnlyMany', 'ReadWriteMany', 'ReadWriteOncePod'] }), {
          summary: 'How the volume can be mounted.',
          values: 'ReadWriteOnce (read-write by one Node), ReadOnlyMany, ReadWriteMany (read-write by many Nodes), ReadWriteOncePod.',
          how: 'Only volumes supporting the requested modes can be bound to the claim.',
          example: 'accessModes:\n  - ReadWriteOnce',
        }, true),
        resources: f(
          obj('VolumeResourceRequirements', {
            requests: f(obj('StorageRequest', { storage: f(str('storage'), { summary: 'How much storage is requested, e.g. `1Gi`.' }, true) }), {
              summary: 'The minimum storage the claim needs.',
            }, true),
          }),
          { summary: 'How much storage the claim requests.', example: 'resources:\n  requests:\n    storage: 1Gi' },
          true,
        ),
        storageClassName: f(str(), {
          summary: 'Which StorageClass (kind of storage) should provide the volume.',
          values: 'The name of a StorageClass. When omitted, the cluster\'s default class (here: `standard`).',
          how: 'The class\'s provisioner creates a PersistentVolume matching the claim, then binds them.',
        }),
      }),
      {
        summary: 'What storage is requested: size, access modes and class.',
        how: 'A provisioner creates a matching PersistentVolume and binds it to the claim; Pods then mount the claim by name.',
      },
      true,
    ),
  }),
};

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export interface FieldLookup {
  /** Dotted path without list indexes, e.g. `spec.template.spec.containers.image`. */
  path: string;
  key: string;
  field: Field;
  /** The schema type the field belongs to, e.g. `Container`. */
  parentType: string;
}

const typeLabel = (node: SchemaNode): string => {
  switch (node.type) {
    case 'object':
      return node.name;
    case 'array':
      return `[]${typeLabel(node.items)}`;
    case 'map':
      return 'map[string]string';
    case 'int-or-string':
      return 'IntOrString';
    case 'free':
      return node.name;
    default:
      return node.type;
  }
};

export const describeType = typeLabel;

/** The field at a document path (list indexes are skipped), in the context of the given kind. */
export const lookupField = (kind: Kind, path: readonly (string | number)[]): FieldLookup | null => {
  let node: SchemaNode = SCHEMAS[kind];
  let found: FieldLookup | null = null;
  const names: string[] = [];
  for (const seg of path) {
    while (node.type === 'array') node = node.items;
    if (typeof seg === 'number') continue;
    if (node.type !== 'object') return null;
    const field: Field | undefined = node.fields[seg];
    if (!field) return null;
    names.push(seg);
    found = { path: names.join('.'), key: seg, field, parentType: node.name };
    node = field.node;
  }
  return found;
}

/** The kind whose schema a manifest's `kind` value names, if supported. */
export const asKind = (value: unknown): Kind | null => (KINDS as string[]).includes(value as string) ? (value as Kind) : null;

/** `kubectl explain` style lookup: "pod.spec.containers" → field. */
export const explainPath = (input: string): { kind: Kind; lookup: FieldLookup | null; node: SchemaNode } | null => {
  const [head, ...rest] = input.split('.');
  const kind = kindFromResource(head ?? '');
  if (!kind) return null;
  if (rest.length === 0) return { kind, lookup: null, node: SCHEMAS[kind] };
  const lookup = lookupField(kind, rest);
  return lookup ? { kind, lookup, node: lookup.field.node } : null;
};

const RESOURCE_ALIASES: Record<string, Kind> = {
  pod: 'Pod',
  pods: 'Pod',
  po: 'Pod',
  replicaset: 'ReplicaSet',
  replicasets: 'ReplicaSet',
  rs: 'ReplicaSet',
  deployment: 'Deployment',
  deployments: 'Deployment',
  deploy: 'Deployment',
  service: 'Service',
  services: 'Service',
  svc: 'Service',
  configmap: 'ConfigMap',
  configmaps: 'ConfigMap',
  cm: 'ConfigMap',
  persistentvolumeclaim: 'PersistentVolumeClaim',
  persistentvolumeclaims: 'PersistentVolumeClaim',
  pvc: 'PersistentVolumeClaim',
};

export const kindFromResource = (resource: string): Kind | null => RESOURCE_ALIASES[resource.toLowerCase()] ?? null;
