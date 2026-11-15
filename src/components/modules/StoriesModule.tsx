import React, { useEffect, useState } from 'react';
import {
  Plus,
  Eye,
  Trash2,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  X,
} from 'lucide-react';
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
import { StoryItem } from '../../types/konnecta';

const BG_STYLES = [
  { id: 'indigo', label: 'Indigo', cls: 'bg-gradient-to-br from-indigo-600 to-blue-700 text-white' },
  { id: 'midnight', label: 'Midnight', cls: 'bg-gradient-to-br from-slate-800 to-indigo-950 text-white' },
  { id: 'emerald', label: 'Emerald', cls: 'bg-gradient-to-br from-emerald-600 to-teal-800 text-white' },
  { id: 'violet', label: 'Violet', cls: 'bg-gradient-to-br from-violet-700 to-slate-900 text-white' },
  { id: 'amber', label: 'Sunset', cls: 'bg-gradient-to-br from-amber-500 to-rose-600 text-white' },
  { id: 'paper', label: 'Paper', cls: 'bg-gradient-to-br from-slate-100 to-indigo-100 text-slate-900' },
];

const STORY_TEMPLATES = [
  { label: 'Blank', prompt: '' },
  { label: 'Daily Check-in', prompt: 'Today I am focusing on: ' },
  { label: 'Study Milestone', prompt: 'Just wrapped up a session on ' },
  { label: 'Quick Question', prompt: 'Quick question for everyone: ' },
  { label: 'Photo & Caption', prompt: 'Snapshot from today — ' },
];

const DURATION_OPTIONS = [
  { hours: 6, label: '6h' },
  { hours: 12, label: '12h' },
  { hours: 24, label: '24h' },
  { hours: 48, label: '48h' },
];

function formatRemaining(expiresAtMs: number): string {
  const diffMs = Math.max(0, expiresAtMs - Date.now());
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m left`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h left`;
}

export const StoriesModule: React.FC = () => {
  const { firebaseUser, publicProfile, showToast } = useApp();
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [activeStory, setActiveStory] = useState<StoryItem | null>(null);
  const [audienceFilter, setAudienceFilter] = useState<'all' | 'friends' | 'close_friends' | 'mine'>('all');

  const [type, setType] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('');
  const [bgStyle, setBgStyle] = useState(BG_STYLES[0].cls);
  const [mediaDataUrl, setMediaDataUrl] = useState('');
  const [visibility, setVisibility] = useState<'friends' | 'close_friends'>('friends');
  const [durationHours, setDurationHours] = useState(24);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;
    const q = query(
      collection(db, 'stories'),
      where('visibility', 'in', ['friends', 'close_friends']),
      limit(40)
    );
    return onSnapshot(
      q,
      (snap) => {
        const now = Date.now();
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<StoryItem, 'id'>) }))
          .filter((s) => s.expiresAtMs > now);
        rows.sort((a, b) => {
          const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
          const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
          return tb - ta;
        });
        setStories(rows);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'stories')
    );
  }, [firebaseUser]);

  const handleImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 300 * 1024) {
      showToast('Story image limit', 'Please pick an image smaller than 300 KB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setMediaDataUrl(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const handleCreateStory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    if (type === 'text' && !text.trim()) return;
    if (type === 'image' && !mediaDataUrl) return;

    setCreating(true);
    try {
      await addDoc(collection(db, 'stories'), {
        authorUid: firebaseUser.uid,
        authorName: publicProfile?.displayName || firebaseUser.displayName || 'Member',
        type,
        text: text.trim().slice(0, 500),
        bgStyle,
        mediaDataUrl,
        visibility,
        viewerUids: [firebaseUser.uid],
        expiresAtMs: Date.now() + durationHours * 60 * 60 * 1000,
        createdAt: serverTimestamp(),
      });
      setText('');
      setMediaDataUrl('');
      showToast('Story published', `Visible for ${durationHours} hours.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'stories');
    } finally {
      setCreating(false);
    }
  };

  const openStory = async (story: StoryItem) => {
    setActiveStory(story);
    if (firebaseUser && !story.viewerUids?.includes(firebaseUser.uid)) {
      const nextViewers = [...(story.viewerUids || []), firebaseUser.uid].slice(0, 200);
      await updateDoc(doc(db, 'stories', story.id), { viewerUids: nextViewers });
    }
  };

  const filteredStories = stories.filter((s) => {
    if (audienceFilter === 'friends') return s.visibility === 'friends';
    if (audienceFilter === 'close_friends') return s.visibility === 'close_friends';
    if (audienceFilter === 'mine') return s.authorUid === firebaseUser?.uid;
    return true;
  });

  const activeIdx = activeStory ? filteredStories.findIndex((s) => s.id === activeStory.id) : -1;

  const stepStory = (delta: number) => {
    if (filteredStories.length === 0) return;
    const nextIdx =
      activeIdx === -1
        ? 0
        : (activeIdx + delta + filteredStories.length) % filteredStories.length;
    openStory(filteredStories[nextIdx]);
  };

  return (
    <div className="max-w-5xl mx-auto grid lg:grid-cols-12 gap-6">
      {/* Story Composer */}
      <form
        onSubmit={handleCreateStory}
        className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-4 h-fit"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Create Flexible Story
          </h2>
          <span className="text-[11px] text-slate-500 inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {durationHours}h expiry
          </span>
        </div>

        {/* Mode toggle */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-[#0B0F19] rounded-lg">
          {(['text', 'image'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md capitalize cursor-pointer ${
                type === t ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-500'
              }`}
            >
              {t} Story
            </button>
          ))}
        </div>

        {/* Quick Templates */}
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-slate-500">Quick Starter Prompts</p>
          <div className="flex flex-wrap gap-1.5">
            {STORY_TEMPLATES.map((tpl) => (
              <button
                key={tpl.label}
                type="button"
                onClick={() => {
                  if (tpl.label === 'Photo & Caption') {
                    setType('image');
                  }
                  setText(tpl.prompt);
                }}
                className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 hover:border-indigo-500 cursor-pointer"
              >
                {tpl.label}
              </button>
            ))}
          </div>
        </div>

        {type === 'text' ? (
          <>
            <textarea
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={500}
              placeholder="Share a quick thought, daily highlight, study win, or question..."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F19] px-3.5 py-2.5 text-sm"
            />
            <div className="flex items-center gap-2 flex-wrap">
              {BG_STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setBgStyle(s.cls)}
                  title={s.label}
                  className={`w-8 h-8 rounded-lg border border-slate-300 dark:border-slate-700 ${s.cls} ${
                    bgStyle === s.cls ? 'ring-2 ring-offset-2 ring-indigo-500' : ''
                  } cursor-pointer`}
                  aria-label={`Select ${s.label} background`}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <label className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-xs text-slate-500 cursor-pointer hover:border-indigo-500">
              <ImageIcon className="w-6 h-6 mb-2 text-indigo-500" />
              <span>Select story image (under 300 KB)</span>
              <input type="file" accept="image/*" onChange={handleImagePick} className="hidden" />
            </label>
            {mediaDataUrl && (
              <img src={mediaDataUrl} alt="Story preview" className="max-h-48 rounded-xl mx-auto" />
            )}
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Optional caption..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
            />
          </div>
        )}

        {/* Audience & Duration Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2">
            <select
              aria-label="Story audience"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'friends' | 'close_friends')}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 py-1.5 text-xs"
            >
              <option value="friends">Friends</option>
              <option value="close_friends">Close Friends</option>
            </select>

            <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 p-0.5">
              {DURATION_OPTIONS.map((d) => (
                <button
                  key={d.hours}
                  type="button"
                  onClick={() => setDurationHours(d.hours)}
                  className={`px-2 py-1 rounded-md text-[11px] font-medium cursor-pointer ${
                    durationHours === d.hours
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={creating}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            {creating ? 'Posting...' : 'Share Story'}
          </button>
        </div>
      </form>

      {/* Active Stories & Viewer */}
      <div className="lg:col-span-7 space-y-4">
        {activeStory && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-950 text-white">
            {/* Story sequence progress bar */}
            {filteredStories.length > 1 && (
              <div className="flex gap-1 px-3 pt-2.5">
                {filteredStories.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => openStory(s)}
                    aria-label={`View story ${idx + 1}`}
                    className={`h-1 flex-1 rounded-full cursor-pointer ${
                      idx === activeIdx ? 'bg-white' : 'bg-white/25 hover:bg-white/50'
                    }`}
                  />
                ))}
              </div>
            )}

            <div className="px-4 py-3 flex items-center justify-between text-xs border-b border-slate-800">
              <span>
                {activeStory.authorName} ·{' '}
                {activeStory.visibility === 'close_friends' ? 'Close Friends' : 'Friends'} ·{' '}
                {formatRemaining(activeStory.expiresAtMs)}
              </span>
              <div className="flex items-center gap-2.5">
                <span className="inline-flex items-center gap-1 text-slate-400">
                  <Eye className="w-3.5 h-3.5" />
                  {activeStory.viewerUids?.length || 1}
                </span>
                {activeStory.authorUid === firebaseUser?.uid && (
                  <button
                    type="button"
                    onClick={async () => {
                      await deleteDoc(doc(db, 'stories', activeStory.id));
                      setActiveStory(null);
                    }}
                    title="Delete story"
                    className="text-red-400 hover:text-red-300 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActiveStory(null)}
                  title="Close viewer"
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="relative">
              {activeStory.type === 'text' ? (
                <div
                  className={`h-72 p-10 flex items-center justify-center text-center ${
                    activeStory.bgStyle || BG_STYLES[0].cls
                  }`}
                >
                  <p className="text-lg font-semibold max-w-md">{activeStory.text}</p>
                </div>
              ) : (
                <div className="relative h-80 flex items-center justify-center bg-black">
                  <img src={activeStory.mediaDataUrl} alt="Story" className="max-h-full object-contain" />
                  {activeStory.text && (
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-4 text-sm text-center">
                      {activeStory.text}
                    </div>
                  )}
                </div>
              )}

              {filteredStories.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => stepStory(-1)}
                    aria-label="Previous story"
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 hover:bg-black/75 text-white cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => stepStory(1)}
                    aria-label="Next story"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 hover:bg-black/75 text-white cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Active Stories ({filteredStories.length})
            </h3>
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-[#0B0F19]">
              {([
                { id: 'all', label: 'All' },
                { id: 'friends', label: 'Friends' },
                { id: 'close_friends', label: 'Close' },
                { id: 'mine', label: 'Mine' },
              ] as const).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setAudienceFilter(tab.id)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer ${
                    audienceFilter === tab.id
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
                      : 'text-slate-500'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {filteredStories.length === 0 ? (
            <p className="text-xs text-slate-500">No stories match this filter right now.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {filteredStories.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => openStory(s)}
                  className={`rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
                    activeStory?.id === s.id
                      ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20'
                      : 'border-slate-200 dark:border-slate-800 hover:border-indigo-500'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {s.authorName}
                    </p>
                    <span className="text-[11px] text-slate-500 shrink-0">
                      {formatRemaining(s.expiresAtMs)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 truncate">
                    {s.text || 'Image story'} · {s.viewerUids?.length || 1} views
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
