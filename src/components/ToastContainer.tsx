import React from 'react';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-6 left-3 right-3 sm:left-auto sm:right-4 z-50 flex flex-col gap-2 sm:w-full sm:max-w-sm pointer-events-none"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] px-4 py-3 shadow-lg flex items-start gap-3"
        >
          {t.tone === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />}
          {t.tone === 'error' && <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />}
          {t.tone === 'info' && <Info className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{t.title}</p>
            {t.description && (
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400 break-words">
                {t.description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss notification"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
