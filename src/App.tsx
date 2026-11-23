import { useEffect } from 'react';
import { useCollection } from './core/store';
import { useHashRoute, Toasts, Dialogs } from './ui/common';
import { DeckList } from './ui/DeckList';
import { Overview, Study } from './ui/Study';
import { AddNote } from './ui/Editor';
import { Browser } from './ui/Browser';
import { Stats } from './ui/Stats';
import { DeckOptions } from './ui/DeckOptions';
import { NoteTypes } from './ui/NoteTypes';
import { ImportExport } from './ui/ImportExport';
import { SettingsPage } from './ui/Settings';

const NAV: [string, string, string][] = [
  ['', 'Baralhos', '🗂'],
  ['add', 'Adicionar', '＋'],
  ['browse', 'Navegar', '🔍'],
  ['stats', 'Estatísticas', '📊'],
  ['import', 'Importar', '⇅'],
  ['settings', 'Config.', '⚙'],
];

export function App() {
  const col = useCollection();
  const route = useHashRoute();
  const [page, a, b] = route;

  useEffect(() => {
    const apply = () => {
      const dark = col.settings.theme === 'dark' || (col.settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [col.settings.theme]);

  let content;
  switch (page) {
    case 'overview': content = <Overview deckId={a} />; break;
    case 'study': content = <Study key={a} deckId={a} />; break;
    case 'add': content = <AddNote deckId={a} />; break;
    case 'browse': content = <Browser key={a ?? ''} initialQuery={a} />; break;
    case 'stats': content = <Stats key={a ?? ''} deckId={a} />; break;
    case 'options': content = <DeckOptions key={a} deckId={a} />; break;
    case 'notetypes': content = <NoteTypes />; break;
    case 'import': content = <ImportExport exportDeck={a === 'export' ? b : undefined} />; break;
    case 'settings': content = <SettingsPage />; break;
    default: content = <DeckList />;
  }

  const studying = page === 'study';
  return (
    <div className={'app' + (studying ? ' studying' : '')}>
      {!studying && (
        <header className="topbar">
          <a className="brand" href="#/"><img src="./icon.svg" alt="" /> Memora</a>
          <nav>
            {NAV.map(([p, label, icon]) => (
              <a key={p} href={'#/' + p} className={(page ?? '') === p || (p === '' && (page === 'overview' || page === 'options')) ? 'active' : ''}>
                <span className="nav-icon" aria-hidden>{icon}</span><span className="nav-label">{label}</span>
              </a>
            ))}
          </nav>
        </header>
      )}
      <main>{content}</main>
      <Toasts />
      <Dialogs />
    </div>
  );
}
