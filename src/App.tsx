/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { LandingPage } from './components/LandingPage';
import { OnboardingWizard } from './components/OnboardingWizard';
import { AppShell } from './components/AppShell';
import { CallOverlay } from './components/calls/CallOverlay';
import { ToastContainer } from './components/ToastContainer';
import { OfflineBanner } from './components/OfflineBanner';
import { InstallAppPanel } from './components/InstallAppModal';

function isInstallRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.replace(/\/+$/, '');
  const params = new URLSearchParams(window.location.search);
  return path === '/install' || params.get('install') === '1';
}

const KonnectaRouter: React.FC = () => {
  const { authReady, firebaseUser, publicProfile, profileLoaded } = useApp();
  const [showInstallPage, setShowInstallPage] = useState<boolean>(isInstallRoute);

  if (showInstallPage) {
    return (
      <InstallAppPanel
        mode="page"
        onContinueToApp={() => {
          window.history.replaceState({}, '', '/');
          setShowInstallPage(false);
        }}
      />
    );
  }

  if (!authReady || (firebaseUser && !profileLoaded)) {
    return (
      <div className="min-h-[100dvh] bg-slate-50 dark:bg-[#0B0F19] flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white font-bold flex items-center justify-center mx-auto">
            K
          </div>
          <p className="text-xs font-medium text-slate-500">Loading KONNECTA workspace...</p>
        </div>
      </div>
    );
  }

  if (!firebaseUser) {
    return <LandingPage />;
  }

  if (!publicProfile?.onboardingCompleted) {
    return <OnboardingWizard />;
  }

  return <AppShell />;
};

export default function App() {
  return (
    <AppProvider>
      <KonnectaRouter />
      <CallOverlay />
      <ToastContainer />
      <OfflineBanner />
    </AppProvider>
  );
}
