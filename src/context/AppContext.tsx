import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  limit,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleAuthProvider,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import { ensureDeviceKeyPair, LocalKeyBundle } from '../lib/crypto';
import { ACCENT_PRESETS, BRAND_CONFIG } from '../config/brand';
import { NotificationItem, UserPrivate, UserPublic } from '../types/konnecta';

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  tone: 'info' | 'success' | 'error';
}

export interface IncomingCall {
  fromUid: string;
  fromName: string;
  mode: 'audio' | 'video';
  offer?: RTCSessionDescriptionInit;
  roomId?: string;
}

interface AppContextValue {
  firebaseUser: User | null;
  authReady: boolean;
  publicProfile: UserPublic | null;
  privateProfile: UserPrivate | null;
  profileLoaded: boolean;
  keyBundle: LocalKeyBundle | null;
  deviceId: string;
  onlineUids: string[];
  notifications: NotificationItem[];
  unreadNotifCount: number;
  isAdmin: boolean;
  theme: 'dark' | 'light' | 'system';
  accentColor: string;
  fontSize: 'sm' | 'md' | 'lg';
  reducedMotion: boolean;
  chatWallpaper: string;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  getAuthToken: () => Promise<string | null>;
  updateThemePrefs: (prefs: Partial<UserPrivate>) => Promise<void>;
  wsSend: (payload: Record<string, unknown>) => void;
  wsSubscribe: (handler: (msg: Record<string, unknown>) => void) => () => void;
  toasts: ToastMessage[];
  showToast: (title: string, description?: string, tone?: ToastMessage['tone']) => void;
  dismissToast: (id: string) => void;
  incomingCall: IncomingCall | null;
  setIncomingCall: (call: IncomingCall | null) => void;
  activeCallTarget: { uid: string; name: string; mode: 'audio' | 'video'; isInitiator: boolean; offer?: RTCSessionDescriptionInit } | null;
  setActiveCallTarget: (t: AppContextValue['activeCallTarget']) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

function getOrCreateLocalDeviceId(): string {
  const existing = localStorage.getItem('konnecta_device_id');
  if (existing && /^[a-zA-Z0-9_-]{6,64}$/.test(existing)) return existing;
  const created = `dev_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  localStorage.setItem('konnecta_device_id', created);
  return created;
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [publicProfile, setPublicProfile] = useState<UserPublic | null>(null);
  const [privateProfile, setPrivateProfile] = useState<UserPrivate | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [keyBundle, setKeyBundle] = useState<LocalKeyBundle | null>(null);
  const [onlineUids, setOnlineUids] = useState<string[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [activeCallTarget, setActiveCallTarget] = useState<AppContextValue['activeCallTarget']>(null);
  const [deviceId] = useState<string>(() => getOrCreateLocalDeviceId());

  // Local fallback theme state prior to sign-in
  const [localTheme, setLocalTheme] = useState<'dark' | 'light' | 'system'>(() => {
    const saved = localStorage.getItem('konnecta_theme');
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'dark';
  });

  const wsRef = useRef<WebSocket | null>(null);
  const wsHandlersRef = useRef<Set<(msg: Record<string, unknown>) => void>>(new Set());

  const showToast = useCallback(
    (title: string, description?: string, tone: ToastMessage['tone'] = 'info') => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev.slice(-3), { id, title, description, tone }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const theme = privateProfile?.theme || localTheme;
  const accentColor = privateProfile?.accentColor || ACCENT_PRESETS[0].primary;
  const fontSize = privateProfile?.fontSize || 'md';
  const reducedMotion = privateProfile?.reducedMotion || false;
  const chatWallpaper = privateProfile?.chatWallpaper || 'none';

  // Sync DOM theme attributes
  useEffect(() => {
    const root = document.documentElement;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = theme === 'dark' || (theme === 'system' && prefersDark);
    root.classList.toggle('dark', isDark);
    root.dataset.fontScale = fontSize;
    root.dataset.reducedMotion = reducedMotion ? 'true' : 'false';
    root.style.setProperty('--konnecta-accent', accentColor);
    localStorage.setItem('konnecta_theme', theme);
  }, [theme, accentColor, fontSize, reducedMotion]);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (!user) {
        setPublicProfile(null);
        setPrivateProfile(null);
        setProfileLoaded(true);
        setKeyBundle(null);
        setNotifications([]);
      } else {
        setProfileLoaded(false);
      }
    });
    return () => unsub();
  }, []);

  // Load profiles, E2EE keys, devices, and notifications when authenticated
  useEffect(() => {
    if (!authReady || !firebaseUser) return;

    const uid = firebaseUser.uid;
    let unsubPub: (() => void) | undefined;
    let unsubPriv: (() => void) | undefined;
    let unsubNotif: (() => void) | undefined;

    unsubPub = onSnapshot(
      doc(db, 'users_public', uid),
      (snap) => {
        if (snap.exists()) {
          setPublicProfile(snap.data() as UserPublic);
        } else {
          setPublicProfile(null);
        }
        setProfileLoaded(true);
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users_public/${uid}`)
    );

    unsubPriv = onSnapshot(
      doc(db, 'users_private', uid),
      async (snap) => {
        if (snap.exists()) {
          setPrivateProfile(snap.data() as UserPrivate);
        } else if (firebaseUser.email) {
          try {
            await setDoc(doc(db, 'users_private', uid), {
              uid,
              email: firebaseUser.email,
              theme: localTheme,
              accentColor: ACCENT_PRESETS[0].primary,
              fontSize: 'md',
              reducedMotion: false,
              chatWallpaper: 'none',
              aiConsentGranted: false,
              quietHoursEnabled: false,
              quietHoursStart: '22:00',
              quietHoursEnd: '07:00',
              soundEnabled: true,
              lockScreenPreview: true,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } catch (e) {
            console.error('Failed creating users_private:', e);
          }
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users_private/${uid}`)
    );

    const notifQuery = query(
      collection(db, 'notifications'),
      where('recipientUid', '==', uid),
      limit(40)
    );
    unsubNotif = onSnapshot(
      notifQuery,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) }));
        rows.sort((a, b) => {
          const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
          const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
          return tb - ta;
        });
        setNotifications(rows);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
    );

    // Initialize local device E2EE keys & register public bundle
    const activeDeviceId = `${deviceId}_${uid.slice(0, 8)}`;
    (async () => {
      try {
        const bundle = await ensureDeviceKeyPair(uid);
        setKeyBundle(bundle);
        await setDoc(
          doc(db, 'user_keys', uid),
          {
            uid,
            ecdhPublicJwk: bundle.publicJwkString,
            fingerprint: bundle.fingerprint,
            keyVersion: 1,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        const ua = navigator.userAgent.includes('Mobile') ? 'Mobile Browser' : 'Desktop Browser';
        const deviceName = `${ua} (${navigator.platform || 'Web'})`;
        const devRef = doc(db, 'user_devices', activeDeviceId);
        const devSnap = await getDoc(devRef);
        if (!devSnap.exists()) {
          await setDoc(devRef, {
            uid,
            deviceName,
            fingerprint: bundle.fingerprint,
            revoked: false,
            lastActiveAt: serverTimestamp(),
            createdAt: serverTimestamp(),
          });
        } else {
          await updateDoc(devRef, {
            deviceName,
            fingerprint: bundle.fingerprint,
            lastActiveAt: serverTimestamp(),
          });
        }
      } catch (e) {
        console.error('Key initialization failed:', e);
      }
    })();

    return () => {
      unsubPub?.();
      unsubPriv?.();
      unsubNotif?.();
    };
  }, [authReady, firebaseUser, deviceId, localTheme]);

  // Connect authenticated WebSocket for real-time presence, typing, whiteboard, study rooms, and WebRTC signaling
  useEffect(() => {
    if (!firebaseUser) {
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectWs = async () => {
      if (cancelled) return;
      try {
        const token = await firebaseUser.getIdToken();
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const name = encodeURIComponent(
          publicProfile?.displayName || firebaseUser.displayName || 'Member'
        );
        const ws = new WebSocket(`${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}&name=${name}`);
        wsRef.current = ws;

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data) as Record<string, unknown>;
            if (msg.type === 'presence:list' && Array.isArray(msg.onlineUids)) {
              setOnlineUids(msg.onlineUids as string[]);
            } else if (msg.type === 'call:ring') {
              setIncomingCall({
                fromUid: String(msg.fromUid || ''),
                fromName: String(msg.fromName || 'KONNECTA User'),
                mode: msg.mode === 'video' ? 'video' : 'audio',
                offer: msg.offer as RTCSessionDescriptionInit | undefined,
              });
            }
            for (const handler of wsHandlersRef.current) {
              handler(msg);
            }
          } catch {
            // Ignore malformed socket frames
          }
        };

        ws.onclose = () => {
          if (!cancelled) {
            reconnectTimer = setTimeout(connectWs, 3000);
          }
        };
      } catch (e) {
        console.error('WS connect error:', e);
      }
    };

    connectWs();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [firebaseUser, publicProfile?.displayName]);

  const wsSend = useCallback((payload: Record<string, unknown>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const wsSubscribe = useCallback((handler: (msg: Record<string, unknown>) => void) => {
    wsHandlersRef.current.add(handler);
    return () => {
      wsHandlersRef.current.delete(handler);
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(auth, googleAuthProvider);
  }, []);

  const logout = useCallback(async () => {
    wsRef.current?.close();
    await signOut(auth);
    showToast('Signed out', 'Your session has been closed on this device.', 'info');
  }, [showToast]);

  const getAuthToken = useCallback(async () => {
    if (!auth.currentUser) return null;
    return auth.currentUser.getIdToken();
  }, []);

  const updateThemePrefs = useCallback(
    async (prefs: Partial<UserPrivate>) => {
      if (prefs.theme) setLocalTheme(prefs.theme);
      if (!firebaseUser) return;
      try {
        await setDoc(
          doc(db, 'users_private', firebaseUser.uid),
          { ...prefs, updatedAt: serverTimestamp() },
          { merge: true }
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users_private/${firebaseUser.uid}`);
      }
    },
    [firebaseUser]
  );

  const unreadNotifCount = notifications.filter((n) => !n.read).length;
  const isAdmin =
    Boolean(firebaseUser?.emailVerified) &&
    firebaseUser?.email?.toLowerCase() === BRAND_CONFIG.adminEmail.toLowerCase();

  return (
    <AppContext.Provider
      value={{
        firebaseUser,
        authReady,
        publicProfile,
        privateProfile,
        profileLoaded,
        keyBundle,
        deviceId: firebaseUser ? `${deviceId}_${firebaseUser.uid.slice(0, 8)}` : deviceId,
        onlineUids,
        notifications,
        unreadNotifCount,
        isAdmin,
        theme,
        accentColor,
        fontSize,
        reducedMotion,
        chatWallpaper,
        signInWithGoogle,
        logout,
        getAuthToken,
        updateThemePrefs,
        wsSend,
        wsSubscribe,
        toasts,
        showToast,
        dismissToast,
        incomingCall,
        setIncomingCall,
        activeCallTarget,
        setActiveCallTarget,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
