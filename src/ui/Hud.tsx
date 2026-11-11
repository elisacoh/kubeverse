import { ArrowLeft, Crosshair, House } from 'lucide-react';
import { useAppStore } from '../state/useAppStore';
import { useViewportInsets } from '../state/viewportInsets';
import { Breadcrumbs } from './Breadcrumbs';
import { ClusterHealth } from './ClusterHealth';
import { ModeSelector } from './ModeSelector';
import { FieldGuide } from './FieldGuide';
import { AnatomyLegend } from './AnatomyLegend';

export function Hud() {
  const view = useAppStore((s) => s.view);
  const selection = useAppStore((s) => s.selection);
  const transition = useAppStore((s) => s.transition);
  const back = useAppStore((s) => s.back);
  const goToCluster = useAppStore((s) => s.goToCluster);
  const recenter = useAppStore((s) => s.recenter);
  const learning = useAppStore((s) => s.mode === 'learn');
  const playground = useAppStore((s) => s.mode === 'playground');
  const titleSlot = useViewportInsets((s) => (playground ? s.titleSlot : null));
  // Between the Playground's docked panels, the mode selector sits over the world.
  const worldInsets = useViewportInsets((s) => (titleSlot ? s.insets : null));
  const atRoot = view.kind === 'cluster' && !view.focus && !selection;
  const busy = transition !== null;

  return (
    <>
      {/* Top bar */}
      <header className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-start justify-between gap-3 p-3 sm:p-4">
        <div
          className={
            titleSlot
              ? 'pointer-events-auto glass fixed flex h-11 min-w-0 items-center gap-2 rounded-2xl px-3'
              : 'pointer-events-auto glass flex min-w-0 max-w-[calc(100vw-11rem)] flex-col gap-1 rounded-2xl px-3 py-2 lg:max-w-[calc(50vw-14rem)]'
          }
          style={titleSlot ? { top: titleSlot.top, left: titleSlot.left, width: titleSlot.width } : undefined}
        >
          <div className="flex shrink-0 items-center gap-2.5">
            <Logo />
            <span className="font-display text-[17px] font-semibold tracking-tight text-white">
              Kube<span className="text-teal">Verse</span>
            </span>
            {playground ? (
              <span className="chip !border-teal/30 !text-teal" title="A Kubernetes cluster simulated in your browser. Nothing runs on a real cluster.">
                SIMULATED
              </span>
            ) : (
              <span className="chip !border-warm/30 !text-warm" title="All objects are generated demo data. No real cluster is connected.">
                DEMO DATA
              </span>
            )}
          </div>
          {titleSlot ? (
            <div className="ml-auto flex min-w-0 justify-end">
              <Breadcrumbs compact />
            </div>
          ) : (
            <Breadcrumbs />
          )}
        </div>

        <div
          className="pointer-events-auto absolute left-1/2 top-3 hidden -translate-x-1/2 sm:top-4 lg:block"
          style={worldInsets ? { left: `calc(${worldInsets.left}px + (100vw - ${worldInsets.left + worldInsets.right}px) / 2)` } : undefined}
        >
          <ModeSelector />
        </div>

        {!learning && !playground && (
          <div className="pointer-events-auto shrink-0">
            <ClusterHealth />
          </div>
        )}
      </header>

      {/* Bottom-left navigation */}
      <div
        className={`pointer-events-none fixed bottom-0 left-0 z-30 flex flex-col items-start gap-2 p-3 sm:p-4 ${playground ? 'hidden' : ''}`}
      >
        {view.kind === 'pod' ? <AnatomyLegend /> : !learning && <FieldGuide />}
        <div className="pointer-events-auto glass flex items-center gap-0.5 rounded-xl p-1">
          <button type="button" className="hud-btn" onClick={back} disabled={atRoot || busy} title="Back (Esc)">
            <ArrowLeft className="size-3.5" /> Back
          </button>
          <button
            type="button"
            className="hud-btn"
            onClick={goToCluster}
            disabled={atRoot || busy}
            title="Cluster overview (Home)"
          >
            <House className="size-3.5" /> Overview
          </button>
          <button type="button" className="hud-btn" onClick={recenter} disabled={busy} title="Re-frame the camera on the current view">
            <Crosshair className="size-3.5" /> Recenter
          </button>
        </div>
        <p className="pointer-events-none hidden text-[11px] text-lavender/55 lg:block">
          {learning
            ? 'Drag to orbit · Right-click to centre there · Scroll to zoom · Esc to go back'
            : 'Drag to orbit · Right-click to centre there · Scroll to zoom · Double-click a Pod to step inside · Esc to go back'}
        </p>
      </div>

      {/* Mode selector on narrow screens */}
      <div className="pointer-events-auto fixed bottom-3 right-3 z-30 sm:bottom-4 sm:right-4 lg:hidden">
        <ModeSelector />
      </div>
    </>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
      <defs>
        <linearGradient id="kv-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6fe3ff" />
          <stop offset="1" stopColor="#b3a4ff" />
        </linearGradient>
      </defs>
      <ellipse cx="16" cy="16" rx="13" ry="5" fill="none" stroke="url(#kv-logo)" strokeWidth="1.5" opacity="0.7" transform="rotate(-18 16 16)" />
      <circle cx="16" cy="16" r="7.5" fill="url(#kv-logo)" />
      <rect x="11.5" y="13" width="9" height="5" rx="2.5" fill="#0d1226" />
      <rect x="13.2" y="14.3" width="1.6" height="2.4" rx="0.8" fill="#d4fbff" />
      <rect x="17.2" y="14.3" width="1.6" height="2.4" rx="0.8" fill="#d4fbff" />
    </svg>
  );
}
