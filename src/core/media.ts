// Armazenamento de mídia (imagens/áudio) no IndexedDB, referenciada por nome nos campos,
// como na pasta collection.media do Anki: <img src="arquivo.jpg">  [sound:audio.mp3]
import { createStore, get, set, keys, del, entries } from 'idb-keyval';

const db = createStore('memora-media', 'files');
const urlCache = new Map<string, string>();

export async function saveMedia(name: string, blob: Blob, overwrite = false): Promise<string> {
  let final = name.replace(/[\\/:*?"<>|]/g, '_');
  // evita sobrescrever arquivo diferente com mesmo nome
  const existing = overwrite ? undefined : await get<Blob>(final, db);
  if (existing && existing.size !== blob.size) {
    const dot = final.lastIndexOf('.');
    const stem = dot > 0 ? final.slice(0, dot) : final;
    const ext = dot > 0 ? final.slice(dot) : '';
    final = `${stem}-${Date.now().toString(36)}${ext}`;
  }
  await set(final, blob, db);
  urlCache.delete(final);
  return final;
}

export async function mediaUrl(name: string): Promise<string | null> {
  if (urlCache.has(name)) return urlCache.get(name)!;
  const blob = await get<Blob>(name, db);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(name, url);
  return url;
}

export async function listMedia(): Promise<string[]> {
  return (await keys(db)).map(String);
}

export async function allMedia(): Promise<[string, Blob][]> {
  return (await entries(db)) as [string, Blob][];
}

export async function deleteMedia(name: string): Promise<void> {
  await del(name, db);
  const u = urlCache.get(name);
  if (u) URL.revokeObjectURL(u);
  urlCache.delete(name);
}

const isExternal = (s: string) => /^(https?:|data:|blob:)/i.test(s);

/** Substitui referências locais por URLs de objeto e [sound:x] por players de áudio */
export async function resolveMedia(html: string): Promise<string> {
  const names = new Set<string>();
  for (const m of html.matchAll(/<(?:img|audio|video|source)[^>]*?\ssrc=["']([^"']+)["']/gi)) if (!isExternal(m[1])) names.add(m[1]);
  for (const m of html.matchAll(/\[sound:([^\]]+)\]/g)) names.add(m[1]);
  const map = new Map<string, string>();
  await Promise.all(
    [...names].map(async (n) => {
      const u = await mediaUrl(decodeURIComponent(n)) ?? await mediaUrl(n);
      if (u) map.set(n, u);
    })
  );
  let out = html.replace(/(<(?:img|audio|video|source)[^>]*?\ssrc=["'])([^"']+)(["'])/gi, (all, a, src, b) =>
    map.has(src) ? a + map.get(src) + b : all
  );
  out = out.replace(/\[sound:([^\]]+)\]/g, (_a, n) =>
    map.has(n)
      ? `<audio class="sound" controls preload="auto" src="${map.get(n)}"></audio>`
      : `<span class="missing-media">🔇 ${n}</span>`
  );
  return out;
}

export function mimeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return (
    ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm' } as Record<string, string>)[ext] ?? 'application/octet-stream'
  );
}
