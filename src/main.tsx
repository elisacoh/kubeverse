import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

const Cinematic = lazy(() => import('./cinematic/Cinematic').then((m) => ({ default: m.Cinematic })));
const HardcorePreview = lazy(() => import('./preview/HardcorePreview').then((m) => ({ default: m.HardcorePreview })));
const params = new URLSearchParams(window.location.search);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {params.has('cinematic') ? (
      <Suspense fallback={null}>
        <Cinematic />
      </Suspense>
    ) : params.has('hardcore-preview') ? (
      <Suspense fallback={null}>
        <HardcorePreview />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
