// Estado global + persistência no IndexedDB do navegador (funciona offline).
import { useSyncExternalStore } from 'react';
import { createStore, get, set } from 'idb-keyval';
import type { Collection } from './types';
import { emptyCollection, defaultPreset, builtinNoteTypes } from './defaults';
import { applyUndo, type UndoEntry } from './collection';

const db = createStore('memora', 'collection');
const KEY = 'col';

let col: Collection = emptyCollection();
let version = 0;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const undoStack: UndoEntry[] = [];

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function getCol(): Collection {
  return col;
}

/** Corrige coleções antigas/importadas acrescentando campos que faltam */
export function migrate(c: Collection): Collection {
  const base = emptyCollection();
  c.settings = { ...base.settings, ...(c.settings ?? {}) };
  c.presets = c.presets ?? {};
  for (const id of Object.keys(c.presets)) c.presets[id] = { ...defaultPreset(id, c.presets[id].name), ...c.presets[id] };
  if (!c.presets['default']) c.presets['default'] = defaultPreset();
  c.noteTypes = c.noteTypes ?? {};
  if (!Object.keys(c.noteTypes).length) for (const nt of builtinNoteTypes()) c.noteTypes[nt.id] = nt;
  c.decks = c.decks ?? {};
  if (!Object.keys(c.decks).length) c.decks = base.decks;
  c.notes = c.notes ?? {};
  c.cards = c.cards ?? {};
  c.revlog = c.revlog ?? [];
  c.extraLimits = c.extraLimits ?? [];
  c.nextPosition = c.nextPosition ?? Object.keys(c.cards).length + 1;
  for (const card of Object.values(c.cards)) {
    card.buriedUntil = card.buriedUntil ?? 0;
    card.flag = card.flag ?? 0;
    card.stability = card.stability ?? 0;
    card.difficulty = card.difficulty ?? 0;
    card.lastReview = card.lastReview ?? 0;
  }
  return c;
}

export async function loadCollection(): Promise<void> {
  try {
    const saved = await get<Collection>(KEY, db);
    if (saved) col = migrate(saved);
  } catch (e) {
    console.error('Falha ao carregar coleção', e);
  }
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }
  emit();
}

export async function saveNow(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  await set(KEY, col, db);
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveNow().catch((e) => console.error('Falha ao salvar', e));
  }, 400);
}

if (typeof window !== 'undefined') {
  const flush = () => { if (saveTimer) void saveNow(); };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

/** Aplica uma alteração à coleção, notifica a interface e agenda o salvamento */
export function mutate<T>(fn: (c: Collection) => T): T {
  const r = fn(col);
  emit();
  scheduleSave();
  return r;
}

export function replaceCollection(c: Collection): void {
  col = migrate(c);
  undoStack.length = 0;
  emit();
  scheduleSave();
}

export function pushUndo(u: UndoEntry): void {
  undoStack.push(u);
  if (undoStack.length > 50) undoStack.shift();
}

export function canUndo(): string | null {
  return undoStack.length ? undoStack[undoStack.length - 1].label : null;
}

export function undo(): UndoEntry | null {
  const u = undoStack.pop();
  if (!u) return null;
  mutate((c) => applyUndo(c, u));
  return u;
}

export function useCollection(): Collection {
  useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => version
  );
  return col;
}
