import React, { useEffect, useState } from 'react';
import { Download, ExternalLink, X, CheckCircle2, ArrowRight } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { BRAND_CONFIG } from '../config/brand';

interface InstallAppPanelProps {
  mode?: 'page' | 'modal';
  onClose?: () => void;
  onContinueToApp?: () => void;
}

export const InstallAppPanel: React.FC<InstallAppPanelProps> = ({
  mode = 'modal',
  onClose,
  onContinueToApp,
}) => {
  const {
    isInstallable,
    isInstalled,
    isInIframe,
    isInAppBrowser,
    isIOS,
    isAndroid,
    installUrl,
    androidChromeIntentUrl,
    install,
  } = usePWAInstall();
  const [installing, setInstalling] = useState(false);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    if (isInstallable) {
      setShowHint(false);
    }
  }, [isInstallable]);

  const handleDirectInstall = async () => {
    if (installing) return;
    setInstalling(true);
    try {
      const ok = await install();
      if (!ok) {
        setShowHint(true);
      }
    } finally {
      setInstalling(false);
    }
  };

  const cardContent = (
    <div
      className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1320] p-6 shadow-2xl space-y-5 text-slate-900 dark:text-slate-100 text-center"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <div className="w-6" />
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center font-bold text-xl shadow-sm shadow-indigo-500/25">
          K
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <div className="w-6" />
        )}
      </div>

      <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
        {BRAND_CONFIG.name}
      </h2>

      {isInstalled ? (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 p-3 flex items-center justify-center gap-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          App Installed
        </div>
      ) : isInIframe ? (
        <a
          href={installUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-sm shadow-indigo-500/25"
        >
          <ExternalLink className="w-4 h-4" />
          Install {BRAND_CONFIG.name}
        </a>
      ) : isAndroid && isInAppBrowser ? (
        <a
          href={androidChromeIntentUrl}
          className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-sm shadow-indigo-500/25"
        >
          <Download className="w-4 h-4" />
          Install {BRAND_CONFIG.name}
        </a>
      ) : isInstallable ? (
        <button
          type="button"
          disabled={installing}
          onClick={handleDirectInstall}
          className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-70 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-sm shadow-indigo-500/25 cursor-pointer"
        >
          <Download className="w-4 h-4" />
          {installing ? 'Installing...' : `Install ${BRAND_CONFIG.name}`}
        </button>
      ) : isIOS ? (
        <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
          Open in Safari → Tap <strong>Share</strong> → <strong>Add to Home Screen</strong>
        </p>
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            disabled={installing}
            onClick={handleDirectInstall}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-70 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-sm shadow-indigo-500/25 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            {installing ? 'Preparing Install...' : `Install ${BRAND_CONFIG.name}`}
          </button>
          {showHint && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Tap browser menu (⋮) → <strong>Install app</strong>
            </p>
          )}
        </div>
      )}

      {onContinueToApp && (
        <button
          type="button"
          onClick={onContinueToApp}
          className="w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center justify-center gap-1.5 cursor-pointer"
        >
          Open {BRAND_CONFIG.name}
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );

  if (mode === 'page') {
    return (
      <div className="min-h-[100dvh] w-full bg-slate-50 dark:bg-[#090C15] flex items-center justify-center p-4 pt-safe pb-safe">
        {cardContent}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      {cardContent}
    </div>
  );
};
