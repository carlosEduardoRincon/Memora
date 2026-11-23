import DOMPurify from 'dompurify';

/** Remove scripts e handlers perigosos de HTML vindo de notas/baralhos importados */
export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['audio', 'video', 'source', 'details', 'summary'],
    ADD_ATTR: ['controls', 'preload', 'autoplay', 'data-text', 'target'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|blob|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}

/** CSS do tipo de nota limitado ao contêiner do cartão */
export function scopeCss(css: string, scope: string): string {
  return css.replace(/(^|\})\s*([^{}@]+)\s*\{/g, (_m, brace: string, sel: string) => {
    const scoped = sel
      .split(',')
      .map((s) => {
        s = s.trim();
        if (!s) return s;
        if (s === '.card' || s === 'body' || s === 'html') return scope;
        if (s.startsWith('.card')) return scope + s.slice(5);
        if (s.startsWith('.nightMode') || s.startsWith('.night_mode')) return `.dark ${scope} ${s.replace(/^\.night_?[Mm]ode\s*/, '').replace(/^\.card/, '')}`.trim();
        return `${scope} ${s}`;
      })
      .join(', ');
    return `${brace} ${scoped} {`;
  });
}
