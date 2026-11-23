import { describe, it, expect } from 'vitest';
import { emptyCollection, defaultPreset } from './defaults';
import { addNote, answer, deckCounts, nextCard, ensureDeck, renameDeck, deckAndDescendants } from './collection';
import { answerCard } from './scheduler';
import { renderCard, cardOrdsForNote, clozeNumbers } from './template';
import { buildSearch } from './search';
import { parseDelimited, importText } from './io/text';
import { retrievability, intervalFor, nextMemoryState } from './scheduler/fsrs';
import { DAY, MINUTE, dayNumber } from './time';
import { FSRS5_DEFAULT_WEIGHTS } from './defaults';
import type { Card } from './types';

const baseCard = (): Card => ({
  id: 'c1', noteId: 'n1', deckId: 'default', ord: 0, type: 'new', due: 0, interval: 0, ease: 0, step: 0,
  reps: 0, lapses: 0, position: 1, suspended: false, buriedUntil: 0, flag: 0, stability: 0, difficulty: 0, lastReview: 0,
});

describe('SM-2 (Anki)', () => {
  const p = defaultPreset();
  const now = new Date(2026, 0, 10, 12).getTime();
  it('cartão novo segue os passos 1m, 10m e gradua em 1 dia', () => {
    let { card } = answerCard(baseCard(), 3, now, p, 4);
    expect(card.type).toBe('learning');
    expect(card.due - now).toBe(10 * MINUTE);
    ({ card } = answerCard(card, 3, now + 10 * MINUTE, p, 4));
    expect(card.type).toBe('review');
    expect(card.interval).toBe(1);
    expect(card.ease).toBe(2500);
  });
  it('Errei volta ao primeiro passo; Fácil gradua com 4 dias', () => {
    const r1 = answerCard(baseCard(), 1, now, p, 4).card;
    expect(r1.due - now).toBe(MINUTE);
    const r4 = answerCard(baseCard(), 4, now, p, 4).card;
    expect(r4.interval).toBe(4);
  });
  it('Difícil no primeiro passo usa a média dos dois primeiros', () => {
    const r = answerCard(baseCard(), 2, now, p, 4).card;
    expect(r.due - now).toBe(5.5 * MINUTE);
  });
  it('revisão: Bom multiplica pela facilidade, Errei gera lapso', () => {
    const rev: Card = { ...baseCard(), type: 'review', interval: 10, ease: 2500, due: now, reps: 3 };
    const good = answerCard(rev, 3, now, p, 4).card;
    expect(good.interval).toBeGreaterThanOrEqual(23);
    expect(good.interval).toBeLessThanOrEqual(27);
    const again = answerCard(rev, 1, now, p, 4).card;
    expect(again.type).toBe('relearning');
    expect(again.lapses).toBe(1);
    expect(again.ease).toBe(2300);
    const back = answerCard(again, 3, now + 10 * MINUTE, p, 4).card;
    expect(back.type).toBe('review');
    expect(back.interval).toBe(1);
  });
  it('intervalos crescem: Difícil < Bom < Fácil', () => {
    const rev: Card = { ...baseCard(), type: 'review', interval: 30, ease: 2500, due: now, reps: 5 };
    const [h, g, e] = ([2, 3, 4] as const).map((r) => answerCard(rev, r, now, p, 4).card.interval);
    expect(h).toBeLessThan(g);
    expect(g).toBeLessThan(e);
  });
});

describe('FSRS-5', () => {
  const w = FSRS5_DEFAULT_WEIGHTS;
  it('R(S,S) = 90%', () => {
    expect(retrievability(10, 10)).toBeCloseTo(0.9, 5);
    expect(intervalFor(10, 0.9)).toBeCloseTo(10, 5);
  });
  it('estabilidade inicial segue os pesos', () => {
    expect(nextMemoryState(w, null, 0, 3).stability).toBeCloseTo(3.173, 3);
    const s = nextMemoryState(w, { stability: 3.173, difficulty: 5 }, 3, 3).stability;
    expect(s).toBeGreaterThan(3.173);
    const f = nextMemoryState(w, { stability: 20, difficulty: 5 }, 20, 1).stability;
    expect(f).toBeLessThan(20);
  });
  it('agendador com FSRS gradua com intervalo de ~S', () => {
    const p = { ...defaultPreset(), algorithm: 'fsrs' as const, learningSteps: [] };
    const now = Date.now();
    const c = answerCard(baseCard(), 3, now, p, 4).card;
    expect(c.type).toBe('review');
    expect(c.interval).toBe(3);
  });
});

describe('Modelos', () => {
  const col = emptyCollection();
  it('básico invertido gera 2 cartões e renderiza FrontSide', () => {
    const { note, cards } = addNote(col, 'basic-reversed', 'default', ['cat', 'gato']);
    expect(cards.length).toBe(2);
    const r = renderCard({ noteType: col.noteTypes['basic-reversed'], note, ord: 1, deckName: 'Padrão' });
    expect(r.front.html).toBe('gato');
    expect(r.back.html).toContain('gato');
    expect(r.back.html).toContain('cat');
  });
  it('cartão invertido opcional só existe quando o campo está preenchido', () => {
    const nt = col.noteTypes['basic-optional-reversed'];
    const base = { id: 'x', noteTypeId: nt.id, tags: [], created: 0, modified: 0 };
    expect(cardOrdsForNote(nt, { ...base, fields: ['a', 'b', ''] })).toEqual([0]);
    expect(cardOrdsForNote(nt, { ...base, fields: ['a', 'b', 's'] })).toEqual([0, 1]);
  });
  it('cloze gera um cartão por número e oculta só o ativo', () => {
    const text = 'A {{c1::capital}} do Brasil é {{c2::Brasília::cidade}}';
    expect(clozeNumbers(text)).toEqual([1, 2]);
    const { note, cards } = addNote(col, 'cloze', 'default', [text, '']);
    expect(cards.length).toBe(2);
    const r = renderCard({ noteType: col.noteTypes['cloze'], note, ord: 1, deckName: '' });
    expect(r.front.html).toContain('capital');
    expect(r.front.html).toContain('[cidade]');
    expect(r.back.html).toContain('<span class="cloze">Brasília</span>');
  });
  it('type: mostra comparação', () => {
    const { note } = addNote(col, 'basic-type', 'default', ['2+2', 'quatro']);
    const r = renderCard({ noteType: col.noteTypes['basic-type'], note, ord: 0, deckName: '', typedAnswer: 'quarto' });
    expect(r.front.typeExpected).toBe('quatro');
    expect(r.back.html).toContain('typeBad');
  });
});

describe('Baralhos e filas', () => {
  it('subbaralhos e renomear', () => {
    const col = emptyCollection();
    const d = ensureDeck(col, 'Idiomas::Inglês::Verbos');
    const parent = Object.values(col.decks).find((x) => x.name === 'Idiomas')!;
    expect(deckAndDescendants(col, parent.id).size).toBe(3);
    expect(renameDeck(col, parent.id, 'Línguas')).toBeNull();
    expect(col.decks[d.id].name).toBe('Línguas::Inglês::Verbos');
  });
  it('respeita o limite de novos por dia', () => {
    const col = emptyCollection();
    col.presets['default'].newPerDay = 3;
    for (let i = 0; i < 10; i++) addNote(col, 'basic', 'default', ['q' + i, 'a' + i]);
    expect(deckCounts(col, 'default').new).toBe(3);
    const c = nextCard(col, 'default')!;
    expect(c).toBeTruthy();
    answer(col, c.id, 4, 1000);
    const counts = deckCounts(col, 'default');
    expect(counts.new).toBe(2);
    expect(dayNumber(col.cards[c.id].due, 4)).toBe(dayNumber(Date.now(), 4) + 4);
    void DAY;
  });
});

describe('Busca', () => {
  it('suporta tag, deck, is e negação', () => {
    const col = emptyCollection();
    const d = ensureDeck(col, 'Bio::Células');
    addNote(col, 'basic', d.id, ['mitocôndria', 'energia'], ['bio']);
    addNote(col, 'basic', 'default', ['núcleo', 'dna'], ['outro']);
    const count = (q: string) => Object.values(col.cards).filter(buildSearch(col, q)).length;
    expect(count('deck:Bio')).toBe(1);
    expect(count('tag:bio')).toBe(1);
    expect(count('-tag:bio')).toBe(1);
    expect(count('is:new')).toBe(2);
    expect(count('mitocondria')).toBe(1);
    expect(count('nucleo or energia')).toBe(2);
    expect(count('frente:núcleo')).toBe(1);
  });
});

describe('Importação de texto', () => {
  it('lê CSV com aspas', () => {
    expect(parseDelimited('a,"b, c"\n"x ""y""",z', ',')).toEqual([['a', 'b, c'], ['x "y"', 'z']]);
  });
  it('importa e pula duplicados', () => {
    const col = emptyCollection();
    const o = { text: 'cat\tgato\ndog\tcão\n', separator: '\t', noteTypeId: 'basic', deckId: 'default', fieldMap: [0, 1], tagsColumn: -1, extraTags: [], allowHtml: false, skipFirstRow: false, duplicates: 'skip' as const };
    expect(importText(col, o).added).toBe(2);
    expect(importText(col, o).skipped).toBe(2);
  });
});
