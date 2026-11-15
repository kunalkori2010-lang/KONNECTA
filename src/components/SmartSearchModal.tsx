import React, { useEffect, useState } from 'react';
import { Search, X, User, Users, FileText, Calendar, MessageSquare, Bookmark } from 'lucide-react';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useApp } from '../context/AppContext';
import { AppTab } from '../types/konnecta';

interface SearchResult {
  id: string;
  category: 'User' | 'Community' | 'Document' | 'Event' | 'Post' | 'Bookmark';
  title: string;
  subtitle: string;
  targetTab: AppTab;
}

export const SmartSearchModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onNavigate: (tab: AppTab) => void;
}> = ({ open, onClose, onNavigate }) => {
  const { firebaseUser } = useApp();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !firebaseUser) return;
    const trimmed = term.trim().toLowerCase();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    let cancelled = false;
    const runSearch = async () => {
      setLoading(true);
      try {
        const [usersSnap, commSnap, docsSnap, eventsSnap, postsSnap, bookmarksSnap] = await Promise.all([
          getDocs(query(collection(db, 'users_public'), where('profileVisibility', 'in', ['public', 'friends']), limit(30))),
          getDocs(query(collection(db, 'communities'), where('visibility', '==', 'public'), limit(30))),
          getDocs(query(collection(db, 'study_documents'), where('visibility', '==', 'public'), limit(30))),
          getDocs(query(collection(db, 'events'), where('visibility', '==', 'public'), limit(30))),
          getDocs(query(collection(db, 'posts'), where('visibility', '==', 'public'), limit(30))),
          getDocs(query(collection(db, 'bookmarks'), where('ownerUid', '==', firebaseUser.uid), limit(30))),
        ]);

        if (cancelled) return;
        const found: SearchResult[] = [];

        usersSnap.forEach((d) => {
          const v = d.data();
          const match =
            String(v.displayName || '').toLowerCase().includes(trimmed) ||
            String(v.username || '').toLowerCase().includes(trimmed) ||
            String(v.college || '').toLowerCase().includes(trimmed);
          if (match) {
            found.push({
              id: d.id,
              category: 'User',
              title: v.displayName,
              subtitle: `@${v.username}${v.college ? ` · ${v.college}` : ''}`,
              targetTab: 'friends',
            });
          }
        });

        commSnap.forEach((d) => {
          const v = d.data();
          if (
            String(v.name || '').toLowerCase().includes(trimmed) ||
            String(v.description || '').toLowerCase().includes(trimmed)
          ) {
            found.push({
              id: d.id,
              category: 'Community',
              title: v.name,
              subtitle: `${v.category} · ${v.memberUids?.length || 1} members`,
              targetTab: 'communities',
            });
          }
        });

        docsSnap.forEach((d) => {
          const v = d.data();
          if (
            String(v.title || '').toLowerCase().includes(trimmed) ||
            String(v.fileName || '').toLowerCase().includes(trimmed)
          ) {
            found.push({
              id: d.id,
              category: 'Document',
              title: v.title,
              subtitle: `${v.fileName} · ${v.ownerName}`,
              targetTab: 'study-zone',
            });
          }
        });

        eventsSnap.forEach((d) => {
          const v = d.data();
          if (String(v.title || '').toLowerCase().includes(trimmed)) {
            found.push({
              id: d.id,
              category: 'Event',
              title: v.title,
              subtitle: `${v.startsAt} · ${v.location || 'Online'}`,
              targetTab: 'events',
            });
          }
        });

        postsSnap.forEach((d) => {
          const v = d.data();
          if (String(v.content || '').toLowerCase().includes(trimmed)) {
            found.push({
              id: d.id,
              category: 'Post',
              title: String(v.content).slice(0, 72),
              subtitle: `By ${v.authorName}`,
              targetTab: 'home',
            });
          }
        });

        bookmarksSnap.forEach((d) => {
          const v = d.data();
          if (String(v.title || '').toLowerCase().includes(trimmed)) {
            found.push({
              id: d.id,
              category: 'Bookmark',
              title: v.title,
              subtitle: `Saved ${v.targetType}`,
              targetTab: 'study-zone',
            });
          }
        });

        setResults(found.slice(0, 20));
      } catch (e) {
        console.error('Smart search error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const timer = setTimeout(runSearch, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, open, firebaseUser]);

  if (!open) return null;

  const iconFor = (cat: SearchResult['category']) => {
    switch (cat) {
      case 'User': return <User className="w-4 h-4 text-indigo-500" />;
      case 'Community': return <Users className="w-4 h-4 text-blue-500" />;
      case 'Document': return <FileText className="w-4 h-4 text-emerald-500" />;
      case 'Event': return <Calendar className="w-4 h-4 text-amber-500" />;
      case 'Bookmark': return <Bookmark className="w-4 h-4 text-violet-500" />;
      default: return <MessageSquare className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm pt-20 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            autoFocus
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search people, communities, study documents, events, bookmarks..."
            className="w-full bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto p-2">
          {term.trim().length < 2 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              Type at least 2 characters to search permitted KONNECTA records. For E2EE private
              messages, use the local client-side search inside Messages.
            </div>
          ) : loading ? (
            <div className="p-6 text-center text-xs text-slate-500">Searching...</div>
          ) : results.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">No matching items found.</div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {results.map((r) => (
                <button
                  key={`${r.category}-${r.id}`}
                  type="button"
                  onClick={() => {
                    onNavigate(r.targetTab);
                    onClose();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
                >
                  {iconFor(r.category)}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {r.title}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {r.category} · {r.subtitle}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
