import React, { useEffect, useState } from 'react';
import { Lock, Unlock, Plus, Trash2, Eye, Download, Shield } from 'lucide-react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { decryptFromVault, encryptForVault } from '../../lib/crypto';
import { useApp } from '../../context/AppContext';
import { VaultItem } from '../../types/konnecta';

export const VaultModule: React.FC = () => {
  const { firebaseUser, showToast } = useApp();
  const [passphrase, setPassphrase] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [items, setItems] = useState<VaultItem[]>([]);
  const [decryptedMap, setDecryptedMap] = useState<Record<string, string>>({});

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<'note' | 'file' | 'document'>('note');
  const [secretContent, setSecretContent] = useState('');
  const [mimeType, setMimeType] = useState('text/plain');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;
    const q = query(
      collection(db, 'vault_items'),
      where('ownerUid', '==', firebaseUser.uid),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(
      q,
      (snap) => {
        setItems(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<VaultItem, 'id'>) })));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'vault_items')
    );
  }, [firebaseUser]);

  const totalBytes = items.reduce((s, x) => s + (x.sizeBytes || 0), 0);
  const quotaBytes = 10 * 1024 * 1024; // 10 MB personal vault quota

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 350 * 1024) {
      showToast('Vault file limit', 'Select a file under 350 KB.', 'error');
      return;
    }
    setTitle(file.name);
    setCategory('file');
    setMimeType(file.type || 'application/octet-stream');
    const reader = new FileReader();
    reader.onload = () => setSecretContent(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const handleEncryptAndSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !passphrase.trim() || !title.trim() || !secretContent.trim()) return;
    setSaving(true);
    try {
      const { encryptedPayload, iv, salt } = await encryptForVault(passphrase, secretContent);
      await addDoc(collection(db, 'vault_items'), {
        ownerUid: firebaseUser.uid,
        title: title.trim().slice(0, 120),
        category,
        encryptedPayload,
        iv,
        salt,
        mimeType,
        sizeBytes: encryptedPayload.length,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setTitle('');
      setSecretContent('');
      showToast('Encrypted & Stored', 'Item encrypted client-side with PBKDF2 + AES-256-GCM.', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'vault_items');
    } finally {
      setSaving(false);
    }
  };

  const handleDecryptItem = async (item: VaultItem) => {
    if (!passphrase) {
      showToast('Enter passphrase', 'Enter your Vault passphrase to decrypt this item.', 'error');
      return;
    }
    try {
      const plain = await decryptFromVault(passphrase, item.encryptedPayload, item.iv, item.salt);
      setDecryptedMap((prev) => ({ ...prev, [item.id]: plain }));
    } catch {
      showToast('Decryption failed', 'Incorrect Vault passphrase for this item.', 'error');
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Zero-Knowledge Vault Header */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Shield className="w-6 h-6 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              KONNECTA Personal Vault
            </h2>
            <p className="text-xs text-slate-500">
              Client-side PBKDF2 (100,000 rounds) + AES-256-GCM. Passphrase never leaves your browser.
            </p>
          </div>
        </div>

        <div className="text-left sm:text-right w-full sm:w-auto">
          <p className="text-xs font-mono text-slate-600 dark:text-slate-300 tabular-nums">
            {(totalBytes / 1024).toFixed(1)} KB / {(quotaBytes / (1024 * 1024)).toFixed(0)} MB used
          </p>
          <div className="w-full sm:w-44 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full mt-1.5 overflow-hidden sm:ml-auto">
            <div
              className="h-full bg-indigo-600"
              style={{ width: `${Math.min(100, (totalBytes / quotaBytes) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Vault Unlock Gate */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 sm:p-5 flex flex-wrap items-center gap-3">
        {unlocked ? <Unlock className="w-4 h-4 text-emerald-500 shrink-0" /> : <Lock className="w-4 h-4 text-amber-500 shrink-0" />}
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Enter your private Vault passphrase..."
          className="w-full sm:w-auto sm:flex-1 min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
        />
        <button
          type="button"
          onClick={() => {
            if (!passphrase.trim()) {
              showToast('Passphrase required', 'Enter a passphrase to unlock your Vault session.', 'error');
              return;
            }
            setUnlocked((u) => {
              if (u) setDecryptedMap({});
              return !u;
            });
          }}
          className="w-full sm:w-auto px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold cursor-pointer"
        >
          {unlocked ? 'Lock Vault' : 'Unlock Vault'}
        </button>
      </div>

      {unlocked && (
        <div className="grid lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleEncryptAndSave}
            className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-3 h-fit"
          >
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Encrypt &amp; Store New Item
            </h3>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Item Title"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
            />
            <div className="flex items-center justify-between gap-2">
              <select
                aria-label="Vault item category"
                value={category}
                onChange={(e) => setCategory(e.target.value as 'note' | 'file' | 'document')}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
              >
                <option value="note">Private Note</option>
                <option value="document">Document</option>
                <option value="file">File</option>
              </select>
              <label className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs cursor-pointer">
                Encrypt File
                <input type="file" onChange={handleFilePick} className="hidden" />
              </label>
            </div>
            <textarea
              rows={5}
              required
              value={secretContent}
              onChange={(e) => setSecretContent(e.target.value)}
              placeholder="Private note content (encrypted before leaving your browser)..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F19] p-3 text-xs font-mono"
            />
            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              {saving ? 'Encrypting...' : 'Encrypt & Save to Vault'}
            </button>
          </form>

          <div className="lg:col-span-7 space-y-3">
            {items.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-8 text-center text-xs text-slate-500">
                Your Personal Vault is empty.
              </div>
            ) : (
              items.map((item) => {
                const plain = decryptedMap[item.id];
                return (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                          {item.title}
                        </h4>
                        <p className="text-xs text-slate-500">
                          {item.category} · {(item.sizeBytes / 1024).toFixed(1)} KB encrypted
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleDecryptItem(item)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Decrypt
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteDoc(doc(db, 'vault_items', item.id))}
                          className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg cursor-pointer"
                          title="Delete Vault Item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {plain && (
                      <div className="rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 p-3 text-xs">
                        {plain.startsWith('data:') ? (
                          <a
                            href={plain}
                            download={item.title}
                            className="inline-flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 font-medium underline"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download Decrypted File ({item.title})
                          </a>
                        ) : (
                          <pre className="whitespace-pre-wrap font-mono text-slate-800 dark:text-slate-200">
                            {plain}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
