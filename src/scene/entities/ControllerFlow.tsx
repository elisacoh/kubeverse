import { useEffect, useRef } from 'react';
import { passHops } from '../../learning/controllerFlow';
import { useLearningStore } from '../../learning/useLearningStore';
import { useFlowStore } from '../../state/useFlowStore';

/** Plays the messages behind each new batch of controller events. Purely visual. */
export function ControllerFlow() {
  const events = useLearningStore((s) => s.session?.world.controllers?.events);
  const play = useFlowStore((s) => s.play);
  // Initialised with the current events, so remounting the world does not replay them.
  const shown = useRef(events?.length ?? 0);

  useEffect(() => {
    const count = events?.length ?? 0;
    if (count < shown.current) shown.current = 0;
    const fresh = events?.slice(shown.current) ?? [];
    shown.current = count;
    if (fresh.length) play(passHops(fresh));
  }, [events, play]);

  return null;
}
