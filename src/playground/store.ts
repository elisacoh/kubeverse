import { create } from 'zustand';
import { LESSONS, lessonById, lessonCode } from './curriculum';
import { validateExercise, type ExerciseValidation } from './curriculum/checks';
import { startingPoint } from './curriculum/startingPoint';
import {
  draftKey,
  emptyProgress,
  frontier,
  markDone,
  modeOf,
  starterFor,
  type LessonProgress,
  type ProgressMap,
} from './curriculum/progress';
import type { CommandRecord, Exercise, ExerciseMode, Lesson, LessonId, WriteStep } from './curriculum/types';
import { runCommand, type OutputLine } from './kubectl/run';
import { SimulatedCluster } from './sim/backend';
import type { Kind, SimState } from './sim/types';
import { toyCommand, type Toy } from './toys';

export type PlaygroundView = 'hub' | 'lessons' | 'workspace' | 'scenarios' | 'hardcore';

export interface TerminalEntry {
  id: number;
  input: string;
  lines: OutputLine[];
  ok: boolean;
  source: 'user' | 'setup' | 'system';
}

export interface ResourceRef {
  kind: Kind;
  name: string;
  namespace: string;
}

/** A YAML field the learner is looking at, for the field explainer. */
export interface FieldFocus {
  kind: Kind | null;
  path: string;
}

interface LoggedCommand extends CommandRecord {
  lessonId: LessonId | null;
}

interface PlaygroundState {
  view: PlaygroundView;
  lessonId: LessonId | null;
  progress: ProgressMap;
  files: Record<string, string>;
  activeFile: string | null;
  drafts: Record<string, string>;
  entries: TerminalEntry[];
  history: string[];
  log: LoggedCommand[];
  busy: boolean;
  sim: SimState;
  selected: ResourceRef | null;
  field: FieldFocus | null;
  /** The line the learner is typing on, while the editor has focus. */
  cursor: { file: string; line: number } | null;
  /** A practice file brought to life by `kubectl apply` (L00's cat). */
  toy: Toy | null;
  /** What was added to the cluster so the lesson starts where the earlier ones left off. */
  prepared: { lessonId: LessonId; items: string[] } | null;
  /** Bumped on each successful check, to play feedback once. */
  celebrate: { stepId: string; seq: number } | null;

  setView: (view: PlaygroundView) => void;
  openLesson: (id: LessonId) => void;
  goToStep: (index: number) => void;
  nextStep: () => void;
  completeRead: (stepId: string) => void;
  answerQuiz: (stepId: string, option: number) => void;
  setMode: (stepId: string, mode: ExerciseMode) => void;
  editFile: (name: string, text: string) => void;
  openFile: (name: string) => void;
  createFile: (name: string) => void;
  deleteFile: (name: string) => void;
  /** Validates the exercise; on success advances the guided step or completes the write step. */
  checkWrite: (stepId: string) => ExerciseValidation | null;
  revealHint: (stepId: string) => void;
  showSolution: (stepId: string) => void;
  applySolution: (stepId: string) => void;
  /** `files` are extra files visible to this command only. */
  run: (input: string, source?: TerminalEntry['source'], files?: Record<string, string>) => Promise<void>;
  clearTerminal: () => void;
  /** Applies what the open lesson expects to already exist: the earlier lessons' objects, then its own setup. */
  prepareLesson: () => Promise<void>;
  resetCluster: () => void;
  restartLesson: (id: LessonId) => void;
  select: (ref: ResourceRef | null) => void;
  setField: (field: FieldFocus | null) => void;
  setCursor: (cursor: { file: string; line: number } | null) => void;
  tick: () => void;
}

/** The cluster behind the terminal. Swap for a remote `ClusterApi` to use a real backend. */
export const cluster = new SimulatedCluster();

const PROGRESS_KEY = 'kubeverse.playground.progress.v1';
const SESSION_KEY = 'kubeverse.playground.session.v1';

const readJson = <T>(storage: Storage | undefined, key: string): T | null => {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};
const local = typeof localStorage === 'undefined' ? undefined : localStorage;
const session = typeof sessionStorage === 'undefined' ? undefined : sessionStorage;

interface SessionSnapshot {
  view?: PlaygroundView;
  lessonId?: LessonId | null;
  files: Record<string, string>;
  activeFile: string | null;
  drafts: Record<string, string>;
  history: string[];
  sim: SimState;
  toy?: Toy | null;
}

const restored = readJson<SessionSnapshot>(session, SESSION_KEY);
if (restored?.sim?.nodes) cluster.load(restored.sim);

const WELCOME: TerminalEntry = {
  id: 0,
  input: '',
  ok: true,
  source: 'system',
  lines: [
    { text: 'KubeVerse Playground: kubectl against a simulated cluster running in your browser.', tone: 'muted' },
    { text: 'Type `help` for commands, Tab to complete, ↑/↓ for history.', tone: 'muted' },
  ],
};

let entrySeq = 1;
let celebrateSeq = 0;

const writeStep = (lesson: Lesson | undefined, stepId: string): WriteStep | undefined => {
  const step = lesson?.steps.find((s) => s.id === stepId);
  return step?.kind === 'write' ? step : undefined;
};

export const usePlayground = create<PlaygroundState>()((set, get) => {
  const lesson = () => lessonById(get().lessonId);
  const progressOf = (id: LessonId) => get().progress[id] ?? emptyProgress();
  const patchProgress = (id: LessonId, fn: (p: LessonProgress) => LessonProgress) =>
    set((s) => ({ progress: { ...s.progress, [id]: fn(s.progress[id] ?? emptyProgress()) } }));

  const done = (stepId: string) => {
    const l = lesson();
    if (!l || progressOf(l.id).done.includes(stepId)) return;
    patchProgress(l.id, (p) => markDone(l, p, stepId, Date.now()));
    set({ celebrate: { stepId, seq: ++celebrateSeq } });
  };

  /** The learner's finished, still valid file from the earlier write step an exercise carries on from. */
  const carried = (ex: Exercise): string | undefined => {
    const src = lessonById(ex.carryFrom?.lesson);
    const from = writeStep(src, ex.carryFrom?.step ?? '');
    if (!src || !from || !get().progress[src.id]?.done.includes(from.id)) return undefined;
    const used = modeOf(get().progress[src.id], from);
    const modes: ExerciseMode[] = [used, ...(['guided', 'complete', 'scratch'] as const).filter((m) => m !== used)];
    return modes.map((m) => get().drafts[draftKey(src.id, from.id, m)]).find((t) => t !== undefined && validateExercise(from.exercise, t, 'scratch', 0).passed);
  };

  /** Puts the exercise text for the current mode in the editor (the saved draft, else the starter). */
  const loadExercise = (l: Lesson, step: WriteStep) => {
    const mode = modeOf(get().progress[l.id], step);
    const text = get().drafts[draftKey(l.id, step.id, mode)] ?? (mode === 'guided' ? carried(step.exercise) : undefined) ?? starterFor(step.exercise, mode);
    set((s) => ({ files: { ...s.files, [step.exercise.file]: text }, activeFile: step.exercise.file }));
  };

  const enterStep = (l: Lesson, index: number) => {
    const step = l.steps[index];
    patchProgress(l.id, (p) => ({ ...p, stepIndex: index }));
    if (step?.kind === 'write') loadExercise(l, step);
    evaluate();
  };

  /** Re-checks the current command or cluster step against the log and the cluster. */
  const evaluate = () => {
    const l = lesson();
    if (!l || get().view !== 'workspace') return;
    const p = progressOf(l.id);
    const step = l.steps[p.stepIndex];
    if (!step || p.done.includes(step.id)) return;
    if (step.kind === 'command') {
      const log = get().log.filter((r) => r.lessonId === l.id);
      if (step.check(log, get().sim)) done(step.id);
    } else if (step.kind === 'cluster') {
      if (step.check(get().sim) === null) done(step.id);
    }
  };

  const systemEntry = (text: string, tone: OutputLine['tone']) =>
    set((s) => ({ entries: [...s.entries, { id: entrySeq++, input: '', ok: true, source: 'system' as const, lines: [{ text, tone }] }].slice(-200) }));

  const prepare = async (l: Lesson) => {
    if (get().lessonId !== l.id) return;
    const actions = startingPoint(l, get().sim);
    const setupNeeded = () => !!l.setup?.needed(get().sim);
    if (!actions.length && !setupNeeded()) return;
    systemEntry(`Bringing the cluster to where ${lessonCode(l)} starts.`, 'muted');
    const items: string[] = [];
    for (const a of actions) {
      await get().run(`kubectl apply -f ${a.file}`, 'setup', { [a.file]: a.text });
      items.push(...a.objects.map((o) => `${o} (${lessonCode(a.from)})`));
    }
    if (l.setup && setupNeeded()) {
      // Recreate what the learner wrote earlier, so the cluster matches the file the lesson starts from.
      const files = { ...l.setup.files };
      for (const s of l.steps) {
        const text = s.kind === 'write' && s.exercise.file in files ? carried(s.exercise) : undefined;
        if (text !== undefined && s.kind === 'write') files[s.exercise.file] = text;
      }
      // Files already open keep the learner's edits; the setup applies its own copy.
      set((s) => ({ files: { ...Object.fromEntries(Object.entries(files).filter(([n]) => !(n in s.files))), ...s.files } }));
      for (const c of l.setup.commands) await get().run(c, 'setup', files);
      items.push(l.setup.description);
    }
    set({ prepared: { lessonId: l.id, items } });
  };
  let preparing: Promise<void> = Promise.resolve();
  const queuePrepare = () => {
    const l = lesson();
    if (!l || get().view !== 'workspace') return preparing;
    preparing = preparing.then(() => prepare(l)).catch(() => undefined);
    return preparing;
  };

  cluster.subscribe((sim) => {
    set({ sim });
    const sel = get().selected;
    if (sel && !sim.objects.some((o) => o.kind === sel.kind && o.metadata.name === sel.name && o.metadata.namespace === sel.namespace)) set({ selected: null });
    evaluate();
  });

  return {
    view: restored?.view === 'workspace' && !lessonById(restored.lessonId) ? 'lessons' : (restored?.view ?? 'hub'),
    lessonId: lessonById(restored?.lessonId)?.id ?? null,
    progress: readJson<ProgressMap>(local, PROGRESS_KEY) ?? {},
    files: restored?.files ?? {},
    activeFile: restored?.activeFile ?? null,
    drafts: restored?.drafts ?? {},
    entries: [WELCOME],
    history: restored?.history ?? [],
    log: [],
    busy: false,
    sim: cluster.snapshot(),
    selected: null,
    field: null,
    cursor: null,
    toy: restored?.toy ?? null,
    prepared: null,
    celebrate: null,

    setView: (view) => set({ view }),

    openLesson: (id) => {
      const l = lessonById(id);
      if (!l) return;
      set({ lessonId: id, view: 'workspace', field: null, prepared: null });
      const p = progressOf(id);
      enterStep(l, Math.min(p.stepIndex, l.steps.length - 1));
      void queuePrepare();
    },

    goToStep: (index) => {
      const l = lesson();
      if (!l || index < 0 || index >= l.steps.length) return;
      enterStep(l, index);
    },

    nextStep: () => {
      const l = lesson();
      if (!l) return;
      const p = progressOf(l.id);
      if (p.stepIndex < l.steps.length - 1) enterStep(l, p.stepIndex + 1);
      else if (!p.completedAt) enterStep(l, frontier(l, p));
    },

    completeRead: (stepId) => done(stepId),

    answerQuiz: (stepId, option) => {
      const l = lesson();
      const step = l?.steps.find((s) => s.id === stepId);
      if (!l || step?.kind !== 'quiz') return;
      patchProgress(l.id, (p) => ({ ...p, quiz: { ...p.quiz, [stepId]: option } }));
      if (step.options[option]?.correct) done(stepId);
    },

    setMode: (stepId, mode) => {
      const l = lesson();
      const step = writeStep(l, stepId);
      if (!l || !step) return;
      const current = modeOf(get().progress[l.id], step);
      if (current === mode) return;
      const text = get().files[step.exercise.file];
      if (text !== undefined) set((s) => ({ drafts: { ...s.drafts, [draftKey(l.id, stepId, current)]: text } }));
      patchProgress(l.id, (p) => ({ ...p, modes: { ...p.modes, [stepId]: mode } }));
      loadExercise(l, step);
    },

    editFile: (name, text) => {
      set((s) => ({ files: { ...s.files, [name]: text } }));
      const l = lesson();
      const step = l?.steps[progressOf(l.id).stepIndex];
      if (l && step?.kind === 'write' && step.exercise.file === name) {
        const key = draftKey(l.id, step.id, modeOf(get().progress[l.id], step));
        set((s) => ({ drafts: { ...s.drafts, [key]: text } }));
      }
    },

    openFile: (name) => set({ activeFile: name }),

    createFile: (name) => {
      if (!(name in get().files)) set((s) => ({ files: { ...s.files, [name]: '' } }));
      set({ activeFile: name });
    },

    deleteFile: (name) =>
      set((s) => {
        const files = { ...s.files };
        delete files[name];
        return { files, activeFile: s.activeFile === name ? (Object.keys(files)[0] ?? null) : s.activeFile };
      }),

    checkWrite: (stepId) => {
      const l = lesson();
      const step = writeStep(l, stepId);
      if (!l || !step) return null;
      const p = progressOf(l.id);
      const mode = modeOf(p, step);
      const guidedSteps = step.exercise.modes?.guided.length ?? 0;
      const g = Math.min(p.guided[stepId] ?? 0, Math.max(guidedSteps - 1, 0));
      const result = validateExercise(step.exercise, get().files[step.exercise.file] ?? '', mode, g);
      if (!result.passed) return result;
      // Skip past later guided steps the text already satisfies, e.g. after pasting a full manifest.
      let next = g + 1;
      while (mode === 'guided' && next < guidedSteps && validateExercise(step.exercise, get().files[step.exercise.file] ?? '', mode, next).passed) next++;
      if (mode === 'guided' && next < guidedSteps) {
        patchProgress(l.id, (q) => ({ ...q, guided: { ...q.guided, [stepId]: next } }));
        set({ celebrate: { stepId: `${stepId}#${g}`, seq: ++celebrateSeq } });
      } else {
        if (mode === 'guided') patchProgress(l.id, (q) => ({ ...q, guided: { ...q.guided, [stepId]: guidedSteps } }));
        done(stepId);
      }
      return result;
    },

    revealHint: (stepId) => {
      const id = get().lessonId;
      if (id) patchProgress(id, (p) => ({ ...p, hints: { ...p.hints, [stepId]: Math.min((p.hints[stepId] ?? 0) + 1, 3) } }));
    },

    showSolution: (stepId) => {
      const id = get().lessonId;
      if (id) patchProgress(id, (p) => ({ ...p, hints: { ...p.hints, [stepId]: 3 }, solutionViewed: p.solutionViewed.includes(stepId) ? p.solutionViewed : [...p.solutionViewed, stepId] }));
    },

    applySolution: (stepId) => {
      const step = writeStep(lesson(), stepId);
      if (!step) return;
      get().showSolution(stepId);
      get().editFile(step.exercise.file, step.exercise.solution);
      set({ activeFile: step.exercise.file });
    },

    run: async (input, source = 'user', extraFiles) => {
      const line = input.trim();
      if (source === 'user' && line) set((s) => ({ history: [...s.history.filter((h) => h !== line), line].slice(-100) }));
      set({ busy: true });
      const fun = source === 'setup' ? null : toyCommand(line, { files: get().files, progress: get().progress, toy: get().toy });
      let result = fun && 'result' in fun ? fun.result : await runCommand(line, { api: cluster, files: { ...get().files, ...extraFiles } });
      if (fun && 'hint' in fun) result = { ...result, lines: [...result.lines, fun.hint] };
      if (fun && 'result' in fun) set({ toy: fun.toy });
      // Setup commands are not the learner's work, so they never count toward a lesson's checks.
      const record: LoggedCommand = { seq: get().log.length, input: line, result, time: cluster.snapshot().time, lessonId: source === 'setup' ? null : get().lessonId };
      set((s) => ({
        busy: false,
        log: [...s.log, record].slice(-500),
        entries: result.clear ? [] : [...s.entries, { id: entrySeq++, input: line, lines: result.lines, ok: result.ok, source }].slice(-200),
      }));
      evaluate();
    },

    clearTerminal: () => set({ entries: [] }),

    prepareLesson: () => queuePrepare(),

    resetCluster: () => {
      cluster.reset();
      set({ selected: null, toy: null, prepared: null });
      systemEntry('Cluster reset: every object you created was removed. Your files and lesson progress are kept.', 'warn');
      void queuePrepare();
    },

    restartLesson: (id) => {
      set((s) => ({
        progress: { ...s.progress, [id]: emptyProgress() },
        drafts: Object.fromEntries(Object.entries(s.drafts).filter(([k]) => !k.startsWith(`${id}/`))),
        log: s.log.filter((r) => r.lessonId !== id),
      }));
      const l = lessonById(id);
      if (l && get().lessonId === id) enterStep(l, 0);
    },

    select: (selected) => set({ selected }),
    setField: (field) => set({ field }),
    setCursor: (cursor) => {
      const c = get().cursor;
      if (c?.file !== cursor?.file || c?.line !== cursor?.line) set({ cursor });
    },
    tick: () => cluster.tick(),
  };
});

void usePlayground.getState().prepareLesson();

// Persistence: progress outlives the session; files, drafts and the cluster last for the browser session.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
usePlayground.subscribe((next, prev) => {
  if (next.progress !== prev.progress) local?.setItem(PROGRESS_KEY, JSON.stringify(next.progress));
  if (next.files === prev.files && next.drafts === prev.drafts && next.sim === prev.sim && next.history === prev.history && next.activeFile === prev.activeFile && next.view === prev.view && next.lessonId === prev.lessonId && next.toy === prev.toy) return;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const s = usePlayground.getState();
    const snap: SessionSnapshot = { view: s.view, lessonId: s.lessonId, files: s.files, activeFile: s.activeFile, drafts: s.drafts, history: s.history, sim: s.sim, toy: s.toy };
    try {
      session?.setItem(SESSION_KEY, JSON.stringify(snap));
    } catch {
      // Storage full or unavailable: the session simply is not restored.
    }
  }, 1000);
});

export const currentLesson = (s: Pick<PlaygroundState, 'lessonId'>) => lessonById(s.lessonId);
export const lessonsDone = (s: Pick<PlaygroundState, 'progress'>) => LESSONS.filter((l) => s.progress[l.id]?.completedAt).length;
