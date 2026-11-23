import { useState } from 'react';
import { useCollection, mutate, replaceCollection, getCol, saveNow } from '../core/store';
import { sortedDecks, deckAndDescendants } from '../core/collection';
import { detectSeparator, exportNotesText, importText, parseDelimited } from '../core/io/text';
import { downloadBlob, exportBackup, readBackup } from '../core/io/backup';
import { confirmBox, toast } from './common';

const SEPS: [string, string][] = [['\t', 'Tabulação'], [',', 'Vírgula'], [';', 'Ponto e vírgula'], ['|', 'Barra vertical']];

export function ImportExport({ exportDeck }: { exportDeck?: string }) {
  return (
    <div className="page narrow">
      <h1>Importar / Exportar</h1>
      <ApkgImport />
      <TextImport />
      <Export initialDeck={exportDeck} />
      <Backup />
    </div>
  );
}

function ApkgImport() {
  const [busy, setBusy] = useState('');
  const [keep, setKeep] = useState(false);
  const onFile = async (f: File) => {
    setBusy('Carregando…');
    try {
      const { importApkg } = await import('../core/io/apkg');
      // trabalha numa cópia; só aplica se der certo
      const draft = structuredClone(getCol());
      const s = await importApkg(draft, f, { keepScheduling: keep, onProgress: setBusy });
      replaceCollection(draft);
      await saveNow();
      toast(`Importado: ${s.notes} notas, ${s.cards} cartões, ${s.media} arquivos de mídia${s.skipped ? ` (${s.skipped} já existiam)` : ''}.`, 'success');
    } catch (e) {
      console.error(e);
      toast('Falha ao importar: ' + (e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  };
  return (
    <section className="box">
      <h2>Pacote do Anki (.apkg / .colpkg)</h2>
      <p className="muted">Importe baralhos baixados do AnkiWeb ou exportados do Anki desktop — inclui tipos de nota, modelos, estilos e mídia.</p>
      <label className="check"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Manter progresso de agendamento (para coleções pessoais)</label>
      <input type="file" accept=".apkg,.colpkg,.zip" disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
      {busy && <p className="muted">{busy}</p>}
    </section>
  );
}

function TextImport() {
  const col = useCollection();
  const [text, setText] = useState('');
  const [sep, setSep] = useState('\t');
  const [ntId, setNtId] = useState('basic');
  const [deckId, setDeckId] = useState(col.settings.lastDeckId && col.decks[col.settings.lastDeckId] ? col.settings.lastDeckId : Object.keys(col.decks)[0]);
  const [map, setMap] = useState<number[]>([0, 1]);
  const [tagsCol, setTagsCol] = useState(-1);
  const [html, setHtml] = useState(false);
  const [skipFirst, setSkipFirst] = useState(false);
  const [dups, setDups] = useState<'skip' | 'update' | 'add'>('skip');
  const [tags, setTags] = useState('');
  const nt = col.noteTypes[ntId] ?? Object.values(col.noteTypes)[0];
  const body = text.split(/\r?\n/).filter((l) => !l.startsWith('#')).join('\n');
  const rows = text ? parseDelimited(body, sep).slice(0, 5) : [];
  const nCols = Math.max(0, ...rows.map((r) => r.length));

  const load = async (f: File) => {
    const t = await f.text();
    setText(t);
    const s = detectSeparator(t);
    setSep(s);
    setMap(nt.fields.map((_f, i) => i));
  };

  const run = () => {
    const s = mutate((c) => importText(c, {
      text, separator: sep, noteTypeId: nt.id, deckId, fieldMap: nt.fields.map((_f, i) => map[i] ?? -1),
      tagsColumn: tagsCol, extraTags: tags.split(/\s+/).filter(Boolean), allowHtml: html, skipFirstRow: skipFirst, duplicates: dups,
    }));
    toast(`${s.added} notas adicionadas (${s.cards} cartões), ${s.updated} atualizadas, ${s.skipped} ignoradas.`, 'success');
    setText('');
  };

  return (
    <section className="box">
      <h2>Texto (CSV / TSV)</h2>
      <p className="muted">Cada linha vira uma nota; cada coluna, um campo. Também aceita colar o texto diretamente.</p>
      <input type="file" accept=".csv,.tsv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ''; }} />
      <textarea rows={4} className="full" placeholder={'frente;verso\ncat;gato'} value={text} onChange={(e) => { setText(e.target.value); if (!text) setSep(detectSeparator(e.target.value)); }} />
      {text && (
        <>
          <div className="grid2">
            <label className="field">Separador
              <select value={sep} onChange={(e) => setSep(e.target.value)}>{SEPS.map(([v, l]) => <option key={l} value={v}>{l}</option>)}</select>
            </label>
            <label className="field">Tipo de nota
              <select value={nt.id} onChange={(e) => { setNtId(e.target.value); setMap(col.noteTypes[e.target.value].fields.map((_f, i) => i)); }}>
                {Object.values(col.noteTypes).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="field">Baralho
              <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>{sortedDecks(col).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            </label>
            <label className="field">Duplicados (1º campo igual)
              <select value={dups} onChange={(e) => setDups(e.target.value as typeof dups)}>
                <option value="skip">Ignorar</option><option value="update">Atualizar existente</option><option value="add">Adicionar mesmo assim</option>
              </select>
            </label>
          </div>
          <h3>Mapeamento de colunas</h3>
          <div className="grid2">
            {nt.fields.map((f, i) => (
              <label key={f.name} className="field">{f.name}
                <select value={map[i] ?? -1} onChange={(e) => { const m = [...map]; m[i] = +e.target.value; setMap(m); }}>
                  <option value={-1}>(nada)</option>
                  {Array.from({ length: nCols }, (_v, c) => <option key={c} value={c}>Coluna {c + 1}</option>)}
                </select>
              </label>
            ))}
            <label className="field">Etiquetas
              <select value={tagsCol} onChange={(e) => setTagsCol(+e.target.value)}>
                <option value={-1}>(nenhuma)</option>
                {Array.from({ length: nCols }, (_v, c) => <option key={c} value={c}>Coluna {c + 1}</option>)}
              </select>
            </label>
            <label className="field">Etiquetas extras<input value={tags} onChange={(e) => setTags(e.target.value)} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={html} onChange={(e) => setHtml(e.target.checked)} /> Permitir HTML nos campos</label>
          <label className="check"><input type="checkbox" checked={skipFirst} onChange={(e) => setSkipFirst(e.target.checked)} /> Primeira linha é cabeçalho</label>
          <div className="table-wrap">
            <table className="small-table">
              <tbody>{rows.map((r, i) => <tr key={i} className={skipFirst && i === 0 ? 'muted' : ''}>{r.map((c, j) => <td key={j}>{c.slice(0, 60)}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div className="row-gap right"><button className="primary" onClick={run}>Importar</button></div>
        </>
      )}
    </section>
  );
}

function Export({ initialDeck }: { initialDeck?: string }) {
  const col = useCollection();
  const [deck, setDeck] = useState(initialDeck ?? '');
  const [html, setHtml] = useState(true);
  const doExport = () => {
    const ids = deck ? deckAndDescendants(col, deck) : null;
    const txt = exportNotesText(col, ids, html);
    const name = deck ? col.decks[deck].name.replace(/::/g, '-') : 'todas-as-notas';
    downloadBlob(new Blob([txt], { type: 'text/tab-separated-values' }), `${name}.txt`);
  };
  return (
    <section className="box">
      <h2>Exportar notas em texto</h2>
      <p className="muted">Gera um arquivo TSV compatível com a importação de texto do Anki.</p>
      <div className="row-gap">
        <select value={deck} onChange={(e) => setDeck(e.target.value)}>
          <option value="">Todos os baralhos</option>
          {sortedDecks(col).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={html} onChange={(e) => setHtml(e.target.checked)} /> Incluir HTML</label>
        <button onClick={doExport}>Exportar</button>
      </div>
    </section>
  );
}

function Backup() {
  const [busy, setBusy] = useState(false);
  const doBackup = async () => {
    setBusy(true);
    try {
      const blob = await exportBackup(getCol());
      downloadBlob(blob, `memora-backup-${new Date().toISOString().slice(0, 10)}.zip`);
    } finally { setBusy(false); }
  };
  const restore = async (f: File) => {
    if (!(await confirmBox('Restaurar backup', 'Isto SUBSTITUI toda a coleção atual pelo conteúdo do backup. Continuar?'))) return;
    setBusy(true);
    try {
      const { col, media } = await readBackup(f);
      replaceCollection(col);
      await saveNow();
      toast(`Backup restaurado (${Object.keys(col.cards).length} cartões, ${media} mídias).`, 'success');
    } catch (e) {
      toast('Falha ao restaurar: ' + (e as Error).message, 'error');
    } finally { setBusy(false); }
  };
  return (
    <section className="box">
      <h2>Backup completo</h2>
      <p className="muted">Seus dados ficam salvos neste navegador. Faça backups regularmente para não perdê-los e para levar sua coleção a outro aparelho.</p>
      <div className="row-gap">
        <button className="primary" disabled={busy} onClick={doBackup}>Baixar backup (.zip)</button>
        <label className="button">Restaurar backup…
          <input type="file" accept=".zip,.json" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void restore(f); e.target.value = ''; }} />
        </label>
      </div>
    </section>
  );
}
