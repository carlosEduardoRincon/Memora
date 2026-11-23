// Importação de texto (CSV/TSV) e exportação, no estilo "Arquivo > Importar" do Anki.
import type { Collection, Id } from '../types';
import { addNote, ensureDeck, findDuplicates, cardsOfNote } from '../collection';
import { stripHtml } from '../template';

export function detectSeparator(text: string): string {
  const firstLines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#')).slice(0, 5).join('\n');
  const counts: [string, number][] = ['\t', ';', ',', '|'].map((s) => [s, firstLines.split(s).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : '\t';
}

/** Parser CSV com suporte a aspas e quebras de linha dentro de campos */
export function parseDelimited(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { inQuotes = true; i++; continue; }
    if (ch === sep) { row.push(field); field = ''; i++; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
      i++; continue;
    }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

export interface TextImportOptions {
  text: string;
  separator: string;
  noteTypeId: Id;
  deckId: Id;
  /** índice da coluna para cada campo (-1 = ignorar) */
  fieldMap: number[];
  tagsColumn: number; // -1 = nenhuma
  extraTags: string[];
  allowHtml: boolean;
  skipFirstRow: boolean;
  duplicates: 'add' | 'skip' | 'update';
}

export interface ImportSummary {
  added: number;
  updated: number;
  skipped: number;
  cards: number;
}

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

export function importText(col: Collection, o: TextImportOptions): ImportSummary {
  // Diretivas de cabeçalho do Anki (#separator:tab, #html:true, #deck:..., #tags:...)
  let text = o.text.replace(/^﻿/, '');
  let sep = o.separator;
  let allowHtml = o.allowHtml;
  let deckId = o.deckId;
  const extra = [...o.extraTags];
  const lines = text.split(/\r?\n/);
  let headerEnd = 0;
  while (headerEnd < lines.length && lines[headerEnd].startsWith('#')) {
    const [k, ...rest] = lines[headerEnd].slice(1).split(':');
    const v = rest.join(':').trim();
    const key = k.trim().toLowerCase();
    if (key === 'separator') sep = ({ tab: '\t', comma: ',', semicolon: ';', pipe: '|', space: ' ' } as Record<string, string>)[v.toLowerCase()] ?? v;
    if (key === 'html') allowHtml = v.toLowerCase() === 'true';
    if (key === 'deck') deckId = ensureDeck(col, v).id;
    if (key === 'tags') extra.push(...v.split(/\s+/).filter(Boolean));
    headerEnd++;
  }
  text = lines.slice(headerEnd).join('\n');

  const rows = parseDelimited(text, sep);
  if (o.skipFirstRow) rows.shift();
  const nt = col.noteTypes[o.noteTypeId];
  const summary: ImportSummary = { added: 0, updated: 0, skipped: 0, cards: 0 };
  for (const row of rows) {
    const fields = nt.fields.map((_f, i) => {
      const colIdx = o.fieldMap[i] ?? -1;
      const raw = colIdx >= 0 ? (row[colIdx] ?? '') : '';
      return allowHtml ? raw.trim() : escapeText(raw.trim());
    });
    if (!stripHtml(fields.join('')).trim() && !/<img/i.test(fields.join(''))) { summary.skipped++; continue; }
    const tags = [...extra, ...(o.tagsColumn >= 0 ? (row[o.tagsColumn] ?? '').split(/\s+/) : [])];
    const dups = findDuplicates(col, nt.id, fields[0]);
    if (dups.length && o.duplicates !== 'add') {
      if (o.duplicates === 'update') {
        const n = dups[0];
        n.fields = fields;
        n.tags = [...new Set([...n.tags, ...tags.filter(Boolean)])];
        n.modified = Date.now();
        summary.updated++;
      } else summary.skipped++;
      continue;
    }
    const { cards } = addNote(col, nt.id, deckId, fields, tags);
    summary.added++;
    summary.cards += cards.length;
  }
  return summary;
}

function csvCell(s: string, sep: string): string {
  return /["\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Exporta notas como texto (TSV) com cabeçalho compatível com o Anki */
export function exportNotesText(col: Collection, deckIds: Set<Id> | null, includeHtml: boolean): string {
  const sep = '\t';
  const data: { vals: string[]; tags: string }[] = [];
  let maxFields = 0;
  for (const n of Object.values(col.notes)) {
    const cards = cardsOfNote(col, n.id);
    if (deckIds && !cards.some((c) => deckIds.has(c.deckId))) continue;
    const vals = n.fields.map((f) => (includeHtml ? f : stripHtml(f)));
    maxFields = Math.max(maxFields, vals.length);
    data.push({ vals, tags: n.tags.join(' ') });
  }
  const rows = data.map(({ vals, tags }) => {
    const padded = [...vals, ...new Array(maxFields - vals.length).fill('')];
    return [...padded, tags].map((v) => csvCell(v, sep)).join(sep);
  });
  const header = ['#separator:tab', `#html:${includeHtml}`, `#tags column:${maxFields + 1}`];
  return header.join('\n') + '\n' + rows.join('\n') + '\n';
}
