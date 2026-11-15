import React, { useState } from 'react';
import {
  Lock,
  BookOpen,
  UserPlus,
  ArrowRight,
  Sun,
  Moon,
  ShieldCheck,
} from 'lucide-react';
import { BRAND_CONFIG } from '../config/brand';
import { useApp } from '../context/AppContext';
import { PWAInstallButton } from './PWAInstallButton';

export const LandingPage: React.FC = () => {
  const { signInWithGoogle, showToast, theme, updateThemePrefs } = useApp();
  const [signingIn, setSigningIn] = useState(false);

  const handleAuth = async () => {
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign-in cancelled or failed.';
      showToast('Authentication Error', msg, 'error');
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full overflow-x-clip bg-slate-50 text-slate-900 dark:bg-[#090C15] dark:text-slate-100 flex flex-col">
      {/* Compact 3-Zone Top Bar */}
      <header className="pt-safe border-b border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-[#0E1320]/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3 sm:gap-8">
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
          >
            {BRAND_CONFIG.name}
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
            <span className="whitespace-nowrap shrink-0">Encrypted Chats</span>
            <span className="whitespace-nowrap shrink-0">Contacts &amp; Stories</span>
            <span className="whitespace-nowrap shrink-0">Study &amp; Notes</span>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => updateThemePrefs({ theme: theme === 'dark' ? 'light' : 'dark' })}
              aria-label="Toggle light or dark mode"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={handleAuth}
              disabled={signingIn}
              type="button"
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {signingIn ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        </div>
      </header>

      {/* Essential Single-Screen Sign-In View */}
      <main id="top" className="flex-1 flex items-center">
        <div className="max-w-5xl mx-auto w-full px-6 py-10 grid lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-6 space-y-5">
            <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
              {BRAND_CONFIG.tagline}
            </p>
            <h1
              className="font-bold tracking-tight text-slate-900 dark:text-white text-balance leading-[1.1]"
              style={{ fontSize: 'clamp(2rem, 3.8vw, 3rem)' }}
            >
              Connect, share stories, and learn together.
            </h1>
            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed max-w-lg">
              One simple, private place for everyday chats, importing friends from contacts, 24h
              stories, and study notes in any subject.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                onClick={handleAuth}
                disabled={signingIn}
                type="button"
                className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-60 rounded-xl shadow-sm shadow-indigo-500/20 transition-all whitespace-nowrap shrink-0 cursor-pointer"
              >
                {signingIn ? 'Signing in...' : 'Continue with Google'}
                <ArrowRight className="w-4 h-4" />
              </button>
              <PWAInstallButton variant="compact" />
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0E1320] p-6 sm:p-7 space-y-5 shadow-sm">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  Sign in to {BRAND_CONFIG.name}
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Fast setup — pick your handle and enter in seconds.
                </p>
              </div>

              <button
                onClick={handleAuth}
                disabled={signingIn}
                type="button"
                className="w-full flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#090C15] hover:border-indigo-500 text-sm font-semibold text-slate-900 dark:text-white transition-colors cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4 text-indigo-500" />
                {signingIn ? 'Connecting Google Account...' : 'Sign in with Google'}
              </button>

              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-xs text-slate-600 dark:text-slate-300">
                <div className="flex items-center gap-3">
                  <Lock className="w-4 h-4 text-indigo-500 shrink-0" />
                  <span>End-to-end encrypted messages, voice/video calls &amp; personal vault</span>
                </div>
                <div className="flex items-center gap-3">
                  <UserPlus className="w-4 h-4 text-indigo-500 shrink-0" />
                  <span>Add friends directly from your contacts or invite link</span>
                </div>
                <div className="flex items-center gap-3">
                  <BookOpen className="w-4 h-4 text-indigo-500 shrink-0" />
                  <span>Flexible stories, communities, study folders &amp; notes</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200/80 dark:border-slate-800/80 py-5">
        <div className="max-w-6xl mx-auto px-6 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>{BRAND_CONFIG.name}</span>
          <span>Private · Fast · Ad-free</span>
        </div>
      </footer>
    </div>
  );
};
