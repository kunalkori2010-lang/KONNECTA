import { useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type InstallPlatform = 'ios' | 'android' | 'desktop';

let cachedDeferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    cachedDeferredPrompt = e as BeforeInstallPromptEvent;
    promptListeners.forEach((cb) => cb());
  });
}

function detectPlatform(): InstallPlatform {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent.toLowerCase();
  const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (/iphone|ipad|ipod/.test(ua) || isIPadOS) return 'ios';
  if (ua.includes('android')) return 'android';
  return 'desktop';
}

function detectIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function detectInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /\bwv\b|FBAN|FBAV|Instagram|WhatsApp|Snapchat|Line\/|Twitter|LinkedInApp|MicroMessenger|Telegram/i.test(
    ua
  );
}

export function getAppInstallUrl(): string {
  if (typeof window === 'undefined') return '/?install=1';
  return `${window.location.origin}/?install=1`;
}

export function getAndroidChromeIntentUrl(): string {
  if (typeof window === 'undefined') return '/?install=1';
  const hostAndPath = `${window.location.host}/?install=1`;
  return `intent://${hostAndPath}#Intent;scheme=https;package=com.android.chrome;end`;
}

function waitForDeferredPrompt(timeoutMs = 3500): Promise<BeforeInstallPromptEvent | null> {
  if (cachedDeferredPrompt) return Promise.resolve(cachedDeferredPrompt);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ev: BeforeInstallPromptEvent | null) => {
      if (settled) return;
      settled = true;
      promptListeners.delete(onReady);
      clearTimeout(timer);
      resolve(ev);
    };
    const onReady = () => finish(cachedDeferredPrompt);
    const timer = window.setTimeout(() => finish(cachedDeferredPrompt), timeoutMs);
    promptListeners.add(onReady);
  });
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    cachedDeferredPrompt
  );
  const [isInstalled, setIsInstalled] = useState(false);
  const [platform, setPlatform] = useState<InstallPlatform>('desktop');
  const [isInIframe, setIsInIframe] = useState(false);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);
    setPlatform(detectPlatform());
    setIsInIframe(detectIframe());
    setIsInAppBrowser(detectInAppBrowser());
    setDeferredPrompt(cachedDeferredPrompt);

    const syncPrompt = () => setDeferredPrompt(cachedDeferredPrompt);
    promptListeners.add(syncPrompt);

    const handleAppInstalled = () => {
      cachedDeferredPrompt = null;
      setDeferredPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      promptListeners.delete(syncPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (platform === 'ios' || isInAppBrowser || isInIframe) {
      return false;
    }
    const promptEvent =
      deferredPrompt || cachedDeferredPrompt || (await waitForDeferredPrompt(3500));
    if (!promptEvent) return false;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === 'accepted') {
      cachedDeferredPrompt = null;
      setDeferredPrompt(null);
      setIsInstalled(true);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isInIframe,
    isInAppBrowser,
    isIOS: platform === 'ios',
    isAndroid: platform === 'android',
    platform,
    installUrl: getAppInstallUrl(),
    androidChromeIntentUrl: getAndroidChromeIntentUrl(),
    install,
  };
}
