import { useEffect, useMemo, useRef, useState } from 'react';
import { useCollection } from '../core/store';
import { deckAndDescendants, sortedDecks } from '../core/collection';
import { dayNumber, formatDays } from '../core/time';
import { retrievability } from '../core/scheduler/fsrs';
import type { Card } from '../core/types';
import { go } from './common';

interface Series { key: string; label: string; color: string }
interface Datum { label: string; values: Record<string, number> }

/** Gráfico de barras (empilhadas) em SVG com tooltip ao passar o mouse e tabela alternativa */
function BarChart({ data, series, title, unit = '', width = 640 }: { data: Datum[]; series: Series[]; title: string; unit?: string; width?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(width);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setMeasured(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);
  const W = measured, H = W < 500 ? 170 : 200, padL = 36, padB = 22, padT = 8;
  const totals = data.map((d) => series.reduce((s, x) => s + (d.values[x.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const niceMax = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); return Math.ceil(max / p) * p; })();
  const bw = (W - padL) / Math.max(1, data.length);
  const barW = Math.min(64, Math.max(2, bw - 2));
  const inset = (bw - barW) / 2;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / niceMax);
  const ticks = [0, niceMax / 2, niceMax];
  const labelEvery = Math.ceil(data.length / Math.max(3, Math.floor(W / 60)));
  const total = totals.reduce((a, b) => a + b, 0);

  return (
    <div className="chart">
      <div className="chart-head">
        <h3>{title}</h3>
        <span className="muted small">Total: {total.toLocaleString('pt-BR')}{unit}</span>
        <button className="small" onClick={() => setTable(!table)}>{table ? 'Gráfico' : 'Tabela'}</button>
      </div>
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
        </div>
      )}
      {table ? (
        <div className="table-wrap small-scroll">
          <table className="small-table">
            <thead><tr><th></th>{series.map((s) => <th key={s.key}>{s.label}</th>)}{series.length > 1 && <th>Total</th>}</tr></thead>
            <tbody>
              {data.map((d, i) => totals[i] > 0 && (
                <tr key={i}><td>{d.label}</td>{series.map((s) => <td key={s.key}>{d.values[s.key] ?? 0}</td>)}{series.length > 1 && <td>{totals[i]}</td>}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-svg-wrap" ref={wrapRef} onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W} y1={y(t)} y2={y(t)} className="grid" />
                <text x={padL - 6} y={y(t) + 4} className="axis" textAnchor="end">{Number.isInteger(t) ? t : t.toFixed(1)}</text>
              </g>
            ))}
            {data.map((d, i) => {
              let acc = 0;
              const x = padL + i * bw + inset;
              const segs = series.filter((s) => (d.values[s.key] ?? 0) > 0);
              return (
                <g key={i}>
                  {segs.map((s, si) => {
                    const v = d.values[s.key];
                    const top = y(acc + v);
                    const h = y(acc) - top;
                    acc += v;
                    const isTop = si === segs.length - 1;
                    // 2px de espaço entre segmentos; topo arredondado
                    const gap = si > 0 ? 2 : 0;
                    return isTop ? (
                      <path key={s.key} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.55}
                        d={roundedTop(x, top, barW, Math.max(0, h - gap), Math.min(4, barW / 2, Math.max(0, h - gap)))} />
                    ) : (
                      <rect key={s.key} x={x} y={top} width={barW} height={Math.max(0, h - gap)} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.55} />
                    );
                  })}
                  <rect x={padL + i * bw} y={padT} width={bw} height={H - padT - padB} fill="transparent" onMouseEnter={() => setHover(i)} />
                  {i % labelEvery === 0 && <text x={x + barW / 2} y={H - 6} className="axis" textAnchor="middle">{d.label}</text>}
                </g>
              );
            })}
            <line x1={padL} x2={W} y1={y(0)} y2={y(0)} className="baseline" />
          </svg>
          {hover !== null && data[hover] && (
            <div className="tooltip" style={(() => {
              const frac = (padL + hover * bw + bw / 2) / W;
              return { left: `${frac * 100}%`, transform: `translateX(${frac > 0.7 ? -100 : frac < 0.3 ? 0 : -50}%)` };
            })()}>
              <b>{data[hover].label}</b>
              {series.map((s) => (
                <div key={s.key}><i style={{ background: s.color }} />{s.label}: <b>{data[hover].values[s.key] ?? 0}{unit}</b></div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

const C = { blue: 'var(--series-1)', orange: 'var(--series-2)', aqua: 'var(--series-3)', yellow: 'var(--series-4)' };

export function Stats({ deckId }: { deckId?: string }) {
  const col = useCollection();
  const [scope, setScope] = useState(deckId ?? '');
  const [range, setRange] = useState(30);
  const { dayStartHour } = col.settings;
  const now = Date.now();
  const today = dayNumber(now, dayStartHour);

  const { cards, logs } = useMemo(() => {
    const ids = scope ? deckAndDescendants(col, scope) : null;
    const cards = Object.values(col.cards).filter((c) => !ids || ids.has(c.deckId));
    const cardSet = new Set(cards.map((c) => c.id));
    const logs = col.revlog.filter((r) => cardSet.has(r.cardId));
    return { cards, logs };
  }, [col, scope, col.cards, col.revlog]);

  const todayLogs = logs.filter((r) => dayNumber(r.time, dayStartHour) === today);
  const todayTime = todayLogs.reduce((s, r) => s + r.durationMs, 0);
  const todayAgain = todayLogs.filter((r) => r.rating === 1).length;

  // retenção verdadeira: revisões (não aprendizado) respondidas sem "Errei", no período
  const rangeLogs = logs.filter((r) => today - dayNumber(r.time, dayStartHour) < range);
  const revLogs = rangeLogs.filter((r) => r.kind === 'review');
  const young = revLogs.filter((r) => r.lastInterval < 21);
  const mature = revLogs.filter((r) => r.lastInterval >= 21);
  const pct = (arr: typeof revLogs) => (arr.length ? `${((arr.filter((r) => r.rating > 1).length / arr.length) * 100).toFixed(1)}%` : '—');

  // estudos por dia
  const perDay: Datum[] = [];
  for (let d = range - 1; d >= 0; d--) {
    const day = today - d;
    perDay.push({ label: d === 0 ? 'hoje' : `-${d}`, values: { new: 0, learning: 0, review: 0, relearning: 0 } });
    void day;
  }
  for (const r of rangeLogs) {
    const idx = range - 1 - (today - dayNumber(r.time, dayStartHour));
    if (idx >= 0 && idx < range) perDay[idx].values[r.kind]++;
  }

  // previsão
  const forecast: Datum[] = Array.from({ length: range }, (_v, i) => ({ label: i === 0 ? 'hoje' : `+${i}`, values: { young: 0, mature: 0 } }));
  for (const c of cards) {
    if (c.suspended || c.type === 'new') continue;
    const d = c.type === 'review' ? Math.max(0, dayNumber(c.due, dayStartHour) - today) : 0;
    if (d < range) forecast[d].values[c.interval >= 21 ? 'mature' : 'young']++;
  }

  // contagem de cartões
  const counts = { new: 0, learning: 0, young: 0, mature: 0, suspended: 0 };
  for (const c of cards) {
    if (c.suspended) counts.suspended++;
    else if (c.type === 'new') counts.new++;
    else if (c.type === 'learning' || c.type === 'relearning') counts.learning++;
    else if (c.interval >= 21) counts.mature++;
    else counts.young++;
  }

  // intervalos
  const buckets = [1, 2, 3, 5, 7, 14, 21, 30, 60, 90, 180, 365, Infinity];
  const ivlData: Datum[] = buckets.map((b, i) => ({ label: b === Infinity ? '>1a' : i === 0 ? '1d' : `≤${formatDays(b)}`, values: { n: 0 } }));
  for (const c of cards) {
    if (c.type !== 'review') continue;
    const i = buckets.findIndex((b) => c.interval <= b);
    ivlData[i].values.n++;
  }

  // botões
  const buttons: Datum[] = [
    { label: 'Aprendizado', values: {} as Record<string, number> },
    { label: 'Jovens', values: {} as Record<string, number> },
    { label: 'Maduros', values: {} as Record<string, number> },
  ];
  for (const r of rangeLogs) {
    const group = r.kind === 'review' ? (r.lastInterval >= 21 ? 2 : 1) : 0;
    const k = String(r.rating);
    buttons[group].values[k] = (buttons[group].values[k] ?? 0) + 1;
  }

  // retenção estimada atual (FSRS)
  const withMem = cards.filter((c: Card) => c.type === 'review' && c.stability > 0 && !c.suspended);
  const avgR = withMem.length
    ? withMem.reduce((s, c) => s + retrievability(Math.max(0, today - dayNumber(c.lastReview, dayStartHour)), c.stability), 0) / withMem.length
    : null;

  // sequência de dias
  const daysStudied = new Set(logs.map((r) => dayNumber(r.time, dayStartHour)));
  let streak = 0;
  for (let d = daysStudied.has(today) ? today : today - 1; daysStudied.has(d); d--) streak++;

  return (
    <div className="page stats">
      <div className="row-gap filters">
        <h1 className="grow">Estatísticas</h1>
        <select value={scope} onChange={(e) => { setScope(e.target.value); go(e.target.value ? `stats/${e.target.value}` : 'stats'); }}>
          <option value="">Coleção inteira</option>
          {sortedDecks(col).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div className="segmented">
          {[[7, '1 semana'], [30, '1 mês'], [90, '3 meses'], [365, '1 ano']].map(([v, l]) => (
            <button key={v} className={range === v ? 'active' : ''} onClick={() => setRange(v as number)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="tiles">
        <div className="tile"><span>Estudados hoje</span><b>{todayLogs.length}</b><small>{Math.round(todayTime / 60000)} min · {todayAgain} erros</small></div>
        <div className="tile"><span>Sequência</span><b>{streak} {streak === 1 ? 'dia' : 'dias'}</b><small>{daysStudied.size} dias estudados no total</small></div>
        <div className="tile"><span>Retenção verdadeira</span><b>{pct(revLogs)}</b><small>jovens {pct(young)} · maduros {pct(mature)}</small></div>
        <div className="tile"><span>Retenção estimada agora</span><b>{avgR === null ? '—' : `${(avgR * 100).toFixed(1)}%`}</b><small>pelo modelo FSRS</small></div>
        <div className="tile"><span>Total de cartões</span><b>{cards.length}</b><small>{counts.new} novos · {counts.young + counts.mature} em revisão</small></div>
      </div>

      <BarChart title="Previsão de revisões" data={forecast} series={[
        { key: 'young', label: 'Jovens (<21d)', color: C.blue },
        { key: 'mature', label: 'Maduros (≥21d)', color: C.orange },
      ]} />
      <BarChart title="Revisões por dia" data={perDay} series={[
        { key: 'new', label: 'Novos', color: C.blue },
        { key: 'learning', label: 'Aprendendo', color: C.orange },
        { key: 'review', label: 'Revisão', color: C.aqua },
        { key: 'relearning', label: 'Reaprendendo', color: C.yellow },
      ]} />
      <div className="chart-grid">
        <BarChart title="Contagem de cartões" data={[
          { label: 'Novos', values: { n: counts.new } },
          { label: 'Aprendendo', values: { n: counts.learning } },
          { label: 'Jovens', values: { n: counts.young } },
          { label: 'Maduros', values: { n: counts.mature } },
          { label: 'Suspensos', values: { n: counts.suspended } },
        ]} series={[{ key: 'n', label: 'Cartões', color: C.blue }]} width={380} />
        <BarChart title="Intervalos de revisão" data={ivlData} series={[{ key: 'n', label: 'Cartões', color: C.blue }]} width={380} />
      </div>
      <BarChart title="Botões de resposta" data={buttons} series={[
        { key: '1', label: 'Errei', color: C.blue },
        { key: '2', label: 'Difícil', color: C.orange },
        { key: '3', label: 'Bom', color: C.aqua },
        { key: '4', label: 'Fácil', color: C.yellow },
      ]} />
    </div>
  );
}
