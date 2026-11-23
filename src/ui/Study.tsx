import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCollection, mutate, pushUndo, undo, canUndo } from '../core/store';
import {
  addExtraLimits, answer, buryCards, cardsOfNote, deckCounts, nextCard, nextLearningDue, presetFor, setSuspended, deleteNotes,
} from '../core/collection';
import { previewIntervals } from '../core/scheduler';
import { renderCard } from '../core/template';
import { formatInterval } from '../core/time';
import type { Card, Rating } from '../core/types';
import { CardView } from './CardView';
import { go, toast, Modal, confirmBox } from './common';
import { NoteEditor } from './Editor';

export function Overview({ deckId }: { deckId: string }) {
  const col = useCollection();
  const deck = col.decks[deckId];
  const [custom, setCustom] = useState(false);
  if (!deck) return <div className="page">Baralho não encontrado. <a href="#/">Voltar</a></div>;
  const counts = deckCounts(col, deckId);
  const done = counts.new + counts.learn + counts.review === 0;
  const nextLearn = nextLearningDue(col, deckId);

  return (
    <div className="page narrow center">
      <h1>{deck.name.split('::').join(' › ')}</h1>
      {deck.description && <p className="muted">{deck.description}</p>}
      <div className="overview-counts">
        <div><span className="num new">{counts.new}</span><small>Novos</small></div>
        <div><span className="num learn">{counts.learn}</span><small>Aprendendo</small></div>
        <div><span className="num review">{counts.review}</span><small>Revisar</small></div>
      </div>
      {done ? (
        <div className="congrats">
          <h3>🎉 Parabéns! Você terminou este baralho por hoje.</h3>
          {nextLearn && <p className="muted">Há cartões em aprendizado que vencem às {new Date(nextLearn).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.</p>}
          <p className="muted">Quer estudar mais? Use o estudo personalizado para aumentar os limites de hoje.</p>
        </div>
      ) : (
        <button className="primary big" autoFocus onClick={() => go(`study/${deckId}`)}>Estudar agora</button>
      )}
      <div className="row-gap center" style={{ marginTop: 24 }}>
        <button onClick={() => go(`options/${deckId}`)}>Opções</button>
        <button onClick={() => setCustom(true)}>Estudo personalizado</button>
        <button onClick={() => go(`add/${deckId}`)}>Adicionar</button>
        <button onClick={() => go(`stats/${deckId}`)}>Estatísticas</button>
      </div>
      {custom && <CustomStudy deckId={deckId} onClose={() => setCustom(false)} />}
    </div>
  );
}

function CustomStudy({ deckId, onClose }: { deckId: string; onClose: () => void }) {
  const [n, setN] = useState(10);
  const [r, setR] = useState(0);
  return (
    <Modal title="Estudo personalizado" onClose={onClose} footer={
      <>
        <button onClick={onClose}>Cancelar</button>
        <button className="primary" onClick={() => { mutate((c) => addExtraLimits(c, deckId, n, r)); onClose(); go(`study/${deckId}`); }}>Estudar</button>
      </>
    }>
      <label className="field">Aumentar limite de novos cartões hoje em
        <input type="number" min={0} value={n} onChange={(e) => setN(+e.target.value)} />
      </label>
      <label className="field">Aumentar limite de revisões hoje em
        <input type="number" min={0} value={r} onChange={(e) => setR(+e.target.value)} />
      </label>
    </Modal>
  );
}

const RATINGS: { r: Rating; label: string; cls: string }[] = [
  { r: 1, label: 'Errei', cls: 'again' },
  { r: 2, label: 'Difícil', cls: 'hard' },
  { r: 3, label: 'Bom', cls: 'good' },
  { r: 4, label: 'Fácil', cls: 'easy' },
];

const FLAG_COLORS = ['', '#e53e3e', '#ed8936', '#38a169', '#3182ce', '#d53f8c', '#00b5d8', '#805ad5'];

export function Study({ deckId }: { deckId: string }) {
  const col = useCollection();
  const [cardId, setCardId] = useState<string | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [typed, setTyped] = useState('');
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const shownAt = useRef(Date.now());
  const [, tick] = useState(0);

  const pickNext = useCallback(() => {
    const c = nextCard(col, deckId);
    setCardId(c?.id ?? null);
    setShowAnswer(false);
    setTyped('');
    shownAt.current = Date.now();
  }, [col, deckId]);

  useEffect(() => { pickNext(); }, [deckId]); // eslint-disable-line react-hooks/exhaustive-deps

  // quando não há cartão, verifica periodicamente se algum em aprendizado venceu
  useEffect(() => {
    if (cardId) return;
    const t = setInterval(() => { if (nextCard(col, deckId)) pickNext(); else tick((x) => x + 1); }, 15_000);
    return () => clearInterval(t);
  }, [cardId, col, deckId, pickNext]);

  const card: Card | undefined = cardId ? col.cards[cardId] : undefined;
  const note = card ? col.notes[card.noteId] : undefined;
  const nt = note ? col.noteTypes[note.noteTypeId] : undefined;
  const preset = card ? presetFor(col, card.deckId) : presetFor(col, deckId);

  const rendered = useMemo(() => {
    if (!card || !note || !nt) return null;
    return renderCard({ noteType: nt, note, ord: card.ord, deckName: col.decks[card.deckId]?.name ?? '', typedAnswer: typed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, note?.modified, nt, showAnswer]);

  const intervals = useMemo(() => (card ? previewIntervals(card, Date.now(), preset, col.settings.dayStartHour) : null), [card, preset, col.settings.dayStartHour]);

  const doAnswer = useCallback((r: Rating) => {
    if (!card) return;
    const duration = Math.min(Date.now() - shownAt.current, 60_000);
    const { undo: u, leech } = mutate((c) => answer(c, card.id, r, duration));
    pushUndo(u);
    if (leech) toast(preset.leechAction === 'suspend' ? 'Cartão sanguessuga: suspenso e marcado com "leech".' : 'Cartão sanguessuga: marcado com "leech".', 'error');
    pickNext();
  }, [card, pickNext, preset.leechAction]);

  const doUndo = useCallback(() => {
    const u = undo();
    if (!u) return;
    toast('Desfeito: ' + u.label);
    setCardId(u.cards[0].id);
    setShowAnswer(false);
    setTyped('');
    shownAt.current = Date.now();
  }, []);

  const action = useCallback(async (kind: 'buryCard' | 'buryNote' | 'suspend' | 'suspendNote' | 'delete' | 'flag', flag = 0) => {
    if (!card) return;
    setMenu(false);
    const prev = (kind === 'buryNote' || kind === 'suspendNote' ? cardsOfNote(col, card.noteId) : [card]).map((c) => ({ ...c }));
    if (kind === 'delete') {
      if (!(await confirmBox('Excluir nota', 'Excluir esta nota e todos os seus cartões?'))) return;
      mutate((c) => deleteNotes(c, [card.noteId]));
      toast('Nota excluída');
      pickNext();
      return;
    }
    if (kind === 'flag') {
      mutate((c) => { c.cards[card.id].flag = c.cards[card.id].flag === flag ? 0 : flag; });
      return;
    }
    mutate((c) => {
      if (kind === 'buryCard' || kind === 'buryNote') buryCards(c, prev.map((x) => x.id));
      else setSuspended(c, prev.map((x) => x.id), true);
    });
    pushUndo({ label: kind.startsWith('bury') ? 'Enterrar' : 'Suspender', cards: prev, logId: null });
    toast(kind.startsWith('bury') ? 'Enterrado até amanhã' : 'Suspenso');
    pickNext();
  }, [card, col, pickNext]);

  const reveal = useCallback(() => setShowAnswer(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return; }
      if (e.ctrlKey && /^[1-7]$/.test(e.key)) { e.preventDefault(); void action('flag', +e.key); return; }
      if (!card) return;
      if (!showAnswer) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); reveal(); }
      } else {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); doAnswer(3); }
        else if (['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); doAnswer(+e.key as Rating); }
      }
      if (e.key === 'e') { e.preventDefault(); setEditing(true); }
      else if (e.key === '-') void action('buryCard');
      else if (e.key === '=') void action('buryNote');
      else if (e.key === '@') void action('suspend');
      else if (e.key === '!') void action('suspendNote');
      else if (e.key === 'z') doUndo();
      else if (e.key === 'r') {
        document.querySelectorAll<HTMLAudioElement>('.card-content audio').forEach((a) => { a.currentTime = 0; void a.play(); });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, showAnswer, editing, doAnswer, doUndo, action, reveal]);

  const counts = deckCounts(col, deckId);

  if (!card || !note || !nt || !rendered) {
    const nextLearn = nextLearningDue(col, deckId);
    return (
      <div className="page narrow center">
        <div className="congrats">
          <h2>🎉 Parabéns!</h2>
          <p>Você terminou este baralho por enquanto.</p>
          {nextLearn && <p className="muted">Próximo cartão em aprendizado às {new Date(nextLearn).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} — esta tela atualiza sozinha.</p>}
          <div className="row-gap center">
            <button className="primary" onClick={() => go('')}>Voltar aos baralhos</button>
            {canUndo() && <button onClick={doUndo}>Desfazer ({canUndo()})</button>}
          </div>
        </div>
      </div>
    );
  }

  const typeInput = rendered.front.typeField !== undefined && !showAnswer
    ? { value: typed, onChange: setTyped, onEnter: reveal }
    : undefined;
  const kindOf = card.type === 'new' ? 'new' : card.type === 'review' ? 'review' : 'learn';

  return (
    <div className="study">
      <div className="study-top">
        <button className="icon-btn" onClick={() => go(`overview/${deckId}`)} title="Voltar">←</button>
        <div className="study-counts">
          <span className={'num new' + (kindOf === 'new' ? ' current' : '')}>{counts.new}</span>
          <span className={'num learn' + (kindOf === 'learn' ? ' current' : '')}>{counts.learn}</span>
          <span className={'num review' + (kindOf === 'review' ? ' current' : '')}>{counts.review}</span>
        </div>
        <div className="menu-wrap">
          {card.flag > 0 && <span className="flag-dot" style={{ background: FLAG_COLORS[card.flag] }} />}
          <button className="icon-btn" onClick={doUndo} disabled={!canUndo()} title="Desfazer (Ctrl+Z)">↶</button>
          <button className="icon-btn" onClick={() => setEditing(true)} title="Editar (E)">✎</button>
          <button className="icon-btn" onClick={() => setMenu(!menu)} title="Mais">⋯</button>
          {menu && (
            <div className="dropdown right" onMouseLeave={() => setMenu(false)}>
              <button onClick={() => action('buryCard')}>Enterrar cartão <kbd>-</kbd></button>
              <button onClick={() => action('buryNote')}>Enterrar nota <kbd>=</kbd></button>
              <button onClick={() => action('suspend')}>Suspender cartão <kbd>@</kbd></button>
              <button onClick={() => action('suspendNote')}>Suspender nota <kbd>!</kbd></button>
              <div className="flags">
                {FLAG_COLORS.slice(1).map((c, i) => (
                  <button key={i} className="flag-btn" style={{ background: c }} title={`Bandeira ${i + 1} (Ctrl+${i + 1})`} onClick={() => action('flag', i + 1)}>
                    {card.flag === i + 1 ? '✓' : ''}
                  </button>
                ))}
              </div>
              <button className="danger" onClick={() => action('delete')}>Excluir nota</button>
            </div>
          )}
        </div>
      </div>

      <div className="card-area" onClick={() => { if (!showAnswer && !typeInput) reveal(); }}>
        <CardView
          key={card.id + (showAnswer ? 'b' : 'f')}
          html={showAnswer ? rendered.back.html : rendered.front.html}
          css={nt.css}
          autoplay
          autoplayTts={preset.autoplayTTS}
          typeInput={typeInput}
        />
      </div>

      <div className="answer-bar">
        {!showAnswer ? (
          <button className="primary show-answer" onClick={reveal}>Mostrar resposta <kbd>Espaço</kbd></button>
        ) : (
          <div className="rating-buttons">
            {RATINGS.map(({ r, label, cls }) => (
              <button key={r} className={'rate ' + cls} onClick={() => doAnswer(r)}>
                {preset.showIntervalsOnButtons && intervals && <small>{formatInterval(intervals[r])}</small>}
                <span>{label}</span>
                <kbd>{r}</kbd>
              </button>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <Modal title="Editar nota" wide onClose={() => setEditing(false)}>
          <NoteEditor noteId={note.id} onSaved={() => setEditing(false)} />
        </Modal>
      )}
    </div>
  );
}
