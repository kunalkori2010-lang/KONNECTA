import React, { useEffect, useState } from 'react';
import { Calendar, MapPin, Plus, Trash2, Users, X, Check } from 'lucide-react';
import {
  addDoc,
  collection,
  deleteDoc,
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
import { EventItem } from '../../types/konnecta';

export const EventsModule: React.FC = () => {
  const { firebaseUser, publicProfile, isAdmin, showToast } = useApp();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'going' | 'mine'>('all');
  const [showCreate, setShowCreate] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'friends'>('public');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;
    const q = query(
      collection(db, 'events'),
      where('visibility', 'in', ['public', 'friends']),
      limit(60)
    );
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EventItem, 'id'>) }));
        list.sort((a, b) => {
          const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
          const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
          return tb - ta;
        });
        setEvents(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'events')
    );
  }, [firebaseUser]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !title.trim() || !startsAt.trim()) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'events'), {
        creatorUid: firebaseUser.uid,
        creatorName: publicProfile?.displayName || firebaseUser.displayName || 'Member',
        title: title.trim().slice(0, 120),
        description: description.trim().slice(0, 1000),
        location: location.trim().slice(0, 160) || 'Online / Study Room',
        startsAt: startsAt.trim().slice(0, 64),
        visibility,
        goingUids: [firebaseUser.uid],
        maybeUids: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setTitle('');
      setDescription('');
      setLocation('');
      setStartsAt('');
      setShowCreate(false);
      showToast('Event created', 'Published to the Events calendar.', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'events');
    } finally {
      setSaving(false);
    }
  };

  const toggleRsvp = async (ev: EventItem, choice: 'going' | 'maybe') => {
    if (!firebaseUser) return;
    const uid = firebaseUser.uid;
    const isGoing = ev.goingUids.includes(uid);
    const isMaybe = ev.maybeUids.includes(uid);

    let nextGoing = ev.goingUids.filter((id) => id !== uid);
    let nextMaybe = ev.maybeUids.filter((id) => id !== uid);

    if (choice === 'going' && !isGoing) {
      nextGoing = [...nextGoing, uid].slice(0, 100);
    } else if (choice === 'maybe' && !isMaybe) {
      nextMaybe = [...nextMaybe, uid].slice(0, 100);
    }

    try {
      await updateDoc(doc(db, 'events', ev.id), {
        goingUids: nextGoing,
        maybeUids: nextMaybe,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `events/${ev.id}`);
    }
  };

  const handleDelete = async (ev: EventItem) => {
    try {
      await deleteDoc(doc(db, 'events', ev.id));
      showToast('Event removed', undefined, 'info');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `events/${ev.id}`);
    }
  };

  const filteredEvents = events.filter((ev) => {
    if (!firebaseUser) return false;
    if (filter === 'going') return ev.goingUids.includes(firebaseUser.uid) || ev.maybeUids.includes(firebaseUser.uid);
    if (filter === 'mine') return ev.creatorUid === firebaseUser.uid;
    return true;
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Events &amp; Study Meetups</h2>
          <p className="text-xs text-slate-500">
            Organize campus sessions, group workshops, and live collaboration meetups
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          Create Event
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl w-fit">
        {([
          { id: 'all', label: `All Events (${events.length})` },
          { id: 'going', label: 'My RSVPs' },
          { id: 'mine', label: 'Hosted by Me' },
        ] as const).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFilter(t.id)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
              filter === t.id
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {filteredEvents.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-10 text-center">
          <Calendar className="w-8 h-8 text-indigo-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-900 dark:text-white">No events found</p>
          <p className="text-xs text-slate-500 mt-1">
            Schedule a study review, hackathon sprint, or community meetup.
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {filteredEvents.map((ev) => {
            const uid = firebaseUser?.uid || '';
            const isGoing = ev.goingUids.includes(uid);
            const isMaybe = ev.maybeUids.includes(uid);
            const canDelete = ev.creatorUid === uid || isAdmin;

            return (
              <div
                key={ev.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                        {ev.startsAt} · {ev.visibility === 'public' ? 'Public' : 'Friends'}
                      </p>
                      <h3 className="mt-0.5 text-base font-bold text-slate-900 dark:text-white">
                        {ev.title}
                      </h3>
                    </div>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDelete(ev)}
                        title="Delete event"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {ev.description && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      {ev.description}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 pt-1">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" />
                      {ev.location || 'Online'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      {ev.goingUids.length} going · {ev.maybeUids.length} maybe
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] text-slate-500 truncate">Host: {ev.creatorName}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleRsvp(ev, 'going')}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                        isGoing
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-emerald-500'
                      }`}
                    >
                      {isGoing && <Check className="w-3 h-3" />}
                      Going
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleRsvp(ev, 'maybe')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                        isMaybe
                          ? 'bg-indigo-600 border-indigo-600 text-white'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-500'
                      }`}
                    >
                      Maybe
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleCreate}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-6 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Create Event</h3>
              <button type="button" onClick={() => setShowCreate(false)} aria-label="Close">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <input
              type="text"
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title (e.g. Distributed Systems Review)"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="datetime-local"
                required
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
              />
              <select
                aria-label="Event visibility"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as 'public' | 'friends')}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] px-3 py-2 text-xs"
              >
                <option value="public">Public</option>
                <option value="friends">Friends Only</option>
              </select>
            </div>
            <input
              type="text"
              maxLength={160}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Location or Study Room link"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
            />
            <textarea
              rows={3}
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Agenda, topics, or preparation notes..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
            />
            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold disabled:opacity-60 cursor-pointer"
            >
              {saving ? 'Publishing...' : 'Publish Event'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
