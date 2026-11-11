import { useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { QuadraticBezierLine } from '@react-three/drei';
import { Vector3, type Group } from 'three';
import { useAppStore } from '../../state/useAppStore';
import { usePlayground, type ResourceRef } from '../../playground/store';
import { isDeleting, serviceEndpoints } from '../../playground/sim/cluster';
import type { KObject, SimState } from '../../playground/sim/types';
import { podWorldPosition, type Vec3 } from '../layout';
import { useHoverHandlers, useIsHovered } from '../interaction';
import { WorldLabel } from '../WorldLabel';
import { palette } from '../palette';

type Shelved = Extract<KObject, { kind: 'Service' | 'ConfigMap' | 'PersistentVolumeClaim' }>;

/** One column per kind, to the left of the control plane: API objects that do not run anywhere. */
const COLUMNS: Record<Shelved['kind'], { x: number; color: string; label: string }> = {
  Service: { x: -10.5, color: palette.cyan, label: 'Service' },
  ConfigMap: { x: -13.5, color: palette.gold, label: 'ConfigMap' },
  PersistentVolumeClaim: { x: -16.5, color: palette.lavender, label: 'PVC' },
};
const SHELF_Y = 5.4;
const SHELF_Z = -1;
const SHELF_SPACING = 2.6;

const isShelved = (o: KObject): o is Shelved => o.kind in COLUMNS;

/** Where each shelved object sits, by uid. */
export const shelfPositions = (objects: readonly KObject[]): Map<string, Vec3> => {
  const counts: Record<string, number> = {};
  const out = new Map<string, Vec3>();
  for (const o of objects) {
    if (!isShelved(o)) continue;
    const i = counts[o.kind] ?? 0;
    counts[o.kind] = i + 1;
    out.set(o.metadata.uid, [COLUMNS[o.kind].x, SHELF_Y, SHELF_Z + i * SHELF_SPACING]);
  }
  return out;
};

/** Pods (by uid) an object relates to: a Service's endpoints, Pods reading a ConfigMap or mounting a claim. */
const relatedPods = (s: SimState, o: Shelved): string[] => {
  const pods = s.objects.filter((p) => p.kind === 'Pod' && !isDeleting(p));
  if (o.kind === 'Service') {
    const ready = new Set(serviceEndpoints(s, o).filter((e) => e.ready).map((e) => e.podName));
    return pods.filter((p) => ready.has(p.metadata.name)).map((p) => p.metadata.uid);
  }
  const name = o.metadata.name;
  return pods
    .filter((p) => {
      if (p.kind !== 'Pod') return false;
      if (o.kind === 'PersistentVolumeClaim') return (p.spec.volumes ?? []).some((v) => v.persistentVolumeClaim?.claimName === name);
      return (
        (p.spec.volumes ?? []).some((v) => v.configMap?.name === name) ||
        p.spec.containers.some((c) => (c.envFrom ?? []).some((e) => e.configMapRef?.name === name) || (c.env ?? []).some((e) => e.valueFrom?.configMapKeyRef?.name === name))
      );
    })
    .map((p) => p.metadata.uid);
};

const subtitle = (s: SimState, o: Shelved) => {
  if (o.kind === 'Service') {
    const n = serviceEndpoints(s, o).filter((e) => e.ready).length;
    return `${o.spec.type} · ${n} endpoint${n === 1 ? '' : 's'}`;
  }
  if (o.kind === 'ConfigMap') {
    const n = Object.keys(o.data).length;
    return `${n} key${n === 1 ? '' : 's'}`;
  }
  return o.status.phase === 'Bound' ? `Bound · ${o.status.capacity ?? o.spec.resources.requests.storage}` : 'Pending';
};

/**
 * The Playground's fallback for objects the world has no native form for:
 * small glyphs on a shelf beside the control plane, with threads to the Pods
 * they relate to while hovered or selected.
 */
export function PlaygroundObjects() {
  const sim = usePlayground((s) => s.sim);
  const universe = useAppStore((s) => s.cluster.nodes.length === 0);
  const shelved = useMemo(() => (universe ? [] : sim.objects.filter(isShelved)), [sim, universe]);
  const placed = useMemo(() => {
    const positions = shelfPositions(shelved);
    return shelved.map((o) => ({ o, position: positions.get(o.metadata.uid)! }));
  }, [shelved]);
  return (
    <group>
      {placed.map(({ o, position }) => (
        <Glyph key={o.metadata.uid} object={o} position={position} sim={sim} />
      ))}
    </group>
  );
}

function Glyph({ object: o, position, sim }: { object: Shelved; position: Vec3; sim: SimState }) {
  const ref: ResourceRef = { kind: o.kind, name: o.metadata.name, namespace: o.metadata.namespace };
  const selected = usePlayground((s) => s.selected?.kind === o.kind && s.selected.name === o.metadata.name);
  const select = usePlayground((s) => s.select);
  const hoverId = `pg:${o.metadata.uid}`;
  const hover = useHoverHandlers(hoverId);
  const hovered = useIsHovered(hoverId);
  const cluster = useAppStore((s) => s.cluster);
  const body = useRef<Group>(null);
  const { color, label } = COLUMNS[o.kind];
  const pending = o.kind === 'PersistentVolumeClaim' && o.status.phase !== 'Bound';

  useFrame(({ clock }, delta) => {
    if (!body.current) return;
    body.current.rotation.y += delta * (selected ? 0.9 : 0.3);
    body.current.position.y = Math.sin(clock.elapsedTime * 1.1 + position[2]) * 0.08;
  });

  const targets = useMemo(() => {
    if (!selected && !hovered) return [];
    return relatedPods(sim, o)
      .map((uid) => podWorldPosition(cluster, uid))
      .filter((p): p is Vec3 => !!p);
  }, [selected, hovered, sim, o, cluster]);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    select(selected ? null : ref);
  };

  return (
    <group>
      <group position={position}>
        <group ref={body} {...hover} onClick={onClick}>
          {o.kind === 'Service' && (
            <>
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.5, 0.06, 10, 32]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected || hovered ? 1.8 : 0.9} />
              </mesh>
              <mesh>
                <sphereGeometry args={[0.16, 16, 12]} />
                <meshStandardMaterial color={palette.white} emissive={color} emissiveIntensity={0.6} />
              </mesh>
            </>
          )}
          {o.kind === 'ConfigMap' && (
            <mesh>
              <boxGeometry args={[0.7, 0.5, 0.08]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected || hovered ? 1.4 : 0.6} roughness={0.5} />
            </mesh>
          )}
          {o.kind === 'PersistentVolumeClaim' && (
            <mesh>
              <cylinderGeometry args={[0.35, 0.35, 0.6, 20]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={selected || hovered ? 1.4 : 0.6}
                wireframe={pending}
                transparent
                opacity={pending ? 0.6 : 1}
              />
            </mesh>
          )}
          <mesh visible={false}>
            <sphereGeometry args={[0.75, 10, 8]} />
            <meshBasicMaterial />
          </mesh>
        </group>
        <WorldLabel position={[0, 0.9, 0]} center behind>
          <button type="button" className={`kv-nameplate ${selected ? 'is-active' : ''}`} style={{ ['--accent' as string]: color }} onClick={() => select(selected ? null : ref)}>
            <span className="kv-nameplate-kind">
              {label} · {subtitle(sim, o)}
            </span>
            {o.metadata.name}
          </button>
        </WorldLabel>
      </group>
      {targets.map((t, i) => (
        <Thread key={i} from={position} to={[t[0], t[1] + 0.9, t[2]]} color={color} />
      ))}
    </group>
  );
}

function Thread({ from, to, color }: { from: Vec3; to: Vec3; color: string }) {
  const { a, b, mid } = useMemo(() => {
    const a = new Vector3(...from);
    const b = new Vector3(...to);
    return { a, b, mid: a.clone().lerp(b, 0.5).add(new Vector3(0, 1.5 + a.distanceTo(b) * 0.06, 0)) };
  }, [from, to]);
  return <QuadraticBezierLine start={a} end={b} mid={mid} color={color} lineWidth={1.4} dashed dashScale={6} dashSize={0.5} gapSize={0.35} transparent opacity={0.75} raycast={() => null} />;
}
