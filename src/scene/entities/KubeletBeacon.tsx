import { useRef, type ReactNode } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { Group, Mesh } from 'three';
import { palette } from '../palette';
import type { Vec3 } from '../layout';
import { WorldLabel } from '../WorldLabel';
import { useAppStore } from '../../state/useAppStore';
import { isRevealed, type NodeAgent } from '../../state/presentation';
import { useHoverHandlers, useIsHovered } from '../interaction';
import { useLearningHighlight } from '../useLearningHighlight';
import { LearningBeacon } from './LearningBeacon';

/** Where the container runtime stands, relative to the kubelet. */
export const RUNTIME_OFFSET: Vec3 = [0.95, 0, 0.35];

/**
 * The Node agent. Arcs from the API server terminate here. When a lesson has
 * introduced them, the kubelet and the container runtime beside it can be
 * selected (on worker Nodes).
 */
export function KubeletBeacon({
  position,
  accent,
  showLabel,
  nodeName,
}: {
  position: Vec3;
  accent: string;
  showLabel: boolean;
  /** Set on worker Nodes: enables the agents once revealed. */
  nodeName?: string;
}) {
  const orb = useRef<Mesh>(null);
  const presentation = useAppStore((s) => s.presentation);
  const kubeletOn = !!nodeName && isRevealed(presentation, 'kubelet');
  const runtimeOn = !!nodeName && isRevealed(presentation, 'container-runtime');
  useFrame(({ clock }) => {
    if (!orb.current) return;
    orb.current.position.y = 1.05 + Math.sin(clock.elapsedTime * 1.6) * 0.05;
    orb.current.rotation.y = clock.elapsedTime;
  });

  const body = (
    <>
      <mesh position={[0, 0.35, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.2, 0.7, 6]} />
        <meshStandardMaterial color={palette.slate} roughness={0.5} metalness={0.4} flatShading />
      </mesh>
      <mesh position={[0, 0.72, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.14, 0.02, 8, 24]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1} />
      </mesh>
      <mesh ref={orb} position={[0, 1.05, 0]}>
        <icosahedronGeometry args={[0.11, 0]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.8} flatShading />
      </mesh>
    </>
  );

  return (
    <group position={position}>
      {kubeletOn && nodeName ? (
        <Agent nodeName={nodeName} agent="kubelet" label="kubelet" labelY={1.45} ringRadius={0.42}>
          {body}
        </Agent>
      ) : (
        <>
          {body}
          {showLabel && (
            <WorldLabel position={[0, 1.45, 0]} center style={{ pointerEvents: 'none' }}>
              <div className="kv-tag">kubelet</div>
            </WorldLabel>
          )}
        </>
      )}
      {runtimeOn && nodeName && (
        <group position={RUNTIME_OFFSET}>
          <Agent nodeName={nodeName} agent="container-runtime" label="containerd" labelY={1.15} ringRadius={0.5}>
            <RuntimeMachine accent={accent} />
          </Agent>
        </group>
      )}
    </group>
  );
}

function Agent({
  nodeName,
  agent,
  label,
  labelY,
  ringRadius,
  children,
}: {
  nodeName: string;
  agent: NodeAgent;
  label: string;
  labelY: number;
  ringRadius: number;
  children: ReactNode;
}) {
  const selected = useAppStore(
    (s) => s.selection?.kind === 'agent' && s.selection.nodeName === nodeName && s.selection.agent === agent,
  );
  const selectAgent = useAppStore((s) => s.selectAgent);
  const hoverId = `agent:${nodeName}:${agent}`;
  const hover = useHoverHandlers(hoverId);
  const hovered = useIsHovered(hoverId);
  const highlighted = useLearningHighlight({ kind: 'agent', agent, nodeId: nodeName });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    selectAgent(nodeName, agent);
  };

  return (
    <group>
      <group {...hover} onClick={onClick}>
        {children}
        {/* Generous invisible hit area: the agents are small. */}
        <mesh position={[0, 0.6, 0]} visible={false}>
          <cylinderGeometry args={[ringRadius, ringRadius, 1.3, 8]} />
          <meshBasicMaterial />
        </mesh>
      </group>
      {highlighted && <LearningBeacon radius={ringRadius + 0.15} height={2.2} />}
      {(selected || hovered) && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <ringGeometry args={[ringRadius, ringRadius + (selected ? 0.08 : 0.05), 6]} />
          <meshBasicMaterial color={selected ? palette.cyan : palette.lilac} transparent opacity={0.85} />
        </mesh>
      )}
      <WorldLabel position={[0, labelY, 0]} center style={{ pointerEvents: 'none' }}>
        <div className={`kv-tag ${selected ? 'is-active' : ''}`}>{label}</div>
      </WorldLabel>
    </group>
  );
}

/** The container runtime: a small engine with a crate spinning in its cradle. */
function RuntimeMachine({ accent }: { accent: string }) {
  const crate = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!crate.current) return;
    crate.current.rotation.y = clock.elapsedTime * 0.9;
    crate.current.position.y = 0.78 + Math.sin(clock.elapsedTime * 2) * 0.03;
  });
  return (
    <group>
      <mesh position={[0, 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.34, 0.4, 0.44, 6]} />
        <meshStandardMaterial color={palette.deep} roughness={0.4} metalness={0.5} flatShading />
      </mesh>
      <mesh position={[0, 0.46, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.3, 0.025, 8, 6]} />
        <meshStandardMaterial color={palette.teal} emissive={palette.teal} emissiveIntensity={1.2} />
      </mesh>
      <group ref={crate} position={[0, 0.78, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.3, 0.3, 0.3]} />
          <meshStandardMaterial color={palette.cyan} emissive={accent} emissiveIntensity={0.4} transparent opacity={0.85} />
        </mesh>
      </group>
    </group>
  );
}
