import { canPerform } from '../learning/engine';
import { useLearningStore } from '../learning/useLearningStore';
import { useAppStore } from '../state/useAppStore';

/** True while a lesson waits for the learner to bring the cluster to life: the universe stays dark around the seed. */
export function useAwaitingCluster(): boolean {
  const learning = useAppStore((s) => s.mode === 'learn');
  const awaiting = useLearningStore(
    (s) => !!s.lesson && !!s.session && canPerform(s.lesson, s.session, 'initialize-cluster'),
  );
  return learning && awaiting;
}
