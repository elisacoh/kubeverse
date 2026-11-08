import { lessonById } from '../../playground/curriculum';
import { usePlayground } from '../../playground/store';
import { useAppStore } from '../../state/useAppStore';
import { ComingSoon } from './ComingSoon';
import { LessonCatalog } from './LessonCatalog';
import { LessonWorkspace } from './LessonWorkspace';
import { PlaygroundHub } from './PlaygroundHub';

/** Playground mode: the hub, the lesson catalog, a lesson workspace, or a mode that is coming soon. */
export function PlaygroundLayer() {
  const playground = useAppStore((s) => s.mode === 'playground');
  const view = usePlayground((s) => s.view);
  const lesson = usePlayground((s) => lessonById(s.lessonId));
  if (!playground) return null;

  if (view === 'workspace' && lesson) return <LessonWorkspace key={lesson.id} lesson={lesson} />;

  return (
    <div className="scrollbar-thin fixed inset-0 z-20 overflow-y-auto bg-[#060a18]/70 backdrop-blur-md">
      {view === 'scenarios' || view === 'hardcore' ? <ComingSoon mode={view} /> : view === 'lessons' || view === 'workspace' ? <LessonCatalog /> : <PlaygroundHub />}
    </div>
  );
}
