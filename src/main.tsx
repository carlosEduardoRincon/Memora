import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadCollection } from './core/store';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<div className="loading">Carregando…</div>);
loadCollection().then(() => root.render(<App />));

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
