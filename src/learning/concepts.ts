import type { Concept } from './types';

/** Glossary for the Learn mode. Short and technically precise. */
export const CONCEPTS: readonly Concept[] = [
  {
    id: 'cluster',
    title: 'A cluster is born',
    summary:
      'A Kubernetes cluster is a group of machines that work together to run containerized applications. It starts with a control plane, which keeps track of what should be running.',
    details: [
      'Creating it with one click is a simplification. Real clusters are bootstrapped with tools such as kubeadm, or created by a cloud provider.',
    ],
  },
  {
    id: 'control-plane',
    title: 'Control plane',
    summary:
      'The control plane coordinates the cluster: it records what you asked for, decides where work should go, and keeps checking that reality matches. It is a team of cooperating components, not a single Pod or an all-powerful machine.',
    details: [
      'The structures on this island are those components. You will meet each one in Lesson 3.',
      'Here the control plane runs on its own Node, a common setup. Managed services often run it out of sight.',
    ],
  },
  {
    id: 'node',
    title: 'Node',
    summary:
      'A Node is a machine — physical or virtual — that joins the cluster and contributes its CPU and memory. This one has the worker role: it provides capacity for running applications.',
    details: [
      'A worker Node is not empty: it runs system software of its own, such as the kubelet agent and a container runtime.',
      'The thread from the Node to the control plane shows its kubelet registering and staying in touch. It is not application traffic.',
    ],
  },
  {
    id: 'many-machines',
    title: 'Why several machines?',
    summary:
      'More machines mean more total capacity, and the cluster can keep running work if one machine fails. The control plane coordinates them as one system.',
    details: [
      'Coordination does not mean everything flows through the control plane: applications talk to each other directly across Nodes.',
    ],
  },
  {
    id: 'node-roles',
    title: 'Roles, not species',
    summary:
      'The control plane coordinates; worker Nodes provide execution capacity. These are functional roles: the machines can be identical, and in a small cluster one machine can play both.',
    details: ['A Node is labelled with its role, for example node-role.kubernetes.io/control-plane.'],
  },
  {
    id: 'finite-capacity',
    title: 'Capacity is finite',
    summary:
      'Each Node has a fixed amount of CPU and memory, and machines can differ in size. The cluster’s total capacity is the sum of its Nodes.',
    details: ['How applications reserve and share that capacity is covered in a later lesson on resources and scheduling.'],
  },

  // Lesson 2 — Meet Your First Pod
  {
    id: 'container',
    title: 'A container',
    summary:
      'A container packages an application with everything it needs — its code, a runtime, libraries — and runs it as an isolated process. It is not a virtual machine: containers share the operating-system kernel of the machine they run on.',
    details: [
      'A container starts from an image, here kubeverse/hello-web:1.0. The slices you saw are the image’s layers.',
      'On each Node, a container runtime such as containerd actually starts containers. Who asks it to, and when, is Lesson 3.',
    ],
  },
  {
    id: 'pod',
    title: 'Your first Pod',
    summary:
      'Kubernetes never runs a bare container: it runs Pods. A Pod is the smallest deployable unit — a wrapper around one or more containers that are always placed together, on the same Node.',
    details: [
      'Kubernetes placed hello-web on worker-2, a Node with room for it. How that decision is made, and by whom, is Lesson 3.',
      'One click created it here. Normally you describe the Pod in a manifest and send it to the cluster — see the Manifest tab of its panel.',
    ],
  },
  {
    id: 'pod-identity',
    title: 'A Pod has an identity',
    summary:
      'Every Pod has a name, lives in a namespace, is bound to one Node, lists its containers and reports a status. You created this one directly, so no controller looks after it.',
    details: [
      'A Pod’s name is unique within its namespace. Namespaces are Lesson 7.',
      'If a Pod nobody manages disappears, nothing recreates it. Controllers that do are Lesson 4.',
    ],
  },
  {
    id: 'inside-a-pod',
    title: 'Inside the Pod',
    summary:
      'The bubble is the Pod: the environment around its containers. Its floor is the Pod’s network namespace — one IP address for everything inside. The box standing on it is the container that runs your application.',
    details: ['The Pod itself runs no code. Its containers do.'],
  },
  {
    id: 'pod-vs-container',
    title: 'Pod vs container',
    summary:
      'The container runs the application process, started from its image, with its own filesystem. The Pod gives it a place to run: a Node, an IP address and a lifecycle that Kubernetes tracks.',
    details: ['Kubernetes schedules, starts and reports on Pods. Containers are what actually execute inside them.'],
  },
  {
    id: 'multi-container',
    title: 'One Pod, two containers',
    summary:
      'A Pod can hold several containers that must work closely together. Here a web server runs beside a small helper that ships its logs. They are placed together on the same Node and share the Pod’s network.',
    details: [
      'Keep this for tightly coupled helpers. Independent parts of an application belong in separate Pods, so they can be placed and scaled separately.',
    ],
  },
  {
    id: 'shared-network',
    title: 'What a Pod shares',
    summary:
      'Containers in one Pod share its network namespace: the same IP and port space, so they reach each other on localhost. Files are not shared automatically — only through a volume the Pod declares and each container mounts.',
    details: [
      'Here both containers mount the volume logs (an emptyDir), so the helper can read what the web server writes.',
      'Two separate Pods would each get their own IP, could land on different Nodes, and would talk over the cluster network instead of localhost.',
    ],
  },
  {
    id: 'pod-phases',
    title: 'Pending, then Running',
    summary:
      'A Pod’s phase summarises where it is in its life. Pending: the cluster accepted it, but its containers are not running yet — it may be waiting for a Node or for its image. Running: it is bound to a Node and at least one container is running.',
    details: ['In a real cluster these steps happen on their own, usually within seconds. The lab lets you step through them.'],
  },
  {
    id: 'pod-succeeded',
    title: 'Succeeded',
    summary:
      'When every container of a Pod has exited successfully and none will be restarted, the Pod is Succeeded. That is the normal end of a one-off task whose restartPolicy is Never or OnFailure.',
    details: ['A finished Pod stays in the cluster until someone deletes it, so its status and logs can still be read.'],
  },
  {
    id: 'pod-failed',
    title: 'Failed',
    summary:
      'When every container has stopped, at least one of them failed, and none will be restarted, the Pod is Failed. broken-once exited with code 1 and its restartPolicy is Never.',
    details: [
      'A crashing container does not always mean a Failed Pod. With restartPolicy: Always — the default — the container is restarted and the Pod stays Running. Restarts are Lesson 5.',
      'There is one more phase, Unknown: the Pod’s state cannot be obtained, usually because its Node stopped reporting.',
    ],
  },
  {
    id: 'phase-vs-state',
    title: 'Phase vs container state',
    summary:
      'The Pod has one phase: Pending, Running, Succeeded, Failed or Unknown. Each container has its own state: Waiting, Running or Terminated, with a reason and an exit code. The phase is a Pod-level summary of its containers’ states.',
    details: ['Here the container is Terminated (reason Error, exit code 1), so the Pod’s phase is Failed.'],
  },
  // Lesson 3
  {
    id: 'pod-request',
    title: 'A request, not a command',
    summary:
      'kubectl apply sends your Pod definition to the Kubernetes API. It describes what you want; it does not start anything by itself, and it does not guarantee that the Pod will run.',
    details: [
      'Here the request is simulated: no real cluster is contacted.',
      'apiVersion and kind say which API object this is; metadata names it; spec describes the desired Pod.',
    ],
  },
  {
    id: 'api-server',
    title: 'The API server',
    summary:
      'kube-apiserver is the entry point to the Kubernetes API. kubectl, the scheduler and every kubelet read and write cluster state through it. It processes API requests — it never runs containers.',
    details: [
      'It is the only component that talks to etcd. The others watch the API server for changes that concern them.',
    ],
  },
  {
    id: 'api-processing',
    title: 'Checked before stored',
    summary:
      'Before anything is stored, the request is authenticated (who are you?), authorized (may you do this?), passed through admission control (may policies adjust or refuse it?) and validated (is it a well-formed Pod?).',
    details: [
      'Each step can refuse the request — a malformed name, for example, never gets stored.',
      'Authentication, authorization (RBAC) and admission are covered in later lessons. Here they simply let you through.',
    ],
  },
  {
    id: 'etcd',
    title: 'etcd: the cluster’s memory',
    summary:
      'etcd is a consistent key-value store that holds the cluster’s state. Your Pod is now an object in it: its spec is what you want; its status is what has been observed so far — Pending, with no Node.',
    details: [
      'Storing a Pod object does not run anything. No container exists yet.',
      'The API server added defaults (restartPolicy, serviceAccountName…) and identity (uid, creationTimestamp) to what you sent.',
      'etcd only stores. It never schedules or launches anything.',
    ],
  },
  {
    id: 'scheduler',
    title: 'The scheduler watches',
    summary:
      'kube-scheduler watches the API server for Pods that have no Node yet (no spec.nodeName). Nobody calls it: it notices the new Pod by itself.',
    details: ['Kubernetes is asynchronous: components watch API state and react to the changes that concern them.'],
  },
  {
    id: 'node-eligibility',
    title: 'Which Node fits?',
    summary:
      'A Node is eligible if its free capacity covers what the Pod requests. Free means allocatable minus what the Pods already on it request — not the machine’s total size.',
    details: ['worker-2 is the bigger machine, but data-cruncher already requests 7 of its CPUs.'],
  },
  {
    id: 'filter-score',
    title: 'Filter, then score',
    summary:
      'Real scheduling runs in two phases: filtering removes Nodes that cannot run the Pod; scoring ranks the rest. Here a single simplified rule stands in for both.',
    details: [
      'Real filters include resources, taints and tolerations, affinity, volume topology and more. Lesson 8 goes deeper.',
    ],
  },
  {
    id: 'binding',
    title: 'Bound, not running',
    summary:
      'The scheduler records its decision as a Binding through the API server, which sets the Pod’s spec.nodeName. The Pod is now scheduled — but still Pending. The scheduler never starts containers.',
    details: ['The Pod’s PodScheduled condition is now True. Its containers do not exist yet.'],
  },
  {
    id: 'kubelet',
    title: 'The kubelet',
    summary:
      'The kubelet is the agent on each Node. It watches the API server for Pods bound to its own Node and makes them real. It is not the container runtime: it decides and supervises; the runtime executes.',
    details: [
      'The kubelet on the other worker sees the same API, but ignores Pods bound elsewhere.',
      'On the control-plane Node, a kubelet also runs the control-plane components as static Pods, from files in /etc/kubernetes/manifests (kubeadm-style clusters).',
    ],
  },
  {
    id: 'kubelet-sync',
    title: 'The kubelet takes over',
    summary:
      'Seeing a Pod bound to its Node, the kubelet asks the container runtime, through CRI, to prepare it: create the Pod sandbox, pull the image, create the container. Meanwhile the Pod stays Pending and its container is Waiting (ContainerCreating).',
    details: ['Preparing the sandbox includes giving the Pod its network. How that works (CNI) is Lesson 6.'],
  },
  {
    id: 'container-runtime',
    title: 'The container runtime',
    summary:
      'The container runtime (here containerd) pulls images and creates and runs containers. The kubelet talks to it through CRI, the Container Runtime Interface.',
    details: [
      'CRI calls include RunPodSandbox, PullImage, CreateContainer and StartContainer.',
      'Setting up the Pod’s network is part of preparing the sandbox. How that works (CNI) is Lesson 6.',
    ],
  },
  {
    id: 'pod-comes-alive',
    title: 'Alive on its Node',
    summary:
      'Asked through CRI, the runtime started the container. The kubelet then reported the Pod’s status through the API server: Running.',
    details: ['While the runtime was creating the container, the Pod was Pending with its container Waiting (ContainerCreating).'],
  },
  {
    id: 'phase-and-conditions',
    title: 'Phase, conditions, container state',
    summary:
      'The Pod’s phase is a summary (Running). Its conditions record milestones: PodScheduled, Initialized, ContainersReady, Ready. Each container has its own state (Running). Scheduled is not Running; Running is not guaranteed.',
    details: ['An image that cannot be pulled, for example, would leave the Pod Pending with its container Waiting.'],
  },
  {
    id: 'async-journey',
    title: 'An API-driven journey',
    summary:
      'No component handed the Pod to the next. Each one watched the API server, acted on what concerned it, and wrote its result back through the API. That is how a standalone Pod is born — on the simplified successful path.',
    details: [
      'Many things can happen differently: a rejected request, no Node that fits, an image that cannot be pulled, a container that crashes.',
      'Controllers such as Deployments create Pods the same way. That is Lesson 4.',
    ],
  },

  // Lesson 4 — A World That Maintains Itself
  {
    id: 'standalone-deletion',
    title: 'Deleted is gone',
    summary:
      'kubectl delete asked the API server to remove the Pod object. Its kubelet stopped the container, and the Pod disappeared from the API. Nothing brought it back.',
    details: [
      'This is not a crash. When a container crashes, the kubelet restarts it inside the same Pod (restartPolicy); the Pod object stays.',
      'Deleting the Pod removes the object itself: there is nothing left for the kubelet to restart.',
    ],
  },
  {
    id: 'no-owner',
    title: 'Nobody was responsible for it',
    summary:
      'The controller manager runs many control loops, but none of them owned my-pod: it had no ownerReferences. A standalone Pod lives once. What if you could tell Kubernetes how many Pods you always want?',
    details: [
      'The controllers are loops inside the kube-controller-manager process. They are not Pods.',
      'Each loop watches certain objects through the API server and acts to make what exists match what was asked for.',
    ],
  },
  {
    id: 'deployment',
    title: 'A Deployment: what you want, kept',
    summary:
      'A Deployment stores your desired state: a Pod template and a number of replicas. It is an API object, not a Pod — the Deployment controller acts on it.',
    details: [
      'spec.selector says which Pods belong to it; the template’s labels must match it.',
      'The Deployment controller does not create Pods. It creates a ReplicaSet, and lets the ReplicaSet create the Pods.',
    ],
  },
  {
    id: 'replicaset',
    title: 'The ReplicaSet keeps the count',
    summary:
      'The ReplicaSet’s job is a number: keep exactly spec.replicas Pods matching its selector. When there are too few it creates Pod objects through the API server; too many, it deletes some.',
    details: [
      'It creates Pod objects only. The scheduler still picks a Node and the kubelet still starts the containers — the path you followed in Lesson 3.',
      'Its name ends with the pod-template-hash: one Pod template, one ReplicaSet.',
    ],
  },
  {
    id: 'owner-references',
    title: 'Who owns whom',
    summary:
      'Each Pod’s metadata.ownerReferences names its ReplicaSet, and the ReplicaSet names its Deployment: Deployment → ReplicaSet → Pods. That chain is how Kubernetes knows who is responsible for each Pod.',
    details: [
      'Only one owner per object is the managing controller (controller: true).',
      'Deleting a Deployment deletes its ReplicaSets and their Pods through this chain (garbage collection).',
    ],
  },
  {
    id: 'desired-vs-actual',
    title: 'Desired 3, actual 2',
    summary:
      'You deleted one Pod. The desired state did not change — still 3 — but the actual state dropped to 2. That difference is what the ReplicaSet controller watches for.',
    details: [
      'Counting the Pods that exist is not counting the Pods that are Ready. A brand-new Pod exists long before it is Ready.',
    ],
  },
  {
    id: 'reconciliation',
    title: 'Reconciliation',
    summary:
      'The ReplicaSet controller saw 2 where 3 were wanted and created a new Pod object — a new name, a new identity. The deleted Pod was not revived. The scheduler and a kubelet then brought the new one to life.',
    details: [
      'Observe the actual state, compare it with the desired state, act, repeat: every controller is such a loop.',
      'It takes several steps and some time: the replacement is Pending before it is Running and Ready.',
    ],
  },
  {
    id: 'scaling',
    title: 'Scaling changes the desired count',
    summary:
      'kubectl scale changed one field: spec.replicas. The Deployment controller passed the new number to the same ReplicaSet, which created the missing Pods.',
    details: [
      'The Pod template did not change, so no new ReplicaSet and no new revision were created.',
      'Here you scale by hand. Scaling automatically on load (HorizontalPodAutoscaler) is a later topic.',
    ],
  },
  {
    id: 'desired-not-guaranteed',
    title: 'Wanted is not guaranteed',
    summary:
      'The ReplicaSet created 5 Pod objects, but the scheduler found no Node with room for two of them: they stay Pending. Desired 5, Ready 3. Controllers ask; they cannot create capacity.',
    details: [
      'The scheduler keeps retrying: if room appears, the Pending Pods are scheduled.',
      'Each web Pod requests 1 CPU. worker-2 has only 0.8 CPU left; worker-1 fits three.',
    ],
  },
  {
    id: 'scale-down',
    title: 'Scaling down',
    summary:
      'With fewer replicas wanted, the ReplicaSet deleted Pods — the ones that cost least first: Pods without a Node, then Pods not yet Ready, then the newest.',
    details: ['Deleted Pods first become Terminating: their containers are stopped before the objects disappear.'],
  },
  {
    id: 'new-replicaset',
    title: 'A new template, a new ReplicaSet',
    summary:
      'Changing the image changed the Pod template. The Deployment controller created a second ReplicaSet for it — revision 2 — while the first one still owns the old Pods.',
    details: [
      'Old and new ReplicaSets are distinct objects with different pod-template-hash labels.',
      'Changing only the replica count never does this: scaling keeps the same ReplicaSet.',
    ],
  },
  {
    id: 'rolling-update',
    title: 'A rolling update',
    summary:
      'The Deployment controller scaled the new ReplicaSet up and the old one down, a step at a time, within maxSurge (extra Pods allowed) and maxUnavailable (Pods allowed missing). The old ReplicaSet stays at 0 replicas, kept as history.',
    details: [
      'Each step waited for new Pods to become Ready, and needed room on a Node for the extra Pod.',
      'With 2 replicas, the 25% defaults give maxSurge 1 (rounded up) and maxUnavailable 0 (rounded down): never more than 3 Pods, never fewer than 2 available.',
      'This keeps Pods available during the update; it does not by itself guarantee zero downtime for clients.',
      'kubectl rollout undo would make the old template current again, reusing that ReplicaSet as a new revision.',
    ],
  },
];

const byId = new Map(CONCEPTS.map((c) => [c.id, c]));

export const conceptIds: ReadonlySet<string> = new Set(byId.keys());

export const findConcept = (id: string): Concept | undefined => byId.get(id);
