import React, { useEffect, useState } from 'react';
import { ShieldAlert, CheckCircle2, Lock, FileWarning, ClipboardList } from 'lucide-react';
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { useApp } from '../../context/AppContext';
import { ReportItem } from '../../types/konnecta';

interface AuditLogRow {
  id: string;
  actorUid: string;
  action: string;
  targetType: string;
  targetId: string;
  detail?: string;
}

export const ModerationModule: React.FC = () => {
  const { firebaseUser, isAdmin, showToast } = useApp();
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);

  const [targetType, setTargetType] = useState<ReportItem['targetType']>('user');
  const [targetId, setTargetId] = useState('');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!firebaseUser) return;
    const rq = isAdmin
      ? query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(60))
      : query(collection(db, 'reports'), where('reporterUid', '==', firebaseUser.uid), limit(30));

    const unsubReports = onSnapshot(
      rq,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ReportItem, 'id'>) }));
        setReports(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'reports')
    );

    let unsubAudit: (() => void) | undefined;
    if (isAdmin) {
      const aq = query(collection(db, 'audit_logs'), orderBy('createdAt', 'desc'), limit(40));
      unsubAudit = onSnapshot(
        aq,
        (snap) => {
          setAuditLogs(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AuditLogRow, 'id'>) }))
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'audit_logs')
      );
    }

    return () => {
      unsubReports();
      unsubAudit?.();
    };
  }, [firebaseUser, isAdmin]);

  const handleFileReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    const cleanId = targetId.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
    if (!cleanId || reason.trim().length < 3) {
      showToast('Missing details', 'Provide a valid target ID and reason (3+ chars).', 'error');
      return;
    }

    setSubmitting(true);
    try {
      await addDoc(collection(db, 'reports'), {
        reporterUid: firebaseUser.uid,
        targetType,
        targetId: cleanId,
        reason: reason.trim().slice(0, 400),
        submittedEvidence: evidence.trim().slice(0, 2000),
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setTargetId('');
      setReason('');
      setEvidence('');
      showToast('Report submitted', 'Safety team queue has received your report.', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'reports');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolveReport = async (
    rep: ReportItem,
    nextStatus: 'reviewed' | 'resolved' | 'dismissed'
  ) => {
    if (!firebaseUser || !isAdmin) return;
    const moderatorNote = (noteInputs[rep.id] || rep.moderatorNote || '').trim().slice(0, 500);
    try {
      await updateDoc(doc(db, 'reports', rep.id), {
        status: nextStatus,
        moderatorNote,
        updatedAt: serverTimestamp(),
      });
      await addDoc(collection(db, 'audit_logs'), {
        actorUid: firebaseUser.uid,
        action: `report:${nextStatus}`,
        targetType: rep.targetType,
        targetId: rep.id,
        detail: moderatorNote || `Marked ${nextStatus}`,
        createdAt: serverTimestamp(),
      });
      showToast('Report updated', `Status changed to ${nextStatus}.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `reports/${rep.id}`);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          Safety &amp; Moderation Centre
        </h2>
        <p className="text-xs text-slate-500">
          Report harmful content, track submissions, and enforce community standards with zero silent surveillance
        </p>
      </div>

      {/* Zero-Access Architectural Guarantee Banner */}
      <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 flex items-start gap-3">
        <Lock className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
          <span className="font-semibold">Privacy Boundary Enforced by Firestore Rules:</span>{' '}
          Moderators and administrators cannot browse private E2EE conversations or decrypt Personal
          Vault items. Moderation reviews apply strictly to public content and user-submitted
          evidence snippets explicitly attached to a safety report.
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Submit New Report */}
        <form
          onSubmit={handleFileReport}
          className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-3 h-fit"
        >
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <FileWarning className="w-4 h-4 text-amber-500" />
            Submit Safety Report
          </h3>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Target Category
            </label>
            <select
              aria-label="Report target type"
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as ReportItem['targetType'])}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] px-3 py-2 text-xs"
            >
              <option value="user">User Profile</option>
              <option value="post">Public Post / Moment</option>
              <option value="community">Community</option>
              <option value="message">Explicitly Submitted Message Evidence</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Target ID / Reference
            </label>
            <input
              type="text"
              required
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              placeholder="Document or user ID"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Reason
            </label>
            <textarea
              rows={3}
              required
              minLength={3}
              maxLength={400}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe the harassment, spam, or safety concern..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Optional Submitted Evidence
            </label>
            <textarea
              rows={2}
              maxLength={2000}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder="Optional excerpt you explicitly choose to share with moderators..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold disabled:opacity-60 cursor-pointer"
          >
            {submitting ? 'Submitting...' : 'Submit Report'}
          </button>
        </form>

        {/* Reports List / Admin Queue */}
        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-indigo-500" />
              {isAdmin ? `Admin Moderation Queue (${reports.length})` : `Your Reports (${reports.length})`}
            </h3>

            {reports.length === 0 ? (
              <p className="text-xs text-slate-500 py-4">No safety reports in queue.</p>
            ) : (
              <div className="space-y-3">
                {reports.map((rep) => (
                  <div
                    key={rep.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F19] p-4 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900 dark:text-white capitalize">
                        {rep.targetType} · <span className="font-mono">{rep.targetId}</span>
                      </span>
                      <span className="text-[11px] font-semibold uppercase text-indigo-600 dark:text-indigo-400">
                        {rep.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-slate-300">{rep.reason}</p>
                    {rep.submittedEvidence && (
                      <p className="rounded-lg bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 px-3 py-2 text-[11px] text-slate-500">
                        Evidence: {rep.submittedEvidence}
                      </p>
                    )}
                    {rep.moderatorNote && (
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Moderator note: {rep.moderatorNote}
                      </p>
                    )}

                    {isAdmin && (
                      <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                        <input
                          type="text"
                          value={noteInputs[rep.id] ?? rep.moderatorNote ?? ''}
                          onChange={(e) =>
                            setNoteInputs((p) => ({ ...p, [rep.id]: e.target.value }))
                          }
                          placeholder="Moderator note..."
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] px-3 py-1.5 text-xs"
                        />
                        <div className="flex flex-wrap gap-2">
                          {(['reviewed', 'resolved', 'dismissed'] as const).map((st) => (
                            <button
                              key={st}
                              type="button"
                              onClick={() => handleResolveReport(rep, st)}
                              className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] text-xs font-medium capitalize hover:border-indigo-500 cursor-pointer"
                            >
                              Mark {st}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {isAdmin && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-indigo-500" />
                Admin Audit Log ({auditLogs.length})
              </h3>
              {auditLogs.length === 0 ? (
                <p className="text-xs text-slate-500">No moderation actions recorded yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="py-2 text-xs">
                      <span className="font-semibold text-slate-900 dark:text-white">{log.action}</span>{' '}
                      <span className="text-slate-500">
                        on {log.targetType} ({log.targetId})
                      </span>
                      {log.detail && <p className="text-[11px] text-slate-500 mt-0.5">{log.detail}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
