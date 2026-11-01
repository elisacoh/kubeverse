import { demoCluster } from '../domain/demoCluster';
import type { ClusterSource } from './types';

/** Sprint 0 source: a frozen demo snapshot. Swap for an engine-backed source later. */
export const staticDemoSource: ClusterSource = {
  kind: 'static-demo',
  snapshot: () => demoCluster,
};
