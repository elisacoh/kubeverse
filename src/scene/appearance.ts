import { useEffect, useState } from 'react';

/**
 * Entities already shown in the current world. Lets entrance animations play
 * when something truly arrives, not every time the overview is re-mounted
 * (e.g. on leaving a Pod's anatomy view).
 */
const seen = new Set<string>();

/** Forget entities that left the world, so they animate again if they come back. */
export const retainAppearances = (ids: Iterable<string>) => {
  const keep = new Set(ids);
  for (const id of seen) if (!keep.has(id)) seen.delete(id);
};

/** True when this mount is the entity's first appearance in the world. */
export function useFirstAppearance(id: string): boolean {
  const [first] = useState(() => !seen.has(id));
  useEffect(() => {
    seen.add(id);
  }, [id]);
  return first;
}
