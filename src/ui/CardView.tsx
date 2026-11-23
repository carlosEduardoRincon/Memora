import { useEffect, useRef, useState } from 'react';
import { resolveMedia } from '../core/media';
import { sanitize, scopeCss } from '../core/sanitize';

let scopeCounter = 0;

export function speak(text: string, lang?: string): void {
  if (!('speechSynthesis' in window) || !text.trim()) return;
  const u = new SpeechSynthesisUtterance(text);
  if (lang) u.lang = lang;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/** Renderiza o HTML de um cartão com o CSS do tipo de nota, mídia local e áudio */
export function CardView({
  html,
  css,
  autoplay = false,
  autoplayTts = false,
  typeInput,
}: {
  html: string;
  css: string;
  autoplay?: boolean;
  autoplayTts?: boolean;
  typeInput?: { value: string; onChange: (v: string) => void; onEnter: () => void };
}) {
  const [resolved, setResolved] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const [scope] = useState(() => `card-scope-${++scopeCounter}`);

  useEffect(() => {
    let alive = true;
    resolveMedia(html).then((h) => { if (alive) setResolved(sanitize(h)); });
    return () => { alive = false; };
  }, [html]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (autoplay) {
      const audio = el.querySelector('audio');
      if (audio) audio.play().catch(() => {});
      else if (autoplayTts) {
        const tts = el.querySelector<HTMLElement>('.tts');
        if (tts) speak(tts.dataset.text ?? '');
      }
    }
    el.querySelectorAll<HTMLElement>('.tts').forEach((t) => {
      t.onclick = () => speak(t.dataset.text ?? '');
      t.title = 'Clique para ouvir';
    });
  }, [resolved, autoplay, autoplayTts]);

  const parts = typeInput ? resolved.split('<div id="typeans-slot"></div>') : [resolved];

  return (
    <div className={`card-content ${scope}`} ref={ref}>
      <style>{scopeCss(css, '.' + scope)}</style>
      <div dangerouslySetInnerHTML={{ __html: parts[0] }} />
      {typeInput && parts.length > 1 && (
        <>
          <input
            className="type-answer"
            autoFocus
            placeholder="Digite a resposta…"
            value={typeInput.value}
            onChange={(e) => typeInput.onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); typeInput.onEnter(); } e.stopPropagation(); }}
          />
          <div dangerouslySetInnerHTML={{ __html: parts.slice(1).join('') }} />
        </>
      )}
    </div>
  );
}
