import type { Collection, NoteType, Preset, Deck } from './types';
import { newId } from './ids';

/** Parâmetros padrão do FSRS-5 (treinados em ~20 mil usuários do Anki) */
export const FSRS5_DEFAULT_WEIGHTS = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925,
  1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
];

export const DEFAULT_PRESET_ID = 'default';
export const DEFAULT_DECK_ID = 'default';

export function defaultPreset(id = DEFAULT_PRESET_ID, name = 'Padrão'): Preset {
  return {
    id,
    name,
    newPerDay: 20,
    reviewsPerDay: 200,
    learningSteps: [1, 10],
    graduatingInterval: 1,
    easyInterval: 4,
    newOrder: 'sequential',
    relearningSteps: [10],
    minimumInterval: 1,
    lapseMultiplier: 0,
    leechThreshold: 8,
    leechAction: 'tag',
    startingEase: 2.5,
    easyBonus: 1.3,
    intervalModifier: 1,
    hardInterval: 1.2,
    maximumInterval: 36500,
    buryNewSiblings: false,
    buryReviewSiblings: false,
    algorithm: 'sm2',
    desiredRetention: 0.9,
    fsrsWeights: [...FSRS5_DEFAULT_WEIGHTS],
    showIntervalsOnButtons: true,
    autoplayTTS: false,
  };
}

const BASE_CSS = `.card {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 22px;
  text-align: center;
  line-height: 1.5;
}`;

export function builtinNoteTypes(): NoteType[] {
  return [
    {
      id: 'basic',
      name: 'Básico',
      kind: 'standard',
      fields: [{ name: 'Frente' }, { name: 'Verso' }],
      templates: [{ name: 'Cartão 1', front: '{{Frente}}', back: '{{FrontSide}}\n\n<hr id="answer">\n\n{{Verso}}' }],
      css: BASE_CSS,
    },
    {
      id: 'basic-reversed',
      name: 'Básico (e cartão invertido)',
      kind: 'standard',
      fields: [{ name: 'Frente' }, { name: 'Verso' }],
      templates: [
        { name: 'Cartão 1', front: '{{Frente}}', back: '{{FrontSide}}\n\n<hr id="answer">\n\n{{Verso}}' },
        { name: 'Cartão 2', front: '{{Verso}}', back: '{{FrontSide}}\n\n<hr id="answer">\n\n{{Frente}}' },
      ],
      css: BASE_CSS,
    },
    {
      id: 'basic-optional-reversed',
      name: 'Básico (cartão invertido opcional)',
      kind: 'standard',
      fields: [{ name: 'Frente' }, { name: 'Verso' }, { name: 'Adicionar Invertido' }],
      templates: [
        { name: 'Cartão 1', front: '{{Frente}}', back: '{{FrontSide}}\n\n<hr id="answer">\n\n{{Verso}}' },
        {
          name: 'Cartão 2',
          front: '{{#Adicionar Invertido}}{{Verso}}{{/Adicionar Invertido}}',
          back: '{{FrontSide}}\n\n<hr id="answer">\n\n{{Frente}}',
        },
      ],
      css: BASE_CSS,
    },
    {
      id: 'basic-type',
      name: 'Básico (digitar a resposta)',
      kind: 'standard',
      fields: [{ name: 'Frente' }, { name: 'Verso' }],
      templates: [
        {
          name: 'Cartão 1',
          front: '{{Frente}}\n\n{{type:Verso}}',
          back: '{{Frente}}\n\n<hr id="answer">\n\n{{type:Verso}}',
        },
      ],
      css: BASE_CSS,
    },
    {
      id: 'cloze',
      name: 'Omissão de palavras (Cloze)',
      kind: 'cloze',
      fields: [{ name: 'Texto' }, { name: 'Extra' }],
      templates: [{ name: 'Cloze', front: '{{cloze:Texto}}', back: '{{cloze:Texto}}<br>\n{{Extra}}' }],
      css: BASE_CSS + `\n.cloze { font-weight: bold; color: #2b6cb0; }\n.nightMode .cloze { color: #90cdf4; }`,
    },
  ];
}

export function defaultDeck(): Deck {
  return { id: DEFAULT_DECK_ID, name: 'Padrão', presetId: DEFAULT_PRESET_ID, description: '', collapsed: false };
}

export function emptyCollection(): Collection {
  const nts: Record<string, NoteType> = {};
  for (const nt of builtinNoteTypes()) nts[nt.id] = nt;
  const deck = defaultDeck();
  const preset = defaultPreset();
  return {
    version: 1,
    created: Date.now(),
    decks: { [deck.id]: deck },
    presets: { [preset.id]: preset },
    noteTypes: nts,
    notes: {},
    cards: {},
    revlog: [],
    settings: {
      dayStartHour: 4,
      theme: 'auto',
      learnAheadMinutes: 20,
      newReviewMix: 'mix',
      lastDeckId: deck.id,
      lastNoteTypeId: 'basic',
    },
    nextPosition: 1,
    extraLimits: [],
  };
}

export { newId };
