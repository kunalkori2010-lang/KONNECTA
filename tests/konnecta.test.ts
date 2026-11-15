import { describe, expect, it } from 'vitest';
import http from 'http';
import fs from 'fs';
import path from 'path';
import {
  bufToB64,
  b64ToBuf,
  computeFingerprint,
  deriveDirectConversationKey,
  encryptText,
  decryptText,
  generateGroupAesKey,
  wrapGroupKeyForMember,
  unwrapGroupKeyFromSender,
  encryptForVault,
  decryptFromVault,
} from '../src/lib/crypto';
import { createApp } from '../server';

describe('KONNECTA WebCrypto E2EE & Vault Cryptography', () => {
  it('encodes and decodes base64 buffers roundtrip', () => {
    const sample = new Uint8Array([1, 2, 3, 250, 255, 0, 42]);
    const b64 = bufToB64(sample);
    const decoded = b64ToBuf(b64);
    expect(Array.from(decoded)).toEqual(Array.from(sample));
  });

  it('derives matching 1:1 ECDH P-256 + HKDF AES-256-GCM keys for Alice and Bob', async () => {
    const alice = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );
    const bob = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );

    const alicePubStr = JSON.stringify(await crypto.subtle.exportKey('jwk', alice.publicKey));
    const bobPubStr = JSON.stringify(await crypto.subtle.exportKey('jwk', bob.publicKey));

    const convId = 'dm_alice_bob';
    const aliceKey = await deriveDirectConversationKey(alice.privateKey, bobPubStr, convId);
    const bobKey = await deriveDirectConversationKey(bob.privateKey, alicePubStr, convId);

    const secretText = 'Meet in Study Room 4B at 18:00!';
    const { ciphertext, iv } = await encryptText(aliceKey, secretText);
    expect(ciphertext).not.toContain(secretText);

    const decrypted = await decryptText(bobKey, ciphertext, iv);
    expect(decrypted).toBe(secretText);

    const fp = await computeFingerprint(alicePubStr);
    expect(fp).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4}){5}$/);
  });

  it('wraps and unwraps group AES-256-GCM conversation keys across members', async () => {
    const sender = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );
    const member = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );

    const senderPub = JSON.stringify(await crypto.subtle.exportKey('jwk', sender.publicKey));
    const memberPub = JSON.stringify(await crypto.subtle.exportKey('jwk', member.publicKey));

    const groupKey = await generateGroupAesKey();
    const convId = 'grp_cs401';
    const wrapped = await wrapGroupKeyForMember(groupKey, sender.privateKey, memberPub, convId);
    const unwrappedKey = await unwrapGroupKeyFromSender(
      wrapped.wrappedKey,
      wrapped.iv,
      member.privateKey,
      senderPub,
      convId
    );

    const msg = 'Group exam review slides encrypted';
    const { ciphertext, iv } = await encryptText(groupKey, msg);
    const decrypted = await decryptText(unwrappedKey, ciphertext, iv);
    expect(decrypted).toBe(msg);
  });

  it('encrypts Personal Vault payloads with PBKDF2 + AES-GCM and rejects wrong passphrases', async () => {
    const passphrase = 'correct-horse-battery-staple';
    const secretNote = 'Zero-knowledge personal journal entry #1';
    const sealed = await encryptForVault(passphrase, secretNote);

    const opened = await decryptFromVault(passphrase, sealed.encryptedPayload, sealed.iv, sealed.salt);
    expect(opened).toBe(secretNote);

    await expect(
      decryptFromVault('wrong-passphrase', sealed.encryptedPayload, sealed.iv, sealed.salt)
    ).rejects.toThrow();
  });
});

describe('KONNECTA Server API & Security Guardrails', () => {
  it('serves /api/health and enforces auth on /api/ai/study', async () => {
    const app = createApp();
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      server.close();
      throw new Error('Unexpected server address');
    }
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const healthRes = await fetch(`${baseUrl}/api/health`);
      expect(healthRes.status).toBe(200);
      const healthJson = (await healthRes.json()) as { status: string; service: string };
      expect(healthJson.status).toBe('ok');
      expect(healthJson.service).toBe('konnecta-server');

      const aiRes = await fetch(`${baseUrl}/api/ai/study`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'summarize',
          content: 'Sample physics lecture notes on thermodynamics.',
          consentGranted: true,
        }),
      });
      expect(aiRes.status).toBe(401);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('maintains hardened Firestore security rules with default deny and owner-only PII/Vault', () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
    expect(rules).toContain('match /{document=**} {\n      allow read, write: if false;');
    expect(rules).toContain('request.auth.token.email_verified == true');
    expect(rules).toContain('match /vault_items/{itemId}');
    expect(rules).toContain('match /users_private/{uid}');
  });
});
