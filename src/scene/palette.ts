import type { PodCondition } from '../domain/selectors';

export const palette = {
  void: '#060a18',
  navy: '#0b1430',
  deep: '#121d42',
  surface: '#23306a',
  slate: '#2c3a6e',
  rock: '#2b3576',
  rockDark: '#1c2456',
  teal: '#3fd4c0',
  cyan: '#6fe3ff',
  lavender: '#b3a4ff',
  lilac: '#d7ccff',
  warm: '#ffb37a',
  gold: '#ffd38a',
  coral: '#ff8a7a',
  ink: '#0d1226',
  white: '#f3f6ff',
} as const;

/** Pod body tint per namespace — the most visible identity dimension. */
export const namespaceColor: Record<string, string> = {
  'kube-system': '#a99cf2',
  shop: '#4fd6c4',
  analytics: '#f5b48c',
  default: '#9cc6dd',
};

export const namespaceColorOf = (ns: string | undefined) =>
  (ns && namespaceColor[ns]) ?? '#b8c4e0';

/** Accent shared by Pods that belong to the same root workload. */
const workloadAccents = ['#ffd38a', '#7fe8ff', '#ff9fb7', '#b7f59a', '#c6b6ff', '#ffb37a'];

export const accentFor = (key: string): string => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return workloadAccents[h % workloadAccents.length]!;
};

export const conditionColor: Record<PodCondition, string> = {
  ok: '#5ff0c8',
  warning: '#ffb84d',
  failed: '#ff6b6b',
  done: '#8892b0',
};

export const nodeAccent: Record<string, string> = {
  'cp-1': palette.gold,
  'worker-aurora': palette.teal,
  'worker-borealis': palette.cyan,
  'worker-cascade': palette.lavender,
  'control-plane-1': palette.gold,
  'worker-1': palette.teal,
  'worker-2': palette.cyan,
};

export const nodeAccentOf = (name: string) => nodeAccent[name] ?? palette.teal;
