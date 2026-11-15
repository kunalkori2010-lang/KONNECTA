export interface AccentPreset {
  id: string;
  label: string;
  primary: string;
  hover: string;
  subtle: string;
}

export const BRAND_CONFIG = {
  name: 'KONNECTA',
  tagline: 'Connect. Share. Create. Grow.',
  domain: 'konnecta.app',
  adminEmail: 'kunalkori2010@gmail.com',
  supportEmail: 'privacy@konnecta.app',
  maxUploadBytes: 5 * 1024 * 1024,
  e2eeProtocolName: 'WebCrypto ECDH P-256 + HKDF + AES-256-GCM',
  visibleMetadataNotice: [
    'Sender UID, recipient/group member UIDs, and conversation IDs',
    'Server-assigned message timestamps and message type flags',
    'Public ECDH key bundles and device registration fingerprints',
  ],
};

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'indigo', label: 'Electric Indigo', primary: '#4F46E5', hover: '#4338CA', subtle: 'rgba(79,70,229,0.12)' },
  { id: 'blue', label: 'Cobalt Blue', primary: '#2563EB', hover: '#1D4ED8', subtle: 'rgba(37,99,235,0.12)' },
  { id: 'violet', label: 'Deep Violet', primary: '#7C3AED', hover: '#6D28D9', subtle: 'rgba(124,58,237,0.12)' },
  { id: 'emerald', label: 'Forest Emerald', primary: '#059669', hover: '#047857', subtle: 'rgba(5,150,105,0.12)' },
];

export const CHAT_WALLPAPERS = [
  { id: 'none', label: 'Clean Surface', className: '' },
  { id: 'slate-grid', label: 'Subtle Grid', className: 'bg-[radial-gradient(rgba(99,102,241,0.10)_1px,transparent_1px)] [background-size:20px_20px]' },
  { id: 'midnight-mesh', label: 'Midnight Mesh', className: 'bg-gradient-to-br from-indigo-950/30 via-transparent to-blue-950/30' },
  { id: 'paper-dots', label: 'Study Dots', className: 'bg-[radial-gradient(rgba(148,163,184,0.18)_1px,transparent_1px)] [background-size:16px_16px]' },
];

export const INTEREST_OPTIONS = [
  'Photography',
  'Music',
  'Cooking & Food',
  'Travel',
  'Fitness & Sports',
  'Movies & Books',
  'Gaming',
  'Art & Design',
  'Mathematics',
  'AI & ML',
  'Science',
  'Languages',
  'Literature',
  'History',
  'Business & Finance',
  'Medicine & Health',
  'Engineering',
  'Coding',
];

export const STUDY_SUBJECT_SUGGESTIONS = [
  'General',
  'Mathematics',
  'AI & ML',
  'Science',
  'Languages',
  'Literature',
  'History',
  'Business',
  'Design',
  'Personal Notes',
];
