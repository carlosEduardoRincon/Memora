// Implementação do FSRS-5 (Free Spaced Repetition Scheduler), o algoritmo moderno usado no Anki 23.10+.
// Modelo DSR: Dificuldade (D), Estabilidade (S, em dias) e Recuperabilidade (R).

import type { Rating } from '../types';

export const DECAY = -0.5;
export const FACTOR = 19 / 81; // garante R(S, S) = 0.9

export interface MemoryState {
  stability: number;
  difficulty: number;
}

const clampD = (d: number) => Math.min(10, Math.max(1, d));

/** Probabilidade de lembrar após `t` dias com estabilidade `s` */
export function retrievability(t: number, s: number): number {
  return Math.pow(1 + (FACTOR * t) / s, DECAY);
}

/** Intervalo (dias, fracionário) para atingir a retenção desejada */
export function intervalFor(s: number, desiredRetention: number): number {
  return (s / FACTOR) * (Math.pow(desiredRetention, 1 / DECAY) - 1);
}

export function initStability(w: number[], g: Rating): number {
  return Math.max(w[g - 1], 0.1);
}

export function initDifficulty(w: number[], g: Rating): number {
  return w[4] - Math.exp(w[5] * (g - 1)) + 1;
}

export function nextDifficulty(w: number[], d: number, g: Rating): number {
  const delta = -w[6] * (g - 3);
  const dPrime = d + (delta * (10 - d)) / 9; // "linear damping"
  const target = initDifficulty(w, 4);
  return clampD(w[7] * target + (1 - w[7]) * dPrime); // reversão à média
}

export function stabilityAfterRecall(w: number[], d: number, s: number, r: number, g: Rating): number {
  const hardPenalty = g === 2 ? w[15] : 1;
  const easyBonus = g === 4 ? w[16] : 1;
  return (
    s *
    (Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp(w[10] * (1 - r)) - 1) * hardPenalty * easyBonus + 1)
  );
}

export function stabilityAfterForget(w: number[], d: number, s: number, r: number): number {
  const sf = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r));
  return Math.min(sf, s);
}

/** FSRS-5: revisões no mesmo dia */
export function stabilityShortTerm(w: number[], s: number, g: Rating): number {
  return s * Math.exp(w[17] * (g - 3 + w[18]));
}

/**
 * Calcula o novo estado de memória após uma resposta.
 * @param prev estado anterior (null para cartão novo)
 * @param elapsedDays dias desde a última revisão
 */
export function nextMemoryState(
  w: number[],
  prev: MemoryState | null,
  elapsedDays: number,
  g: Rating
): MemoryState {
  if (!prev || prev.stability <= 0) {
    return { stability: initStability(w, g), difficulty: clampD(initDifficulty(w, g)) };
  }
  const { stability: s, difficulty: d } = prev;
  const difficulty = nextDifficulty(w, d, g);
  let stability: number;
  if (elapsedDays < 1) {
    stability = stabilityShortTerm(w, s, g);
  } else {
    const r = retrievability(elapsedDays, s);
    stability = g === 1 ? stabilityAfterForget(w, d, s, r) : stabilityAfterRecall(w, d, s, r, g);
  }
  return { stability: Math.max(0.01, Math.min(stability, 36500)), difficulty };
}
