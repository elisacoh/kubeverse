import { birthOfACluster } from './lessons/birthOfACluster';
import { meetYourFirstPod } from './lessons/meetYourFirstPod';
import { behindTheScenes } from './lessons/behindTheScenes';
import { desiredState } from './lessons/desiredState';
import type { Lesson } from './types';

export interface CurriculumEntry {
  id: string;
  number: number;
  title: string;
  /** Present only for lessons whose content exists. */
  lesson?: Lesson;
  /** Lesson that must be completed first. */
  unlockedBy?: string;
}

export const CURRICULUM: readonly CurriculumEntry[] = [
  { id: birthOfACluster.id, number: 1, title: birthOfACluster.title, lesson: birthOfACluster },
  {
    id: meetYourFirstPod.id,
    number: 2,
    title: meetYourFirstPod.title,
    lesson: meetYourFirstPod,
    unlockedBy: birthOfACluster.id,
  },
  {
    id: behindTheScenes.id,
    number: 3,
    title: behindTheScenes.title,
    lesson: behindTheScenes,
    unlockedBy: meetYourFirstPod.id,
  },
  {
    id: desiredState.id,
    number: 4,
    title: desiredState.title,
    lesson: desiredState,
    unlockedBy: behindTheScenes.id,
  },
  { id: 'failure-and-recovery', number: 5, title: 'When Things Go Wrong', unlockedBy: desiredState.id },
];

export const findLesson = (id: string): Lesson | undefined => CURRICULUM.find((e) => e.id === id)?.lesson;

export const isUnlocked = (entry: CurriculumEntry, completedLessons: readonly string[]) =>
  !entry.unlockedBy || completedLessons.includes(entry.unlockedBy);

export const canStart = (lessonId: string, completedLessons: readonly string[]) => {
  const entry = CURRICULUM.find((e) => e.id === lessonId);
  return !!entry?.lesson && isUnlocked(entry, completedLessons);
};

/** Where Learn mode opens: the first unlocked lesson not yet completed, else the last one available. */
export const defaultLesson = (completedLessons: readonly string[]): Lesson => {
  const startable = CURRICULUM.filter((e) => e.lesson && isUnlocked(e, completedLessons));
  const next = startable.find((e) => !completedLessons.includes(e.id)) ?? startable.at(-1);
  return next?.lesson ?? birthOfACluster;
};
