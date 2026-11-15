/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { LandingPage } from './components/LandingPage';
import { OnboardingWizard } from './components/OnboardingWizard';
import { AppShell } from './components/AppShell';
import { CallOverlay } from './components/calls/CallOverlay';
import { ToastContainer } from './components/ToastContainer';
import { OfflineBanner } from './components/OfflineBanner';

const KonnectaRouter: React.FC = () => {
  const { authReady, firebaseUser, publicProfile, profileLoaded } = useApp();

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
