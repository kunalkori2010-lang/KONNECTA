export interface LocalContact {
  id: string;
  name: string;
  contactInfo: string;
  source: 'device' | 'file' | 'manual';
}

export interface NavigatorWithContacts extends Navigator {
  contacts?: {
    select: (
      properties: string[],
      options?: { multiple?: boolean }
    ) => Promise<Array<{ name?: string[]; email?: string[]; tel?: string[] }>>;
  };
}

export function getContactsStorageKey(uid: string): string {
  return `konnecta_contacts_${uid}`;
}

export function loadLocalContacts(uid: string): LocalContact[] {
  try {
    const raw = localStorage.getItem(getContactsStorageKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalContacts(uid: string, contacts: LocalContact[]): LocalContact[] {
  const trimmed = contacts.slice(0, 200);
  try {
    localStorage.setItem(getContactsStorageKey(uid), JSON.stringify(trimmed));
  } catch {
    // Ignore storage quota errors
  }
  return trimmed;
}

export function mergeUniqueContacts(
  existing: LocalContact[],
  incoming: LocalContact[]
): { merged: LocalContact[]; addedCount: number } {
  const keys = new Set(
    existing.map((c) => `${c.name.toLowerCase()}|${c.contactInfo.toLowerCase()}`)
  );
  const fresh: LocalContact[] = [];
  for (const item of incoming) {
    const key = `${item.name.toLowerCase()}|${item.contactInfo.toLowerCase()}`;
    if (!keys.has(key)) {
      keys.add(key);
      fresh.push(item);
    }
  }
  return {
    merged: [...fresh, ...existing],
    addedCount: fresh.length,
  };
}

export function parseContactsText(raw: string, fileName: string): Omit<LocalContact, 'id'>[] {
  const results: Omit<LocalContact, 'id'>[] = [];
  const lower = fileName.toLowerCase();

  if (lower.endsWith('.vcf') || raw.includes('BEGIN:VCARD')) {
    const cards = raw.split(/BEGIN:VCARD/i).slice(1);
    for (const card of cards) {
      const fnMatch = card.match(/^FN[^:]*:(.+)$/im);
      const nMatch = card.match(/^N[^:]*:([^;\r\n]+);?([^;\r\n]*)/im);
      const emailMatch = card.match(/^EMAIL[^:]*:(.+)$/im);
      const telMatch = card.match(/^TEL[^:]*:(.+)$/im);

      const rawName = fnMatch?.[1]?.trim() || [nMatch?.[2], nMatch?.[1]].filter(Boolean).join(' ').trim();
      const info = emailMatch?.[1]?.trim() || telMatch?.[1]?.trim() || '';
      if (rawName || info) {
        results.push({
          name: (rawName || info).slice(0, 80),
          contactInfo: info.slice(0, 120),
          source: 'file',
        });
      }
    }
    return results;
  }

  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && /^(name|full\s*name)/i.test(line)) continue;
    const parts = line.split(',').map((p) => p.replace(/^"|"$/g, '').trim());
    const name = parts[0] || '';
    const info = parts[1] || parts[2] || '';
    if (name || info) {
      results.push({
        name: (name || info).slice(0, 80),
        contactInfo: info.slice(0, 120),
        source: 'file',
      });
    }
  }
  return results;
}
