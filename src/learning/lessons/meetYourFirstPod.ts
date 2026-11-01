import { FIRST_CLUSTER_WORLD, sandboxPodUid } from '../sandbox';
import type { Lesson } from '../types';

const HELLO = sandboxPodUid('hello-web');
const MULTI = sandboxPodUid('web-and-logger');
const BROKEN = sandboxPodUid('broken-once');

/**
 * Lesson 2. Starting from the cluster built in Lesson 1, the learner packs an
 * application into a container, wraps it in a Pod, looks inside, meets a
 * two-container Pod and steps through a Pod's lifecycle.
 */
export const meetYourFirstPod: Lesson = {
  id: 'meet-your-first-pod',
  number: 2,
  title: 'Meet Your First Pod',
  intro: {
    title: 'Let’s bring your first application to life.',
    text: 'Your cluster is ready: a control plane and two worker Nodes, waiting for work. An application has arrived. Where, and how, will it run?',
  },
  summary: 'You’ve discovered Kubernetes’ smallest deployable unit — the Pod.',
  goals: [
    'What a container is',
    'Why Kubernetes runs Pods rather than bare containers',
    'What containers in one Pod share',
    'How a Pod’s phase differs from its containers’ states',
  ],
  initialWorld: FIRST_CLUSTER_WORLD,
  initialScenario: { view: { kind: 'cluster' }, selection: null },
  presentation: {
    controlPlane: 'area',
    inspector: 'essentials',
    anatomy: 'essentials',
    linkPulses: false,
    animateEntries: true,
    revealed: [],
  },
  buildActions: {
    'open-container': {},
    'create-pod': { requires: ['open-container'] },
    'open-multi-container-example': { requires: ['inspect-app-container'] },
    'advance-lab-success': { requires: ['inspect-both-containers'] },
    'advance-lab-failure': { requires: ['lab-succeeded'] },
  },
  objectives: [
    {
      id: 'open-container',
      title: 'Meet your application',
      instruction: 'Your application is packed in a container, floating between your Nodes. Click it to look inside.',
      condition: { type: 'action', action: 'CONTAINER_OPENED' },
      discovers: 'container',
      hints: ['It is the glowing crate between the two worker Nodes.'],
      highlight: { kind: 'build-site', action: 'open-container' },
    },
    {
      id: 'create-pod',
      title: 'Give it a Pod',
      instruction: 'Kubernetes does not run a container on its own: it wraps it in a Pod. Wrap your container in a Pod.',
      requires: ['open-container'],
      condition: { type: 'action', action: 'POD_CREATED' },
      discovers: 'pod',
      hints: ['Click the opened container again, or its “Wrap it in a Pod” label.'],
      highlight: { kind: 'build-site', action: 'create-pod' },
      actions: ['create-pod'],
    },
    {
      id: 'select-pod',
      title: 'Say hello',
      instruction: 'Your Pod has arrived on a worker Node. Click it to find out who it is.',
      requires: ['create-pod'],
      condition: { type: 'action', action: 'ENTITY_SELECTED', where: { entityKind: 'pod', entityId: HELLO } },
      discovers: 'pod-identity',
      hints: ['Click the little creature that just appeared.'],
      highlight: { kind: 'pod', podId: HELLO },
      feedback: [
        {
          action: 'ENTITY_SELECTED',
          where: { entityKind: 'worker-node' },
          message: 'That is a worker Node — the machine your Pod runs on. Click the Pod itself.',
        },
      ],
    },
    {
      id: 'enter-pod',
      title: 'Step inside',
      instruction: 'Use “Explore inside” on your Pod to see what it is made of.',
      requires: ['select-pod'],
      condition: { type: 'action', action: 'POD_ANATOMY_ENTERED', where: { podId: HELLO } },
      discovers: 'inside-a-pod',
      hints: ['In the Pod’s panel, press “Explore inside”. Double-clicking the Pod works too.'],
      highlight: { kind: 'pod', podId: HELLO },
    },
    {
      id: 'inspect-app-container',
      title: 'Find the application',
      instruction: 'Inside the Pod, select the container that runs your application.',
      requires: ['enter-pod'],
      condition: {
        type: 'action',
        action: 'CONTAINER_INSPECTED',
        where: { podId: HELLO, containerRole: 'app' },
      },
      discovers: 'pod-vs-container',
      hints: ['It is the glowing box standing on the Pod’s floor.'],
      highlight: { kind: 'container', podId: HELLO, role: 'app' },
    },
    {
      id: 'open-multi-example',
      title: 'Two containers, one Pod',
      instruction: 'A Pod can hold more than one container. Open the prepared example: a web server with a log helper.',
      requires: ['inspect-app-container'],
      condition: { type: 'action', action: 'MULTI_CONTAINER_EXAMPLE_OPENED' },
      discovers: 'multi-container',
      hints: ['Use the button just above.'],
      actions: ['open-multi-container-example'],
    },
    {
      id: 'inspect-both-containers',
      title: 'Meet both containers',
      instruction: 'Step inside web-and-logger and inspect each of its two containers.',
      requires: ['open-multi-example'],
      condition: {
        type: 'distinct',
        key: 'containerName',
        count: 2,
        action: 'CONTAINER_INSPECTED',
        where: { podId: MULTI },
      },
      discovers: 'shared-network',
      hints: [
        'Select the Pod, press “Explore inside”, then click each container.',
        'Look at the dashed localhost link, and the volume both containers mount.',
      ],
      highlight: { kind: 'container', podId: MULTI },
    },
    {
      id: 'lab-running',
      title: 'Bring a Pod to life',
      instruction: 'Lifecycle lab: create the report-once Pod, then start its container. Watch its phase.',
      requires: ['inspect-both-containers'],
      condition: { type: 'action', action: 'POD_LIFECYCLE_OBSERVED', where: { phase: 'Running' } },
      discovers: 'pod-phases',
      hints: [
        'Use the lab button above twice: once to create the Pod, once to start it.',
        'In a real cluster these steps happen by themselves. Here you step through them.',
      ],
      actions: ['advance-lab-success'],
    },
    {
      id: 'lab-succeeded',
      title: 'A job well done',
      instruction: 'report-once runs a short task, and its restartPolicy is Never. Let its program finish.',
      requires: ['lab-running'],
      condition: { type: 'action', action: 'POD_LIFECYCLE_OBSERVED', where: { phase: 'Succeeded' } },
      discovers: 'pod-succeeded',
      hints: ['Use the lab button above.'],
      actions: ['advance-lab-success'],
    },
    {
      id: 'lab-failed',
      title: 'When a program fails',
      instruction: 'broken-once runs a program with a bug. Create it, start it, and let it run.',
      requires: ['lab-succeeded'],
      condition: { type: 'action', action: 'POD_LIFECYCLE_OBSERVED', where: { phase: 'Failed' } },
      discovers: 'pod-failed',
      hints: ['Use the lab button above, three times.'],
      actions: ['advance-lab-failure'],
    },
    {
      id: 'phase-vs-state',
      title: 'Phase vs container state',
      instruction:
        'Step inside broken-once and select its container. Compare the container’s state with the Pod’s phase.',
      requires: ['lab-failed'],
      condition: {
        type: 'action',
        action: 'CONTAINER_INSPECTED',
        where: { podId: BROKEN, containerState: 'terminated' },
      },
      discovers: 'phase-vs-state',
      hints: ['Select broken-once, press “Explore inside”, then click its container.'],
      highlight: { kind: 'container', podId: BROKEN },
    },
  ],
};
