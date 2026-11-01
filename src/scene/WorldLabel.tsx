import type { ComponentProps, RefObject } from 'react';
import { Html } from '@react-three/drei';

/**
 * DOM layer for in-world labels, mounted next to the canvas.
 * drei's <Html> otherwise targets a node that changes once R3F connects its
 * events, which remounts every label root and can leave labels empty.
 */
export const labelLayer: RefObject<HTMLDivElement | null> = { current: null };

type Props = ComponentProps<typeof Html>;

export function WorldLabel({ zIndexRange = [20, 0], ...props }: Props) {
  return <Html {...props} zIndexRange={zIndexRange} portal={labelLayer as RefObject<HTMLElement>} />;
}
