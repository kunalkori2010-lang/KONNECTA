import React, { useEffect, useMemo, useState } from 'react';
import {
  Heart,
  MessageCircle,
  Bookmark,
  Flag,
  Trash2,
  Edit3,
  Image as ImageIcon,
  Send,
  Sparkles,
  Plus,
  Eye,
  ChevronLeft,
  ChevronRight,
  X,
  Contact,
  Upload,
  Link2,
  UserPlus,
  Share2,
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
import {
  LocalContact,
  NavigatorWithContacts,
  loadLocalContacts,
  mergeUniqueContacts,
  parseContactsText,
  saveLocalContacts,
} from '../../lib/contacts';
import { useApp } from '../../context/AppContext';
import { AppTab, PostItem, StoryItem, UserPublic } from '../../types/konnecta';

interface CommentRow {
  id: string;
  postId: string;
  authorUid: string;
  authorName: string;
  content: string;
}

function formatStoryRemaining(expiresAtMs: number): string {
  const diff = Math.max(0, expiresAtMs - Date.now());
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m left`;
  return `${Math.floor(mins / 60)}h left`;
}

export const HomeFeedModule: React.FC<{ onNavigate: (tab: AppTab) => void }> = ({ onNavigate }) => {
  const { firebaseUser, publicProfile, showToast } = useApp();
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [viewerStory, setViewerStory] = useState<StoryItem | null>(null);
  const [filterKind, setFilterKind] = useState<'all' | 'post' | 'moment'>('all');

  // Quick Add from Contacts right on entry
  const [localContacts, setLocalContacts] = useState<LocalContact[]>([]);
  const [directory, setDirectory] = useState<UserPublic[]>([]);
  const [friendUids, setFriendUids] = useState<Set<string>>(new Set());
  const [pendingOutUids, setPendingOutUids] = useState<Set<string>>(new Set());
  const [showQuickContactForm, setShowQuickContactForm] = useState(false);
  const [quickContactName, setQuickContactName] = useState('');
  const [quickContactInfo, setQuickContactInfo] = useState('');

  const [content, setContent] = useState('');
  const [kind, setKind] = useState<'post' | 'moment'>('post');
  const [visibility, setVisibility] = useState<'public' | 'friends'>('public');
  const [mediaDataUrl, setMediaDataUrl] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [posting, setPosting] = useState(false);

  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentText, setCommentText] = useState('');
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  useEffect(() => {
    if (!firebaseUser) return;
    setLocalContacts(loadLocalContacts(firebaseUser.uid));
  }, [firebaseUser]);

  useEffect(() => {
    if (!firebaseUser) return;
    const q = query(
      collection(db, 'posts'),
      where('visibility', 'in', ['public', 'friends']),
      limit(50)
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
        setPosts(rows);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'posts')
    );
  }, [firebaseUser]);

  useEffect(() => {
    if (!firebaseUser) return;
    const q = query(
      collection(db, 'stories'),
      where('visibility', 'in', ['friends', 'close_friends']),
      limit(20)
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

  // Directory + friendship status for instant Home Feed "Add from Contacts" matching
  useEffect(() => {
    if (!firebaseUser) return;
    const uq = query(
      collection(db, 'users_public'),
      where('profileVisibility', 'in', ['public', 'friends']),
      limit(60)
    );
    const unsubUsers = onSnapshot(
      uq,
      (snap) => {
        setDirectory(
          snap.docs
            .map((d) => d.data() as UserPublic)
            .filter((u) => u.uid !== firebaseUser.uid)
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'users_public')
    );

    const frQ = query(
      collection(db, 'friendships'),
      where('uids', 'array-contains', firebaseUser.uid)
    );
    const unsubFr = onSnapshot(frQ, (snap) => {
      const uids = new Set<string>();
      for (const d of snap.docs) {
        const data = d.data() as { uid1: string; uid2: string };
        uids.add(data.uid1 === firebaseUser.uid ? data.uid2 : data.uid1);
      }
      setFriendUids(uids);
    });

    const outQ = query(
      collection(db, 'friend_requests'),
      where('fromUid', '==', firebaseUser.uid),
      where('status', '==', 'pending')
    );
    const unsubOut = onSnapshot(outQ, (snap) => {
      setPendingOutUids(new Set(snap.docs.map((d) => (d.data() as { toUid: string }).toUid)));
    });

    return () => {
      unsubUsers();
      unsubFr();
      unsubOut();
    };
  }, [firebaseUser]);

  useEffect(() => {
    if (!expandedPostId) {
      setComments([]);
      return;
    }
    const q = query(
      collection(db, 'posts', expandedPostId, 'comments'),
      where('postId', '==', expandedPostId),
      limit(40)
    );
    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CommentRow, 'id'>) }));
        setComments(rows);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `posts/${expandedPostId}/comments`)
    );
  }, [expandedPostId]);

  const inviteUrl = `${window.location.origin}/?invite=${encodeURIComponent(
    publicProfile?.username || 'member'
  )}`;

  const handleQuickDeviceContacts = async () => {
    if (!firebaseUser) return;
    const nav = navigator as NavigatorWithContacts;
    if (!nav.contacts || typeof nav.contacts.select !== 'function') {
      setShowQuickContactForm(true);
      showToast('Quick Add opened', 'Enter a name or import a .vcf / .csv file.', 'info');
      return;
    }
    try {
      const picked = await nav.contacts.select(['name', 'email', 'tel'], { multiple: true });
      const additions: LocalContact[] = [];
      for (const item of picked) {
        const name = item.name?.[0]?.trim() || '';
        const info = item.email?.[0]?.trim() || item.tel?.[0]?.trim() || '';
        if (name || info) {
          additions.push({
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: name || info,
            contactInfo: info,
            source: 'device',
          });
        }
      }
      if (additions.length > 0) {
        const { merged, addedCount } = mergeUniqueContacts(localContacts, additions);
        setLocalContacts(saveLocalContacts(firebaseUser.uid, merged));
        showToast('Contacts added', `${addedCount} contact${addedCount === 1 ? '' : 's'} ready.`, 'success');
      }
    } catch {
      showToast('Import cancelled', 'No contacts selected.', 'info');
    }
  };

  const handleQuickFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !firebaseUser) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseContactsText(String(reader.result || ''), file.name);
      if (parsed.length === 0) {
        showToast('No contacts found', 'Check that the .vcf or .csv file has names or emails.', 'info');
        return;
      }
      const additions: LocalContact[] = parsed.map((p, idx) => ({ ...p, id: `${Date.now()}_${idx}` }));
      const { merged, addedCount } = mergeUniqueContacts(localContacts, additions);
      setLocalContacts(saveLocalContacts(firebaseUser.uid, merged));
      showToast('Contacts imported', `Added ${addedCount} contact${addedCount === 1 ? '' : 's'}.`, 'success');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleQuickManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || (!quickContactName.trim() && !quickContactInfo.trim())) return;
    const entry: LocalContact = {
      id: `${Date.now()}`,
      name: (quickContactName.trim() || quickContactInfo.trim()).slice(0, 80),
      contactInfo: quickContactInfo.trim().slice(0, 120),
      source: 'manual',
    };
    setLocalContacts(saveLocalContacts(firebaseUser.uid, [entry, ...localContacts]));
    setQuickContactName('');
    setQuickContactInfo('');
    setShowQuickContactForm(false);
    showToast('Contact saved', 'Checking for matches on KONNECTA.', 'success');
  };

  const handleQuickInvite = async (name?: string) => {
    const msg = name
      ? `Hey ${name}, join me on KONNECTA: ${inviteUrl}`
      : `Connect with me on KONNECTA: ${inviteUrl}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join me on KONNECTA', text: msg, url: inviteUrl });
        return;
      } catch {
        // Clipboard fallback
      }
    }
    try {
      await navigator.clipboard.writeText(msg);
      showToast('Invite copied', 'Share link copied to clipboard.', 'success');
    } catch {
      showToast('Invite link', inviteUrl, 'info');
    }
  };

  const sendQuickFriendRequest = async (target: UserPublic) => {
    if (!firebaseUser) return;
    if (target.friendRequestsFrom === 'nobody') {
      showToast('Requests restricted', `@${target.username} does not accept requests.`, 'info');
      return;
    }
    try {
      await addDoc(collection(db, 'friend_requests'), {
        fromUid: firebaseUser.uid,
        fromName: publicProfile?.displayName || 'Member',
        fromUsername: publicProfile?.username || 'member',
        toUid: target.uid,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showToast('Request sent', `Sent friend request to ${target.displayName}.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'friend_requests');
    }
  };

  const quickMatchedContacts = useMemo(() => {
    return localContacts.slice(0, 4).map((contact) => {
      const nameLower = contact.name.toLowerCase();
      const infoHandle = contact.contactInfo.replace(/^@/, '').split('@')[0].toLowerCase();
      const match = directory.find((u) => {
        const dn = u.displayName.toLowerCase();
        const un = u.username.toLowerCase();
        if (nameLower && (dn === nameLower || un === nameLower.replace(/^@/, ''))) return true;
        if (infoHandle && infoHandle.length >= 3 && (un === infoHandle || dn.includes(infoHandle))) return true;
        return false;
      });
      return { contact, match };
    });
  }, [localContacts, directory]);

  const openStoryViewer = async (story: StoryItem) => {
    setViewerStory(story);
    if (firebaseUser && !story.viewerUids?.includes(firebaseUser.uid)) {
      const nextViewers = [...(story.viewerUids || []), firebaseUser.uid].slice(0, 200);
      await updateDoc(doc(db, 'stories', story.id), { viewerUids: nextViewers });
    }
  };

  const stepViewerStory = (delta: number) => {
    if (!viewerStory || stories.length <= 1) return;
    const idx = stories.findIndex((s) => s.id === viewerStory.id);
    if (idx === -1) return;
    const nextIdx = (idx + delta + stories.length) % stories.length;
    openStoryViewer(stories[nextIdx]);
  };

  const handleImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 300 * 1024) {
      showToast('Image too large', 'Please select an image under 300 KB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setMediaDataUrl(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !content.trim()) return;
    setPosting(true);
    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 10);

      await addDoc(collection(db, 'posts'), {
        authorUid: firebaseUser.uid,
        authorName: publicProfile?.displayName || firebaseUser.displayName || 'Member',
        authorUsername: publicProfile?.username || 'member',
        content: content.trim().slice(0, 3000),
        mediaDataUrl,
        kind,
        visibility,
        tags,
        likesCount: 0,
        commentsCount: 0,
        likedBy: [],
        edited: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setContent('');
      setMediaDataUrl('');
      setTagsInput('');
      showToast(kind === 'moment' ? 'Moment shared' : 'Post published', undefined, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'posts');
    } finally {
      setPosting(false);
    }
  };

  const toggleLike = async (post: PostItem) => {
    if (!firebaseUser) return;
    const likedBy = post.likedBy || [];
    const hasLiked = likedBy.includes(firebaseUser.uid);
    const nextLikedBy = hasLiked
      ? likedBy.filter((u) => u !== firebaseUser.uid)
      : [...likedBy, firebaseUser.uid].slice(0, 200);
    await updateDoc(doc(db, 'posts', post.id), {
      likedBy: nextLikedBy,
      likesCount: nextLikedBy.length,
      updatedAt: serverTimestamp(),
    });
  };

  const handleAddComment = async (post: PostItem) => {
    if (!firebaseUser || !commentText.trim()) return;
    await addDoc(collection(db, 'posts', post.id, 'comments'), {
      postId: post.id,
      authorUid: firebaseUser.uid,
      authorName: publicProfile?.displayName || 'Member',
      content: commentText.trim().slice(0, 1000),
      createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'posts', post.id), {
      commentsCount: (post.commentsCount || 0) + 1,
      updatedAt: serverTimestamp(),
    });
    setCommentText('');
  };

  const handleBookmark = async (post: PostItem) => {
    if (!firebaseUser) return;
    await addDoc(collection(db, 'bookmarks'), {
      ownerUid: firebaseUser.uid,
      targetType: 'post',
      targetId: post.id,
      title: `Post by ${post.authorName}`,
      snippet: post.content.slice(0, 200),
      createdAt: serverTimestamp(),
    });
    showToast('Saved', 'Added to your bookmarks.', 'success');
  };

  const handleReportPost = async (post: PostItem) => {
    if (!firebaseUser) return;
    await addDoc(collection(db, 'reports'), {
      reporterUid: firebaseUser.uid,
      targetType: 'post',
      targetId: post.id,
      reason: 'Reported from Home Feed',
      submittedEvidence: post.content.slice(0, 500),
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    showToast('Reported', 'Post submitted to the moderation review queue.', 'info');
  };

  const visiblePosts =
    filterKind === 'all' ? posts : posts.filter((p) => p.kind === filterKind);
  const firstName = (publicProfile?.displayName || firebaseUser?.displayName || 'friend').split(' ')[0];

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Circular Avatar Stories Strip */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0E1320] px-3.5 sm:px-5 py-3.5 sm:py-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Stories
          </h2>
          <button
            type="button"
            onClick={() => onNavigate('stories')}
            className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
          >
            Stories Studio
          </button>
        </div>

        <div className="flex items-center gap-5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => onNavigate('stories')}
            className="shrink-0 flex flex-col items-center gap-1.5 group cursor-pointer"
          >
            <div className="relative p-0.5 rounded-full border-2 border-dashed border-indigo-500/70 group-hover:border-indigo-400 transition-colors">
              <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-[#141B2D] flex items-center justify-center overflow-hidden text-sm font-bold text-slate-700 dark:text-slate-200">
                {publicProfile?.avatarUrl ? (
                  <img
                    src={publicProfile.avatarUrl}
                    alt="Your Story"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  firstName.charAt(0).toUpperCase()
                )}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center ring-2 ring-white dark:ring-[#0E1320]">
                <Plus className="w-3 h-3" />
              </span>
            </div>
            <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 max-w-[64px] truncate">
              Your Story
            </span>
          </button>

          {stories.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => openStoryViewer(s)}
              title={`${s.authorName} · ${formatStoryRemaining(s.expiresAtMs)}`}
              className="shrink-0 flex flex-col items-center gap-1.5 group cursor-pointer"
            >
              <div className="p-[2.5px] rounded-full bg-gradient-to-tr from-indigo-500 via-violet-500 to-rose-500 group-hover:scale-105 transition-transform duration-150">
                <div className="w-14 h-14 rounded-full bg-white dark:bg-[#0E1320] p-0.5">
                  <div className="w-full h-full rounded-full bg-indigo-600/15 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-200 flex items-center justify-center text-sm font-bold">
                    {s.authorName.slice(0, 1).toUpperCase()}
                  </div>
                </div>
              </div>
              <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 max-w-[68px] truncate">
                {s.authorName.split(' ')[0]}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Instant Add from Contacts Bar right on Entry */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0E1320] px-3.5 sm:px-5 py-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Contact className="w-4 h-4 text-indigo-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900 dark:text-white">
                Add People from Contacts
              </p>
              <p className="text-[11px] text-slate-500 truncate">
                1-tap import from device, .vcf/.csv file, or share invite link
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleQuickDeviceContacts}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer"
            >
              <Contact className="w-3.5 h-3.5" />
              Contacts
            </button>
            <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              .vcf / .csv
              <input
                type="file"
                accept=".vcf,.csv,.txt,text/vcard,text/csv"
                onChange={handleQuickFileImport}
                className="hidden"
              />
            </label>
            <button
              type="button"
              onClick={() => setShowQuickContactForm((v) => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Quick Add
            </button>
            <button
              type="button"
              onClick={() => handleQuickInvite()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Link2 className="w-3.5 h-3.5" />
              Invite Link
            </button>
          </div>
        </div>

        {showQuickContactForm && (
          <form
            onSubmit={handleQuickManualAdd}
            className="grid sm:grid-cols-12 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80"
          >
            <input
              type="text"
              required
              value={quickContactName}
              onChange={(e) => setQuickContactName(e.target.value)}
              placeholder="Friend's Name"
              className="sm:col-span-5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#090C15] px-3 py-1.5 text-xs"
            />
            <input
              type="text"
              value={quickContactInfo}
              onChange={(e) => setQuickContactInfo(e.target.value)}
              placeholder="Phone, email, or @handle"
              className="sm:col-span-5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#090C15] px-3 py-1.5 text-xs"
            />
            <button
              type="submit"
              className="sm:col-span-2 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold cursor-pointer"
            >
              Add
            </button>
          </form>
        )}

        {quickMatchedContacts.length > 0 && (
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 flex-1">
              {quickMatchedContacts.map(({ contact, match }) => {
                const isFriend = match ? friendUids.has(match.uid) : false;
                const isPending = match ? pendingOutUids.has(match.uid) : false;
                return (
                  <div
                    key={contact.id}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090C15] px-2.5 py-1.5 text-xs"
                  >
                    <span className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[120px]">
                      {contact.name}
                    </span>
                    {match ? (
                      isFriend ? (
                        <span className="text-[11px] text-emerald-600 dark:text-emerald-400">Friends</span>
                      ) : isPending ? (
                        <span className="text-[11px] text-slate-400">Pending</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => sendQuickFriendRequest(match)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[11px] font-semibold cursor-pointer"
                        >
                          <UserPlus className="w-3 h-3" />
                          Add
                        </button>
                      )
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleQuickInvite(contact.name)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 text-[11px] cursor-pointer"
                      >
                        <Share2 className="w-3 h-3" />
                        Invite
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => onNavigate('friends')}
              className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline shrink-0 cursor-pointer"
            >
              All Contacts ({localContacts.length}) →
            </button>
          </div>
        )}
      </section>

      {/* Post & Moments Composer */}
      <form
        onSubmit={handleCreatePost}
        className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0E1320] p-3.5 sm:p-5 space-y-3.5"
      >
        <div className="flex items-start gap-3.5">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center text-xs font-bold shrink-0 overflow-hidden mt-0.5">
            {publicProfile?.avatarUrl ? (
              <img
                src={publicProfile.avatarUrl}
                alt={publicProfile.displayName}
                className="w-full h-full object-cover"
              />
            ) : (
              firstName.charAt(0).toUpperCase()
            )}
          </div>

          <div className="flex-1 min-w-0 space-y-2.5">
            <textarea
              rows={2}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={3000}
              placeholder={
                kind === 'moment'
                  ? `Share a moment or highlight, ${firstName}...`
                  : `What's on your mind, ${firstName}?`
              }
              className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090C15] px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/70 resize-y"
            />
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="Add tags separated by comma (e.g. Math, Photography, Notes)"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090C15] px-3.5 py-2 text-xs text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {mediaDataUrl && (
          <div className="relative inline-block pl-0 sm:pl-12">
            <img src={mediaDataUrl} alt="Upload preview" className="max-h-48 rounded-xl border border-slate-200 dark:border-slate-800" />
            <button
              type="button"
              onClick={() => setMediaDataUrl('')}
              className="mt-1.5 text-xs text-red-500 hover:underline block cursor-pointer"
            >
              Remove image
            </button>
          </div>
        )}

        <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-[#090C15] rounded-lg border border-slate-200 dark:border-slate-800">
              {(['post', 'moment'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize cursor-pointer ${
                    kind === k
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-500'
                  }`}
                >
                  {k === 'moment' ? 'Moment' : 'Post'}
                </button>
              ))}
            </div>

            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70 cursor-pointer">
              <ImageIcon className="w-3.5 h-3.5 text-indigo-500" />
              Photo
              <input type="file" accept="image/*" onChange={handleImagePick} className="hidden" />
            </label>

            <select
              aria-label="Post visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'public' | 'friends')}
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-transparent px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300"
            >
              <option value="public">Public</option>
              <option value="friends">Friends Only</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={posting || !content.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white text-xs font-semibold shadow-sm shadow-indigo-500/20 transition-all cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            {posting ? 'Publishing...' : 'Publish Post'}
          </button>
        </div>
      </form>

      {/* Filter Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#0E1320] border border-slate-200 dark:border-slate-800/80 rounded-xl">
          {(['all', 'post', 'moment'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilterKind(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize cursor-pointer ${
                filterKind === f
                  ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {f === 'all' ? 'All Feed' : f === 'moment' ? 'Moments' : 'Posts'}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500 tabular-nums">{visiblePosts.length} items</span>
      </div>

      {/* Feed Stream */}
      {visiblePosts.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0E1320] p-12 text-center">
          <Sparkles className="w-8 h-8 text-indigo-500 mx-auto mb-2" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Your feed is quiet</h3>
          <p className="mt-1 text-xs text-slate-500">
            Publish your first post above, or add friends from your contacts.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visiblePosts.map((post) => {
            const isMine = post.authorUid === firebaseUser?.uid;
            const liked = post.likedBy?.includes(firebaseUser?.uid || '');
            return (
              <article
                key={post.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0E1320] p-3.5 sm:p-5 space-y-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-indigo-600/15 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-200 flex items-center justify-center text-xs font-bold shrink-0">
                      {post.authorName.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {post.authorName}
                      </p>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 truncate">
                        {post.authorUsername && <span>@{post.authorUsername}</span>}
                        <span aria-hidden="true">·</span>
                        <span className="capitalize">{post.kind}</span>
                        <span aria-hidden="true">·</span>
                        <span className="capitalize">{post.visibility}</span>
                        {post.edited && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Edited</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 text-slate-400 shrink-0">
                    {isMine ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingPostId(post.id);
                            setEditContent(post.content);
                          }}
                          title="Edit post"
                          className="p-1.5 hover:text-indigo-500 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteDoc(doc(db, 'posts', post.id))}
                          title="Delete post"
                          className="p-1.5 hover:text-red-500 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleReportPost(post)}
                        title="Report post"
                        className="p-1.5 hover:text-red-500 cursor-pointer"
                      >
                        <Flag className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {editingPostId === post.id ? (
                  <div className="space-y-2">
                    <textarea
                      rows={3}
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          await updateDoc(doc(db, 'posts', post.id), {
                            content: editContent.trim(),
                            edited: true,
                            updatedAt: serverTimestamp(),
                          });
                          setEditingPostId(null);
                        }}
                        className="px-3 py-1 rounded-md bg-indigo-600 text-white text-xs font-medium cursor-pointer"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingPostId(null)}
                        className="px-3 py-1 text-xs text-slate-500 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                    {post.content}
                  </p>
                )}

                {post.mediaDataUrl && (
                  <img
                    src={post.mediaDataUrl}
                    alt="Post attachment"
                    className="w-full max-h-[420px] rounded-xl border border-slate-200 dark:border-slate-800 object-cover"
                  />
                )}

                {post.tags && post.tags.length > 0 && (
                  <p className="text-xs text-slate-500">{post.tags.join(' · ')}</p>
                )}

                <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-4 sm:gap-6 text-xs text-slate-500">
                  <button
                    type="button"
                    onClick={() => toggleLike(post)}
                    className={`inline-flex items-center gap-1.5 cursor-pointer ${
                      liked ? 'text-rose-500 font-semibold' : 'hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${liked ? 'fill-current' : ''}`} />
                    <span className="tabular-nums">{post.likesCount}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExpandedPostId(expandedPostId === post.id ? null : post.id)}
                    className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span className="tabular-nums">{post.commentsCount}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleBookmark(post)}
                    className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                  >
                    <Bookmark className="w-4 h-4" />
                    Save
                  </button>
                </div>

                {expandedPostId === post.id && (
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-3">
                    {comments.map((c) => (
                      <div key={c.id} className="text-xs flex items-start justify-between gap-2">
                        <div>
                          <span className="font-semibold text-slate-900 dark:text-white mr-1.5">
                            {c.authorName}
                          </span>
                          <span className="text-slate-700 dark:text-slate-300">{c.content}</span>
                        </div>
                        {c.authorUid === firebaseUser?.uid && (
                          <button
                            type="button"
                            onClick={() => deleteDoc(doc(db, 'posts', post.id, 'comments', c.id))}
                            className="text-slate-400 hover:text-red-500"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder="Write a comment..."
                        className="flex-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-transparent px-3 py-1.5 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddComment(post)}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium cursor-pointer"
                      >
                        Reply
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Inline Story Viewer Modal */}
      {viewerStory && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-4"
          onClick={() => setViewerStory(null)}
        >
          <div
            className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-slate-950 text-white border border-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 flex items-center justify-between text-xs border-b border-slate-800">
              <span>
                {viewerStory.authorName} · {formatStoryRemaining(viewerStory.expiresAtMs)}
              </span>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 text-slate-400">
                  <Eye className="w-3.5 h-3.5" />
                  {viewerStory.viewerUids?.length || 1}
                </span>
                <button
                  type="button"
                  onClick={() => setViewerStory(null)}
                  aria-label="Close story viewer"
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="relative">
              {viewerStory.type === 'text' ? (
                <div
                  className={`h-80 p-10 flex items-center justify-center text-center ${
                    viewerStory.bgStyle || 'bg-gradient-to-br from-indigo-600 to-blue-700 text-white'
                  }`}
                >
                  <p className="text-lg font-semibold max-w-sm">{viewerStory.text}</p>
                </div>
              ) : (
                <div className="relative h-80 flex items-center justify-center bg-black">
                  <img src={viewerStory.mediaDataUrl} alt="Story" className="max-h-full object-contain" />
                  {viewerStory.text && (
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-4 text-sm text-center">
                      {viewerStory.text}
                    </div>
                  )}
                </div>
              )}

              {stories.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => stepViewerStory(-1)}
                    aria-label="Previous story"
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 hover:bg-black/75 text-white cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => stepViewerStory(1)}
                    aria-label="Next story"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 hover:bg-black/75 text-white cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>

            <div className="px-4 py-3 flex items-center justify-between border-t border-slate-800 text-xs">
              <span className="text-slate-400">
                {viewerStory.visibility === 'close_friends' ? 'Close Friends' : 'Friends'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setViewerStory(null);
                  onNavigate('stories');
                }}
                className="text-indigo-400 hover:underline font-medium cursor-pointer"
              >
                Open Stories Studio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
