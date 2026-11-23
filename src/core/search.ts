// Busca no estilo do Anki:
//   texto livre, "frase exata", -negação, OR,  deck:Nome (inclui subbaralhos, aceita *),
//   tag:nome  note:Tipo  card:1  is:new|learn|review|due|suspended|buried  flag:1..7
//   prop:ivl>10  prop:due<=1  prop:lapses>3  prop:ease<2  prop:reps>5
//   rated:N  added:N  campo:valor
import type { Card, Collection } from './types';
import { stripHtml } from './template';
import { DAY, dayNumber, endOfToday } from './time';
import { SEP } from './collection';

type Pred = (c: Card) => boolean;

function tokenize(q: string): string[] {
  const out: string[] = [];
  const re = /(-?)(?:"([^"]*)"|([^\s()]+)|(\()|(\)))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    if (m[4]) out.push(m[1] + '(');
    else if (m[5]) out.push(')');
    else out.push(m[1] + (m[2] !== undefined ? m[2] : m[3]));
  }
  return out;
}

function globToRe(s: string, whole = true): RegExp {
  const esc = s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/_/g, '.');
  return new RegExp(whole ? `^${esc}$` : esc, 'i');
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function buildSearch(col: Collection, query: string, now = Date.now()): Pred {
  const tokens = tokenize(query.trim());
  let pos = 0;
  const { dayStartHour } = col.settings;
  const eod = endOfToday(now, dayStartHour);
  const today = dayNumber(now, dayStartHour);

  const term = (raw: string): Pred => {
    let neg = false;
    if (raw.startsWith('-') && raw.length > 1) { neg = true; raw = raw.slice(1); }
    const p = atom(raw);
    return neg ? (c) => !p(c) : p;
  };

  const atom = (t: string): Pred => {
    const idx = t.indexOf(':');
    if (idx > 0) {
      const key = t.slice(0, idx).toLowerCase();
      const val = t.slice(idx + 1);
      switch (key) {
        case 'deck': {
          if (val === 'current' || val === '*') return () => true;
          const re = globToRe(val);
          const ids = new Set(Object.values(col.decks).filter((d) => {
            const parts = d.name.split(SEP);
            for (let i = 1; i <= parts.length; i++) if (re.test(parts.slice(0, i).join(SEP))) return true;
            return false;
          }).map((d) => d.id));
          return (c) => ids.has(c.deckId);
        }
        case 'tag': {
          if (val === 'none') return (c) => !col.notes[c.noteId]?.tags.length;
          const re = globToRe(val);
          return (c) => !!col.notes[c.noteId]?.tags.some((tg) => re.test(tg) || tg.toLowerCase().startsWith(val.toLowerCase() + '::'));
        }
        case 'note': {
          const re = globToRe(val);
          return (c) => re.test(col.noteTypes[col.notes[c.noteId]?.noteTypeId]?.name ?? '');
        }
        case 'card': {
          const n = parseInt(val, 10);
          if (!isNaN(n)) return (c) => c.ord === n - 1;
          const re = globToRe(val);
          return (c) => {
            const nt = col.noteTypes[col.notes[c.noteId]?.noteTypeId];
            return !!nt && re.test(nt.templates[c.ord]?.name ?? '');
          };
        }
        case 'is':
          switch (val.toLowerCase()) {
            case 'new': return (c) => c.type === 'new';
            case 'learn': return (c) => c.type === 'learning' || c.type === 'relearning';
            case 'review': return (c) => c.type === 'review' || c.type === 'relearning';
            case 'due': return (c) => c.type !== 'new' && c.due < eod && !c.suspended;
            case 'suspended': return (c) => c.suspended;
            case 'buried': return (c) => c.buriedUntil > now;
          }
          return () => false;
        case 'nid': {
          const ids = new Set(val.split(','));
          return (c) => ids.has(c.noteId);
        }
        case 'cid': {
          const ids = new Set(val.split(','));
          return (c) => ids.has(c.id);
        }
        case 'flag': {
          const n = parseInt(val, 10);
          return (c) => c.flag === n;
        }
        case 'rated': {
          const days = Math.max(1, parseInt(val, 10) || 1);
          const since = eod - days * DAY;
          const ids = new Set(col.revlog.filter((r) => r.time >= since).map((r) => r.cardId));
          return (c) => ids.has(c.id);
        }
        case 'added': {
          const days = Math.max(1, parseInt(val, 10) || 1);
          const since = eod - days * DAY;
          return (c) => (col.notes[c.noteId]?.created ?? 0) >= since;
        }
        case 'prop': {
          const m = /^(ivl|due|reps|lapses|ease|pos)(<=|>=|!=|=|<|>)(-?[\d.]+)$/i.exec(val);
          if (!m) return () => false;
          const [, prop, op, numS] = m;
          const num = parseFloat(numS);
          const get = (c: Card): number | null => {
            switch (prop.toLowerCase()) {
              case 'ivl': return c.type === 'review' ? c.interval : null;
              case 'due': return c.type === 'review' ? dayNumber(c.due, dayStartHour) - today : null;
              case 'reps': return c.reps;
              case 'lapses': return c.lapses;
              case 'ease': return c.type === 'new' ? null : c.ease / 1000;
              case 'pos': return c.type === 'new' ? c.position : null;
            }
            return null;
          };
          const cmp = (a: number) =>
            op === '<' ? a < num : op === '>' ? a > num : op === '<=' ? a <= num : op === '>=' ? a >= num : op === '!=' ? a !== num : a === num;
          return (c) => { const v = get(c); return v !== null && cmp(v); };
        }
        default: {
          // campo:valor
          const re = globToRe(norm(val));
          return (c) => {
            const n = col.notes[c.noteId];
            const nt = n && col.noteTypes[n.noteTypeId];
            if (!nt) return false;
            const i = nt.fields.findIndex((f) => f.name.toLowerCase() === key);
            return i >= 0 && re.test(norm(stripHtml(n.fields[i] ?? '')));
          };
        }
      }
    }
    // texto livre
    const needle = norm(t);
    const re = needle.includes('*') || needle.includes('_') ? globToRe(needle, false) : null;
    return (c) => {
      const n = col.notes[c.noteId];
      if (!n) return false;
      const text = norm(stripHtml(n.fields.join(' ')) + ' ' + n.tags.join(' '));
      return re ? re.test(text) : text.includes(needle);
    };
  };

  const parseOr = (): Pred => {
    let left = parseAnd();
    while (tokens[pos]?.toLowerCase() === 'or') {
      pos++;
      const right = parseAnd();
      const l = left;
      left = (c) => l(c) || right(c);
    }
    return left;
  };

  const parseAnd = (): Pred => {
    const preds: Pred[] = [];
    while (pos < tokens.length && tokens[pos] !== ')' && tokens[pos].toLowerCase() !== 'or') {
      const t = tokens[pos++];
      if (t === '(' || t === '-(') {
        const inner = parseOr();
        if (tokens[pos] === ')') pos++;
        preds.push(t === '-(' ? (c) => !inner(c) : inner);
      } else if (t.toLowerCase() === 'and') continue;
      else preds.push(term(t));
    }
    return (c) => preds.every((p) => p(c));
  };

  return parseOr();
}

export function searchCards(col: Collection, query: string): Card[] {
  const pred = buildSearch(col, query);
  return Object.values(col.cards).filter(pred);
}
