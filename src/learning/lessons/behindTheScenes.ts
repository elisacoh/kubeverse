import { BUSY_CLUSTER_WORLD, REQUEST_POD_UID } from '../sandbox';
import type { Lesson, LessonSession } from '../types';
import type { ScenePresentation } from '../../state/presentation';

/** Where the scenario's simplified scheduler sends the Pod: worker-2 is bigger, but busy. */
const TARGET = 'worker-1';

const PRESENTATION: ScenePresentation = {
  controlPlane: 'area',
  inspector: 'essentials',
  anatomy: 'essentials',
  linkPulses: false,
  animateEntries: true,
  revealed: [],
};

/** Each component becomes named and inspectable once the story reaches it. */
const REVEALS: readonly [string, ScenePresentation['revealed'][number]][] = [
  ['submit-request', 'kube-apiserver'],
  ['process-request', 'etcd'],
  ['inspect-etcd', 'kube-scheduler'],
  ['bind-pod', 'kubelet'],
  ['kubelet-sync', 'container-runtime'],
];

const presentationFor = (session: LessonSession): ScenePresentation => ({
  ...PRESENTATION,
  revealed: REVEALS.filter(([objective]) => session.progress.completed.includes(objective)).map(([, id]) => id),
});

/**
 * Lesson 3. The learner submits a standalone Pod through the (simulated) API
 * and follows each component acting on it: API server, etcd, scheduler,
 * kubelet and container runtime. Every step waits for the learner.
 */
export const behindTheScenes: Lesson = {
  id: 'behind-the-scenes',
  number: 3,
  title: 'Behind the Scenes',
  intro: {
    title: 'You know what a Pod is. But who actually brings it to life?',
    text: 'In Lesson 2 your Pod simply appeared. This time you will submit one through the Kubernetes API and follow it, component by component, until it runs. This is the simplified successful path: real clusters have more steps, and more ways to fail.',
  },
  summary: 'You’ve followed a Pod from a YAML definition to a running container — through the API server, etcd, the scheduler, the kubelet and the container runtime.',
  goals: [
    'What the API server, etcd and the scheduler each do — and do not do',
    'Why a stored or scheduled Pod is not yet running',
    'How the kubelet and the container runtime start containers, through CRI',
    'Why Kubernetes is asynchronous and API-driven',
  ],
  initialWorld: BUSY_CLUSTER_WORLD,
  initialScenario: { view: { kind: 'cluster' }, selection: null },
  presentation: PRESENTATION,
  presentationFor,
  buildActions: {
    'submit-pod-request': { limit: 1 },
    'process-request': { requires: ['inspect-api-server'] },
    'schedule-pod': { requires: ['evaluate-nodes', 'predict-node'] },
    'kubelet-prepare-pod': { requires: ['inspect-kubelet'] },
    'start-container': { requires: ['inspect-runtime'] },
  },
  objectives: [
    {
      id: 'submit-request',
      title: 'Submit your Pod',
      instruction:
        'Prepare a Pod definition: give it a name, pick an image, then send it with kubectl apply.',
      condition: { type: 'action', action: 'POD_REQUEST_SUBMITTED' },
      discovers: 'pod-request',
      hints: ['Use the Pod definition panel at the bottom of the screen.'],
    },
    {
      id: 'inspect-api-server',
      title: 'Meet the API server',
      instruction: 'Your request has arrived at the control plane. Click the API server to see who received it.',
      requires: ['submit-request'],
      condition: { type: 'action', action: 'API_SERVER_INSPECTED' },
      discovers: 'api-server',
      hints: ['It is the tall gateway tower at the centre of the control plane, with your request waiting at its door.'],
      highlight: { kind: 'component', component: 'kube-apiserver' },
    },
    {
      id: 'process-request',
      title: 'Process the request',
      instruction: 'Let the API server check your request before anything is stored.',
      requires: ['inspect-api-server'],
      condition: { type: 'action', action: 'REQUEST_PROCESSED', where: { outcome: 'accepted' } },
      discovers: 'api-processing',
      hints: ['Use the button here, or in the API server’s panel.'],
      actions: ['process-request'],
      feedback: [
        {
          action: 'REQUEST_PROCESSED',
          where: { outcome: 'rejected' },
          message:
            'The API server rejected your request: the Pod name is not valid, so nothing was stored. Fix the name in the Pod definition and apply it again.',
        },
      ],
    },
    {
      id: 'inspect-etcd',
      title: 'Where is it stored?',
      instruction: 'The API server stored your Pod in etcd. Click etcd and compare what is stored with what you sent.',
      requires: ['process-request'],
      condition: { type: 'action', action: 'ETCD_STATE_INSPECTED' },
      discovers: 'etcd',
      hints: ['etcd is the stack of glowing discs on the left of the control plane.'],
      highlight: { kind: 'component', component: 'etcd' },
    },
    {
      id: 'inspect-scheduler',
      title: 'Who picks a Node?',
      instruction: 'Your Pod has no Node yet. Click the scheduler, the component that watches for such Pods.',
      requires: ['inspect-etcd'],
      condition: { type: 'action', action: 'SCHEDULER_INSPECTED' },
      discovers: 'scheduler',
      hints: ['The scheduler is the astrolabe on the right of the control plane.'],
      highlight: { kind: 'component', component: 'kube-scheduler' },
    },
    {
      id: 'evaluate-nodes',
      title: 'Weigh the candidates',
      instruction: 'Click each worker Node and check whether it has room for what your Pod requests.',
      requires: ['inspect-scheduler'],
      condition: { type: 'distinct', key: 'nodeId', count: 2, action: 'NODE_ELIGIBILITY_EVALUATED' },
      discovers: 'node-eligibility',
      hints: ['Compare each Node’s free CPU with the 1 CPU your Pod requests.'],
      highlight: { kind: 'node', role: 'worker' },
    },
    {
      id: 'predict-node',
      title: 'Predict the decision',
      instruction: 'In the scheduler’s panel, predict which Node it will choose.',
      requires: ['inspect-scheduler'],
      condition: { type: 'action', action: 'SCHEDULING_PREDICTED', where: { correct: true } },
      discovers: 'filter-score',
      hints: ['Free capacity matters, not the machine’s size.', 'data-cruncher already requests 7 CPUs on worker-2.'],
      highlight: { kind: 'component', component: 'kube-scheduler' },
      feedback: [
        {
          action: 'SCHEDULING_PREDICTED',
          where: { correct: false },
          message: 'Not this one: look at its free CPU, not its size. A Node fits only if what is left covers the Pod’s request.',
        },
      ],
    },
    {
      id: 'bind-pod',
      title: 'The scheduler decides',
      instruction: 'Let the scheduler choose, and watch how it records its decision.',
      requires: ['evaluate-nodes', 'predict-node'],
      condition: { type: 'action', action: 'POD_BOUND_TO_NODE' },
      discovers: 'binding',
      hints: ['Use the button above.'],
      actions: ['schedule-pod'],
    },
    {
      id: 'inspect-kubelet',
      title: 'Who acts on the Node?',
      instruction: `Your Pod is bound to ${TARGET}, but nothing runs there yet. Click the kubelet on ${TARGET}.`,
      requires: ['bind-pod'],
      condition: { type: 'action', action: 'KUBELET_INSPECTED', where: { nodeId: TARGET } },
      discovers: 'kubelet',
      hints: [`It is the small beacon on the far edge of ${TARGET}.`],
      highlight: { kind: 'agent', agent: 'kubelet', nodeId: TARGET },
      feedback: [
        {
          action: 'KUBELET_INSPECTED',
          message: `That kubelet runs on another Node. Your Pod is bound to ${TARGET}, so only ${TARGET}’s kubelet acts on it.`,
        },
      ],
    },
    {
      id: 'kubelet-sync',
      title: 'The kubelet takes over',
      instruction: 'The kubelet has noticed your Pod. Let it prepare the Pod.',
      requires: ['inspect-kubelet'],
      condition: { type: 'action', action: 'POD_SYNC_STARTED' },
      discovers: 'kubelet-sync',
      hints: ['Use the button above, or in the kubelet’s panel.'],
      actions: ['kubelet-prepare-pod'],
    },
    {
      id: 'inspect-runtime',
      title: 'Meet the runtime',
      instruction: `The kubelet does not run containers itself. Click the container runtime on ${TARGET}.`,
      requires: ['kubelet-sync'],
      condition: { type: 'action', action: 'CONTAINER_RUNTIME_INSPECTED', where: { nodeId: TARGET } },
      discovers: 'container-runtime',
      hints: ['It is the machine standing next to the kubelet.'],
      highlight: { kind: 'agent', agent: 'container-runtime', nodeId: TARGET },
    },
    {
      id: 'start-container',
      title: 'Bring it to life',
      instruction: 'Let the runtime start the container, as the kubelet asked.',
      requires: ['inspect-runtime'],
      condition: { type: 'action', action: 'CONTAINER_STARTED' },
      discovers: 'pod-comes-alive',
      hints: ['Use the button above, or in the runtime’s panel.'],
      actions: ['start-container'],
    },
    {
      id: 'observe-running',
      title: 'Check its status',
      instruction: 'Click your Pod and read its phase, its conditions and its container’s state.',
      requires: ['start-container'],
      condition: { type: 'action', action: 'POD_RUNNING_OBSERVED', where: { podId: REQUEST_POD_UID } },
      discovers: 'phase-and-conditions',
      hints: ['Click the creature that just came to life.'],
      highlight: { kind: 'pod', podId: REQUEST_POD_UID },
    },
    {
      id: 'explore-timeline',
      title: 'Follow the whole journey',
      instruction: 'Open three events in the timeline to replay what each component did.',
      requires: ['observe-running'],
      condition: { type: 'distinct', key: 'eventId', count: 3, action: 'EVENT_TIMELINE_EXPLORED' },
      discovers: 'async-journey',
      hints: ['The timeline is at the bottom of the screen. Click an event, or use the arrows.'],
    },
  ],
};
