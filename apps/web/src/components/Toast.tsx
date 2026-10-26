import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
  details?: string[];
}

interface ToastContextType {
  addToast: (toast: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: ToastMessage = { ...toast, id };
    setToasts((prev) => [...prev, newToast]);

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md w-full pointer-events-none p-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto p-4 rounded-xl border shadow-xl backdrop-blur-md transition-all duration-300 animate-slide-up flex gap-3 ${
              t.type === 'error'
                ? 'bg-destructive/10 border-destructive/30 text-destructive-foreground'
                : t.type === 'success'
                  ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-200'
                  : t.type === 'warning'
                    ? 'bg-amber-950/40 border-amber-500/30 text-amber-200'
                    : 'bg-secondary/80 border-border text-foreground'
            }`}
          >
            <div className="flex-1">
              <div className="font-semibold text-sm flex items-center justify-between">
                <span>{t.title}</span>
                <button
                  onClick={() => removeToast(t.id)}
                  className="text-muted-foreground hover:text-foreground text-xs ml-2 cursor-pointer"
                >
                  ✕
                </button>
              </div>
              {t.message && <div className="text-xs text-muted-foreground mt-1">{t.message}</div>}
              {t.details && t.details.length > 0 && (
                <div className="mt-2 text-xs text-destructive bg-black/40 rounded p-2 font-mono">
                  {t.details.map((d, i) => (
                    <div key={i}>{d}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}
