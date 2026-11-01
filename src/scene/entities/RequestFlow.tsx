import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { QuadraticBezierLine, RoundedBox } from '@react-three/drei';
import { AdditiveBlending, QuadraticBezierCurve3, Vector3, type Group, type Mesh, type MeshBasicMaterial } from 'three';
import type { Cluster } from '../../domain/types';
import { newEvents, timelineEvents, type FlowAnchor, type FlowHop, type HopTone } from '../../learning/creationFlow';
import type { SandboxWorld } from '../../learning/sandbox';
import { useLearningStore } from '../../learning/useLearningStore';
import { useAppStore } from '../../state/useAppStore';
import { useFlowStore } from '../../state/useFlowStore';
import { componentSlots, nodeLayouts, podWorldPosition, type Vec3 } from '../layout';
import { conditionColor, palette } from '../palette';
import { WorldLabel } from '../WorldLabel';
import { RUNTIME_OFFSET } from './KubeletBeacon';

const CLIENT: Vec3 = [0, 8, 16];
const HOP_S = 1.1;

const TONE_COLOR: Record<HopTone, string> = {
  request: palette.gold,
  watch: palette.cyan,
  write: palette.lavender,
  cri: palette.teal,
  process: palette.gold,
  reject: conditionColor.failed,
  fit: conditionColor.ok,
  'no-fit': conditionColor.failed,
};

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** World position of an anchor of the creation flow, or null if it is not in the world. */
const anchorPosition = (cluster: Cluster, anchor: FlowAnchor): Vec3 | null => {
  const layouts = nodeLayouts(cluster);
  switch (anchor.kind) {
    case 'client':
      return CLIENT;
    case 'component': {
      const c = cluster.controlPlane.find((x) => x.type === anchor.component);
      const l = c && layouts.get(c.nodeName);
      if (!l) return null;
      const lift: Vec3 = anchor.component === 'kube-apiserver' ? [0, 1.7, 0.4] : [0, 1.1, 0];
      return add(add(l.position, componentSlots[anchor.component]), lift);
    }
    case 'agent': {
      const l = layouts.get(anchor.node);
      if (!l) return null;
      const base = add(l.position, l.kubelet);
      return anchor.agent === 'kubelet' ? add(base, [0, 1.05, 0]) : add(add(base, RUNTIME_OFFSET), [0, 0.8, 0]);
    }
    case 'node': {
      const l = layouts.get(anchor.node);
      return l ? add(l.position, [0, 0.9, 0]) : null;
    }
    case 'pod': {
      const p = podWorldPosition(cluster, anchor.podId);
      return p ? add(p, [0, 0.5, 0]) : null;
    }
  }
};

/**
 * Lesson 3's request in the world: the request waiting at the API server,
 * the object stored in etcd, and short animations of the messages exchanged
 * when something happens. Purely visual; the engine decides what happened.
 */
export function RequestFlow() {
  const world = useLearningStore((s) => s.session?.world);
  const cluster = useAppStore((s) => s.cluster);
  const play = useFlowStore((s) => s.play);
  const events = useMemo(() => (world ? timelineEvents(world, cluster) : []), [world, cluster]);
  // Initialised with the current events, so remounting the world does not replay them.
  const shown = useRef(events);

  useEffect(() => {
    const fresh = newEvents(shown.current, events);
    shown.current = events;
    if (fresh.length) play(fresh.flatMap((e) => e.hops));
  }, [events, play]);

  if (!world?.request || world.controllers) return <HopPlayer cluster={cluster} />;
  return (
    <>
      <RequestToken world={world} cluster={cluster} />
      <StoredRecord world={world} cluster={cluster} />
      <HopPlayer cluster={cluster} />
    </>
  );
}

/** The submitted Pod definition, waiting at the API server's door until it is processed. */
function RequestToken({ world, cluster }: { world: SandboxWorld; cluster: Cluster }) {
  const stage = world.request?.stage;
  const selectComponent = useAppStore((s) => s.selectComponent);
  const api = cluster.controlPlane.find((c) => c.type === 'kube-apiserver');
  const door = useMemo(() => {
    const p = anchorPosition(cluster, { kind: 'component', component: 'kube-apiserver' });
    return p ? add(p, [0, -0.6, 1.6]) : null;
  }, [cluster]);
  const group = useRef<Group>(null);
  const t = useRef(0);

  useFrame(({ clock }, delta) => {
    if (!group.current || !door) return;
    t.current = Math.min(1, t.current + delta / 1.4);
    const k = 1 - Math.pow(1 - t.current, 3);
    const from = new Vector3(...CLIENT);
    const to = new Vector3(...door);
    group.current.position.lerpVectors(from, to, k);
    if (stage === 'rejected') group.current.position.y -= 0.25;
    group.current.position.y += Math.sin(clock.elapsedTime * 2) * 0.06 * k;
    group.current.rotation.y = Math.sin(clock.elapsedTime * 0.8) * 0.4;
  });

  if (!door || (stage !== 'submitted' && stage !== 'rejected')) return null;
  const rejected = stage === 'rejected';
  const color = rejected ? conditionColor.failed : palette.gold;

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (api) selectComponent(api.uid);
  };

  return (
    <group ref={group} position={CLIENT}>
      <group onClick={onClick}>
        <RoundedBox args={[0.62, 0.42, 0.08]} radius={0.04} smoothness={3}>
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} roughness={0.4} />
        </RoundedBox>
        <mesh position={[0, 0.02, 0.05]}>
          <sphereGeometry args={[0.1, 16, 12]} />
          <meshStandardMaterial color={palette.cyan} emissive={palette.cyan} emissiveIntensity={1.2} />
        </mesh>
        <mesh scale={1.8}>
          <sphereGeometry args={[0.3, 16, 12]} />
          <meshBasicMaterial color={color} transparent opacity={0.08} depthWrite={false} blending={AdditiveBlending} />
        </mesh>
      </group>
      <WorldLabel position={[0, 0.5, 0]} center style={{ pointerEvents: 'none' }}>
        <div className="kv-tag whitespace-nowrap">
          <span className="kv-tag-role">{rejected ? 'rejected' : 'request'}</span>
          {rejected ? 'nothing stored' : `POST Pod · ${world.request?.name}`}
        </div>
      </WorldLabel>
    </group>
  );
}

/** The Pod object as stored in etcd: a small hologram card above it. */
function StoredRecord({ world, cluster }: { world: SandboxWorld; cluster: Cluster }) {
  const req = world.request;
  const selectComponent = useAppStore((s) => s.selectComponent);
  const etcd = cluster.controlPlane.find((c) => c.type === 'etcd');
  const pos = useMemo(() => {
    const p = anchorPosition(cluster, { kind: 'component', component: 'etcd' });
    return p ? add(p, [0, 1.15, 0]) : null;
  }, [cluster]);
  const card = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!card.current) return;
    card.current.rotation.y = clock.elapsedTime * 0.5;
    card.current.position.y = Math.sin(clock.elapsedTime * 1.4) * 0.06;
  });
  if (!req || !pos || req.stage === 'submitted' || req.stage === 'rejected') return null;

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (etcd) selectComponent(etcd.uid);
  };
  const status = req.nodeName ? `${req.stage === 'running' ? 'Running' : 'Pending'} · ${req.nodeName}` : 'Pending · no Node';

  return (
    <group position={pos}>
      <group ref={card} onClick={onClick}>
        <mesh>
          <boxGeometry args={[0.5, 0.34, 0.03]} />
          <meshBasicMaterial color={palette.lavender} transparent opacity={0.35} depthWrite={false} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.52, 0.36, 0.02]} />
          <meshBasicMaterial color={palette.lilac} wireframe transparent opacity={0.6} />
        </mesh>
      </group>
      <WorldLabel position={[0, 0.42, 0]} center style={{ pointerEvents: 'none' }}>
        <div className="kv-tag whitespace-nowrap">
          <span className="kv-tag-role">stored</span>
          {req.name} · {status}
        </div>
      </WorldLabel>
    </group>
  );
}

/** Plays the current cue: one message at a time, each a short-lived arc with a travelling light. */
function HopPlayer({ cluster }: { cluster: Cluster }) {
  const cue = useFlowStore((s) => s.cue);
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [cue]);
  if (!cue) return null;
  const hop = cue.hops[index];
  if (!hop) return null;
  return (
    <Hop
      key={`${cue.seq}:${index}`}
      hop={hop}
      cluster={cluster}
      onDone={() => setIndex((i) => i + 1)}
    />
  );
}

function Hop({ hop, cluster, onDone }: { hop: FlowHop; cluster: Cluster; onDone: () => void }) {
  const from = anchorPosition(cluster, hop.from);
  const to = anchorPosition(cluster, hop.to);
  const color = TONE_COLOR[hop.tone];
  const inPlace = !!from && !!to && from.every((v, i) => v === to[i]);
  // Anchors are read once: a hop lasts about a second.
  const [curve] = useState(() => {
    if (!from || !to) return null;
    const a = new Vector3(...from);
    const b = new Vector3(...to);
    const mid = a.clone().lerp(b, 0.5).add(new Vector3(0, 1.2 + a.distanceTo(b) * 0.15, 0));
    const path = new QuadraticBezierCurve3(a, mid, b);
    const top = path.getPoint(0.5);
    const label: Vec3 = inPlace ? add(from, [0, 0.9, 0]) : [top.x, top.y + 0.35, top.z];
    return { a, b, mid, path, label };
  });
  const t = useRef(0);
  const done = useRef(false);
  const dot = useRef<Mesh>(null);
  const burst = useRef<Mesh>(null);
  const burstMat = useRef<MeshBasicMaterial>(null);

  useFrame((_, delta) => {
    t.current = Math.min(1, t.current + delta / HOP_S);
    const k = t.current;
    if (curve && !inPlace && dot.current) {
      curve.path.getPoint(Math.min(1, k * 1.15), dot.current.position);
    }
    if (burst.current && burstMat.current) {
      burst.current.scale.setScalar(0.3 + k * 1.6);
      burstMat.current.opacity = 0.7 * (1 - k);
    }
    if (k >= 1 && !done.current) {
      done.current = true;
      onDone();
    }
  });

  if (!from || !curve) {
    // An anchor is not in the world (e.g. inside a Pod's anatomy view): skip it.
    return <SkipHop onDone={onDone} />;
  }

  return (
    <group raycast={() => null}>
      {!inPlace && (
        <>
          <QuadraticBezierLine
            start={curve.a}
            end={curve.b}
            mid={curve.mid}
            color={color}
            lineWidth={1.6}
            transparent
            opacity={0.7}
            dashed={hop.tone === 'watch'}
            dashScale={8}
            dashSize={0.5}
            gapSize={0.35}
          />
          <mesh ref={dot} position={from}>
            <sphereGeometry args={[0.12, 16, 12]} />
            <meshBasicMaterial color={color} />
          </mesh>
        </>
      )}
      <mesh ref={burst} position={inPlace ? from : [curve.b.x, curve.b.y, curve.b.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.4, 0.48, 32]} />
        <meshBasicMaterial ref={burstMat} color={color} transparent depthWrite={false} blending={AdditiveBlending} />
      </mesh>
      {hop.label && (
        <WorldLabel position={curve.label} center style={{ pointerEvents: 'none' }}>
          <div className="kv-tag whitespace-nowrap" style={{ borderColor: color }}>
            {hop.label}
          </div>
        </WorldLabel>
      )}
    </group>
  );
}

function SkipHop({ onDone }: { onDone: () => void }) {
  useEffect(() => onDone(), [onDone]);
  return null;
}
