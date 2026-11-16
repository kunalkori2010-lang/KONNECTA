import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { InstallAppPanel } from './InstallAppModal';

export const PWAInstallButton: React.FC<{
  variant?: 'compact' | 'button';
}> = ({ variant = 'button' }) => {
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
  const [openModal, setOpenModal] = useState(false);
  const [installing, setInstalling] = useState(false);

  if (isInstalled) {
    return null;
  }

  const className =
    variant === 'compact'
      ? 'inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090C15] text-slate-700 dark:text-slate-200 hover:border-indigo-500/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer'
      : 'inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer';

  const iconClass =
    variant === 'compact' ? 'w-3.5 h-3.5 text-indigo-500 shrink-0' : 'w-3.5 h-3.5 shrink-0';

  if (isInIframe && !isInstallable) {
    return (
      <a href={installUrl} target="_blank" rel="noopener noreferrer" className={className}>
        <Download className={iconClass} />
        <span>Install App</span>
      </a>
    );
  }

  if (isAndroid && isInAppBrowser && !isInstallable) {
    return (
      <a href={androidChromeIntentUrl} className={className}>
        <Download className={iconClass} />
        <span>Install App</span>
      </a>
    );
  }

  const handleClick = async () => {
    if (isIOS) {
      setOpenModal(true);
      return;
    }
    if (installing) return;
    setInstalling(true);
    try {
      const ok = await install();
      if (ok) return;
      setOpenModal(true);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <>
      <button onClick={handleClick} disabled={installing} type="button" className={className}>
        <Download className={iconClass} />
        <span>{installing ? 'Installing...' : 'Install App'}</span>
      </button>

      {openModal && <InstallAppPanel mode="modal" onClose={() => setOpenModal(false)} />}
    </>
  );
};
