import React, { useEffect, useMemo, useState } from 'react';
import {
  UserPlus,
  Check,
  X,
  MessageSquare,
  Phone,
  ShieldAlert,
  Search,
  UserMinus,
  Contact,
  Upload,
  Link2,
  Share2,
  Plus,
  Trash2,
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
  setDoc,
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
import { UserPublic } from '../../types/konnecta';

interface FriendRequestDoc {
  id: string;
  fromUid: string;
  fromName?: string;
  fromUsername?: string;
  toUid: string;
  status: 'pending' | 'accepted' | 'rejected';
}

interface FriendshipDoc {
  id: string;
  uids: string[];
  uid1: string;
  uid2: string;
}

interface BlockDoc {
  id: string;
  blockerUid: string;
  blockedUid: string;
}

export const FriendsModule: React.FC<{
  onStartChat: (peerUid: string) => void;
}> = ({ onStartChat }) => {
  const { firebaseUser, publicProfile, onlineUids, showToast, setActiveCallTarget } = useApp();
  const [directory, setDirectory] = useState<UserPublic[]>([]);
  const [incomingReqs, setIncomingReqs] = useState<FriendRequestDoc[]>([]);
  const [outgoingReqs, setOutgoingReqs] = useState<FriendRequestDoc[]>([]);
  const [friendships, setFriendships] = useState<FriendshipDoc[]>([]);
  const [blocks, setBlocks] = useState<BlockDoc[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  const [localContacts, setLocalContacts] = useState<LocalContact[]>([]);
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactInfo, setContactInfo] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inv = params.get('invite');
    if (inv) {
      setSearchTerm(inv.replace(/^@/, ''));
    }
  }, []);

  useEffect(() => {
    if (!firebaseUser) return;
    setLocalContacts(loadLocalContacts(firebaseUser.uid));
  }, [firebaseUser]);

  const persistContacts = (next: LocalContact[]) => {
    if (!firebaseUser) return;
    setLocalContacts(saveLocalContacts(firebaseUser.uid, next));
  };

  useEffect(() => {
    if (!firebaseUser) return;
    const uq = query(
      collection(db, 'users_public'),
      where('profileVisibility', 'in', ['public', 'friends']),
      limit(80)
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

    const inQ = query(
      collection(db, 'friend_requests'),
      where('toUid', '==', firebaseUser.uid),
      where('status', '==', 'pending')
    );
    const unsubIn = onSnapshot(inQ, (snap) => {
      setIncomingReqs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FriendRequestDoc, 'id'>) })));
    });

    const outQ = query(
      collection(db, 'friend_requests'),
      where('fromUid', '==', firebaseUser.uid),
      where('status', '==', 'pending')
    );
    const unsubOut = onSnapshot(outQ, (snap) => {
      setOutgoingReqs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FriendRequestDoc, 'id'>) })));
    });

    const frQ = query(
      collection(db, 'friendships'),
      where('uids', 'array-contains', firebaseUser.uid)
    );
    const unsubFr = onSnapshot(frQ, (snap) => {
      setFriendships(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FriendshipDoc, 'id'>) })));
    });

    const blQ = query(collection(db, 'blocks'), where('blockerUid', '==', firebaseUser.uid));
    const unsubBl = onSnapshot(blQ, (snap) => {
      setBlocks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BlockDoc, 'id'>) })));
    });

    return () => {
      unsubUsers();
      unsubIn();
      unsubOut();
      unsubFr();
      unsubBl();
    };
  }, [firebaseUser]);

  const friendUids = new Set(
    friendships.map((f) => (f.uid1 === firebaseUser?.uid ? f.uid2 : f.uid1))
  );
  const blockedUids = new Set(blocks.map((b) => b.blockedUid));
  const pendingOutUids = new Set(outgoingReqs.map((r) => r.toUid));

  const inviteUrl = `${window.location.origin}/?invite=${encodeURIComponent(
    publicProfile?.username || 'member'
  )}`;

  const handleCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showToast('Invite link copied', 'Share it with friends or contacts to connect.', 'success');
    } catch {
      showToast('Invite link', inviteUrl, 'info');
    }
  };

  const handleShareInvite = async (targetName?: string) => {
    const text = targetName
      ? `Hey ${targetName}, join me on KONNECTA: ${inviteUrl}`
      : `Connect with me on KONNECTA: ${inviteUrl}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join me on KONNECTA', text, url: inviteUrl });
        return;
      } catch {
        // Fallback to clipboard copy
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('Invite copied', 'Ready to paste into SMS, WhatsApp, or email.', 'success');
    } catch {
      showToast('Share link', inviteUrl, 'info');
    }
  };

  const handlePickDeviceContacts = async () => {
    const nav = navigator as NavigatorWithContacts;
    if (!nav.contacts || typeof nav.contacts.select !== 'function') {
      showToast(
        'Device picker unavailable',
        'Use .vcf / .csv import or Quick Add right below.',
        'info'
      );
      setShowAddContact(true);
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
        persistContacts(merged);
        showToast('Contacts imported', `Added ${addedCount} contact${addedCount === 1 ? '' : 's'} locally.`, 'success');
      }
    } catch {
      showToast('Import cancelled', 'No contacts were selected.', 'info');
    }
  };

  const handleImportContactFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      showToast('File too large', 'Please select a .vcf or .csv file under 1 MB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseContactsText(String(reader.result || ''), file.name);
      if (parsed.length === 0) {
        showToast('No contacts found', 'Check that the .vcf or .csv file contains names or emails.', 'info');
        return;
      }
      const additions: LocalContact[] = parsed.map((p, idx) => ({
        ...p,
        id: `${Date.now()}_${idx}`,
      }));
      const { merged, addedCount } = mergeUniqueContacts(localContacts, additions);
      persistContacts(merged);
      showToast('Contacts imported', `Added ${addedCount} new contact${addedCount === 1 ? '' : 's'}.`, 'success');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleAddManualContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactName.trim() && !contactInfo.trim()) return;
    const entry: LocalContact = {
      id: `${Date.now()}`,
      name: (contactName.trim() || contactInfo.trim()).slice(0, 80),
      contactInfo: contactInfo.trim().slice(0, 120),
      source: 'manual',
    };
    persistContacts([entry, ...localContacts]);
    setContactName('');
    setContactInfo('');
    setShowAddContact(false);
    showToast('Contact saved', 'Matched against discoverable profiles.', 'success');
  };

  const removeLocalContact = (id: string) => {
    persistContacts(localContacts.filter((c) => c.id !== id));
  };

  const matchedContacts = useMemo(() => {
    return localContacts.map((contact) => {
      const nameLower = contact.name.toLowerCase();
      const infoHandle = contact.contactInfo.replace(/^@/, '').split('@')[0].toLowerCase();
      const match = directory.find((u) => {
        if (blockedUids.has(u.uid)) return false;
        const dn = u.displayName.toLowerCase();
        const un = u.username.toLowerCase();
        if (nameLower && (dn === nameLower || un === nameLower.replace(/^@/, ''))) return true;
        if (infoHandle && infoHandle.length >= 3 && (un === infoHandle || dn.includes(infoHandle))) return true;
        return false;
      });
      return { contact, match };
    });
  }, [localContacts, directory, blockedUids]);

  const sendFriendRequest = async (target: UserPublic) => {
    if (!firebaseUser) return;
    if (target.friendRequestsFrom === 'nobody') {
      showToast('Requests restricted', `@${target.username} does not accept friend requests.`, 'info');
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
      await addDoc(collection(db, 'notifications'), {
        recipientUid: target.uid,
        actorUid: firebaseUser.uid,
        actorName: publicProfile?.displayName || 'Member',
        type: 'friend_request',
        title: 'New friend request',
        body: `${publicProfile?.displayName || 'Someone'} sent you a friend request.`,
        linkTab: 'friends',
        read: false,
        createdAt: serverTimestamp(),
      });
      showToast('Request sent', `Sent friend request to ${target.displayName}.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'friend_requests');
    }
  };

  const acceptRequest = async (req: FriendRequestDoc) => {
    if (!firebaseUser) return;
    const sorted = [req.fromUid, firebaseUser.uid].sort();
    const fid = `${sorted[0].slice(0, 16)}_${sorted[1].slice(0, 16)}`;
    await updateDoc(doc(db, 'friend_requests', req.id), {
      status: 'accepted',
      updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'friendships', fid), {
      uids: sorted,
      uid1: sorted[0],
      uid2: sorted[1],
      createdAt: serverTimestamp(),
    });
    showToast('Friend added', `You are now connected with ${req.fromName || 'member'}.`, 'success');
  };

  const rejectRequest = async (req: FriendRequestDoc) => {
    await updateDoc(doc(db, 'friend_requests', req.id), {
      status: 'rejected',
      updatedAt: serverTimestamp(),
    });
  };

  const removeFriend = async (peerUid: string) => {
    const f = friendships.find((x) => x.uids.includes(peerUid));
    if (f) {
      await deleteDoc(doc(db, 'friendships', f.id));
      showToast('Friend removed', undefined, 'info');
    }
  };

  const blockUser = async (peerUid: string) => {
    if (!firebaseUser) return;
    const bid = `${firebaseUser.uid.slice(0, 16)}_${peerUid.slice(0, 16)}`;
    await setDoc(doc(db, 'blocks', bid), {
      blockerUid: firebaseUser.uid,
      blockedUid: peerUid,
      createdAt: serverTimestamp(),
    });
    await removeFriend(peerUid);
    showToast('User blocked', 'They can no longer interact with you.', 'info');
  };

  const myInterests = new Set(publicProfile?.interests || []);

  const filteredDirectory = directory.filter((u) => {
    if (blockedUids.has(u.uid)) return false;
    const term = searchTerm.trim().toLowerCase();
    if (!term) return true;
    return (
      u.displayName.toLowerCase().includes(term) ||
      u.username.toLowerCase().includes(term) ||
      (u.college || '').toLowerCase().includes(term) ||
      (u.interests || []).some((i) => i.toLowerCase().includes(term))
    );
  });

  const friendsList = directory.filter((u) => friendUids.has(u.uid) && !blockedUids.has(u.uid));

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Add from Contacts & Personal Invite */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0E1320] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Contact className="w-4 h-4 text-indigo-500" />
              Add from Contacts &amp; Invite Links
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Your imported contacts stay strictly on this device and are matched locally against discoverable members.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePickDeviceContacts}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer"
            >
              <Contact className="w-3.5 h-3.5" />
              Device Contacts
            </button>
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              Import .vcf / .csv
              <input
                type="file"
                accept=".vcf,.csv,.txt,text/vcard,text/csv"
                onChange={handleImportContactFile}
                className="hidden"
              />
            </label>
            <button
              type="button"
              onClick={() => setShowAddContact((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Contact
            </button>
          </div>
        </div>

        <div className="rounded-xl bg-slate-50 dark:bg-[#090C15] border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-slate-500">Your personal invite link</p>
            <p className="text-xs font-mono text-slate-800 dark:text-slate-200 truncate">{inviteUrl}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopyInvite}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0E1320] text-xs font-medium cursor-pointer"
            >
              <Link2 className="w-3.5 h-3.5" />
              Copy
            </button>
            <button
              type="button"
              onClick={() => handleShareInvite()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold cursor-pointer"
            >
              <Share2 className="w-3.5 h-3.5" />
              Share
            </button>
          </div>
        </div>

        {showAddContact && (
          <form
            onSubmit={handleAddManualContact}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090C15] p-3.5 grid sm:grid-cols-12 gap-2 items-center"
          >
            <input
              type="text"
              required
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Contact Name (e.g. Alex Rivera)"
              className="sm:col-span-5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0E1320] px-3 py-1.5 text-xs"
            />
            <input
              type="text"
              value={contactInfo}
              onChange={(e) => setContactInfo(e.target.value)}
              placeholder="Phone, email, or @handle (optional)"
              className="sm:col-span-5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0E1320] px-3 py-1.5 text-xs"
            />
            <button
              type="submit"
              className="sm:col-span-2 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold cursor-pointer"
            >
              Save
            </button>
          </form>
        )}

        {matchedContacts.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Saved Contacts ({matchedContacts.length})</span>
              <button
                type="button"
                onClick={() => persistContacts([])}
                className="text-red-500 hover:underline cursor-pointer"
              >
                Clear list
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-2.5 max-h-64 overflow-y-auto pr-1">
              {matchedContacts.map(({ contact, match }) => {
                const isFriend = match ? friendUids.has(match.uid) : false;
                const isPending = match ? pendingOutUids.has(match.uid) : false;
                return (
                  <div
                    key={contact.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {contact.name}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {match
                          ? `On KONNECTA · @${match.username}`
                          : contact.contactInfo || `Imported (${contact.source})`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {match ? (
                        isFriend ? (
                          <button
                            type="button"
                            onClick={() => onStartChat(match.uid)}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-medium cursor-pointer"
                          >
                            Chat
                          </button>
                        ) : isPending ? (
                          <span className="text-[11px] text-slate-500 px-2">Pending</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => sendFriendRequest(match)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-[11px] font-semibold cursor-pointer"
                          >
                            <UserPlus className="w-3 h-3" />
                            Add
                          </button>
                        )
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleShareInvite(contact.name)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-medium cursor-pointer"
                        >
                          <Share2 className="w-3 h-3" />
                          Invite
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeLocalContact(contact.id)}
                        aria-label={`Remove ${contact.name}`}
                        className="p-1 text-slate-400 hover:text-red-500 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Incoming Friend Requests */}
      {incomingReqs.length > 0 && (
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0E1320] p-5">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
            Incoming Friend Requests ({incomingReqs.length})
          </h2>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {incomingReqs.map((r) => (
              <div key={r.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {r.fromName || 'KONNECTA User'}
                  </p>
                  <p className="text-xs text-slate-500">@{r.fromUsername || r.fromUid.slice(0, 8)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => acceptRequest(r)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => rejectRequest(r)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Active Friends */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0E1320] p-5">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
          Your Friends ({friendsList.length})
        </h2>
        {friendsList.length === 0 ? (
          <p className="text-xs text-slate-500">
            No friends added yet. Import from your contacts, share an invite link, or discover people below.
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {friendsList.map((f) => (
              <div
                key={f.uid}
                className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                    {f.displayName}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    @{f.username} · {onlineUids.includes(f.uid) ? 'Online' : 'Offline'}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => onStartChat(f.uid)}
                    title="Encrypted Chat"
                    className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-indigo-500 cursor-pointer"
                  >
                    <MessageSquare className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveCallTarget({
                        uid: f.uid,
                        name: f.displayName,
                        mode: 'audio',
                        isInitiator: true,
                      })
                    }
                    title="Voice Call"
                    className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-emerald-500 cursor-pointer"
                  >
                    <Phone className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFriend(f.uid)}
                    title="Remove friend"
                    className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-red-500 cursor-pointer"
                  >
                    <UserMinus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Discover People */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0E1320] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Discover People &amp; Shared Interests
            </h2>
            <p className="text-xs text-slate-500">Only members who opted into discovery appear here.</p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search name, @handle, or interest..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#090C15] pl-8 pr-3 py-1.5 text-xs"
            />
          </div>
        </div>

        {filteredDirectory.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">No matching users found.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {filteredDirectory.map((u) => {
              const sharedCount = (u.interests || []).filter((i) => myInterests.has(i)).length;
              const isFriend = friendUids.has(u.uid);
              const isPending = pendingOutUids.has(u.uid);
              return (
                <div
                  key={u.uid}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                          {u.displayName}
                        </p>
                        <p className="text-xs text-slate-500">
                          @{u.username}
                          {u.college ? ` · ${u.college}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => blockUser(u.uid)}
                        title="Block user"
                        className="text-slate-400 hover:text-red-500 cursor-pointer"
                      >
                        <ShieldAlert className="w-4 h-4" />
                      </button>
                    </div>
                    {u.bio && (
                      <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                        {u.bio}
                      </p>
                    )}
                    {sharedCount > 0 && (
                      <p className="mt-2 text-xs text-indigo-600 dark:text-indigo-400">
                        {sharedCount} shared interest{sharedCount > 1 ? 's' : ''}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    {isFriend ? (
                      <button
                        type="button"
                        onClick={() => onStartChat(u.uid)}
                        className="flex-1 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium cursor-pointer"
                      >
                        Open Chat
                      </button>
                    ) : isPending ? (
                      <span className="flex-1 text-center py-1.5 text-xs text-slate-500">
                        Request Pending
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => sendFriendRequest(u)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        Add Friend
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
