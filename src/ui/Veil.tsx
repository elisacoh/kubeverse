import { useAppStore } from '../state/useAppStore';

/** Full-screen fade used while swapping between the cluster world and the Pod interior. */
export function Veil() {
  const veil = useAppStore((s) => s.veil);
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 transition-opacity duration-300 ease-out"
      style={{
        opacity: veil ? 1 : 0,
        background: 'radial-gradient(circle at 50% 50%, #1d3b5c 0%, #0b1430 45%, #060a18 100%)',
      }}
    />
  );
}
