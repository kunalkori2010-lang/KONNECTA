import React, { useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, Volume2 } from 'lucide-react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useApp } from '../../context/AppContext';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export const CallOverlay: React.FC = () => {
  const {
    firebaseUser,
    publicProfile,
    incomingCall,
    setIncomingCall,
    activeCallTarget,
    setActiveCallTarget,
    wsSend,
    wsSubscribe,
    showToast,
  } = useApp();

  const [status, setStatus] = useState<string>('Connecting...');
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [networkQuality, setNetworkQuality] = useState<'Good' | 'Fair' | 'Checking'>('Checking');

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  const cleanupMedia = () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
  };

  const endCall = async (notifyPeer = true) => {
    if (notifyPeer && activeCallTarget) {
      wsSend({ type: 'call:hangup', targetUid: activeCallTarget.uid });
    }
    if (firebaseUser && activeCallTarget) {
      const duration = Math.round((Date.now() - startTimeRef.current) / 1000);
      try {
        await addDoc(collection(db, 'call_logs'), {
          callerUid: activeCallTarget.isInitiator ? firebaseUser.uid : activeCallTarget.uid,
          callerName: activeCallTarget.isInitiator
            ? publicProfile?.displayName || 'Me'
            : activeCallTarget.name,
          calleeUid: activeCallTarget.isInitiator ? activeCallTarget.uid : firebaseUser.uid,
          calleeName: activeCallTarget.isInitiator
            ? activeCallTarget.name
            : publicProfile?.displayName || 'Me',
          participantUids: [firebaseUser.uid, activeCallTarget.uid],
          mode: activeCallTarget.mode,
          status: 'ended',
          durationSeconds: duration,
          createdAt: serverTimestamp(),
        });
      } catch {
        // Non-blocking call log failure
      }
    }
    cleanupMedia();
    setActiveCallTarget(null);
    setElapsedSec(0);
  };

  useEffect(() => {
    if (!activeCallTarget || !firebaseUser) return;
    let cancelled = false;
    startTimeRef.current = Date.now();

    const startWebRTC = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: activeCallTarget.mode === 'video',
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        const pc = new RTCPeerConnection(ICE_SERVERS);
        pcRef.current = pc;

        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        pc.ontrack = (event) => {
          if (remoteVideoRef.current && event.streams[0]) {
            remoteVideoRef.current.srcObject = event.streams[0];
          }
          setStatus('Connected');
          setNetworkQuality('Good');
        };

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            wsSend({
              type: 'call:ice',
              targetUid: activeCallTarget.uid,
              candidate: event.candidate.toJSON(),
            });
          }
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'connected') {
            setStatus('Connected');
            setNetworkQuality('Good');
          } else if (pc.connectionState === 'disconnected') {
            setStatus('Reconnecting...');
            setNetworkQuality('Fair');
          } else if (pc.connectionState === 'failed') {
            setStatus('Connection interrupted');
          }
        };

        if (activeCallTarget.isInitiator) {
          setStatus('Ringing...');
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          wsSend({
            type: 'call:ring',
            targetUid: activeCallTarget.uid,
            mode: activeCallTarget.mode,
            offer,
          });
        } else if (activeCallTarget.offer) {
          await pc.setRemoteDescription(new RTCSessionDescription(activeCallTarget.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          wsSend({
            type: 'call:answer',
            targetUid: activeCallTarget.uid,
            answer,
          });
          setStatus('Connecting peer...');
        }
      } catch (err: unknown) {
        const msg =
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'Microphone/Camera permission was denied by your browser.'
            : 'Unable to access media devices for this call.';
        showToast('Call Media Error', msg, 'error');
        cleanupMedia();
        setActiveCallTarget(null);
      }
    };

    startWebRTC();

    const unsub = wsSubscribe(async (msg) => {
      const pc = pcRef.current;
      if (!pc) return;
      if (msg.type === 'call:answer' && msg.answer && msg.fromUid === activeCallTarget.uid) {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.answer as RTCSessionDescriptionInit));
        setStatus('Connected');
        setNetworkQuality('Good');
      } else if (msg.type === 'call:ice' && msg.candidate && msg.fromUid === activeCallTarget.uid) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(msg.candidate as RTCIceCandidateInit));
        } catch {
          // Ignore stale ICE candidates
        }
      } else if (
        (msg.type === 'call:hangup' || msg.type === 'call:decline') &&
        msg.fromUid === activeCallTarget.uid
      ) {
        showToast('Call ended', `${activeCallTarget.name} ended the call.`, 'info');
        cleanupMedia();
        setActiveCallTarget(null);
      }
    });

    const timer = setInterval(() => {
      setElapsedSec((s) => s + 1);
    }, 1000);

    return () => {
      cancelled = true;
      unsub();
      clearInterval(timer);
      cleanupMedia();
    };
  }, [activeCallTarget, firebaseUser, wsSend, wsSubscribe, showToast, setActiveCallTarget]);

  const toggleMute = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setMuted(!track.enabled);
    }
  };

  const toggleCamera = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setCameraOff(!track.enabled);
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Incoming Call Banner
  if (incomingCall && !activeCallTarget) {
    return (
      <div className="fixed top-3 left-3 right-3 sm:left-auto sm:right-4 z-50 sm:w-80 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] p-4 shadow-2xl">
        <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
          Incoming {incomingCall.mode === 'video' ? 'Video' : 'Voice'} Call
        </p>
        <p className="mt-1 text-base font-semibold text-slate-900 dark:text-white">
          {incomingCall.fromName}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveCallTarget({
                uid: incomingCall.fromUid,
                name: incomingCall.fromName,
                mode: incomingCall.mode,
                isInitiator: false,
                offer: incomingCall.offer,
              });
              setIncomingCall(null);
            }}
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
          >
            <Phone className="w-3.5 h-3.5" />
            Accept
          </button>
          <button
            type="button"
            onClick={() => {
              wsSend({ type: 'call:decline', targetUid: incomingCall.fromUid });
              setIncomingCall(null);
            }}
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            Decline
          </button>
        </div>
      </div>
    );
  }

  if (!activeCallTarget) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4">
      <div className="w-full max-w-2xl max-h-[92dvh] overflow-y-auto rounded-2xl border border-slate-800 bg-[#0B0F19] text-white shadow-2xl">
        <div className="px-4 sm:px-5 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="min-w-0">
            <span className="font-semibold text-sm">{activeCallTarget.name}</span>
            <span className="ml-2 text-slate-400">
              {status} · <span className="font-mono tabular-nums">{formatDuration(elapsedSec)}</span>
            </span>
          </div>
          <span className="text-slate-400">Network: {networkQuality}</span>
        </div>

        <div className="relative h-56 sm:h-80 md:h-96 bg-slate-950 flex items-center justify-center">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={`w-full h-full object-cover ${activeCallTarget.mode === 'audio' ? 'hidden' : ''}`}
          />
          {activeCallTarget.mode === 'audio' && (
            <div className="text-center px-4">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center mx-auto text-xl sm:text-2xl font-bold text-indigo-300">
                {activeCallTarget.name.slice(0, 1).toUpperCase()}
              </div>
              <p className="mt-3 text-sm font-medium">{activeCallTarget.name}</p>
              <p className="mt-1 text-xs text-slate-400">WebRTC Peer-to-Peer Audio</p>
            </div>
          )}

          {activeCallTarget.mode === 'video' && (
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="absolute bottom-3 right-3 w-24 h-16 sm:w-36 sm:h-24 rounded-xl object-cover border border-slate-700 bg-slate-900"
            />
          )}
        </div>

        <div className="px-4 sm:px-6 py-4 flex flex-wrap items-center justify-center gap-3 sm:gap-4 bg-[#111827]">
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
            className={`w-11 h-11 rounded-full flex items-center justify-center cursor-pointer ${
              muted ? 'bg-red-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
            }`}
          >
            {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          {activeCallTarget.mode === 'video' && (
            <button
              type="button"
              onClick={toggleCamera}
              aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
              className={`w-11 h-11 rounded-full flex items-center justify-center cursor-pointer ${
                cameraOff ? 'bg-red-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
              }`}
            >
              {cameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              const vid = remoteVideoRef.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null;
              if (vid && typeof vid.setSinkId === 'function') {
                showToast('Speaker output', 'Using default system audio output device.', 'info');
              } else {
                showToast('Audio output', 'Speaker routing is controlled by your OS/browser.', 'info');
              }
            }}
            aria-label="Audio output info"
            className="w-11 h-11 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center cursor-pointer"
          >
            <Volume2 className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => endCall(true)}
            aria-label="Leave call"
            className="px-5 h-11 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
          >
            <PhoneOff className="w-4 h-4" />
            End Call
          </button>
        </div>
      </div>
    </div>
  );
};
