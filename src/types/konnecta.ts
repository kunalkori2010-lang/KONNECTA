export type AppTab =
  | 'home'
  | 'messages'
  | 'friends'
  | 'stories'
  | 'communities'
  | 'study-zone'
  | 'study-rooms'
  | 'shared-files'
  | 'events'
  | 'whiteboard'
  | 'notifications'
  | 'vault'
  | 'profile'
  | 'settings'
  | 'moderation';

export interface UserPublic {
  uid: string;
  username: string;
  displayName: string;
  bio?: string;
  avatarUrl?: string;
  coverColor?: string;
  college?: string;
  interests?: string[];
  profileVisibility: 'public' | 'friends' | 'private';
  storyVisibility: 'friends' | 'close_friends';
  friendRequestsFrom: 'everyone' | 'nobody';
  onboardingCompleted: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserPrivate {
  uid: string;
  email: string;
  theme: 'dark' | 'light' | 'system';
  accentColor?: string;
  fontSize?: 'sm' | 'md' | 'lg';
  reducedMotion?: boolean;
  chatWallpaper?: string;
  aiConsentGranted?: boolean;
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  soundEnabled?: boolean;
  lockScreenPreview?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  title?: string;
  description?: string;
  creatorUid: string;
  memberUids: string[];
  adminUids: string[];
  disappearingSeconds?: number;
  keyVersion: number;
  announcement?: string;
  mutedBy?: string[];
  archivedBy?: string[];
  lastMessageAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PollOption {
  id: string;
  text: string;
  voterUids: string[];
}

export interface ChatMessage {
  id: string;
  convId: string;
  senderUid: string;
  senderName?: string;
  type: 'text' | 'image' | 'file' | 'voice' | 'poll' | 'system';
  e2ee: boolean;
  ciphertext: string;
  iv?: string;
  keyVersion?: number;
  replyToId?: string;
  pinned?: boolean;
  edited?: boolean;
  deleted?: boolean;
  clientMsgId?: string;
  expiresAtMs?: number;
  reactions?: Record<string, string[]>;
  pollQuestion?: string;
  pollOptions?: PollOption[];
  attachmentMeta?: { fileName?: string; mimeType?: string; sizeBytes?: number };
  memberUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
  // Decrypted client-side view
  decryptedText?: string;
  decryptionError?: boolean;
}

export interface PostItem {
  id: string;
  authorUid: string;
  authorName: string;
  authorUsername?: string;
  content: string;
  mediaDataUrl?: string;
  kind: 'post' | 'moment';
  visibility: 'public' | 'friends';
  tags?: string[];
  likesCount: number;
  commentsCount: number;
  likedBy?: string[];
  edited?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StoryItem {
  id: string;
  authorUid: string;
  authorName: string;
  type: 'text' | 'image';
  text?: string;
  bgStyle?: string;
  mediaDataUrl?: string;
  visibility: 'friends' | 'close_friends';
  viewerUids?: string[];
  expiresAtMs: number;
  createdAt?: unknown;
}

export interface CommunityItem {
  id: string;
  name: string;
  description: string;
  rules?: string;
  category: string;
  visibility: 'public' | 'private';
  creatorUid: string;
  memberUids: string[];
  adminUids: string[];
  pendingUids?: string[];
  inviteCode: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StudyDocument {
  id: string;
  ownerUid: string;
  ownerName: string;
  folderId?: string;
  title: string;
  description?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentText?: string;
  fileDataUrl?: string;
  tags?: string[];
  visibility: 'private' | 'friends' | 'public';
  version: number;
  downloadAllowed: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StudyRoomItem {
  id: string;
  hostUid: string;
  hostName: string;
  title: string;
  subject: string;
  goals?: { id: string; text: string; done: boolean }[];
  timerMinutes: number;
  timerStatus: 'idle' | 'running' | 'paused';
  timerEndAtMs?: number;
  visibility: 'public' | 'friends';
  participantUids: string[];
  scheduledFor?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface VaultItem {
  id: string;
  ownerUid: string;
  title: string;
  category: 'note' | 'file' | 'document';
  encryptedPayload: string;
  iv: string;
  salt: string;
  mimeType?: string;
  sizeBytes: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface EventItem {
  id: string;
  creatorUid: string;
  creatorName: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: string;
  visibility: 'public' | 'friends';
  goingUids: string[];
  maybeUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface WhiteboardElement {
  id: string;
  kind: 'rect' | 'circle' | 'text' | 'sticky' | 'line';
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: number[];
  text?: string;
  fill: string;
  stroke: string;
}

export interface NotificationItem {
  id: string;
  recipientUid: string;
  actorUid: string;
  actorName?: string;
  type: string;
  title: string;
  body?: string;
  linkTab?: string;
  read: boolean;
  createdAt?: unknown;
}

export interface ReportItem {
  id: string;
  reporterUid: string;
  targetType: 'user' | 'post' | 'message' | 'community';
  targetId: string;
  reason: string;
  submittedEvidence?: string;
  status: 'pending' | 'reviewed' | 'resolved' | 'dismissed';
  moderatorNote?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}
