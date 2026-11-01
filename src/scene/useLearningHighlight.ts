import { useAppStore } from '../state/useAppStore';
import { highlightMatches, type HighlightSubject } from '../learning/highlight';
import { selectActiveHighlight, useLearningStore } from '../learning/useLearningStore';

/** True when the active lesson asks the scene to emphasise this object. */
export function useLearningHighlight(subject: HighlightSubject): boolean {
  const learning = useAppStore((s) => s.mode === 'learn');
  const matches = useLearningStore((s) => highlightMatches(selectActiveHighlight(s), subject));
  return learning && matches;
}
