import { useState, type ReactNode } from 'react';
import { useCollection, mutate } from '../core/store';
import { defaultPreset, FSRS5_DEFAULT_WEIGHTS, DEFAULT_PRESET_ID } from '../core/defaults';
import { newId } from '../core/ids';
import type { Preset } from '../core/types';
import { askText, confirmBox, go, toast } from './common';
import { deckAndDescendants } from '../core/collection';

function parseSteps(s: string): number[] | null {
  const parts = s.trim().split(/\s+/).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    const m = /^(\d+(?:\.\d+)?)([smhd]?)$/i.exec(p);
    if (!m) return null;
    const n = parseFloat(m[1]);
    const unit = m[2].toLowerCase() || 'm';
    out.push(unit === 's' ? n / 60 : unit === 'h' ? n * 60 : unit === 'd' ? n * 1440 : n);
  }
  return out;
}

function fmtSteps(steps: number[]): string {
  return steps.map((m) => (m >= 1440 && m % 1440 === 0 ? `${m / 1440}d` : m >= 60 && m % 60 === 0 ? `${m / 60}h` : m < 1 ? `${Math.round(m * 60)}s` : `${m}m`)).join(' ');
}

function Row({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return (
    <div className="opt-row">
      <div><label>{label}</label><p className="muted small">{help}</p></div>
      <div className="opt-input">{children}</div>
    </div>
  );
}

export function DeckOptions({ deckId }: { deckId: string }) {
  const col = useCollection();
  const deck = col.decks[deckId];
  const [draft, setDraft] = useState<Preset | null>(() => (deck ? { ...col.presets[deck.presetId] ?? col.presets[DEFAULT_PRESET_ID] } : null));
  const [learn, setLearn] = useState(() => fmtSteps(draft?.learningSteps ?? []));
  const [relearn, setRelearn] = useState(() => fmtSteps(draft?.relearningSteps ?? []));
  const [weights, setWeights] = useState(() => (draft?.fsrsWeights ?? []).join(', '));
  if (!deck || !draft) return <div className="page">Baralho não encontrado.</div>;

  const set = <K extends keyof Preset>(k: K, v: Preset[K]) => setDraft({ ...draft, [k]: v });
  const num = (k: keyof Preset, step = 1, min = 0, max?: number) => (
    <input type="number" step={step} min={min} max={max} value={draft[k] as number} onChange={(e) => set(k, parseFloat(e.target.value) as never)} />
  );
  const usage = Object.values(col.decks).filter((d) => d.presetId === draft.id).length;

  const save = () => {
    const ls = parseSteps(learn), rs = parseSteps(relearn);
    if (!ls || !rs) { toast('Passos inválidos. Use, ex.: 1m 10m 1h 1d', 'error'); return; }
    const w = weights.split(/[\s,]+/).filter(Boolean).map(Number);
    if (w.length !== 19 || w.some(isNaN)) { toast('Os parâmetros FSRS devem ser 19 números.', 'error'); return; }
    const p: Preset = { ...draft, learningSteps: ls, relearningSteps: rs, fsrsWeights: w };
    mutate((c) => { c.presets[p.id] = p; });
    toast('Opções salvas', 'success');
    go(`overview/${deckId}`);
  };

  const switchPreset = (id: string) => {
    const p = col.presets[id];
    mutate((c) => { c.decks[deckId].presetId = id; });
    setDraft({ ...p });
    setLearn(fmtSteps(p.learningSteps));
    setRelearn(fmtSteps(p.relearningSteps));
    setWeights(p.fsrsWeights.join(', '));
  };

  const newPreset = async (clone: boolean) => {
    const name = await askText(clone ? 'Clonar predefinição' : 'Nova predefinição', clone ? draft.name + ' (cópia)' : '');
    if (!name) return;
    const id = newId();
    mutate((c) => { c.presets[id] = clone ? { ...draft, id, name } : defaultPreset(id, name); });
    switchPreset(id);
  };

  const deletePreset = async () => {
    if (draft.id === DEFAULT_PRESET_ID) { toast('A predefinição padrão não pode ser excluída.', 'error'); return; }
    if (!(await confirmBox('Excluir predefinição', `Baralhos que usam "${draft.name}" passarão a usar a Padrão.`))) return;
    const id = draft.id;
    mutate((c) => {
      for (const d of Object.values(c.decks)) if (d.presetId === id) d.presetId = DEFAULT_PRESET_ID;
      delete c.presets[id];
    });
    switchPreset(DEFAULT_PRESET_ID);
  };

  const applyToChildren = () => {
    const ids = deckAndDescendants(col, deckId);
    mutate((c) => { for (const id of ids) c.decks[id].presetId = draft.id; });
    toast(`Aplicado a ${ids.size} baralho(s)`);
  };

  return (
    <div className="page narrow options">
      <h1>Opções — {deck.name}</h1>
      <div className="preset-bar">
        <label className="field grow">Predefinição (usada por {usage} baralho{usage === 1 ? '' : 's'})
          <select value={draft.id} onChange={(e) => switchPreset(e.target.value)}>
            {Object.values(col.presets).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button onClick={() => newPreset(false)}>Nova</button>
        <button onClick={() => newPreset(true)}>Clonar</button>
        <button onClick={async () => { const n = await askText('Renomear', draft.name); if (n) set('name', n); }}>Renomear</button>
        <button className="danger" onClick={deletePreset}>Excluir</button>
      </div>

      <label className="field">Descrição do baralho
        <textarea value={deck.description} onChange={(e) => mutate((c) => { c.decks[deckId].description = e.target.value; })} rows={2} />
      </label>

      <section>
        <h2>Limites diários</h2>
        <Row label="Novos cartões/dia" help="Quantos cartões novos introduzir por dia. 10–20 é um bom começo.">{num('newPerDay')}</Row>
        <Row label="Máximo de revisões/dia" help="Limite de revisões. Recomenda-se ≥ 10× o número de novos.">{num('reviewsPerDay')}</Row>
      </section>

      <section>
        <h2>Novos cartões</h2>
        <Row label="Passos de aprendizado" help="Atrasos antes de o cartão graduar, ex.: 1m 10m. Aceita s, m, h, d.">
          <input value={learn} onChange={(e) => setLearn(e.target.value)} />
        </Row>
        <Row label="Intervalo de graduação" help="Dias até a 1ª revisão após o último passo (Bom).">{num('graduatingInterval', 1, 1)}</Row>
        <Row label="Intervalo fácil" help="Dias até a 1ª revisão ao responder Fácil num cartão novo.">{num('easyInterval', 1, 1)}</Row>
        <Row label="Ordem de inserção" help="Ordem em que os cartões novos aparecem.">
          <select value={draft.newOrder} onChange={(e) => set('newOrder', e.target.value as Preset['newOrder'])}>
            <option value="sequential">Sequencial (mais antigos primeiro)</option>
            <option value="random">Aleatória</option>
          </select>
        </Row>
      </section>

      <section>
        <h2>Lapsos (esquecimentos)</h2>
        <Row label="Passos de reaprendizado" help="Atrasos ao errar uma revisão, ex.: 10m. Vazio = sem reaprendizado.">
          <input value={relearn} onChange={(e) => setRelearn(e.target.value)} />
        </Row>
        <Row label="Intervalo mínimo" help="Menor intervalo (dias) após um lapso.">{num('minimumInterval', 1, 1)}</Row>
        <Row label="Novo intervalo" help="Multiplicador do intervalo anterior após um lapso (0 = volta ao mínimo). Só SM-2.">{num('lapseMultiplier', 0.05, 0, 1)}</Row>
        <Row label="Limite de sanguessuga" help="Após quantos lapsos o cartão é considerado 'leech' (difícil demais).">{num('leechThreshold', 1, 1)}</Row>
        <Row label="Ação para sanguessuga" help="O que fazer com cartões leech.">
          <select value={draft.leechAction} onChange={(e) => set('leechAction', e.target.value as Preset['leechAction'])}>
            <option value="tag">Apenas marcar com etiqueta</option>
            <option value="suspend">Suspender cartão</option>
          </select>
        </Row>
      </section>

      <section>
        <h2>Enterrar</h2>
        <Row label="Enterrar irmãos novos" help="Adia para amanhã outros cartões novos da mesma nota (ex.: o invertido).">
          <input type="checkbox" checked={draft.buryNewSiblings} onChange={(e) => set('buryNewSiblings', e.target.checked)} />
        </Row>
        <Row label="Enterrar irmãos de revisão" help="Adia para amanhã outras revisões da mesma nota.">
          <input type="checkbox" checked={draft.buryReviewSiblings} onChange={(e) => set('buryReviewSiblings', e.target.checked)} />
        </Row>
      </section>

      <section>
        <h2>Exibição e áudio</h2>
        <Row label="Mostrar intervalos nos botões" help="Exibe o próximo intervalo acima de cada botão de resposta.">
          <input type="checkbox" checked={draft.showIntervalsOnButtons} onChange={(e) => set('showIntervalsOnButtons', e.target.checked)} />
        </Row>
        <Row label="Ler em voz alta automaticamente" help="Usa a síntese de voz do navegador em campos marcados com {{tts:Campo}}.">
          <input type="checkbox" checked={draft.autoplayTTS} onChange={(e) => set('autoplayTTS', e.target.checked)} />
        </Row>
      </section>

      <section>
        <h2>Algoritmo de agendamento</h2>
        <Row label="Algoritmo" help="SM-2 é o algoritmo clássico do Anki. FSRS-5 é o moderno (Anki 23.10+): modela a memória e costuma exigir 20–30% menos revisões para a mesma retenção.">
          <select value={draft.algorithm} onChange={(e) => set('algorithm', e.target.value as Preset['algorithm'])}>
            <option value="sm2">SM-2 (clássico)</option>
            <option value="fsrs">FSRS-5 (recomendado)</option>
          </select>
        </Row>
        {draft.algorithm === 'fsrs' ? (
          <>
            <Row label="Retenção desejada" help="Probabilidade de lembrar no momento da revisão. 0,90 é o padrão; valores maiores aumentam muito a carga de revisões.">
              {num('desiredRetention', 0.01, 0.7, 0.99)}
            </Row>
            <Row label="Parâmetros FSRS" help="19 pesos do modelo. Os padrões foram treinados em ~20 mil usuários.">
              <textarea rows={3} value={weights} onChange={(e) => setWeights(e.target.value)} />
              <button className="small" onClick={() => setWeights(FSRS5_DEFAULT_WEIGHTS.join(', '))}>Restaurar padrão</button>
            </Row>
            <Row label="Intervalo máximo" help="Maior intervalo permitido (dias).">{num('maximumInterval', 1, 1)}</Row>
          </>
        ) : (
          <>
            <Row label="Facilidade inicial" help="Multiplicador inicial dos intervalos (2,5 = 250%).">{num('startingEase', 0.05, 1.31, 5)}</Row>
            <Row label="Bônus fácil" help="Multiplicador extra ao responder Fácil numa revisão.">{num('easyBonus', 0.05, 1, 5)}</Row>
            <Row label="Modificador de intervalo" help="Multiplica todos os intervalos (1,0 = 100%). Use pequenas mudanças para ajustar a retenção.">{num('intervalModifier', 0.05, 0.5, 2)}</Row>
            <Row label="Intervalo difícil" help="Multiplicador do intervalo ao responder Difícil.">{num('hardInterval', 0.05, 1, 2)}</Row>
            <Row label="Intervalo máximo" help="Maior intervalo permitido (dias).">{num('maximumInterval', 1, 1)}</Row>
          </>
        )}
      </section>

      <div className="row-gap right sticky-foot">
        <button onClick={applyToChildren}>Usar em subbaralhos</button>
        <button onClick={() => go(`overview/${deckId}`)}>Cancelar</button>
        <button className="primary" onClick={save}>Salvar</button>
      </div>
    </div>
  );
}
