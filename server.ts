import express, { type Request, type Response, type NextFunction } from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { GoogleGenAI, Type } from '@google/genai';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const adminAuth = getAuth();

function getAiClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
}

// In-memory rate limiter for API routes
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) return false;
  entry.count += 1;
  return true;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing bearer token' });
  }
  const token = authHeader.split('Bearer ')[1];
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Token verification failed:', err);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'konnecta-server', timestamp: new Date().toISOString() });
  });

  // Server-side KONNECTA AI Study Assistant
  app.post('/api/ai/study', requireAuth, async (req: AuthRequest, res: Response) => {
    const uid = req.user?.uid || 'anon';
    if (!checkRateLimit(`ai:${uid}`, 20, 60_000)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please wait a minute before making more AI study requests.' });
    }

    const { action, content, title, consentGranted, question } = req.body ?? {};
    if (consentGranted !== true) {
      return res.status(403).json({ error: 'Explicit AI processing consent is required before analyzing study material.' });
    }
    if (typeof content !== 'string' || content.trim().length < 10) {
      return res.status(400).json({ error: 'Study content must be at least 10 characters long.' });
    }
    if (content.length > 35000) {
      return res.status(400).json({ error: 'Study content exceeds the 35,000 character limit.' });
    }

    const allowedActions = ['summarize', 'revision_notes', 'explain', 'quiz', 'flashcards'];
    if (!allowedActions.includes(action)) {
      return res.status(400).json({ error: 'Unsupported study assistant action.' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ error: 'AI Study Assistant is not configured on this server (missing GEMINI_API_KEY).' });
    }

    const safeTitle = typeof title === 'string' ? title.slice(0, 120) : 'Untitled Material';

    try {
      const ai = getAiClient();
      if (action === 'flashcards') {
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Document Title: ${safeTitle}\n\nStudy Material:\n${content}\n\nGenerate 6 concise, high-yield study flashcards based strictly on the material above.`,
          config: {
            systemInstruction: 'You are KONNECTA Study Assistant. Create accurate, clear flashcards for students without inventing facts absent from the source.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  front: { type: Type.STRING, description: 'Question or concept prompt' },
                  back: { type: Type.STRING, description: 'Concise answer or explanation' },
                },
                required: ['front', 'back'],
              },
            },
          },
        });
        const cards = JSON.parse((response.text ?? '[]').trim());
        return res.json({ action, flashcards: cards });
      }

      if (action === 'quiz') {
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Document Title: ${safeTitle}\n\nStudy Material:\n${content}\n\nGenerate 5 multiple-choice practice questions with 4 options each and an explanation.`,
          config: {
            systemInstruction: 'You are KONNECTA Study Assistant. Generate rigorous practice questions grounded in the provided study material.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                  correctIndex: { type: Type.INTEGER },
                  explanation: { type: Type.STRING },
                },
                required: ['question', 'options', 'correctIndex', 'explanation'],
              },
            },
          },
        });
        const questions = JSON.parse((response.text ?? '[]').trim());
        return res.json({ action, quiz: questions });
      }

      const instructionMap: Record<string, string> = {
        summarize: 'Provide a clear executive summary with key takeaways in structured bullet points.',
        revision_notes: 'Organize the material into clean, exam-ready revision notes with headings, definitions, and core formulas or principles.',
        explain: `Explain the core concepts in plain, accessible language.${typeof question === 'string' && question.trim() ? ` Focus specifically on: ${question.slice(0, 300)}` : ''}`,
      };

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Document Title: ${safeTitle}\n\nTask: ${instructionMap[action]}\n\nStudy Material:\n${content}`,
        config: {
          systemInstruction: 'You are KONNECTA Study Assistant. Be accurate, clear, and concise. Format with clean Markdown.',
        },
      });

      return res.json({ action, text: response.text ?? '' });
    } catch (err: unknown) {
      console.error('Gemini study assistant error:', err);
      const message = err instanceof Error ? err.message : 'AI request failed';
      return res.status(502).json({ error: message });
    }
  });

  return app;
}

interface WsClient {
  ws: WebSocket;
  uid: string;
  displayName: string;
  rooms: Set<string>;
}

function setupWebSocket(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    try {
      const { pathname } = new URL(request.url || '/', 'http://localhost');
      if (pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      }
    } catch {
      socket.destroy();
    }
  });
  const clientsByUid = new Map<string, Set<WsClient>>();
  const roomMembers = new Map<string, Set<WsClient>>();

  const broadcastPresence = () => {
    const onlineUids = Array.from(clientsByUid.keys());
    const payload = JSON.stringify({ type: 'presence:list', onlineUids });
    for (const set of clientsByUid.values()) {
      for (const client of set) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(payload);
        }
      }
    }
  };

  const sendToUser = (targetUid: string, payload: unknown) => {
    const set = clientsByUid.get(targetUid);
    if (!set) return;
    const raw = JSON.stringify(payload);
    for (const client of set) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(raw);
      }
    }
  };

  const broadcastToRoom = (roomId: string, payload: unknown, exclude?: WsClient) => {
    const members = roomMembers.get(roomId);
    if (!members) return;
    const raw = JSON.stringify(payload);
    for (const member of members) {
      if (member !== exclude && member.ws.readyState === WebSocket.OPEN) {
        member.ws.send(raw);
      }
    }
  };

  wss.on('connection', async (ws, req) => {
    let clientRecord: WsClient | null = null;

    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const token = url.searchParams.get('token');
      const displayName = (url.searchParams.get('name') || 'User').slice(0, 60);
      if (!token) {
        ws.close(4001, 'Missing auth token');
        return;
      }
      const decoded = await adminAuth.verifyIdToken(token);
      clientRecord = {
        ws,
        uid: decoded.uid,
        displayName,
        rooms: new Set(),
      };
      if (!clientsByUid.has(decoded.uid)) {
        clientsByUid.set(decoded.uid, new Set());
      }
      clientsByUid.get(decoded.uid)!.add(clientRecord);
      broadcastPresence();
    } catch {
      ws.close(4002, 'Invalid auth token');
      return;
    }

    ws.on('message', (data) => {
      if (!clientRecord) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      const type = String(msg.type || '');
      const roomId = typeof msg.roomId === 'string' ? msg.roomId : '';

      if (type === 'room:join' && roomId) {
        clientRecord.rooms.add(roomId);
        if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Set());
        roomMembers.get(roomId)!.add(clientRecord);
        broadcastToRoom(roomId, {
          type: 'room:user_joined',
          roomId,
          uid: clientRecord.uid,
          displayName: clientRecord.displayName,
        }, clientRecord);
      } else if (type === 'room:leave' && roomId) {
        clientRecord.rooms.delete(roomId);
        roomMembers.get(roomId)?.delete(clientRecord);
        broadcastToRoom(roomId, {
          type: 'room:user_left',
          roomId,
          uid: clientRecord.uid,
        }, clientRecord);
      } else if (
        (type === 'typing:start' ||
          type === 'typing:stop' ||
          type === 'whiteboard:delta' ||
          type === 'whiteboard:cursor' ||
          type === 'studyroom:timer' ||
          type === 'studyroom:goal') &&
        roomId
      ) {
        broadcastToRoom(
          roomId,
          {
            ...msg,
            senderUid: clientRecord.uid,
            senderName: clientRecord.displayName,
            serverTs: Date.now(),
          },
          clientRecord
        );
      } else if (
        type === 'call:ring' ||
        type === 'call:accept' ||
        type === 'call:decline' ||
        type === 'call:offer' ||
        type === 'call:answer' ||
        type === 'call:ice' ||
        type === 'call:hangup'
      ) {
        const targetUid = typeof msg.targetUid === 'string' ? msg.targetUid : '';
        if (targetUid) {
          sendToUser(targetUid, {
            ...msg,
            fromUid: clientRecord.uid,
            fromName: clientRecord.displayName,
          });
        }
      }
    });

    ws.on('close', () => {
      if (!clientRecord) return;
      const userSet = clientsByUid.get(clientRecord.uid);
      if (userSet) {
        userSet.delete(clientRecord);
        if (userSet.size === 0) clientsByUid.delete(clientRecord.uid);
      }
      for (const roomId of clientRecord.rooms) {
        roomMembers.get(roomId)?.delete(clientRecord);
        broadcastToRoom(roomId, {
          type: 'room:user_left',
          roomId,
          uid: clientRecord.uid,
        });
      }
      broadcastPresence();
    });
  });

  return wss;
}

async function startServer() {
  const app = createApp();
  const server = http.createServer(app);
  setupWebSocket(server);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: disableHmr ? false : true,
        ws: { server },
        watch: disableHmr ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(
      express.static(distDir, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Service-Worker-Allowed', '/');
          } else if (filePath.endsWith('manifest.webmanifest')) {
            res.setHeader('Content-Type', 'application/manifest+json');
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`KONNECTA server running on http://0.0.0.0:${PORT}`);
  });
}

if (process.env.VITEST !== 'true') {
  startServer().catch((err) => {
    console.error('Failed to start KONNECTA server:', err);
    process.exit(1);
  });
}
