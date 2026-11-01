import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line, QuadraticBezierLine, RoundedBox } from '@react-three/drei';
import { BackSide, DoubleSide, type Mesh } from 'three';
import type { Pod } from '../../domain/types';
import { findPod } from '../../domain/selectors';
import { useAppStore } from '../../state/useAppStore';
import { namespaceColorOf, palette } from '../palette';
import type { Vec3 } from '../layout';
import { WorldLabel } from '../WorldLabel';
import { ContainerModule } from './ContainerModule';

const NETNS_Y = 0;
const NETNS_RADIUS = 3.5;
const MEMBRANE_CENTER_Y = 1.2;
const KERNEL_Y = -2.9;

/**
 * Inside a Pod.
 *  - Membrane  = the Pod sandbox: a set of Linux namespaces shared by its containers.
 *  - Floor     = the shared network namespace (one IP, one localhost, one port space).
 *  - Modules   = containers, each with its own process and filesystem.
 *  - Below, *outside* the Pod: the Node's kernel, where cgroups actually live.
 */
export function PodAnatomy() {
  const cluster = useAppStore((s) => s.cluster);
  const podUid = useAppStore((s) => (s.view.kind === 'pod' ? s.view.podUid : null));
  const pod = podUid ? findPod(cluster, podUid) : undefined;
  if (!pod) return null;
  return <Anatomy pod={pod} />;
}

const containerSlots = (n: number): Vec3[] => {
  if (n === 1) return [[0, NETNS_Y, 0.4]];
  const spread = Math.min(Math.PI * 0.8, 0.95 * (n - 1));
  return Array.from({ length: n }, (_, i) => {
    const a = -spread / 2 + (spread * i) / (n - 1);
    return [Math.sin(a) * 1.9, NETNS_Y, Math.cos(a) * 1.9 - 1.1];
  });
};

function Anatomy({ pod }: { pod: Pod }) {
  const essentials = useAppStore((s) => s.presentation.anatomy === 'essentials');
  const nsColor = namespaceColorOf(pod.metadata.namespace);
  const netColor = pod.hostNetwork ? palette.gold : palette.teal;
  const slots = useMemo(() => containerSlots(pod.containers.length), [pod.containers.length]);
  const membrane = useRef<Mesh>(null);

  useFrame(({ clock }) => {
    if (!membrane.current) return;
    const s = 1 + Math.sin(clock.elapsedTime * 0.8) * 0.008;
    membrane.current.scale.set(4.6 * s, 3.3 / s, 4.6 * s);
  });

  const eth0: Vec3 = [NETNS_RADIUS - 0.35, NETNS_Y + 0.02, 1.4];
  const pausePos: Vec3 = [-2.3, NETNS_Y, -1.6];
  const podCgroupWidth = Math.max(3.4, slots.length * 1.9 + 1);

  return (
    <group>
      {/* ---------------- Pod sandbox membrane ---------------- */}
      <mesh ref={membrane} position={[0, MEMBRANE_CENTER_Y, 0]} scale={[4.6, 3.3, 4.6]}>
        <sphereGeometry args={[1, 64, 48]} />
        <meshPhysicalMaterial
          color={nsColor}
          transparent
          opacity={0.07}
          roughness={0.1}
          clearcoat={1}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, MEMBRANE_CENTER_Y, 0]} scale={[4.66, 3.36, 4.66]}>
        <sphereGeometry args={[1, 48, 32]} />
        <meshBasicMaterial color={nsColor} transparent opacity={0.05} side={BackSide} depthWrite={false} />
      </mesh>
      <WorldLabel position={[-3.4, MEMBRANE_CENTER_Y + 2.7, 0]} center style={{ pointerEvents: 'none' }}>
        {essentials ? (
          <div className="kv-callout">
            <b>Pod · {pod.metadata.name}</b>
            <span>phase {pod.phase}</span>
          </div>
        ) : (
          <div className="kv-callout">
            <b>Pod sandbox</b>
            <span>{pod.metadata.name}</span>
          </div>
        )}
      </WorldLabel>

      {/* ---------------- Shared network namespace ---------------- */}
      <mesh position={[0, NETNS_Y - 0.06, 0]} receiveShadow>
        <cylinderGeometry args={[NETNS_RADIUS, NETNS_RADIUS * 0.96, 0.12, 96]} />
        <meshStandardMaterial color={palette.deep} roughness={0.6} />
      </mesh>
      <mesh position={[0, NETNS_Y + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[NETNS_RADIUS - 0.08, NETNS_RADIUS, 128]} />
        <meshBasicMaterial color={netColor} />
      </mesh>
      <mesh position={[0, NETNS_Y + 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[NETNS_RADIUS - 0.08, 96]} />
        <meshBasicMaterial color={netColor} transparent opacity={0.09} />
      </mesh>
      <WorldLabel position={[1.7, NETNS_Y - 0.1, NETNS_RADIUS - 0.3]} style={{ pointerEvents: 'none' }}>
        <div className="kv-callout is-net">
          <b>{pod.hostNetwork ? "Node's network namespace (hostNetwork)" : 'Shared network namespace'}</b>
          <span>one IP · one localhost · one port space for all containers</span>
        </div>
      </WorldLabel>

      {/* localhost links between containers */}
      {slots.flatMap((a, i) =>
        slots.slice(i + 1).map((b, j) => (
          <QuadraticBezierLine
            key={`${i}-${j}`}
            start={[a[0], NETNS_Y + 0.05, a[2]]}
            end={[b[0], NETNS_Y + 0.05, b[2]]}
            mid={[(a[0] + b[0]) / 2, NETNS_Y + 0.05, (a[2] + b[2]) / 2 + 1.1]}
            color={netColor}
            lineWidth={1.5}
            dashed
            dashSize={0.15}
            gapSize={0.1}
          />
        )),
      )}
      {slots.length > 1 && (
        <WorldLabel position={[0, NETNS_Y + 0.15, (slots[0]![2] + 1.1) * 0.9]} center style={{ pointerEvents: 'none' }}>
          <div className="kv-tag is-net">localhost</div>
        </WorldLabel>
      )}

      {/* eth0: the Pod's single network interface */}
      <group position={eth0}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.16, 0.26, 32]} />
          <meshBasicMaterial color={netColor} side={DoubleSide} />
        </mesh>
        <mesh position={[0, 0.1, 0]}>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshStandardMaterial color={netColor} emissive={netColor} emissiveIntensity={1.8} />
        </mesh>
        <WorldLabel position={[0.2, 0.55, 0]} center style={{ pointerEvents: 'none' }}>
          <div className="kv-tag is-net">
            {pod.hostNetwork ? 'host interface' : 'eth0'} · {pod.podIP ?? 'no IP'}
          </div>
        </WorldLabel>
      </group>
      <Line
        points={[eth0, [eth0[0] + 0.9, MEMBRANE_CENTER_Y - 2.6, eth0[2] + 0.5], [eth0[0] + 1.1, KERNEL_Y + 0.08, eth0[2] + 0.6]]}
        color={netColor}
        lineWidth={1.5}
        dashed
        dashSize={0.12}
        gapSize={0.08}
        transparent
        opacity={0.8}
      />

      {/* pause / sandbox container holds the namespaces open */}
      {!essentials && (
        <group position={pausePos}>
          <mesh position={[0, 0.3, 0]} castShadow>
            <capsuleGeometry args={[0.18, 0.3, 6, 16]} />
            <meshStandardMaterial color="#8891b3" roughness={0.5} />
          </mesh>
          <WorldLabel position={[0, 1.05, 0]} center style={{ pointerEvents: 'none' }}>
            <div className="kv-tag">
              <span className="kv-tag-role">infra</span>pause
            </div>
          </WorldLabel>
        </group>
      )}

      {/* containers */}
      {pod.containers.map((c, i) => (
        <ContainerModule
          key={c.name}
          podUid={pod.metadata.uid}
          container={c}
          position={slots[i]!}
          color={c.role === 'sidecar' ? palette.lavender : nsColor}
          showState={essentials}
        />
      ))}

      <SharedVolumes pod={pod} slots={slots} />

      {/* init containers ran to completion before the app containers started */}
      {pod.initContainers.map((c, i) => (
        <ContainerModule
          key={c.name}
          podUid={pod.metadata.uid}
          container={c}
          position={[1.5 + i * 1.0, NETNS_Y, -2.3]}
          color="#8891b3"
          ghost
        />
      ))}

      {essentials ? <NodeFloor pod={pod} /> : <NodeKernel pod={pod} slots={slots} width={podCgroupWidth} />}
    </group>
  );
}

/** Pod volumes, each linked to the containers that mount it. Nothing else is shared on disk. */
function SharedVolumes({ pod, slots }: { pod: Pod; slots: Vec3[] }) {
  return (pod.volumes ?? []).map((v, vi) => {
    const at: Vec3 = [vi * 1.3, NETNS_Y, -1.15];
    const mounts = pod.containers.flatMap((c, i) =>
      c.volumeMounts?.some((m) => m.name === v.name) && slots[i] ? [{ name: c.name, slot: slots[i] }] : [],
    );
    return (
      <group key={v.name}>
        <group position={at}>
          <mesh position={[0, 0.17, 0]} castShadow>
            <cylinderGeometry args={[0.3, 0.3, 0.34, 32]} />
            <meshStandardMaterial color={palette.gold} emissive={palette.warm} emissiveIntensity={0.35} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.345, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.16, 0.24, 32]} />
            <meshBasicMaterial color={palette.white} transparent opacity={0.7} />
          </mesh>
          <WorldLabel position={[0, -0.2, -0.45]} center style={{ pointerEvents: 'none' }}>
            <div className="kv-tag whitespace-nowrap">
              <span className="kv-tag-role">volume</span>
              {v.name} · {v.source}
            </div>
          </WorldLabel>
        </group>
        {mounts.map((m) => (
          <Line
            key={m.name}
            points={[
              [at[0], NETNS_Y + 0.2, at[2]],
              [m.slot[0], NETNS_Y + 0.2, m.slot[2]],
            ]}
            color={palette.gold}
            lineWidth={2}
            dashed
            dashSize={0.1}
            gapSize={0.07}
          />
        ))}
      </group>
    );
  });
}

/** The Node under the Pod, without kernel internals (for lessons that have not introduced them). */
function NodeFloor({ pod }: { pod: Pod }) {
  return (
    <group position={[0, KERNEL_Y, 0]}>
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <cylinderGeometry args={[8.5, 8.2, 0.2, 6]} />
        <meshStandardMaterial color="#1d2552" roughness={0.85} flatShading />
      </mesh>
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 6]}>
        <ringGeometry args={[8.2, 8.45, 6]} />
        <meshBasicMaterial color={palette.cyan} transparent opacity={0.4} />
      </mesh>
      <WorldLabel position={[3.7, 0.1, 2.5]} center style={{ pointerEvents: 'none' }}>
        <div className="kv-callout is-kernel">
          <b>Node {pod.nodeName}</b>
          <span>the machine this Pod runs on</span>
        </div>
      </WorldLabel>
    </group>
  );
}

/** The Node's kernel, outside the Pod. cgroups (resource accounting & limits) live here. */
function NodeKernel({ pod, slots, width }: { pod: Pod; slots: Vec3[]; width: number }) {
  const qos = pod.qosClass.toLowerCase();
  const cgroupParent = pod.qosClass === 'Guaranteed' ? 'kubepods' : `kubepods/${qos}`;
  const centerZ = slots.reduce((sum, s) => sum + s[2], 0) / Math.max(slots.length, 1);
  return (
    <group position={[0, KERNEL_Y, 0]}>
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <cylinderGeometry args={[8.5, 8.2, 0.2, 6]} />
        <meshStandardMaterial color="#231d45" roughness={0.85} flatShading />
      </mesh>
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 6]}>
        <ringGeometry args={[8.2, 8.45, 6]} />
        <meshBasicMaterial color={palette.warm} transparent opacity={0.55} />
      </mesh>
      <gridHelper args={[14, 28, '#4a3d6e', '#2c2552']} position={[0, 0.01, 0]} />
      <WorldLabel position={[3.7, 0.1, 2.5]} center style={{ pointerEvents: 'none' }}>
        <div className="kv-callout is-kernel">
          <b>Node {pod.nodeName} · Linux kernel</b>
          <span>cgroups &amp; namespaces are kernel features of the Node — not objects inside the Pod</span>
        </div>
      </WorldLabel>

      {/* Pod-level cgroup */}
      <RoundedBox args={[width, 0.08, 2]} radius={0.04} position={[0, 0.06, centerZ]}>
        <meshStandardMaterial color={palette.slate} transparent opacity={0.85} />
      </RoundedBox>
      <WorldLabel position={[-width / 2 + 0.2, 0.2, centerZ - 1.15]} style={{ pointerEvents: 'none' }}>
        <div className="kv-tag is-kernel whitespace-nowrap">
          cgroup · {cgroupParent}/pod{pod.metadata.uid.slice(4, 12)}…
        </div>
      </WorldLabel>

      {slots.map((s, i) => {
        const c = pod.containers[i]!;
        return (
          <group key={c.name}>
            <RoundedBox args={[0.8, 0.1, 0.8]} radius={0.04} position={[s[0], 0.13, s[2]]}>
              <meshStandardMaterial color={palette.warm} emissive={palette.warm} emissiveIntensity={0.5} />
            </RoundedBox>
            <Line
              points={[
                [s[0], 0.18, s[2]],
                [s[0], -KERNEL_Y - 0.02, s[2]],
              ]}
              color={palette.warm}
              lineWidth={1}
              dashed
              dashSize={0.1}
              gapSize={0.1}
              transparent
              opacity={0.6}
            />
          </group>
        );
      })}
    </group>
  );
}
