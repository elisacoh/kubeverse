import { Compass, FlaskConical, GraduationCap, type LucideIcon } from 'lucide-react';
import { useAppStore, type AppMode } from '../state/useAppStore';

const MODES: { id: AppMode; label: string; icon: LucideIcon; available: boolean }[] = [
  { id: 'explore', label: 'Explore', icon: Compass, available: true },
  { id: 'learn', label: 'Learn', icon: GraduationCap, available: true },
  { id: 'playground', label: 'Playground', icon: FlaskConical, available: true },
];

export function ModeSelector() {
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  return (
    <div role="radiogroup" aria-label="Mode" className="glass flex items-center gap-0.5 rounded-xl p-1">
      {MODES.map(({ id, label, icon: Icon, available }) => {
        const active = mode === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={!available}
            onClick={() => setMode(id)}
            title={available ? label : `${label} — coming in a future sprint`}
            className={`hud-btn ${active ? '!bg-teal/15 !text-white ring-1 ring-teal/40' : ''}`}
          >
            <Icon className="size-3.5" />
            <span className="hidden lg:inline">{label}</span>
            {!available && <span className="hidden text-[9px] uppercase tracking-wider text-lavender/80 lg:inline">soon</span>}
          </button>
        );
      })}
    </div>
  );
}
