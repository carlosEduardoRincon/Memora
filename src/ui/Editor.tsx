import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { useCollection, mutate } from '../core/store';
import { addNote, cardsOfNote, findDuplicates, sortedDecks, updateNote } from '../core/collection';
import { clozeNumbers, stripHtml } from '../core/template';
import { mediaUrl, saveMedia } from '../core/media';
import type { NoteType } from '../core/types';
import { go, toast } from './common';

const PASTE_TAGS = ['b', 'strong', 'i', 'em', 'u', 'br', 'div', 'p', 'ul', 'ol', 'li', 'img', 'sub', 'sup', 'a', 'span', 'table', 'tr', 'td', 'th', 'tbody', 'thead', 'code', 'pre'];

async function toEditorHtml(html: string): Promise<string> {
  const div = document.createElement('div');
  div.innerHTML = DOMPurify.sanitize(html);
  for (const img of Array.from(div.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? '';
    if (src && !/^(https?:|data:|blob:)/.test(src)) {
      const u = await mediaUrl(src);
      if (u) { img.setAttribute('data-media', src); img.setAttribute('src', u); }
    }
  }
  return div.innerHTML;
}

function fromEditorHtml(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('img[data-media]').forEach((img) => {
    img.setAttribute('src', img.getAttribute('data-media')!);
    img.removeAttribute('data-media');
  });
  let html = clone.innerHTML;
  if (html === '<br>') html = '';
  return html;
}

function insertHtml(html: string) {
  document.execCommand('insertHTML', false, html);
}

async function insertMediaFile(file: File) {
  const name = await saveMedia(file.name || `colado-${Date.now()}.${file.type.split('/')[1] || 'png'}`, file);
  if (file.type.startsWith('image/')) {
    const u = await mediaUrl(name);
    insertHtml(`<img src="${u}" data-media="${name}">`);
  } else if (file.type.startsWith('audio/') || file.type.startsWith('video/')) {
    insertHtml(`[sound:${name}]`);
  }
}

function FieldEditor({
  label, value, onChange, nextCloze, autoFocus, sticky, onToggleSticky,
}: {
  label: string; value: string; onChange: (v: string) => void; nextCloze?: () => number; autoFocus?: boolean;
  sticky?: boolean; onToggleSticky?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);
  const [htmlMode, setHtmlMode] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // carrega valor externo (sem atrapalhar a digitação)
  useEffect(() => {
    if (htmlMode || !ref.current) return;
    if (value === lastEmitted.current) return;
    let alive = true;
    toEditorHtml(value).then((h) => { if (alive && ref.current) ref.current.innerHTML = h; });
    lastEmitted.current = value;
    return () => { alive = false; };
  }, [value, htmlMode]);

  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);

  const emit = () => {
    if (!ref.current) return;
    const v = fromEditorHtml(ref.current);
    lastEmitted.current = v;
    onChange(v);
  };

  const cmd = (c: string, arg?: string) => { ref.current?.focus(); document.execCommand(c, false, arg); emit(); };

  const cloze = (same: boolean) => {
    if (!nextCloze) return;
    ref.current?.focus();
    const n = nextCloze() - (same ? 1 : 0);
    const sel = window.getSelection()?.toString() ?? '';
    insertHtml(`{{c${Math.max(1, n)}::${sel || '...'}}}`);
    emit();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'c') { e.preventDefault(); cloze(e.altKey); }
    else if ((e.ctrlKey || e.metaKey) && k === 'b') { e.preventDefault(); cmd('bold'); }
    else if ((e.ctrlKey || e.metaKey) && k === 'i') { e.preventDefault(); cmd('italic'); }
    else if ((e.ctrlKey || e.metaKey) && k === 'u') { e.preventDefault(); cmd('underline'); }
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length) {
      e.preventDefault();
      for (const f of files) await insertMediaFile(f);
      emit();
      return;
    }
    const html = e.clipboardData.getData('text/html');
    if (html) {
      e.preventDefault();
      insertHtml(DOMPurify.sanitize(html, { ALLOWED_TAGS: PASTE_TAGS, ALLOWED_ATTR: ['src', 'href'] }));
      emit();
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    e.preventDefault();
    ref.current?.focus();
    for (const f of files) await insertMediaFile(f);
    emit();
  };

  return (
    <div className="field-editor">
      <div className="field-label">
        <span>{label}</span>
        <div className="toolbar">
          <button type="button" title="Negrito (Ctrl+B)" onMouseDown={(e) => { e.preventDefault(); cmd('bold'); }}><b>B</b></button>
          <button type="button" title="Itálico (Ctrl+I)" onMouseDown={(e) => { e.preventDefault(); cmd('italic'); }}><i>I</i></button>
          <button type="button" title="Sublinhado (Ctrl+U)" onMouseDown={(e) => { e.preventDefault(); cmd('underline'); }}><u>U</u></button>
          <button type="button" title="Subscrito" onMouseDown={(e) => { e.preventDefault(); cmd('subscript'); }}>x₂</button>
          <button type="button" title="Sobrescrito" onMouseDown={(e) => { e.preventDefault(); cmd('superscript'); }}>x²</button>
          <button type="button" title="Lista" onMouseDown={(e) => { e.preventDefault(); cmd('insertUnorderedList'); }}>•≡</button>
          <button type="button" title="Limpar formatação" onMouseDown={(e) => { e.preventDefault(); cmd('removeFormat'); }}>⌫A</button>
          {nextCloze && <button type="button" title="Cloze (Ctrl+Shift+C) — mesmo número: Ctrl+Shift+Alt+C" onMouseDown={(e) => { e.preventDefault(); cloze(e.altKey); }}>[…]</button>}
          <button type="button" title="Inserir imagem/áudio" onClick={() => fileRef.current?.click()}>📎</button>
          <button type="button" title="Editar HTML" className={htmlMode ? 'active' : ''} onClick={() => { setHtmlMode(!htmlMode); lastEmitted.current = null; }}>&lt;/&gt;</button>
          {onToggleSticky && <button type="button" title="Fixar campo (manter valor ao adicionar)" className={sticky ? 'active' : ''} onClick={onToggleSticky}>📌</button>}
          <input ref={fileRef} type="file" accept="image/*,audio/*,video/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) { ref.current?.focus(); await insertMediaFile(f); emit(); }
            e.target.value = '';
          }} />
        </div>
      </div>
      {htmlMode ? (
        <textarea className="html-editor" value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <div
          ref={ref}
          className="rich-field"
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onBlur={emit}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onDrop={onDrop}
        />
      )}
    </div>
  );
}

function NoteFields({ nt, fields, setFields, sticky, setSticky }: {
  nt: NoteType; fields: string[]; setFields: (f: string[]) => void; sticky?: boolean[]; setSticky?: (s: boolean[]) => void;
}) {
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const nextCloze = () => {
    const nums = fieldsRef.current.flatMap((f) => clozeNumbers(f));
    return (nums.length ? Math.max(...nums) : 0) + 1;
  };
  return (
    <>
      {nt.fields.map((f, i) => (
        <FieldEditor
          key={nt.id + i}
          label={f.name}
          value={fields[i] ?? ''}
          autoFocus={i === 0}
          onChange={(v) => { const next = [...fieldsRef.current]; next[i] = v; fieldsRef.current = next; setFields(next); }}
          nextCloze={nt.kind === 'cloze' ? nextCloze : undefined}
          sticky={sticky?.[i]}
          onToggleSticky={setSticky && sticky ? () => { const s = [...sticky]; s[i] = !s[i]; setSticky(s); } : undefined}
        />
      ))}
    </>
  );
}

function TagsInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const col = useCollection();
  const all = [...new Set(Object.values(col.notes).flatMap((n) => n.tags))].sort();
  return (
    <label className="field">
      Etiquetas (separadas por espaço)
      <input list="tags-list" value={value} onChange={(e) => onChange(e.target.value)} placeholder="ex.: biologia prova1" />
      <datalist id="tags-list">
        {all.map((t) => <option key={t} value={(value.replace(/\S*$/, '') + t).trim()} />)}
      </datalist>
    </label>
  );
}

export function NoteEditor({ noteId, onSaved }: { noteId: string; onSaved?: () => void }) {
  const col = useCollection();
  const note = col.notes[noteId];
  const [fields, setFields] = useState(() => [...(note?.fields ?? [])]);
  const [tags, setTags] = useState(() => note?.tags.join(' ') ?? '');
  if (!note) return <p>Nota não encontrada.</p>;
  const nt = col.noteTypes[note.noteTypeId];
  const save = () => {
    const created = mutate((c) => updateNote(c, noteId, fields, tags.split(/\s+/)));
    toast(created.length ? `Salvo. ${created.length} novo(s) cartão(ões) gerado(s).` : 'Nota salva', 'success');
    onSaved?.();
  };
  const cards = cardsOfNote(col, noteId);
  return (
    <div onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(); } }}>
      <p className="muted small">Tipo: {nt?.name} · {cards.length} cartão(ões) · criado em {new Date(note.created).toLocaleDateString('pt-BR')}</p>
      {nt && <NoteFields nt={nt} fields={fields} setFields={setFields} />}
      <TagsInput value={tags} onChange={setTags} />
      <div className="row-gap right">
        <button className="primary" onClick={save}>Salvar <kbd>Ctrl+Enter</kbd></button>
      </div>
    </div>
  );
}

export function AddNote({ deckId: initialDeck }: { deckId?: string }) {
  const col = useCollection();
  const [ntId, setNtId] = useState(() => (col.settings.lastNoteTypeId && col.noteTypes[col.settings.lastNoteTypeId] ? col.settings.lastNoteTypeId : Object.keys(col.noteTypes)[0]));
  const [deckId, setDeckId] = useState(() => (initialDeck && col.decks[initialDeck] ? initialDeck : col.settings.lastDeckId && col.decks[col.settings.lastDeckId] ? col.settings.lastDeckId : Object.keys(col.decks)[0]));
  const nt = col.noteTypes[ntId];
  const [fields, setFields] = useState<string[]>(() => nt.fields.map(() => ''));
  const [sticky, setSticky] = useState<boolean[]>(() => nt.fields.map(() => false));
  const [tags, setTags] = useState('');
  const [formKey, setFormKey] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    setFields((f) => nt.fields.map((_x, i) => f[i] ?? ''));
    setSticky(nt.fields.map(() => false));
    setFormKey((k) => k + 1);
  }, [ntId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dups = findDuplicates(col, ntId, fields[0] ?? '');
  const add = () => {
    if (!stripHtml(fields[0] ?? '').trim() && !/<img/.test(fields[0] ?? '')) { toast('O primeiro campo está vazio.', 'error'); return; }
    if (nt.kind === 'cloze' && !fields.some((f) => clozeNumbers(f).length)) {
      toast('Nota cloze sem omissões. Selecione um texto e use [...] ou Ctrl+Shift+C.', 'error');
      return;
    }
    const { note, cards } = mutate((c) => {
      c.settings.lastDeckId = deckId;
      c.settings.lastNoteTypeId = ntId;
      return addNote(c, ntId, deckId, fields, tags.split(/\s+/));
    });
    toast(`Adicionado: ${cards.length} cartão(ões)`, 'success');
    setRecent((r) => [note.id, ...r].slice(0, 8));
    setFields(fields.map((f, i) => (sticky[i] ? f : '')));
    setFormKey((k) => k + 1);
  };

  return (
    <div className="page narrow" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); add(); } }}>
      <h1>Adicionar</h1>
      <div className="row-gap">
        <label className="field grow">Tipo
          <select value={ntId} onChange={(e) => setNtId(e.target.value)}>
            {Object.values(col.noteTypes).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="field grow">Baralho
          <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            {sortedDecks(col).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      </div>
      {nt.kind === 'cloze' && (
        <p className="hint-box">Selecione o texto e clique em <b>[…]</b> (ou <kbd>Ctrl+Shift+C</kbd>) para criar uma omissão. Cada número (c1, c2…) vira um cartão. Use <code>{'{{c1::resposta::dica}}'}</code> para dicas.</p>
      )}
      <div key={formKey}>
        <NoteFields nt={nt} fields={fields} setFields={setFields} sticky={sticky} setSticky={setSticky} />
      </div>
      {dups.length > 0 && <p className="warn">⚠ Já existe uma nota com este primeiro campo. <a href={`#/browse/${encodeURIComponent('nid:' + dups[0].id)}`}>Ver</a></p>}
      <TagsInput value={tags} onChange={setTags} />
      <div className="row-gap right">
        <button onClick={() => go('')}>Fechar</button>
        <button className="primary" onClick={add}>Adicionar <kbd>Ctrl+Enter</kbd></button>
      </div>
      {recent.length > 0 && (
        <div className="recent">
          <h3>Adicionados recentemente</h3>
          <ul>
            {recent.filter((id) => col.notes[id]).map((id) => (
              <li key={id}><a href={`#/browse/${encodeURIComponent('nid:' + id)}`}>{stripHtml(col.notes[id].fields[0]).slice(0, 80) || '(vazio)'}</a></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
