import { useEffect } from 'react';
import { WorldCanvas } from './scene/WorldCanvas';
import { Hud } from './ui/Hud';
import { InspectorPanel } from './ui/inspectors/InspectorPanel';
import { Veil } from './ui/Veil';
import { LearnLayer } from './ui/learning/LearnLayer';
import { PlaygroundTeaser } from './ui/PlaygroundTeaser';
import { useKeyboardShortcuts } from './ui/useKeyboardShortcuts';
import { connectLearning } from './learning/connector';

export function App() {
  useKeyboardShortcuts();
  useEffect(() => connectLearning(), []);
  return (
    <div className="fixed inset-0 select-none">
      <WorldCanvas />
      <Hud />
      <LearnLayer />
      <InspectorPanel />
      <PlaygroundTeaser />
      <Veil />
    </div>
  );
}
