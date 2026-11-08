import { lazy, Suspense, useEffect, useState } from 'react';
import { BookOpen, Boxes, Code2, Globe2, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, TerminalSquare } from 'lucide-react';
import type { Lesson } from '../../playground/curriculum/types';
import { usePlayground } from '../../playground/store';
import { NO_INSETS, useViewportInsets } from '../../state/viewportInsets';
import { CursorField } from './FieldDocs';
import { LessonPanel } from './LessonPanel';
import { MyCluster } from './MyCluster';
import { Splitter, useStoredSize } from './Splitter';
import { Terminal } from './Terminal';

const YamlEditor = lazy(() => import('./YamlEditor'));

const GAP = 12;
/** One-row HUD title card, docked above the lesson panel on wide screens. */
const TITLE_HEIGHT = 44;
const HEADER = GAP + TITLE_HEIGHT + GAP;
/** Below the HUD's regular two-row title card. */
const HEADER_NARROW = 92;
const COLLAPSED_LESSON = 44;
const BUTTON_GUTTER = 44;
const MY_CLUSTER_BAR = 44;

/** Below this width the panels become tabs. */
const WIDE = 1024;

const useWindowSize = () => {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
};

function EditorArea({ lesson }: { lesson: Lesson }) {
  const field = usePlayground((s) => s.field);
  const protectedFiles = lesson.steps.flatMap((s) => (s.kind === 'write' ? [s.exercise.file] : []));
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="min-h-0 flex-1">
        <Suspense fallback={<div className="flex h-full items-center justify-center rounded-2xl border border-white/[0.08] bg-[#0a1230] text-[12px] text-lavender/50">Loading editor…</div>}>
          <YamlEditor protectedFiles={protectedFiles} />
        </Suspense>
      </div>
      <div className="scrollbar-thin max-h-36 shrink-0 overflow-y-auto">
        <CursorField kind={field?.kind ?? null} path={field?.path ?? null} />
      </div>
    </div>
  );
}

/**
 * The lesson workspace: lesson panel on the left, editor and terminal on the
 * right, the live 3D world in between with My Cluster docked under it. On
 * narrow screens the panels become tabs.
 */
export function LessonWorkspace({ lesson }: { lesson: Lesson }) {
  const { w, h } = useWindowSize();
  const wide = w >= WIDE;
  const setInsets = useViewportInsets((s) => s.setInsets);
  const setTitleSlot = useViewportInsets((s) => s.setTitleSlot);
  const [lessonOpen, setLessonOpen] = useState(true);
  const [lessonExpanded, setLessonExpanded] = useState(false);
  const [clusterOpen, setClusterOpen] = useState(true);
  const [left, setLeft] = useStoredSize('kv.pg.left', 370, 300, Math.min(560, w * 0.34));
  const [right, setRight] = useStoredSize('kv.pg.right', Math.round(Math.min(560, w * 0.36)), 360, w * 0.5);
  const [terminal, setTerminal] = useStoredSize('kv.pg.terminal', 260, 140, h - HEADER - 260);
  const [clusterHeight, setClusterHeight] = useStoredSize('kv.pg.cluster', 240, 120, h * 0.5);
  const [tab, setTab] = useState<'lesson' | 'editor' | 'terminal' | 'cluster' | 'world'>('lesson');

  const leftWidth = lessonOpen ? left : COLLAPSED_LESSON;
  const expanded = lessonOpen && lessonExpanded;
  // Expanded, the lesson covers the world up to the editor, leaving a gutter for its buttons.
  const panelWidth = expanded ? Math.max(left, w - right - GAP * 3 - BUTTON_GUTTER) : leftWidth;
  const bottom = clusterOpen ? clusterHeight + GAP : MY_CLUSTER_BAR + GAP;

  useEffect(() => {
    if (wide) setInsets({ top: 0, left: GAP + leftWidth + GAP, right: GAP + right + GAP, bottom: bottom + GAP });
    else setInsets(tab === 'world' ? { ...NO_INSETS, bottom: 64 } : NO_INSETS);
  }, [wide, leftWidth, right, bottom, tab, setInsets]);
  useEffect(() => () => setInsets(NO_INSETS), [setInsets]);
  useEffect(() => {
    setTitleSlot(wide ? { top: GAP, left: GAP, width: lessonOpen ? left : undefined } : null);
  }, [wide, lessonOpen, left, setTitleSlot]);
  useEffect(() => () => setTitleSlot(null), [setTitleSlot]);

  if (!wide) {
    const TABS = [
      { id: 'lesson', label: 'Lesson', icon: BookOpen },
      { id: 'editor', label: 'Editor', icon: Code2 },
      { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
      { id: 'cluster', label: 'Cluster', icon: Boxes },
      { id: 'world', label: '3D', icon: Globe2 },
    ] as const;
    return (
      <>
        {tab !== 'world' && (
          <div className="fixed inset-x-2 bottom-16 z-20 sm:inset-x-3" style={{ top: HEADER_NARROW }}>
            {tab === 'lesson' && <LessonPanel lesson={lesson} />}
            {tab === 'editor' && <EditorArea lesson={lesson} />}
            {tab === 'terminal' && <Terminal />}
            {tab === 'cluster' && <MyCluster collapsed={false} onToggle={() => setTab('world')} />}
          </div>
        )}
        <nav className="glass fixed inset-x-2 bottom-2 z-30 flex rounded-2xl p-1 sm:inset-x-3" aria-label="Workspace panels">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`hud-btn flex-1 flex-col !gap-0.5 !py-1.5 !text-[10.5px] ${tab === id ? '!bg-teal/15 !text-white' : ''}`} aria-pressed={tab === id}>
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>
      </>
    );
  }

  return (
    <>
      <div className={`fixed flex ${expanded ? 'z-30' : 'z-20'}`} style={{ top: HEADER, bottom: GAP, left: GAP, width: panelWidth }}>
        {lessonOpen ? (
          <div className="min-w-0 flex-1">
            <LessonPanel lesson={lesson} />
          </div>
        ) : (
          <button type="button" className="glass flex h-full w-full flex-col items-center gap-2 rounded-2xl pt-3 text-lavender/70 hover:text-white" onClick={() => setLessonOpen(true)} title="Show the lesson">
            <PanelLeftOpen className="size-4" />
            <span className="font-display text-[12px] font-semibold [writing-mode:vertical-rl]">{lesson.title}</span>
          </button>
        )}
      </div>
      {lessonOpen && !expanded && (
        <div className="fixed z-20" style={{ top: HEADER, bottom: GAP, left: GAP + leftWidth }}>
          <Splitter axis="x" size={left} onSize={setLeft} label="Resize the lesson panel" />
        </div>
      )}
      {lessonOpen && (
        <div className="fixed z-30 flex flex-col gap-1.5" style={{ top: HEADER + 4, left: expanded ? GAP + panelWidth + 8 : GAP + leftWidth + GAP + 4 }}>
          <button
            type="button"
            className="glass flex size-7 items-center justify-center rounded-lg text-lavender/70 hover:text-white"
            onClick={() => setLessonExpanded((x) => !x)}
            title={expanded ? 'Shrink the lesson back beside the world' : 'Expand the lesson over the world'}
            aria-pressed={expanded}
          >
            {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
          <button
            type="button"
            className="glass flex size-7 items-center justify-center rounded-lg text-lavender/70 hover:text-white"
            onClick={() => {
              setLessonExpanded(false);
              setLessonOpen(false);
            }}
            title="Collapse the lesson panel"
          >
            <PanelLeftClose className="size-3.5" />
          </button>
        </div>
      )}

      <div className={`fixed z-20 ${expanded ? 'hidden' : ''}`} style={{ left: GAP + leftWidth + GAP, right: GAP + right + GAP, bottom: GAP, height: clusterOpen ? clusterHeight : MY_CLUSTER_BAR }}>
        {clusterOpen && (
          <div className="absolute inset-x-0 -top-2">
            <Splitter axis="y" size={clusterHeight} onSize={setClusterHeight} invert label="Resize My Cluster" />
          </div>
        )}
        <MyCluster collapsed={!clusterOpen} onToggle={() => setClusterOpen((o) => !o)} />
      </div>

      <div className="fixed z-20 flex flex-col" style={{ top: HEADER, bottom: GAP, right: GAP, width: right }}>
        <div className="absolute inset-y-0 -left-2.5">
          <Splitter axis="x" size={right} onSize={setRight} invert label="Resize the editor and terminal" />
        </div>
        <div className="min-h-0 flex-1">
          <EditorArea lesson={lesson} />
        </div>
        <Splitter axis="y" size={terminal} onSize={setTerminal} invert label="Resize the terminal" />
        <div className="shrink-0" style={{ height: terminal }}>
          <Terminal />
        </div>
      </div>
    </>
  );
}
