import { createContext, useContext, useState, useCallback, useRef } from 'react';
import s from './ToastContext.module.css';

const ToastCtx = createContext(null);

let _id = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id]);
    setToasts(prev => prev.map(t => t.id === id ? { ...t, leaving: true } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 320);
  }, []);

  const toast = useCallback((msg, type = 'info', duration = 4000) => {
    const id = ++_id;
    setToasts(prev => [...prev, { id, msg, type, leaving: false }]);
    timers.current[id] = setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className={s.container}>
        {toasts.map(t => (
          <div key={t.id} className={`${s.toast} ${s[t.type]} ${t.leaving ? s.leaving : ''}`}>
            <span className={s.icon}>
              {t.type === 'danger'  ? '⚠' :
               t.type === 'success' ? '✓' :
               t.type === 'warn'    ? '!' : 'i'}
            </span>
            <span className={s.msg}>{t.msg}</span>
            <button className={s.close} onClick={() => dismiss(t.id)}>×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx.toast;
}
