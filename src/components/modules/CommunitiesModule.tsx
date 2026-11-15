import React, { useEffect, useState } from 'react';
import { Plus, QrCode, Users, Hash, Send, Check, X, Flag } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
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
import { CommunityItem } from '../../types/konnecta';

interface ChannelDoc {
  id: string;
  communityId: string;
  name: string;
  type: 'text' | 'study' | 'resource' | 'event' | 'announcement';
  description?: string;
}

interface ChannelPostDoc {
  id: string;
  senderUid: string;
  senderName: string;
  content: string;
}

export const CommunitiesModule: React.FC = () => {
  const { firebaseUser, publicProfile, showToast } = useApp();
  const [communities, setCommunities] = useState<CommunityItem[]>([]);
  const [selectedComm, setSelectedComm] = useState<CommunityItem | null>(null);
  const [channels, setChannels] = useState<ChannelDoc[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<ChannelDoc | null>(null);
  const [channelPosts, setChannelPosts] = useState<ChannelPostDoc[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newRules, setNewRules] = useState('Be respectful. Share verified citations. No spam.');
  const [newCat, setNewCat] = useState('Computer Science');
  const [newVis, setNewVis] = useState<'public' | 'private'>('public');

  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelType, setNewChannelType] = useState<ChannelDoc['type']>('study');
  const [postDraft, setPostDraft] = useState('');

  useEffect(() => {
    if (!firebaseUser) return;
    let pubList: CommunityItem[] = [];
    let mineList: CommunityItem[] = [];

    const mergeAndSet = () => {
      const mergedMap = new Map<string, CommunityItem>();
      for (const c of [...pubList, ...mineList]) mergedMap.set(c.id, c);
      const list = Array.from(mergedMap.values());
      list.sort((a, b) => {
        const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
        const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
        return tb - ta;
      });
      setCommunities(list);
      if (selectedComm) {
        const updated = list.find((x) => x.id === selectedComm.id);
        if (updated) setSelectedComm(updated);
      }
    };

    const qPub = query(collection(db, 'communities'), where('visibility', '==', 'public'), limit(40));
    const qMine = query(
      collection(db, 'communities'),
      where('memberUids', 'array-contains', firebaseUser.uid),
      limit(40)
    );

    const unsubPub = onSnapshot(
      qPub,
      (snap) => {
        pubList = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CommunityItem, 'id'>) }));
        mergeAndSet();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'communities')
    );

    const unsubMine = onSnapshot(
      qMine,
      (snap) => {
        mineList = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CommunityItem, 'id'>) }));
        mergeAndSet();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'communities')
    );

    return () => {
      unsubPub();
      unsubMine();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser]);

  useEffect(() => {
    if (!selectedComm || !firebaseUser) {
      setChannels([]);
      setSelectedChannel(null);
      return;
    }
    const q = query(
      collection(db, 'communities', selectedComm.id, 'channels'),
      where('communityId', '==', selectedComm.id),
      selectedComm.visibility === 'public'
        ? where('visibility', '==', 'public')
        : where('memberUids', 'array-contains', firebaseUser.uid)
    );
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ChannelDoc, 'id'>) }));
        setChannels(list);
        if (list.length > 0 && !selectedChannel) setSelectedChannel(list[0]);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `communities/${selectedComm.id}/channels`)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedComm?.id, selectedComm?.visibility, firebaseUser]);

  useEffect(() => {
    if (!selectedComm || !selectedChannel || !firebaseUser) {
      setChannelPosts([]);
      return;
    }
    const isMember = selectedComm.memberUids.includes(firebaseUser.uid);
    if (!isMember) {
      setChannelPosts([]);
      return;
    }
    const q = query(
      collection(db, 'communities', selectedComm.id, 'channels', selectedChannel.id, 'posts'),
      where('channelId', '==', selectedChannel.id),
      selectedComm.visibility === 'public'
        ? where('visibility', '==', 'public')
        : where('memberUids', 'array-contains', firebaseUser.uid),
      limit(60)
    );
    return onSnapshot(
      q,
      (snap) => {
        setChannelPosts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ChannelPostDoc, 'id'>) })));
      },
      (err) =>
        handleFirestoreError(
          err,
          OperationType.LIST,
          `communities/${selectedComm.id}/channels/${selectedChannel.id}/posts`
        )
    );
  }, [selectedComm, selectedChannel, firebaseUser]);

  const handleCreateCommunity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !newName.trim()) return;
    const inviteCode = crypto.randomUUID().slice(0, 8).toUpperCase();
    const commRef = await addDoc(collection(db, 'communities'), {
      name: newName.trim().slice(0, 80),
      description: newDesc.trim().slice(0, 500) || 'Collaborative KONNECTA community',
      rules: newRules.trim().slice(0, 1500),
      category: newCat,
      visibility: newVis,
      creatorUid: firebaseUser.uid,
      memberUids: [firebaseUser.uid],
      adminUids: [firebaseUser.uid],
      pendingUids: [],
      inviteCode,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await addDoc(collection(db, 'communities', commRef.id, 'channels'), {
      communityId: commRef.id,
      name: 'general-study',
      type: 'study',
      visibility: newVis,
      memberUids: [firebaseUser.uid],
      createdBy: firebaseUser.uid,
      createdAt: serverTimestamp(),
    });
    setNewName('');
    setNewDesc('');
    setShowCreate(false);
    showToast('Community created', undefined, 'success');
  };

  const handleJoinOrRequest = async (c: CommunityItem) => {
    if (!firebaseUser) return;
    if (c.visibility === 'public') {
      await updateDoc(doc(db, 'communities', c.id), {
        memberUids: Array.from(new Set([...c.memberUids, firebaseUser.uid])),
        updatedAt: serverTimestamp(),
      });
      showToast('Joined community', `Welcome to ${c.name}.`, 'success');
    } else {
      await updateDoc(doc(db, 'communities', c.id), {
        pendingUids: Array.from(new Set([...(c.pendingUids || []), firebaseUser.uid])),
        updatedAt: serverTimestamp(),
      });
      showToast('Request sent', 'A community admin will review your request.', 'info');
    }
  };

  const handleCreateChannel = async () => {
    if (!firebaseUser || !selectedComm || !newChannelName.trim()) return;
    await addDoc(collection(db, 'communities', selectedComm.id, 'channels'), {
      communityId: selectedComm.id,
      name: newChannelName.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 64),
      type: newChannelType,
      visibility: selectedComm.visibility,
      memberUids: selectedComm.memberUids,
      createdBy: firebaseUser.uid,
      createdAt: serverTimestamp(),
    });
    setNewChannelName('');
  };

  const handleSendChannelPost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !selectedComm || !selectedChannel || !postDraft.trim()) return;
    await addDoc(
      collection(db, 'communities', selectedComm.id, 'channels', selectedChannel.id, 'posts'),
      {
        communityId: selectedComm.id,
        channelId: selectedChannel.id,
        senderUid: firebaseUser.uid,
        senderName: publicProfile?.displayName || 'Member',
        content: postDraft.trim().slice(0, 2000),
        visibility: selectedComm.visibility,
        memberUids: selectedComm.memberUids,
        createdAt: serverTimestamp(),
      }
    );
    setPostDraft('');
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Communities</h2>
          <p className="text-xs text-slate-500">
            Role-based channels, study groups, and QR invite spaces
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          Create Community
        </button>
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Community Directory */}
        <div className="lg:col-span-4 space-y-3">
          {communities.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 text-center text-xs text-slate-500">
              No communities created yet. Launch the first study or interest community!
            </div>
          ) : (
            communities.map((c) => {
              const isMember = c.memberUids.includes(firebaseUser?.uid || '');
              return (
                <div
                  key={c.id}
                  onClick={() => {
                    setSelectedComm(c);
                    setSelectedChannel(null);
                  }}
                  className={`rounded-2xl border p-4 cursor-pointer transition-colors ${
                    selectedComm?.id === c.id
                      ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{c.name}</h3>
                    <span className="text-[11px] text-slate-500 capitalize">{c.visibility}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                    {c.description}
                  </p>
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                    <span>
                      {c.category} · {c.memberUids.length} members
                    </span>
                    {!isMember && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleJoinOrRequest(c);
                        }}
                        className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline"
                      >
                        {c.visibility === 'public' ? 'Join' : 'Request'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Community Workspace */}
        <div className="lg:col-span-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] min-h-[480px] flex flex-col">
          {!selectedComm ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-xs text-slate-500">
              <Users className="w-8 h-8 text-indigo-500 mb-2" />
              Select a community to view channels, rules, and discussions.
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    {selectedComm.name}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Code: <span className="font-mono">{selectedComm.inviteCode}</span> · Rules:{' '}
                    {selectedComm.rules || 'Standard KONNECTA conduct'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowQr(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    QR Invite
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await addDoc(collection(db, 'reports'), {
                        reporterUid: firebaseUser!.uid,
                        targetType: 'community',
                        targetId: selectedComm.id,
                        reason: 'Community safety review requested',
                        status: 'pending',
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                      });
                      showToast('Reported', 'Community flagged for moderation review.', 'info');
                    }}
                    className="p-1.5 text-slate-400 hover:text-red-500 cursor-pointer"
                    title="Report Community"
                  >
                    <Flag className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Channels Strip */}
              <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
                {channels.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => setSelectedChannel(ch)}
                    className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium cursor-pointer ${
                      selectedChannel?.id === ch.id
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Hash className="w-3 h-3" />
                    {ch.name}
                  </button>
                ))}
                {selectedComm.adminUids.includes(firebaseUser?.uid || '') && (
                  <div className="flex items-center gap-1 ml-auto">
                    <input
                      type="text"
                      value={newChannelName}
                      onChange={(e) => setNewChannelName(e.target.value)}
                      placeholder="New channel"
                      className="w-28 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2 py-1 text-xs"
                    />
                    <select
                      aria-label="Channel type"
                      value={newChannelType}
                      onChange={(e) => setNewChannelType(e.target.value as ChannelDoc['type'])}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-1.5 py-1 text-xs"
                    >
                      <option value="text">text</option>
                      <option value="study">study</option>
                      <option value="resource">resource</option>
                      <option value="announcement">announcement</option>
                    </select>
                    <button
                      type="button"
                      onClick={handleCreateChannel}
                      className="px-2 py-1 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-xs cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>

              {/* Admin Pending Requests */}
              {selectedComm.adminUids.includes(firebaseUser?.uid || '') &&
                (selectedComm.pendingUids?.length || 0) > 0 && (
                  <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/40 flex items-center justify-between text-xs">
                    <span>{selectedComm.pendingUids!.length} pending join request(s)</span>
                    <button
                      type="button"
                      onClick={async () => {
                        const nextMembers = Array.from(
                          new Set([...selectedComm.memberUids, ...(selectedComm.pendingUids || [])])
                        );
                        await updateDoc(doc(db, 'communities', selectedComm.id), {
                          memberUids: nextMembers,
                          pendingUids: [],
                          updatedAt: serverTimestamp(),
                        });
                        await Promise.all(
                          channels.map((ch) =>
                            updateDoc(
                              doc(db, 'communities', selectedComm.id, 'channels', ch.id),
                              { memberUids: nextMembers }
                            )
                          )
                        );
                        showToast('Approved', 'Pending members added to community.', 'success');
                      }}
                      className="inline-flex items-center gap-1 text-emerald-600 font-semibold cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" /> Approve All
                    </button>
                  </div>
                )}

              {/* Channel Posts */}
              <div className="flex-1 p-4 space-y-3 overflow-y-auto max-h-80">
                {!selectedComm.memberUids.includes(firebaseUser?.uid || '') ? (
                  <div className="text-center py-12 text-xs text-slate-500">
                    Join this community to read and post inside channels.
                  </div>
                ) : channelPosts.length === 0 ? (
                  <div className="text-center py-12 text-xs text-slate-500">
                    No messages in #{selectedChannel?.name} yet.
                  </div>
                ) : (
                  channelPosts.map((p) => (
                    <div key={p.id} className="rounded-xl bg-slate-50 dark:bg-[#0B0F19] p-3 text-sm">
                      <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                        {p.senderName}
                      </p>
                      <p className="mt-1 text-slate-800 dark:text-slate-200">{p.content}</p>
                    </div>
                  ))
                )}
              </div>

              {selectedComm.memberUids.includes(firebaseUser?.uid || '') && selectedChannel && (
                <form
                  onSubmit={handleSendChannelPost}
                  className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={postDraft}
                    onChange={(e) => setPostDraft(e.target.value)}
                    placeholder={`Message #${selectedChannel.name}...`}
                    className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Post
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>

      {/* Modal: Create Community */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleCreateCommunity}
            className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Create Community</h3>
              <button type="button" onClick={() => setShowCreate(false)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Community Name"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"
            />
            <textarea
              rows={2}
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
            />
            <input
              type="text"
              value={newRules}
              onChange={(e) => setNewRules(e.target.value)}
              placeholder="Community Rules"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                placeholder="Category"
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
              />
              <select
                aria-label="Community visibility"
                value={newVis}
                onChange={(e) => setNewVis(e.target.value as 'public' | 'private')}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
              >
                <option value="public">Public</option>
                <option value="private">Private (Approval)</option>
              </select>
            </div>
            <button
              type="submit"
              className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold cursor-pointer"
            >
              Launch Community
            </button>
          </form>
        </div>
      )}

      {/* Modal: QR Code Invite */}
      {showQr && selectedComm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowQr(false)}>
          <div
            className="w-full max-w-xs rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-6 text-center space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Invite to {selectedComm.name}
            </h3>
            <div className="bg-white p-4 rounded-xl inline-block">
              <QRCodeSVG
                value={`${window.location.origin}/?join=${selectedComm.inviteCode}`}
                size={160}
              />
            </div>
            <p className="text-xs text-slate-500 font-mono">Invite Code: {selectedComm.inviteCode}</p>
          </div>
        </div>
      )}
    </div>
  );
};
