import { useContext, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { Group, Mesh } from 'three';
import type { ControlPlaneComponent, Node } from '../../domain/types';
import { podsOnNode, rootWorkload } from '../../domain/selectors';
import { useAppStore } from '../../state/useAppStore';
import { accentFor, nodeAccentOf, palette } from '../palette';
import { PLATFORM_TOP, componentSlots, podLocalPositions, type NodeLayout } from '../layout';
import { useHoverHandlers, useIsHovered } from '../interaction';
import { WorldLabel } from '../WorldLabel';
import { FloatingRock } from './FloatingRock';
import { KubeletBeacon } from './KubeletBeacon';
import { PodCreature } from './PodCreature';
import { ComponentStructure } from './ControlPlaneStructures';
import { LearningBeacon } from './LearningBeacon';
import { Emergence } from './Emergence';
import { useLearningHighlight } from '../useLearningHighlight';
import { useFirstAppearance } from '../appearance';
import { isRevealed } from '../../state/presentation';
import { CrystalControlPlane } from '../cinematicStyle';

const ROCK_DEPTH = 4.6;

interface Props {
  node: Node;
  layout: NodeLayout;
}

/**
 * The control-plane Node. The control plane is a *set* of components; here
 * each runs as a static Pod (kubeadm style), shown standing beside it.
 */
export function ControlPlaneIsland({ node, layout }: Props) {
  const name = node.metadata.name;
  const cluster = useAppStore((s) => s.cluster);
  const presentation = useAppStore((s) => s.presentation);
  const focused = useAppStore((s) => s.view.kind === 'node' && s.view.nodeName === name);
  const focusNode = useAppStore((s) => s.focusNode);
  const hoverId = `node:${name}`;
  const hover = useHoverHandlers(hoverId);
  const hovered = useIsHovered(hoverId);
  const accent = nodeAccentOf(name);
  const asArea = presentation.controlPlane === 'area';
  const firstAppearance = useFirstAppearance(node.metadata.uid);
  const crystal = useContext(CrystalControlPlane);

  const highlighted = useLearningHighlight({ kind: 'node', role: node.role });
  const pods = useMemo(() => podsOnNode(cluster, name), [cluster, name]);
  const positions = useMemo(() => podLocalPositions(cluster, node), [cluster, node]);
  const components = cluster.controlPlane.filter((c) => c.nodeName === name);

  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (group.current) group.current.position.y = layout.position[1] + Math.sin(clock.elapsedTime * 0.5) * 0.1;
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    focusNode(name);
  };

  const R = layout.radius;

  return (
    <group ref={group} position={layout.position}>
      <Emergence active={presentation.animateEntries && firstAppearance} radius={R} accent={accent}>
        <group {...hover} onClick={onClick}>
          <mesh position={[0, PLATFORM_TOP - 0.3, 0]} receiveShadow castShadow>
            <cylinderGeometry args={[R, R * 0.93, 0.6, 6]} />
            <meshStandardMaterial color={palette.surface} roughness={0.65} flatShading />
          </mesh>
          <mesh position={[0, PLATFORM_TOP + 0.004, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 6]}>
            <ringGeometry args={[R * 0.55, R * 0.57, 6]} />
            <meshBasicMaterial color={accent} transparent opacity={0.22} />
          </mesh>
          <mesh position={[0, PLATFORM_TOP + 0.004, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 6]}>
            <ringGeometry args={[R * 0.9, R * 0.92, 6]} />
            <meshBasicMaterial color={accent} transparent opacity={hovered || focused ? 0.6 : 0.32} />
          </mesh>
          <mesh position={[0, PLATFORM_TOP - 0.02, 0]} rotation={[Math.PI / 2, 0, Math.PI / 6]}>
            <torusGeometry args={[R, 0.06, 8, 6]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={hovered || focused ? 1.8 : 0.9} />
          </mesh>
          <FloatingRock seed={name} radius={R * 0.93} depth={ROCK_DEPTH} sides={6} accent={palette.lavender} crystal={crystal} />
        </group>

        {components.map((c) =>
          asArea && !isRevealed(presentation, c.type) ? (
            <AreaComponent key={c.uid} component={c} onClick={onClick} hover={hover} />
          ) : (
            <ComponentNode key={c.uid} component={c} showLabel={focused || asArea} />
          ),
        )}

        <KubeletBeacon position={layout.kubelet} accent={accent} showLabel={focused} />
        {highlighted && <LearningBeacon radius={R + 0.35} height={4} y={PLATFORM_TOP} />}

        {pods.map((p) => {
          const pos = positions.get(p.metadata.uid);
          if (!pos) return null;
          const root = rootWorkload(cluster, p);
          return (
            <PodCreature
              key={p.metadata.uid}
              pod={p}
              position={pos}
              accent={accentFor(root?.metadata.uid ?? p.metadata.uid)}
              scale={p.origin === 'static' ? 0.8 : 1}
            />
          );
        })}

        <WorldLabel position={[0, -0.2 - ROCK_DEPTH - 0.6, 0]} center>
          <button
            type="button"
            className={`kv-nameplate ${focused ? 'is-active' : ''}`}
            style={{ ['--accent' as string]: accent }}
            onClick={() => focusNode(name)}
          >
            <span className="kv-nameplate-kind">{asArea ? 'Control plane · coordination' : 'Control plane · Node'}</span>
            {name}
          </button>
        </WorldLabel>
      </Emergence>
    </group>
  );
}

/** A component structure shown as part of the coordination area: unnamed, and clicking it selects the area. */
function AreaComponent({
  component,
  onClick,
  hover,
}: {
  component: ControlPlaneComponent;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  hover: ReturnType<typeof useHoverHandlers>;
}) {
  return (
    <group position={componentSlots[component.type]} {...hover} onClick={onClick}>
      <ComponentStructure type={component.type} glow={1} />
    </group>
  );
}

/** The controller manager stands behind the API server tower: its label floats above the tower's. */
const LABEL_HEIGHT: Partial<Record<ControlPlaneComponent['type'], number>> = {
  'kube-apiserver': 3.4,
  'kube-controller-manager': 4.9,
};

function ComponentNode({ component, showLabel }: { component: ControlPlaneComponent; showLabel: boolean }) {
  const selected = useAppStore((s) => s.selection?.kind === 'component' && s.selection.uid === component.uid);
  const selectComponent = useAppStore((s) => s.selectComponent);
  const hoverId = `component:${component.uid}`;
  const hover = useHoverHandlers(hoverId);
  const hovered = useIsHovered(hoverId);
  const highlighted = useLearningHighlight({ kind: 'component', component: component.type });
  const ring = useRef<Mesh>(null);
  useFrame((_, delta) => {
    if (ring.current) ring.current.rotation.z += delta * 0.5;
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    selectComponent(component.uid);
  };

  const glow = selected ? 1.8 : hovered ? 1.4 : 1;

  return (
    <group position={componentSlots[component.type]}>
      <group {...hover} onClick={onClick}>
        <ComponentStructure type={component.type} glow={glow} />
        {/* Some structures are mostly thin rings: give them a solid hit area. */}
        <mesh position={[0, 0.9, 0]} visible={false}>
          <cylinderGeometry args={[0.75, 0.75, 1.8, 8]} />
          <meshBasicMaterial />
        </mesh>
      </group>
      {highlighted && <LearningBeacon radius={1.25} height={3.6} />}
      {(selected || hovered) && (
        <mesh ref={ring} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.05, selected ? 1.15 : 1.1, 6]} />
          <meshBasicMaterial color={selected ? palette.cyan : palette.lilac} transparent opacity={0.8} />
        </mesh>
      )}
      {(showLabel || hovered || selected) && (
        <WorldLabel position={[0, LABEL_HEIGHT[component.type] ?? 2.1, 0]} center>
          <button
            type="button"
            className={`kv-tag cursor-pointer ${selected ? 'is-active' : ''}`}
            onClick={() => selectComponent(component.uid)}
          >
            {component.type}
          </button>
        </WorldLabel>
      )}
    </group>
  );
}
