import { DEPLOYMENT_DEFAULTS, MAINTAINED_CLUSTER_WORLD, REQUEST_POD_UID } from '../sandbox';
import type { Lesson } from '../types';
import type { ScenePresentation } from '../../state/presentation';

const PRESENTATION: ScenePresentation = {
  controlPlane: 'area',
  inspector: 'essentials',
  anatomy: 'essentials',
  linkPulses: false,
  animateEntries: true,
  revealed: ['kube-apiserver', 'etcd', 'kube-scheduler', 'kube-controller-manager', 'kubelet', 'container-runtime'],
};

/**
 * Lesson 4. A standalone Pod is deleted for good; a Deployment then keeps a
 * number of Pods alive through its ReplicaSet. The control loops run on their
 * own, one deterministic pass at a time; the learner deletes, scales, updates
 * and inspects, and objectives follow those actions.
 */
export const desiredState: Lesson = {
  id: 'desired-state',
  number: 4,
  title: 'A World That Maintains Itself',
  intro: {
    title: 'Your Pod runs. But what happens when it disappears?',
    text: 'In Lesson 3 you created my-pod directly. This time you will delete it, then let Kubernetes keep Pods alive for you: describe what you want once, and watch controllers make the cluster match it — again and again.',
  },
  summary:
    'You’ve seen desired state at work: a Deployment owns ReplicaSets, ReplicaSets keep Pods at the count you asked for, and a new template rolls out step by step.',
  goals: [
    'Desired state versus actual state',
    'Why a standalone Pod is not enough',
    'How a Deployment manages ReplicaSets, and ReplicaSets manage Pods',
    'How reconciliation, scaling and a rolling update work',
  ],
  initialWorld: MAINTAINED_CLUSTER_WORLD,
  initialScenario: { view: { kind: 'node', nodeName: 'worker-1' }, selection: null },
  presentation: PRESENTATION,
  buildActions: {
    'delete-standalone-pod': { limit: 1 },
    'run-controllers': {},
    'create-deployment': { requires: ['inspect-controller-manager'], limit: 1 },
    'delete-replicaset-pod': { requires: ['owner-chain'] },
    'scale-deployment': { requires: ['observe-reconciliation'] },
    'update-pod-template': { requires: ['scale-down'] },
  },
  objectives: [
    {
      id: 'delete-standalone',
      title: 'Delete your Pod',
      instruction: 'my-pod, your Pod from Lesson 3, runs on worker-1. Delete it, then watch what happens.',
      condition: { type: 'action', action: 'STANDALONE_POD_DELETED' },
      discovers: 'standalone-deletion',
      hints: ['Use the button here, or the one in my-pod’s panel.'],
      highlight: { kind: 'pod', podId: REQUEST_POD_UID },
      actions: ['delete-standalone-pod'],
    },
    {
      id: 'inspect-controller-manager',
      title: 'Is anyone watching?',
      instruction: 'my-pod is gone and nothing brings it back. Click the controller manager to see why.',
      requires: ['delete-standalone'],
      condition: { type: 'action', action: 'CONTROLLER_MANAGER_INSPECTED' },
      discovers: 'no-owner',
      hints: ['It is the structure at the back of the control plane, behind the API server.'],
      highlight: { kind: 'component', component: 'kube-controller-manager' },
    },
    {
      id: 'create-deployment',
      title: 'Ask for three, always',
      instruction: `Describe what you want instead of creating Pods yourself: a Deployment with ${DEPLOYMENT_DEFAULTS.replicas} replicas. Then apply it.`,
      requires: ['inspect-controller-manager'],
      condition: { type: 'action', action: 'DEPLOYMENT_CREATED' },
      discovers: 'deployment',
      hints: ['Use the Deployment definition at the bottom of the screen.'],
    },
    {
      id: 'inspect-replicaset',
      title: 'Who made the Pods?',
      instruction: 'Your Deployment did not create the Pods itself. Click the ReplicaSet it created.',
      requires: ['create-deployment'],
      condition: { type: 'action', action: 'REPLICASET_INSPECTED' },
      discovers: 'replicaset',
      hints: ['Controllers float beside the control plane: the ReplicaSet is the ring below the Deployment.'],
      highlight: { kind: 'workload', workloadKind: 'ReplicaSet' },
    },
    {
      id: 'owner-chain',
      title: 'Follow the chain',
      instruction: 'Click one of the web Pods and follow its owner, from the Pod up to its ReplicaSet.',
      requires: ['inspect-replicaset'],
      condition: { type: 'action', action: 'POD_OWNER_CHAIN_EXPLORED' },
      discovers: 'owner-references',
      hints: ['In a web Pod’s panel, under “Managed by”, click its ReplicaSet.'],
    },
    {
      id: 'delete-managed-pod',
      title: 'Take one away',
      instruction: 'Delete one of the web Pods, and keep an eye on the desired and current counts.',
      requires: ['owner-chain'],
      condition: { type: 'action', action: 'REPLICASET_POD_DELETED' },
      discovers: 'desired-vs-actual',
      hints: ['Use the button here, or the one in a web Pod’s panel.'],
      actions: ['delete-replicaset-pod'],
    },
    {
      id: 'observe-reconciliation',
      title: 'Watch it come back — differently',
      instruction:
        'The ReplicaSet notices the gap and creates a replacement. When it is Running, click it and compare its name with the Pod you deleted.',
      requires: ['delete-managed-pod'],
      condition: { type: 'action', action: 'RECONCILIATION_OBSERVED' },
      discovers: 'reconciliation',
      hints: [
        'Follow the events in the controllers panel: created, scheduled, started.',
        'The replacement is marked “new” in the ReplicaSet’s panel.',
      ],
      feedback: [
        {
          action: 'POD_RUNNING_OBSERVED',
          message: 'This Pod was already there before you deleted one. Look for the newly created Pod — it has a name you have not seen yet.',
        },
      ],
    },
    {
      id: 'scale-up',
      title: 'Want more',
      instruction: 'Change the desired state: scale the Deployment from 3 to 5 replicas.',
      requires: ['observe-reconciliation'],
      condition: { type: 'action', action: 'DEPLOYMENT_SCALED', where: { replicas: 5 } },
      discovers: 'scaling',
      hints: ['Use the replica control in the controllers panel.'],
      feedback: [{ action: 'DEPLOYMENT_SCALED', message: 'The desired state changed — now try exactly 5 replicas.' }],
    },
    {
      id: 'inspect-pending',
      title: 'Not everything fits',
      instruction: 'Desired is 5, but not all of them become Ready. Click a Pod that stays Pending and find out why.',
      requires: ['scale-up'],
      condition: { type: 'action', action: 'UNSCHEDULABLE_POD_INSPECTED' },
      discovers: 'desired-not-guaranteed',
      hints: ['Pods without a Node wait under their ReplicaSet, beside the control plane.'],
      highlight: { kind: 'workload', workloadKind: 'ReplicaSet' },
    },
    {
      id: 'scale-down',
      title: 'Want fewer',
      instruction: 'Scale the Deployment down to 2 replicas and see which Pods the ReplicaSet removes first.',
      requires: ['inspect-pending'],
      condition: { type: 'action', action: 'DEPLOYMENT_SCALED', where: { replicas: 2 } },
      discovers: 'scale-down',
      hints: ['Use the replica control in the controllers panel.'],
      feedback: [{ action: 'DEPLOYMENT_SCALED', message: 'The desired state changed — now try exactly 2 replicas.' }],
    },
    {
      id: 'update-template',
      title: 'Ship version 2',
      instruction: 'Change the Pod template: update the image to kubeverse/web:2.0.',
      requires: ['scale-down'],
      condition: { type: 'action', action: 'POD_TEMPLATE_UPDATED', where: { image: 'kubeverse/web:2.0' } },
      discovers: 'new-replicaset',
      hints: ['Use the image control in the controllers panel, or the button here.'],
      actions: ['update-pod-template'],
    },
    {
      id: 'observe-rollout',
      title: 'What stays behind',
      instruction:
        'Watch the rollout replace Pods step by step — pause it whenever you like. When it is finished, click the old ReplicaSet.',
      requires: ['update-template'],
      condition: { type: 'action', action: 'ROLLING_UPDATE_OBSERVED' },
      discovers: 'rolling-update',
      hints: [
        'The counters show old and updated Pods separately; the strategy line shows the limits.',
        'The old ReplicaSet is the dimmed ring, revision 1, once the rollout is complete.',
      ],
      highlight: { kind: 'workload', workloadKind: 'ReplicaSet' },
      feedback: [
        {
          action: 'REPLICASET_INSPECTED',
          message: 'Wait until the rollout is complete, then click the old ReplicaSet — the one at revision 1.',
        },
      ],
    },
  ],
};
