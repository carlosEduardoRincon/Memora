let last = 0;
/** id único, ordenável por tempo de criação */
export function newId(): string {
  let t = Date.now();
  if (t <= last) t = last + 1;
  last = t;
  return t.toString(36) + Math.random().toString(36).slice(2, 7);
}
