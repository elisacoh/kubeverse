import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { QuadraticBezierLine } from '@react-three/drei';
import { QuadraticBezierCurve3, Vector3, type Mesh } from 'three';
import { controllerRef, findPod, rootWorkload } from '../../domain/selectors';
import { useAppStore } from '../../state/useAppStore';
import { accentFor, nodeAccentOf, palette } from '../palette';
import { componentSlots, nodeLayouts, podWorldPosition, type Vec3 } from '../layout';
import { APISERVER_ORB_HEIGHT } from './ControlPlaneStructures';

const v = (p: Vec3) => new Vector3(...p);

/** API server ⇄ kubelet links: every Node agent keeps a watch open on the API server. */
export function ApiServerLinks() {
  const cluster = useAppStore((s) => s.cluster);
  const pulses = useAppStore((s) => s.presentation.linkPulses);
  const links = useMemo(() => {
    const layouts = nodeLayouts(cluster);
    const api = cluster.controlPlane.find((c) => c.type === 'kube-apiserver');
    const cpLayout = api && layouts.get(api.nodeName);
    if (!api || !cpLayout) return [];
    const slot = componentSlots['kube-apiserver'];
    const start = v(cpLayout.position).add(v(slot)).add(new Vector3(0, APISERVER_ORB_HEIGHT, 0));
    return cluster.nodes
      .filter((n) => n.metadata.name !== api.nodeName)
      .flatMap((n) => {
        const l = layouts.get(n.metadata.name);
        if (!l) return [];
        const end = v(l.position).add(v(l.kubelet)).add(new Vector3(0, 1.05, 0));
        const mid = start.clone().lerp(end, 0.5).add(new Vector3(0, 3.2, 0));
        return [{ key: n.metadata.name, start, mid, end, color: nodeAccentOf(n.metadata.name) }];
      });
  }, [cluster]);

  return (
    <group>
      {links.map((l, i) => (
        <group key={l.key}>
          <QuadraticBezierLine
            start={l.start}
            end={l.end}
            mid={l.mid}
            color={l.color}
            lineWidth={1.4}
            transparent
            opacity={0.35}
          />
          {pulses && (
            <>
              <Pulse start={l.start} mid={l.mid} end={l.end} color={l.color} offset={i * 0.31} speed={0.22} />
              <Pulse start={l.end} mid={l.mid} end={l.start} color={palette.gold} offset={i * 0.17 + 0.5} speed={0.16} />
            </>
          )}
        </group>
      ))}
    </group>
  );
}

function Pulse({
  start,
  mid,
  end,
  color,
  offset,
  speed,
}: {
  start: Vector3;
  mid: Vector3;
  end: Vector3;
  color: string;
  offset: number;
  speed: number;
}) {
  const ref = useRef<Mesh>(null);
  const curve = useMemo(() => new QuadraticBezierCurve3(start, mid, end), [start, mid, end]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = (clock.elapsedTime * speed + offset) % 1;
    curve.getPoint(t, ref.current.position);
    ref.current.scale.setScalar(Math.sin(t * Math.PI) * 1 + 0.2);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.07, 12, 12]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

/** When a Pod is selected, thin threads connect it to the other Pods of the same controller. */
export function SiblingThreads() {
  const cluster = useAppStore((s) => s.cluster);
  const selectedUid = useAppStore((s) => (s.selection?.kind === 'pod' ? s.selection.uid : null));

  const threads = useMemo(() => {
    if (!selectedUid) return [];
    const pod = findPod(cluster, selectedUid);
    const ctrl = pod && controllerRef(pod);
    if (!pod || !ctrl || ctrl.kind === 'Node') return [];
    const from = podWorldPosition(cluster, selectedUid);
    if (!from) return [];
    const color = accentFor(rootWorkload(cluster, pod)?.metadata.uid ?? pod.metadata.uid);
    const start = v(from).add(new Vector3(0, 0.9, 0));
    return cluster.pods
      .filter((p) => p.metadata.uid !== selectedUid && controllerRef(p)?.uid === ctrl.uid)
      .flatMap((p) => {
        const to = podWorldPosition(cluster, p.metadata.uid);
        if (!to) return [];
        const end = v(to).add(new Vector3(0, 0.9, 0));
        const mid = start.clone().lerp(end, 0.5).add(new Vector3(0, 2.5 + start.distanceTo(end) * 0.12, 0));
        return [{ key: p.metadata.uid, start, mid, end, color }];
      });
  }, [cluster, selectedUid]);

  return (
    <group>
      {threads.map((t) => (
        <QuadraticBezierLine
          key={t.key}
          start={t.start}
          end={t.end}
          mid={t.mid}
          color={t.color}
          lineWidth={1.6}
          dashed
          dashScale={6}
          dashSize={0.6}
          gapSize={0.4}
          transparent
          opacity={0.75}
        />
      ))}
    </group>
  );
}
