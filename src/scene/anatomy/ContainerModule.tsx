import { useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import type { Group, Mesh } from 'three';
import type { Container } from '../../domain/types';
import { useAppStore } from '../../state/useAppStore';
import { conditionColor, palette } from '../palette';
import { useHoverHandlers, useIsHovered } from '../interaction';
import type { Vec3 } from '../layout';
import { WorldLabel } from '../WorldLabel';
import { useLearningHighlight } from '../useLearningHighlight';
import { LearningBeacon } from '../entities/LearningBeacon';

interface Props {
  podUid: string;
  container: Container;
  position: Vec3;
  color: string;
  ghost?: boolean;
  /** Spell out the container state in its tag (Waiting · reason, Running, Terminated · exit code). */
  showState?: boolean;
}

const stateText = (c: Container) => {
  const s = c.status;
  if (s.state === 'running') return 'Running';
  if (s.state === 'waiting') return `Waiting · ${s.reason}`;
  return `Terminated · exit ${s.exitCode}`;
};

export const CONTAINER_HEIGHT = 1.5;

/** One container: an isolated module with its own process (PID 1) glowing inside. */
export function ContainerModule({ podUid, container, position, color, ghost, showState }: Props) {
  const highlighted = useLearningHighlight({ kind: 'container', podId: podUid, role: container.role });
  const id = `container:${podUid}:${container.name}`;
  const selected = useAppStore(
    (s) => s.selection?.kind === 'container' && s.selection.podUid === podUid && s.selection.name === container.name,
  );
  const selectContainer = useAppStore((s) => s.selectContainer);
  const hovered = useIsHovered(id);
  const hover = useHoverHandlers(id);
  const core = useRef<Mesh>(null);
  const root = useRef<Group>(null);

  const st = container.status.state;
  const statusColor =
    st === 'running' ? conditionColor.ok : st === 'waiting' ? conditionColor.warning : conditionColor.done;
  const isApp = container.role === 'app';
  const w = isApp ? 1.15 : 0.85;
  const h = isApp ? CONTAINER_HEIGHT : CONTAINER_HEIGHT * 0.8;

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    if (core.current) {
      if (st === 'running') {
        core.current.rotation.y = t * 1.2;
        core.current.scale.setScalar(1 + Math.sin(t * 3) * 0.06);
      } else if (st === 'waiting') {
        // Crash-looping: flickers on and off.
        core.current.scale.setScalar(Math.sin(t * 5) > 0.3 ? 1 : 0.35);
      } else {
        core.current.scale.setScalar(0.5);
      }
    }
    if (root.current) {
      const target = hovered || selected ? 0.12 : 0;
      root.current.position.y += (target - root.current.position.y) * Math.min(1, delta * 8);
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    selectContainer(podUid, container.name);
  };

  return (
    <group position={position}>
      <group ref={root} {...hover} onClick={onClick}>
        <RoundedBox args={[w, h, w]} radius={0.16} smoothness={4} position={[0, h / 2 + 0.05, 0]} castShadow>
          <meshPhysicalMaterial
            color={color}
            roughness={0.25}
            clearcoat={1}
            transparent
            opacity={ghost ? 0.3 : 0.78}
            depthWrite={false}
          />
        </RoundedBox>
        {/* frame */}
        <RoundedBox args={[w + 0.04, 0.12, w + 0.04]} radius={0.05} position={[0, 0.06, 0]}>
          <meshStandardMaterial color={palette.slate} metalness={0.4} roughness={0.4} />
        </RoundedBox>
        <RoundedBox args={[w + 0.04, 0.1, w + 0.04]} radius={0.05} position={[0, h + 0.05, 0]}>
          <meshStandardMaterial color={palette.slate} metalness={0.4} roughness={0.4} />
        </RoundedBox>
        {/* process core */}
        <mesh ref={core} position={[0, h / 2 + 0.05, 0]}>
          <icosahedronGeometry args={[0.2, 1]} />
          <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={ghost ? 0.4 : 1.8} flatShading />
        </mesh>
        {/* status light */}
        <mesh position={[0, h + 0.14, 0]}>
          <sphereGeometry args={[0.05, 12, 12]} />
          <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={2} />
        </mesh>
        {selected && (
          <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[w * 0.82, w * 0.9, 4, 1, Math.PI / 4]} />
            <meshBasicMaterial color={palette.cyan} />
          </mesh>
        )}
        <WorldLabel position={[0, h + 0.5, 0]} center style={{ pointerEvents: 'none' }}>
          <div className={`kv-tag ${selected ? 'is-active' : ''} ${ghost ? 'opacity-60' : ''}`}>
            <span className="kv-tag-role">{container.role}</span>
            {container.name}
            {showState && <span className="ml-1.5 opacity-70">{stateText(container)}</span>}
          </div>
        </WorldLabel>
      </group>
      {highlighted && <LearningBeacon radius={w * 0.95} height={2.4} />}
    </group>
  );
}
