import React, { useEffect, useState } from 'react';
import { Camera, Check, KeyRound, Plus, Save, Shield } from 'lucide-react';
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { useApp } from '../../context/AppContext';
import { INTEREST_OPTIONS } from '../../config/brand';
import { PostItem } from '../../types/konnecta';

const COVER_COLORS = ['#1E1B4B', '#0F172A', '#1E3A8A', '#064E3B', '#4C1D95'];

export const ProfileModule: React.FC = () => {
  const { firebaseUser, publicProfile, keyBundle, showToast } = useApp();

  const [displayName, setDisplayName] = useState(publicProfile?.displayName || '');
  const [username, setUsername] = useState(publicProfile?.username || '');
  const [bio, setBio] = useState(publicProfile?.bio || '');
  const [college, setCollege] = useState(publicProfile?.college || '');
  const [coverColor, setCoverColor] = useState(publicProfile?.coverColor || '#1E1B4B');
  const [avatarUrl, setAvatarUrl] = useState(publicProfile?.avatarUrl || '');
  const [interests, setInterests] = useState<string[]>(publicProfile?.interests || []);
  const [customTopic, setCustomTopic] = useState('');
  const [profileVisibility, setProfileVisibility] = useState<'public' | 'friends' | 'private'>(
    publicProfile?.profileVisibility || 'public'
  );
  const [storyVisibility, setStoryVisibility] = useState<'friends' | 'close_friends'>(
    publicProfile?.storyVisibility || 'friends'
  );
  const [friendRequestsFrom, setFriendRequestsFrom] = useState<'everyone' | 'nobody'>(
    publicProfile?.friendRequestsFrom || 'everyone'
  );
  const [saving, setSaving] = useState(false);
  const [myPosts, setMyPosts] = useState<PostItem[]>([]);

  useEffect(() => {
    if (!publicProfile) return;
    setDisplayName(publicProfile.displayName);
    setUsername(publicProfile.username);
    setBio(publicProfile.bio || '');
    setCollege(publicProfile.college || '');
    setCoverColor(publicProfile.coverColor || '#1E1B4B');
    setAvatarUrl(publicProfile.avatarUrl || '');
    setInterests(publicProfile.interests || []);
    setProfileVisibility(publicProfile.profileVisibility);
    setStoryVisibility(publicProfile.storyVisibility);
    setFriendRequestsFrom(publicProfile.friendRequestsFrom);
  }, [publicProfile]);

  useEffect(() => {
    if (!firebaseUser) return;
    const q = query(
      collection(db, 'posts'),
      where('authorUid', '==', firebaseUser.uid),
      limit(15)
    );
    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PostItem, 'id'>) }));
        rows.sort((a, b) => {
          const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
          const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
          return tb - ta;
        });
        setMyPosts(rows);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'posts')
    );
  }, [firebaseUser]);

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 140 * 1024) {
      showToast('Image too large', 'Please select a profile photo under 140 KB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAvatarUrl(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const toggleInterest = (tag: string) => {
    setInterests((prev) =>
      prev.includes(tag)
        ? prev.filter((x) => x !== tag)
        : prev.length < 10
        ? [...prev, tag]
        : prev
    );
  };

  const addCustomTopic = () => {
    const cleaned = customTopic.trim().slice(0, 40);
    if (!cleaned || interests.length >= 10) return;
    if (!interests.some((i) => i.toLowerCase() === cleaned.toLowerCase())) {
      setInterests((prev) => [...prev, cleaned]);
    }
    setCustomTopic('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !publicProfile) return;

    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(cleanUsername)) {
      showToast('Invalid handle', 'Handle must be 3–32 lowercase letters, numbers, or underscores.', 'error');
      return;
    }
    if (!displayName.trim()) {
      showToast('Display name required', undefined, 'error');
      return;
    }

    setSaving(true);
    try {
      const batch = writeBatch(db);
      if (cleanUsername !== publicProfile.username) {
        const newRef = doc(db, 'usernames', cleanUsername);
        const snap = await getDoc(newRef);
        if (snap.exists() && snap.data().uid !== firebaseUser.uid) {
          showToast('Username taken', `@${cleanUsername} is already registered.`, 'error');
          setSaving(false);
          return;
        }
        batch.delete(doc(db, 'usernames', publicProfile.username));
        batch.set(newRef, {
          uid: firebaseUser.uid,
          username: cleanUsername,
          createdAt: serverTimestamp(),
        });
      }

      batch.update(doc(db, 'users_public', firebaseUser.uid), {
        username: cleanUsername,
        displayName: displayName.trim().slice(0, 80),
        bio: bio.trim().slice(0, 400),
        avatarUrl: avatarUrl.slice(0, 195000),
        coverColor,
        college: college.trim().slice(0, 120),
        interests,
        profileVisibility,
        storyVisibility,
        friendRequestsFrom,
        onboardingCompleted: true,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
      showToast('Profile saved', 'Public profile updated.', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users_public/${firebaseUser.uid}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Cover & Summary Card */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="h-28 w-full transition-colors" style={{ backgroundColor: coverColor }} />
        <div className="px-6 pb-6">
          <div className="flex flex-wrap items-end justify-between gap-4 -mt-10">
            <div className="flex items-end gap-4">
              <div className="relative w-20 h-20 rounded-2xl border-4 border-white dark:border-[#111827] bg-indigo-600 text-white flex items-center justify-center text-2xl font-bold overflow-hidden">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                ) : (
                  (displayName || 'K').charAt(0).toUpperCase()
                )}
                <label
                  title="Upload profile photo"
                  className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer"
                >
                  <Camera className="w-5 h-5 text-white" />
                  <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                </label>
              </div>
              <div className="pt-10">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">{displayName}</h2>
                <p className="text-xs text-slate-500">
                  @{username} {college ? `· ${college}` : ''}
                </p>
              </div>
            </div>

            {keyBundle && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F19] px-3.5 py-2 text-xs">
                <p className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
                  <KeyRound className="w-3.5 h-3.5 text-emerald-500" />
                  E2EE Identity Fingerprint
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-slate-500">{keyBundle.fingerprint}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Form */}
      <form
        onSubmit={handleSave}
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-5"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Public Identity &amp; Privacy Controls
          </h3>
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
            <Shield className="w-3.5 h-3.5 text-emerald-500" />
            Email stays private in owner-only storage
          </span>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Display Name
            </label>
            <input
              type="text"
              required
              maxLength={80}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Handle
            </label>
            <input
              type="text"
              required
              maxLength={32}
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
            School, Team, or City (Optional)
          </label>
          <input
            type="text"
            maxLength={120}
            value={college}
            onChange={(e) => setCollege(e.target.value)}
            placeholder="City, study group, or workspace"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
            Bio
          </label>
          <textarea
            rows={3}
            maxLength={400}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
            Banner Color
          </label>
          <div className="flex items-center gap-2">
            {COVER_COLORS.map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => setCoverColor(hex)}
                aria-label={`Select banner color ${hex}`}
                className={`w-8 h-8 rounded-lg border-2 cursor-pointer ${
                  coverColor === hex ? 'border-indigo-500 scale-105' : 'border-transparent'
                }`}
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
            Interests &amp; Study Topics ({interests.length}/10)
          </label>
          <div className="flex gap-2 mb-2.5">
            <input
              type="text"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCustomTopic();
                }
              }}
              maxLength={40}
              placeholder="Add any custom topic..."
              className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5 text-xs"
            />
            <button
              type="button"
              onClick={addCustomTopic}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:border-indigo-500 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {Array.from(new Set([...INTEREST_OPTIONS, ...interests])).map((tag) => {
              const active = interests.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleInterest(tag)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border cursor-pointer ${
                    active
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {active && <Check className="w-3 h-3" />}
                  {tag}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Profile Visibility
            </label>
            <select
              aria-label="Profile visibility"
              value={profileVisibility}
              onChange={(e) => setProfileVisibility(e.target.value as 'public' | 'friends' | 'private')}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] px-3 py-2 text-xs"
            >
              <option value="public">Public</option>
              <option value="friends">Friends Only</option>
              <option value="private">Private</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Default Story Audience
            </label>
            <select
              aria-label="Story audience"
              value={storyVisibility}
              onChange={(e) => setStoryVisibility(e.target.value as 'friends' | 'close_friends')}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] px-3 py-2 text-xs"
            >
              <option value="friends">All Friends</option>
              <option value="close_friends">Close Friends</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Friend Requests
            </label>
            <select
              aria-label="Friend requests policy"
              value={friendRequestsFrom}
              onChange={(e) => setFriendRequestsFrom(e.target.value as 'everyone' | 'nobody')}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] px-3 py-2 text-xs"
            >
              <option value="everyone">Everyone</option>
              <option value="nobody">Nobody</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold disabled:opacity-60 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      </form>

      {/* User's Recent Posts */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          Your Recent Posts ({myPosts.length})
        </h3>
        {myPosts.length === 0 ? (
          <p className="text-xs text-slate-500">No posts published yet.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {myPosts.map((p) => (
              <div key={p.id} className="py-3">
                <p className="text-xs text-slate-500 capitalize">
                  {p.kind} · {p.visibility} · {p.likesCount} likes · {p.commentsCount} comments
                </p>
                <p className="mt-1 text-sm text-slate-800 dark:text-slate-200 line-clamp-2">
                  {p.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
