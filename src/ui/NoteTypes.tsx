import { useState } from 'react';
import { useCollection, mutate } from '../core/store';
import { addField, addTemplate, cloneNoteType, moveField, noteTypeUsage, regenerateAll, removeField, removeTemplate, renameField, deleteNotes } from '../core/collection';
import { renderCard } from '../core/template';
import type { Note } from '../core/types';
import { askText, confirmBox, toast } from './common';
import { CardView } from './CardView';

export function NoteTypes() {
  const col = useCollection();
  const [sel, setSel] = useState<string>(Object.keys(col.noteTypes)[0]);
  const nt = col.noteTypes[sel] ?? Object.values(col.noteTypes)[0];
  const [tplIdx, setTplIdx] = useState(0);
  const [side, setSide] = useState<'front' | 'back' | 'css'>('front');
  const tpl = nt.templates[Math.min(tplIdx, nt.templates.length - 1)];

  const sampleNote: Note = {
    id: 'preview', noteTypeId: nt.id, tags: ['exemplo'], created: 0, modified: 0,
    fields: nt.fields.map((f, i) => (nt.kind === 'cloze' && i === 0 ? 'Exemplo de {{c1::omissão}} e {{c2::outra::dica}}' : `(${f.name})`)),
  };
  const preview = renderCard({ noteType: nt, note: sampleNote, ord: nt.kind === 'cloze' ? 0 : tplIdx, deckName: 'Exemplo' });

  const clone = async () => {
    const name = await askText('Novo tipo de nota (cópia)', nt.name + ' (cópia)');
    if (!name) return;
    const n = mutate((c) => cloneNoteType(c, nt.id, name));
    setSel(n.id);
  };
  const remove = async () => {
    const used = noteTypeUsage(col, nt.id);
    if (Object.keys(col.noteTypes).length <= 1) return;
    if (!(await confirmBox('Excluir tipo de nota', used ? `Isto excluirá ${used} nota(s) e seus cartões!` : 'Excluir este tipo de nota?'))) return;
    mutate((c) => {
      deleteNotes(c, Object.values(c.notes).filter((n) => n.noteTypeId === nt.id).map((n) => n.id));
      delete c.noteTypes[nt.id];
    });
    setSel(Object.keys(col.noteTypes)[0]);
  };

  return (
    <div className="page wide">
      <h1>Tipos de nota</h1>
      <div className="nt-layout">
        <aside className="nt-list">
          {Object.values(col.noteTypes).map((t) => (
            <button key={t.id} className={t.id === nt.id ? 'active' : ''} onClick={() => { setSel(t.id); setTplIdx(0); }}>
              {t.name}<small>{noteTypeUsage(col, t.id)} notas</small>
            </button>
          ))}
          <button className="primary" onClick={clone}>＋ Clonar selecionado</button>
        </aside>
        <div className="nt-detail">
          <div className="row-gap">
            <h2 className="grow">{nt.name} <small className="muted">({nt.kind === 'cloze' ? 'cloze' : 'padrão'})</small></h2>
            <button onClick={async () => { const n = await askText('Renomear tipo', nt.name); if (n) mutate((c) => { c.noteTypes[nt.id].name = n; }); }}>Renomear</button>
            <button className="danger" onClick={remove}>Excluir</button>
          </div>

          <h3>Campos</h3>
          <ul className="field-list">
            {nt.fields.map((f, i) => (
              <li key={i}>
                <span className="grow">{i + 1}. {f.name}</span>
                <button className="small" onClick={() => mutate((c) => moveField(c, nt.id, i, -1))} disabled={i === 0}>↑</button>
                <button className="small" onClick={() => mutate((c) => moveField(c, nt.id, i, 1))} disabled={i === nt.fields.length - 1}>↓</button>
                <button className="small" onClick={async () => { const n = await askText('Renomear campo', f.name); if (n && !nt.fields.some((x) => x.name === n)) mutate((c) => renameField(c, nt.id, i, n)); }}>Renomear</button>
                <button className="small danger" disabled={nt.fields.length <= 1} onClick={async () => { if (await confirmBox('Remover campo', `Remover "${f.name}" e seu conteúdo de todas as notas?`)) mutate((c) => removeField(c, nt.id, i)); }}>Remover</button>
              </li>
            ))}
          </ul>
          <button onClick={async () => { const n = await askText('Novo campo'); if (n && !nt.fields.some((x) => x.name === n)) mutate((c) => addField(c, nt.id, n)); }}>＋ Adicionar campo</button>

          <h3>Modelos de cartão</h3>
          <div className="row-gap">
            {nt.kind !== 'cloze' && (
              <select value={tplIdx} onChange={(e) => setTplIdx(+e.target.value)}>
                {nt.templates.map((t, i) => <option key={i} value={i}>{t.name}</option>)}
              </select>
            )}
            {nt.kind !== 'cloze' && <button onClick={() => { mutate((c) => addTemplate(c, nt.id)); setTplIdx(nt.templates.length - 1); toast('Modelo adicionado; cartões gerados quando aplicável.'); }}>＋ Modelo</button>}
            {nt.kind !== 'cloze' && nt.templates.length > 1 && (
              <button className="danger" onClick={async () => { if (await confirmBox('Remover modelo', 'Os cartões gerados por este modelo serão excluídos.')) { mutate((c) => removeTemplate(c, nt.id, tplIdx)); setTplIdx(0); } }}>Remover modelo</button>
            )}
            <div className="segmented">
              <button className={side === 'front' ? 'active' : ''} onClick={() => setSide('front')}>Frente</button>
              <button className={side === 'back' ? 'active' : ''} onClick={() => setSide('back')}>Verso</button>
              <button className={side === 'css' ? 'active' : ''} onClick={() => setSide('css')}>Estilo (CSS)</button>
            </div>
          </div>
          <div className="tpl-editor">
            <textarea
              spellCheck={false}
              value={side === 'css' ? nt.css : side === 'front' ? tpl.front : tpl.back}
              onChange={(e) => mutate((c) => {
                const t = c.noteTypes[nt.id];
                if (side === 'css') t.css = e.target.value;
                else t.templates[tplIdx][side] = e.target.value;
              })}
              onBlur={() => { if (side === 'front') mutate((c) => regenerateAll(c, nt.id)); }}
            />
            <div className="card-area preview">
              <CardView html={side === 'back' ? preview.back.html : preview.front.html} css={nt.css} />
            </div>
          </div>
          <p className="muted small">
            Use <code>{'{{Campo}}'}</code>, <code>{'{{FrontSide}}'}</code>, <code>{'{{#Campo}}…{{/Campo}}'}</code> (se preenchido),
            <code>{'{{^Campo}}…{{/Campo}}'}</code> (se vazio), <code>{'{{hint:Campo}}'}</code>, <code>{'{{type:Campo}}'}</code>,
            <code>{'{{tts:Campo}}'}</code>, <code>{'{{text:Campo}}'}</code>, <code>{'{{cloze:Campo}}'}</code>, <code>{'{{Tags}}'}</code>, <code>{'{{Deck}}'}</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
