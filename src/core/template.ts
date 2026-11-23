// Motor de modelos (templates) compatível com a sintaxe do Anki:
//  {{Campo}}  {{FrontSide}}  {{Tags}}  {{Deck}}  {{Subdeck}}  {{Card}}  {{Type}}
//  {{#Campo}}...{{/Campo}} (se não vazio)   {{^Campo}}...{{/Campo}} (se vazio)
//  {{text:Campo}}  {{hint:Campo}}  {{type:Campo}}  {{cloze:Campo}}  {{type:cloze:Campo}}

import type { Note, NoteType } from './types';

export interface RenderContext {
  noteType: NoteType;
  note: Note;
  ord: number;
  deckName: string;
  /** resposta digitada (lado de trás com {{type:...}}) */
  typedAnswer?: string;
}

export interface RenderResult {
  html: string;
  /** campo esperado para digitação (lado da frente) */
  typeField?: string;
  typeExpected?: string;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function fieldIsEmpty(value: string | undefined): boolean {
  if (!value) return true;
  // imagens/áudio contam como conteúdo
  if (/<img|\[sound:/i.test(value)) return false;
  return stripHtml(value).trim() === '';
}

// ---------------- Cloze ----------------

const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

/** números de cloze (1-based) presentes em um texto */
export function clozeNumbers(text: string): number[] {
  const set = new Set<number>();
  for (const m of text.matchAll(CLOZE_RE)) set.add(parseInt(m[1], 10));
  return [...set].sort((a, b) => a - b);
}

export function renderCloze(text: string, n: number, side: 'front' | 'back'): string {
  return text.replace(CLOZE_RE, (_all, num: string, content: string, hint?: string) => {
    if (parseInt(num, 10) !== n) return content;
    if (side === 'front') return `<span class="cloze">[${hint ? escapeHtml(stripHtml(hint)) : '...'}]</span>`;
    return `<span class="cloze">${content}</span>`;
  });
}

/** texto esperado de um cloze ativo (para {{type:cloze:...}}) */
export function clozeAnswer(text: string, n: number): string {
  const parts: string[] = [];
  for (const m of text.matchAll(CLOZE_RE)) if (parseInt(m[1], 10) === n) parts.push(stripHtml(m[2]));
  return parts.join(', ');
}

// ---------------- Comparação de resposta digitada ----------------

/** Diff caractere a caractere (LCS), como o Anki faz para {{type:}} */
export function compareTyped(typed: string, expected: string): string {
  const a = typed.trim();
  const b = expected.trim();
  if (a === b) return `<div class="typed"><span class="typeGood">${escapeHtml(b)}</span></div>`;
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0;
  let given = '', exp = '';
  const push = (cls: string, ch: string, target: 'g' | 'e') => {
    const span = `<span class="${cls}">${escapeHtml(ch)}</span>`;
    if (target === 'g') given += span; else exp += span;
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      push('typeGood', a[i], 'g'); push('typeGood', b[j], 'e'); i++; j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      push('typeMissed', b[j], 'e'); j++;
    } else {
      push('typeBad', a[i], 'g'); i++;
    }
  }
  return `<div class="typed">${a ? given + '<br><span class="typeArrow">↓</span><br>' : ''}${exp}</div>`;
}

// ---------------- Renderização ----------------

function fieldMap(nt: NoteType, note: Note): Map<string, string> {
  const map = new Map<string, string>();
  nt.fields.forEach((f, i) => map.set(f.name, note.fields[i] ?? ''));
  return map;
}

function processSections(tpl: string, fields: Map<string, string>, ctx: RenderContext): string {
  // {{#X}}...{{/X}} e {{^X}}...{{/X}}, com aninhamento
  const re = /\{\{([#^])\s*([^}]+?)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/;
  let out = tpl;
  let guard = 0;
  while (re.test(out) && guard++ < 200) {
    out = out.replace(re, (_a, kind: string, name: string, inner: string) => {
      let value = fields.get(name) ?? '';
      if (name.startsWith('cloze:')) {
        const fv = fields.get(name.slice(6)) ?? '';
        value = clozeNumbers(fv).includes(ctx.ord + 1) ? 'x' : '';
      }
      if (name === 'Tags') value = ctx.note.tags.join(' ');
      const empty = fieldIsEmpty(value);
      return (kind === '#' ? !empty : empty) ? inner : '';
    });
  }
  return out;
}

export function renderTemplate(
  tpl: string,
  ctx: RenderContext,
  side: 'front' | 'back',
  frontSide = ''
): RenderResult {
  const { noteType: nt, note } = ctx;
  const fields = fieldMap(nt, note);
  let typeField: string | undefined;
  let typeExpected: string | undefined;

  let out = processSections(tpl, fields, ctx);

  out = out.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_all, raw: string) => {
    const parts = raw.split(':');
    const name = parts.pop()!.trim();
    const filters = parts.map((p) => p.trim());

    if (filters.length === 0) {
      switch (name) {
        case 'FrontSide': return frontSide;
        case 'Tags': return escapeHtml(note.tags.join(' '));
        case 'Deck': return escapeHtml(ctx.deckName);
        case 'Subdeck': return escapeHtml(ctx.deckName.split('::').pop() ?? '');
        case 'Type': return escapeHtml(nt.name);
        case 'Card': return escapeHtml(nt.kind === 'cloze' ? `Cloze ${ctx.ord + 1}` : nt.templates[ctx.ord]?.name ?? '');
      }
    }
    if (!fields.has(name)) return `<span class="tplError">{{${escapeHtml(raw)}}}?</span>`;
    let value = fields.get(name) ?? '';

    if (filters.includes('type')) {
      const isCloze = filters.includes('cloze');
      typeField = name;
      typeExpected = isCloze ? clozeAnswer(value, ctx.ord + 1) : stripHtml(value).trim();
      if (side === 'front') return '<div id="typeans-slot"></div>';
      return compareTyped(ctx.typedAnswer ?? '', typeExpected);
    }

    for (const f of filters.slice().reverse()) {
      if (f === 'cloze') value = renderCloze(value, ctx.ord + 1, side);
      else if (f === 'text') value = escapeHtml(stripHtml(value));
      else if (f === 'hint') {
        if (fieldIsEmpty(value)) return '';
        value = `<details class="hint"><summary>Mostrar ${escapeHtml(name)}</summary>${value}</details>`;
      } else if (f === 'tts') {
        value = `<span class="tts" data-text="${escapeHtml(stripHtml(value))}">${value}</span>`;
      }
    }
    return value;
  });

  return { html: out, typeField, typeExpected };
}

export function renderCard(ctx: RenderContext): { front: RenderResult; back: RenderResult } {
  const tpl = ctx.noteType.kind === 'cloze' ? ctx.noteType.templates[0] : ctx.noteType.templates[ctx.ord];
  if (!tpl) {
    const err = { html: '<p>Modelo de cartão não encontrado.</p>' };
    return { front: err, back: err };
  }
  const front = renderTemplate(tpl.front, ctx, 'front');
  // No verso, {{FrontSide}} não deve mostrar a caixa de digitação
  const frontForBack = front.html.replace('<div id="typeans-slot"></div>', '');
  const back = renderTemplate(tpl.back, ctx, 'back', frontForBack);
  return { front, back };
}

/** Quais ordinais de cartão uma nota deve gerar (regra do Anki) */
export function cardOrdsForNote(nt: NoteType, note: Note): number[] {
  if (nt.kind === 'cloze') {
    const nums = new Set<number>();
    nt.fields.forEach((_f, i) => clozeNumbers(note.fields[i] ?? '').forEach((n) => nums.add(n)));
    const list = [...nums].sort((a, b) => a - b).map((n) => n - 1);
    return list.length ? list : [0];
  }
  const ords: number[] = [];
  nt.templates.forEach((t, i) => {
    const ctx: RenderContext = { noteType: nt, note, ord: i, deckName: '' };
    const filled = renderTemplate(t.front, ctx, 'front').html;
    const emptyNote: Note = { ...note, fields: note.fields.map(() => '') };
    const empty = renderTemplate(t.front, { ...ctx, note: emptyNote }, 'front').html;
    if (filled !== empty && !fieldIsEmpty(filled.replace('<div id="typeans-slot"></div>', ''))) ords.push(i);
  });
  return ords.length ? ords : [0];
}
