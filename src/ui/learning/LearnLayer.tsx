import { selectInspectorOpen, useAppStore } from '../../state/useAppStore';
import { useLearningStore } from '../../learning/useLearningStore';
import { canPerform } from '../../learning/engine';
import { ObjectivePanel } from './ObjectivePanel';
import { LessonCard } from './LessonCard';
import { PodRequestEditor } from './PodRequestEditor';
import { CreationTimeline } from './CreationTimeline';
import { DeploymentEditor } from './DeploymentEditor';
import { ControllersPanel } from './ControllersPanel';

/** Learn-mode overlay: objective panel (top-left) and lesson cards (bottom-right, beside the inspector). */
export function LearnLayer() {
  const learning = useAppStore((s) => s.mode === 'learn');
  const inspectorOpen = useAppStore(selectInspectorOpen);
  const insidePod = useAppStore((s) => s.view.kind === 'pod');
  const lesson = useLearningStore((s) => s.lesson);
  const session = useLearningStore((s) => s.session);
  const card = useLearningStore((s) => s.cards[0]);

  if (!learning || !lesson || !session) return null;

  return (
    <>
      {/* One column, so the bottom panel shrinks instead of sliding under the objectives. */}
      <div className="pointer-events-none fixed bottom-[4.75rem] left-3 top-[6.5rem] z-30 flex flex-col items-start gap-2 sm:bottom-20 sm:left-4 lg:bottom-[6.25rem]">
        <div className="shrink-0">
          <ObjectivePanel lesson={lesson} session={session} />
        </div>
        {!insidePod && (
          <div className="mt-auto flex min-h-0 flex-col items-start gap-2">
            {session.world.controllers ? (
              canPerform(lesson, session, 'create-deployment') ? (
                <DeploymentEditor />
              ) : (
                <ControllersPanel lesson={lesson} session={session} />
              )
            ) : canPerform(lesson, session, 'submit-pod-request') ? (
              <PodRequestEditor session={session} />
            ) : (
              session.world.request && <CreationTimeline session={session} />
            )}
          </div>
        )}
      </div>
      {card && (
        <div
          className={`pointer-events-none fixed bottom-16 right-3 z-40 sm:right-4 lg:bottom-4 ${
            inspectorOpen ? 'lg:right-[412px]' : ''
          }`}
        >
          <LessonCard card={card} lesson={lesson} progress={session.progress} />
        </div>
      )}
    </>
  );
}
