import React, { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Rect, Circle, Line, Text, Group } from 'react-konva';
import type Konva from 'konva';
import { Square, Circle as CircleIcon, Pencil, StickyNote, Type as TypeIcon, Download, Save, Trash2, Plus } from 'lucide-react';
import {
  addDoc,
  collection,
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
import { WhiteboardElement } from '../../types/konnecta';

interface BoardDoc {
  id: string;
  ownerUid: string;
  title: string;
  visibility: 'private' | 'shared' | 'public';
  elements: WhiteboardElement[];
}

export const WhiteboardModule: React.FC = () => {
  const { firebaseUser, wsSend, wsSubscribe, showToast } = useApp();
  const [boards, setBoards] = useState<BoardDoc[]>([]);
  const [activeBoard, setActiveBoard] = useState<BoardDoc | null>(null);
  const [elements, setElements] = useState<WhiteboardElement[]>([]);
  const [tool, setTool] = useState<'pen' | 'rect' | 'circle' | 'sticky' | 'text'>('pen');
  const [color, setColor] = useState('#6366F1');
  const [newBoardTitle, setNewBoardTitle] = useState('');
  const [noteInput, setNoteInput] = useState('Key concept');

  const isDrawingRef = useRef(false);
  const isRemoteUpdateRef = useRef(false);
  const stageRef = useRef<Konva.Stage | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 980, height: 480 });

  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const updateSize = () => {
      const w = Math.max(280, Math.floor(el.clientWidth));
      const h = w < 520 ? 340 : w < 820 ? 420 : 500;
      setStageSize({ width: w, height: h });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    window.addEventListener('resize', updateSize, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  useEffect(() => {
    if (!firebaseUser) return;
    let pubBoards: BoardDoc[] = [];
    let myBoards: BoardDoc[] = [];
    let collabBoards: BoardDoc[] = [];

    const mergeAndSet = () => {
      const map = new Map<string, BoardDoc>();
      for (const b of [...pubBoards, ...myBoards, ...collabBoards]) map.set(b.id, b);
      const list = Array.from(map.values());
      setBoards(list);
      if (!activeBoard && list.length > 0) {
        setActiveBoard(list[0]);
        setElements(list[0].elements || []);
      }
    };

    const unsubPub = onSnapshot(
      query(collection(db, 'whiteboards'), where('visibility', '==', 'public'), limit(20)),
      (snap) => {
        pubBoards = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BoardDoc, 'id'>) }));
        mergeAndSet();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'whiteboards')
    );

    const unsubMine = onSnapshot(
      query(collection(db, 'whiteboards'), where('ownerUid', '==', firebaseUser.uid), limit(20)),
      (snap) => {
        myBoards = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BoardDoc, 'id'>) }));
        mergeAndSet();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'whiteboards')
    );

    const unsubCollab = onSnapshot(
      query(
        collection(db, 'whiteboards'),
        where('collaboratorUids', 'array-contains', firebaseUser.uid),
        limit(20)
      ),
      (snap) => {
        collabBoards = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BoardDoc, 'id'>) }));
        mergeAndSet();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'whiteboards')
    );

    return () => {
      unsubPub();
      unsubMine();
      unsubCollab();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser]);

  // Real-time WebSocket delta sync
  useEffect(() => {
    if (!activeBoard) return;
    const roomId = `wb:${activeBoard.id}`;
    wsSend({ type: 'room:join', roomId });

    const unsub = wsSubscribe((msg) => {
      if (msg.roomId === roomId && msg.type === 'whiteboard:delta' && Array.isArray(msg.elements)) {
        isRemoteUpdateRef.current = true;
        setElements(msg.elements as WhiteboardElement[]);
        isRemoteUpdateRef.current = false;
      }
    });

    return () => {
      unsub();
      wsSend({ type: 'room:leave', roomId });
    };
  }, [activeBoard, wsSend, wsSubscribe]);

  const emitBoardUpdate = (nextElements: WhiteboardElement[]) => {
    if (isRemoteUpdateRef.current || !activeBoard) return;
    wsSend({
      type: 'whiteboard:delta',
      roomId: `wb:${activeBoard.id}`,
      elements: nextElements,
    });
  };

  const handleStageMouseDown = () => {
    if (!activeBoard) return;
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    if (!pos) return;

    if (tool === 'pen') {
      isDrawingRef.current = true;
      const el: WhiteboardElement = {
        id: crypto.randomUUID().slice(0, 10),
        kind: 'line',
        x: 0,
        y: 0,
        points: [pos.x, pos.y],
        fill: 'transparent',
        stroke: color,
      };
      const next = [...elements, el];
      setElements(next);
      return;
    }

    const id = crypto.randomUUID().slice(0, 10);
    let created: WhiteboardElement;
    if (tool === 'rect') {
      created = { id, kind: 'rect', x: pos.x, y: pos.y, width: 120, height: 80, fill: 'transparent', stroke: color };
    } else if (tool === 'circle') {
      created = { id, kind: 'circle', x: pos.x, y: pos.y, width: 80, height: 80, fill: 'transparent', stroke: color };
    } else if (tool === 'sticky') {
      created = { id, kind: 'sticky', x: pos.x, y: pos.y, width: 150, height: 100, text: noteInput || 'Note', fill: '#FEF3C7', stroke: '#F59E0B' };
    } else {
      created = { id, kind: 'text', x: pos.x, y: pos.y, text: noteInput || 'Label', fill: color, stroke: color };
    }
    const next = [...elements, created];
    setElements(next);
    emitBoardUpdate(next);
  };

  const handleStageMouseMove = () => {
    if (!isDrawingRef.current || tool !== 'pen') return;
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    if (!pos) return;
    setElements((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.kind !== 'line') return prev;
      const updated = { ...last, points: [...(last.points || []), pos.x, pos.y] };
      const next = [...prev.slice(0, -1), updated];
      return next;
    });
  };

  const handleStageMouseUp = () => {
    if (isDrawingRef.current) {
      isDrawingRef.current = false;
      emitBoardUpdate(elements);
    }
  };

  const handleSaveBoard = async () => {
    if (!activeBoard) return;
    await updateDoc(doc(db, 'whiteboards', activeBoard.id), {
      elements: elements.slice(0, 500),
      updatedAt: serverTimestamp(),
    });
    showToast('Board saved', 'Whiteboard state persisted.', 'success');
  };

  const handleExportPng = () => {
    const uri = stageRef.current?.toDataURL({ pixelRatio: 2 });
    if (!uri) return;
    const a = document.createElement('a');
    a.download = `${activeBoard?.title || 'konnecta-board'}.png`;
    a.href = uri;
    a.click();
  };

  const createBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !newBoardTitle.trim()) return;
    const ref = await addDoc(collection(db, 'whiteboards'), {
      ownerUid: firebaseUser.uid,
      title: newBoardTitle.trim().slice(0, 100),
      collaboratorUids: [],
      visibility: 'public',
      elements: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setNewBoardTitle('');
    setActiveBoard({
      id: ref.id,
      ownerUid: firebaseUser.uid,
      title: newBoardTitle.trim(),
      visibility: 'public',
      elements: [],
    });
    setElements([]);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            KONNECTA Collaborative Whiteboard
          </h2>
          <p className="text-xs text-slate-500">
            Real-time shapes, freehand diagrams, sticky notes, and PNG export
          </p>
        </div>

        <form onSubmit={createBoard} className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <input
            type="text"
            value={newBoardTitle}
            onChange={(e) => setNewBoardTitle(e.target.value)}
            placeholder="New board title..."
            className="flex-1 min-w-0 sm:w-48 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] px-3 py-1.5 text-xs"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            New Board
          </button>
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {boards.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => {
              setActiveBoard(b);
              setElements(b.elements || []);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
              activeBoard?.id === b.id
                ? 'bg-indigo-600 text-white'
                : 'bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            {b.title}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            { id: 'pen', label: 'Draw', Icon: Pencil },
            { id: 'rect', label: 'Box', Icon: Square },
            { id: 'circle', label: 'Circle', Icon: CircleIcon },
            { id: 'sticky', label: 'Sticky Note', Icon: StickyNote },
            { id: 'text', label: 'Text', Icon: TypeIcon },
          ] as const).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTool(id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                tool === id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}

          <input
            type="color"
            aria-label="Stroke color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-8 h-8 rounded border border-slate-200 dark:border-slate-700 cursor-pointer ml-1"
          />

          {(tool === 'sticky' || tool === 'text') && (
            <input
              type="text"
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="Sticky/text label..."
              className="ml-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 py-1 text-xs"
            />
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setElements([]);
              emitBoardUpdate([]);
            }}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-red-500 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
          <button
            type="button"
            onClick={handleSaveBoard}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-xs font-medium cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            Save
          </button>
          <button
            type="button"
            onClick={handleExportPng}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export PNG
          </button>
        </div>
      </div>

      {/* Canvas — automatically fits any screen & supports touch/stylus */}
      <div
        ref={canvasWrapRef}
        className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white overflow-hidden touch-none"
      >
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onTouchStart={handleStageMouseDown}
          onTouchMove={handleStageMouseMove}
          onTouchEnd={handleStageMouseUp}
          className="cursor-crosshair block"
        >
          <Layer>
            {elements.map((el) => {
              if (el.kind === 'line') {
                return (
                  <Line
                    key={el.id}
                    points={el.points || []}
                    stroke={el.stroke}
                    strokeWidth={3}
                    tension={0.4}
                    lineCap="round"
                  />
                );
              }
              if (el.kind === 'rect') {
                return (
                  <Rect
                    key={el.id}
                    x={el.x}
                    y={el.y}
                    width={el.width || 120}
                    height={el.height || 80}
                    stroke={el.stroke}
                    strokeWidth={2.5}
                    draggable
                  />
                );
              }
              if (el.kind === 'circle') {
                return (
                  <Circle
                    key={el.id}
                    x={el.x}
                    y={el.y}
                    radius={44}
                    stroke={el.stroke}
                    strokeWidth={2.5}
                    draggable
                  />
                );
              }
              if (el.kind === 'sticky') {
                return (
                  <Group key={el.id} x={el.x} y={el.y} draggable>
                    <Rect width={150} height={100} fill="#FEF3C7" stroke="#F59E0B" cornerRadius={8} />
                    <Text text={el.text || 'Note'} x={10} y={10} width={130} fontSize={13} fill="#1E293B" />
                  </Group>
                );
              }
              return (
                <Text
                  key={el.id}
                  x={el.x}
                  y={el.y}
                  text={el.text || 'Text'}
                  fontSize={16}
                  fill={el.fill}
                  draggable
                />
              );
            })}
          </Layer>
        </Stage>
      </div>
    </div>
  );
};
