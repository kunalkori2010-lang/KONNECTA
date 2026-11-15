import React, { useState } from 'react';
import { doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { Check, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { db } from '../lib/firebase';
import { useApp } from '../context/AppContext';
import { INTEREST_OPTIONS, BRAND_CONFIG } from '../config/brand';

export const OnboardingWizard: React.FC = () => {
  const { firebaseUser, showToast, logout } = useApp();
  const [displayName, setDisplayName] = useState(firebaseUser?.displayName || '');
  const [username, setUsername] = useState(
    (firebaseUser?.email?.split('@')[0] || 'member').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 20)
  );
  const [showOptional, setShowOptional] = useState(false);
  const [interests, setInterests] = useState<string[]>([]);
  const [customTopic, setCustomTopic] = useState('');
  const [profileVisibility, setProfileVisibility] = useState<'public' | 'friends' | 'private'>('public');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!firebaseUser) return null;

  const toggleInterest = (tag: string) => {
    setInterests((prev) =>
      prev.includes(tag)
        ? prev.filter((t) => t !== tag)
        : prev.length < 10
        ? [...prev, tag]
        : prev
    );
  };

  const addCustomInterest = () => {
    const cleaned = customTopic.trim().slice(0, 40);
    if (!cleaned || interests.length >= 10) return;
    if (!interests.some((i) => i.toLowerCase() === cleaned.toLowerCase())) {
      setInterests((prev) => [...prev, cleaned]);
    }
    setCustomTopic('');
  };

  const handleComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(cleanUsername)) {
      setError('Handle must be 3–32 characters (lowercase letters, numbers, underscores).');
      return;
    }
    if (!displayName.trim()) {
      setError('Display name is required.');
      return;
    }

    setSaving(true);
    try {
      const unameRef = doc(db, 'usernames', cleanUsername);
      const existing = await getDoc(unameRef);
      if (existing.exists() && existing.data().uid !== firebaseUser.uid) {
        setError('That handle is already taken. Try adding a number or underscore.');
        setSaving(false);
        return;
      }

      const batch = writeBatch(db);
      if (!existing.exists()) {
        batch.set(unameRef, {
          uid: firebaseUser.uid,
          username: cleanUsername,
          createdAt: serverTimestamp(),
        });
      }

      batch.set(doc(db, 'users_public', firebaseUser.uid), {
        uid: firebaseUser.uid,
        username: cleanUsername,
        displayName: displayName.trim().slice(0, 80),
        bio: '',
        avatarUrl: firebaseUser.photoURL || '',
        coverColor: '#1E1B4B',
        college: '',
        interests,
        profileVisibility,
        storyVisibility: 'friends',
        friendRequestsFrom: 'everyone',
        onboardingCompleted: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
      showToast('Welcome to KONNECTA', `You're signed in as @${cleanUsername}.`, 'success');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create profile.');
    } finally {
      setSaving(false);
    }
  };

  const allOptions = Array.from(new Set([...INTEREST_OPTIONS, ...interests]));

  return (
    <div className="min-h-[100dvh] w-full bg-slate-50 dark:bg-[#090C15] flex items-center justify-center p-3 sm:p-4 py-6 pt-safe pb-safe">
      <form
        onSubmit={handleComplete}
        className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0E1320] p-5 sm:p-7 space-y-5 shadow-sm"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
              {BRAND_CONFIG.name} · Quick Setup
            </p>
            <h1 className="mt-0.5 text-lg font-bold text-slate-900 dark:text-white">
              Confirm your name &amp; handle
            </h1>
          </div>
          <button
            onClick={logout}
            type="button"
            className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
          >
            Sign out
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3.5 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Display Name
            </label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={80}
              placeholder="Your name"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#090C15] px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Handle
            </label>
            <div className="flex items-center rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#090C15] px-3.5">
              <span className="text-sm text-slate-400">@</span>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                maxLength={32}
                placeholder="username"
                className="w-full bg-transparent py-2.5 pl-1 text-sm text-slate-900 dark:text-white focus:outline-none"
              />
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowOptional((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
        >
          {showOptional ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {showOptional ? 'Hide optional preferences' : 'Optional: pick topics & visibility'}
        </button>

        {showOptional && (
          <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800/80">
            <div>
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                Topics (optional, {interests.length}/10)
              </p>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCustomInterest();
                    }
                  }}
                  maxLength={40}
                  placeholder="Add custom topic..."
                  className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#090C15] px-3 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={addCustomInterest}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  Add
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                {allOptions.map((tag) => {
                  const selected = interests.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleInterest(tag)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border cursor-pointer ${
                        selected
                          ? 'bg-indigo-600 border-indigo-600 text-white'
                          : 'bg-slate-50 dark:bg-[#090C15] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Profile Discovery
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(['public', 'friends', 'private'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setProfileVisibility(opt)}
                    className={`py-1.5 rounded-lg border text-xs font-medium capitalize cursor-pointer ${
                      profileVisibility === opt
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
        >
          <Check className="w-4 h-4" />
          {saving ? 'Entering...' : 'Enter KONNECTA'}
        </button>
      </form>
    </div>
  );
};
