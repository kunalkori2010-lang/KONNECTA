import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

if (import.meta.env.PROD) {
  registerSW({ immediate: true });
} else if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/dev-sw.js?dev-sw', { scope: '/' })
    .catch(() => {
      // Non-blocking in restricted preview iframes
    });
}

createRoot(document.getElementById('root')!).render(<App />);
