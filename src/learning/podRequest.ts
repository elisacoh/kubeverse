import { cpuQuantity, memoryQuantity, toYaml } from '../domain/manifest';
import { REQUEST_RESOURCES } from './sandbox';

/** The Pod definition the learner submits: a minimal, valid v1 Pod manifest. */
export const requestManifestYaml = (name: string, image: string) =>
  toYaml({
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name, namespace: 'default' },
    spec: {
      containers: [
        {
          name: 'web',
          image,
          resources: {
            requests: {
              cpu: cpuQuantity(REQUEST_RESOURCES.cpuMillis),
              memory: memoryQuantity(REQUEST_RESOURCES.memoryMiB),
            },
          },
        },
      ],
    },
  });

/** Marks a stored-object line as added by the API server, part of the status, or neither. */
export const storedLineMark = (submittedYaml: string) => {
  const sent = new Set(submittedYaml.split('\n').map((l) => l.trim()));
  let inStatus = false;
  return (line: string): 'added' | 'status' | null => {
    if (/^\S/.test(line)) inStatus = line.startsWith('status:');
    if (inStatus) return 'status';
    return sent.has(line.trim()) ? null : 'added';
  };
};
