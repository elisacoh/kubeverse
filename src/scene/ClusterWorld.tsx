import { useMemo } from 'react';
import { useAppStore } from '../state/useAppStore';
import { nodeLayouts } from './layout';
import { retainAppearances } from './appearance';
import { NodePlatform } from './entities/NodePlatform';
import { ControlPlaneIsland } from './entities/ControlPlaneIsland';
import { ApiServerLinks, SiblingThreads } from './entities/Connections';
import { BuildSites } from './entities/BuildSites';
import { RequestFlow } from './entities/RequestFlow';
import { Workloads } from './entities/Workloads';
import { ControllerFlow } from './entities/ControllerFlow';
import { PlaygroundObjects } from './entities/PlaygroundObjects';
import { PlaygroundToy } from './entities/PlaygroundToy';

/** The cluster overview world: control-plane island, worker islands and their links. */
export function ClusterWorld() {
  const cluster = useAppStore((s) => s.cluster);
  const learning = useAppStore((s) => s.mode === 'learn');
  const playground = useAppStore((s) => s.mode === 'playground');
  const layouts = useMemo(() => nodeLayouts(cluster), [cluster]);
  // During render, so entities mounting in this same pass already see the pruned set.
  useMemo(
    () => retainAppearances([...cluster.nodes.map((n) => n.metadata.uid), ...cluster.pods.map((p) => p.metadata.uid)]),
    [cluster],
  );
  let workerIndex = 0;

  return (
    <group>
      {cluster.nodes.map((n) => {
        const layout = layouts.get(n.metadata.name);
        if (!layout) return null;
        return n.role === 'control-plane' ? (
          <ControlPlaneIsland key={n.metadata.uid} node={n} layout={layout} />
        ) : (
          <NodePlatform key={n.metadata.uid} node={n} layout={layout} index={workerIndex++} />
        );
      })}
      <ApiServerLinks />
      {/* In Learn and Playground, ownership is drawn from the controllers themselves (Workloads). */}
      {!learning && !playground && <SiblingThreads />}
      {learning && <BuildSites />}
      {learning && <RequestFlow />}
      {(learning || playground) && <Workloads />}
      {learning && <ControllerFlow />}
      {playground && <PlaygroundObjects />}
      {playground && <PlaygroundToy />}
    </group>
  );
}
