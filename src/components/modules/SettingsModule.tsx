import React, { useEffect, useState } from 'react';
import {
  Download,
  Laptop,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Monitor,
  Bell,
} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { useApp } from '../../context/AppContext';
import { ACCENT_PRESETS, CHAT_WALLPAPERS } from '../../config/brand';

interface DeviceRow {
  id: string;
  uid: string;
  deviceName: string;
  fingerprint: string;
  revoked: boolean;
}

export const SettingsModule: React.FC = () => {
  const {
    firebaseUser,
    publicProfile,
    privateProfile,
    deviceId,
    theme,
    accentColor,
    fontSize,
    reducedMotion,
    chatWallpaper,
    updateThemePrefs,
    logout,
    showToast,
  } = useApp();

  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [exporting, setExporting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;
    const q = query(collection(db, 'user_devices'), where('uid', '==', firebaseUser.uid));
    return onSnapshot(
      q,
      (snap) => {
        setDevices(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DeviceRow, 'id'>) })));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'user_devices')
    );
  }, [firebaseUser]);

  const handleRevokeDevice = async (dev: DeviceRow) => {
    try {
      await updateDoc(doc(db, 'user_devices', dev.id), {
        revoked: !dev.revoked,
        lastActiveAt: serverTimestamp(),
      });
      showToast(dev.revoked ? 'Device restored' : 'Device revoked', dev.deviceName, 'info');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `user_devices/${dev.id}`);
    }
  };

  const handleExportData = async () => {
    if (!firebaseUser) return;
    setExporting(true);
    try {
      const uid = firebaseUser.uid;
      const [postsSnap, docsSnap, notesSnap, bookmarksSnap, eventsSnap, reportsSnap] =
        await Promise.all([
          getDocs(query(collection(db, 'posts'), where('authorUid', '==', uid))),
          getDocs(query(collection(db, 'study_documents'), where('ownerUid', '==', uid))),
          getDocs(query(collection(db, 'collaborative_notes'), where('ownerUid', '==', uid))),
          getDocs(query(collection(db, 'bookmarks'), where('ownerUid', '==', uid))),
          getDocs(query(collection(db, 'events'), where('creatorUid', '==', uid))),
          getDocs(query(collection(db, 'reports'), where('reporterUid', '==', uid))),
        ]);

      const exportBundle = {
        exportedAt: new Date().toISOString(),
        account: {
          uid,
          email: firebaseUser.email,
          publicProfile,
          privatePreferences: privateProfile,
        },
        devices,
        posts: postsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        studyDocuments: docsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        collaborativeNotes: notesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        bookmarks: bookmarksSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        events: eventsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        reports: reportsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      };

      const blob = new Blob([JSON.stringify(exportBundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `konnecta-data-export-${publicProfile?.username || uid}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Export ready', 'Downloaded your KONNECTA JSON archive.', 'success');
    } catch (err: unknown) {
      showToast('Export failed', err instanceof Error ? err.message : 'Unable to export data', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!firebaseUser || deleteTyped !== 'DELETE') return;
    setDeleting(true);
    try {
      const uid = firebaseUser.uid;
      // Clean up personal registry & private docs
      if (publicProfile?.username) {
        await deleteDoc(doc(db, 'usernames', publicProfile.username)).catch(() => {});
      }
      for (const dev of devices) {
        await deleteDoc(doc(db, 'user_devices', dev.id)).catch(() => {});
      }
      await deleteDoc(doc(db, 'user_keys', uid)).catch(() => {});
      await deleteDoc(doc(db, 'users_private', uid)).catch(() => {});
      await deleteDoc(doc(db, 'users_public', uid)).catch(() => {});

      await firebaseUser.delete();
      showToast('Account deleted', 'Your KONNECTA profile and keys have been removed.', 'info');
    } catch (err: unknown) {
      const msg =
        err instanceof Error && msgNeedsReauth(err.message)
          ? 'For security, please sign out and sign back in right before deleting your account.'
          : err instanceof Error
          ? err.message
          : 'Account deletion failed.';
      showToast('Account deletion notice', msg, 'error');
    } finally {
      setDeleting(false);
      setConfirmDeleteOpen(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          Appearance, Devices &amp; Data Ownership
        </h2>
        <p className="text-xs text-slate-500">
          Customize your workspace, review AI consent, manage devices, and export or delete your data
        </p>
      </div>

      {/* Appearance & Accessibility */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-5">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          Theme &amp; Accessibility
        </h3>

        <div className="grid sm:grid-cols-3 gap-2">
          {([
            { id: 'dark', label: 'Dark Mode', icon: Moon },
            { id: 'light', label: 'Light Mode', icon: Sun },
            { id: 'system', label: 'System Default', icon: Monitor },
          ] as const).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => updateThemePrefs({ theme: opt.id })}
              className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-medium cursor-pointer ${
                theme === opt.id
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              <opt.icon className="w-4 h-4" />
              {opt.label}
            </button>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Accent Color
            </label>
            <div className="flex flex-wrap gap-2">
              {ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => updateThemePrefs({ accentColor: preset.primary })}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs cursor-pointer ${
                    accentColor === preset.primary
                      ? 'border-indigo-500 font-semibold'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: preset.primary }}
                  />
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Font Size Scale
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['sm', 'md', 'lg'] as const).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => updateThemePrefs({ fontSize: sz })}
                  className={`py-1.5 rounded-lg border text-xs font-medium uppercase cursor-pointer ${
                    fontSize === sz
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {sz}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Chat Wallpaper
            </label>
            <select
              aria-label="Chat wallpaper"
              value={chatWallpaper}
              onChange={(e) => updateThemePrefs({ chatWallpaper: e.target.value })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] px-3 py-2 text-xs"
            >
              {CHAT_WALLPAPERS.map((wp) => (
                <option key={wp.id} value={wp.id}>
                  {wp.label}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 p-3 cursor-pointer">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Reduced Motion
            </span>
            <input
              type="checkbox"
              checked={reducedMotion}
              onChange={(e) => updateThemePrefs({ reducedMotion: e.target.checked })}
            />
          </label>
        </div>
      </div>

      {/* Notification Preferences & AI Consent */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Bell className="w-4 h-4 text-indigo-500" />
          Notifications &amp; AI Processing Consent
        </h3>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 text-xs cursor-pointer">
            <span>Notification Sounds</span>
            <input
              type="checkbox"
              checked={privateProfile?.soundEnabled ?? true}
              onChange={(e) => updateThemePrefs({ soundEnabled: e.target.checked })}
            />
          </label>
          <label className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 text-xs cursor-pointer">
            <span>Show Alert Body Previews</span>
            <input
              type="checkbox"
              checked={privateProfile?.lockScreenPreview ?? true}
              onChange={(e) => updateThemePrefs({ lockScreenPreview: e.target.checked })}
            />
          </label>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-slate-900 dark:text-white">Quiet Hours</p>
            <p className="text-[11px] text-slate-500">Silence non-urgent alerts during study or sleep windows</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="time"
              aria-label="Quiet hours start"
              value={privateProfile?.quietHoursStart || '22:00'}
              onChange={(e) => updateThemePrefs({ quietHoursStart: e.target.value })}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1 text-xs"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="time"
              aria-label="Quiet hours end"
              value={privateProfile?.quietHoursEnd || '07:00'}
              onChange={(e) => updateThemePrefs({ quietHoursEnd: e.target.value })}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1 text-xs"
            />
            <input
              type="checkbox"
              aria-label="Enable quiet hours"
              checked={privateProfile?.quietHoursEnabled ?? false}
              onChange={(e) => updateThemePrefs({ quietHoursEnabled: e.target.checked })}
            />
          </div>
        </div>

        <label className="flex items-start justify-between gap-4 rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-950/20 p-4 cursor-pointer">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Study Zone AI Assistant Consent
            </p>
            <p className="text-[11px] text-slate-600 dark:text-slate-300">
              When enabled, explicit Study Zone documents you select can be analyzed by Google Gemini.
              Private E2EE chats and Vault files are never transmitted to AI models.
            </p>
          </div>
          <input
            type="checkbox"
            checked={privateProfile?.aiConsentGranted ?? false}
            onChange={(e) => updateThemePrefs({ aiConsentGranted: e.target.checked })}
          />
        </label>
      </div>

      {/* Registered Devices */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Laptop className="w-4 h-4 text-indigo-500" />
            Registered Devices ({devices.length})
          </h3>
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            ECDH P-256 Active
          </span>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {devices.map((d) => (
            <div key={d.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-slate-900 dark:text-white">
                  {d.deviceName} {d.id === deviceId ? '· Current Browser' : ''}
                </p>
                <p className="text-[11px] font-mono text-slate-500">
                  Fingerprint: {d.fingerprint} · {d.revoked ? 'Revoked' : 'Trusted'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleRevokeDevice(d)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer ${
                  d.revoked
                    ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-red-500 hover:text-red-500'
                }`}
              >
                {d.revoked ? 'Restore' : 'Revoke'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Data Ownership & Account Deletion */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          Data Ownership &amp; Account Controls
        </h3>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={exporting}
              onClick={handleExportData}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:border-indigo-500 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              {exporting ? 'Preparing JSON...' : 'Download Personal Data (JSON)'}
            </button>
            <button
              type="button"
              onClick={logout}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
            >
              Sign Out
            </button>
          </div>

          <button
            type="button"
            onClick={() => setConfirmDeleteOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-red-300 dark:border-red-900/60 text-red-600 dark:text-red-400 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete Account
          </button>
        </div>
      </div>

      {confirmDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <h3 className="text-sm font-bold text-red-600 dark:text-red-400">
              Permanently Delete KONNECTA Account?
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              This removes your public handle, private profile, device registrations, and Firebase
              login. Download your JSON export first if you want a copy of your data. Type{' '}
              <span className="font-mono font-bold">DELETE</span> to confirm.
            </p>
            <input
              type="text"
              value={deleteTyped}
              onChange={(e) => setDeleteTyped(e.target.value)}
              placeholder="Type DELETE"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm font-mono"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(false)}
                className="px-4 py-2 text-xs text-slate-500 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteTyped !== 'DELETE' || deleting}
                onClick={handleDeleteAccount}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {deleting ? 'Deleting...' : 'Confirm Deletion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function msgNeedsReauth(msg: string) {
  return msg.toLowerCase().includes('requires-recent-login');
}
