import { Suspense, useMemo, useRef, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { AdditiveBlending, DoubleSide, type Mesh, type MeshBasicMaterial } from 'three';
import {
  CircleCheck,
  Compass,
  Flame,
  FlaskConical,
  GraduationCap,
  Lightbulb,
  Siren,
  Skull,
  SquareTerminal,
  Target,
  Timer,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { useAppStore } from '../state/useAppStore';
import { Atmosphere } from '../scene/Atmosphere';
import { ClusterWorld } from '../scene/ClusterWorld';
import { labelLayer } from '../scene/WorldLabel';
import { PLATFORM_TOP, nodeLayouts, podWorldPosition, type Vec3 } from '../scene/layout';

/**
 * Static mock-up of the Playground's future Hardcore mode, opened with
 * `?hardcore-preview`: the regular universe under incident, with the
 * troubleshooting UI over it. Nothing here is wired to the simulation.
 */
export function HardcorePreview() {
  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-void font-sans text-white">
      <div
        ref={(el) => {
          labelLayer.current = el;
        }}
        className="hidden"
      />
      <Canvas shadows="percentage" dpr={[1, 2]} camera={{ position: [0, 27, 45], fov: 40, near: 0.1, far: 400 }} onCreated={({ camera }) => camera.lookAt(0, -5.5, 2)}>
        <color attach="background" args={['#060a18']} />
        <Suspense fallback={null}>
          <Atmosphere showIslets />
          <ClusterWorld />
          <Alarms />
        </Suspense>
      </Canvas>
      {/* Alarm tint: a slow red breath around the edges. */}
      <div
        className="pointer-events-none absolute inset-0 animate-pulse"
        style={{ background: 'radial-gradient(ellipse at center, transparent 50%, rgba(255,60,70,0.16) 100%)', animationDuration: '2.4s' }}
      />
      <TopBar />
      <IncidentPanel />
      <ObjectivesPanel />
      <Terminal />
    </div>
  );
}

/* ---------------------------------- 3D ---------------------------------- */

function Alarms() {
  const cluster = useAppStore((s) => s.cluster);
  const spots = useMemo(() => {
    const pod = (uid: string) => podWorldPosition(cluster, uid);
    const cascade = nodeLayouts(cluster).get('worker-cascade');
    return {
      recommender: pod('pod-recommender-r7c2k'),
      ordersDb: pod('pod-orders-db-0'),
      cascade: cascade ? ([cascade.position[0], cascade.position[1] + PLATFORM_TOP, cascade.position[2]] as Vec3) : undefined,
      cascadeRadius: cascade?.radius ?? 4,
    };
  }, [cluster]);

  return (
    <>
      {spots.recommender && <Alarm at={spots.recommender} radius={0.8} color="#ff5a64" label="OOMKilled · 7 restarts" tone="bad" />}
      {spots.ordersDb && <Alarm at={spots.ordersDb} radius={0.8} color="#ff5a64" label="0 connections · :5432" tone="bad" />}
      {spots.cascade && <Alarm at={spots.cascade} radius={spots.cascadeRadius + 0.3} color="#ffb84d" label="MemoryPressure" tone="warn" ring />}
    </>
  );
}

function Alarm({ at, radius, color, label, tone, ring = false }: { at: Vec3; radius: number; color: string; label: string; tone: 'bad' | 'warn'; ring?: boolean }) {
  const pulse = useRef<Mesh>(null);
  const material = useRef<MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const u = (clock.elapsedTime * 0.8) % 1;
    pulse.current?.scale.setScalar(1 + u * 0.6);
    if (material.current) material.current.opacity = (1 - u) * 0.75;
  });
  return (
    <group position={at}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[radius * 0.92, radius, 64]} />
        <meshBasicMaterial color={color} transparent opacity={ring ? 0.7 : 0.9} side={DoubleSide} toneMapped={false} />
      </mesh>
      <mesh ref={pulse} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[radius * 0.95, radius, 64]} />
        <meshBasicMaterial ref={material} color={color} transparent blending={AdditiveBlending} depthWrite={false} side={DoubleSide} toneMapped={false} />
      </mesh>
      <Html position={ring ? [-radius * 0.55, 0.6, radius * 0.85] : [0, 1.9, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div
          className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-semibold shadow-lg backdrop-blur ${
            tone === 'bad' ? 'border-bad/60 bg-[#3a0d17]/85 text-[#ffc2c6]' : 'border-warn/60 bg-[#3a2608]/85 text-[#ffe0b0]'
          }`}
        >
          {tone === 'bad' ? <Skull className="size-3" /> : <TriangleAlert className="size-3" />}
          {label}
        </div>
      </Html>
    </group>
  );
}

/* ---------------------------------- HUD --------------------------------- */

function Panel({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`glass pointer-events-auto rounded-2xl ${className}`}>{children}</div>;
}

function TopBar() {
  const modes = [
    { label: 'Explore', icon: Compass, active: false },
    { label: 'Learn', icon: GraduationCap, active: false },
    { label: 'Playground', icon: FlaskConical, active: true },
  ];
  return (
    <header className="absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-3 p-4">
      <Panel className="flex items-center gap-2.5 px-3 py-2">
        <span className="font-display text-[17px] font-semibold tracking-tight">
          Kube<span className="text-teal">Verse</span>
        </span>
        <span className="chip !border-bad/50 !bg-bad/15 !text-[#ffb3b8]">
          <Flame className="size-3" /> HARDCORE
        </span>
        <span className="font-mono text-[11px] text-lavender/70">scenario · Black Friday</span>
      </Panel>

      <div className="absolute left-1/2 top-4 -translate-x-1/2">
        <Panel className="flex items-center gap-0.5 rounded-xl p-1">
          {modes.map(({ label, icon: Icon, active }) => (
            <span key={label} className={`hud-btn ${active ? '!bg-bad/15 !text-white ring-1 ring-bad/40' : ''}`}>
              <Icon className="size-3.5" />
              {label}
            </span>
          ))}
        </Panel>
      </div>

      <Panel className="flex items-center gap-4 px-4 py-2">
        <Stat icon={<Timer className="size-3.5 text-bad" />} label="Time left" value="08:17" valueClass="text-[#ffb3b8]" />
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-lavender/70">Availability · SLO 99.5%</span>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-[74%] rounded-full bg-gradient-to-r from-bad to-warn" />
            </div>
            <span className="font-mono text-[12px] font-semibold text-warn">97.4%</span>
          </div>
        </div>
        <Stat icon={<Siren className="size-3.5 text-bad" />} label="Open incidents" value="3" />
        <Stat icon={<Zap className="size-3.5 text-gold" />} label="Score" value="1 240" />
      </Panel>
    </header>
  );
}

function Stat({ icon, label, value, valueClass = 'text-white' }: { icon: ReactNode; label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-lavender/70">
        {icon}
        {label}
      </span>
      <span className={`font-mono text-[17px] font-semibold leading-none ${valueClass}`}>{value}</span>
    </div>
  );
}

const INCIDENTS = [
  {
    sev: 'P1',
    tone: 'bad',
    title: 'recommender is crash-looping',
    detail: 'shop · Back-off restarting failed container · 7 restarts',
    age: '4m',
  },
  {
    sev: 'P1',
    tone: 'bad',
    title: 'storefront: checkout errors at 34%',
    detail: 'shop · upstream orders-db:5432 connection timed out',
    age: '2m',
  },
  {
    sev: 'P2',
    tone: 'warn',
    title: 'worker-cascade under memory pressure',
    detail: 'MemoryPressure=True · nightly-report evicted',
    age: '1m',
  },
  {
    sev: 'P3',
    tone: 'ok',
    title: 'coredns latency spike',
    detail: 'resolved · scaled coredns to 2 replicas',
    age: '9m',
  },
] as const;

const EVENTS = [
  ['Warning', 'BackOff', 'pod/recommender-84c5d9f6f-r7c2k', 'Back-off restarting failed container recommender'],
  ['Warning', 'Evicted', 'pod/nightly-report-29391840-k3m8s', 'The node was low on resource: memory'],
  ['Normal', 'Killing', 'pod/recommender-84c5d9f6f-r7c2k', 'Stopping container recommender'],
  ['Warning', 'Unhealthy', 'pod/storefront-6d8f7c9b5-f5j7d', 'Readiness probe failed: HTTP probe failed with statuscode: 503'],
] as const;

function IncidentPanel() {
  return (
    <Panel className="absolute left-4 top-[84px] z-20 flex w-[340px] flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-display text-[13px] font-semibold">
          <Siren className="size-4 text-bad" /> Incidents
        </span>
        <span className="chip !border-bad/40 !text-[#ffb3b8]">3 open</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {INCIDENTS.map((i) => (
          <li
            key={i.title}
            className={`rounded-xl border px-2.5 py-2 ${
              i.tone === 'bad'
                ? 'border-bad/35 bg-bad/10'
                : i.tone === 'warn'
                  ? 'border-warn/30 bg-warn/[0.07]'
                  : 'border-ok/20 bg-ok/[0.04] opacity-60'
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`rounded px-1 font-mono text-[10px] font-bold ${
                  i.tone === 'bad' ? 'bg-bad/80 text-[#2a0509]' : i.tone === 'warn' ? 'bg-warn/80 text-[#2a1a03]' : 'bg-ok/70 text-[#032a1f]'
                }`}
              >
                {i.sev}
              </span>
              <span className={`flex-1 text-[12.5px] font-medium ${i.tone === 'ok' ? 'line-through decoration-ok/60' : ''}`}>{i.title}</span>
              <span className="font-mono text-[10px] text-lavender/60">{i.age}</span>
            </div>
            <p className="mt-0.5 pl-8 font-mono text-[10.5px] text-lavender/75">{i.detail}</p>
          </li>
        ))}
      </ul>
      <div className="border-t border-white/5 pt-2">
        <span className="text-[10px] uppercase tracking-wider text-lavender/60">Live events</span>
        <ul className="mt-1 flex flex-col gap-1 font-mono text-[10px] leading-snug">
          {EVENTS.map(([type, reason, obj, msg]) => (
            <li key={obj + reason} className="text-lavender/70">
              <span className={type === 'Warning' ? 'text-warn' : 'text-ok'}>{type}</span> <span className="text-white/85">{reason}</span>{' '}
              <span className="text-cyan/80">{obj}</span>
              <br />
              <span className="text-lavender/55">{msg}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function ObjectivesPanel() {
  const goals = [
    { done: true, text: 'Restore DNS resolution in the cluster' },
    { done: false, text: 'Get recommender Running and Ready' },
    { done: false, text: 'Bring checkout errors below 1%' },
    { done: false, text: 'Relieve memory pressure on worker-cascade' },
  ];
  return (
    <Panel className="absolute right-4 top-[84px] z-20 flex w-[300px] flex-col gap-3 p-3">
      <span className="flex items-center gap-1.5 font-display text-[13px] font-semibold">
        <Target className="size-4 text-teal" /> Objectives
      </span>
      <ul className="flex flex-col gap-1.5">
        {goals.map((g) => (
          <li key={g.text} className="flex items-start gap-2 text-[12px]">
            <CircleCheck className={`mt-px size-3.5 shrink-0 ${g.done ? 'text-ok' : 'text-lavender/35'}`} />
            <span className={g.done ? 'text-lavender/55 line-through' : 'text-white/90'}>{g.text}</span>
          </li>
        ))}
      </ul>

      <div className="rounded-xl border border-bad/30 bg-bad/[0.08] p-2.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#ffb3b8]">
            <Zap className="size-3.5" /> Next chaos event
          </span>
          <span className="font-mono text-[13px] font-semibold text-[#ffb3b8]">00:42</span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-[63%] rounded-full bg-bad/80" />
        </div>
        <p className="mt-1.5 text-[10.5px] text-lavender/65">Something else is about to break. Unknown target.</p>
      </div>

      <div className="rounded-xl border border-gold/25 bg-gold/[0.06] p-2.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-gold">
            <Lightbulb className="size-3.5" /> Hint
          </span>
          <span className="font-mono text-[10px] text-gold/70">2 left · −150 pts</span>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-lavender/80">
          Exit code 137 means the kernel killed the process. Compare what the container uses with what it is allowed.
        </p>
      </div>
    </Panel>
  );
}

function Terminal() {
  const prompt = <span className="text-teal">sre@kubeverse</span>;
  const dollar = (
    <>
      {prompt}
      <span className="text-lavender/60">:</span>
      <span className="text-cyan">~</span>
      <span className="text-lavender/60">$ </span>
    </>
  );
  return (
    <Panel className="absolute bottom-4 left-[372px] right-[332px] z-20 overflow-hidden !rounded-2xl">
      <div className="flex items-center gap-1 border-b border-white/5 px-3 py-1.5">
        <SquareTerminal className="size-3.5 text-teal" />
        <span className="mr-3 text-[11.5px] font-semibold">Terminal</span>
        {['kubectl', 'logs', 'events'].map((t, i) => (
          <span key={t} className={`rounded-md px-2 py-0.5 font-mono text-[10.5px] ${i === 0 ? 'bg-white/10 text-white' : 'text-lavender/55'}`}>
            {t}
          </span>
        ))}
        <span className="ml-auto font-mono text-[10px] text-lavender/50">context: demo-cluster · ns: shop</span>
      </div>
      <pre className="overflow-hidden px-4 py-2.5 font-mono text-[11.5px] leading-[1.5] text-lavender/90">
        {dollar}
        <span className="text-white">kubectl get pods -n shop</span>
        {'\n'}
        <span className="text-lavender/60">NAME                          READY   STATUS             RESTARTS      AGE</span>
        {'\n'}orders-db-0                   2/2     <span className="text-ok">Running</span>            0             3h12m
        {'\n'}recommender-84c5d9f6f-r7c2k   0/1     <span className="font-semibold text-bad">CrashLoopBackOff</span>   7 (41s ago)   38m
        {'\n'}storefront-6d8f7c9b5-f5j7d    1/2     <span className="text-ok">Running</span>            0             3h12m
        {'\n'}storefront-6d8f7c9b5-q8v3n    2/2     <span className="text-ok">Running</span>            0             3h12m
        {'\n'}storefront-6d8f7c9b5-x2k4p    2/2     <span className="text-ok">Running</span>            0             3h12m
        {'\n\n'}
        {dollar}
        <span className="text-white">kubectl describe pod recommender-84c5d9f6f-r7c2k -n shop | grep -A2 &quot;Last State&quot;</span>
        {'\n'}    Last State:     Terminated
        {'\n'}      Reason:       <span className="font-semibold text-bad">OOMKilled</span>
        {'\n'}      Exit Code:    <span className="text-warn">137</span>
        {'\n\n'}
        {dollar}
        <span className="text-white">kubectl get deploy recommender -n shop -o jsonpath=&apos;{'{.spec.template.spec.containers[0].resources}'}&apos;</span>
        {'\n'}
        <span className="text-lavender/80">{'{"limits":{"memory":"256Mi"},"requests":{"cpu":"200m","memory":"256Mi"}}'}</span>
        {'\n\n'}
        {dollar}
        <span className="text-white">kubectl set resources deployment/recommender -n shop --limits=memory=512Mi</span>
        <span className="ml-0.5 inline-block h-[13px] w-[7px] translate-y-[2px] animate-pulse bg-teal" />
      </pre>
    </Panel>
  );
}
