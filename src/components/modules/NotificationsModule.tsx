import React, { useEffect, useState } from 'react';
import { Bell, CheckCheck, Phone, Video, Trash2, SlidersHorizontal } from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { useApp } from '../../context/AppContext';
import { AppTab } from '../../types/konnecta';

interface CallLogRow {
  id: string;
  callerUid: string;
  callerName?: string;
  calleeUid: string;
  calleeName?: string;
  mode: 'audio' | 'video';
  status: string;
  durationSeconds?: number;
  createdAt?: { seconds?: number };
}

export const NotificationsModule: React.FC<{ onNavigate: (tab: AppTab) => void }> = ({
  onNavigate,
}) => {
  const { firebaseUser, notifications, unreadNotifCount, privateProfile, showToast } = useApp();
  const [tab, setTab] = useState<'alerts' | 'calls'>('alerts');
  const [callLogs, setCallLogs] = useState<CallLogRow[]>([]);

  useEffect(() => {
    if (!firebaseUser) return;
    const q = query(
      collection(db, 'call_logs'),
      where('participantUids', 'array-contains', firebaseUser.uid),
      limit(30)
    );
    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CallLogRow, 'id'>) }));
        rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        setCallLogs(rows);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'call_logs')
    );
  }, [firebaseUser]);

  const markRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `notifications/${id}`);
    }
  };

  const markAllRead = async () => {
    const unread = notifications.filter((n) => !n.read);
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    unread.forEach((n) => batch.update(doc(db, 'notifications', n.id), { read: true }));
    await batch.commit();
    showToast('All caught up', 'Marked all notifications as read.', 'success');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Notifications &amp; Call History
          </h2>
          <p className="text-xs text-slate-500">
            {unreadNotifCount} unread alerts · Quiet Hours{' '}
            {privateProfile?.quietHoursEnabled
              ? `${privateProfile.quietHoursStart}–${privateProfile.quietHoursEnd}`
              : 'Off'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('settings')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Preferences
          </button>
          {unreadNotifCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold cursor-pointer"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark All Read
            </button>
          )}
        </div>
      </div>

      {/* Subtabs */}
      <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl w-fit">
        <button
          type="button"
          onClick={() => setTab('alerts')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
            tab === 'alerts'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          Activity Alerts ({notifications.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('calls')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
            tab === 'calls'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          Call Logs ({callLogs.length})
        </button>
      </div>

      {tab === 'alerts' ? (
        notifications.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-10 text-center">
            <Bell className="w-8 h-8 text-indigo-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-900 dark:text-white">No notifications yet</p>
            <p className="text-xs text-slate-500 mt-1">
              Friend requests, mentions, and shared resource updates will appear here.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] divide-y divide-slate-100 dark:divide-slate-800">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`p-4 flex items-start justify-between gap-3 ${
                  !n.read ? 'bg-indigo-50/40 dark:bg-indigo-950/15' : ''
                }`}
              >
                <div
                  className="min-w-0 flex-1 cursor-pointer"
                  onClick={() => {
                    if (!n.read) markRead(n.id);
                    if (n.linkTab) onNavigate(n.linkTab as AppTab);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">
                      {n.title}
                    </span>
                    {!n.read && (
                      <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                        New
                      </span>
                    )}
                  </div>
                  {n.body && (
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                      {privateProfile?.lockScreenPreview === false
                        ? 'Preview hidden by notification privacy setting.'
                        : n.body}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!n.read && (
                    <button
                      type="button"
                      onClick={() => markRead(n.id)}
                      className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                    >
                      Read
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteDoc(doc(db, 'notifications', n.id))}
                    className="p-1 text-slate-400 hover:text-red-500 cursor-pointer"
                    aria-label="Delete notification"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : callLogs.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-10 text-center">
          <Phone className="w-8 h-8 text-indigo-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-900 dark:text-white">No call history</p>
          <p className="text-xs text-slate-500 mt-1">
            Audio and video calls placed from Messages or Friends are logged here.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] divide-y divide-slate-100 dark:divide-slate-800">
          {callLogs.map((c) => {
            const isOutgoing = c.callerUid === firebaseUser?.uid;
            const peerName = isOutgoing ? c.calleeName || c.calleeUid : c.callerName || c.callerUid;
            return (
              <div key={c.id} className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                    {c.mode === 'video' ? (
                      <Video className="w-4 h-4 text-indigo-500" />
                    ) : (
                      <Phone className="w-4 h-4 text-emerald-500" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {peerName}
                    </p>
                    <p className="text-xs text-slate-500 capitalize">
                      {isOutgoing ? 'Outgoing' : 'Incoming'} · {c.mode} · {c.status}
                    </p>
                  </div>
                </div>
                {typeof c.durationSeconds === 'number' && c.durationSeconds > 0 && (
                  <span className="text-xs font-mono text-slate-500">
                    {Math.floor(c.durationSeconds / 60)}m {c.durationSeconds % 60}s
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
