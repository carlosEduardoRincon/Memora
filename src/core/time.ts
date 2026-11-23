export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/**
 * Número do "dia de estudos" para um timestamp. Como no Anki, o dia vira às `dayStartHour`
 * (padrão 4h da manhã), no fuso local.
 */
export function dayNumber(ts: number, dayStartHour: number): number {
  const d = new Date(ts - dayStartHour * HOUR);
  // dia local -> número de dias desde a época (usando meia-noite local em UTC)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

/** timestamp do início (dayStartHour local) do dia de estudos `day` */
export function dayStartTs(day: number, dayStartHour: number): number {
  const d = new Date(day * DAY); // meia-noite UTC desse dia
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), dayStartHour).getTime();
}

/** fim do dia de estudos atual (início do próximo) */
export function endOfToday(now: number, dayStartHour: number): number {
  return dayStartTs(dayNumber(now, dayStartHour) + 1, dayStartHour);
}

export function formatInterval(ms: number): string {
  const min = ms / MINUTE;
  if (min < 1) return '<1min';
  if (min < 60) return `${Math.round(min)}min`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  return formatDays(d);
}

export function formatDays(d: number): string {
  if (d < 1) return `${Math.round(d * 24)}h`;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${(d / 30).toFixed(1).replace('.0', '')}m`;
  return `${(d / 365).toFixed(1).replace('.0', '')}a`;
}
