// Backup completo: coleção (JSON) + mídia em um único .zip
import JSZip from 'jszip';
import type { Collection } from '../types';
import { allMedia, saveMedia, mimeFor } from '../media';

export async function exportBackup(col: Collection): Promise<Blob> {
  const zip = new JSZip();
  zip.file('collection.json', JSON.stringify(col));
  const media = await allMedia();
  const folder = zip.folder('media')!;
  for (const [name, blob] of media) folder.file(name, blob);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function readBackup(file: Blob): Promise<{ col: Collection; media: number }> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] === 0x7b) {
    // JSON puro
    return { col: JSON.parse(await file.text()), media: 0 };
  }
  const zip = await JSZip.loadAsync(file);
  const entry = zip.file('collection.json');
  if (!entry) throw new Error('Backup inválido (collection.json ausente).');
  const col = JSON.parse(await entry.async('string')) as Collection;
  let media = 0;
  const files = zip.folder('media')?.file(/.*/) ?? [];
  for (const f of files) {
    const name = f.name.replace(/^media\//, '');
    const bytes = await f.async('uint8array');
    await saveMedia(name, new Blob([bytes], { type: mimeFor(name) }), true);
    media++;
  }
  return { col, media };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
