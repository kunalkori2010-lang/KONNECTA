// Real Web Crypto API (ECDH P-256 + HKDF-SHA-256 + AES-256-GCM + PBKDF2)
// Private identity keys are persisted locally in IndexedDB and never leave the device.

const DB_NAME = 'konnecta_e2ee_keystore';
const STORE_NAME = 'keys';

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

export function b64ToBuf(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export async function computeFingerprint(jwkString: string): Promise<string> {
  const enc = new TextEncoder().encode(jwkString);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  const bytes = new Uint8Array(digest);
  const hex = Array.from(bytes.slice(0, 12))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.match(/.{1,4}/g)?.join(' ').toUpperCase() || hex;
}

export interface LocalKeyBundle {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwkString: string;
  fingerprint: string;
}

export async function ensureDeviceKeyPair(uid: string): Promise<LocalKeyBundle> {
  const storageKey = `ecdh_pair_${uid}`;
  try {
    const stored = await idbGet<{
      privateJwk: JsonWebKey;
      publicJwk: JsonWebKey;
      fingerprint: string;
    }>(storageKey);

    if (stored?.privateJwk && stored?.publicJwk) {
      const privateKey = await crypto.subtle.importKey(
        'jwk',
        stored.privateJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey', 'deriveBits']
      );
      const publicKey = await crypto.subtle.importKey(
        'jwk',
        stored.publicJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
      );
      return {
        privateKey,
        publicKey,
        publicJwkString: JSON.stringify(stored.publicJwk),
        fingerprint: stored.fingerprint,
      };
    }
  } catch {
    // Regenerate if IndexedDB entry unavailable or corrupted
  }

  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );

  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const publicJwkString = JSON.stringify(publicJwk);
  const fingerprint = await computeFingerprint(publicJwkString);

  await idbSet(storageKey, { privateJwk, publicJwk, fingerprint });
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicJwkString,
    fingerprint,
  };
}

export async function deriveDirectConversationKey(
  myPrivateKey: CryptoKey,
  peerPublicJwkString: string,
  convId: string
): Promise<CryptoKey> {
  const peerJwk = JSON.parse(peerPublicJwkString) as JsonWebKey;
  const peerPublicKey = await crypto.subtle.importKey(
    'jwk',
    peerJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    myPrivateKey,
    256
  );
  const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  const salt = new TextEncoder().encode(`konnecta-dm-${convId}`);
  const info = new TextEncoder().encode('aes-256-gcm-v1');
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function generateGroupAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function exportRawAesKeyB64(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bufToB64(raw);
}

export async function importRawAesKeyB64(b64: string): Promise<CryptoKey> {
  const raw = b64ToBuf(b64);
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptText(
  key: CryptoKey,
  plaintext: string
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    ciphertext: bufToB64(cipher),
    iv: bufToB64(iv),
  };
}

export async function decryptText(
  key: CryptoKey,
  ciphertextB64: string,
  ivB64: string
): Promise<string> {
  const iv = b64ToBuf(ivB64);
  const data = b64ToBuf(ciphertextB64);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    data as BufferSource
  );
  return new TextDecoder().decode(plain);
}

export async function wrapGroupKeyForMember(
  groupKey: CryptoKey,
  myPrivateKey: CryptoKey,
  memberPublicJwkString: string,
  convId: string
): Promise<{ wrappedKey: string; iv: string }> {
  const pairKey = await deriveDirectConversationKey(myPrivateKey, memberPublicJwkString, `wrap-${convId}`);
  const rawB64 = await exportRawAesKeyB64(groupKey);
  const { ciphertext, iv } = await encryptText(pairKey, rawB64);
  return { wrappedKey: ciphertext, iv };
}

export async function unwrapGroupKeyFromSender(
  wrappedKeyB64: string,
  ivB64: string,
  myPrivateKey: CryptoKey,
  senderPublicJwkString: string,
  convId: string
): Promise<CryptoKey> {
  const pairKey = await deriveDirectConversationKey(myPrivateKey, senderPublicJwkString, `wrap-${convId}`);
  const rawB64 = await decryptText(pairKey, wrappedKeyB64, ivB64);
  return importRawAesKeyB64(rawB64);
}

// Personal Vault Passphrase Encryption (PBKDF2 100,000 iterations + AES-256-GCM)
export async function encryptForVault(
  passphrase: string,
  plaintext: string
): Promise<{ encryptedPayload: string; iv: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(plaintext)
  );
  return {
    encryptedPayload: bufToB64(cipher),
    iv: bufToB64(iv),
    salt: bufToB64(salt),
  };
}

export async function decryptFromVault(
  passphrase: string,
  encryptedPayloadB64: string,
  ivB64: string,
  saltB64: string
): Promise<string> {
  const salt = b64ToBuf(saltB64);
  const iv = b64ToBuf(ivB64);
  const cipher = b64ToBuf(encryptedPayloadB64);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    aesKey,
    cipher as BufferSource
  );
  return new TextDecoder().decode(plain);
}
