import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { Group, MeshStandardMaterial } from 'three';
import type { Node } from '../../domain/types';
import { podsOnNode } from '../../domain/selectors';
import { useAppStore } from '../../state/useAppStore';
import { nodeAccentOf, palette } from '../palette';
import { podAccent } from '../accent';
import { PLATFORM_TOP, podLocalPositions, type NodeLayout, type Vec3 } from '../layout';
import { useHoverHandlers, useIsHovered } from '../interaction';
import { WorldLabel } from '../WorldLabel';
import { FloatingRock } from './FloatingRock';
import { KubeletBeacon } from './KubeletBeacon';
import { PodCreature } from './PodCreature';
import { NodeDecoration } from './NodeDecoration';
import { LearningBeacon } from './LearningBeacon';
import { Emergence } from './Emergence';
import { useLearningHighlight } from '../useLearningHighlight';
import { useFirstAppearance } from '../appearance';

interface Props {
  node: Node;
  layout: NodeLayout;
  index: number;
}

/** A Pod whose deletion was requested: it shrinks and sinks while its containers stop. */
function Departing({ at, children }: { at: Vec3; children: ReactNode }) {
  const group = useRef<Group>(null);
  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const k = Math.min(1, delta * 2.5);
    const s = g.scale.x + (0.55 - g.scale.x) * k;
    g.scale.setScalar(s);
    g.position.set(at[0] * (1 - s), at[1] * (1 - s) - (1 - s) * 0.4, at[2] * (1 - s));
  });
  return <group ref={group}>{children}</group>;
}

/** A worker Node: a floating island carrying its Pods and its kubelet. */
export function NodePlatform({ node, layout, index }: Props) {
  const name = node.metadata.name;
  const cluster = useAppStore((s) => s.cluster);
  const focused = useAppStore((s) => s.view.kind === 'node' && s.view.nodeName === name);
  const focusNode = useAppStore((s) => s.focusNode);
  const hoverId = `node:${name}`;
  const hovered = useIsHovered(hoverId);
  const hover = useHoverHandlers(hoverId);
  const accent = nodeAccentOf(name);

  const highlighted = useLearningHighlight({ kind: 'node', role: node.role });
  const presentation = useAppStore((s) => s.presentation);
  const firstAppearance = useFirstAppearance(node.metadata.uid);
  const pods = useMemo(() => podsOnNode(cluster, name), [cluster, name]);
  const positions = useMemo(() => podLocalPositions(cluster, node), [cluster, node]);

  const [px, , pz] = layout.position;
  const outward = Math.atan2(px, pz);
  const labelDist = layout.radius + 0.4;

  const group = useRef<Group>(null);
  const rim = useRef<MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (group.current) group.current.position.y = layout.position[1] + Math.sin(t * 0.6 + index * 2.1) * 0.12;
    if (rim.current) {
      const target = hovered || focused ? 2.2 : 1.1;
      rim.current.emissiveIntensity += (target - rim.current.emissiveIntensity) * 0.1;
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    focusNode(name);
  };

  return (
    <group ref={group} position={layout.position}>
      <Emergence active={presentation.animateEntries && firstAppearance} radius={layout.radius} accent={accent}>
      <group {...hover} onClick={onClick}>
        <mesh position={[0, PLATFORM_TOP - 0.25, 0]} receiveShadow castShadow>
          <cylinderGeometry args={[layout.radius, layout.radius * 0.94, 0.5, 64]} />
          <meshStandardMaterial color={palette.surface} roughness={0.7} />
        </mesh>
        {/* surface inlay rings */}
        {[0.42, 0.7, 0.94].map((f) => (
          <mesh key={f} position={[0, PLATFORM_TOP + 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[layout.radius * f - 0.02, layout.radius * f, 96]} />
            <meshBasicMaterial color={accent} transparent opacity={f > 0.9 ? 0.35 : 0.12} />
          </mesh>
        ))}
        <mesh position={[0, PLATFORM_TOP - 0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[layout.radius, 0.05, 12, 128]} />
          <meshStandardMaterial ref={rim} color={accent} emissive={accent} emissiveIntensity={1.1} />
        </mesh>
        <FloatingRock seed={name} radius={layout.radius * 0.94} depth={3.4} sides={9} accent={accent} />
      </group>

      {/* Decorations are authored around local -X; turn that side away from the camera. */}
      <group rotation={[0, Math.atan2(-Math.cos(outward), Math.sin(outward)), 0]}>
        <NodeDecoration variant={index % 3} accent={accent} radius={layout.radius} />
      </group>
      <KubeletBeacon position={layout.kubelet} accent={accent} showLabel={focused} nodeName={name} />
      {highlighted && <LearningBeacon radius={layout.radius + 0.35} height={3} y={PLATFORM_TOP} />}

      {pods.map((p) => {
        const pos = positions.get(p.metadata.uid);
        if (!pos) return null;
        const creature = <PodCreature pod={p} position={pos} facing={outward} accent={podAccent(cluster, p)} />;
        return p.terminating ? (
          <Departing key={p.metadata.uid} at={pos}>
            {creature}
          </Departing>
        ) : (
          <group key={p.metadata.uid}>{creature}</group>
        );
      })}

      <WorldLabel
        position={[Math.sin(outward) * labelDist, PLATFORM_TOP - 0.25, Math.cos(outward) * labelDist]}
        center
      >
        <button
          type="button"
          className={`kv-nameplate ${focused ? 'is-active' : ''}`}
          style={{ ['--accent' as string]: accent }}
          onClick={() => focusNode(name)}
        >
          <span className="kv-nameplate-kind">
            {presentation.inspector === 'essentials'
              ? `Worker Node · ${node.capacity.cpuMillis / 1000} CPU · ${node.capacity.memoryMiB / 1024} GiB`
              : 'Node'}
          </span>
          {name}
        </button>
      </WorldLabel>
      </Emergence>
    </group>
  );
}
