// Modelo de dados do Memora — inspirado na estrutura do Anki:
// Coleção → Baralhos (hierárquicos com "::") → Notas (campos) → Cartões (gerados por modelos).

export type Id = string;

export type CardType = 'new' | 'learning' | 'review' | 'relearning';
export type Rating = 1 | 2 | 3 | 4; // Errei, Difícil, Bom, Fácil

export interface Card {
  id: Id;
  noteId: Id;
  deckId: Id;
  /** índice do modelo de cartão (ou número do cloze - 1) */
  ord: number;
  type: CardType;
  /** timestamp (ms) em que o cartão vence. Para revisões: início do dia agendado. */
  due: number;
  /** intervalo atual em dias (revisões) */
  interval: number;
  /** fator de facilidade em permilagem (2500 = 250%) — usado no SM-2 */
  ease: number;
  /** índice do passo atual de aprendizado/reaprendizado */
  step: number;
  reps: number;
  lapses: number;
  /** posição na fila de novos */
  position: number;
  suspended: boolean;
  /** enterrado até este timestamp (ms) */
  buriedUntil: number;
  flag: number; // 0 = nenhuma, 1..7 cores
  // FSRS
  stability: number;
  difficulty: number;
  lastReview: number; // ms; 0 = nunca
}

export interface Field {
  name: string;
}

export interface CardTemplate {
  name: string;
  front: string;
  back: string;
}

export interface NoteType {
  id: Id;
  name: string;
  kind: 'standard' | 'cloze';
  fields: Field[];
  templates: CardTemplate[];
  css: string;
}

export interface Note {
  id: Id;
  noteTypeId: Id;
  fields: string[];
  tags: string[];
  created: number;
  modified: number;
}

export interface Deck {
  id: Id;
  /** nome completo, com "::" separando subbaralhos */
  name: string;
  presetId: Id;
  description: string;
  collapsed: boolean;
}

export interface Preset {
  id: Id;
  name: string;
  // limites diários
  newPerDay: number;
  reviewsPerDay: number;
  // novos cartões
  learningSteps: number[]; // minutos
  graduatingInterval: number; // dias
  easyInterval: number; // dias
  newOrder: 'sequential' | 'random';
  // lapsos
  relearningSteps: number[]; // minutos
  minimumInterval: number; // dias
  lapseMultiplier: number; // 0 = intervalo vai para o mínimo
  leechThreshold: number;
  leechAction: 'suspend' | 'tag';
  // avançado (SM-2)
  startingEase: number; // ex.: 2.5
  easyBonus: number; // ex.: 1.3
  intervalModifier: number; // ex.: 1.0
  hardInterval: number; // ex.: 1.2
  maximumInterval: number; // dias
  // enterrar
  buryNewSiblings: boolean;
  buryReviewSiblings: boolean;
  // algoritmo
  algorithm: 'sm2' | 'fsrs';
  desiredRetention: number; // 0.7..0.99
  fsrsWeights: number[];
  // exibição
  showIntervalsOnButtons: boolean;
  autoplayTTS: boolean;
}

export interface ReviewLog {
  id: Id;
  cardId: Id;
  deckId: Id;
  time: number; // ms
  rating: Rating;
  /** tipo do cartão ANTES da resposta */
  kind: CardType;
  interval: number; // novo intervalo em dias (0 se em aprendizado)
  lastInterval: number;
  ease: number;
  durationMs: number;
}

export interface Settings {
  /** hora (0-23) em que um novo dia de estudos começa, como no Anki (padrão 4h) */
  dayStartHour: number;
  theme: 'auto' | 'light' | 'dark';
  learnAheadMinutes: number;
  newReviewMix: 'mix' | 'newFirst' | 'reviewFirst';
  lastDeckId: Id | null;
  lastNoteTypeId: Id | null;
}

export interface Collection {
  version: number;
  created: number;
  decks: Record<Id, Deck>;
  presets: Record<Id, Preset>;
  noteTypes: Record<Id, NoteType>;
  notes: Record<Id, Note>;
  cards: Record<Id, Card>;
  revlog: ReviewLog[];
  settings: Settings;
  nextPosition: number;
  /** aumentos extras de limite para hoje (estudo personalizado) */
  extraLimits: { day: number; deckId: Id; newExtra: number; reviewExtra: number }[];
}
