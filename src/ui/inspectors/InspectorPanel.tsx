import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useAppStore } from '../../state/useAppStore';
import { buildManifest, type Manifest, type ManifestTarget } from '../../domain/manifest';
import { PodInspector } from './PodInspector';
import { NodeInspector } from './NodeInspector';
import { ComponentInspector } from './ComponentInspector';
import { ContainerInspector } from './ContainerInspector';
import { AgentInspector } from './AgentInspector';
import { WorkloadInspector } from './WorkloadInspector';
import { ManifestView } from './ManifestView';
import { InspectorTabsContext, type InspectorTab } from './parts';

/** Right-hand contextual panel. Slides in over the world; never replaces it. */
export function InspectorPanel() {
  const view = useAppStore((s) => s.view);
  const selection = useAppStore((s) => s.selection);
  const cluster = useAppStore((s) => s.cluster);
  // Kept across selections so the learner can browse manifests object by object.
  const [tab, setTab] = useState<InspectorTab>('details');

  let content: ReactNode = null;
  let key = '';
  let target: ManifestTarget | null = null;
  if (selection?.kind === 'pod') {
    content = <PodInspector uid={selection.uid} />;
    key = `pod:${selection.uid}`;
    target = { kind: 'pod', uid: selection.uid };
  } else if (selection?.kind === 'component') {
    content = <ComponentInspector uid={selection.uid} />;
    key = `component:${selection.uid}`;
    target = { kind: 'component', uid: selection.uid };
  } else if (selection?.kind === 'container') {
    content = <ContainerInspector podUid={selection.podUid} name={selection.name} />;
    key = `container:${selection.podUid}:${selection.name}`;
    target = { kind: 'container', podUid: selection.podUid, name: selection.name };
  } else if (selection?.kind === 'workload') {
    content = <WorkloadInspector uid={selection.uid} />;
    key = `workload:${selection.uid}`;
    target = { kind: 'workload', uid: selection.uid };
  } else if (selection?.kind === 'agent') {
    content = <AgentInspector nodeName={selection.nodeName} agent={selection.agent} />;
    key = `agent:${selection.nodeName}:${selection.agent}`;
  } else if (view.kind === 'node' && !view.closeUp) {
    content = <NodeInspector nodeName={view.nodeName} />;
    key = `node:${view.nodeName}`;
    target = { kind: 'node', name: view.nodeName };
  }

  const manifest = target ? buildManifest(cluster, target) : null;

  // Keep the last content mounted while sliding out.
  const last = useRef<{ key: string; content: ReactNode; manifest: Manifest | null }>({
    key: '',
    content: null,
    manifest: null,
  });
  if (content) last.current = { key, content, manifest };
  const open = content !== null;
  const shown = last.current;
  const showManifest = tab === 'manifest' && shown.manifest !== null;
  const tabs = useMemo(() => ({ tab: showManifest ? tab : ('details' as const), setTab }), [showManifest, tab]);

  return (
    <aside
      aria-hidden={!open}
      className={`pointer-events-none fixed bottom-16 right-3 top-[92px] z-20 flex w-[360px] max-w-[calc(100vw-1.5rem)] transition-all duration-300 ease-out sm:right-4 lg:bottom-4 xl:w-[380px] ${
        open ? 'translate-x-0 opacity-100' : 'translate-x-[110%] opacity-0'
      }`}
    >
      <div
        key={shown.key}
        className={`glass scrollbar-thin flex max-h-full w-full flex-col gap-3 self-start overflow-y-auto rounded-2xl p-4 ${
          open ? 'pointer-events-auto' : ''
        }`}
      >
        <InspectorTabsContext.Provider value={shown.manifest ? tabs : null}>
          {/* The manifest tab keeps the inspector's header and hides its detail sections. */}
          <div className={showManifest ? 'contents [&>*:not(:first-child)]:hidden' : 'contents'}>{shown.content}</div>
        </InspectorTabsContext.Provider>
        {showManifest && shown.manifest && <ManifestView manifest={shown.manifest} />}
      </div>
    </aside>
  );
}
