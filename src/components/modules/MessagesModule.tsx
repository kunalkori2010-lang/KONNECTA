import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Send,
  Lock,
  Plus,
  Users,
  Search,
  Phone,
  Video,
  Pin,
  Reply,
  Edit3,
  Trash2,
  Bookmark,
  Flag,
  Mic,
  Square,
  Paperclip,
  BarChart2,
  BellOff,
  Archive,
  Clock,
  ShieldCheck,
  Forward,
  Smile,
  X,
  UserPlus,
} from 'lucide-react';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
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
  decryptText,
  deriveDirectConversationKey,
  encryptText,
  generateGroupAesKey,
  unwrapGroupKeyFromSender,
  wrapGroupKeyForMember,
} from '../../lib/crypto';
import { useApp } from '../../context/AppContext';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { BRAND_CONFIG, CHAT_WALLPAPERS } from '../../config/brand';
import { ChatMessage, Conversation, PollOption, UserPublic } from '../../types/konnecta';

interface QueuedOutboxItem {
  convId: string;
  text: string;
  clientMsgId: string;
  replyToId?: string;
}

const REACTION_EMOJIS = ['👍', '❤️', '🔥', '🎯', '👏'];

export const MessagesModule: React.FC<{ initialPeerUid?: string | null }> = ({ initialPeerUid }) => {
  const {
    firebaseUser,
    publicProfile,
    keyBundle,
    onlineUids,
    chatWallpaper,
    wsSend,
    wsSubscribe,
    showToast,
    setActiveCallTarget,
  } = useApp();
  const isOnline = useOnlineStatus();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [usersMap, setUsersMap] = useState<Record<string, UserPublic>>({});
  const [userKeysMap, setUserKeysMap] = useState<Record<string, { ecdhPublicJwk: string; fingerprint: string }>>({});
  const [convKeys, setConvKeys] = useState<Record<string, CryptoKey>>({});

  const [draft, setDraft] = useState('');
  const [localSearch, setLocalSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingMsg, setEditingMsg] = useState<ChatMessage | null>(null);
  const [forwardingMsg, setForwardingMsg] = useState<ChatMessage | null>(null);
  const [reportingMsg, setReportingMsg] = useState<ChatMessage | null>(null);
  const [reportReason, setReportReason] = useState('');

  const [showNewDmModal, setShowNewDmModal] = useState(false);
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showGroupPanel, setShowGroupPanel] = useState(false);

  const [groupTitle, setGroupTitle] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [groupMemberUids, setGroupMemberUids] = useState<string[]>([]);

  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptionsText, setPollOptionsText] = useState('Option A\nOption B');

  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [outboxQueue, setOutboxQueue] = useState<QueuedOutboxItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('konnecta_msg_outbox') || '[]');
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('konnecta_msg_outbox', JSON.stringify(outboxQueue));
  }, [outboxQueue]);

  // Load discoverable users for starting chats
  useEffect(() => {
    if (!firebaseUser) return;
    getDocs(query(collection(db, 'users_public'), where('profileVisibility', 'in', ['public', 'friends']), limit(50)))
      .then((snap) => {
        const map: Record<string, UserPublic> = {};
        snap.forEach((d) => {
          map[d.id] = d.data() as UserPublic;
        });
        setUsersMap(map);
      })
      .catch(() => {});
  }, [firebaseUser]);

  // Subscribe to conversations where user is a member
  useEffect(() => {
    if (!firebaseUser) return;
    const q = query(
      collection(db, 'conversations'),
      where('memberUids', 'array-contains', firebaseUser.uid),
      limit(50)
    );
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Conversation, 'id'>),
        }));
        list.sort((a, b) => {
          const ta = (a.updatedAt as { toMillis?: () => number })?.toMillis?.() || 0;
          const tb = (b.updatedAt as { toMillis?: () => number })?.toMillis?.() || 0;
          return tb - ta;
        });
        setConversations(list);
        if (!selectedConvId && list.length > 0) {
          setSelectedConvId(list[0].id);
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'conversations')
    );
  }, [firebaseUser, selectedConvId]);

  const selectedConv = useMemo(
    () => conversations.find((c) => c.id === selectedConvId) || null,
    [conversations, selectedConvId]
  );

  // Start/open DM if initialPeerUid passed from Friends
  useEffect(() => {
    if (!initialPeerUid || !firebaseUser || !keyBundle) return;
    openOrCreateDirectChat(initialPeerUid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPeerUid, firebaseUser?.uid]);

  // Fetch public keys for members of active conversations
  const fetchUserKey = async (uid: string) => {
    if (userKeysMap[uid]) return userKeysMap[uid];
    try {
      const snap = await getDoc(doc(db, 'user_keys', uid));
      if (snap.exists()) {
        const data = snap.data() as { ecdhPublicJwk: string; fingerprint: string };
        setUserKeysMap((prev) => ({ ...prev, [uid]: data }));
        return data;
      }
    } catch {
      // Key might not exist yet
    }
    return null;
  };

  // Derive or unwrap AES-256-GCM key for selected conversation
  useEffect(() => {
    if (!selectedConv || !firebaseUser || !keyBundle) return;
    let cancelled = false;

    const resolveConvKey = async () => {
      if (selectedConv.type === 'direct') {
        const peerUid = selectedConv.memberUids.find((u) => u !== firebaseUser.uid) || firebaseUser.uid;
        const peerKey = await fetchUserKey(peerUid);
        if (!peerKey || cancelled) return;
        try {
          const derived = await deriveDirectConversationKey(
            keyBundle.privateKey,
            peerKey.ecdhPublicJwk,
            selectedConv.id
          );
          if (!cancelled) setConvKeys((prev) => ({ ...prev, [selectedConv.id]: derived }));
        } catch (e) {
          console.error('Failed deriving DM key:', e);
        }
      } else {
        // Group conversation key unwrapping
        try {
          const mkSnap = await getDoc(
            doc(db, 'conversations', selectedConv.id, 'memberKeys', firebaseUser.uid)
          );
          if (mkSnap.exists()) {
            const mk = mkSnap.data() as { wrappedKey: string; iv: string; senderUid: string };
            const senderKey = await fetchUserKey(mk.senderUid);
            if (senderKey && !cancelled) {
              const aes = await unwrapGroupKeyFromSender(
                mk.wrappedKey,
                mk.iv,
                keyBundle.privateKey,
                senderKey.ecdhPublicJwk,
                selectedConv.id
              );
              if (!cancelled) setConvKeys((prev) => ({ ...prev, [selectedConv.id]: aes }));
              return;
            }
          }
          // Fallback: if creator and no memberKey yet, generate & distribute
          if (selectedConv.creatorUid === firebaseUser.uid) {
            const aes = await generateGroupAesKey();
            for (const mUid of selectedConv.memberUids) {
              const mKey = await fetchUserKey(mUid);
              if (mKey) {
                const wrapped = await wrapGroupKeyForMember(
                  aes,
                  keyBundle.privateKey,
                  mKey.ecdhPublicJwk,
                  selectedConv.id
                );
                await setDoc(doc(db, 'conversations', selectedConv.id, 'memberKeys', mUid), {
                  uid: mUid,
                  wrappedKey: wrapped.wrappedKey,
                  iv: wrapped.iv,
                  senderUid: firebaseUser.uid,
                  keyVersion: selectedConv.keyVersion,
                  updatedAt: serverTimestamp(),
                });
              }
            }
            if (!cancelled) setConvKeys((prev) => ({ ...prev, [selectedConv.id]: aes }));
          }
        } catch (e) {
          console.error('Failed unwrapping group key:', e);
        }
      }
    };

    resolveConvKey();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConv?.id, selectedConv?.keyVersion, firebaseUser?.uid, keyBundle]);

  // Subscribe to messages for selected conversation and decrypt client-side
  useEffect(() => {
    if (!selectedConv || !firebaseUser) {
      setMessages([]);
      return;
    }

    wsSend({ type: 'room:join', roomId: `conv:${selectedConv.id}` });

    const q = query(
      collection(db, 'conversations', selectedConv.id, 'messages'),
      where('memberUids', 'array-contains', firebaseUser.uid),
      limit(100)
    );

    const unsub = onSnapshot(
      q,
      async (snap) => {
        const key = convKeys[selectedConv.id];
        const nowMs = Date.now();
        const rawList = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ChatMessage, 'id'>),
        }));
        rawList.sort((a, b) => {
          const ta = (a.createdAt as { seconds?: number })?.seconds || Number.MAX_SAFE_INTEGER;
          const tb = (b.createdAt as { seconds?: number })?.seconds || Number.MAX_SAFE_INTEGER;
          return ta - tb;
        });

        const decrypted = await Promise.all(
          rawList
            .filter((m) => !m.expiresAtMs || m.expiresAtMs > nowMs)
            .map(async (m) => {
              if (m.deleted) return { ...m, decryptedText: 'This message was deleted.' };
              if (!m.e2ee || !m.iv) return { ...m, decryptedText: m.ciphertext };
              if (!key) return { ...m, decryptedText: '[Decrypting with local key...]' };
              try {
                const plain = await decryptText(key, m.ciphertext, m.iv);
                return { ...m, decryptedText: plain };
              } catch {
                return { ...m, decryptedText: '[Encrypted with a rotated or unavailable key]', decryptionError: true };
              }
            })
        );
        setMessages(decrypted);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `conversations/${selectedConv.id}/messages`)
    );

    return () => {
      wsSend({ type: 'room:leave', roomId: `conv:${selectedConv.id}` });
      unsub();
    };
  }, [selectedConv, firebaseUser, convKeys, wsSend]);

  // Subscribe to real-time WebSocket typing indicators
  useEffect(() => {
    return wsSubscribe((msg) => {
      if (!selectedConv) return;
      if (msg.roomId !== `conv:${selectedConv.id}`) return;
      if (msg.type === 'typing:start') {
        setTypingUsers((prev) => ({
          ...prev,
          [String(msg.senderUid)]: String(msg.senderName || 'Someone'),
        }));
      } else if (msg.type === 'typing:stop') {
        setTypingUsers((prev) => {
          const next = { ...prev };
          delete next[String(msg.senderUid)];
          return next;
        });
      }
    });
  }, [wsSubscribe, selectedConv]);

  // Flush offline queued messages upon reconnect
  useEffect(() => {
    if (!isOnline || outboxQueue.length === 0 || !firebaseUser) return;
    const flush = async () => {
      const remaining: QueuedOutboxItem[] = [];
      for (const item of outboxQueue) {
        const key = convKeys[item.convId];
        const conv = conversations.find((c) => c.id === item.convId);
        if (!conv) continue;
        try {
          let ciphertext = item.text;
          let iv = '';
          let e2ee = false;
          if (key) {
            const enc = await encryptText(key, item.text);
            ciphertext = enc.ciphertext;
            iv = enc.iv;
            e2ee = true;
          }
          await setDoc(doc(db, 'conversations', item.convId, 'messages', item.clientMsgId), {
            convId: item.convId,
            senderUid: firebaseUser.uid,
            senderName: publicProfile?.displayName || 'Member',
            type: 'text',
            e2ee,
            ciphertext,
            iv,
            keyVersion: conv.keyVersion,
            replyToId: item.replyToId || '',
            clientMsgId: item.clientMsgId,
            memberUids: conv.memberUids,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch {
          remaining.push(item);
        }
      }
      setOutboxQueue(remaining);
    };
    flush();
  }, [isOnline, outboxQueue, convKeys, conversations, firebaseUser, publicProfile]);

  const openOrCreateDirectChat = async (peerUid: string) => {
    if (!firebaseUser) return;
    const pair = [firebaseUser.uid, peerUid].sort();
    const convId = `dm_${pair[0].slice(0, 12)}_${pair[1].slice(0, 12)}`;
    const existing = conversations.find((c) => c.id === convId);
    if (existing) {
      setSelectedConvId(existing.id);
      setShowNewDmModal(false);
      return;
    }

    try {
      const snap = await getDoc(doc(db, 'conversations', convId));
      if (!snap.exists()) {
        await setDoc(doc(db, 'conversations', convId), {
          type: 'direct',
          creatorUid: firebaseUser.uid,
          memberUids: pair,
          adminUids: pair,
          keyVersion: 1,
          disappearingSeconds: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setSelectedConvId(convId);
      setShowNewDmModal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `conversations/${convId}`);
    }
  };

  const handleCreateGroup = async () => {
    if (!firebaseUser || !keyBundle || !groupTitle.trim()) return;
    const members = Array.from(new Set([firebaseUser.uid, ...groupMemberUids]));
    const convId = `grp_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    try {
      await setDoc(doc(db, 'conversations', convId), {
        type: 'group',
        title: groupTitle.trim().slice(0, 100),
        description: groupDesc.trim().slice(0, 300),
        creatorUid: firebaseUser.uid,
        memberUids: members,
        adminUids: [firebaseUser.uid],
        keyVersion: 1,
        disappearingSeconds: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const aes = await generateGroupAesKey();
      setConvKeys((prev) => ({ ...prev, [convId]: aes }));
      for (const mUid of members) {
        const mKey = await fetchUserKey(mUid);
        if (mKey) {
          const wrapped = await wrapGroupKeyForMember(aes, keyBundle.privateKey, mKey.ecdhPublicJwk, convId);
          await setDoc(doc(db, 'conversations', convId, 'memberKeys', mUid), {
            uid: mUid,
            wrappedKey: wrapped.wrappedKey,
            iv: wrapped.iv,
            senderUid: firebaseUser.uid,
            keyVersion: 1,
            updatedAt: serverTimestamp(),
          });
        }
      }

      setGroupTitle('');
      setGroupDesc('');
      setGroupMemberUids([]);
      setShowNewGroupModal(false);
      setSelectedConvId(convId);
      showToast('Group created', 'Group key distributed to verified members.', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `conversations/${convId}`);
    }
  };

  const rotateGroupKeyWithMembers = async (conv: Conversation, nextMembers: string[]) => {
    if (!firebaseUser || !keyBundle) return;
    const nextVersion = conv.keyVersion + 1;
    const aes = await generateGroupAesKey();
    await updateDoc(doc(db, 'conversations', conv.id), {
      memberUids: nextMembers,
      keyVersion: nextVersion,
      updatedAt: serverTimestamp(),
    });
    for (const mUid of nextMembers) {
      const mKey = await fetchUserKey(mUid);
      if (mKey) {
        const wrapped = await wrapGroupKeyForMember(aes, keyBundle.privateKey, mKey.ecdhPublicJwk, conv.id);
        await setDoc(doc(db, 'conversations', conv.id, 'memberKeys', mUid), {
          uid: mUid,
          wrappedKey: wrapped.wrappedKey,
          iv: wrapped.iv,
          senderUid: firebaseUser.uid,
          keyVersion: nextVersion,
          updatedAt: serverTimestamp(),
        });
      }
    }
    setConvKeys((prev) => ({ ...prev, [conv.id]: aes }));
    showToast('Group Key Rotated', `Key rotated to v${nextVersion} for ${nextMembers.length} members.`, 'success');
  };

  const sendMessage = async (
    textBody: string,
    msgType: ChatMessage['type'] = 'text',
    extra?: Partial<ChatMessage>
  ) => {
    if (!selectedConv || !firebaseUser) return;
    const clean = textBody.trim();
    if (!clean && msgType === 'text') return;

    const clientMsgId = `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;

    if (editingMsg && msgType === 'text') {
      try {
        const key = convKeys[selectedConv.id];
        let ciphertext = clean;
        let iv = '';
        if (key) {
          const enc = await encryptText(key, clean);
          ciphertext = enc.ciphertext;
          iv = enc.iv;
        }
        await updateDoc(doc(db, 'conversations', selectedConv.id, 'messages', editingMsg.id), {
          ciphertext,
          iv,
          edited: true,
          updatedAt: serverTimestamp(),
        });
        setEditingMsg(null);
        setDraft('');
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `conversations/${selectedConv.id}/messages/${editingMsg.id}`);
      }
      return;
    }

    if (!isOnline) {
      setOutboxQueue((prev) => [
        ...prev,
        { convId: selectedConv.id, text: clean, clientMsgId, replyToId: replyTo?.id },
      ]);
      setDraft('');
      setReplyTo(null);
      showToast('Queued offline', 'Message will send automatically when connection restores.', 'info');
      return;
    }

    try {
      const key = convKeys[selectedConv.id];
      let ciphertext = clean;
      let iv = '';
      let e2ee = false;

      if (key) {
        const enc = await encryptText(key, clean);
        ciphertext = enc.ciphertext;
        iv = enc.iv;
        e2ee = true;
      }

      const expiresAtMs =
        selectedConv.disappearingSeconds && selectedConv.disappearingSeconds > 0
          ? Date.now() + selectedConv.disappearingSeconds * 1000
          : undefined;

      const payload: Record<string, unknown> = {
        convId: selectedConv.id,
        senderUid: firebaseUser.uid,
        senderName: publicProfile?.displayName || 'Member',
        type: msgType,
        e2ee,
        ciphertext,
        iv,
        keyVersion: selectedConv.keyVersion,
        replyToId: replyTo?.id || '',
        clientMsgId,
        memberUids: selectedConv.memberUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...(expiresAtMs ? { expiresAtMs } : {}),
        ...(extra || {}),
      };

      await setDoc(doc(db, 'conversations', selectedConv.id, 'messages', clientMsgId), payload);
      await updateDoc(doc(db, 'conversations', selectedConv.id), {
        lastMessageAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      wsSend({ type: 'typing:stop', roomId: `conv:${selectedConv.id}` });
      setDraft('');
      setReplyTo(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `conversations/${selectedConv.id}/messages/${clientMsgId}`);
    }
  };

  const handleAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 300 * 1024) {
      showToast('Attachment limit', 'Encrypted chat attachments are capped at 300 KB. Use Study Zone for files up to 5 MB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || '');
      const isImg = file.type.startsWith('image/');
      await sendMessage(dataUrl, isImg ? 'image' : 'file', {
        attachmentMeta: { fileName: file.name, mimeType: file.type, sizeBytes: file.size },
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const toggleVoiceRecording = async () => {
    if (recording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = async () => {
          await sendMessage(String(reader.result || ''), 'voice', {
            attachmentMeta: { fileName: 'voice-note.webm', mimeType: 'audio/webm', sizeBytes: blob.size },
          });
        };
        reader.readAsDataURL(blob);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch {
      showToast('Microphone unavailable', 'Allow microphone access to record voice messages.', 'error');
    }
  };

  const handleCreatePoll = async () => {
    if (!pollQuestion.trim()) return;
    const opts: PollOption[] = pollOptionsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6)
      .map((text, idx) => ({ id: `opt_${idx}`, text, voterUids: [] }));
    if (opts.length < 2) {
      showToast('Poll requires options', 'Enter at least 2 options on separate lines.', 'error');
      return;
    }
    await sendMessage(pollQuestion.trim(), 'poll', {
      pollQuestion: pollQuestion.trim(),
      pollOptions: opts,
    });
    setPollQuestion('');
    setShowPollModal(false);
  };

  const handleVotePoll = async (msg: ChatMessage, optionId: string) => {
    if (!selectedConv || !firebaseUser || !msg.pollOptions) return;
    const updated = msg.pollOptions.map((o) => {
      const filtered = o.voterUids.filter((u) => u !== firebaseUser.uid);
      return o.id === optionId ? { ...o, voterUids: [...filtered, firebaseUser.uid] } : { ...o, voterUids: filtered };
    });
    await updateDoc(doc(db, 'conversations', selectedConv.id, 'messages', msg.id), {
      pollOptions: updated,
      updatedAt: serverTimestamp(),
    });
  };

  const handleReaction = async (msg: ChatMessage, emoji: string) => {
    if (!selectedConv || !firebaseUser) return;
    const current = { ...(msg.reactions || {}) };
    const list = current[emoji] || [];
    current[emoji] = list.includes(firebaseUser.uid)
      ? list.filter((u) => u !== firebaseUser.uid)
      : [...list, firebaseUser.uid];
    await updateDoc(doc(db, 'conversations', selectedConv.id, 'messages', msg.id), {
      reactions: current,
      updatedAt: serverTimestamp(),
    });
  };

  const handlePin = async (msg: ChatMessage) => {
    if (!selectedConv) return;
    await updateDoc(doc(db, 'conversations', selectedConv.id, 'messages', msg.id), {
      pinned: !msg.pinned,
      updatedAt: serverTimestamp(),
    });
  };

  const handleDeleteMsg = async (msg: ChatMessage) => {
    if (!selectedConv) return;
    await updateDoc(doc(db, 'conversations', selectedConv.id, 'messages', msg.id), {
      deleted: true,
      ciphertext: 'deleted',
      updatedAt: serverTimestamp(),
    });
  };

  const handleBookmarkMsg = async (msg: ChatMessage) => {
    if (!firebaseUser) return;
    await addDoc(collection(db, 'bookmarks'), {
      ownerUid: firebaseUser.uid,
      targetType: 'message',
      targetId: msg.id,
      title: `Message from ${msg.senderName || 'Member'}`,
      snippet: (msg.decryptedText || '').slice(0, 200),
      createdAt: serverTimestamp(),
    });
    showToast('Bookmarked', 'Message snippet saved to your personal bookmarks.', 'success');
  };

  const handleReportSubmit = async () => {
    if (!firebaseUser || !reportingMsg || !reportReason.trim()) return;
    await addDoc(collection(db, 'reports'), {
      reporterUid: firebaseUser.uid,
      targetType: 'message',
      targetId: reportingMsg.id,
      reason: reportReason.trim(),
      submittedEvidence: `Sender ${reportingMsg.senderName || reportingMsg.senderUid}: ${(reportingMsg.decryptedText || '').slice(0, 1000)}`,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setReportingMsg(null);
    setReportReason('');
    showToast('Report submitted', 'Your submitted evidence has been sent to moderation.', 'success');
  };

  const getConvDisplayTitle = (c: Conversation) => {
    if (c.type === 'group') return c.title || 'Group Chat';
    const peerUid = c.memberUids.find((u) => u !== firebaseUser?.uid) || '';
    return usersMap[peerUid]?.displayName || 'Direct Message';
  };

  const getPeerUid = (c: Conversation) => c.memberUids.find((u) => u !== firebaseUser?.uid) || '';

  const visibleConvs = conversations.filter((c) => {
    const isArchived = c.archivedBy?.includes(firebaseUser?.uid || '');
    return showArchived ? isArchived : !isArchived;
  });

  const filteredMessages = localSearch.trim()
    ? messages.filter((m) =>
        (m.decryptedText || '').toLowerCase().includes(localSearch.trim().toLowerCase())
      )
    : messages;

  const pinnedMessage = messages.find((m) => m.pinned && !m.deleted);
  const wallpaperClass = CHAT_WALLPAPERS.find((w) => w.id === chatWallpaper)?.className || '';

  return (
    <div className="h-[calc(100dvh-8.5rem-env(safe-area-inset-bottom))] sm:h-[calc(100dvh-9rem-env(safe-area-inset-bottom))] lg:h-[calc(100dvh-6.25rem)] min-h-[380px] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden grid lg:grid-cols-12">
      {/* Left Conversation List */}
      <aside className={`lg:col-span-4 border-r border-slate-200 dark:border-slate-800 flex flex-col ${selectedConv ? 'hidden lg:flex' : 'flex'}`}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Messages</h2>
            <p className="text-xs text-slate-500">End-to-end encrypted</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowNewDmModal(true)}
              className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Chat
            </button>
            <button
              type="button"
              onClick={() => setShowNewGroupModal(true)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 cursor-pointer"
            >
              <Users className="w-3.5 h-3.5" />
              Group
            </button>
          </div>
        </div>

        <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => setShowArchived(false)}
            className={`font-medium cursor-pointer ${!showArchived ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'}`}
          >
            Active ({conversations.filter((c) => !c.archivedBy?.includes(firebaseUser?.uid || '')).length})
          </button>
          <button
            type="button"
            onClick={() => setShowArchived(true)}
            className={`font-medium cursor-pointer ${showArchived ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'}`}
          >
            Archived ({conversations.filter((c) => c.archivedBy?.includes(firebaseUser?.uid || '')).length})
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
          {visibleConvs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No conversations here yet. Start an encrypted 1:1 chat or group.
            </div>
          ) : (
            visibleConvs.map((c) => {
              const peerUid = getPeerUid(c);
              const peerOnline = c.type === 'direct' && onlineUids.includes(peerUid);
              const isMuted = c.mutedBy?.includes(firebaseUser?.uid || '');
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedConvId(c.id)}
                  className={`w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer ${
                    selectedConvId === c.id ? 'bg-indigo-50/70 dark:bg-indigo-950/30' : ''
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-indigo-600/15 text-indigo-600 dark:text-indigo-300 flex items-center justify-center font-semibold text-sm shrink-0">
                    {c.type === 'group' ? <Users className="w-4 h-4" /> : getConvDisplayTitle(c).slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {getConvDisplayTitle(c)}
                      </p>
                      <Lock className="w-3 h-3 text-slate-400 shrink-0" />
                    </div>
                    <p className="text-xs text-slate-500 truncate">
                      {c.type === 'group'
                        ? `${c.memberUids.length} members · Key v${c.keyVersion}`
                        : peerOnline
                        ? 'Online now'
                        : 'Offline'}
                      {isMuted ? ' · Muted' : ''}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Right Chat Pane */}
      <section className={`lg:col-span-8 flex flex-col min-h-0 ${!selectedConv ? 'hidden lg:flex' : 'flex'}`}>
        {!selectedConv ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <Lock className="w-10 h-10 text-indigo-500 mb-3" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Select a conversation
            </h3>
            <p className="mt-1 text-xs text-slate-500 max-w-sm">
              Messages are encrypted in your browser using ECDH P-256 and AES-256-GCM before
              synchronization.
            </p>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setSelectedConvId(null)}
                  className="lg:hidden text-xs font-medium text-indigo-600"
                >
                  Back
                </button>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                    {getConvDisplayTitle(selectedConv)}
                  </h3>
                  <p className="text-xs text-slate-500 truncate">
                    {selectedConv.type === 'group'
                      ? `${selectedConv.memberUids.length} members · Key v${selectedConv.keyVersion}`
                      : onlineUids.includes(getPeerUid(selectedConv))
                      ? 'Online · E2EE Active'
                      : 'E2EE Active'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowSecurityModal(true)}
                  title="Encryption & Safety Numbers"
                  className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                </button>

                {selectedConv.type === 'direct' && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setActiveCallTarget({
                          uid: getPeerUid(selectedConv),
                          name: getConvDisplayTitle(selectedConv),
                          mode: 'audio',
                          isInitiator: true,
                        })
                      }
                      title="Voice Call"
                      className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                    >
                      <Phone className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setActiveCallTarget({
                          uid: getPeerUid(selectedConv),
                          name: getConvDisplayTitle(selectedConv),
                          mode: 'video',
                          isInitiator: true,
                        })
                      }
                      title="Video Call"
                      className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                    >
                      <Video className="w-4 h-4" />
                    </button>
                  </>
                )}

                {selectedConv.type === 'group' && (
                  <button
                    type="button"
                    onClick={() => setShowGroupPanel((v) => !v)}
                    title="Group Controls"
                    className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                  >
                    <UserPlus className="w-4 h-4" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={async () => {
                    if (!firebaseUser) return;
                    const current = selectedConv.mutedBy || [];
                    const next = current.includes(firebaseUser.uid)
                      ? current.filter((u) => u !== firebaseUser.uid)
                      : [...current, firebaseUser.uid];
                    await updateDoc(doc(db, 'conversations', selectedConv.id), {
                      mutedBy: next,
                      updatedAt: serverTimestamp(),
                    });
                  }}
                  title="Mute Conversation"
                  className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  <BellOff className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    if (!firebaseUser) return;
                    const current = selectedConv.archivedBy || [];
                    const next = current.includes(firebaseUser.uid)
                      ? current.filter((u) => u !== firebaseUser.uid)
                      : [...current, firebaseUser.uid];
                    await updateDoc(doc(db, 'conversations', selectedConv.id), {
                      archivedBy: next,
                      updatedAt: serverTimestamp(),
                    });
                  }}
                  title="Archive Conversation"
                  className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  <Archive className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Client-Side Message Search & Disappearing Timer Bar */}
            <div className="px-3 sm:px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 sm:gap-3 bg-slate-50/70 dark:bg-[#0B0F19]/40">
              <div className="flex items-center gap-2 flex-1 min-w-[140px] max-w-xs">
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  value={localSearch}
                  onChange={(e) => setLocalSearch(e.target.value)}
                  placeholder="Client-side search in chat..."
                  className="w-full bg-transparent text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Clock className="w-3.5 h-3.5" />
                <select
                  aria-label="Disappearing messages timer"
                  value={selectedConv.disappearingSeconds || 0}
                  onChange={async (e) => {
                    await updateDoc(doc(db, 'conversations', selectedConv.id), {
                      disappearingSeconds: Number(e.target.value),
                      updatedAt: serverTimestamp(),
                    });
                    showToast('Timer updated', 'New messages will follow the disappearing timer.', 'info');
                  }}
                  className="bg-transparent text-xs text-slate-700 dark:text-slate-300 focus:outline-none"
                >
                  <option value={0}>Disappearing: Off</option>
                  <option value={60}>Disappearing: 1m</option>
                  <option value={3600}>Disappearing: 1h</option>
                  <option value={86400}>Disappearing: 24h</option>
                </select>
              </div>
            </div>

            {/* Group Announcement / Pinned Banner */}
            {selectedConv.announcement && (
              <div className="px-4 py-2 bg-indigo-50 dark:bg-indigo-950/40 border-b border-indigo-200 dark:border-indigo-900/50 text-xs text-indigo-800 dark:text-indigo-200">
                Announcement: {selectedConv.announcement}
              </div>
            )}
            {pinnedMessage && (
              <div className="px-4 py-2 bg-slate-100 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                <span className="truncate text-slate-700 dark:text-slate-200">
                  <Pin className="w-3 h-3 inline mr-1.5 text-indigo-500" />
                  Pinned: {pinnedMessage.decryptedText}
                </span>
                <button
                  type="button"
                  onClick={() => handlePin(pinnedMessage)}
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-white ml-2"
                >
                  Unpin
                </button>
              </div>
            )}

            {/* Optional Group Member Management Drawer */}
            {showGroupPanel && selectedConv.type === 'group' && (
              <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F19] space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900 dark:text-white">
                    Group Administration &amp; Key Rotation
                  </span>
                  <button type="button" onClick={() => setShowGroupPanel(false)} className="text-slate-400">
                    Close
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedConv.memberUids.map((mUid) => (
                    <span
                      key={mUid}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      {usersMap[mUid]?.displayName || mUid.slice(0, 8)}
                      {mUid !== firebaseUser?.uid && selectedConv.adminUids.includes(firebaseUser?.uid || '') && (
                        <button
                          type="button"
                          onClick={() =>
                            rotateGroupKeyWithMembers(
                              selectedConv,
                              selectedConv.memberUids.filter((u) => u !== mUid)
                            )
                          }
                          className="text-red-500 hover:underline ml-1"
                        >
                          Remove
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                {selectedConv.adminUids.includes(firebaseUser?.uid || '') && (
                  <div className="flex items-center gap-2">
                    <select
                      aria-label="Add member to group"
                      onChange={(e) => {
                        if (!e.target.value) return;
                        const next = Array.from(new Set([...selectedConv.memberUids, e.target.value]));
                        rotateGroupKeyWithMembers(selectedConv, next);
                        e.target.value = '';
                      }}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs"
                    >
                      <option value="">+ Add member &amp; rotate group key...</option>
                      {Object.values(usersMap)
                        .filter((u) => !selectedConv.memberUids.includes(u.uid))
                        .map((u) => (
                          <option key={u.uid} value={u.uid}>
                            {u.displayName} (@{u.username})
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Message Feed */}
            <div className={`flex-1 overflow-y-auto p-4 space-y-3 ${wallpaperClass}`}>
              {filteredMessages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-500">
                  No messages yet. Say hello — everything sent here is encrypted on your device.
                </div>
              ) : (
                filteredMessages.map((m) => {
                  const isMine = m.senderUid === firebaseUser?.uid;
                  const replyTarget = m.replyToId ? messages.find((x) => x.id === m.replyToId) : null;
                  return (
                    <div
                      key={m.id}
                      className={`group flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[82%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 text-sm ${
                          isMine
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {!isMine && (
                          <p className="text-[11px] font-semibold opacity-75 mb-1">
                            {m.senderName || 'Member'}
                          </p>
                        )}

                        {replyTarget && (
                          <div className="mb-1.5 rounded-lg bg-black/15 px-2.5 py-1 text-xs opacity-85 truncate">
                            Replying to: {replyTarget.decryptedText}
                          </div>
                        )}

                        {m.deleted ? (
                          <p className="italic opacity-70 text-xs">This message was deleted.</p>
                        ) : m.type === 'image' && m.decryptedText?.startsWith('data:image') ? (
                          <img
                            src={m.decryptedText}
                            alt={m.attachmentMeta?.fileName || 'Encrypted image'}
                            className="max-h-64 rounded-lg object-contain"
                          />
                        ) : m.type === 'voice' && m.decryptedText?.startsWith('data:audio') ? (
                          <audio controls src={m.decryptedText} className="max-w-xs h-9" />
                        ) : m.type === 'file' && m.decryptedText?.startsWith('data:') ? (
                          <a
                            href={m.decryptedText}
                            download={m.attachmentMeta?.fileName || 'file'}
                            className="underline text-xs font-medium"
                          >
                            Download {m.attachmentMeta?.fileName || 'Attachment'}
                          </a>
                        ) : m.type === 'poll' && m.pollOptions ? (
                          <div className="space-y-2 min-w-0 w-full sm:min-w-[220px]">
                            <p className="font-semibold text-sm">{m.pollQuestion || m.decryptedText}</p>
                            {m.pollOptions.map((opt) => {
                              const totalVotes = m.pollOptions!.reduce((s, o) => s + o.voterUids.length, 0);
                              const pct = totalVotes ? Math.round((opt.voterUids.length / totalVotes) * 100) : 0;
                              const voted = opt.voterUids.includes(firebaseUser?.uid || '');
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={() => handleVotePoll(m, opt.id)}
                                  className={`w-full text-left px-3 py-1.5 rounded-lg border text-xs flex items-center justify-between cursor-pointer ${
                                    voted ? 'border-white/70 bg-white/15' : 'border-white/20 bg-black/10'
                                  }`}
                                >
                                  <span>{opt.text}</span>
                                  <span className="font-mono tabular-nums">{pct}%</span>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap break-words leading-relaxed">
                            {m.decryptedText}
                          </p>
                        )}

                        <div className="mt-1 flex items-center justify-end gap-2 text-[10px] opacity-70">
                          {m.e2ee && <span>E2EE</span>}
                          {m.edited && <span>Edited</span>}
                          {m.pinned && <span>Pinned</span>}
                        </div>
                      </div>

                      {/* Reactions row */}
                      {m.reactions && Object.keys(m.reactions).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {Object.entries(m.reactions)
                            .filter(([, uids]) => uids.length > 0)
                            .map(([emoji, uids]) => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => handleReaction(m, emoji)}
                                className="px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs cursor-pointer"
                              >
                                {emoji} {uids.length}
                              </button>
                            ))}
                        </div>
                      )}

                      {/* Message Actions (always accessible on touch devices, hover-revealed on desktop) */}
                      {!m.deleted && (
                        <div className="mt-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex flex-wrap items-center gap-1 text-slate-400">
                          {REACTION_EMOJIS.map((em) => (
                            <button
                              key={em}
                              type="button"
                              onClick={() => handleReaction(m, em)}
                              className="px-1 text-xs hover:scale-110 cursor-pointer"
                            >
                              {em}
                            </button>
                          ))}
                          <button type="button" onClick={() => setReplyTo(m)} title="Reply" className="p-1 hover:text-indigo-500 cursor-pointer">
                            <Reply className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => handlePin(m)} title="Pin" className="p-1 hover:text-indigo-500 cursor-pointer">
                            <Pin className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => handleBookmarkMsg(m)} title="Bookmark" className="p-1 hover:text-indigo-500 cursor-pointer">
                            <Bookmark className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => setForwardingMsg(m)} title="Forward" className="p-1 hover:text-indigo-500 cursor-pointer">
                            <Forward className="w-3.5 h-3.5" />
                          </button>
                          {isMine ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMsg(m);
                                  setDraft(m.decryptedText || '');
                                }}
                                title="Edit"
                                className="p-1 hover:text-indigo-500 cursor-pointer"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteMsg(m)}
                                title="Delete"
                                className="p-1 hover:text-red-500 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setReportingMsg(m)}
                              title="Report Message"
                              className="p-1 hover:text-red-500 cursor-pointer"
                            >
                              <Flag className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Typing Indicator */}
            {Object.keys(typingUsers).length > 0 && (
              <div className="px-4 py-1 text-xs text-slate-500">
                {Object.values(typingUsers).join(', ')} typing...
              </div>
            )}

            {/* Reply / Edit Banner */}
            {(replyTo || editingMsg) && (
              <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F19] flex items-center justify-between text-xs">
                <span className="truncate text-slate-600 dark:text-slate-300">
                  {editingMsg ? 'Editing message' : `Replying to: ${replyTo?.decryptedText}`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setReplyTo(null);
                    setEditingMsg(null);
                    setDraft('');
                  }}
                  className="text-slate-400 hover:text-slate-700"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Composer */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage(draft, 'text');
              }}
              className="p-2 sm:p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-1 sm:gap-2"
            >
              <label className="p-1.5 sm:p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer shrink-0" title="Attach encrypted image or file">
                <Paperclip className="w-4 h-4" />
                <input type="file" onChange={handleAttachment} className="hidden" />
              </label>

              <button
                type="button"
                onClick={toggleVoiceRecording}
                title={recording ? 'Stop recording' : 'Record voice message'}
                className={`p-1.5 sm:p-2 rounded-lg cursor-pointer shrink-0 ${
                  recording
                    ? 'bg-red-600 text-white'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500'
                }`}
              >
                {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>

              {selectedConv.type === 'group' && (
                <button
                  type="button"
                  onClick={() => setShowPollModal(true)}
                  title="Create Group Poll"
                  className="p-1.5 sm:p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer shrink-0"
                >
                  <BarChart2 className="w-4 h-4" />
                </button>
              )}

              <button
                type="button"
                onClick={() => setDraft((d) => `${d} 😊`)}
                title="Insert emoji"
                className="hidden sm:inline-flex p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer shrink-0"
              >
                <Smile className="w-4 h-4" />
              </button>

              <input
                type="text"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  wsSend({ type: 'typing:start', roomId: `conv:${selectedConv.id}` });
                  if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                  typingTimeoutRef.current = setTimeout(() => {
                    wsSend({ type: 'typing:stop', roomId: `conv:${selectedConv.id}` });
                  }, 1800);
                }}
                placeholder="Write a message..."
                className="flex-1 min-w-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F19] px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />

              <button
                type="submit"
                className="px-3 sm:px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Send</span>
              </button>
            </form>
          </>
        )}
      </section>

      {/* Modal: New Direct Chat */}
      {showNewDmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Start Encrypted Chat</h3>
              <button type="button" onClick={() => setShowNewDmModal(false)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {Object.values(usersMap)
                .filter((u) => u.uid !== firebaseUser?.uid)
                .map((u) => (
                  <button
                    key={u.uid}
                    type="button"
                    onClick={() => openOrCreateDirectChat(u.uid)}
                    className="w-full py-2.5 px-2 flex items-center justify-between text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-lg cursor-pointer"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{u.displayName}</p>
                      <p className="text-xs text-slate-500">@{u.username}</p>
                    </div>
                    <span className="text-xs text-indigo-600 dark:text-indigo-400">Message</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal: New Group */}
      {showNewGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Create Encrypted Group</h3>
              <button type="button" onClick={() => setShowNewGroupModal(false)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder="Group name (e.g. CS-301 Study Pod)"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={groupDesc}
              onChange={(e) => setGroupDesc(e.target.value)}
              placeholder="Description (optional)"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"
            />
            <div className="max-h-40 overflow-y-auto space-y-1">
              {Object.values(usersMap)
                .filter((u) => u.uid !== firebaseUser?.uid)
                .map((u) => (
                  <label key={u.uid} className="flex items-center gap-2 text-xs py-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={groupMemberUids.includes(u.uid)}
                      onChange={(e) =>
                        setGroupMemberUids((prev) =>
                          e.target.checked ? [...prev, u.uid] : prev.filter((id) => id !== u.uid)
                        )
                      }
                    />
                    <span>{u.displayName} (@{u.username})</span>
                  </label>
                ))}
            </div>
            <button
              type="button"
              onClick={handleCreateGroup}
              className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer"
            >
              Create Group &amp; Distribute Keys
            </button>
          </div>
        </div>
      )}

      {/* Modal: Group Poll */}
      {showPollModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Create Group Poll</h3>
            <input
              type="text"
              value={pollQuestion}
              onChange={(e) => setPollQuestion(e.target.value)}
              placeholder="Poll question..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"
            />
            <textarea
              rows={4}
              value={pollOptionsText}
              onChange={(e) => setPollOptionsText(e.target.value)}
              placeholder="One option per line"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowPollModal(false)} className="px-3 py-1.5 text-xs">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreatePoll}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold cursor-pointer"
              >
                Post Poll
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Encryption Transparency & Safety Numbers */}
      {showSecurityModal && selectedConv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Encryption &amp; Metadata Transparency
              </h3>
              <button type="button" onClick={() => setShowSecurityModal(false)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-xs space-y-2 text-slate-600 dark:text-slate-300">
              <p>
                <strong>Protocol:</strong> {BRAND_CONFIG.e2eeProtocolName}
              </p>
              <p>
                <strong>Your Device Key Fingerprint:</strong>
                <br />
                <span className="font-mono text-indigo-500">{keyBundle?.fingerprint || 'Generating...'}</span>
              </p>
              {selectedConv.type === 'direct' && userKeysMap[getPeerUid(selectedConv)] && (
                <p>
                  <strong>Peer Key Fingerprint:</strong>
                  <br />
                  <span className="font-mono text-emerald-500">
                    {userKeysMap[getPeerUid(selectedConv)].fingerprint}
                  </span>
                </p>
              )}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                <p className="font-semibold text-slate-900 dark:text-white mb-1">
                  Metadata visible to server:
                </p>
                <ul className="list-disc pl-4 space-y-1">
                  {BRAND_CONFIG.visibleMetadataNotice.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Forward Message */}
      {forwardingMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Forward Message To</h3>
              <button type="button" onClick={() => setForwardingMsg(null)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={async () => {
                    const key = convKeys[c.id];
                    let ciphertext = forwardingMsg.decryptedText || '';
                    let iv = '';
                    let e2ee = false;
                    if (key) {
                      const enc = await encryptText(key, ciphertext);
                      ciphertext = enc.ciphertext;
                      iv = enc.iv;
                      e2ee = true;
                    }
                    await setDoc(
                      doc(db, 'conversations', c.id, 'messages', `fwd_${crypto.randomUUID().slice(0, 12)}`),
                      {
                        convId: c.id,
                        senderUid: firebaseUser!.uid,
                        senderName: publicProfile?.displayName || 'Member',
                        type: 'text',
                        e2ee,
                        ciphertext,
                        iv,
                        keyVersion: c.keyVersion,
                        memberUids: c.memberUids,
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                      }
                    );
                    setForwardingMsg(null);
                    showToast('Forwarded', `Sent to ${getConvDisplayTitle(c)}.`, 'success');
                  }}
                  className="w-full py-2 text-left text-xs hover:text-indigo-500 cursor-pointer"
                >
                  {getConvDisplayTitle(c)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Explicit Evidence Report */}
      {reportingMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Report Encrypted Message
            </h3>
            <p className="text-xs text-slate-500">
              Moderators cannot access E2EE conversations. Submitting this report explicitly shares
              only this selected message text as evidence.
            </p>
            <div className="rounded-lg bg-slate-100 dark:bg-slate-900 p-2.5 text-xs text-slate-700 dark:text-slate-300">
              "{reportingMsg.decryptedText}"
            </div>
            <textarea
              rows={3}
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="Describe the safety or policy concern..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setReportingMsg(null)} className="px-3 py-1.5 text-xs">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReportSubmit}
                className="px-4 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold cursor-pointer"
              >
                Submit Evidence &amp; Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
