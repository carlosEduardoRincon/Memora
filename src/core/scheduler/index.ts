// Agendador do Memora. Reproduz o comportamento do agendador v3 do Anki:
//  - Cartões novos/em aprendizado passam por "passos" (minutos) antes de "graduar".
//  - Revisões usam SM-2 (fator de facilidade) ou FSRS-5 (estabilidade/dificuldade).
//  - Lapsos (Errei numa revisão) levam ao reaprendizado e reduzem o intervalo.

import type { Card, Preset, Rating, ReviewLog } from '../types';
import { DAY, MINUTE, dayNumber, dayStartTs } from '../time';
import { intervalFor, nextMemoryState, type MemoryState } from './fsrs';
import { newId } from '../ids';

export interface AnswerResult {
  card: Card;
  log: ReviewLog;
  leech: boolean;
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Fuzz como no Anki: espalha revisões para não acumularem no mesmo dia */
export function fuzzInterval(ivl: number, seed: string, min = 1, max = 36500): number {
  if (ivl < 2.5) return Math.min(max, Math.max(min, Math.round(ivl)));
  let delta = 1;
  delta += Math.min(ivl, 7) > 2.5 ? (Math.min(ivl, 7) - 2.5) * 0.15 : 0;
  delta += ivl > 7 ? (Math.min(ivl, 20) - 7) * 0.1 : 0;
  delta += ivl > 20 ? (ivl - 20) * 0.05 : 0;
  const lo = Math.max(min, Math.round(ivl - delta));
  const hi = Math.min(max, Math.round(ivl + delta));
  if (hi <= lo) return Math.min(max, Math.max(min, lo));
  return lo + Math.floor(hash(seed) * (hi - lo + 1));
}

function stepsFor(card: Card, p: Preset): number[] {
  return card.type === 'relearning' ? p.relearningSteps : p.learningSteps;
}

/** atraso (minutos) para o botão Difícil no passo atual */
function hardDelay(steps: number[], step: number): number {
  const cur = steps[step] ?? steps[steps.length - 1];
  if (step === 0) {
    if (steps.length > 1) return (steps[0] + steps[1]) / 2;
    return Math.min(cur * 1.5, cur + 24 * 60);
  }
  return cur;
}

interface Ctx {
  now: number;
  today: number;
  dayStartHour: number;
  p: Preset;
}

function scheduleReviewDays(card: Card, ivl: number, ctx: Ctx): Card {
  const interval = Math.max(1, Math.min(ctx.p.maximumInterval, ivl));
  return {
    ...card,
    type: 'review',
    step: 0,
    interval,
    due: dayStartTs(ctx.today + interval, ctx.dayStartHour),
  };
}

function scheduleStep(card: Card, minutes: number, step: number, ctx: Ctx): Card {
  return { ...card, step, due: ctx.now + Math.round(minutes * MINUTE) };
}

// ---------------- FSRS ----------------

function fsrsMemory(card: Card, g: Rating, ctx: Ctx): MemoryState {
  const prev = card.stability > 0 ? { stability: card.stability, difficulty: card.difficulty } : null;
  const elapsed = card.lastReview ? Math.max(0, ctx.today - dayNumber(card.lastReview, ctx.dayStartHour)) : 0;
  return nextMemoryState(ctx.p.fsrsWeights, prev, elapsed, g);
}

/** intervalos (dias) do FSRS para Difícil/Bom/Fácil, garantindo Difícil ≤ Bom < Fácil */
function fsrsReviewIntervals(card: Card, ctx: Ctx): Record<2 | 3 | 4, number> {
  const seed = card.id + ':' + card.reps;
  const raw = (g: Rating) => intervalFor(fsrsMemory(card, g, ctx).stability, ctx.p.desiredRetention);
  const max = ctx.p.maximumInterval;
  let hard = fuzzInterval(raw(2), seed + 'h', 1, max);
  let good = fuzzInterval(raw(3), seed + 'g', 1, max);
  let easy = fuzzInterval(raw(4), seed + 'e', 1, max);
  if (card.type === 'review') {
    hard = Math.min(hard, good);
    good = Math.max(good, hard + 1);
  }
  easy = Math.max(easy, good + 1);
  return { 2: Math.min(hard, max), 3: Math.min(good, max), 4: Math.min(easy, max) };
}

// ---------------- SM-2 (Anki) ----------------

function sm2ReviewIntervals(card: Card, ctx: Ctx): Record<2 | 3 | 4, number> {
  const { p } = ctx;
  const seed = card.id + ':' + card.reps;
  const ease = card.ease / 1000;
  const ivl = Math.max(1, card.interval);
  const daysLate = Math.max(0, ctx.today - dayNumber(card.due, ctx.dayStartHour));
  const max = p.maximumInterval;
  const constrain = (v: number, prev: number) => Math.min(max, Math.max(prev + 1, Math.round(v)));

  const hardRaw = Math.max(ivl * p.hardInterval * p.intervalModifier, 1);
  // se o multiplicador do Difícil for ≤ 1, não força crescimento
  const hard = p.hardInterval > 1 ? constrain(hardRaw, ivl) : Math.min(max, Math.max(1, Math.round(hardRaw)));
  const good = constrain((ivl + daysLate / 2) * ease * p.intervalModifier, hard);
  const easy = constrain((ivl + daysLate) * ease * p.intervalModifier * p.easyBonus, good);
  return {
    2: fuzzInterval(hard, seed + 'h', 1, max),
    3: Math.max(fuzzInterval(good, seed + 'g', 1, max), hard + (hard < max ? 1 : 0)),
    4: Math.max(fuzzInterval(easy, seed + 'e', 1, max), good + (good < max ? 1 : 0)),
  };
}

// ---------------- Resposta ----------------

export function answerCard(
  card: Card,
  rating: Rating,
  now: number,
  p: Preset,
  dayStartHour: number,
  durationMs = 0
): AnswerResult {
  const ctx: Ctx = { now, today: dayNumber(now, dayStartHour), dayStartHour, p };
  const fsrs = p.algorithm === 'fsrs';
  const before = card;
  let next: Card = { ...card, reps: card.reps + 1 };
  let leech = false;

  // estado de memória FSRS é sempre atualizado (mesmo usando SM-2) para permitir trocar depois
  const mem = fsrsMemory(card, rating, ctx);

  if (card.type === 'new' || card.type === 'learning' || card.type === 'relearning') {
    const steps = stepsFor(card, p);
    const isRelearn = card.type === 'relearning';
    if (card.type === 'new') {
      next.type = 'learning';
      next.step = 0;
      next.ease = Math.round(p.startingEase * 1000);
    }
    const step = card.type === 'new' ? 0 : card.step;

    const graduate = (easy: boolean): Card => {
      let ivl: number;
      if (fsrs) {
        const ivls = fsrsReviewIntervals(card, ctx);
        ivl = easy ? ivls[4] : ivls[3];
      } else if (isRelearn) {
        ivl = Math.max(p.minimumInterval, card.interval) + (easy ? 1 : 0);
      } else {
        ivl = easy ? p.easyInterval : p.graduatingInterval;
      }
      return scheduleReviewDays(next, ivl, ctx);
    };

    if (steps.length === 0) {
      next = graduate(rating === 4);
    } else if (rating === 1) {
      next = scheduleStep(next, steps[0], 0, ctx);
    } else if (rating === 2) {
      next = scheduleStep(next, hardDelay(steps, step), step, ctx);
    } else if (rating === 3) {
      const nextStep = card.type === 'new' ? 1 : step + 1;
      if (nextStep >= steps.length) next = graduate(false);
      else next = scheduleStep(next, steps[nextStep], nextStep, ctx);
    } else {
      next = graduate(true);
    }
  } else {
    // revisão
    if (rating === 1) {
      next.lapses = card.lapses + 1;
      next.ease = Math.max(1300, card.ease - 200);
      const lapseIvl = fsrs
        ? Math.max(p.minimumInterval, Math.round(intervalFor(mem.stability, p.desiredRetention)))
        : Math.max(p.minimumInterval, Math.round(card.interval * p.lapseMultiplier));
      next.interval = Math.max(1, lapseIvl);
      if (p.relearningSteps.length) {
        next.type = 'relearning';
        next = scheduleStep(next, p.relearningSteps[0], 0, ctx);
      } else {
        next = scheduleReviewDays(next, next.interval, ctx);
      }
      if (p.leechThreshold > 0 && next.lapses >= p.leechThreshold) {
        const half = Math.max(1, Math.floor(p.leechThreshold / 2));
        if ((next.lapses - p.leechThreshold) % half === 0) leech = true;
      }
    } else {
      const ivls = fsrs ? fsrsReviewIntervals(card, ctx) : sm2ReviewIntervals(card, ctx);
      if (rating === 2) next.ease = Math.max(1300, card.ease - 150);
      if (rating === 4) next.ease = card.ease + 150;
      next = scheduleReviewDays(next, ivls[rating], ctx);
    }
  }

  next.stability = mem.stability;
  next.difficulty = mem.difficulty;
  next.lastReview = now;
  if (leech && p.leechAction === 'suspend') next.suspended = true;

  const log: ReviewLog = {
    id: newId(),
    cardId: card.id,
    deckId: card.deckId,
    time: now,
    rating,
    kind: before.type,
    interval: next.type === 'review' ? next.interval : 0,
    lastInterval: before.type === 'review' ? before.interval : 0,
    ease: next.ease,
    durationMs,
  };
  return { card: next, log, leech };
}

/** Prévia do próximo intervalo de cada botão (ms a partir de agora), como mostrado no Anki */
export function previewIntervals(card: Card, now: number, p: Preset, dayStartHour: number): Record<Rating, number> {
  const out = {} as Record<Rating, number>;
  for (const r of [1, 2, 3, 4] as Rating[]) {
    const { card: c } = answerCard(card, r, now, p, dayStartHour);
    out[r] = c.type === 'review' ? c.interval * DAY : c.due - now;
  }
  return out;
}

/** Retorna o cartão ao estado de "novo" (Esquecer) */
export function resetCard(card: Card, position: number): Card {
  return {
    ...card,
    type: 'new',
    due: 0,
    interval: 0,
    ease: 0,
    step: 0,
    reps: 0,
    lapses: 0,
    position,
    stability: 0,
    difficulty: 0,
    lastReview: 0,
  };
}
