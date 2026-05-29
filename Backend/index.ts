import * as path from 'path';
import * as fs from 'fs';
import dotenv from 'dotenv';
const envPath = fs.existsSync(path.join(__dirname, '.env'))
  ? path.join(__dirname, '.env')
  : path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath });
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const app = express();

// ── Dependency Check ──
const requiredDeps = ['express', 'cors', 'groq-sdk', 'dotenv', 'better-sqlite3'];
for (const dep of requiredDeps) {
  try { require(dep); }
  catch (e) { console.error(`[Error] Missing dependency: ${dep}. Run 'npm install' to fix.`); process.exit(1); }
}

app.use(cors({
  origin: [
    'http://localhost:5173', 'http://127.0.0.1:5173',
    'http://localhost:5174', 'http://127.0.0.1:5174',
    'http://localhost:5175', 'http://127.0.0.1:5175',
    'http://localhost:5060', 'http://127.0.0.1:5060',
  ],
}));
app.use(express.json({ limit: '10mb' }));

// ── Service Imports ──
import modelRouter = require('./services/modelRouter');
import systemCommander = require('./services/systemCommander');
import { createRecipeEngine } from './recipeEngine';
import { router as authRouter } from './auth';
import { createTtsStreamHandler } from './services/ttsStream';
import { getInfoApiStatus } from './services/infoServices';
import { logEvent, serverModelPrefs, TTS_VOICE, recipeMessages, apiUsage } from './routes/context';
import { detectSystemCommand, runPowerShell } from './routes/systemHelpers';

// Initialize systemCommander with modelRouter for vision analysis
systemCommander.init(modelRouter, {
  provider: 'groq',
  model: 'meta-llama/llama-4-scout-17b-16e-instruct',
  autoRoute: true,
});

// ── Route Mounts ──
import chatRouter from './routes/chat';
import systemRouter from './routes/system';
import settingsRouter from './routes/settings';
import emailRouter from './routes/email';
import miscRouter from './routes/misc';

app.use('/api', chatRouter);
app.use('/api', systemRouter);
app.use('/api', settingsRouter);
app.use('/api', emailRouter);
app.use('/api', miscRouter);
app.use('/api/auth', authRouter);

// ── Recipe Engine ──
const recipeEngine = createRecipeEngine({ app, runPowerShell, logEvent, apiUsage, recipeMessages });
recipeEngine.start();

// ── Production: serve built frontend ──
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      res.sendFile(path.join(frontendDist, 'index.html'));
    } else { next(); }
  });
}

// ── WebSocket Server for Streaming TTS ──
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/tts' });
createTtsStreamHandler(wss, logEvent);
console.log('[TTS Stream] WebSocket server ready on /ws/tts');

// ── Global crash protection ──
process.on('uncaughtException', (err) => {
  console.error('[CRASH] Uncaught exception:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason: any) => {
  console.error('[CRASH] Unhandled rejection:', reason?.message || reason);
});

const PORT = Number(process.env.PORT) || 5060;
server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is busy. Trying port ${PORT + 1}...`);
    server.listen(PORT + 1);
  } else {
    console.error('Server error:', err.message);
  }
});
server.listen(PORT, () => {
  console.log(`JARVIS backend running on http://localhost:${PORT}`);
  console.log(`Model provider: ${serverModelPrefs.provider}, model: ${serverModelPrefs.model}`);
  console.log(`Auto-route: ${serverModelPrefs.autoRoute}`);
  console.log(`TTS voice: ${TTS_VOICE}`);
  console.log(`System tools platform: ${process.platform}`);
  console.log('Info APIs:', getInfoApiStatus());
});

const shutdown = () => {
  recipeEngine.stop();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
if (process.stdin && (process.stdin as any).resume) (process.stdin as any).resume();
