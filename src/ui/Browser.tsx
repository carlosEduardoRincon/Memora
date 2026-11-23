import { useMemo, useState } from 'react';
import { useCollection, mutate } from '../core/store';
import { buildSearch } from '../core/search';
import { deleteNotes, forgetCards, setSuspended, sortedDecks, setDueDays, normalizeTags, ensureDeck } from '../core/collection';
import { renderCard, stripHtml } from '../core/template';
import { dayNumber, formatDays } from '../core/time';
import type { Card } from '../core/types';
import { NoteEditor } from './Editor';
import { CardView } from './CardView';
import { askText, confirmBox, toast, Modal } from './common';

type SortKey = 'sort' | 'due' | 'interval' | 'ease' | 'reps' | 'lapses' | 'deck' | 'created';

const TYPE_LABEL: Record<Card['type'], string> = { new: 'Novo', learning: 'Aprendendo', review: 'Revisão', relearning: 'Reaprendendo' };

export function Browser({ initialQuery }: { initialQuery?: string }) {
  const col = useCollection();
  const [query, setQuery] = useState(initialQuery ?? '');
  const [applied, setApplied] = useState(initialQuery ?? '');
  const [mode, setMode] = useState<'cards' | 'notes'>('cards');
  const [sort, setSort] = useState<SortKey>('created');
  const [desc, setDesc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [limit, setLimit] = useState(200);
  const { dayStartHour } = col.settings;
  const today = dayNumber(Date.now(), dayStartHour);

  const results = useMemo(() => {
    let pred: (c: Card) => boolean;
    try { pred = buildSearch(col, applied); } catch { pred = () => false; }
    let cards = Object.values(col.cards).filter(pred);
    if (mode === 'notes') {
      const seen = new Set<string>();
      cards = cards.filter((c) => (seen.has(c.noteId) ? false : (seen.add(c.noteId), true)));
    }
    const key = (c: Card): number | string => {
      const n = col.notes[c.noteId];
      switch (sort) {
        case 'sort': return stripHtml(n?.fields[0] ?? '').toLowerCase();
        case 'due': return c.type === 'new' ? 1e15 + c.position : c.due;
        case 'interval': return c.interval;
        case 'ease': return c.ease;
        case 'reps': return c.reps;
        case 'lapses': return c.lapses;
        case 'deck': return col.decks[c.deckId]?.name.toLowerCase() ?? '';
        case 'created': return n?.created ?? 0;
      }
    };
    cards.sort((a, b) => {
      const ka = key(a), kb = key(b);
      const r = ka < kb ? -1 : ka > kb ? 1 : 0;
      return desc ? -r : r;
    });
    return cards;
  }, [col, applied, mode, sort, desc, col.cards, col.notes]);

  const ids = [...selected].filter((id) => col.cards[id]);
  const selectedCards = ids.map((id) => col.cards[id]);
  const selNoteIds = [...new Set(selectedCards.map((c) => c.noteId))];
  // em modo notas, ações sobre cartões afetam todos os cartões das notas selecionadas
  const targetCardIds = mode === 'notes'
    ? Object.values(col.cards).filter((c) => selNoteIds.includes(c.noteId)).map((c) => c.id)
    : ids;

  const toggleSort = (k: SortKey) => { if (sort === k) setDesc(!desc); else { setSort(k); setDesc(false); } };
  const th = (k: SortKey, label: string) => (
    <th onClick={() => toggleSort(k)} className="sortable">{label}{sort === k ? (desc ? ' ▾' : ' ▴') : ''}</th>
  );

  const act = async (kind: string) => {
    if (!ids.length) { toast('Selecione algum cartão'); return; }
    switch (kind) {
      case 'suspend': {
        const allSusp = targetCardIds.every((id) => col.cards[id].suspended);
        mutate((c) => setSuspended(c, targetCardIds, !allSusp));
        toast(allSusp ? 'Reativados' : 'Suspensos');
        break;
      }
      case 'delete':
        if (await confirmBox('Excluir notas', `Excluir ${selNoteIds.length} nota(s) e todos os seus cartões?`)) {
          mutate((c) => deleteNotes(c, selNoteIds));
          setSelected(new Set()); setActive(null);
        }
        break;
      case 'forget':
        if (await confirmBox('Esquecer', `Redefinir ${targetCardIds.length} cartão(ões) como novos?`)) mutate((c) => forgetCards(c, targetCardIds));
        break;
      case 'due': {
        const v = await askText('Definir vencimento', '0', 'Em quantos dias? (0 = hoje)');
        if (v === null) return;
        const n = parseInt(v, 10);
        if (isNaN(n) || n < 0) { toast('Número inválido', 'error'); return; }
        mutate((c) => setDueDays(c, targetCardIds, n));
        break;
      }
      case 'deck': {
        const decks = sortedDecks(col);
        const name = await askText('Mover para baralho', '', 'Nome do baralho (será criado se não existir): ' + decks.slice(0, 6).map((d) => d.name).join(', ') + (decks.length > 6 ? '…' : ''));
        if (!name?.trim()) return;
        mutate((c) => { const d = ensureDeck(c, name); for (const id of targetCardIds) c.cards[id].deckId = d.id; });
        toast('Movidos');
        break;
      }
      case 'addTags': {
        const t = await askText('Adicionar etiquetas', '', 'Separe por espaço');
        if (!t?.trim()) return;
        mutate((c) => { for (const nid of selNoteIds) c.notes[nid].tags = normalizeTags([...c.notes[nid].tags, ...t.split(/\s+/)]); });
        break;
      }
      case 'removeTags': {
        const t = await askText('Remover etiquetas', '', 'Separe por espaço');
        if (!t?.trim()) return;
        const rm = new Set(t.toLowerCase().split(/\s+/));
        mutate((c) => { for (const nid of selNoteIds) c.notes[nid].tags = c.notes[nid].tags.filter((x) => !rm.has(x.toLowerCase())); });
        break;
      }
    }
  };

  const flag = (n: number) => mutate((c) => { for (const id of targetCardIds) c.cards[id].flag = n; });

  const shown = results.slice(0, limit);
  const allChecked = shown.length > 0 && shown.every((c) => selected.has(c.id));
  const activeCard = active ? col.cards[active] : null;

  return (
    <div className="page wide browser">
      <form className="search-bar" onSubmit={(e) => { e.preventDefault(); setApplied(query); setSelected(new Set()); }}>
        <input className="grow" value={query} onChange={(e) => setQuery(e.target.value)} placeholder='Buscar… ex.: deck:Inglês tag:verbo is:due "frase exata" -is:suspended' />
        <button className="primary" type="submit">Buscar</button>
        <select value={mode} onChange={(e) => setMode(e.target.value as 'cards' | 'notes')}>
          <option value="cards">Cartões</option>
          <option value="notes">Notas</option>
        </select>
        <SearchHelp />
      </form>
      <div className="quick-filters">
        {[['', 'Tudo'], ['is:due', 'Vencidos'], ['is:new', 'Novos'], ['is:learn', 'Aprendendo'], ['is:review', 'Revisão'], ['is:suspended', 'Suspensos'], ['is:buried', 'Enterrados'], ['tag:leech', 'Sanguessugas'], ['added:1', 'Adicionados hoje'], ['rated:1', 'Estudados hoje']].map(([q, l]) => (
          <button key={l} className={'chip' + (applied === q ? ' active' : '')} onClick={() => { setQuery(q); setApplied(q); setSelected(new Set()); }}>{l}</button>
        ))}
      </div>
      <div className="browser-actions">
        <span className="muted">{results.length} {mode === 'cards' ? 'cartões' : 'notas'} · {ids.length} selecionado(s)</span>
        <button onClick={() => act('suspend')}>Suspender/Reativar</button>
        <button onClick={() => act('deck')}>Mudar baralho</button>
        <button onClick={() => act('addTags')}>+ Etiquetas</button>
        <button onClick={() => act('removeTags')}>− Etiquetas</button>
        <button onClick={() => act('due')}>Definir vencimento</button>
        <button onClick={() => act('forget')}>Esquecer</button>
        <select value="" onChange={(e) => { if (ids.length) flag(+e.target.value); e.target.value = ''; }}>
          <option value="" disabled>Bandeira…</option>
          <option value="0">Sem bandeira</option>
          {['Vermelha', 'Laranja', 'Verde', 'Azul', 'Rosa', 'Turquesa', 'Roxa'].map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
        </select>
        <button className="danger" onClick={() => act('delete')}>Excluir</button>
      </div>
      <div className="browser-split">
        <div className="table-wrap">
          <table className="cards-table">
            <thead>
              <tr>
                <th><input type="checkbox" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(shown.map((c) => c.id)))} /></th>
                {th('sort', 'Campo de ordenação')}
                {mode === 'cards' && <th>Cartão</th>}
                {th('deck', 'Baralho')}
                {th('due', 'Vencimento')}
                {th('interval', 'Intervalo')}
                {th('ease', 'Facilidade')}
                {th('reps', 'Revisões')}
                {th('lapses', 'Lapsos')}
                {th('created', 'Criado')}
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const n = col.notes[c.noteId];
                const nt = n && col.noteTypes[n.noteTypeId];
                const dueLabel = c.type === 'new' ? `Novo #${c.position}` : c.type === 'review' ? new Date(c.due).toLocaleDateString('pt-BR') : 'Hoje (aprend.)';
                return (
                  <tr key={c.id}
                    className={(active === c.id ? 'active ' : '') + (c.suspended ? 'suspended ' : '') + (c.flag ? `flag-${c.flag} ` : '') + (c.buriedUntil > Date.now() ? 'buried' : '')}
                    onClick={(e) => {
                      setActive(c.id);
                      if (e.shiftKey || e.ctrlKey || e.metaKey) { const s = new Set(selected); if (s.has(c.id)) s.delete(c.id); else s.add(c.id); setSelected(s); }
                      else setSelected(new Set([c.id]));
                    }}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => { const s = new Set(selected); if (s.has(c.id)) s.delete(c.id); else s.add(c.id); setSelected(s); }} />
                    </td>
                    <td className="ellipsis">{stripHtml(n?.fields[0] ?? '').slice(0, 120) || <i className="muted">(vazio)</i>}</td>
                    {mode === 'cards' && <td>{nt?.kind === 'cloze' ? `Cloze ${c.ord + 1}` : nt?.templates[c.ord]?.name}</td>}
                    <td className="ellipsis">{col.decks[c.deckId]?.name}</td>
                    <td title={TYPE_LABEL[c.type]}>{dueLabel}</td>
                    <td>{c.type === 'review' ? formatDays(c.interval) : '—'}</td>
                    <td>{c.type === 'new' ? '—' : col.presets[col.decks[c.deckId]?.presetId]?.algorithm === 'fsrs' ? `D ${c.difficulty.toFixed(1)}` : `${c.ease / 10}%`}</td>
                    <td>{c.reps}</td>
                    <td>{c.lapses}</td>
                    <td>{n ? new Date(n.created).toLocaleDateString('pt-BR') : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {results.length > limit && <div className="center"><button onClick={() => setLimit(limit + 500)}>Mostrar mais ({results.length - limit} restantes)</button></div>}
          {results.length === 0 && <p className="center muted">Nenhum resultado.</p>}
        </div>
        {activeCard && col.notes[activeCard.noteId] && (
          <div className="browser-editor">
            <div className="row-gap">
              <h3 className="grow">Editar</h3>
              <button onClick={() => setPreview(activeCard.id)}>Pré-visualizar</button>
              <button className="icon-btn" onClick={() => setActive(null)}>✕</button>
            </div>
            <CardInfo card={activeCard} today={today} />
            <NoteEditor key={activeCard.noteId} noteId={activeCard.noteId} />
          </div>
        )}
      </div>
      {preview && col.cards[preview] && <PreviewModal cardId={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function CardInfo({ card, today }: { card: Card; today: number }) {
  const col = useCollection();
  const logs = col.revlog.filter((r) => r.cardId === card.id);
  const [open, setOpen] = useState(false);
  const ratingName = ['', 'Errei', 'Difícil', 'Bom', 'Fácil'];
  const dueDays = card.type === 'review' ? dayNumber(card.due, col.settings.dayStartHour) - today : null;
  return (
    <details className="card-info" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Informações do cartão</summary>
      <dl>
        <dt>Estado</dt><dd>{TYPE_LABEL[card.type]}{card.suspended ? ' (suspenso)' : ''}</dd>
        {dueDays !== null && (<><dt>Vence</dt><dd>{dueDays <= 0 ? 'hoje' : `em ${dueDays} dia(s)`}</dd></>)}
        <dt>Revisões</dt><dd>{card.reps}</dd>
        <dt>Lapsos</dt><dd>{card.lapses}</dd>
        {card.stability > 0 && (<><dt>Estabilidade</dt><dd>{formatDays(card.stability)}</dd><dt>Dificuldade</dt><dd>{(card.difficulty * 10).toFixed(0)}%</dd></>)}
      </dl>
      {logs.length > 0 && (
        <table className="small-table">
          <thead><tr><th>Data</th><th>Tipo</th><th>Resposta</th><th>Intervalo</th><th>Tempo</th></tr></thead>
          <tbody>
            {logs.slice().reverse().map((l) => (
              <tr key={l.id}>
                <td>{new Date(l.time).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{TYPE_LABEL[l.kind]}</td>
                <td className={'r' + l.rating}>{ratingName[l.rating]}</td>
                <td>{l.interval ? formatDays(l.interval) : '—'}</td>
                <td>{(l.durationMs / 1000).toFixed(1)}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}

function PreviewModal({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const col = useCollection();
  const [back, setBack] = useState(false);
  const card = col.cards[cardId];
  const note = col.notes[card.noteId];
  const nt = col.noteTypes[note.noteTypeId];
  const r = renderCard({ noteType: nt, note, ord: card.ord, deckName: col.decks[card.deckId]?.name ?? '' });
  return (
    <Modal title="Pré-visualização" wide onClose={onClose} footer={<button onClick={() => setBack(!back)}>{back ? 'Ver frente' : 'Ver verso'}</button>}>
      <div className="card-area preview"><CardView key={String(back)} html={back ? r.back.html : r.front.html} css={nt.css} /></div>
    </Modal>
  );
}

function SearchHelp() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="icon-btn" title="Ajuda de busca" onClick={() => setOpen(true)}>?</button>
      {open && (
        <Modal title="Sintaxe de busca" onClose={() => setOpen(false)}>
          <table className="small-table help">
            <tbody>
              {[
                ['cachorro', 'notas contendo "cachorro" (ignora acentos e maiúsculas)'],
                ['cachorro gato', 'contém as duas palavras'],
                ['cachorro or gato', 'contém uma ou outra'],
                ['"bom dia"', 'frase exata'],
                ['-gato', 'não contém "gato"'],
                ['d*g', 'curinga: qualquer sequência'],
                ['deck:Inglês', 'baralho (e subbaralhos)'],
                ['tag:verbo', 'etiqueta'],
                ['note:Básico', 'tipo de nota'],
                ['card:2', 'segundo modelo de cartão'],
                ['frente:texto', 'campo específico'],
                ['is:new / is:learn / is:review / is:due', 'estado do cartão'],
                ['is:suspended / is:buried', 'suspensos / enterrados'],
                ['flag:1', 'bandeira vermelha (1-7)'],
                ['prop:ivl>=10', 'intervalo ≥ 10 dias (também due, reps, lapses, ease)'],
                ['rated:7', 'respondidos nos últimos 7 dias'],
                ['added:3', 'adicionados nos últimos 3 dias'],
                ['(a or b) -c', 'agrupamento'],
              ].map(([q, d]) => <tr key={q}><td><code>{q}</code></td><td>{d}</td></tr>)}
            </tbody>
          </table>
        </Modal>
      )}
    </>
  );
}
