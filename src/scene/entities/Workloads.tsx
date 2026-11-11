import { useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { QuadraticBezierLine } from '@react-three/drei';
import { AdditiveBlending, Vector3, type Group, type Mesh, type MeshStandardMaterial } from 'three';
import type { Cluster, Deployment, Pod, ReplicaSet } from '../../domain/types';
import { controllerRef, findPod, findWorkload, podsControlledBy, workloadsControlledBy } from '../../domain/selectors';
import { useAppStore } from '../../state/useAppStore';
import { conditionColor, palette } from '../palette';
import { podAccent, workloadAccent } from '../accent';
import { componentSlots, nodeLayouts, pendingPodPositions, podWorldPosition, standaloneReplicaSets, workloadPositions, type Vec3 } from '../layout';
import { useHoverHandlers, useIsHovered } from '../interaction';
import { useLearningHighlight } from '../useLearningHighlight';
import { WorldLabel } from '../WorldLabel';
import { LearningBeacon } from './LearningBeacon';

const v = (p: Vec3) => new Vector3(...p);

/**
 * Workload controllers as what they are: API objects that a control loop acts
 * on, not things running on a Node. A Deployment emblem, its ReplicaSets below
 * it, and the Pods that exist without a Node yet. Ownership threads appear
 * only while a controller or one of its Pods is selected.
 */
export function Workloads() {
  const cluster = useAppStore((s) => s.cluster);
  const positions = useMemo(() => workloadPositions(cluster), [cluster]);
  const pending = useMemo(() => pendingPodPositions(cluster), [cluster]);
  /** Waiting Pods sit close together: only the first under each owner keeps a permanent tag, and neighbours' tags alternate height. */
  const slots = useMemo(() => {
    const counts = new Map<string, number>();
    const result = new Map<string, number>();
    for (const p of cluster.pods) {
      if (!pending.has(p.metadata.uid)) continue;
      const owner = controllerRef(p)?.uid ?? '';
      const i = counts.get(owner) ?? 0;
      counts.set(owner, i + 1);
      result.set(p.metadata.uid, i);
    }
    return result;
  }, [cluster, pending]);
  const deployments = cluster.workloads.filter((w): w is Deployment => w.kind === 'Deployment');
  const standalone = standaloneReplicaSets(cluster) as ReplicaSet[];
  const first = deployments[0] ?? standalone[0];
  if (!first && pending.size === 0) return null;

  return (
    <group>
      {first && <ControllerManagerLink cluster={cluster} to={positions.get(first.metadata.uid)} />}
      {standalone.map((rs) => {
        const rsPos = positions.get(rs.metadata.uid);
        return rsPos ? <ReplicaSetEmblem key={rs.metadata.uid} cluster={cluster} replicaSet={rs} position={rsPos} accent={workloadAccent(cluster, rs)} /> : null;
      })}
      {deployments.map((d) => {
        const pos = positions.get(d.metadata.uid);
        if (!pos) return null;
        const owned = workloadsControlledBy(cluster, d.metadata.uid).filter((w): w is ReplicaSet => w.kind === 'ReplicaSet');
        return (
          <group key={d.metadata.uid}>
            <DeploymentEmblem deployment={d} position={pos} accent={workloadAccent(cluster, d)} />
            {owned.map((rs) => {
              const rsPos = positions.get(rs.metadata.uid);
              if (!rsPos) return null;
              return (
                <group key={rs.metadata.uid}>
                  <Link from={pos} to={rsPos} color={workloadAccent(cluster, rs)} opacity={rs.replicas > 0 ? 0.55 : 0.2} lift={0.4} />
                  <ReplicaSetEmblem cluster={cluster} replicaSet={rs} position={rsPos} accent={workloadAccent(cluster, rs)} />
                </group>
              );
            })}
          </group>
        );
      })}
      {cluster.pods.map((p) => {
        const pos = pending.get(p.metadata.uid);
        return pos ? (
          <WaitingPod key={p.metadata.uid} pod={p} position={pos} accent={podAccent(cluster, p)} slot={slots.get(p.metadata.uid) ?? 0} />
        ) : null;
      })}
      <OwnershipThreads cluster={cluster} />
    </group>
  );
}

function Link({ from, to, color, opacity, lift }: { from: Vec3; to: Vec3; color: string; opacity: number; lift: number }) {
  const { a, b, mid } = useMemo(() => {
    const a = v(from);
    const b = v(to);
    return { a, b, mid: a.clone().lerp(b, 0.5).add(new Vector3(0, lift, 0)) };
  }, [from, to, lift]);
  return <QuadraticBezierLine start={a} end={b} mid={mid} color={color} lineWidth={1.4} transparent opacity={opacity} />;
}

/** The controllers that act on these objects live in kube-controller-manager: a faint, dashed reminder. */
function ControllerManagerLink({ cluster, to }: { cluster: Cluster; to: Vec3 | undefined }) {
  const from = useMemo(() => {
    const cm = cluster.controlPlane.find((c) => c.type === 'kube-controller-manager');
    const l = cm && nodeLayouts(cluster).get(cm.nodeName);
    if (!cm || !l) return null;
    const slot = componentSlots['kube-controller-manager'];
    return [l.position[0] + slot[0], l.position[1] + slot[1] + 1.4, l.position[2] + slot[2]] as Vec3;
  }, [cluster]);
  const curve = useMemo(() => {
    if (!from || !to) return null;
    const a = v(from);
    const b = v(to);
    return { a, b, mid: a.clone().lerp(b, 0.5).add(new Vector3(0, 3, 0)) };
  }, [from, to]);
  if (!curve) return null;
  return (
    <QuadraticBezierLine
      start={curve.a}
      end={curve.b}
      mid={curve.mid}
      color={palette.teal}
      lineWidth={1}
      dashed
      dashScale={5}
      dashSize={0.4}
      gapSize={0.5}
      transparent
      opacity={0.3}
    />
  );
}

function useSelectable(uid: string) {
  const selected = useAppStore((s) => s.selection?.kind === 'workload' && s.selection.uid === uid);
  const selectWorkload = useAppStore((s) => s.selectWorkload);
  const hoverId = `workload:${uid}`;
  const hover = useHoverHandlers(hoverId);
  const hovered = useIsHovered(hoverId);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    selectWorkload(uid);
  };
  return { selected, hovered, hover, onClick, select: () => selectWorkload(uid) };
}

function DeploymentEmblem({ deployment: d, position, accent }: { deployment: Deployment; position: Vec3; accent: string }) {
  const { selected, hovered, hover, onClick, select } = useSelectable(d.metadata.uid);
  const highlighted = useLearningHighlight({ kind: 'workload', workloadKind: 'Deployment' });
  const frame = useRef<Group>(null);
  const gem = useRef<Mesh>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const bob = useRef<Group>(null);
  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    if (frame.current) frame.current.rotation.y += delta * 0.35;
    if (gem.current) gem.current.rotation.y -= delta * 0.8;
    if (bob.current) bob.current.position.y = Math.sin(t * 0.9) * 0.12;
    if (mat.current) {
      const target = selected ? 2.2 : hovered ? 1.6 : 1;
      mat.current.emissiveIntensity += (target - mat.current.emissiveIntensity) * 0.1;
    }
  });
  const ready = d.status?.readyReplicas ?? 0;

  return (
    <group position={position}>
      <group ref={bob}>
        <group {...hover} onClick={onClick}>
          <group ref={frame}>
            {/* A blueprint: a hexagonal frame around the template it keeps */}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.85, 0.05, 8, 6]} />
              <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.9} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, Math.PI / 6]} scale={0.72}>
              <torusGeometry args={[0.85, 0.025, 6, 6]} />
              <meshBasicMaterial color={palette.lilac} transparent opacity={0.6} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.82, 6]} />
              <meshBasicMaterial color={accent} transparent opacity={0.08} depthWrite={false} />
            </mesh>
          </group>
          <mesh ref={gem} position={[0, 0.15, 0]}>
            <octahedronGeometry args={[0.32, 0]} />
            <meshStandardMaterial ref={mat} color={accent} emissive={accent} emissiveIntensity={1} roughness={0.25} flatShading />
          </mesh>
          <mesh visible={false}>
            <cylinderGeometry args={[0.95, 0.95, 1, 12]} />
            <meshBasicMaterial />
          </mesh>
        </group>
        {(selected || hovered) && (
          <mesh position={[0, 0.15, 0]} scale={1.9}>
            <sphereGeometry args={[0.5, 20, 14]} />
            <meshBasicMaterial color={accent} transparent opacity={0.07} depthWrite={false} blending={AdditiveBlending} />
          </mesh>
        )}
        <WorldLabel position={[0, 1.05, 0]} center behind>
          <button
            type="button"
            className={`kv-nameplate ${selected ? 'is-active' : ''}`}
            style={{ ['--accent' as string]: accent }}
            onClick={select}
          >
            <span className="kv-nameplate-kind">
              Deployment · {ready}/{d.replicas} ready
            </span>
            {d.metadata.name}
          </button>
        </WorldLabel>
      </group>
      {highlighted && <LearningBeacon radius={1.2} height={2.6} y={-0.9} />}
    </group>
  );
}

function ReplicaSetEmblem({
  cluster,
  replicaSet: rs,
  position,
  accent,
}: {
  cluster: Cluster;
  replicaSet: ReplicaSet;
  position: Vec3;
  accent: string;
}) {
  const { selected, hovered, hover, onClick, select } = useSelectable(rs.metadata.uid);
  const highlighted = useLearningHighlight({ kind: 'workload', workloadKind: 'ReplicaSet' });
  const ring = useRef<Mesh>(null);
  const core = useRef<Mesh>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const idle = rs.replicas === 0 && podsControlledBy(cluster, rs.metadata.uid).length === 0;
  useFrame(({ clock }, delta) => {
    if (ring.current) ring.current.rotation.z += delta * (idle ? 0.1 : 0.6);
    if (core.current) core.current.position.y = Math.sin(clock.elapsedTime * 1.3 + position[0]) * 0.06;
    if (mat.current) {
      const target = (selected ? 2.2 : hovered ? 1.6 : 1) * (idle ? 0.35 : 1);
      mat.current.emissiveIntensity += (target - mat.current.emissiveIntensity) * 0.1;
    }
  });

  return (
    <group position={position}>
      <group {...hover} onClick={onClick}>
        <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.55, 0.045, 10, 40]} />
          <meshStandardMaterial ref={mat} color={accent} emissive={accent} emissiveIntensity={1} transparent opacity={idle ? 0.45 : 1} />
        </mesh>
        {/* One notch per desired replica: the number it keeps. */}
        {Array.from({ length: rs.replicas }, (_, i) => {
          const a = (i / Math.max(rs.replicas, 1)) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55]}>
              <sphereGeometry args={[0.075, 10, 8]} />
              <meshBasicMaterial color={palette.white} />
            </mesh>
          );
        })}
        <mesh ref={core}>
          <icosahedronGeometry args={[0.2, 0]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={idle ? 0.2 : 0.8} flatShading transparent opacity={idle ? 0.5 : 1} />
        </mesh>
        <mesh visible={false}>
          <cylinderGeometry args={[0.7, 0.7, 0.7, 12]} />
          <meshBasicMaterial />
        </mesh>
      </group>
      <WorldLabel position={[0, 0.75, 0]} center behind>
        <button
          type="button"
          className={`kv-nameplate ${selected ? 'is-active' : ''}`}
          style={{ ['--accent' as string]: accent, opacity: idle && !selected ? 0.6 : 1 }}
          onClick={select}
        >
          <span className="kv-nameplate-kind">
            ReplicaSet{rs.revision !== undefined ? ` · rev ${rs.revision}` : ''} · {rs.readyReplicas}/{rs.replicas}
          </span>
          {rs.metadata.name}
        </button>
      </WorldLabel>
      {highlighted && <LearningBeacon radius={0.9} height={2} y={-0.6} />}
    </group>
  );
}

/** A Pod object with no Node yet: a pale, waiting shape — it exists in the API, nothing runs. */
function WaitingPod({ pod, position, accent, slot }: { pod: Pod; position: Vec3; accent: string; slot: number }) {
  const selected = useAppStore((s) => s.selection?.kind === 'pod' && s.selection.uid === pod.metadata.uid);
  const selectPod = useAppStore((s) => s.selectPod);
  const hoverId = `pod:${pod.metadata.uid}`;
  const hover = useHoverHandlers(hoverId);
  const hovered = useIsHovered(hoverId);
  const highlighted = useLearningHighlight({ kind: 'pod', podId: pod.metadata.uid });
  const body = useRef<Group>(null);
  const unschedulable = pod.conditions?.some((c) => c.type === 'PodScheduled' && c.reason === 'Unschedulable');
  const tint = unschedulable ? conditionColor.warning : accent;
  useFrame(({ clock }) => {
    if (!body.current) return;
    const t = clock.elapsedTime + position[0] * 1.7;
    body.current.position.y = Math.sin(t * 1.6) * 0.06;
    const s = pod.terminating ? 0.6 : 1;
    body.current.scale.lerp(new Vector3(s, s, s), 0.1);
  });
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    selectPod(pod.metadata.uid);
  };
  return (
    <group position={position}>
      <group ref={body} {...hover} onClick={onClick}>
        <mesh scale={[1, 1.15, 1]}>
          <sphereGeometry args={[0.24, 18, 14]} />
          <meshStandardMaterial
            color={palette.lilac}
            emissive={tint}
            emissiveIntensity={selected || hovered ? 0.9 : 0.45}
            transparent
            opacity={pod.terminating ? 0.25 : 0.55}
            roughness={0.4}
          />
        </mesh>
        <mesh scale={[1, 1.15, 1]}>
          <sphereGeometry args={[0.26, 12, 10]} />
          <meshBasicMaterial color={tint} wireframe transparent opacity={0.35} />
        </mesh>
      </group>
      {highlighted && <LearningBeacon radius={0.45} height={1.2} y={-0.3} />}
      {(hovered || selected || (unschedulable && slot === 0)) && (
        <WorldLabel position={[0, slot % 2 === 0 ? -0.55 : -1.0, 0]} center style={{ pointerEvents: 'none' }}>
          <div className={`kv-tag whitespace-nowrap ${selected ? 'is-active' : ''}`} style={{ borderColor: tint }}>
            <span className="kv-tag-role">{unschedulable ? 'Pending · no room' : 'Pending · no Node'}</span>
            {hovered || selected ? pod.metadata.name : ''}
          </div>
        </WorldLabel>
      )}
    </group>
  );
}

/** Contextual ownership: the selected controller's Pods, or the selected Pod's way up to its owners. */
function OwnershipThreads({ cluster }: { cluster: Cluster }) {
  const selection = useAppStore((s) => s.selection);
  const threads = useMemo(() => {
    const positions = workloadPositions(cluster);
    const lines: { key: string; from: Vec3; to: Vec3; color: string }[] = [];
    const podLines = (rs: ReplicaSet, only?: string) => {
      const from = positions.get(rs.metadata.uid);
      if (!from) return;
      for (const p of podsControlledBy(cluster, rs.metadata.uid)) {
        if (only && p.metadata.uid !== only) continue;
        const to = podWorldPosition(cluster, p.metadata.uid);
        if (to) lines.push({ key: `${rs.metadata.uid}>${p.metadata.uid}`, from, to: [to[0], to[1] + 0.9, to[2]], color: workloadAccent(cluster, rs) });
      }
    };
    if (selection?.kind === 'workload') {
      const w = findWorkload(cluster, selection.uid);
      if (w?.kind === 'ReplicaSet') podLines(w);
      if (w?.kind === 'Deployment') {
        for (const rs of workloadsControlledBy(cluster, w.metadata.uid)) if (rs.kind === 'ReplicaSet') podLines(rs);
      }
    } else if (selection?.kind === 'pod') {
      const pod = findPod(cluster, selection.uid);
      const ref = pod && controllerRef(pod);
      const rs = ref && findWorkload(cluster, ref.uid);
      if (rs?.kind === 'ReplicaSet') podLines(rs, selection.uid);
    }
    return lines;
  }, [cluster, selection]);

  return (
    <group raycast={() => null}>
      {threads.map((t) => (
        <Thread key={t.key} from={t.from} to={t.to} color={t.color} />
      ))}
    </group>
  );
}

function Thread({ from, to, color }: { from: Vec3; to: Vec3; color: string }) {
  const { a, b, mid } = useMemo(() => {
    const a = v(from);
    const b = v(to);
    return { a, b, mid: a.clone().lerp(b, 0.5).add(new Vector3(0, 1.5 + a.distanceTo(b) * 0.08, 0)) };
  }, [from, to]);
  return (
    <QuadraticBezierLine
      start={a}
      end={b}
      mid={mid}
      color={color}
      lineWidth={1.6}
      dashed
      dashScale={6}
      dashSize={0.6}
      gapSize={0.35}
      transparent
      opacity={0.8}
    />
  );
}
