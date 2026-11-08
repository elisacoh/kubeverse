import { firstPod, labels, replicaSet, yamlBasics } from './lessons/foundations';
import { configMap, deployment, probes, resources, scaling, service, storage } from './lessons/beyond';
import type { Lesson, LessonId } from './types';

export const LESSONS: readonly Lesson[] = [yamlBasics, firstPod, labels, replicaSet, deployment, scaling, service, configMap, storage, probes, resources];

export const lessonById = (id: LessonId | string | null | undefined): Lesson | undefined => LESSONS.find((l) => l.id === id);

export const lessonCode = (l: Lesson) => `L${String(l.number).padStart(2, '0')}`;

export type * from './types';
