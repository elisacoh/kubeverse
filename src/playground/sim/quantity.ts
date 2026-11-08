/** Kubernetes resource quantities ("500m", "1", "256Mi", "1Gi"), reduced to millicores and MiB. */

const CPU = /^(\d+(?:\.\d+)?)(m?)$/;
const MEMORY = /^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|K|M|G|T|k|m)?$/;

const MEMORY_FACTOR: Record<string, number> = {
  '': 1 / (1024 * 1024),
  Ki: 1 / 1024,
  Mi: 1,
  Gi: 1024,
  Ti: 1024 * 1024,
  k: 1000 / (1024 * 1024),
  K: 1000 / (1024 * 1024),
  M: 1e6 / (1024 * 1024),
  G: 1e9 / (1024 * 1024),
  T: 1e12 / (1024 * 1024),
};

/** Millicores, or null when the value is not a CPU quantity. */
export const parseCpu = (value: string | number): number | null => {
  const m = CPU.exec(String(value).trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === 'm' ? n : n * 1000;
};

/** MiB, or null when the value is not a memory quantity. */
export const parseMemory = (value: string | number): number | null => {
  const m = MEMORY.exec(String(value).trim());
  if (!m) return null;
  // "m" is milli: legal but almost always a mistake for memory ("128m" is 0.128 bytes).
  if (m[2] === 'm') return Number(m[1]) / 1000 / (1024 * 1024);
  return Number(m[1]) * MEMORY_FACTOR[m[2] ?? '']!;
};

export const isQuantity = (value: unknown): boolean =>
  (typeof value === 'string' || typeof value === 'number') && parseMemory(value) !== null;

export const formatCpu = (millis: number) => (millis % 1000 === 0 ? `${millis / 1000}` : `${Math.round(millis)}m`);
export const formatMemory = (mib: number) => (mib >= 1024 && mib % 1024 === 0 ? `${mib / 1024}Gi` : `${Math.round(mib)}Mi`);
