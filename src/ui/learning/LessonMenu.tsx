import { Check, Lock, PlayCircle } from 'lucide-react';
import { CURRICULUM, isUnlocked } from '../../learning/curriculum';
import { useLearningStore } from '../../learning/useLearningStore';

/** Lesson navigation. Only lessons whose content exists can be started. */
export function LessonMenu({ onClose }: { onClose: () => void }) {
  const current = useLearningStore((s) => s.lesson?.id);
  const completedLessons = useLearningStore((s) => s.completedLessons);
  const startLesson = useLearningStore((s) => s.startLesson);

  return (
    <ol className="mx-3 mb-2 space-y-0.5 rounded-xl border border-white/[0.06] bg-black/20 p-1" aria-label="Lessons">
      {CURRICULUM.map((entry) => {
        const unlocked = isUnlocked(entry, completedLessons);
        const done = completedLessons.includes(entry.id);
        const startable = unlocked && entry.lesson !== undefined && entry.id !== current;
        const status = !unlocked
          ? 'Locked'
          : !entry.lesson
            ? 'Unlocked · content coming soon'
            : entry.id === current
              ? 'Current lesson'
              : done
                ? 'Completed'
                : 'Available';
        const icon = !unlocked ? (
          <Lock className="size-3.5 text-lavender/40" />
        ) : done ? (
          <Check className="size-3.5 text-ok" />
        ) : (
          <PlayCircle className={`size-3.5 ${entry.lesson ? 'text-teal' : 'text-lavender/50'}`} />
        );
        const body = (
          <>
            {icon}
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[12px] ${unlocked ? 'text-white/90' : 'text-lavender/45'}`}>
                {entry.number}. {entry.title}
              </span>
              <span className="block text-[10px] text-lavender/55">{status}</span>
            </span>
          </>
        );
        return (
          <li key={entry.id}>
            {startable ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.06]"
                onClick={() => {
                  startLesson(entry.id);
                  onClose();
                }}
              >
                {body}
              </button>
            ) : (
              <div className="flex items-center gap-2 px-2 py-1.5">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
