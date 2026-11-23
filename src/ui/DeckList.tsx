import { useEffect, useState } from 'react';
import { useCollection, mutate } from '../core/store';
import { sortedDecks, deckCounts, ensureDeck, renameDeck, deleteDeck, SEP, deckAndDescendants } from '../core/collection';
import type { Deck } from '../core/types';
import { askText, confirmBox, go, toast } from './common';
import { dayNumber } from '../core/time';
import { createSampleDeck } from './Settings';

interface Node {
  deck: Deck;
  label: string;
  depth: number;
  children: Node[];
}

function buildTree(decks: Deck[]): Node[] {
  const roots: Node[] = [];
  const byName = new Map<string, Node>();
  for (const d of decks) {
    const parts = d.name.split(SEP);
    const node: Node = { deck: d, label: parts[parts.length - 1], depth: parts.length - 1, children: [] };
    byName.set(d.name.toLowerCase(), node);
    const parent = byName.get(parts.slice(0, -1).join(SEP).toLowerCase());
    if (parent && parts.length > 1) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function DeckList() {
  const col = useCollection();
  const [, tick] = useState(0);
  // atualiza contadores a cada minuto (cartões em aprendizado vencendo)
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 60_000); return () => clearInterval(t); }, []);
  const tree = buildTree(sortedDecks(col));
  const today = dayNumber(Date.now(), col.settings.dayStartHour);
  const studiedToday = col.revlog.filter((r) => dayNumber(r.time, col.settings.dayStartHour) === today);
  const minutes = Math.round(studiedToday.reduce((s, r) => s + r.durationMs, 0) / 60000);

  const createDeck = async () => {
    const name = await askText('Novo baralho', '', 'Use "::" para criar subbaralhos, ex.: Idiomas::Inglês');
    if (!name?.trim()) return;
    mutate((c) => ensureDeck(c, name));
    toast('Baralho criado', 'success');
  };

  return (
    <div className="page">
      <div className="deck-table">
        <div className="deck-row head">
          <span>Baralho</span>
          <span className="num" title="Novos"><span className="long">Novos</span><span className="short">Nov.</span></span>
          <span className="num" title="Aprendendo"><span className="long">Aprender</span><span className="short">Apr.</span></span>
          <span className="num" title="Revisões a fazer"><span className="long">Revisar</span><span className="short">Rev.</span></span>
          <span />
        </div>
        {tree.map((n) => <DeckNode key={n.deck.id} node={n} />)}
      </div>
      <p className="center muted small">
        Estudou {studiedToday.length} cartões em {minutes} min hoje.
      </p>
      <div className="center row-gap">
        <button className="primary" onClick={createDeck}>＋ Criar baralho</button>
        <button onClick={() => go('import')}>Importar</button>
      </div>
      {Object.keys(col.cards).length === 0 && (
        <div className="welcome">
          <h3>Bem-vindo ao Memora 👋</h3>
          <p>Seu sistema de repetição espaçada, no estilo do Anki. Para começar:</p>
          <ol>
            <li>Crie um baralho (ou use o <b>Padrão</b>).</li>
            <li>Clique em <b>Adicionar</b> e crie notas — cada nota gera um ou mais cartões.</li>
            <li>Estude todos os dias: clique no baralho e avalie sua lembrança com <b>Errei / Difícil / Bom / Fácil</b>.</li>
          </ol>
          <p>Já tem baralhos do Anki? Importe arquivos <code>.apkg</code> em <a href="#/import">Importar</a>.</p>
          <button onClick={createSampleDeck}>Criar baralho de exemplo</button>
        </div>
      )}
    </div>
  );
}

function DeckNode({ node }: { node: Node }) {
  const col = useCollection();
  const [menu, setMenu] = useState(false);
  const { deck } = node;
  const counts = deckCounts(col, deck.id);
  const total = Object.values(col.cards).filter((c) => deckAndDescendants(col, deck.id).has(c.deckId)).length;

  const rename = async () => {
    setMenu(false);
    const name = await askText('Renomear baralho', deck.name);
    if (!name) return;
    const err = mutate((c) => renameDeck(c, deck.id, name));
    if (err) toast(err, 'error');
  };
  const remove = async () => {
    setMenu(false);
    if (!(await confirmBox('Excluir baralho', `Excluir "${deck.name}", seus subbaralhos e ${total} cartões? Esta ação não pode ser desfeita.`))) return;
    mutate((c) => deleteDeck(c, deck.id));
    toast('Baralho excluído');
  };
  const addSub = async () => {
    setMenu(false);
    const name = await askText('Novo subbaralho', '', `Dentro de "${deck.name}"`);
    if (name?.trim()) mutate((c) => ensureDeck(c, deck.name + SEP + name));
  };

  return (
    <>
      <div className="deck-row">
        <span className="deck-name" style={{ paddingLeft: node.depth * 18 }}>
          {node.children.length ? (
            <button className="collapse" onClick={() => mutate((c) => { c.decks[deck.id].collapsed = !deck.collapsed; })}>
              {deck.collapsed ? '▸' : '▾'}
            </button>
          ) : <span className="collapse-spacer" />}
          <a href={`#/overview/${deck.id}`}>{node.label}</a>
        </span>
        <span className={'num new' + (counts.new ? '' : ' zero')}>{counts.new}</span>
        <span className={'num learn' + (counts.learn ? '' : ' zero')}>{counts.learn}</span>
        <span className={'num review' + (counts.review ? '' : ' zero')}>{counts.review}</span>
        <span className="menu-wrap">
          <button className="icon-btn" onClick={() => setMenu(!menu)} aria-label="Opções do baralho">⚙</button>
          {menu && (
            <div className="dropdown" onMouseLeave={() => setMenu(false)}>
              <button onClick={() => go(`options/${deck.id}`)}>Opções</button>
              <button onClick={rename}>Renomear</button>
              <button onClick={addSub}>Novo subbaralho</button>
              <button onClick={() => go(`browse/${encodeURIComponent(`deck:"${deck.name}"`)}`)}>Navegar cartões</button>
              <button onClick={() => go(`import/export/${deck.id}`)}>Exportar</button>
              <button className="danger" onClick={remove}>Excluir</button>
            </div>
          )}
        </span>
      </div>
      {!deck.collapsed && node.children.map((c) => <DeckNode key={c.deck.id} node={c} />)}
    </>
  );
}
