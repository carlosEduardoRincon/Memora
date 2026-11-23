// Operações sobre a coleção: baralhos, notas, cartões, filas de estudo.

import type { Card, Collection, Deck, Id, Note, NoteType, Preset, Rating, ReviewLog } from './types';
import { newId } from './ids';
import { cardOrdsForNote, stripHtml } from './template';
import { answerCard, resetCard } from './scheduler';
import { DAY, MINUTE, dayNumber, endOfToday } from './time';
import { DEFAULT_PRESET_ID, defaultPreset } from './defaults';

// ---------------- Baralhos ----------------

export const SEP = '::';

export function sortedDecks(col: Collection): Deck[] {
  return Object.values(col.decks).sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base', numeric: true })
  );
}

export function deckByName(col: Collection, name: string): Deck | undefined {
  const lower = name.toLowerCase();
  return Object.values(col.decks).find((d) => d.name.toLowerCase() === lower);
}

/** Cria (se necessário) um baralho e todos os pais. "Idiomas::Inglês::Verbos" */
export function ensureDeck(col: Collection, fullName: string, presetId?: Id): Deck {
  const parts = fullName.split(SEP).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) parts.push('Sem nome');
  let deck: Deck | undefined;
  for (let i = 1; i <= parts.length; i++) {
    const name = parts.slice(0, i).join(SEP);
    deck = deckByName(col, name);
    if (!deck) {
      const parent = i > 1 ? deckByName(col, parts.slice(0, i - 1).join(SEP)) : undefined;
      deck = {
        id: newId(),
        name,
        presetId: presetId ?? parent?.presetId ?? DEFAULT_PRESET_ID,
        description: '',
        collapsed: false,
      };
      col.decks[deck.id] = deck;
    }
  }
  return deck!;
}

export function deckAndDescendants(col: Collection, deckId: Id): Set<Id> {
  const deck = col.decks[deckId];
  const ids = new Set<Id>();
  if (!deck) return ids;
  const prefix = deck.name.toLowerCase() + SEP;
  for (const d of Object.values(col.decks)) {
    if (d.id === deckId || d.name.toLowerCase().startsWith(prefix)) ids.add(d.id);
  }
  return ids;
}

export function renameDeck(col: Collection, deckId: Id, newName: string): string | null {
  const deck = col.decks[deckId];
  newName = newName.split(SEP).map((s) => s.trim()).filter(Boolean).join(SEP);
  if (!deck || !newName) return 'Nome inválido';
  const existing = deckByName(col, newName);
  if (existing && existing.id !== deckId) return 'Já existe um baralho com esse nome';
  if (newName.toLowerCase().startsWith(deck.name.toLowerCase() + SEP)) return 'Não é possível mover um baralho para dentro dele mesmo';
  const oldPrefix = deck.name + SEP;
  for (const d of Object.values(col.decks)) {
    if (d.name.startsWith(oldPrefix)) d.name = newName + SEP + d.name.slice(oldPrefix.length);
  }
  deck.name = newName;
  // garante que pais existam
  const parts = newName.split(SEP);
  if (parts.length > 1) ensureDeck(col, parts.slice(0, -1).join(SEP), deck.presetId);
  return null;
}

export function deleteDeck(col: Collection, deckId: Id): void {
  const ids = deckAndDescendants(col, deckId);
  const cardIds = Object.values(col.cards).filter((c) => ids.has(c.deckId)).map((c) => c.id);
  removeCards(col, cardIds);
  for (const id of ids) delete col.decks[id];
  if (!Object.keys(col.decks).length) ensureDeck(col, 'Padrão');
}

export function presetFor(col: Collection, deckId: Id): Preset {
  const deck = col.decks[deckId];
  return col.presets[deck?.presetId ?? DEFAULT_PRESET_ID] ?? col.presets[DEFAULT_PRESET_ID] ?? defaultPreset();
}

// ---------------- Notas e cartões ----------------

function newCard(col: Collection, noteId: Id, deckId: Id, ord: number): Card {
  return {
    id: newId(),
    noteId,
    deckId,
    ord,
    type: 'new',
    due: 0,
    interval: 0,
    ease: 0,
    step: 0,
    reps: 0,
    lapses: 0,
    position: col.nextPosition++,
    suspended: false,
    buriedUntil: 0,
    flag: 0,
    stability: 0,
    difficulty: 0,
    lastReview: 0,
  };
}

export function cardsOfNote(col: Collection, noteId: Id): Card[] {
  return Object.values(col.cards).filter((c) => c.noteId === noteId);
}

/** Gera cartões que ainda não existem para a nota. Retorna os novos cartões. */
export function generateCards(col: Collection, note: Note, deckId: Id): Card[] {
  const nt = col.noteTypes[note.noteTypeId];
  if (!nt) return [];
  const existing = new Set(cardsOfNote(col, note.id).map((c) => c.ord));
  const created: Card[] = [];
  for (const ord of cardOrdsForNote(nt, note)) {
    if (existing.has(ord)) continue;
    const c = newCard(col, note.id, deckId, ord);
    col.cards[c.id] = c;
    created.push(c);
  }
  return created;
}

export function normalizeTags(tags: string[] | string): string[] {
  const list = Array.isArray(tags) ? tags : tags.split(/\s+/);
  return [...new Set(list.map((t) => t.trim()).filter(Boolean))];
}

export function addNote(col: Collection, noteTypeId: Id, deckId: Id, fields: string[], tags: string[] = []): { note: Note; cards: Card[] } {
  const now = Date.now();
  const note: Note = { id: newId(), noteTypeId, fields: [...fields], tags: normalizeTags(tags), created: now, modified: now };
  col.notes[note.id] = note;
  const cards = generateCards(col, note, deckId);
  return { note, cards };
}

export function updateNote(col: Collection, noteId: Id, fields: string[], tags: string[]): Card[] {
  const note = col.notes[noteId];
  if (!note) return [];
  note.fields = [...fields];
  note.tags = normalizeTags(tags);
  note.modified = Date.now();
  const deckId = cardsOfNote(col, noteId)[0]?.deckId ?? col.settings.lastDeckId ?? Object.keys(col.decks)[0];
  return generateCards(col, note, deckId);
}

export function removeCards(col: Collection, cardIds: Id[]): void {
  const notesTouched = new Set<Id>();
  const set = new Set(cardIds);
  for (const id of cardIds) {
    const c = col.cards[id];
    if (!c) continue;
    notesTouched.add(c.noteId);
    delete col.cards[id];
  }
  col.revlog = col.revlog.filter((r) => !set.has(r.cardId));
  for (const nid of notesTouched) if (!cardsOfNote(col, nid).length) delete col.notes[nid];
}

export function deleteNotes(col: Collection, noteIds: Id[]): void {
  const set = new Set(noteIds);
  removeCards(col, Object.values(col.cards).filter((c) => set.has(c.noteId)).map((c) => c.id));
  for (const id of noteIds) delete col.notes[id];
}

/** Notas cujo primeiro campo é idêntico (mesmo tipo de nota) */
export function findDuplicates(col: Collection, noteTypeId: Id, firstField: string, exceptId?: Id): Note[] {
  const key = stripHtml(firstField).trim().toLowerCase();
  if (!key) return [];
  return Object.values(col.notes).filter(
    (n) => n.noteTypeId === noteTypeId && n.id !== exceptId && stripHtml(n.fields[0] ?? '').trim().toLowerCase() === key
  );
}

export function forgetCards(col: Collection, cardIds: Id[]): void {
  for (const id of cardIds) {
    const c = col.cards[id];
    if (c) col.cards[id] = resetCard(c, col.nextPosition++);
  }
}

/** Reagenda cartões para vencerem em N dias (definir data de vencimento) */
export function setDueDays(col: Collection, cardIds: Id[], days: number): void {
  const { dayStartHour } = col.settings;
  for (const id of cardIds) {
    const c = col.cards[id];
    if (!c) continue;
    const due = endOfToday(Date.now(), dayStartHour) - DAY + days * DAY;
    col.cards[id] = { ...c, type: 'review', step: 0, interval: Math.max(1, c.interval || days), ease: c.ease || 2500, due };
  }
}

// ---------------- Modelos (tipos de nota) ----------------

export function noteTypeUsage(col: Collection, ntId: Id): number {
  return Object.values(col.notes).filter((n) => n.noteTypeId === ntId).length;
}

export function addField(col: Collection, ntId: Id, name: string): void {
  const nt = col.noteTypes[ntId];
  nt.fields.push({ name });
  for (const n of Object.values(col.notes)) if (n.noteTypeId === ntId) n.fields.push('');
}

export function renameField(col: Collection, ntId: Id, idx: number, name: string): void {
  const nt = col.noteTypes[ntId];
  const old = nt.fields[idx].name;
  nt.fields[idx].name = name;
  const re = new RegExp(`\\{\\{([#^/]?)((?:[^}:]+:)*)${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\}`, 'g');
  for (const t of nt.templates) {
    t.front = t.front.replace(re, `{{$1$2${name}}}`);
    t.back = t.back.replace(re, `{{$1$2${name}}}`);
  }
}

export function removeField(col: Collection, ntId: Id, idx: number): void {
  const nt = col.noteTypes[ntId];
  nt.fields.splice(idx, 1);
  for (const n of Object.values(col.notes)) if (n.noteTypeId === ntId) n.fields.splice(idx, 1);
}

export function moveField(col: Collection, ntId: Id, idx: number, dir: -1 | 1): void {
  const nt = col.noteTypes[ntId];
  const j = idx + dir;
  if (j < 0 || j >= nt.fields.length) return;
  [nt.fields[idx], nt.fields[j]] = [nt.fields[j], nt.fields[idx]];
  for (const n of Object.values(col.notes)) {
    if (n.noteTypeId === ntId) [n.fields[idx], n.fields[j]] = [n.fields[j], n.fields[idx]];
  }
}

export function addTemplate(col: Collection, ntId: Id): void {
  const nt = col.noteTypes[ntId];
  const f = nt.fields[0]?.name ?? 'Frente';
  nt.templates.push({ name: `Cartão ${nt.templates.length + 1}`, front: `{{${f}}}`, back: '{{FrontSide}}\n\n<hr id="answer">\n\n' });
  regenerateAll(col, ntId);
}

export function removeTemplate(col: Collection, ntId: Id, idx: number): void {
  const nt = col.noteTypes[ntId];
  if (nt.templates.length <= 1) return;
  nt.templates.splice(idx, 1);
  const noteIds = new Set(Object.values(col.notes).filter((n) => n.noteTypeId === ntId).map((n) => n.id));
  const toRemove: Id[] = [];
  for (const c of Object.values(col.cards)) {
    if (!noteIds.has(c.noteId)) continue;
    if (c.ord === idx) toRemove.push(c.id);
    else if (c.ord > idx) c.ord--;
  }
  removeCards(col, toRemove);
}

export function regenerateAll(col: Collection, ntId: Id): void {
  for (const n of Object.values(col.notes)) {
    if (n.noteTypeId !== ntId) continue;
    const deckId = cardsOfNote(col, n.id)[0]?.deckId ?? Object.keys(col.decks)[0];
    generateCards(col, n, deckId);
  }
}

export function cloneNoteType(col: Collection, ntId: Id, name: string): NoteType {
  const src = col.noteTypes[ntId];
  const nt: NoteType = JSON.parse(JSON.stringify(src));
  nt.id = newId();
  nt.name = name;
  col.noteTypes[nt.id] = nt;
  return nt;
}

// ---------------- Filas de estudo ----------------

export function isActive(c: Card, now: number): boolean {
  return !c.suspended && c.buriedUntil <= now;
}

export interface DeckCounts {
  new: number;
  learn: number;
  review: number;
}

function todayLogs(col: Collection, deckIds: Set<Id>, now: number): ReviewLog[] {
  const { dayStartHour } = col.settings;
  const start = endOfToday(now, dayStartHour) - DAY;
  const out: ReviewLog[] = [];
  for (let i = col.revlog.length - 1; i >= 0; i--) {
    const r = col.revlog[i];
    if (r.time < start) break;
    if (deckIds.has(r.deckId)) out.push(r);
  }
  return out;
}

function extraFor(col: Collection, deckId: Id, now: number) {
  const today = dayNumber(now, col.settings.dayStartHour);
  const e = col.extraLimits.find((x) => x.day === today && x.deckId === deckId);
  return { newExtra: e?.newExtra ?? 0, reviewExtra: e?.reviewExtra ?? 0 };
}

export function remainingLimits(col: Collection, deckId: Id, now: number): { newLeft: number; reviewLeft: number } {
  const p = presetFor(col, deckId);
  const ids = deckAndDescendants(col, deckId);
  const logs = todayLogs(col, ids, now);
  const newDone = new Set(logs.filter((r) => r.kind === 'new').map((r) => r.cardId)).size;
  const revDone = logs.filter((r) => r.kind === 'review').length;
  const extra = extraFor(col, deckId, now);
  return {
    newLeft: Math.max(0, p.newPerDay + extra.newExtra - newDone),
    reviewLeft: Math.max(0, p.reviewsPerDay + extra.reviewExtra - revDone),
  };
}

interface Pools {
  learnDueNow: Card[];
  learnToday: Card[];
  reviews: Card[];
  news: Card[];
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

function pools(col: Collection, deckId: Id, now: number): Pools {
  const ids = deckAndDescendants(col, deckId);
  const eod = endOfToday(now, col.settings.dayStartHour);
  const p = presetFor(col, deckId);
  const learnDueNow: Card[] = [];
  const learnToday: Card[] = [];
  const reviews: Card[] = [];
  const news: Card[] = [];
  for (const c of Object.values(col.cards)) {
    if (!ids.has(c.deckId) || !isActive(c, now)) continue;
    if (c.type === 'learning' || c.type === 'relearning') {
      if (c.due < eod) learnToday.push(c);
      if (c.due <= now) learnDueNow.push(c);
    } else if (c.type === 'review') {
      if (c.due < eod) reviews.push(c);
    } else news.push(c);
  }
  learnDueNow.sort((a, b) => a.due - b.due);
  learnToday.sort((a, b) => a.due - b.due);
  // revisões: mais atrasadas primeiro, com desempate aleatório estável no dia
  const day = dayNumber(now, col.settings.dayStartHour);
  reviews.sort((a, b) => a.due - b.due || hashStr(a.id + day) - hashStr(b.id + day));
  if (p.newOrder === 'random') news.sort((a, b) => hashStr(a.noteId) - hashStr(b.noteId) || a.ord - b.ord);
  else news.sort((a, b) => a.position - b.position);
  return { learnDueNow, learnToday, reviews, news };
}

export function deckCounts(col: Collection, deckId: Id, now = Date.now()): DeckCounts {
  const pl = pools(col, deckId, now);
  const lim = remainingLimits(col, deckId, now);
  return {
    new: Math.min(pl.news.length, lim.newLeft),
    learn: pl.learnToday.length,
    review: Math.min(pl.reviews.length, lim.reviewLeft),
  };
}

/** Escolhe o próximo cartão a estudar no baralho (e subbaralhos) */
export function nextCard(col: Collection, deckId: Id, now = Date.now()): Card | null {
  const pl = pools(col, deckId, now);
  const lim = remainingLimits(col, deckId, now);
  if (pl.learnDueNow.length) return pl.learnDueNow[0];

  const reviews = pl.reviews.slice(0, lim.reviewLeft);
  const news = pl.news.slice(0, lim.newLeft);
  if (reviews.length || news.length) {
    const mix = col.settings.newReviewMix;
    if (!news.length) return reviews[0];
    if (!reviews.length) return news[0];
    if (mix === 'newFirst') return news[0];
    if (mix === 'reviewFirst') return reviews[0];
    // intercala novos entre revisões de forma proporcional
    const studied = todayLogs(col, deckAndDescendants(col, deckId), now).length;
    const every = Math.max(1, Math.floor((reviews.length + news.length) / news.length));
    return studied % every === every - 1 ? news[0] : reviews[0];
  }
  // nada mais: antecipa aprendizado dentro da janela "aprender adiantado"
  const ahead = now + col.settings.learnAheadMinutes * MINUTE;
  const next = pl.learnToday[0];
  if (next && next.due <= ahead) return next;
  return null;
}

/** Próximo cartão em aprendizado que vence mais tarde hoje (para "volte em X min") */
export function nextLearningDue(col: Collection, deckId: Id, now = Date.now()): number | null {
  const pl = pools(col, deckId, now);
  return pl.learnToday[0]?.due ?? null;
}

export interface UndoEntry {
  label: string;
  cards: Card[];
  logId: Id | null;
  noteTags?: { id: Id; tags: string[] };
}

export function answer(col: Collection, cardId: Id, rating: Rating, durationMs: number, now = Date.now()): { undo: UndoEntry; leech: boolean } {
  const card = col.cards[cardId];
  const p = presetFor(col, card.deckId);
  const note = col.notes[card.noteId];
  const undo: UndoEntry = { label: 'Resposta', cards: [{ ...card }], logId: null, noteTags: note ? { id: note.id, tags: [...note.tags] } : undefined };
  const { card: next, log, leech } = answerCard(card, rating, now, p, col.settings.dayStartHour, durationMs);
  col.cards[cardId] = next;
  col.revlog.push(log);
  undo.logId = log.id;
  if (leech && note && !note.tags.includes('leech')) note.tags.push('leech');

  // enterrar irmãos (outros cartões da mesma nota) até amanhã
  const bury = (card.type === 'new' && p.buryNewSiblings) || (card.type === 'review' && p.buryReviewSiblings);
  if (bury) {
    const until = endOfToday(now, col.settings.dayStartHour);
    for (const sib of cardsOfNote(col, card.noteId)) {
      if (sib.id === cardId) continue;
      if ((sib.type === 'new' && p.buryNewSiblings) || (sib.type === 'review' && p.buryReviewSiblings)) {
        undo.cards.push({ ...sib });
        col.cards[sib.id] = { ...sib, buriedUntil: until };
      }
    }
  }
  return { undo, leech };
}

export function applyUndo(col: Collection, u: UndoEntry): void {
  for (const c of u.cards) col.cards[c.id] = c;
  if (u.logId) col.revlog = col.revlog.filter((r) => r.id !== u.logId);
  if (u.noteTags && col.notes[u.noteTags.id]) col.notes[u.noteTags.id].tags = u.noteTags.tags;
}

export function buryCards(col: Collection, ids: Id[]): void {
  const until = endOfToday(Date.now(), col.settings.dayStartHour);
  for (const id of ids) if (col.cards[id]) col.cards[id].buriedUntil = until;
}

export function setSuspended(col: Collection, ids: Id[], value: boolean): void {
  for (const id of ids) if (col.cards[id]) col.cards[id].suspended = value;
}

export function addExtraLimits(col: Collection, deckId: Id, newExtra: number, reviewExtra: number): void {
  const today = dayNumber(Date.now(), col.settings.dayStartHour);
  col.extraLimits = col.extraLimits.filter((x) => x.day === today);
  let e = col.extraLimits.find((x) => x.deckId === deckId);
  if (!e) col.extraLimits.push((e = { day: today, deckId, newExtra: 0, reviewExtra: 0 }));
  e.newExtra += newExtra;
  e.reviewExtra += reviewExtra;
}
