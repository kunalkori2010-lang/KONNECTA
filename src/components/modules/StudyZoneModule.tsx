import React, { useEffect, useState } from 'react';
import {
  FolderPlus,
  FileUp,
  BookOpen,
  Sparkles,
  Bookmark,
  MessageSquare,
  Download,
  Trash2,
  ShieldCheck,
  FileText,
  X,
  RotateCw,
  Edit3,
  Eye,
  Send,
} from 'lucide-react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { useApp } from '../../context/AppContext';
import { STUDY_SUBJECT_SUGGESTIONS } from '../../config/brand';
import { StudyDocument } from '../../types/konnecta';

interface FolderDoc {
  id: string;
  ownerUid: string;
  name: string;
  subject: string;
  semester?: string;
  visibility: 'private' | 'friends' | 'public';
}

interface NoteDoc {
  id: string;
  ownerUid: string;
  ownerName: string;
  title: string;
  content: string;
  subject?: string;
  visibility: 'private' | 'shared' | 'public';
}

interface DocComment {
  id: string;
  authorUid: string;
  authorName: string;
  content: string;
  isSuggestion: boolean;
}

interface Flashcard {
  front: string;
  back: string;
}

interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

type AiAction = 'summarize' | 'revision_notes' | 'explain' | 'quiz' | 'flashcards';

function renderInlineFormatting(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-slate-900 dark:text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 font-mono text-[12px]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function renderSafeMarkdown(md: string): React.ReactNode {
  const lines = md.split(/\r?\n/);
  return (
    <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-2" />;
        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={i} className="text-sm font-bold text-slate-900 dark:text-white pt-2">
              {renderInlineFormatting(trimmed.slice(4))}
            </h4>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h3 key={i} className="text-base font-bold text-slate-900 dark:text-white pt-2">
              {renderInlineFormatting(trimmed.slice(3))}
            </h3>
          );
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h2 key={i} className="text-lg font-bold text-slate-900 dark:text-white pt-2">
              {renderInlineFormatting(trimmed.slice(2))}
            </h2>
          );
        }
        if (trimmed.startsWith('- [x] ') || trimmed.startsWith('- [X] ')) {
          return (
            <div key={i} className="flex items-start gap-2 pl-2">
              <span className="text-emerald-600 dark:text-emerald-400 font-bold">[✓]</span>
              <span className="line-through text-slate-400">{renderInlineFormatting(trimmed.slice(6))}</span>
            </div>
          );
        }
        if (trimmed.startsWith('- [ ] ')) {
          return (
            <div key={i} className="flex items-start gap-2 pl-2">
              <span className="text-slate-400">[ ]</span>
              <span>{renderInlineFormatting(trimmed.slice(6))}</span>
            </div>
          );
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <div key={i} className="flex items-start gap-2 pl-2">
              <span className="text-indigo-500">•</span>
              <span>{renderInlineFormatting(trimmed.slice(2))}</span>
            </div>
          );
        }
        return <p key={i}>{renderInlineFormatting(line)}</p>;
      })}
    </div>
  );
}

export const StudyZoneModule: React.FC<{
  initialTab?: 'documents' | 'notes' | 'bookmarks';
  initialVisibilityFilter?: 'all' | 'shared';
}> = ({ initialTab = 'documents', initialVisibilityFilter = 'all' }) => {
  const { firebaseUser, publicProfile, privateProfile, updateThemePrefs, getAuthToken, showToast } =
    useApp();

  const [subTab, setSubTab] = useState<'documents' | 'notes' | 'bookmarks'>(initialTab);
  const [folders, setFolders] = useState<FolderDoc[]>([]);
  const [documents, setDocuments] = useState<StudyDocument[]>([]);
  const [notes, setNotes] = useState<NoteDoc[]>([]);
  const [bookmarks, setBookmarks] = useState<{ id: string; title: string; snippet?: string; targetType: string }[]>([]);

  const [selectedFolderId, setSelectedFolderId] = useState<string>('all');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'shared' | 'friends' | 'private'>(
    initialVisibilityFilter
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<StudyDocument | null>(null);
  const [docComments, setDocComments] = useState<DocComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [isSuggestion, setIsSuggestion] = useState(false);

  // Create Folder Modal
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderSubject, setFolderSubject] = useState('');
  const [folderSemester, setFolderSemester] = useState('');

  // Upload or Write Resource Modal
  const [showUploadDoc, setShowUploadDoc] = useState(false);
  const [createMode, setCreateMode] = useState<'write' | 'upload'>('write');
  const [docTitle, setDocTitle] = useState('');
  const [docDesc, setDocDesc] = useState('');
  const [docContentText, setDocContentText] = useState('');
  const [docFileName, setDocFileName] = useState('study-notes.md');
  const [docMime, setDocMime] = useState('text/markdown');
  const [docDataUrl, setDocDataUrl] = useState('');
  const [docSize, setDocSize] = useState(0);
  const [docVisibility, setDocVisibility] = useState<'private' | 'friends' | 'public'>('public');
  const [docTags, setDocTags] = useState('');
  const [downloadAllowed, setDownloadAllowed] = useState(true);

  // Edit Own Document Modal
  const [editingDoc, setEditingDoc] = useState<StudyDocument | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editContentText, setEditContentText] = useState('');
  const [editVisibility, setEditVisibility] = useState<'private' | 'friends' | 'public'>('public');
  const [editDownloadAllowed, setEditDownloadAllowed] = useState(true);

  // Collaborative Note Editor
  const [activeNote, setActiveNote] = useState<NoteDoc | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteSubject, setNoteSubject] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [noteMode, setNoteMode] = useState<'edit' | 'preview'>('edit');

  // KONNECTA AI Study Assistant (shared cleanly across Docs & Notes)
  const [showAiConsentModal, setShowAiConsentModal] = useState(false);
  const [pendingAiPayload, setPendingAiPayload] = useState<{
    action: AiAction;
    title: string;
    material: string;
    question?: string;
  } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiTextResult, setAiTextResult] = useState('');
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [flippedIdx, setFlippedIdx] = useState<Record<number, boolean>>({});
  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});

  useEffect(() => {
    if (!firebaseUser) return;

    let sharedFolders: FolderDoc[] = [];
    let myFolders: FolderDoc[] = [];
    const mergeFolders = () => {
      const m = new Map<string, FolderDoc>();
      for (const f of [...sharedFolders, ...myFolders]) m.set(f.id, f);
      setFolders(Array.from(m.values()));
    };

    const unsubF1 = onSnapshot(
      query(collection(db, 'study_folders'), where('visibility', 'in', ['public', 'friends']), limit(40)),
      (snap) => {
        sharedFolders = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FolderDoc, 'id'>) }));
        mergeFolders();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'study_folders')
    );
    const unsubF2 = onSnapshot(
      query(collection(db, 'study_folders'), where('ownerUid', '==', firebaseUser.uid), limit(40)),
      (snap) => {
        myFolders = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FolderDoc, 'id'>) }));
        mergeFolders();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'study_folders')
    );

    let sharedDocs: StudyDocument[] = [];
    let myDocs: StudyDocument[] = [];
    const mergeDocs = () => {
      const m = new Map<string, StudyDocument>();
      for (const d of [...sharedDocs, ...myDocs]) m.set(d.id, d);
      const list = Array.from(m.values());
      list.sort((a, b) => {
        const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
        const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
        return tb - ta;
      });
      setDocuments(list);
      if (selectedDoc) {
        const updated = list.find((x) => x.id === selectedDoc.id);
        if (updated) setSelectedDoc(updated);
      }
    };

    const unsubD1 = onSnapshot(
      query(collection(db, 'study_documents'), where('visibility', 'in', ['public', 'friends']), limit(60)),
      (snap) => {
        sharedDocs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StudyDocument, 'id'>) }));
        mergeDocs();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'study_documents')
    );
    const unsubD2 = onSnapshot(
      query(collection(db, 'study_documents'), where('ownerUid', '==', firebaseUser.uid), limit(60)),
      (snap) => {
        myDocs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StudyDocument, 'id'>) }));
        mergeDocs();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'study_documents')
    );

    let pubNotes: NoteDoc[] = [];
    let myNotes: NoteDoc[] = [];
    let collabNotes: NoteDoc[] = [];
    const mergeNotes = () => {
      const m = new Map<string, NoteDoc>();
      for (const n of [...pubNotes, ...myNotes, ...collabNotes]) m.set(n.id, n);
      setNotes(Array.from(m.values()));
    };

    const unsubN1 = onSnapshot(
      query(collection(db, 'collaborative_notes'), where('visibility', '==', 'public'), limit(40)),
      (snap) => {
        pubNotes = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NoteDoc, 'id'>) }));
        mergeNotes();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'collaborative_notes')
    );
    const unsubN2 = onSnapshot(
      query(collection(db, 'collaborative_notes'), where('ownerUid', '==', firebaseUser.uid), limit(40)),
      (snap) => {
        myNotes = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NoteDoc, 'id'>) }));
        mergeNotes();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'collaborative_notes')
    );
    const unsubN3 = onSnapshot(
      query(collection(db, 'collaborative_notes'), where('collaboratorUids', 'array-contains', firebaseUser.uid), limit(40)),
      (snap) => {
        collabNotes = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NoteDoc, 'id'>) }));
        mergeNotes();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'collaborative_notes')
    );

    const bq = query(collection(db, 'bookmarks'), where('ownerUid', '==', firebaseUser.uid), limit(50));
    const unsubB = onSnapshot(
      bq,
      (snap) => {
        setBookmarks(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as { title: string; snippet?: string; targetType: string }),
          }))
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'bookmarks')
    );

    return () => {
      unsubF1();
      unsubF2();
      unsubD1();
      unsubD2();
      unsubN1();
      unsubN2();
      unsubN3();
      unsubB();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser]);

  useEffect(() => {
    if (!selectedDoc) {
      setDocComments([]);
      return;
    }
    const q = query(
      collection(db, 'study_documents', selectedDoc.id, 'comments'),
      where('docId', '==', selectedDoc.id)
    );
    return onSnapshot(
      q,
      (snap) => {
        setDocComments(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DocComment, 'id'>) })));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `study_documents/${selectedDoc.id}/comments`)
    );
  }, [selectedDoc]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 400 * 1024) {
      showToast('File size limit', 'Please upload study files up to 400 KB.', 'error');
      return;
    }
    setDocFileName(file.name);
    setDocMime(file.type || 'application/octet-stream');
    setDocSize(file.size);
    if (!docTitle) setDocTitle(file.name.replace(/\.[^/.]+$/, ''));

    if (file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.txt')) {
      const textReader = new FileReader();
      textReader.onload = () => setDocContentText(String(textReader.result || '').slice(0, 150000));
      textReader.readAsText(file);
    }

    const dataReader = new FileReader();
    dataReader.onload = () => setDocDataUrl(String(dataReader.result || ''));
    dataReader.readAsDataURL(file);
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !folderName.trim()) return;
    await addDoc(collection(db, 'study_folders'), {
      ownerUid: firebaseUser.uid,
      name: folderName.trim().slice(0, 80),
      subject: folderSubject.trim().slice(0, 80) || 'General',
      semester: folderSemester.trim().slice(0, 40),
      visibility: 'public',
      createdAt: serverTimestamp(),
    });
    setFolderName('');
    setFolderSubject('');
    setFolderSemester('');
    setShowNewFolder(false);
    showToast('Folder created', undefined, 'success');
  };

  const handleUploadDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !docTitle.trim()) return;
    const finalFileName =
      createMode === 'write'
        ? `${docTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'notes'}.md`
        : docFileName;
    const finalMime = createMode === 'write' ? 'text/markdown' : docMime;

    try {
      await addDoc(collection(db, 'study_documents'), {
        ownerUid: firebaseUser.uid,
        ownerName: publicProfile?.displayName || 'Member',
        folderId: selectedFolderId === 'all' ? '' : selectedFolderId,
        title: docTitle.trim().slice(0, 120),
        description: docDesc.trim().slice(0, 500),
        fileName: finalFileName,
        mimeType: finalMime,
        sizeBytes: docSize || docContentText.length,
        contentText: docContentText.slice(0, 150000),
        fileDataUrl: createMode === 'write' ? '' : docDataUrl,
        tags: docTags.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10),
        visibility: docVisibility,
        version: 1,
        downloadAllowed,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setDocTitle('');
      setDocDesc('');
      setDocContentText('');
      setDocDataUrl('');
      setDocTags('');
      setShowUploadDoc(false);
      showToast('Resource saved', 'Added to Study Zone.', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'study_documents');
    }
  };

  const handleSaveEditedDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDoc || !editTitle.trim()) return;
    try {
      await updateDoc(doc(db, 'study_documents', editingDoc.id), {
        title: editTitle.trim().slice(0, 120),
        description: editDesc.trim().slice(0, 500),
        contentText: editContentText.slice(0, 150000),
        visibility: editVisibility,
        downloadAllowed: editDownloadAllowed,
        version: (editingDoc.version || 1) + 1,
        updatedAt: serverTimestamp(),
      });
      setEditingDoc(null);
      showToast('Resource updated', `Saved as version ${(editingDoc.version || 1) + 1}.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `study_documents/${editingDoc.id}`);
    }
  };

  const runAiOnMaterial = async (
    action: AiAction,
    title: string,
    material: string,
    question?: string,
    bypassConsentCheck = false
  ) => {
    if (!bypassConsentCheck && !privateProfile?.aiConsentGranted) {
      setPendingAiPayload({ action, title, material, question });
      setShowAiConsentModal(true);
      return;
    }

    const cleaned = material.trim();
    if (cleaned.length < 10) {
      showToast('Not enough text', 'Add notes or text content for AI analysis.', 'error');
      return;
    }

    setAiLoading(true);
    setAiTextResult('');
    setFlashcards([]);
    setQuiz([]);
    setQuizAnswers({});

    try {
      const token = await getAuthToken();
      const res = await fetch('/api/ai/study', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action,
          title,
          content: cleaned.slice(0, 35000),
          question: question?.trim().slice(0, 300),
          consentGranted: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI study request failed');
      if (data.flashcards) setFlashcards(data.flashcards);
      else if (data.quiz) setQuiz(data.quiz);
      else setAiTextResult(data.text || '');
    } catch (err: unknown) {
      showToast('AI Study Assistant', err instanceof Error ? err.message : 'Request failed', 'error');
    } finally {
      setAiLoading(false);
    }
  };

  const saveNote = async () => {
    if (!firebaseUser || !noteTitle.trim()) return;
    if (activeNote) {
      await updateDoc(doc(db, 'collaborative_notes', activeNote.id), {
        title: noteTitle.trim().slice(0, 120),
        subject: noteSubject.trim().slice(0, 80),
        content: noteBody.slice(0, 100000),
        updatedAt: serverTimestamp(),
      });
      showToast('Note updated', undefined, 'success');
    } else {
      await addDoc(collection(db, 'collaborative_notes'), {
        ownerUid: firebaseUser.uid,
        ownerName: publicProfile?.displayName || 'Member',
        title: noteTitle.trim().slice(0, 120),
        subject: noteSubject.trim().slice(0, 80),
        content: noteBody.slice(0, 100000),
        collaboratorUids: [],
        visibility: 'public',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showToast('Note created', undefined, 'success');
    }
  };

  const filteredDocs = documents.filter((d) => {
    const matchFolder = selectedFolderId === 'all' || d.folderId === selectedFolderId;
    const matchVis =
      visibilityFilter === 'all'
        ? true
        : visibilityFilter === 'shared'
          ? d.visibility !== 'private'
          : d.visibility === visibilityFilter;
    const q = searchQuery.trim().toLowerCase();
    const matchSearch =
      !q ||
      d.title.toLowerCase().includes(q) ||
      d.fileName.toLowerCase().includes(q) ||
      (d.tags || []).some((t) => t.toLowerCase().includes(q));
    return matchFolder && matchVis && matchSearch;
  });

  const renderAiResultsBlock = () => (
    <>
      {aiLoading && (
        <p className="text-xs text-indigo-600 dark:text-indigo-400">
          Analyzing authorized study material...
        </p>
      )}

      {aiTextResult && (
        <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 text-xs whitespace-pre-wrap leading-relaxed">
          {aiTextResult}
        </div>
      )}

      {flashcards.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3">
          {flashcards.map((card, i) => {
            const flipped = !!flippedIdx[i];
            return (
              <button
                key={i}
                type="button"
                onClick={() => setFlippedIdx((p) => ({ ...p, [i]: !p[i] }))}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-left hover:border-indigo-500 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1.5">
                  <span>{flipped ? 'ANSWER' : 'PROMPT'}</span>
                  <RotateCw className="w-3 h-3" />
                </div>
                <p className="text-xs font-medium text-slate-900 dark:text-slate-100">
                  {flipped ? card.back : card.front}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {quiz.length > 0 && (
        <div className="space-y-3">
          {quiz.map((qItem, qi) => {
            const chosen = quizAnswers[qi];
            return (
              <div
                key={qi}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2 text-xs"
              >
                <p className="font-semibold text-slate-900 dark:text-white">
                  {qi + 1}. {qItem.question}
                </p>
                <div className="space-y-1.5">
                  {qItem.options.map((opt, oi) => (
                    <button
                      key={oi}
                      type="button"
                      onClick={() => setQuizAnswers((p) => ({ ...p, [qi]: oi }))}
                      className={`w-full text-left px-3 py-1.5 rounded-lg border cursor-pointer ${
                        chosen === oi
                          ? oi === qItem.correctIndex
                            ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40'
                            : 'border-red-500 bg-red-50 dark:bg-red-950/40'
                          : 'border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                {chosen !== undefined && (
                  <p className="text-[11px] text-slate-500 pt-1">{qItem.explanation}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            {initialVisibilityFilter === 'shared' ? 'Shared Files & Resources' : 'Study Zone & AI Assistant'}
          </h2>
          <p className="text-xs text-slate-500">
            Flexible folders for any topic, text notes or files, collaborative Markdown, and consent-gated Gemini tools
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowNewFolder(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            New Folder
          </button>
          <button
            type="button"
            onClick={() => setShowUploadDoc(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer"
          >
            <FileUp className="w-3.5 h-3.5" />
            Add Resource
          </button>
        </div>
      </div>

      {/* Segmented Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl max-w-full overflow-x-auto">
          {([
            { id: 'documents', label: 'Documents & Files' },
            { id: 'notes', label: 'Collaborative Notes' },
            { id: 'bookmarks', label: 'Saved Bookmarks' },
          ] as const).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                subTab === t.id
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {subTab === 'documents' && (
          <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl max-w-full overflow-x-auto">
            {([
              { id: 'all', label: 'All' },
              { id: 'shared', label: 'Shared' },
              { id: 'friends', label: 'Friends' },
              { id: 'private', label: 'Private' },
            ] as const).map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setVisibilityFilter(v.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                  visibilityFilter === v.id
                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                    : 'text-slate-500'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {subTab === 'documents' && (
        <div className="grid lg:grid-cols-12 gap-6">
          {/* Folders & Document List */}
          <div className="lg:col-span-5 space-y-4">
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedFolderId('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                  selectedFolderId === 'all'
                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                    : 'bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                All Resources ({documents.length})
              </button>
              {folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelectedFolderId(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                    selectedFolderId === f.id
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                      : 'bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {f.name} · {f.subject}
                </button>
              ))}
            </div>

            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter documents by title, filename, or tag..."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] px-3.5 py-2 text-xs"
            />

            <div className="space-y-2.5">
              {filteredDocs.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-8 text-center text-xs text-slate-500">
                  No resources match this view. Click Add Resource to write notes directly or upload a file.
                </div>
              ) : (
                filteredDocs.map((d) => (
                  <div
                    key={d.id}
                    onClick={() => {
                      setSelectedDoc(d);
                      setAiTextResult('');
                      setFlashcards([]);
                      setQuiz([]);
                    }}
                    className={`rounded-xl border p-4 cursor-pointer transition-colors ${
                      selectedDoc?.id === d.id
                        ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {d.title}
                      </h3>
                      <span className="text-[11px] text-slate-500 capitalize shrink-0">
                        {d.visibility}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 truncate">
                      {d.fileName} · {(d.sizeBytes / 1024).toFixed(1)} KB · v{d.version} · {d.ownerName}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Document Preview, Comments & AI Study Assistant */}
          <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-5 min-h-[500px]">
            {!selectedDoc ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-16 text-xs text-slate-500">
                <BookOpen className="w-8 h-8 text-indigo-500 mb-2" />
                Select any resource to preview, comment, edit, or launch the AI Study Assistant.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      {selectedDoc.title}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {selectedDoc.fileName} · By {selectedDoc.ownerName} · Version {selectedDoc.version}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await addDoc(collection(db, 'bookmarks'), {
                          ownerUid: firebaseUser!.uid,
                          targetType: 'document',
                          targetId: selectedDoc.id,
                          title: selectedDoc.title,
                          snippet: selectedDoc.description || selectedDoc.fileName,
                          createdAt: serverTimestamp(),
                        });
                        showToast('Bookmarked', 'Added to saved bookmarks.', 'success');
                      }}
                      className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                      title="Bookmark Document"
                    >
                      <Bookmark className="w-4 h-4" />
                    </button>
                    {selectedDoc.downloadAllowed && selectedDoc.fileDataUrl && (
                      <a
                        href={selectedDoc.fileDataUrl}
                        download={selectedDoc.fileName}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download
                      </a>
                    )}
                    {selectedDoc.ownerUid === firebaseUser?.uid && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingDoc(selectedDoc);
                            setEditTitle(selectedDoc.title);
                            setEditDesc(selectedDoc.description || '');
                            setEditContentText(selectedDoc.contentText || '');
                            setEditVisibility(selectedDoc.visibility);
                            setEditDownloadAllowed(selectedDoc.downloadAllowed);
                          }}
                          className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-indigo-500 cursor-pointer"
                          title="Edit Document"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteDoc(doc(db, 'study_documents', selectedDoc.id));
                            setSelectedDoc(null);
                            showToast('Deleted', 'Document removed.', 'info');
                          }}
                          className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-red-500 cursor-pointer"
                          title="Delete Document"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Preview Content */}
                <div className="rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 p-4 max-h-56 overflow-y-auto text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                  {selectedDoc.contentText ||
                    selectedDoc.description ||
                    'Binary document stored safely. Use Download above if authorized.'}
                </div>

                {/* KONNECTA AI Study Assistant Toolbar */}
                <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/20 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                      <Sparkles className="w-4 h-4" />
                      KONNECTA AI Study Assistant
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {privateProfile?.aiConsentGranted ? 'Consent Active' : 'Consent Required'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { id: 'summarize', label: 'Summarize' },
                      { id: 'revision_notes', label: 'Revision Notes' },
                      { id: 'explain', label: 'Explain Concepts' },
                      { id: 'flashcards', label: 'Flashcards' },
                      { id: 'quiz', label: 'Practice Quiz' },
                    ] as const).map((act) => (
                      <button
                        key={act.id}
                        type="button"
                        disabled={aiLoading}
                        onClick={() =>
                          runAiOnMaterial(
                            act.id,
                            selectedDoc.title,
                            selectedDoc.contentText || selectedDoc.description || selectedDoc.title
                          )
                        }
                        className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium hover:border-indigo-500 disabled:opacity-50 cursor-pointer"
                      >
                        {act.label}
                      </button>
                    ))}
                  </div>

                  {/* Custom AI Question Input */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={aiQuestion}
                      onChange={(e) => setAiQuestion(e.target.value)}
                      placeholder="Ask a specific question about this material..."
                      className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      disabled={aiLoading || !aiQuestion.trim()}
                      onClick={() =>
                        runAiOnMaterial(
                          'explain',
                          selectedDoc.title,
                          selectedDoc.contentText || selectedDoc.description || selectedDoc.title,
                          aiQuestion
                        )
                      }
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                    >
                      <Send className="w-3 h-3" />
                      Ask
                    </button>
                  </div>

                  {renderAiResultsBlock()}
                </div>

                {/* Document Comments & Suggested Corrections */}
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5" />
                    Comments &amp; Suggested Corrections ({docComments.length})
                  </h4>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {docComments.map((c) => (
                      <div key={c.id} className="rounded-lg bg-slate-50 dark:bg-[#0B0F19] px-3 py-2 text-xs">
                        <span className="font-semibold text-slate-900 dark:text-white">{c.authorName}</span>
                        {c.isSuggestion && <span className="ml-2 text-indigo-500">[Suggested Correction]</span>}
                        <p className="mt-0.5 text-slate-600 dark:text-slate-300">{c.content}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Add comment or correction..."
                      className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-1.5 text-xs"
                    />
                    <label className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <input
                        type="checkbox"
                        checked={isSuggestion}
                        onChange={(e) => setIsSuggestion(e.target.checked)}
                      />
                      Correction
                    </label>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!commentText.trim() || !firebaseUser) return;
                        await addDoc(collection(db, 'study_documents', selectedDoc.id, 'comments'), {
                          docId: selectedDoc.id,
                          authorUid: firebaseUser.uid,
                          authorName: publicProfile?.displayName || 'Member',
                          content: commentText.trim(),
                          isSuggestion,
                          createdAt: serverTimestamp(),
                        });
                        setCommentText('');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium cursor-pointer"
                    >
                      Post
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {subTab === 'notes' && (
        <div className="grid lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 space-y-3">
            <button
              type="button"
              onClick={() => {
                setActiveNote(null);
                setNoteTitle('');
                setNoteSubject('');
                setNoteBody('');
                setNoteMode('edit');
              }}
              className="w-full py-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-xs font-medium hover:border-indigo-500 cursor-pointer"
            >
              + New Collaborative Note
            </button>
            {notes.map((n) => (
              <div
                key={n.id}
                onClick={() => {
                  setActiveNote(n);
                  setNoteTitle(n.title);
                  setNoteSubject(n.subject || '');
                  setNoteBody(n.content);
                }}
                className={`rounded-xl border p-3.5 cursor-pointer ${
                  activeNote?.id === n.id
                    ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{n.title}</p>
                  {n.ownerUid === firebaseUser?.uid && (
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await deleteDoc(doc(db, 'collaborative_notes', n.id));
                        if (activeNote?.id === n.id) {
                          setActiveNote(null);
                          setNoteTitle('');
                          setNoteSubject('');
                          setNoteBody('');
                        }
                      }}
                      title="Delete note"
                      className="text-slate-400 hover:text-red-500 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {n.subject || 'General'} · {n.ownerName}
                </p>
              </div>
            ))}
          </div>

          <div className="lg:col-span-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder="Note Title..."
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm font-semibold"
              />
              <input
                type="text"
                value={noteSubject}
                onChange={(e) => setNoteSubject(e.target.value)}
                placeholder="Topic / Subject (e.g. Math, AI & ML, Notes)"
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-[#0B0F19]">
                <button
                  type="button"
                  onClick={() => setNoteMode('edit')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                    noteMode === 'edit' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-500'
                  }`}
                >
                  <Edit3 className="w-3 h-3" />
                  Edit Markdown
                </button>
                <button
                  type="button"
                  onClick={() => setNoteMode('preview')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                    noteMode === 'preview'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
                      : 'text-slate-500'
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  Rendered Preview
                </button>
              </div>
              <button
                type="button"
                onClick={saveNote}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer"
              >
                {activeNote ? 'Save Changes' : 'Create Note'}
              </button>
            </div>

            {noteMode === 'edit' ? (
              <textarea
                rows={12}
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="# Heading&#10;- [ ] Checklist item&#10;- Key **concept** or `formula`"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F19] p-4 text-sm font-mono leading-relaxed"
              />
            ) : (
              <div className="min-h-[260px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F19] p-4">
                {noteBody.trim() ? (
                  renderSafeMarkdown(noteBody)
                ) : (
                  <p className="text-xs text-slate-500">Switch to Edit Markdown to write your note.</p>
                )}
              </div>
            )}

            {/* Direct AI Tools on Collaborative Note */}
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/20 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                  <Sparkles className="w-4 h-4" />
                  Run AI Study Assistant on This Note
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {([
                    { id: 'summarize', label: 'Summarize' },
                    { id: 'revision_notes', label: 'Revision Notes' },
                    { id: 'flashcards', label: 'Flashcards' },
                    { id: 'quiz', label: 'Quiz' },
                  ] as const).map((act) => (
                    <button
                      key={act.id}
                      type="button"
                      disabled={aiLoading || !noteBody.trim()}
                      onClick={() =>
                        runAiOnMaterial(act.id, noteTitle || 'Collaborative Note', noteBody)
                      }
                      className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-medium hover:border-indigo-500 disabled:opacity-50 cursor-pointer"
                    >
                      {act.label}
                    </button>
                  ))}
                </div>
              </div>
              {renderAiResultsBlock()}
            </div>
          </div>
        </div>
      )}

      {subTab === 'bookmarks' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5">
          <h3 className="text-sm font-semibold mb-3">Saved Bookmarks ({bookmarks.length})</h3>
          {bookmarks.length === 0 ? (
            <p className="text-xs text-slate-500">Bookmark any document, post, or message to find it quickly here.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {bookmarks.map((b) => (
                <div key={b.id} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{b.title}</p>
                    <p className="text-xs text-slate-500">
                      {b.targetType} {b.snippet ? `· ${b.snippet}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteDoc(doc(db, 'bookmarks', b.id))}
                    className="text-xs text-red-500 hover:underline cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal: New Folder */}
      {showNewFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleCreateFolder}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Create Study Folder</h3>
              <button type="button" onClick={() => setShowNewFolder(false)}><X className="w-4 h-4" /></button>
            </div>
            <input
              type="text"
              required
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Folder Name (e.g. Calculus Notes, Reading List)"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"
            />
            <div>
              <p className="text-[11px] text-slate-500 mb-1.5">Pick or type any topic / subject</p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {STUDY_SUBJECT_SUGGESTIONS.map((subj) => (
                  <button
                    key={subj}
                    type="button"
                    onClick={() => setFolderSubject(subj)}
                    className={`px-2.5 py-1 rounded-lg border text-[11px] cursor-pointer ${
                      folderSubject === subj
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {subj}
                  </button>
                ))}
              </div>
              <input
                type="text"
                required
                value={folderSubject}
                onChange={(e) => setFolderSubject(e.target.value)}
                placeholder="Subject or Topic (or type your own)"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"
              />
            </div>
            <input
              type="text"
              value={folderSemester}
              onChange={(e) => setFolderSemester(e.target.value)}
              placeholder="Group, Course, or Level (optional)"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"
            />
            <button type="submit" className="w-full py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold cursor-pointer">
              Create Folder
            </button>
          </form>
        </div>
      )}

      {/* Modal: Upload or Write Study Resource */}
      {showUploadDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleUploadDoc}
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Add Study Resource</h3>
              <button type="button" onClick={() => setShowUploadDoc(false)}><X className="w-4 h-4" /></button>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-[#0B0F19] rounded-lg">
              <button
                type="button"
                onClick={() => setCreateMode('write')}
                className={`flex-1 py-1.5 rounded-md text-xs font-medium cursor-pointer ${
                  createMode === 'write' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-500'
                }`}
              >
                Write Note / Paste Text
              </button>
              <button
                type="button"
                onClick={() => setCreateMode('upload')}
                className={`flex-1 py-1.5 rounded-md text-xs font-medium cursor-pointer ${
                  createMode === 'upload' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-500'
                }`}
              >
                Attach File
              </button>
            </div>

            {createMode === 'upload' && (
              <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-xs text-slate-500 cursor-pointer hover:border-indigo-500">
                <FileText className="w-4 h-4 text-indigo-500" />
                <span>
                  {docDataUrl ? docFileName : 'Attach PDF, DOCX, PPTX, Image, or TXT/MD (up to 400 KB)'}
                </span>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            )}

            <input
              type="text"
              required
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              placeholder="Resource Title"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={docDesc}
              onChange={(e) => setDocDesc(e.target.value)}
              placeholder="Short description..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
            />
            <textarea
              rows={5}
              value={docContentText}
              onChange={(e) => setDocContentText(e.target.value)}
              placeholder="Write or paste study notes, excerpts, or formulas (used for previews and AI study tools)..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                aria-label="Document visibility"
                value={docVisibility}
                onChange={(e) => setDocVisibility(e.target.value as 'private' | 'friends' | 'public')}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
              >
                <option value="public">Public</option>
                <option value="friends">Friends</option>
                <option value="private">Private</option>
              </select>
              <input
                type="text"
                value={docTags}
                onChange={(e) => setDocTags(e.target.value)}
                placeholder="Tags (comma-separated)"
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={downloadAllowed}
                onChange={(e) => setDownloadAllowed(e.target.checked)}
              />
              Allow authorized viewers to download this resource
            </label>
            <button type="submit" className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold cursor-pointer">
              Save to Study Zone
            </button>
          </form>
        </div>
      )}

      {/* Modal: Edit Existing Document */}
      {editingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleSaveEditedDoc}
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Edit Resource (v{editingDoc.version} → v{(editingDoc.version || 1) + 1})</h3>
              <button type="button" onClick={() => setEditingDoc(null)}><X className="w-4 h-4" /></button>
            </div>
            <input
              type="text"
              required
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Title"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              placeholder="Short description..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
            />
            <textarea
              rows={6}
              value={editContentText}
              onChange={(e) => setEditContentText(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
            />
            <div className="flex items-center justify-between gap-2">
              <select
                aria-label="Edit visibility"
                value={editVisibility}
                onChange={(e) => setEditVisibility(e.target.value as 'private' | 'friends' | 'public')}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
              >
                <option value="public">Public</option>
                <option value="friends">Friends</option>
                <option value="private">Private</option>
              </select>
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={editDownloadAllowed}
                  onChange={(e) => setEditDownloadAllowed(e.target.checked)}
                />
                Allow downloads
              </label>
            </div>
            <button type="submit" className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold cursor-pointer">
              Save New Version
            </button>
          </form>
        </div>
      )}

      {/* Modal: Explicit AI Processing Consent */}
      {showAiConsentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
              <ShieldCheck className="w-5 h-5" />
              <h3 className="text-sm font-semibold">AI Processing Consent</h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              KONNECTA never sends encrypted messages or Personal Vault files to AI providers. By
              enabling the Study Assistant, only the explicit Study Zone document or note you select
              is transmitted over our server endpoint to Google Gemini to generate summaries,
              flashcards, explanations, or practice quizzes.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAiConsentModal(false)}
                className="px-4 py-2 text-xs text-slate-500 cursor-pointer"
              >
                Decline
              </button>
              <button
                type="button"
                onClick={async () => {
                  await updateThemePrefs({ aiConsentGranted: true });
                  setShowAiConsentModal(false);
                  if (pendingAiPayload) {
                    runAiOnMaterial(
                      pendingAiPayload.action,
                      pendingAiPayload.title,
                      pendingAiPayload.material,
                      pendingAiPayload.question,
                      true
                    );
                  }
                }}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold cursor-pointer"
              >
                Grant Consent &amp; Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
