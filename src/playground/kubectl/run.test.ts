import { describe, expect, it } from 'vitest';
import { SimulatedCluster } from '../sim/backend';
import { settle } from '../sim/cluster';
import { completions, runCommand, tokenize, type ShellContext } from './run';

const POD = `apiVersion: v1
kind: Pod
metadata:
  name: hello-pod
  labels:
    app: hello
spec:
  containers:
    - name: nginx
      image: nginx:stable
`;

const setup = (files: Record<string, string> = { 'pod.yaml': POD }) => {
  const api = new SimulatedCluster();
  const ctx: ShellContext = { api, files };
  const run = async (cmd: string) => {
    const r = await runCommand(cmd, ctx);
    return { ...r, text: r.lines.map((l) => l.text).join('\n') };
  };
  const settleAll = () => api.load(settle(api.snapshot()));
  return { api, ctx, run, settleAll };
};

describe('kubectl', () => {
  it('apply creates, then reports unchanged', async () => {
    const { run } = setup();
    const first = await run('kubectl apply -f pod.yaml');
    expect(first.ok).toBe(true);
    expect(first.text).toBe('pod/hello-pod created');
    expect(first.effects[0]).toMatchObject({ verb: 'apply', kind: 'Pod', name: 'hello-pod', action: 'created' });
    expect((await run('kubectl apply -f pod.yaml')).text).toBe('pod/hello-pod unchanged');
  });

  it('get pods reflects the simulated state over time', async () => {
    const { run, settleAll } = setup();
    expect((await run('kubectl get pods')).text).toBe('No resources found in default namespace.');
    await run('kubectl apply -f pod.yaml');
    expect((await run('kubectl get pods')).text).toMatch(/hello-pod\s+0\/1\s+Pending/);
    settleAll();
    const ready = await run('kubectl get pods -o wide');
    expect(ready.text).toMatch(/hello-pod\s+1\/1\s+Running\s+0/);
    expect(ready.text).toMatch(/10\.244\.\d+\.\d+\s+worker-\d/);
  });

  it('get pod <name>, label selectors and --show-labels', async () => {
    const { run, settleAll } = setup();
    await run('kubectl apply -f pod.yaml');
    settleAll();
    expect((await run('kubectl get pod hello-pod')).ok).toBe(true);
    expect((await run('kubectl get pod nope')).text).toMatch(/pods "nope" not found/);
    expect((await run('kubectl get pods -l app=hello')).text).toMatch(/hello-pod/);
    expect((await run('kubectl get pods -l app=other')).text).toMatch(/No resources found/);
    expect((await run('kubectl get pods --show-labels')).text).toMatch(/app=hello/);
  });

  it('describe shows status, node and events', async () => {
    const { run, settleAll } = setup();
    await run('kubectl apply -f pod.yaml');
    settleAll();
    const d = await run('kubectl describe pod hello-pod');
    expect(d.text).toMatch(/Status:\s+Running/);
    expect(d.text).toMatch(/Node:\s+worker-\d\/192\.168\.49\.\d/);
    expect(d.text).toMatch(/Scheduled .* Successfully assigned default\/hello-pod/);
    expect(d.text).toMatch(/QoS Class:\s+BestEffort/);
  });

  it('delete -f removes the Pod', async () => {
    const { run, settleAll } = setup();
    await run('kubectl apply -f pod.yaml');
    settleAll();
    expect((await run('kubectl delete -f pod.yaml')).text).toBe('pod "hello-pod" deleted');
    expect((await run('kubectl get pods')).text).toMatch(/Terminating/);
    settleAll();
    expect((await run('kubectl get pods')).text).toMatch(/No resources found/);
    expect((await run('kubectl delete pod hello-pod')).text).toMatch(/NotFound/);
  });

  it('reports YAML and schema errors from the file without touching the cluster', async () => {
    const { run, api } = setup({ 'pod.yaml': 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: x\nspec:\n  containers:\n    - name: a\n' });
    const r = await run('kubectl apply -f pod.yaml');
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/missing required field "image"/);
    expect(api.snapshot().objects).toHaveLength(0);
    expect((await run('kubectl apply -f missing.yaml')).text).toMatch(/does not exist/);
  });

  it('get deployments, replicasets and all for a Deployment', async () => {
    const dep = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
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
    const { run, settleAll } = setup({ 'deployment.yaml': dep });
    await run('kubectl apply -f deployment.yaml');
    settleAll();
    expect((await run('kubectl get deployments')).text).toMatch(/web\s+3\/3\s+3\s+3/);
    expect((await run('kubectl get rs')).text).toMatch(/web-[a-z0-9]{10}\s+3\s+3\s+3/);
    const all = await run('kubectl get all');
    expect(all.text).toMatch(/pod\/web-/);
    expect(all.text).toMatch(/service\/kubernetes/);
    expect(all.text).toMatch(/deployment\.apps\/web/);
    expect(all.text).toMatch(/replicaset\.apps\/web-/);
    expect((await run('kubectl scale deployment web --replicas=5')).ok).toBe(true);
    settleAll();
    expect((await run('kubectl get deploy web')).text).toMatch(/5\/5/);
  });

  it('gives helpful errors for typos', async () => {
    const { run } = setup();
    expect((await run('kubeclt get pods')).text).toMatch(/Did you mean kubectl/);
    expect((await run('kubectl get pdos')).text).toMatch(/doesn't have a resource type "pdos"/);
    expect((await run('kubectl apply pod.yaml')).text).toMatch(/must specify one of -f/);
  });

  it('explain uses the field documentation', async () => {
    const { run } = setup();
    const r = await run('kubectl explain pod.spec.containers.image');
    expect(r.text).toMatch(/FIELD: image <string> -required-/);
  });

  it('tokenizes quotes and completes names', () => {
    expect(tokenize(`kubectl exec p -- echo "a b"`)).toEqual(['kubectl', 'exec', 'p', '--', 'echo', 'a b']);
    const { ctx } = setup();
    expect(completions('kubectl apply -f p', ctx)).toEqual(['pod.yaml']);
    expect(completions('kubectl ge', ctx)).toEqual(['get']);
  });
});
