import {
  anyImage,
  applied,
  changedBy,
  check,
  deletedOwnedPod,
  described,
  equals,
  isList,
  isMapping,
  labelsInclude,
  listed,
  podRunning,
  present,
  selectorMatchesTemplate,
  valueAt,
  workloadReady,
} from '../checks';
import type { Lesson } from '../types';

const isNumber = (v: unknown) => typeof v === 'number';

// ---------------------------------------------------------------------------
// L00 · Understanding YAML
// ---------------------------------------------------------------------------

export const yamlBasics: Lesson = {
  id: 'yaml-basics',
  number: 0,
  title: 'Understanding YAML',
  tagline: 'The language every Kubernetes manifest is written in.',
  summary: 'Keys and values, indentation, lists and nested mappings: just enough YAML to read and write any manifest with confidence.',
  level: 'Beginner',
  minutes: 10,
  concepts: ['key: value', 'indentation', 'lists', 'nesting', 'types'],
  prerequisites: [],
  depth: 'complete',
  world: 'empty',
  steps: [
    {
      id: 'what',
      kind: 'read',
      phase: 'understand',
      title: 'YAML describes data',
      cards: [
        {
          title: 'Keys and values',
          body: [
            'YAML is a way to write structured data that people can read. Kubernetes uses it to describe what you want to run.',
            'The basic building block is a `key: value` pair. The colon must be followed by a space.',
          ],
          code: 'name: Mochi\nspecies: cat\nage: 3',
        },
        {
          title: 'Indentation means "belongs to"',
          body: [
            'Indenting lines under a key makes them its children. That group of children is called a mapping.',
            'Use spaces, never tabs. Two spaces per level is the convention. Siblings must start in exactly the same column.',
          ],
          code: 'owner:\n  name: Ada\n  city: Lisbon',
          more: 'YAML has no braces or end markers: indentation alone decides structure. That is why one stray space can change meaning or break the file. The editor shows indentation guides to help you line things up.',
        },
        {
          title: 'Lists',
          body: ['A list is a sequence of items, each starting with `- ` (dash and space) at the same indentation.', 'Items can be simple values, or whole mappings.'],
          code: 'toys:\n  - ball\n  - feather\n\nvisits:\n  - date: 2026-01-10\n    reason: checkup\n  - date: 2026-06-02\n    reason: vaccine',
          more: 'In the second list, `date` and `reason` belong to the same item because they are aligned: the dash starts the item, and the following keys line up with the first key after the dash.',
        },
        {
          title: 'Types',
          body: [
            'YAML guesses the type of a value: `3` is a number, `true` is a boolean, `hello` is a string.',
            'Quote a value to force it to be a string: `"3"`, `"true"`. This matters in Kubernetes, where label values must be strings.',
            'A `#` starts a comment that runs to the end of the line.',
          ],
          code: 'replicas: 3        # a number\nenabled: true      # a boolean\nversion: "1.10"    # a string (unquoted, 1.10 would become the number 1.1)',
        },
      ],
    },
    {
      id: 'indent-quiz',
      kind: 'quiz',
      phase: 'understand',
      title: 'Spot the problem',
      question: 'Which line breaks this YAML?',
      code: 'owner:\n  name: Ada\n   city: Lisbon\n  phone: "555-0100"',
      options: [
        { text: 'Line 2: `name: Ada`', why: 'This line is fine: it is indented two spaces under `owner`.' },
        { text: 'Line 3: `city: Lisbon`', correct: true, why: 'Right. It has three spaces instead of two, so it does not line up with its sibling `name`. YAML cannot tell where it belongs.' },
        { text: 'Line 4: `phone: "555-0100"`', why: 'Quoting a value is allowed, and this line is aligned with `name`.' },
      ],
    },
    {
      id: 'pet',
      kind: 'write',
      phase: 'write',
      title: 'Write your first YAML',
      intro: ['Describe a pet in `pet.yaml`. The checks below update as you type, and you can hover any key for help.'],
      exercise: {
        file: 'pet.yaml',
        objective: 'A pet with a name, a numeric age, a list of at least two toys and an owner mapping that has a city.',
        starter: '# Describe a pet. Lines starting with # are comments.\nname: Mochi\n',
        checks: [
          present('name', 'it has a `name`'),
          check('age-number', '`age` is a number', (d) => {
            const v = valueAt(d, 'age');
            if (v === undefined) return 'Add an `age` key, for example `age: 3`.';
            return isNumber(v) ? null : `\`age\` is ${JSON.stringify(v)}, a ${typeof v}. Write the number without quotes.`;
          }),
          isList('toys', 2, '`toys` is a list with at least two items', 'Add a `toys` key followed by at least two `- item` lines, indented under it.'),
          isMapping('owner', '`owner` is a mapping', 'Add an `owner` key with its own indented `key: value` lines.'),
          present('owner.city', '`owner` has a `city`', '`owner` needs a `city`, indented under it.'),
        ],
        hints: [
          'Each fact about the pet is a `key: value` line. Lists and nested mappings are written by indenting lines under a key.',
          'You need four top-level keys: `name`, `age`, `toys` (a list: lines starting with `- `) and `owner` (a mapping with `city` indented under it).',
          'name: Mochi\nage: 3\ntoys:\n  - ball\n  - feather\nowner:\n  city: Lisbon',
        ],
        solution: '# Describe a pet. Lines starting with # are comments.\nname: Mochi\nage: 3\ntoys:\n  - ball\n  - feather\nowner:\n  name: Ada\n  city: Lisbon\n',
        solutionNotes: [
          { field: 'age', note: 'Unquoted, so YAML reads it as a number.' },
          { field: 'toys', note: 'A list: each item starts with "- ", indented under the key.' },
          { field: 'owner', note: 'A nested mapping: its keys are indented two spaces and aligned with each other.' },
        ],
        toy: 'cat',
      },
    },
    {
      id: 'types-quiz',
      kind: 'quiz',
      phase: 'understand',
      title: 'Strings or numbers?',
      question: 'Kubernetes requires label values to be strings. Which of these labels is a valid string value?',
      code: 'labels:\n  version: 2\n  release: "2"\n  stable: true',
      options: [
        { text: '`version: 2`', why: 'Unquoted, `2` is a number. Kubernetes would reject it as a label value.' },
        { text: '`release: "2"`', correct: true, why: 'Correct. The quotes make it the string "2".' },
        { text: '`stable: true`', why: 'Unquoted, `true` is a boolean, not a string. Write `"true"` instead.' },
      ],
    },
    {
      id: 'fix',
      kind: 'write',
      phase: 'verify',
      title: 'Repair a broken file',
      intro: ['This file has three mistakes. The syntax checker points at each one in turn: fix them until the file parses and the objectives pass.'],
      exercise: {
        file: 'broken.yaml',
        objective: 'Valid YAML: `app` is a mapping with `name` and `port`, and `tags` is a list of two strings.',
        starter: 'app:\n  name: shop\n\tport: 8080\ntags:\n  - web\n  -backend\n',
        checks: [
          isMapping('app', '`app` is a mapping', '`app` must be a mapping with its keys indented under it.'),
          equals('app.name', 'shop', '`app.name` is "shop"'),
          check('port', '`app.port` is the number 8080', (d) => (valueAt(d, 'app.port') === 8080 ? null : '`app.port` should be 8080, indented with spaces like `name`.')),
          check('tags', '`tags` lists "web" and "backend"', (d) => {
            const v = valueAt(d, 'tags');
            if (!Array.isArray(v)) return '`tags` must be a list.';
            return v.length === 2 && v.includes('web') && v.includes('backend') ? null : `\`tags\` is ${JSON.stringify(v)}. Each item needs "- " (dash and a space).`;
          }),
        ],
        hints: [
          'Look for whitespace: YAML is picky about tabs, and about the space after a dash.',
          'Line 3 is indented with a tab instead of spaces. Line 6 is missing the space after `-`, so YAML does not see a list item.',
          'app:\n  name: shop\n  port: 8080\ntags:\n  - web\n  - backend',
        ],
        solution: 'app:\n  name: shop\n  port: 8080\ntags:\n  - web\n  - backend\n',
        solutionNotes: [
          { field: 'app.port', note: 'Indented with two spaces, like its sibling name. Tabs are not allowed.' },
          { field: 'tags', note: '"- backend" needs the space: "-backend" is just text, which makes the list invalid here.' },
        ],
      },
    },
    {
      id: 'manifest',
      kind: 'read',
      phase: 'understand',
      title: 'From YAML to Kubernetes',
      cards: [
        {
          title: 'Every manifest has the same shape',
          body: [
            'A Kubernetes manifest is a YAML file describing one object you want to exist. Almost every manifest starts with the same four top-level fields:',
            '`apiVersion` says which version of the API defines this kind of object. `kind` says what type of object it is. `metadata` gives it an identity (its name and labels). `spec` describes what you want: the desired state.',
          ],
          code: 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: hello-pod\nspec:\n  containers:\n    - name: web\n      image: nginx:stable',
          more: 'You write the desired state; Kubernetes controllers keep working until the real state matches it. When you read an object back, Kubernetes also adds a `status` section describing what actually exists. You never write `status` yourself.',
        },
        {
          title: 'apiVersion: which API, which version',
          body: [
            'The Kubernetes API is not one single block. Its object types are sorted into API groups, and each group evolves on its own. `apiVersion` names both, as `group/version`.',
            'The oldest, most basic types (Pod, Service, ConfigMap, Namespace…) live in the core group, which has no name: their apiVersion is simply `v1`. Types added later live in named groups: Deployments and ReplicaSets in `apps`, Jobs in `batch`, Ingresses in `networking.k8s.io`. That is why two manifests side by side can start with different apiVersions.',
          ],
          code: 'apiVersion: v1                    # core group: Pod, Service, ConfigMap, PVC\napiVersion: apps/v1               # Deployment, ReplicaSet, StatefulSet, DaemonSet\napiVersion: batch/v1              # Job, CronJob\napiVersion: networking.k8s.io/v1  # Ingress, NetworkPolicy\napiVersion: autoscaling/v2        # HorizontalPodAutoscaler',
          more: [
            '**Why versions at all?** Thousands of tools and scripts talk to the Kubernetes API, so it cannot change shape overnight. A new feature goes through stages, visible in its version name:',
            '`v1alpha1` is experimental: often disabled by default, and it may change or disappear in the next release. `v1beta1` is well tested and enabled, but details can still change. `v1` (then `v2`…) is stable: Kubernetes promises not to break it, so this is what you use in real manifests.',
            '**Several versions at once.** While users migrate, the same kind can be served in two versions, say `v1beta1` and `v1`. The API server stores each object once and converts it to whichever version you ask for, so a manifest written for either version describes the same object.',
            '**Old versions disappear.** After a deprecation period, outdated versions are removed. Deployments used to be written `extensions/v1beta1`, then `apps/v1beta2`; Kubernetes 1.16 stopped serving those, and manifests that still used them were rejected after the upgrade. When an old tutorial shows an apiVersion that fails today, this is usually why: the kind still exists, only under a newer group or version.',
            '**apiVersion and kind go together.** `kind` alone is not always enough, because the version decides which fields exist (`autoscaling/v1` and `autoscaling/v2` describe a HorizontalPodAutoscaler differently). The pair tells the API server exactly which schema to read the rest of your file with. To find the right pair, ask the cluster:',
          ],
          moreCode: '$ kubectl api-resources      # APIVERSION column, for every kind\n$ kubectl explain deployment # KIND: Deployment, VERSION: apps/v1',
        },
      ],
    },
    {
      id: 'kind-quiz',
      kind: 'quiz',
      phase: 'verify',
      title: 'Check your understanding',
      question: 'Which field tells Kubernetes what type of object a manifest describes?',
      options: [
        { text: '`apiVersion`', why: 'apiVersion names the API group and version (like v1 or apps/v1), not the type itself.' },
        { text: '`kind`', correct: true, why: 'Yes. `kind: Pod`, `kind: Service` and so on.' },
        { text: '`metadata`', why: 'metadata holds the name, namespace and labels of the object.' },
        { text: '`spec`', why: 'spec describes what you want the object to be like, once its type is known.' },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// L01 · Your first Pod
// ---------------------------------------------------------------------------

const POD_SOLUTION = `apiVersion: v1
kind: Pod
metadata:
  name: hello-pod
spec:
  containers:
    - name: web
      image: nginx:stable
      ports:
        - containerPort: 80
`;

export const firstPod: Lesson = {
  id: 'first-pod',
  number: 1,
  title: 'Your first Pod',
  tagline: 'Write a manifest, deploy it, watch it come alive.',
  summary: 'Create a Pod called hello-pod running nginx, apply it with kubectl, and learn to read its status.',
  level: 'Beginner',
  minutes: 15,
  concepts: ['Pod', 'container', 'image', 'kubectl apply', 'kubectl get', 'kubectl describe'],
  prerequisites: ['yaml-basics'],
  depth: 'complete',
  simulationNotes: ['Images are not really downloaded: the simulated kubelet "pulls" any well-formed image name, and knows nginx listens on port 80.'],
  steps: [
    {
      id: 'pods',
      kind: 'read',
      phase: 'understand',
      title: 'What is a Pod?',
      cards: [
        {
          title: 'The smallest thing Kubernetes runs',
          body: [
            'A Pod wraps one or more containers that run together on the same node, sharing a network address. Most Pods hold a single container.',
            'A container is started from an image: a packaged application, like `nginx:stable`, a small web server.',
          ],
          more: 'Containers in one Pod share an IP address and can share volumes, so they behave like processes on the same machine. Sidecar containers (log shippers, proxies) use this. You will mostly see one container per Pod.',
        },
        {
          title: 'What happens when you apply it',
          body: [
            'You send the manifest to the API server with `kubectl apply`. The scheduler picks a node for the Pod; the kubelet on that node pulls the image and starts the container.',
            'You can watch each step: the Pod goes from Pending to ContainerCreating to Running. In the 3D view it appears on the node that was chosen.',
          ],
        },
      ],
    },
    {
      id: 'write',
      kind: 'write',
      phase: 'write',
      title: 'Write pod.yaml',
      exercise: {
        file: 'pod.yaml',
        kind: 'Pod',
        objective: 'A Pod named hello-pod with one container running an nginx image.',
        checks: [
          equals('apiVersion', 'v1', '`apiVersion` is v1'),
          equals('kind', 'Pod', '`kind` is Pod'),
          equals('metadata.name', 'hello-pod', 'named hello-pod'),
          isList('spec.containers', 1, 'it has a container', 'Add `spec.containers`: a list with one container.'),
          present('spec.containers[0].name', 'the container has a name'),
          anyImage('spec.containers[*].image', 'nginx'),
        ],
        modes: {
          guided: [
            {
              title: 'Say what it is',
              explain: ['Every manifest starts by naming its type. Pods are part of the core API, whose version is simply `v1`.'],
              instruction: 'Write `apiVersion: v1` and `kind: Pod` on the first two lines.',
              fields: ['apiVersion', 'kind'],
              checks: [equals('apiVersion', 'v1', '`apiVersion` is v1'), equals('kind', 'Pod', '`kind` is Pod')],
              snippet: 'apiVersion: v1\nkind: Pod',
            },
            {
              title: 'Give it a name',
              explain: ['`metadata` holds the object\'s identity. The `name` must be unique among Pods in the namespace, using lowercase letters, digits and dashes.'],
              instruction: 'Add a `metadata` mapping with `name: hello-pod`.',
              fields: ['metadata', 'metadata.name'],
              checks: [equals('metadata.name', 'hello-pod', 'named hello-pod', 'Add `metadata:` with `name: hello-pod` indented under it.')],
              snippet: 'metadata:\n  name: hello-pod',
            },
            {
              title: 'Describe the container',
              explain: ['`spec` is what you want. For a Pod, that is the list of containers to run. Each container needs a `name`, unique inside the Pod.'],
              instruction: 'Add `spec`, with a `containers` list holding one item that has `name: web`.',
              fields: ['spec', 'spec.containers', 'spec.containers.name'],
              checks: [
                isList('spec.containers', 1, 'it has a container', 'Add `spec:` and under it `containers:` with one `- name: web` item.'),
                present('spec.containers[0].name', 'the container has a name', 'The container item needs a `name`.'),
              ],
              snippet: 'spec:\n  containers:\n    - name: web',
            },
            {
              title: 'Choose the image',
              explain: ['The `image` is what the container runs. `nginx:stable` means the nginx repository, tag stable. Without a tag, Kubernetes assumes `latest`.'],
              instruction: 'Add `image: nginx:stable` to the container, aligned with its `name`.',
              fields: ['spec.containers.image'],
              checks: [anyImage('spec.containers[*].image', 'nginx')],
              snippet: '    - name: web\n      image: nginx:stable',
            },
            {
              title: 'Document the port (optional, recommended)',
              explain: ['nginx listens on port 80. Listing it under `ports` is documentation: it does not open or block anything, but tools and people rely on it.'],
              instruction: 'Add a `ports` list with `containerPort: 80`, then check your work.',
              fields: ['spec.containers.ports', 'spec.containers.ports.containerPort'],
              checks: [],
              snippet: '      ports:\n        - containerPort: 80',
            },
          ],
          complete: 'apiVersion: ___\nkind: ___\nmetadata:\n  name: ___\nspec:\n  containers:\n    - name: web\n      image: ___\n      ports:\n        - containerPort: 80\n',
          scratch: '',
        },
        hints: [
          'A manifest says what kind of object it is (apiVersion and kind), names it (metadata) and describes what to run (spec).',
          'The container goes in `spec.containers`, a list. The item needs a `name` and an `image` such as `nginx:stable`, indented under the dash.',
          'spec:\n  containers:\n    - name: web\n      image: nginx:stable',
        ],
        solution: POD_SOLUTION,
        solutionNotes: [
          { field: 'apiVersion', note: 'Pods belong to the core API group, version v1.' },
          { field: 'metadata.name', note: 'The Pod\'s name. You will use it with kubectl get and describe.' },
          { field: 'spec.containers', note: 'A list, even with a single container.' },
          { field: 'spec.containers.image', note: 'nginx:stable is pulled from the registry by the kubelet.' },
          { field: 'spec.containers.ports', note: 'Informational: nginx listens on 80 regardless.' },
        ],
      },
    },
    {
      id: 'apply',
      kind: 'command',
      phase: 'deploy',
      title: 'Deploy it',
      body: ['Editing the file changes nothing in the cluster. Sending it to the API server does: run the apply command in the terminal.'],
      command: 'kubectl apply -f pod.yaml',
      check: applied('Pod', 'hello-pod', 'pod.yaml'),
      hint: 'Type the command in the terminal below and press Enter. `-f` names the file to send.',
      explain: ['`pod/hello-pod created` means the API server accepted and stored your object. It does not mean the container is running yet.'],
    },
    {
      id: 'running',
      kind: 'cluster',
      phase: 'observe',
      title: 'Watch it start',
      body: ['Look at the 3D view and My Cluster: the scheduler picks a node, then the kubelet pulls the image and starts nginx. This takes a few seconds.'],
      check: podRunning('hello-pod'),
      hint: 'If nothing appears, check the terminal output of your apply command for errors.',
      explain: ['hello-pod is Running and Ready: its container started and Kubernetes considers it able to serve.'],
    },
    {
      id: 'get',
      kind: 'command',
      phase: 'observe',
      title: 'List your Pods',
      body: ['`kubectl get` lists objects with a one-line summary each.'],
      command: 'kubectl get pods',
      check: listed('Pod'),
      hint: 'Run `kubectl get pods`. `po` is a short alias for pods.',
      explain: [
        'READY is ready containers out of total. STATUS is the Pod\'s phase or the reason it is waiting. RESTARTS counts container restarts. AGE is time since creation.',
        'Add `-o wide` to also see the Pod\'s IP address and node.',
      ],
    },
    {
      id: 'describe',
      kind: 'command',
      phase: 'verify',
      title: 'Inspect the details',
      body: ['`kubectl describe` shows everything about one object, ending with its recent events: the story of what happened to it.'],
      command: 'kubectl describe pod hello-pod',
      check: described('Pod', 'hello-pod'),
      hint: 'Run `kubectl describe pod hello-pod`.',
      explain: ['Read the Events at the bottom: Scheduled (a node was chosen), Pulling and Pulled (the image), Created and Started (the container). When a Pod is stuck, this is the first place to look.'],
    },
    {
      id: 'quiz',
      kind: 'quiz',
      phase: 'verify',
      title: 'One more thing',
      question: 'You run `kubectl delete pod hello-pod`. What happens next?',
      options: [
        { text: 'Kubernetes creates a new hello-pod automatically.', why: 'Not for a bare Pod. Nothing owns it, so nothing replaces it.' },
        { text: 'The Pod is terminated and stays gone.', correct: true, why: 'Exactly. A Pod you create directly is not recreated. Lesson 3 introduces ReplicaSets, which keep Pods alive for you.' },
        { text: 'The node restarts the container in place.', why: 'The kubelet restarts crashed containers, but deleting the Pod removes it entirely.' },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// L02 · Labels
// ---------------------------------------------------------------------------

export const labels: Lesson = {
  id: 'labels',
  number: 2,
  title: 'Labels and selectors',
  tagline: 'How Kubernetes groups and finds objects.',
  summary: 'Attach labels to hello-pod, then filter Pods with label selectors: the mechanism every controller and Service builds on.',
  level: 'Beginner',
  minutes: 10,
  concepts: ['labels', 'selectors', '--show-labels', '-l'],
  prerequisites: ['first-pod'],
  depth: 'complete',
  setup: {
    description: 'hello-pod from lesson 1',
    needed: (s) => !s.objects.some((o) => o.kind === 'Pod' && o.metadata.name === 'hello-pod'),
    files: { 'pod.yaml': POD_SOLUTION },
    commands: ['kubectl apply -f pod.yaml'],
  },
  steps: [
    {
      id: 'labels',
      kind: 'read',
      phase: 'understand',
      title: 'Labels are tags with meaning',
      cards: [
        {
          title: 'Key/value tags',
          body: [
            'Labels are `key: value` pairs in `metadata.labels`. They say what an object is: which app, which tier, which environment.',
            'Values are strings: quote anything that YAML would read as a number or boolean.',
          ],
          code: 'metadata:\n  name: hello-pod\n  labels:\n    app: hello\n    tier: frontend',
        },
        {
          title: 'Selectors find objects by label',
          body: [
            'A selector is a set of labels to match. `app=hello` selects every object whose `app` label is `hello`, whatever its other labels.',
            'Kubernetes never groups objects by name. ReplicaSets find their Pods, and Services find where to send traffic, through selectors.',
          ],
          more: 'Selectors are ANDed: `app=hello,tier=frontend` needs both. Set-based selectors also exist (`tier in (frontend, backend)`), used with `matchExpressions`.',
        },
      ],
    },
    {
      id: 'write',
      kind: 'write',
      phase: 'write',
      title: 'Label hello-pod',
      exercise: {
        file: 'pod.yaml',
        kind: 'Pod',
        objective: 'hello-pod carries at least two labels, including `app: hello`.',
        carryFrom: { lesson: 'first-pod', step: 'write' },
        checks: [
          equals('kind', 'Pod', '`kind` is Pod'),
          equals('metadata.name', 'hello-pod', 'still named hello-pod'),
          labelsInclude('metadata.labels', 2, ['app'], 'it has an `app` label and at least one more'),
          equals('metadata.labels.app', 'hello', '`app` is "hello"'),
          anyImage('spec.containers[*].image', 'nginx'),
        ],
        modes: {
          guided: [
            {
              title: 'Start from your Pod',
              explain: ['Labels belong to the object\'s identity, so they live in `metadata`, next to `name`. The rest of the Pod stays the same.'],
              instruction: 'Keep the hello-pod manifest from lesson 1 (it is already in the editor).',
              fields: ['metadata'],
              checks: [equals('kind', 'Pod', '`kind` is Pod'), equals('metadata.name', 'hello-pod', 'still named hello-pod')],
              snippet: POD_SOLUTION,
            },
            {
              title: 'Add the labels mapping',
              explain: ['`labels` is a mapping under `metadata`. The first label most objects get is `app`: the application they belong to.'],
              instruction: 'Under `metadata`, add `labels:` with `app: hello` indented beneath it.',
              fields: ['metadata.labels'],
              checks: [equals('metadata.labels.app', 'hello', '`app` is "hello"', 'Add `labels:` under metadata, with `app: hello` indented under it.')],
              snippet: 'metadata:\n  name: hello-pod\n  labels:\n    app: hello',
            },
            {
              title: 'Add a second dimension',
              explain: ['More labels let you slice the same objects different ways: by tier, environment or team.'],
              instruction: 'Add a second label, for example `tier: frontend`.',
              fields: ['metadata.labels'],
              checks: [labelsInclude('metadata.labels', 2, ['app'], 'it has an `app` label and at least one more')],
              snippet: '  labels:\n    app: hello\n    tier: frontend',
            },
          ],
          guidedStarter: POD_SOLUTION,
          complete: 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: hello-pod\n  labels:\n    app: ___\n    ___: frontend\nspec:\n  containers:\n    - name: web\n      image: nginx:stable\n      ports:\n        - containerPort: 80\n',
          scratch: '',
        },
        hints: [
          'Labels are part of the object\'s identity, alongside its name.',
          'Add `labels`, a mapping, inside `metadata`, aligned with `name`. Put `app: hello` and one more label in it.',
          'metadata:\n  name: hello-pod\n  labels:\n    app: hello\n    tier: frontend',
        ],
        solution: 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: hello-pod\n  labels:\n    app: hello\n    tier: frontend\nspec:\n  containers:\n    - name: web\n      image: nginx:stable\n      ports:\n        - containerPort: 80\n',
        solutionNotes: [
          { field: 'metadata.labels', note: 'A mapping of string keys to string values.' },
          { field: 'metadata.labels.app', note: 'The conventional label naming the application.' },
        ],
      },
    },
    {
      id: 'apply',
      kind: 'command',
      phase: 'deploy',
      title: 'Update the Pod',
      body: ['Apply the file again. Kubernetes compares it with what exists and changes only the difference.'],
      command: 'kubectl apply -f pod.yaml',
      check: changedBy('Pod', 'hello-pod'),
      hint: 'Run `kubectl apply -f pod.yaml`. It should say `configured` (or `created` if the Pod did not exist).',
      explain: ['`configured` means the object existed and was updated in place. Labels can change at any time without restarting anything.'],
    },
    {
      id: 'show',
      kind: 'command',
      phase: 'observe',
      title: 'See the labels',
      body: ['Ask kubectl to show labels as an extra column.'],
      command: 'kubectl get pods --show-labels',
      check: listed('Pod', (e) => !!e.showLabels),
      hint: 'Run `kubectl get pods --show-labels`.',
    },
    {
      id: 'select',
      kind: 'command',
      phase: 'verify',
      title: 'Filter with a selector',
      body: ['Now list only the Pods matching a selector, with `-l` (short for `--selector`).'],
      command: 'kubectl get pods -l app=hello',
      check: listed('Pod', (e) => !!e.selector),
      hint: 'Run `kubectl get pods -l app=hello`. Try a selector that matches nothing too, like `-l app=nope`.',
      explain: ['This is exactly how controllers see the world: "which Pods match my selector?"'],
    },
    {
      id: 'quiz',
      kind: 'quiz',
      phase: 'verify',
      title: 'Which Pods match?',
      question: 'Which Pod does the selector `app=shop,tier=web` select?',
      options: [
        { text: 'A Pod labelled `app: shop`', why: 'It lacks `tier: web`. Every label in the selector must match.' },
        { text: 'A Pod labelled `app: shop, tier: web, env: prod`', correct: true, why: 'Yes. Extra labels do not matter; all of the selector\'s labels are present.' },
        { text: 'A Pod named `shop-web`', why: 'Selectors only look at labels, never at names.' },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// L03 · ReplicaSet
// ---------------------------------------------------------------------------

const RS_SOLUTION = `apiVersion: apps/v1
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
          ports:
            - containerPort: 80
`;

const RS_CHECKS = {
  kind: [equals('apiVersion', 'apps/v1', '`apiVersion` is apps/v1'), equals('kind', 'ReplicaSet', '`kind` is ReplicaSet'), equals('metadata.name', 'web-rs', 'named web-rs')],
  replicas: [equals('spec.replicas', 3, '`spec.replicas` is 3')],
  selector: [equals('spec.selector.matchLabels.app', 'web', 'the selector matches `app: web`', 'Add `spec.selector.matchLabels` with `app: web`.')],
  template: [equals('spec.template.metadata.labels.app', 'web', 'the template labels Pods `app: web`', 'Add `spec.template.metadata.labels` with `app: web`.')],
  containers: [
    isList('spec.template.spec.containers', 1, 'the template has a container', 'Add `spec.template.spec.containers` with one container.'),
    anyImage('spec.template.spec.containers[*].image', 'nginx'),
  ],
};

export const replicaSet: Lesson = {
  id: 'replicaset',
  number: 3,
  title: 'ReplicaSets keep Pods alive',
  tagline: 'Declare how many, and let a controller do the rest.',
  summary: 'Run three nginx Pods through a ReplicaSet, delete one and watch it come back: your first controller and the idea of desired state.',
  level: 'Beginner',
  minutes: 15,
  concepts: ['ReplicaSet', 'replicas', 'selector', 'template', 'ownership', 'self-healing'],
  prerequisites: ['labels'],
  depth: 'complete',
  steps: [
    {
      id: 'why',
      kind: 'read',
      phase: 'understand',
      title: 'Desired state',
      cards: [
        {
          title: 'Pods alone are fragile',
          body: [
            'A bare Pod that is deleted, or whose node fails, is gone for good. To keep an app running you want something that notices and replaces it.',
            'A ReplicaSet is a controller: you tell it how many Pods you want, and it continuously creates or deletes Pods to keep that number.',
          ],
        },
        {
          title: 'Three parts',
          body: [
            '`replicas`: how many Pods. `selector`: which labels identify its Pods. `template`: the Pod to create when one is missing, written like the Pod you already know, minus the name.',
            'The template\'s labels must match the selector, or the ReplicaSet could never find the Pods it creates. Kubernetes rejects a mismatch.',
          ],
          code: 'spec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: web\n  template:\n    metadata:\n      labels:\n        app: web\n    spec:\n      containers:\n        - name: nginx\n          image: nginx:stable',
          more: 'Pods created by a ReplicaSet are named after it plus a random suffix, and carry an ownerReference pointing to it. That ownership is what lets Kubernetes delete the Pods when you delete the ReplicaSet. A ReplicaSet also adopts existing Pods without an owner that match its selector, which is one more reason to keep selectors specific.',
        },
        {
          title: 'selector and matchLabels',
          body: [
            '`selector` answers one question: which Pods belong to this ReplicaSet? It never looks at names, only at labels.',
            '`matchLabels` is the simple form: a mapping of labels a Pod must carry, **all of them**. `app: web` selects every Pod labelled `app: web`, whatever its other labels. Add `tier: frontend` and a Pod needs both.',
          ],
          code: 'selector:\n  matchLabels:\n    app: web\n    tier: frontend   # a Pod needs both labels',
          more: [
            'matchLabels can only say "this key equals this value". For anything else, a selector has a second form, `matchExpressions`: a list of rules, each with a `key`, an `operator` and, depending on the operator, a list of `values`.',
            'The four operators: `In` (the label\'s value is one of `values`), `NotIn` (the label is missing, or its value is not one of them), `Exists` (the Pod has this key, whatever its value, with no `values`) and `DoesNotExist` (it does not have this key).',
            'You can use both forms in the same selector: every matchLabels entry **and** every expression must hold. In fact `matchLabels: {app: web}` is shorthand for the expression `{key: app, operator: In, values: [web]}`.',
            'The same set-based rules exist on the command line: `kubectl get pods -l \'tier in (frontend, backend)\'`, `-l \'!canary\'` (no `canary` label) or `-l env` (has an `env` label).',
            'Two cautions. A ReplicaSet\'s selector cannot be changed after creation, so choose it carefully. And the template\'s labels must satisfy the whole selector, expressions included, or the API server rejects the manifest.',
            'The Playground simulates `matchLabels` only: writing `matchExpressions` here is reported as an unknown field, but it is valid on a real cluster.',
          ],
          moreCode: 'selector:\n  matchLabels:\n    app: web\n  matchExpressions:\n    - key: tier\n      operator: In\n      values: [frontend, backend]\n    - key: canary\n      operator: DoesNotExist',
        },
      ],
    },
    {
      id: 'write',
      kind: 'write',
      phase: 'write',
      title: 'Write replicaset.yaml',
      exercise: {
        file: 'replicaset.yaml',
        kind: 'ReplicaSet',
        objective: 'A ReplicaSet named web-rs keeping 3 nginx Pods labelled app: web.',
        checks: [
          ...RS_CHECKS.kind,
          ...RS_CHECKS.replicas,
          selectorMatchesTemplate('spec.selector.matchLabels', 'spec.template.metadata.labels'),
          ...RS_CHECKS.containers,
        ],
        modes: {
          guided: [
            {
              title: 'Kind and name',
              explain: ['ReplicaSets live in the `apps` API group, so their apiVersion is `apps/v1`, not `v1`.'],
              instruction: 'Write `apiVersion: apps/v1`, `kind: ReplicaSet` and `metadata.name: web-rs`.',
              fields: ['apiVersion', 'kind', 'metadata.name'],
              checks: RS_CHECKS.kind,
              snippet: 'apiVersion: apps/v1\nkind: ReplicaSet\nmetadata:\n  name: web-rs',
            },
            {
              title: 'How many',
              explain: ['`replicas` is the desired number of Pods. The controller compares it with how many matching Pods exist, again and again.'],
              instruction: 'Add `spec` with `replicas: 3`.',
              fields: ['spec', 'spec.replicas'],
              checks: RS_CHECKS.replicas,
              snippet: 'spec:\n  replicas: 3',
            },
            {
              title: 'Which Pods are mine',
              explain: ['The `selector` is how the ReplicaSet counts its Pods: by label, never by name.'],
              instruction: 'Under `spec`, add `selector.matchLabels` with `app: web`.',
              fields: ['spec.selector', 'spec.selector.matchLabels'],
              checks: RS_CHECKS.selector,
              snippet: '  selector:\n    matchLabels:\n      app: web',
            },
            {
              title: 'Label the template',
              explain: ['`template` is the blueprint for new Pods. Its labels are stamped on every Pod it creates, so they must include the selector\'s labels.'],
              instruction: 'Add `template.metadata.labels` with the same `app: web`.',
              fields: ['spec.template', 'spec.template.metadata.labels'],
              checks: [...RS_CHECKS.template, selectorMatchesTemplate('spec.selector.matchLabels', 'spec.template.metadata.labels')],
              snippet: '  template:\n    metadata:\n      labels:\n        app: web',
            },
            {
              title: 'The Pod spec',
              explain: ['`template.spec` is a regular Pod spec, the same `containers` list you wrote in lesson 1, just indented deeper.'],
              instruction: 'Add `template.spec.containers` with an nginx container.',
              fields: ['spec.template.spec', 'spec.template.spec.containers'],
              checks: RS_CHECKS.containers,
              snippet: '    spec:\n      containers:\n        - name: nginx\n          image: nginx:stable',
            },
          ],
          complete: 'apiVersion: apps/v1\nkind: ReplicaSet\nmetadata:\n  name: web-rs\nspec:\n  replicas: ___\n  selector:\n    matchLabels:\n      app: ___\n  template:\n    metadata:\n      labels:\n        app: ___\n    spec:\n      containers:\n        - name: nginx\n          image: ___\n',
          scratch: '',
        },
        hints: [
          'A ReplicaSet needs to know how many Pods, how to recognise them, and how to create one.',
          'Under `spec`: `replicas`, a `selector` with `matchLabels`, and a `template` with its own `metadata.labels` and `spec.containers`. The labels must match.',
          'spec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: web\n  template:\n    metadata:\n      labels:\n        app: web\n    spec:\n      containers:\n        - name: nginx\n          image: nginx:stable',
        ],
        solution: RS_SOLUTION,
        solutionNotes: [
          { field: 'apiVersion', note: 'apps/v1: ReplicaSets belong to the apps API group.' },
          { field: 'spec.replicas', note: 'The desired number of Pods.' },
          { field: 'spec.selector', note: 'How the ReplicaSet recognises its Pods. Immutable after creation.' },
          { field: 'spec.template.metadata.labels', note: 'Stamped on each new Pod; must satisfy the selector.' },
          { field: 'spec.template.spec', note: 'A complete Pod spec, minus the Pod name (generated).' },
        ],
      },
    },
    {
      id: 'apply',
      kind: 'command',
      phase: 'deploy',
      title: 'Deploy the ReplicaSet',
      body: ['Apply your file. You create one object; watch how many appear.'],
      command: 'kubectl apply -f replicaset.yaml',
      check: applied('ReplicaSet', 'web-rs', 'replicaset.yaml'),
      hint: 'Run `kubectl apply -f replicaset.yaml`.',
    },
    {
      id: 'ready',
      kind: 'cluster',
      phase: 'observe',
      title: 'Three Pods appear',
      body: ['The ReplicaSet sees 0 of 3 Pods and creates 3. The scheduler spreads them across worker nodes.'],
      check: workloadReady('ReplicaSet', 'web-rs', 3),
      hint: 'If the apply failed, read the error: it says which field to fix.',
    },
    {
      id: 'get',
      kind: 'command',
      phase: 'observe',
      title: 'Inspect it',
      body: ['List ReplicaSets to see desired, current and ready counts, then list Pods to see the generated names.'],
      command: 'kubectl get rs',
      check: listed('ReplicaSet'),
      hint: 'Run `kubectl get rs` (or `kubectl get replicasets`), then `kubectl get pods`.',
      explain: ['DESIRED is `replicas`; CURRENT is how many Pods exist; READY is how many are serving.'],
    },
    {
      id: 'delete',
      kind: 'command',
      phase: 'verify',
      title: 'Delete one of its Pods',
      body: ['Copy the name of one web-rs Pod from `kubectl get pods` and delete it. Tab completes names.'],
      command: 'kubectl delete pod web-rs-xxxxx',
      check: deletedOwnedPod(() => 'web-rs'),
      hint: 'Run `kubectl get pods`, then `kubectl delete pod <one of the web-rs-… names>`.',
    },
    {
      id: 'heal',
      kind: 'cluster',
      phase: 'verify',
      title: 'It comes back',
      body: ['The ReplicaSet notices only 2 of 3 Pods and creates a replacement with a new name. Watch it in the 3D view.'],
      check: workloadReady('ReplicaSet', 'web-rs', 3),
      hint: 'Wait a few seconds, then run `kubectl get pods` again.',
      explain: ['This is the core idea of Kubernetes: you declare the desired state, and controllers keep reconciling the real state towards it.'],
    },
    {
      id: 'deployments',
      kind: 'read',
      phase: 'verify',
      title: 'In production: Deployments',
      cards: [
        {
          title: 'You rarely write ReplicaSets yourself',
          body: [
            'A ReplicaSet keeps Pods identical, but cannot roll out a new version gradually. Change its template and existing Pods keep the old one.',
            'In practice you use a Deployment, which manages ReplicaSets for you: one per version, scaling the new one up and the old one down. That is the next lesson.',
          ],
        },
      ],
    },
  ],
};
