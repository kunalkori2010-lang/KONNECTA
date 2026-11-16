# KONNECTA — Connect. Share. Create. Grow.

KONNECTA is a privacy-focused social messaging, community, and study collaboration web application built with React, TypeScript, Tailwind CSS, Express, WebSockets, WebRTC, Firebase Auth, Cloud Firestore, and server-side Google Gemini AI study tools.

## Install App

- **Direct Install Link**: [Install KONNECTA](https://ais-pre-uxhhe2pgtrqj3guwpioqx6-922138648142.asia-east1.run.app/?install=1)
- **Repository**: https://github.com/kunalkori2010-lang/KONNECTA

## Key Capabilities & Architecture

- **Identity & Privacy Separation**: Google Sign-In via Firebase Auth (`email_verified` enforced in `firestore.rules`). Public profile fields (`users_public`) contain zero PII, while email addresses, theme settings, notification preferences, and AI consent flags reside in owner-only `users_private`.
- **Client-Side E2EE Messaging (`WebCrypto`)**:
  - 1:1 Direct Messages derive conversation keys via **ECDH P-256 + HKDF-SHA-256 + AES-256-GCM**, keeping private identity keys locally in IndexedDB.
  - Group Conversations generate random 256-bit AES-GCM keys wrapped per member (`conversations/{convId}/memberKeys/{uid}`), with admin key rotation.
  - Supports text, attachments, voice notes (`MediaRecorder`), polls, replies, edits, deletes, pins, disappearing message timers, safety number verification, and local offline queueing.
- **Real-Time Presence, Study Sync & WebRTC Calling**: Authenticated WebSocket server (`/ws` on port 3000) verifies Firebase ID tokens via `firebase-admin` and relays presence, typing indicators, Pomodoro timer sync, collaborative whiteboard deltas, and WebRTC signaling (with Google STUN servers).
- **Study Zone & Consent-Gated AI Assistant**: Course folders, resource previews/uploads, comments/corrections, collaborative Markdown notes, bookmarks, and explicit-consent Gemini AI summaries, revision notes, explanations, flip flashcards, and interactive quizzes via `/api/ai/study`.
- **Zero-Knowledge Personal Vault**: Encrypts private notes and documents client-side using **PBKDF2 (100,000 iterations, SHA-256) + AES-256-GCM** before persisting ciphertext, IV, and salt. Admin accounts are explicitly blocked by Firestore rules from reading `vault_items` or private messages.
- **Collaborative Whiteboard (`react-konva`)**, **Communities with QR Invites**, **Events & RSVPs**, **Stories (24h)**, **PWA Support**, **JSON Data Export**, **Account Deletion**, and **Safety & Moderation Centre**.

## Release Readiness & Security Disclosures

### Fully Implemented in This Build
- Firebase Auth + Firestore persistence across 25+ hardened collections and subcollections (`firestore.rules` validated by `@firebase/eslint-plugin-security-rules`).
- Client-side WebCrypto E2EE for 1:1 DMs, Groups, and PBKDF2-encrypted Personal Vault.
- Express + WebSocket `/ws` server with Firebase Admin token verification and server-side `/api/ai/study` (`gemini-4-hydrogen`) rate-limited endpoint.
- All workspace modules: Home/Moments, Messages, Friends, Stories, Communities, Study Zone, Study Rooms, Events, Whiteboard, Notifications/Call Logs, Personal Vault, Profile, Settings/Export/Deletion, Safety & Moderation, and PWA manifest/icons.

### Requires External Infrastructure or Formal Audit
- **TURN Relay Server**: WebRTC peer-to-peer calling currently uses public STUN (`stun.l.google.com:19302`); strict symmetric NAT or enterprise firewall traversal in production requires provisioning a dedicated TURN server.
- **Metadata Visibility**: While message contents and Vault payloads are encrypted client-side, Firestore still stores routing metadata (`senderUid`, `memberUids`, `convId`, timestamps, and public ECDH keys).
- **Cryptographic & Penetration Audit**: Client-side WebCrypto E2EE has unit test coverage but has not undergone an independent third-party cryptographic audit; do not claim Signal/WhatsApp-certified security guarantees without formal review.

## Local Development & Verification

```bash
npm install
npm run test
npx eslint firestore.rules
npm run lint
npm run build
npm run dev
```

Required environment variable in `.env` / runtime secrets (never committed or exposed to client):
- `GEMINI_API_KEY` — Enables `/api/ai/study` server endpoint.
- `APP_URL` — Hosting origin URL.
