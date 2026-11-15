import React, { useEffect, useState } from 'react';
import { Timer, Play, Pause, RotateCcw, Plus, CheckSquare, Square, Users } from 'lucide-react';
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { useApp } from '../../context/AppContext';
import { StudyRoomItem } from '../../types/konnecta';

export const StudyRoomsModule: React.FC = () => {
  const { firebaseUser, publicProfile, wsSend, wsSubscribe, showToast } = useApp();
  const [rooms, setRooms] = useState<StudyRoomItem[]>([]);
  const [activeRoom, setActiveRoom] = useState<StudyRoomItem | null>(null);
  const [remainingSec, setRemainingSec] = useState(25 * 60);

  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [minutes, setMinutes] = useState(25);
  const [scheduledFor, setScheduledFor] = useState('');
  const [newGoalText, setNewGoalText] = useState('');

  useEffect(() => {
    if (!firebaseUser) return;
    const q = query(
      collection(db, 'study_rooms'),
      where('visibility', 'in', ['public', 'friends']),
      limit(30)
    );
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StudyRoomItem, 'id'>) }));
        list.sort((a, b) => {
          const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
          const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
          return tb - ta;
        });
        setRooms(list);
        if (activeRoom) {
          const updated = list.find((r) => r.id === activeRoom.id);
          if (updated) setActiveRoom(updated);
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'study_rooms')
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser]);

  // Synchronized countdown timer driven by room's timerEndAtMs
  useEffect(() => {
    if (!activeRoom) return;
    wsSend({ type: 'room:join', roomId: `study:${activeRoom.id}` });

    const tick = () => {
      if (activeRoom.timerStatus === 'running' && activeRoom.timerEndAtMs) {
        const left = Math.max(0, Math.round((activeRoom.timerEndAtMs - Date.now()) / 1000));
        setRemainingSec(left);
      } else {
        setRemainingSec(activeRoom.timerMinutes * 60);
      }
    };
    tick();
    const interval = setInterval(tick, 1000);

    const unsubWs = wsSubscribe((msg) => {
      if (msg.roomId === `study:${activeRoom.id}` && msg.type === 'studyroom:timer') {
        if (typeof msg.remainingSec === 'number') setRemainingSec(msg.remainingSec);
      }
    });

    return () => {
      clearInterval(interval);
      unsubWs();
      wsSend({ type: 'room:leave', roomId: `study:${activeRoom.id}` });
    };
  }, [activeRoom, wsSend, wsSubscribe]);

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !title.trim()) return;
    const ref = await addDoc(collection(db, 'study_rooms'), {
      hostUid: firebaseUser.uid,
      hostName: publicProfile?.displayName || 'Member',
      title: title.trim().slice(0, 100),
      subject: subject.trim().slice(0, 80) || 'General Study',
      goals: [],
      timerMinutes: minutes,
      timerStatus: 'idle',
      timerEndAtMs: 0,
      visibility: 'public',
      participantUids: [firebaseUser.uid],
      scheduledFor: scheduledFor.trim(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setTitle('');
    setSubject('');
    setScheduledFor('');
    showToast('Study Room created', 'Invite friends to join your synchronized focus session.', 'success');
    const created = rooms.find((r) => r.id === ref.id);
    if (created) setActiveRoom(created);
  };

  const joinRoom = async (room: StudyRoomItem) => {
    if (!firebaseUser) return;
    setActiveRoom(room);
    if (!room.participantUids.includes(firebaseUser.uid)) {
      await updateDoc(doc(db, 'study_rooms', room.id), {
        participantUids: [...room.participantUids, firebaseUser.uid].slice(0, 30),
        updatedAt: serverTimestamp(),
      });
    }
  };

  const updateTimer = async (nextStatus: 'running' | 'paused' | 'idle') => {
    if (!activeRoom) return;
    const endAt = nextStatus === 'running' ? Date.now() + remainingSec * 1000 : 0;
    await updateDoc(doc(db, 'study_rooms', activeRoom.id), {
      timerStatus: nextStatus,
      timerEndAtMs: endAt,
      updatedAt: serverTimestamp(),
    });
    wsSend({
      type: 'studyroom:timer',
      roomId: `study:${activeRoom.id}`,
      timerStatus: nextStatus,
      remainingSec: nextStatus === 'idle' ? activeRoom.timerMinutes * 60 : remainingSec,
    });
  };

  const addGoal = async () => {
    if (!activeRoom || !newGoalText.trim()) return;
    const nextGoals = [
      ...(activeRoom.goals || []),
      { id: crypto.randomUUID().slice(0, 8), text: newGoalText.trim(), done: false },
    ].slice(0, 20);
    await updateDoc(doc(db, 'study_rooms', activeRoom.id), {
      goals: nextGoals,
      updatedAt: serverTimestamp(),
    });
    setNewGoalText('');
  };

  const toggleGoal = async (goalId: string) => {
    if (!activeRoom) return;
    const nextGoals = (activeRoom.goals || []).map((g) =>
      g.id === goalId ? { ...g, done: !g.done } : g
    );
    await updateDoc(doc(db, 'study_rooms', activeRoom.id), {
      goals: nextGoals,
      updatedAt: serverTimestamp(),
    });
  };

  const fmt = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="max-w-6xl mx-auto grid lg:grid-cols-12 gap-6">
      {/* Create & List Rooms */}
      <div className="lg:col-span-5 space-y-4">
        <form
          onSubmit={handleCreateRoom}
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-3"
        >
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Start or Schedule Study Room
          </h2>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Session title (e.g. Organic Chemistry Sprint)"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
            />
            <input
              type="number"
              min={5}
              max={120}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
            />
          </div>
          <input
            type="text"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            placeholder="Schedule time (optional, e.g. Today 18:00)"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
          />
          <button
            type="submit"
            className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Study Room
          </button>
        </form>

        <div className="space-y-2.5">
          {rooms.map((r) => (
            <div
              key={r.id}
              onClick={() => joinRoom(r)}
              className={`rounded-xl border p-4 cursor-pointer transition-colors ${
                activeRoom?.id === r.id
                  ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]'
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{r.title}</h3>
                <span className="text-xs font-mono text-indigo-500">{r.timerMinutes}m</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {r.subject} · Host: {r.hostName} · {r.participantUids.length} participants
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Active Study Room Stage */}
      <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 flex flex-col justify-between min-h-[460px]">
        {!activeRoom ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-xs text-slate-500">
            <Timer className="w-8 h-8 text-indigo-500 mb-2" />
            Select or create a Study Room to start a synchronized Pomodoro focus session.
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {activeRoom.title}
                </h3>
                <p className="text-xs text-slate-500">
                  {activeRoom.subject} · Host: {activeRoom.hostName}
                  {activeRoom.scheduledFor ? ` · ${activeRoom.scheduledFor}` : ''}
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <Users className="w-3.5 h-3.5" />
                {activeRoom.participantUids.length} active
              </span>
            </div>

            <div className="rounded-2xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 p-8 text-center">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                Shared Focus Timer · {activeRoom.timerStatus}
              </p>
              <p className="mt-2 font-mono text-5xl font-bold text-slate-900 dark:text-white tabular-nums">
                {fmt(remainingSec)}
              </p>
              <div className="mt-6 flex items-center justify-center gap-3">
                {activeRoom.timerStatus !== 'running' ? (
                  <button
                    type="button"
                    onClick={() => updateTimer('running')}
                    className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Start Focus
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => updateTimer('paused')}
                    className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    Pause
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => updateTimer('idle')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </button>
              </div>
            </div>

            {/* Shared Study Goals */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-slate-900 dark:text-white">
                Shared Study Goals
              </h4>
              <div className="space-y-2">
                {(activeRoom.goals || []).map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => toggleGoal(g.id)}
                    className="w-full flex items-center gap-2.5 text-left text-xs py-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
                  >
                    {g.done ? (
                      <CheckSquare className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    <span className={g.done ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-200'}>
                      {g.text}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newGoalText}
                  onChange={(e) => setNewGoalText(e.target.value)}
                  placeholder="Add a shared study goal..."
                  className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={addGoal}
                  className="px-4 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-xs font-medium cursor-pointer"
                >
                  Add Goal
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
