import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './workspace-ui.css';
import './craft.css';
import { initFrontendSentry, SentryErrorBoundary } from './services/sentry';

initFrontendSentry();

createRoot(document.getElementById('root')!).render(
  <SentryErrorBoundary>
    <App />
  </SentryErrorBoundary>
);
