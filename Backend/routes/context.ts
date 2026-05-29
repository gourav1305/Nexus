import * as path from 'path';
import * as os from 'os';
import Groq from 'groq-sdk';
import { resolveVoicePrefs, DEFAULT_VOICE_MODE, DEFAULT_SPEAKING_RATE } from '../voiceCatalog';

let _groq: Groq | null = null;
export function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}
export const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
export const TTS_VOICE = process.env.TTS_VOICE || 'en-IN-NeerjaNeural';

export let serverModelPrefs = {
  provider: 'groq',
  model: GROQ_MODEL,
  visionModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
  autoRoute: true,
};

export let serverVoiceSettings = resolveVoicePrefs({
  voiceMode: DEFAULT_VOICE_MODE,
  speakingRate: DEFAULT_SPEAKING_RATE,
  voice: TTS_VOICE,
});

export function updateServerModelPrefs(updates: Record<string, any>) {
  if (updates.provider) serverModelPrefs.provider = updates.provider;
  if (updates.model) serverModelPrefs.model = updates.model;
  if (updates.visionModel) serverModelPrefs.visionModel = updates.visionModel;
  if (updates.autoRoute !== undefined) serverModelPrefs.autoRoute = Boolean(updates.autoRoute);
}

export function updateServerVoiceSettings(settings: Record<string, any>) {
  serverVoiceSettings = resolveVoicePrefs(settings || {}, TTS_VOICE);
  return serverVoiceSettings;
}

// ── API Usage Tracking ──
export const apiUsage = {
  llmCalls: 0,
  ttsCalls: 0,
  systemCommands: 0,
  infoQueries: 0,
  totalChats: 0,
  startTime: Date.now(),
};

// ── Event Log ──
export const eventLog: any[] = [];
const MAX_LOG_ENTRIES = 200;

export function logEvent(category: string, message: string, detail: string | null = null) {
  const entry = {
    id: eventLog.length + 1,
    timestamp: Date.now(),
    category,
    message,
    detail: detail ? String(detail).slice(0, 300) : null,
  };
  eventLog.push(entry);
  if (eventLog.length > MAX_LOG_ENTRIES) {
    eventLog.splice(0, eventLog.length - MAX_LOG_ENTRIES);
  }
  console.log(`[${category}] ${message}`);
}

// ── RAG Detection Helpers ──
export const MEMORY_TRIGGERS = /\b(yaad\s*dilao|yaad\s*karo|kal\s*kya\s*baat|pehle\s*kya\s*hua|pehle\s*ki\s*baat|jo\s*humne\s*baat|pichhli\s*baat|purani\s*baat|remember|recall|what did we|jo.*pehle|uske\s*baare\s*me.*batao)\b/i;
export const SEARCH_TRIGGERS = /\b(search|find|look up|google|khoj|dhoondh|dhundo|pata karo|info about|information about|what is|who is|tell me about|latest.*news|recent.*update)\b/i;
export const BOTH_TRIGGERS = /\b(new|update|current|recent|aaj\s*ka|today)\b/i;

export const detectMemoryQuery = (text: string) => MEMORY_TRIGGERS.test(text);
export const detectSearchQuery = (text: string) => SEARCH_TRIGGERS.test(text) || BOTH_TRIGGERS.test(text);

export const TOOL_TRIGGERS = /\b(file|read|write|list|folder|directory|create|project|git|commit|push|pull|status|branch|browser|search|navigate|code|run|execute|script|python|javascript|bash|terminal|command|volume|brightness|open.*app|screenshot|mouse|click|scroll|type|process|kill|shutdown|system.*info)\b/i;
export const detectToolNeed = (text: string) => TOOL_TRIGGERS.test(text);

// ── Text Helpers ──
export const cleanForSpeech = (text: string) => text
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/[*_~`#>\[\]()]/g, '')
  .replace(/https?:\/\/\S+/g, '')
  .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
  .replace(/\s+/g, ' ')
  .trim();

export const normalizeCommand = (text: string) => text
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s.:/-]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// ── System Paths ──
export const userHome = os.homedir();
export const windowsDir = process.env.WINDIR || 'C:\\Windows';
export const knownFolders: Record<string, string> = {
  desktop: path.join(userHome, 'Desktop'),
  downloads: path.join(userHome, 'Downloads'),
  download: path.join(userHome, 'Downloads'),
  documents: path.join(userHome, 'Documents'),
  document: path.join(userHome, 'Documents'),
  pictures: path.join(userHome, 'Pictures'),
  picture: path.join(userHome, 'Pictures'),
  photos: path.join(userHome, 'Pictures'),
  music: path.join(userHome, 'Music'),
  videos: path.join(userHome, 'Videos'),
  video: path.join(userHome, 'Videos'),
};

// ── Web Search Cache ──
export const searchCache: Record<string, any> = {};

// ── Pending System Action ──
export let pendingSystemAction: any = null;
export const COMMAND_TIMEOUT = 30000;

export function setPendingAction(action: any) {
  pendingSystemAction = action;
}

export function clearPendingAction() {
  pendingSystemAction = null;
}

// ── Recipe Messages ──
export const recipeMessages: any[] = [];
