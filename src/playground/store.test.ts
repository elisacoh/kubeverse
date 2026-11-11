import { describe, expect, it } from 'vitest';
import { lessonById } from './curriculum';
import { draftKey, emptyProgress } from './curriculum/progress';
import { cluster, usePlayground } from './store';
import { findObject } from './sim/cluster';

const MINE = `apiVersion: v1
kind: Pod
metadata:
  name: hello-pod
spec:
  containers:
    - name: nginx
      image: nginx:stable
`;

describe('carrying a file from one lesson to the next', () => {
  it("starts L02's guided exercise from the learner's own L01 pod.yaml, and recreates that Pod", async () => {
    cluster.reset();
    usePlayground.setState({
      progress: { 'first-pod': { ...emptyProgress(), done: ['write'] } },
      drafts: { [draftKey('first-pod', 'write', 'guided')]: MINE },
      files: {},
    });
    const labels = lessonById('labels')!;
    usePlayground.getState().openLesson('labels');
    usePlayground.getState().goToStep(labels.steps.findIndex((s) => s.kind === 'write'));
    expect(usePlayground.getState().files['pod.yaml']).toBe(MINE);

    await usePlayground.getState().prepareLesson();
    const pod = findObject(usePlayground.getState().sim, 'Pod', 'hello-pod');
    expect(pod?.spec.containers[0]?.name).toBe('nginx');
    expect(pod?.spec.containers[0]?.ports).toBeUndefined();
  });

  it('falls back to the lesson starter when the earlier file is not valid any more', () => {
    usePlayground.setState({
      progress: { 'first-pod': { ...emptyProgress(), done: ['write'] } },
      drafts: { [draftKey('first-pod', 'write', 'guided')]: 'apiVersion: v1\nkind: Pod\n' },
      files: {},
    });
    const labels = lessonById('labels')!;
    usePlayground.getState().openLesson('labels');
    usePlayground.getState().goToStep(labels.steps.findIndex((s) => s.kind === 'write'));
    expect(usePlayground.getState().files['pod.yaml']).toMatch(/name: web/);
  });
});
