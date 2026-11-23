// Importador de pacotes do Anki (.apkg / .colpkg).
// Suporta o formato antigo (collection.anki2 / .anki21, esquema 11, modelos em JSON)
// e o novo (collection.anki21b, comprimido com zstd, esquema 18 com configs em protobuf).
import JSZip from 'jszip';
import initSqlJs, { type Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { decompress } from 'fzstd';
import type { Card, Collection, NoteType } from '../types';
import { ensureDeck, generateCards, normalizeTags } from '../collection';
import { saveMedia, mimeFor } from '../media';
import { dayStartTs, dayNumber, DAY } from '../time';

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const isZstd = (b: Uint8Array) => ZSTD_MAGIC.every((v, i) => b[i] === v);
const maybeDecompress = (b: Uint8Array) => (isZstd(b) ? decompress(b) : b);

// ---------- Leitor mínimo de protobuf ----------
type PbFields = Map<number, (number | Uint8Array)[]>;

function readVarint(buf: Uint8Array, pos: { p: number }): number {
  let result = 0;
  let shift = 0;
  while (pos.p < buf.length) {
    const b = buf[pos.p++];
    result += (b & 0x7f) * Math.pow(2, shift);
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return result;
}

export function parseProtobuf(buf: Uint8Array): PbFields {
  const out: PbFields = new Map();
  const pos = { p: 0 };
  while (pos.p < buf.length) {
    const key = readVarint(buf, pos);
    const field = Math.floor(key / 8);
    const wire = key & 7;
    let val: number | Uint8Array;
    if (wire === 0) val = readVarint(buf, pos);
    else if (wire === 2) {
      const len = readVarint(buf, pos);
      val = buf.subarray(pos.p, pos.p + len);
      pos.p += len;
    } else if (wire === 1) { val = 0; pos.p += 8; }
    else if (wire === 5) { val = 0; pos.p += 4; }
    else break;
    if (!out.has(field)) out.set(field, []);
    out.get(field)!.push(val);
  }
  return out;
}

const td = new TextDecoder();
const pbStr = (f: PbFields, n: number) => {
  const v = f.get(n)?.[0];
  return v instanceof Uint8Array ? td.decode(v) : '';
};
const pbNum = (f: PbFields, n: number) => {
  const v = f.get(n)?.[0];
  return typeof v === 'number' ? v : 0;
};

// ---------- Estruturas intermediárias ----------
interface AnkiModel {
  id: string;
  name: string;
  cloze: boolean;
  css: string;
  fields: string[];
  templates: { name: string; front: string; back: string }[];
}

function rows<T = Record<string, unknown>>(db: Database, sql: string): T[] {
  const res = db.exec(sql);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])) as T);
}

function tableExists(db: Database, name: string): boolean {
  return rows(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`).length > 0;
}

function readModels(db: Database): { models: AnkiModel[]; decks: Map<string, string> } {
  const decks = new Map<string, string>();
  const models: AnkiModel[] = [];
  if (tableExists(db, 'notetypes')) {
    // esquema 18
    for (const nt of rows<{ id: number; name: string; config: Uint8Array }>(db, 'SELECT id, name, config FROM notetypes')) {
      const cfg = parseProtobuf(nt.config ?? new Uint8Array());
      const fields = rows<{ name: string }>(db, `SELECT name FROM fields WHERE ntid=${nt.id} ORDER BY ord`).map((f) => f.name);
      const templates = rows<{ name: string; config: Uint8Array }>(db, `SELECT name, config FROM templates WHERE ntid=${nt.id} ORDER BY ord`).map((t) => {
        const tc = parseProtobuf(t.config ?? new Uint8Array());
        return { name: t.name, front: pbStr(tc, 1), back: pbStr(tc, 2) };
      });
      models.push({ id: String(nt.id), name: nt.name, cloze: pbNum(cfg, 1) === 1, css: pbStr(cfg, 3), fields, templates });
    }
    for (const d of rows<{ id: number; name: string }>(db, 'SELECT id, name FROM decks')) decks.set(String(d.id), d.name.split('\x1f').join('::'));
  } else {
    const col = rows<{ models: string; decks: string }>(db, 'SELECT models, decks FROM col')[0];
    const ms = JSON.parse(col.models) as Record<string, any>;
    for (const m of Object.values(ms)) {
      models.push({
        id: String(m.id),
        name: m.name,
        cloze: m.type === 1,
        css: m.css ?? '',
        fields: (m.flds as any[]).sort((a, b) => a.ord - b.ord).map((f) => f.name),
        templates: (m.tmpls as any[]).sort((a, b) => a.ord - b.ord).map((t) => ({ name: t.name, front: t.qfmt, back: t.afmt })),
      });
    }
    const ds = JSON.parse(col.decks) as Record<string, any>;
    for (const d of Object.values(ds)) decks.set(String(d.id), d.name);
  }
  return { models, decks };
}

export interface ApkgSummary {
  notes: number;
  cards: number;
  skipped: number;
  media: number;
  decks: string[];
}

export async function importApkg(
  col: Collection,
  file: Blob,
  opts: { keepScheduling: boolean; onProgress?: (msg: string) => void }
): Promise<ApkgSummary> {
  const log = opts.onProgress ?? (() => {});
  log('Lendo pacote…');
  const zip = await JSZip.loadAsync(file);
  const entry = zip.file('collection.anki21b') ?? zip.file('collection.anki21') ?? zip.file('collection.anki2');
  if (!entry) throw new Error('Arquivo inválido: coleção não encontrada no pacote.');
  const dbBytes = maybeDecompress(await entry.async('uint8array'));

  log('Abrindo banco de dados…');
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database(dbBytes);
  try {
    const { models, decks } = readModels(db);
    const crt = (rows<{ crt: number }>(db, 'SELECT crt FROM col')[0]?.crt ?? 0) * 1000;

    // tipos de nota
    const ntMap = new Map<string, NoteType>();
    for (const m of models) {
      const id = 'anki-' + m.id;
      const nt: NoteType = col.noteTypes[id] ?? {
        id,
        name: uniqueName(col, m.name),
        kind: m.cloze ? 'cloze' : 'standard',
        fields: m.fields.map((name) => ({ name })),
        templates: m.templates.length ? m.templates : [{ name: 'Cartão 1', front: `{{${m.fields[0]}}}`, back: '{{FrontSide}}' }],
        css: m.css,
      };
      col.noteTypes[id] = nt;
      ntMap.set(m.id, nt);
    }

    // notas
    log('Importando notas…');
    const notes = rows<{ id: number; mid: number; flds: string; tags: string; mod: number }>(db, 'SELECT id, mid, flds, tags, mod FROM notes');
    const cardsRows = rows<{ id: number; nid: number; did: number; ord: number; type: number; queue: number; due: number; ivl: number; factor: number; reps: number; lapses: number }>(
      db,
      'SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses FROM cards ORDER BY nid, ord'
    );
    const cardsByNote = new Map<number, typeof cardsRows>();
    for (const c of cardsRows) {
      if (!cardsByNote.has(c.nid)) cardsByNote.set(c.nid, []);
      cardsByNote.get(c.nid)!.push(c);
    }

    const deckCache = new Map<string, string>();
    const deckFor = (did: number) => {
      const key = String(did);
      if (!deckCache.has(key)) {
        let name = decks.get(key) ?? 'Importado';
        if (name === 'Default') name = 'Padrão';
        deckCache.set(key, ensureDeck(col, name).id);
      }
      return deckCache.get(key)!;
    };

    const summary: ApkgSummary = { notes: 0, cards: 0, skipped: 0, media: 0, decks: [] };
    const { dayStartHour } = col.settings;
    const today = dayNumber(Date.now(), dayStartHour);
    for (const n of notes) {
      const id = 'anki-' + n.id;
      const nt = ntMap.get(String(n.mid));
      if (!nt || col.notes[id]) { summary.skipped++; continue; }
      const fields = n.flds.split('\x1f');
      while (fields.length < nt.fields.length) fields.push('');
      col.notes[id] = { id, noteTypeId: nt.id, fields: fields.slice(0, nt.fields.length), tags: normalizeTags(n.tags), created: Math.floor(n.id), modified: n.mod * 1000 };
      const ac = cardsByNote.get(n.id) ?? [];
      const firstDeck = deckFor(ac[0]?.did ?? 1);
      // cria cartões com os ordinais do Anki
      for (const c of ac) {
        const card: Card = {
          id: 'anki-' + c.id, noteId: id, deckId: deckFor(c.did), ord: c.ord, type: 'new', due: 0, interval: 0, ease: 0, step: 0,
          reps: 0, lapses: 0, position: col.nextPosition++, suspended: c.queue === -1, buriedUntil: 0, flag: 0,
          stability: 0, difficulty: 0, lastReview: 0,
        };
        if (opts.keepScheduling && (c.type === 2 || c.type === 3)) {
          const dueDay = c.type === 2 && crt ? dayNumber(crt, dayStartHour) + c.due : today;
          card.type = 'review';
          card.interval = Math.max(1, c.ivl);
          card.ease = c.factor || 2500;
          card.due = dayStartTs(dueDay, dayStartHour);
          card.reps = c.reps;
          card.lapses = c.lapses;
          card.lastReview = card.due - card.interval * DAY;
        }
        col.cards[card.id] = card;
        summary.cards++;
      }
      if (!ac.length) summary.cards += generateCards(col, col.notes[id], firstDeck).length;
      summary.notes++;
    }
    summary.decks = [...new Set([...deckCache.values()].map((d) => col.decks[d].name))];

    // mídia
    const mediaEntry = zip.file('media');
    if (mediaEntry) {
      log('Importando mídia…');
      const raw = await mediaEntry.async('uint8array');
      let mapping: [string, string][] = [];
      try {
        mapping = Object.entries(JSON.parse(td.decode(raw)) as Record<string, string>);
      } catch {
        const pb = parseProtobuf(maybeDecompress(raw));
        mapping = (pb.get(1) ?? []).map((e, i) => [String(i), pbStr(parseProtobuf(e as Uint8Array), 1)]);
      }
      for (const [zipName, realName] of mapping) {
        const f = zip.file(zipName);
        if (!f || !realName) continue;
        const bytes = maybeDecompress(await f.async('uint8array'));
        await saveMedia(realName, new Blob([bytes], { type: mimeFor(realName) }), true);
        summary.media++;
      }
    }
    return summary;
  } finally {
    db.close();
  }
}

function uniqueName(col: Collection, name: string): string {
  const names = new Set(Object.values(col.noteTypes).map((n) => n.name));
  if (!names.has(name)) return name;
  let i = 2;
  while (names.has(`${name} (${i})`)) i++;
  return `${name} (${i})`;
}

export { mimeFor };
