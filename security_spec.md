# KONNECTA Security Specification & Red-Team Payloads

## 1. Data Invariants
1. **PII Isolation**: User email, theme prefs, and notification schedules reside strictly in `users_private/{uid}` readable/writable only by `request.auth.uid == uid`. `users_public/{uid}` never stores PII.
2. **E2EE Confidentiality**: `conversations/{convId}/messages/{msgId}` stores client-encrypted `ciphertext` and `iv`. Only `memberUids` of `conversations/{convId}` can read or send messages. Administrators cannot read private conversations.
3. **Vault Zero-Knowledge**: `vault_items/{itemId}` can only be read, created, updated, or deleted by `resource.data.ownerUid == request.auth.uid` (and `incoming().ownerUid == request.auth.uid`), even admins cannot access vault items.
4. **Immutable Authorship & Timestamps**: `createdAt == request.time` on creation and `incoming().createdAt == existing().createdAt` on updates. Author/Owner/Creator UIDs are immutable after creation.
5. **No Shadow Fields**: Every `create` checks `keys().hasAll(...)` and `keys().hasOnly(...)`; every `update` uses action-based `affectedKeys().hasOnly(...)` combined with `isValid[Entity](incoming())`.
6. **Verified Identity**: All writes require `request.auth != null && request.auth.token.email_verified == true`.

## 2. Dirty Dozen Adversarial Payloads
1. **Identity Spoofing on Post**: `POST /posts/p1` with `authorUid: "victim_uid"` -> MUST return `PERMISSION_DENIED`.
2. **PII Leak Attempt**: `GET /users_private/other_uid` by authenticated non-owner -> MUST return `PERMISSION_DENIED`.
3. **Shadow Field Injection on Profile**: `POST /users_public/me` with extra field `isVerified: true` or `role: "admin"` -> MUST return `PERMISSION_DENIED`.
4. **Cross-Conversation Eavesdrop**: `GET /conversations/c1/messages/m1` where caller is not in `conversations/c1.memberUids` -> MUST return `PERMISSION_DENIED`.
5. **Vault Admin Snooping**: Admin attempts `GET /vault_items/v1` owned by another user -> MUST return `PERMISSION_DENIED`.
6. **Timestamp Backdating**: `POST /posts/p1` with `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time` -> MUST return `PERMISSION_DENIED`.
7. **ID Poisoning**: `POST /posts/<2000-char-id>` -> MUST return `PERMISSION_DENIED` (`isValidId` fails).
8. **Unverified Email Write**: Token with `email_verified: false` attempting `POST /posts/p1` -> MUST return `PERMISSION_DENIED`.
9. **Moderation Escalation**: Non-admin user updating `reports/r1` `status: "resolved"` -> MUST return `PERMISSION_DENIED`.
10. **Blanket List Query Scraping**: `LIST /vault_items` without `where('ownerUid', '==', auth.uid)` -> MUST return `PERMISSION_DENIED`.
11. **Value Poisoning on Update**: Updating `posts/p1.content` with a `boolean` or > 3000 chars -> MUST return `PERMISSION_DENIED`.
12. **Terminal State Bypass on Friend Request**: Updating `friend_requests/fr1` once `status` is `'accepted'` back to `'pending'` -> MUST return `PERMISSION_DENIED`.
