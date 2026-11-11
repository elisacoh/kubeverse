import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronsLeftRight, ChevronsUpDown } from 'lucide-react';

/** A size in px that the user can drag, clamped and remembered across visits. */
export function useStoredSize(key: string, initial: number, min: number, max: number) {
  const [size, setSize] = useState(() => {
    const saved = Number(typeof localStorage === 'undefined' ? NaN : localStorage.getItem(key));
    return Number.isFinite(saved) && saved > 0 ? saved : initial;
  });
  const clamped = Math.min(Math.max(size, min), Math.max(min, max));
  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(key, String(Math.round(size))), 300);
    return () => clearTimeout(t);
  }, [key, size]);
  return [clamped, setSize] as const;
}

/**
 * Drag handle between two panels. `axis: 'x'` resizes widths (drag left/right),
 * `'y'` heights. `invert` when the resized panel is after the handle.
 */
export function Splitter({ axis, size, onSize, invert = false, label }: { axis: 'x' | 'y'; size: number; onSize: (n: number) => void; invert?: boolean; label: string }) {
  const start = useRef<{ pos: number; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      start.current = { pos: axis === 'x' ? e.clientX : e.clientY, size };
      setDragging(true);
    },
    [axis, size],
  );
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const delta = (axis === 'x' ? e.clientX : e.clientY) - start.current.pos;
    onSize(start.current.size + (invert ? -delta : delta));
  };
  const end = () => {
    start.current = null;
    setDragging(false);
  };

  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        const dec = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
        const inc = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
        if (e.key === dec) onSize(size + (invert ? step : -step));
        if (e.key === inc) onSize(size + (invert ? -step : step));
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      title={label}
      className={`group relative z-10 shrink-0 ${axis === 'x' ? 'h-full w-2.5 cursor-col-resize' : 'h-2.5 w-full cursor-row-resize'} focus-visible:outline-none`}
    >
      <span
        className={`absolute rounded-full transition-colors ${dragging ? 'bg-teal/70' : 'bg-white/10 group-hover:bg-teal/50 group-focus-visible:bg-teal/70'} ${
          axis === 'x' ? 'inset-y-6 left-1/2 w-0.5 -translate-x-1/2' : 'inset-x-6 top-1/2 h-0.5 -translate-y-1/2'
        }`}
      />
      <span
        className={`pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border transition-all ${
          dragging
            ? 'border-teal/70 bg-[#0d1a3a] text-teal opacity-100'
            : 'border-white/10 bg-[#0b1430]/90 text-lavender/50 opacity-60 group-hover:border-teal/60 group-hover:text-teal group-hover:opacity-100 group-focus-visible:opacity-100'
        } ${axis === 'x' ? 'h-7 w-4' : 'h-4 w-7'}`}
      >
        {axis === 'x' ? <ChevronsLeftRight className="size-3" /> : <ChevronsUpDown className="size-3" />}
      </span>
    </div>
  );
}
