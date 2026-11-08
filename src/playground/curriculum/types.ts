/**
 * Playground lessons are plain data: what to explain, what to write, which
 * commands to run and what the cluster should look like afterwards. The
 * engine (`progress.ts`) and the UI read these definitions; the simulation
 * knows nothing about them.
 */
import type { CommandResult } from '../kubectl/run';
import type { Kind, SimState } from '../sim/types';

export type LessonId =
  | 'yaml-basics'
  | 'first-pod'
  | 'labels'
  | 'replicaset'
  | 'deployment'
  | 'scaling'
  | 'service'
  | 'configmap'
  | 'storage'
  | 'probes'
  | 'resources';

/** The learning loop every lesson follows. */
export type Phase = 'understand' | 'write' | 'deploy' | 'observe' | 'verify';

export type ExerciseMode = 'guided' | 'complete' | 'scratch';

export interface ConceptCard {
  title: string;
  /** Short paragraphs. `inline code` is rendered as code. */
  body: string[];
  code?: string;
  /** Optional deeper explanation, collapsed by default: one paragraph or several. */
  more?: string | string[];
  /** Shown inside the deeper explanation, after its paragraphs. */
  moreCode?: string;
}

/** One objective a manifest must meet. Returns null when met, else what is missing. */
export interface ManifestCheck {
  id: string;
  label: string;
  test: (doc: unknown) => string | null;
}

export interface GuidedStep {
  title: string;
  /** The concept introduced by this step. */
  explain: string[];
  /** What to write now. */
  instruction: string;
  /** Field paths introduced here, shown with their documentation. */
  fields: string[];
  /** Cumulative: this step's checks; earlier steps' checks are re-run too. */
  checks: ManifestCheck[];
  /** A small example of the syntax, revealed on demand. */
  snippet: string;
}

export interface Exercise {
  file: string;
  /** The kind being written (for schema validation and field docs). Absent: plain YAML practice. */
  kind?: Kind;
  objective: string;
  /** What every mode must satisfy at the end. */
  checks: ManifestCheck[];
  /** Absent for small practice exercises, which have a single mode starting from `starter`. */
  modes?: { guided: GuidedStep[]; complete: string; scratch: string; guidedStarter?: string };
  starter?: string;
  /** Hint 1: conceptual clue. Hint 2: the field or structure. Hint 3: a snippet. */
  hints: [string, string, string];
  solution: string;
  solutionNotes: { field: string; note: string }[];
  /** Not a Kubernetes object: once the step is done, applying the file brings this toy to life in the world, for fun. */
  toy?: 'cat';
}

export interface CommandRecord {
  seq: number;
  input: string;
  result: CommandResult;
  /** Simulated time when it ran. */
  time: number;
}

interface StepBase {
  id: string;
  phase: Phase;
  title: string;
}

export interface ReadStep extends StepBase {
  kind: 'read';
  cards: ConceptCard[];
}

export interface QuizStep extends StepBase {
  kind: 'quiz';
  question: string;
  code?: string;
  options: { text: string; correct?: boolean; why: string }[];
}

export interface WriteStep extends StepBase {
  kind: 'write';
  intro?: string[];
  exercise: Exercise;
}

export interface CommandStep extends StepBase {
  kind: 'command';
  body: string[];
  /** Suggested command, shown as a copyable example. */
  command: string;
  /** Met once one of the commands run during this lesson matches. */
  check: (log: readonly CommandRecord[], state: SimState) => boolean;
  hint: string;
  /** Shown once the step is met: what the output means. */
  explain?: string[];
}

export interface ClusterStep extends StepBase {
  kind: 'cluster';
  body: string[];
  /** null when the cluster is in the expected state, else what is still missing. */
  check: (state: SimState) => string | null;
  hint: string;
  explain?: string[];
}

export type Step = ReadStep | QuizStep | WriteStep | CommandStep | ClusterStep;

export interface LessonSetup {
  /** What the lesson expects to already exist. */
  description: string;
  /** True when the cluster lacks it. */
  needed: (state: SimState) => boolean;
  /** Files written to the workspace, then applied. */
  files: Record<string, string>;
  commands: string[];
}

export interface Lesson {
  id: LessonId;
  number: number;
  title: string;
  tagline: string;
  summary: string;
  level: 'Beginner' | 'Intermediate';
  minutes: number;
  concepts: string[];
  prerequisites: LessonId[];
  /** 'complete': fully authored. 'interactive': playable, lighter guidance. */
  depth: 'complete' | 'interactive';
  steps: Step[];
  setup?: LessonSetup;
  /** What the simulation approximates in this lesson, said plainly. */
  simulationNotes?: string[];
  /** 'empty': the lesson builds no cluster object, so the world shows an empty universe. */
  world?: 'empty';
}
