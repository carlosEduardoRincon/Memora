import { useEffect, useState, type ReactNode } from 'react';

export function useHashRoute(): string[] {
  const read = () => (location.hash.replace(/^#\/?/, '') || '').split('/').map(decodeURIComponent);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function go(path: string): void {
  location.hash = '#/' + path;
}

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Toasts ----------
type Toast = { id: number; text: string; kind: 'info' | 'error' | 'success' };
let toasts: Toast[] = [];
const tListeners = new Set<() => void>();
export function toast(text: string, kind: Toast['kind'] = 'info'): void {
  const t = { id: Math.random(), text, kind };
  toasts = [...toasts, t];
  tListeners.forEach((l) => l());
  setTimeout(() => { toasts = toasts.filter((x) => x !== t); tListeners.forEach((l) => l()); }, 3500);
}
export function Toasts() {
  const [, set] = useState(0);
  useEffect(() => { const l = () => set((x) => x + 1); tListeners.add(l); return () => { tListeners.delete(l); }; }, []);
  return <div className="toasts">{toasts.map((t) => <div key={t.id} className={'toast ' + t.kind}>{t.text}</div>)}</div>;
}

// ---------- Diálogos ----------
type DialogReq = { kind: 'prompt' | 'confirm'; title: string; message?: string; value?: string; resolve: (v: string | boolean | null) => void };
let current: DialogReq | null = null;
const dListeners = new Set<() => void>();
const setDialog = (d: DialogReq | null) => { current = d; dListeners.forEach((l) => l()); };

export function askText(title: string, value = '', message?: string): Promise<string | null> {
  return new Promise((resolve) => setDialog({ kind: 'prompt', title, value, message, resolve: (v) => resolve(v as string | null) }));
}
export function confirmBox(title: string, message?: string): Promise<boolean> {
  return new Promise((resolve) => setDialog({ kind: 'confirm', title, message, resolve: (v) => resolve(!!v) }));
}

export function Dialogs() {
  const [, set] = useState(0);
  const [text, setText] = useState('');
  useEffect(() => { const l = () => { set((x) => x + 1); setText(current?.value ?? ''); }; dListeners.add(l); return () => { dListeners.delete(l); }; }, []);
  if (!current) return null;
  const d = current;
  const close = (v: string | boolean | null) => { setDialog(null); d.resolve(v); };
  return (
    <Modal
      title={d.title}
      onClose={() => close(d.kind === 'confirm' ? false : null)}
      footer={
        <>
          <button onClick={() => close(d.kind === 'confirm' ? false : null)}>Cancelar</button>
          <button className="primary" onClick={() => close(d.kind === 'confirm' ? true : text)}>OK</button>
        </>
      }
    >
      {d.message && <p className="muted">{d.message}</p>}
      {d.kind === 'prompt' && (
        <input autoFocus className="full" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') close(text); }} />
      )}
    </Modal>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
