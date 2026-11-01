import { EMPTY_WORLD } from '../sandbox';
import type { Lesson } from '../types';

/**
 * Lesson 1. The learner builds a cluster from an empty universe, then
 * identifies which part coordinates and which part provides capacity.
 */
export const birthOfACluster: Lesson = {
  id: 'birth-of-a-cluster',
  number: 1,
  title: 'The Birth of a Cluster',
  intro: {
    title: 'Every cluster begins somewhere.',
    text: 'Kubernetes coordinates a group of machines so they can run containerized applications together. Right now this universe is empty — bring a cluster to life.',
  },
  summary: 'You built a cluster: a control plane that coordinates, and worker Nodes that provide capacity.',
  goals: [
    'What a cluster is, and why it has several machines',
    'What a Node is',
    'How the control plane differs from worker Nodes',
  ],
  initialWorld: EMPTY_WORLD,
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
    'initialize-cluster': {},
    'add-worker-node': { requires: ['meet-control-plane'], limit: 2 },
  },
  objectives: [
    {
      id: 'initialize-cluster',
      title: 'Initialize the cluster',
      instruction: 'Something is waiting in the middle of the universe. Click it to start your cluster.',
      condition: { type: 'action', action: 'CLUSTER_INITIALIZED' },
      discovers: 'cluster',
      hints: ['Click the glowing crystal, or its “Initialize cluster” label.'],
      highlight: { kind: 'build-site', action: 'initialize-cluster' },
    },
    {
      id: 'meet-control-plane',
      title: 'Discover the control plane',
      instruction: 'An island has appeared. Click it to find out what it does.',
      requires: ['initialize-cluster'],
      condition: { type: 'action', action: 'ENTITY_SELECTED', where: { entityKind: 'control-plane' } },
      discovers: 'control-plane',
      hints: ['Click the hexagonal island or its name plate.'],
      highlight: { kind: 'node', role: 'control-plane' },
    },
    {
      id: 'add-first-worker',
      title: 'Add a worker Node',
      instruction: 'A cluster needs machines to run applications on. Add your first worker Node.',
      requires: ['meet-control-plane'],
      condition: { type: 'action', action: 'NODE_ADDED', where: { role: 'worker' } },
      discovers: 'node',
      hints: ['Look for the faint empty platform marked “Add worker Node” and click it.'],
      highlight: { kind: 'build-site', action: 'add-worker-node' },
    },
    {
      id: 'add-second-worker',
      title: 'Expand the cluster',
      instruction: 'One machine is a start. Add a second worker Node.',
      requires: ['add-first-worker'],
      condition: { type: 'action', action: 'NODE_ADDED', where: { role: 'worker' } },
      discovers: 'many-machines',
      hints: ['Another empty platform is waiting. Click it.'],
      highlight: { kind: 'build-site', action: 'add-worker-node' },
    },
    {
      id: 'identify-coordination',
      title: 'Find the coordinator',
      instruction: 'Identify the part of the cluster responsible for coordination.',
      requires: ['add-second-worker'],
      condition: { type: 'action', action: 'ENTITY_SELECTED', where: { entityKind: 'control-plane' } },
      discovers: 'node-roles',
      hints: [
        'Coordination means keeping track of the cluster and deciding where work goes.',
        'It is the island you created first.',
      ],
      highlight: { kind: 'node', role: 'control-plane' },
      feedback: [
        {
          action: 'ENTITY_SELECTED',
          where: { entityKind: 'worker-node' },
          message: 'That is a worker Node: it provides capacity. Look for the part that coordinates the others.',
        },
      ],
    },
    {
      id: 'identify-capacity',
      title: 'Find the capacity',
      instruction: 'Find a machine that provides capacity for running applications.',
      requires: ['identify-coordination'],
      condition: { type: 'action', action: 'ENTITY_SELECTED', where: { entityKind: 'worker-node' } },
      discovers: 'finite-capacity',
      hints: ['Any worker Node will do. Its inspector shows how much CPU and memory it offers.'],
      highlight: { kind: 'node', role: 'worker' },
      feedback: [
        {
          action: 'ENTITY_SELECTED',
          where: { entityKind: 'control-plane' },
          message: 'That is the control plane: it coordinates. Applications run on the worker Nodes.',
        },
      ],
    },
  ],
};
