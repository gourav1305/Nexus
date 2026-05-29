// @ts-nocheck
import * as path from 'path';
import * as fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '.env') });
import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import * as os from 'os';
import { spawn } from 'child_process';
import { createServer } from 'http';
import multer from 'multer';
import { WebSocketServer } from 'ws';

const app = express();

// Dependency check
const requiredDeps = ['express', 'cors', 'groq-sdk', 'dotenv', 'better-sqlite3'];
for (const dep of requiredDeps) {
  try {
    require(dep);
  } catch (e) {
    console.error(`[Error] Missing dependency: ${dep}. Run 'npm install' to fix.`);
    process.exit(1);
  }
}

app.use(cors({
    origin: [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:5174',
        'http://127.0.0.1:5174',
        'http://localhost:5175',
        'http://127.0.0.1:5175',
        'http://localhost:5060',
        'http://127.0.0.1:5060',
    ],
}));
app.use(express.json({ limit: '10mb' }));

import {
    VOICE_MODES,
    SPEAKING_RATES,
    DEFAULT_VOICE_MODE,
    DEFAULT_SPEAKING_RATE,
    resolveVoicePrefs,
} from './voiceCatalog';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const TTS_VOICE = process.env.TTS_VOICE || 'en-IN-NeerjaNeural';

// ── Model Router ──
import modelRouter = require('./services/modelRouter');
import systemCommander = require('./services/systemCommander');
import agentOrchestrator = require('./services/agentOrchestrator');
import db = require('./db');

// Initialize systemCommander with modelRouter for vision analysis
systemCommander.init(modelRouter, {
  provider: 'groq',
  model: 'meta-llama/llama-4-scout-17b-16e-instruct',
  autoRoute: true,
});

let serverModelPrefs = {
  provider: 'groq',
  model: GROQ_MODEL,
  visionModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
  autoRoute: true,
};

let serverVoiceSettings = resolveVoicePrefs({
    voiceMode: DEFAULT_VOICE_MODE,
    speakingRate: DEFAULT_SPEAKING_RATE,
    voice: TTS_VOICE,
});

// ── Helpers for RAG detection ──
const MEMORY_TRIGGERS = /\b(yaad\s*dilao|yaad\s*karo|kal\s*kya\s*baat|pehle\s*kya\s*hua|pehle\s*ki\s*baat|jo\s*humne\s*baat|pichhli\s*baat|purani\s*baat|remember|recall|what did we|jo.*pehle|uske\s*baare\s*me.*batao)\b/i;
const SEARCH_TRIGGERS = /\b(search|find|look up|google|khoj|dhoondh|dhundo|pata karo|info about|information about|what is|who is|tell me about|latest.*news|recent.*update)\b/i;
const BOTH_TRIGGERS = /\b(new|update|current|recent|aaj\s*ka|today)\b/i;

const detectMemoryQuery = (text) => MEMORY_TRIGGERS.test(text);
const detectSearchQuery = (text) => SEARCH_TRIGGERS.test(text) || BOTH_TRIGGERS.test(text);

// ── Tool Need Detection (only show tool instructions when user asks for tool ops) ──
const TOOL_TRIGGERS = /\b(file|read|write|list|folder|directory|create|project|git|commit|push|pull|status|branch|browser|search|navigate|code|run|execute|script|python|javascript|bash|terminal|command|volume|brightness|open.*app|screenshot|mouse|click|scroll|type|process|kill|shutdown|system.*info)\b/i;
const detectToolNeed = (text) => TOOL_TRIGGERS.test(text);

// ── Web Search Endpoint ──
const searchCache = {};

app.get('/api/web/search', async (req, res) => {
  try {
    const { q, limit } = req.query as Record<string, string>;
    if (!q || !q.trim()) return res.status(400).json({ ok: false, error: 'Query param "q" required' });
    const num = Math.min(parseInt(limit) || 5, 10);
    const cacheKey = `${q}:${num}`;

    if (searchCache[cacheKey] && Date.now() - searchCache[cacheKey].ts < 120000) {
      return res.json({ ok: true, ...searchCache[cacheKey].data, cached: true });
    }

    const results = await searchWeb(q, num);
    searchCache[cacheKey] = { data: results, ts: Date.now() };
    res.json({ ok: true, ...results });
  } catch (err) {
    logEvent('error', 'Web search failed', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Monitoring & Usage Tracking ──
let pendingSystemAction = null;
const COMMAND_TIMEOUT = 30000;

const apiUsage = {
    llmCalls: 0,
    ttsCalls: 0,
    systemCommands: 0,
    infoQueries: 0,
    totalChats: 0,
    startTime: Date.now(),
};

const eventLog = [];
const MAX_LOG_ENTRIES = 200;

function logEvent(category, message, detail = null) {
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


const cleanForSpeech = (text) => text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_~`#>\[\]()]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeCommand = (text) => text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.:/-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const userHome = os.homedir();
const windowsDir = process.env.WINDIR || 'C:\\Windows';
const knownFolders = {
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

const launchProcess = (command: string, args: string[] = [], options: Record<string, any> = {}) => new Promise<any>((resolve, reject) => {
    const captureOutput = Boolean(options.captureOutput);
    const child = spawn(command, args, {
        detached: options.detached ?? !captureOutput,
        shell: Boolean(options.shell),
        stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'ignore',
        windowsHide: false,
    });

    let settled = false;
    let stdout = '';
    let stderr = '';
    const settle = (callback: (...args: any[]) => void, value?: any) => {
        if (settled) return;
        settled = true;
        callback(value);
    };

    if (captureOutput) {
        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString();
        });
    }

    child.once('error', (error) => {
        settle(reject, error);
    });

    child.once('exit', (code) => {
        if (!captureOutput) return;
        if (code === 0) {
            settle(resolve, { stdout, stderr });
        } else {
            settle(reject, new Error(stderr || stdout || `${command} exited with code ${code}`));
        }
    });

    child.once('spawn', () => {
        if (captureOutput) return;
        setTimeout(() => settle(resolve), 250);
    });

    if (!captureOutput) {
        child.unref();
    }
});

const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

const runPowerShell = (command) => {
    console.log('[NEXUS Tool] PowerShell:', command);
    return launchProcess('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        command,
    ], { captureOutput: true });
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isProcessRunning = async (imageName) => {
    const result = await launchProcess('tasklist.exe', [
        '/FI',
        `IMAGENAME eq ${imageName}`,
        '/NH',
    ], { captureOutput: true });
    return result.stdout.toLowerCase().includes(imageName.toLowerCase());
};

const openUrl = async (url) => {
    console.log('[NEXUS Tool] Opening URL:', url);
    try {
        await launchProcess('explorer.exe', [url]);
    } catch (error) {
        console.warn('[NEXUS Tool] Explorer URL open failed, trying rundll32:', error.message);
        await launchProcess('rundll32.exe', ['url.dll,FileProtocolHandler', url]);
    }
};

const openApp = async (appName: string, options: Record<string, any> = {}) => {
    const appPath = options.path || appName;
    console.log('[NEXUS Tool] Opening app:', appPath);
    try {
        await launchProcess(appPath);
    } catch (error) {
        console.warn('[NEXUS Tool] Direct app open failed, trying PowerShell:', error.message);
        await runPowerShell(`Start-Process -FilePath ${psQuote(appPath)} -WindowStyle Normal`);
    }

    if (options.verifyProcess) {
        await wait(700);
        const running = await isProcessRunning(options.verifyProcess);
        if (!running) {
            throw new Error(`${options.verifyProcess} process launch verify failed`);
        }
    }
};

const openFolder = async (folderPath) => {
    console.log('[NEXUS Tool] Opening folder:', folderPath);
    try {
        await launchProcess('explorer.exe', [folderPath]);
    } catch (error) {
        console.warn('[NEXUS Tool] Explorer folder open failed, trying PowerShell:', error.message);
        await runPowerShell(`Start-Process -FilePath 'explorer.exe' -ArgumentList ${psQuote(folderPath)}`);
    }
};

const detectSystemCommand = (message) => {
    const text = normalizeCommand(message);

    const wantsOpen = /\b(open|launch|start|kholo|khol|karo|kar|chalao|run)\b/.test(text);
    if (!wantsOpen) return null;

    if (/\bnotepad\b/.test(text) || text.includes('note pad')) {
        return {
            name: 'open_notepad',
            reply: 'Notepad open kar diya.',
            run: () => openApp('notepad.exe', {
                path: path.join(windowsDir, 'System32', 'notepad.exe'),
                verifyProcess: 'notepad.exe',
            }),
        };
    }

    if (/\b(calculator|calc)\b/.test(text) || text.includes('calculator kholo')) {
        return {
            name: 'open_calculator',
            reply: 'Calculator open kar diya.',
            run: () => openApp('calc.exe'),
        };
    }

    if (/\b(youtube|you tube)\b/.test(text)) {
        const searchMatch = text.match(/(?:youtube|you tube)(?:\s+(?:par|pe|me|mein|search|search for))?\s+(.+)/);
        const query = searchMatch?.[1]
            ?.replace(/\b(open|launch|start|kholo|khol|karo|kar|do|chalao|run|search|for|par|pe|me|mein)\b/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const url = query
            ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
            : 'https://www.youtube.com';

        return {
            name: 'open_youtube',
            reply: query ? `YouTube par ${query} search kar diya.` : 'YouTube open kar diya.',
            run: () => openUrl(url),
        };
    }

    if (/\b(google|browser|chrome)\b/.test(text)) {
        return {
            name: 'open_google',
            reply: 'Browser me Google open kar diya.',
            run: () => openUrl('https://www.google.com'),
        };
    }

    for (const [folderName, folderPath] of Object.entries(knownFolders)) {
        const folderPattern = new RegExp(`\\b${folderName}\\b`);
        if (folderPattern.test(text)) {
            return {
                name: `open_${folderName}`,
                reply: `${folderName.charAt(0).toUpperCase() + folderName.slice(1)} folder open kar diya.`,
                run: () => openFolder(folderPath),
            };
        }
    }

    if (
        text.includes('file explorer')
        || text.includes('explorer')
        || text.includes('file manager')
        || text.includes('files')
        || text.includes('folders')
        || /\bfolder\b/.test(text)
    ) {
        return {
            name: 'open_file_explorer',
            reply: 'File Explorer open kar diya.',
            run: () => openFolder(userHome),
        };
    }

    if (text.includes('this pc') || text.includes('my computer')) {
        return {
            name: 'open_this_pc',
            reply: 'This PC open kar diya.',
            run: () => openFolder('shell:MyComputerFolder'),
        };
    }

    // --- NEW COMMANDS ---

    // VS Code
    if (/\b(vs code|vscode|code)\b/.test(text)) {
        return {
            name: 'open_vscode',
            reply: 'Visual Studio Code open kar diya.',
            run: () => openApp('code'),
        };
    }

    // Chrome
    if (/\b(chrome|google chrome)\b/.test(text)) {
        return {
            name: 'open_chrome',
            reply: 'Google Chrome open kar diya.',
            run: () => openApp('chrome.exe'),
        };
    }

    // WhatsApp
    if (/\b(whatsapp|whats app|wa)\b/.test(text)) {
        return {
            name: 'open_whatsapp',
            reply: 'WhatsApp Web open kar diya.',
            run: () => openUrl('https://web.whatsapp.com'),
        };
    }

    // Spotify
    if (/\bspotify\b/.test(text)) {
        return {
            name: 'open_spotify',
            reply: 'Spotify open kar diya.',
            run: () => openUrl('https://open.spotify.com'),
        };
    }

    // Media Controls
    if (/\bvolume (up|badhao|tej)\b/.test(text)) {
        return {
            name: 'volume_up',
            reply: 'Volume badha diya.',
            run: () => runPowerShell('(new-object -com wscript.shell).SendKeys([char]175)'),
        };
    }
    if (/\bvolume (down|kam|ghatao)\b/.test(text)) {
        return {
            name: 'volume_down',
            reply: 'Volume kam kar diya.',
            run: () => runPowerShell('(new-object -com wscript.shell).SendKeys([char]174)'),
        };
    }
    if (/\b(mute|unmute|silent)\b/.test(text)) {
        return {
            name: 'volume_mute',
            reply: 'Volume mute ya unmute kar diya.',
            run: () => runPowerShell('(new-object -com wscript.shell).SendKeys([char]173)'),
        };
    }

    // Utilities
    if (/\b(screenshot|screen shot|capture screen)\b/.test(text)) {
        return {
            name: 'capture_screenshot',
            reply: 'Screenshot le liya aur Pictures folder me save kar diya.',
            run: async () => {
                const ssPath = path.join(knownFolders.pictures, `Nexus_SS_${Date.now()}.png`);
                const script = `
                    [Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');
                    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
                    $bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height);
                    $graphics = [System.Drawing.Graphics]::FromImage($bitmap);
                    $graphics.CopyFromScreen($screen.X, $screen.Y, 0, 0, $bitmap.Size);
                    $bitmap.Save('${ssPath}', [System.Drawing.Imaging.ImageFormat]::Png);
                    $graphics.Dispose();
                    $bitmap.Dispose();
                `;
                return runPowerShell(script);
            },
        };
    }

    if (/\b(task manager|taskmanager|processes)\b/.test(text)) {
        return {
            name: 'open_task_manager',
            reply: 'Task Manager open kar diya.',
            run: () => launchProcess('taskmgr.exe'),
        };
    }

    if (/\b(control panel|settings|controlpanel)\b/.test(text) && !text.includes('wifi')) {
        return {
            name: 'open_control_panel',
            reply: 'Control Panel open kar diya.',
            run: () => launchProcess('control.exe'),
        };
    }

    if (/\b(wifi|wi fi|internet settings)\b/.test(text)) {
        return {
            name: 'open_wifi_settings',
            reply: 'WiFi setting open kar diya.',
            run: () => runPowerShell('Start-Process ms-settings:network-wifi'),
        };
    }

    // Destructive Commands (Confirmation Protected)
    if (/\b(shutdown|shut down|power off|band kar)\b/.test(text)) {
        return {
            name: 'system_shutdown_init',
            reply: 'NEXUS command locked: Are you sure you want to shutdown the computer? Please say "Confirm Shutdown" to proceed.',
            requiresConfirmation: true,
            confirmKeyword: 'shutdown',
            run: () => runPowerShell('shutdown /s /t 10 /f'),
        };
    }

    // To-Do List Commands
    if (/\b(add|put|write|nawa|likho|rakhu|rakh)\b/.test(text) && /\b(todo|task|kaam|list)\b/.test(text)) {
        const todoMatch = text.match(/(?:add|put|write|nawa|likho|rakhu|rakh)\s+(?:todo|task|kaam|list)?\s*(.+)/);
        const todoText = todoMatch?.[1]?.trim();
        if (todoText) {
            return {
                name: 'add_todo',
                reply: `Theek hai, maine list me add kar diya: "${todoText}"`,
                run: async (userId) => {
                    if (!userId) throw new Error('User not authenticated');
                    return db.addTodo(userId, todoText);
                }
            };
        }
    }

    if (/\b(show|tell|check|dekh|dikhao|batao)\b/.test(text) && /\b(todo|task|kaam|list)\b/.test(text)) {
        return {
            name: 'list_todos',
            reply: 'Aapki current list ye rahi.',
            run: async (userId) => {
                if (!userId) throw new Error('User not authenticated');
                return db.getTodos(userId);
            }
        };
    }

    // Summarization Command
    if (/\b(summarize|summary|nichod|chhota karo|shorten|brief)\b/.test(text)) {
        const topicMatch = text.match(/(?:summarize|summary|nichod|chhota karo|shorten|brief)\s+(?:of|this|the|is|ka|ki|ko)?\s*(.+)/);
        const topic = topicMatch?.[1]?.trim();
        return {
            name: 'summarize_content',
            reply: topic ? `Wait, main "${topic}" ko summarize kar rha hun...` : 'Theek hai, main summarize kar raha hun.',
            run: async (userId, fullMsg) => {
                return handleSummarization(topic || fullMsg, userId);
            }
        };
    }

    // Calendar Commands
    if (/\b(schedule|events|meetings|mulaqat|calendar)\b/.test(text)) {
        return {
            name: 'list_calendar_events',
            reply: 'Checking your schedule...',
            run: async (userId) => {
                if (!userId) throw new Error('User not authenticated');
                const now = Date.now();
                const endOfDay = new Date().setHours(23, 59, 59, 999);
                return db.getEvents(userId, now, endOfDay);
            }
        };
    }

    return null;
};

// ── Summarization Helper ──
async function handleSummarization(input, userId) {
    logEvent('system', 'Summarization requested', input);
    
    let contentToSummarize = input;
    
    // Check if input is a file path
    if (input.includes(':') || input.includes('\\') || input.includes('/')) {
        try {
            const result = await systemCommander.readFile(input);
            if (result.content) contentToSummarize = result.content;
        } catch (e) {
            // Not a file, proceed as text
        }
    }

    const prompt = `Please provide a concise and clear summary of the following content. Use bullet points if necessary. Keep it under 200 words.
    
    Content:
    ${contentToSummarize.slice(0, 10000)}`;

    const result = await modelRouter.routeQuery(serverModelPrefs, [
        { role: 'system', content: 'You are a helpful assistant that summarizes text efficiently.' },
        { role: 'user', content: prompt }
    ]);

    return result.text;
}


import { synthesizeSpeech } from './ttsEngine';
import { detectInfoQuery, handleInfoQuery, getInfoApiStatus } from './services/infoServices';
import { createRecipeEngine } from './recipeEngine';
import { router as authRouter, authMiddleware, optionalAuth } from './auth';
import { createTtsStreamHandler } from './services/ttsStream';
import { detectEmotion, buildSystemPrompt } from './services/emotionDetector';
import { searchWeb, fetchPageContent } from './services/webSearch';
import memoryStore from './services/memoryStore';
import { executeCode } from './services/codeRunner';
import * as emailService from './services/emailService';
import * as imageGen from './services/imageGen';
import * as translationService from './services/translationService';
import * as voiceLab from './services/voiceLab';

app.get('/api/voices', (req, res) => {
    res.json({
        ok: true,
        modes: VOICE_MODES,
        rates: SPEAKING_RATES,
        default: {
            voiceMode: DEFAULT_VOICE_MODE,
            speakingRate: DEFAULT_SPEAKING_RATE,
            voice: serverVoiceSettings.voice,
        },
        active: serverVoiceSettings,
    });
});

app.get('/api/settings/voice', (req, res) => {
    res.json({
        ok: true,
        settings: serverVoiceSettings,
    });
});

app.post('/api/settings/voice', (req, res) => {
    try {
        serverVoiceSettings = resolveVoicePrefs(req.body || {}, TTS_VOICE);
        res.json({
            ok: true,
            settings: serverVoiceSettings,
        });
    } catch (error) {
        res.status(400).json({
            ok: false,
            error: error.message || 'Invalid voice settings',
        });
    }
});

// ── Model Settings ──
app.get('/api/models', async (req, res) => {
  try {
    const info = modelRouter.detectProviders();
    const ollama = await modelRouter.checkOllama();
    if (ollama.available && !info.providers.includes('ollama')) {
      info.providers.push('ollama');
      info.models.ollama = ollama.models;
    }
    res.json({ ok: true, ...info, ollama, active: serverModelPrefs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/settings/models', (req, res) => {
  res.json({ ok: true, settings: serverModelPrefs });
});

app.post('/api/settings/models', (req, res) => {
  try {
    const { provider, model, visionModel, autoRoute } = req.body || {};
    if (provider) serverModelPrefs.provider = provider;
    if (model) serverModelPrefs.model = model;
    if (visionModel) serverModelPrefs.visionModel = visionModel;
    if (autoRoute !== undefined) serverModelPrefs.autoRoute = Boolean(autoRoute);
    res.json({ ok: true, settings: serverModelPrefs });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        model: serverModelPrefs.model,
        modelProvider: serverModelPrefs.provider,
        visionModel: serverModelPrefs.visionModel,
        autoRoute: serverModelPrefs.autoRoute,
        voice: serverVoiceSettings.voice,
        voiceMode: serverVoiceSettings.voiceMode,
        speakingRate: serverVoiceSettings.speakingRate,
        groqKeyConfigured: Boolean(process.env.GROQ_API_KEY),
        openaiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
        anthropicKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
        systemTools: true,
        platform: process.platform,
        home: userHome,
    });
});

app.get('/api/info/status', (req, res) => {
    res.json({
        ok: true,
        apis: getInfoApiStatus(),
    });
});

app.get('/api/tools', (req, res) => {
    res.json({
        ok: true,
        platform: process.platform,
        home: userHome,
        commands: [
            'open notepad',
            'open calculator',
            'open youtube',
            'youtube par arijit singh search karo',
            'open google',
            'open file explorer',
            'open downloads folder',
            'open documents folder',
            'open this pc',
            'aaj delhi ka weather kya hai',
            'mumbai ka mausam batao',
            'latest tech news batao',
            'latest sports news',
            'virat kohli ke baare me batao',
            'wikipedia par taj mahal',
            'search latest ai news',
            'google artificial intelligence',
        ],
        infoApis: getInfoApiStatus(),
        launcher: 'powershell Start-Process with explorer/rundll32 fallback',
    });
});

app.get('/api/test/notepad', async (req, res) => {
    try {
        await openApp('notepad.exe', {
            path: path.join(windowsDir, 'System32', 'notepad.exe'),
            verifyProcess: 'notepad.exe',
        });
        res.json({ ok: true, message: 'notepad.exe started and verified' });
    } catch (error) {
        console.error('[NEXUS Tool] Notepad test failed:', error);
        res.status(500).json({
            ok: false,
            error: error.message,
            platform: process.platform,
            windowsDir,
            cwd: process.cwd(),
        });
    }
});

// ── System Monitoring Endpoints ──
app.get('/api/system/stats', async (req, res) => {
    try {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const cpuLoad = os.loadavg();
        const cpus = os.cpus();
        const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown';
        const cpuCores = cpus.length;

        let diskInfo = {};
        try {
            const diskResult = await runPowerShell('Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{N="GBUsed";E={[math]::Round(($_.Used/1GB),1)}}, @{N="GBFree";E={[math]::Round(($_.Free/1GB),1)}}, @{N="GBTotal";E={[math]::Round(($_.Used+$_.Free)/1GB,1)}} | ConvertTo-Json');
            diskInfo = JSON.parse(diskResult.stdout);
        } catch (e) {
            diskInfo = { error: 'Disk info unavailable' };
        }

        res.json({
            ok: true,
            platform: process.platform,
            hostname: os.hostname(),
            uptime: Math.floor(process.uptime()),
            systemUptime: Math.floor(os.uptime()),
            memory: {
                total: totalMem,
                free: freeMem,
                used: usedMem,
                usagePercent: Math.round((usedMem / totalMem) * 100),
            },
            cpu: {
                model: cpuModel,
                cores: cpuCores,
                load1: cpuLoad[0]?.toFixed(2),
                load5: cpuLoad[1]?.toFixed(2),
                load15: cpuLoad[2]?.toFixed(2),
            },
            disk: diskInfo,
            nodeVersion: process.version,
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.get('/api/system/usage', (req, res) => {
    res.json({
        ok: true,
        uptime: Math.floor((Date.now() - apiUsage.startTime) / 1000),
        counters: apiUsage,
        startTime: apiUsage.startTime,
    });
});

app.get('/api/system/logs', (req, res) => {
    const { category, search, limit = 50, since } = req.query;
    let filtered = [...eventLog];

    if (category) {
        filtered = filtered.filter(e => e.category === category);
    }
    if (search) {
        const s = search.toLowerCase();
        filtered = filtered.filter(e =>
            e.message.toLowerCase().includes(s) ||
            (e.detail && e.detail.toLowerCase().includes(s))
        );
    }
    if (since) {
        const sinceTs = parseInt(since);
        if (!isNaN(sinceTs)) {
            filtered = filtered.filter(e => e.timestamp > sinceTs);
        }
    }

    filtered.reverse();
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(limit), 100);
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    res.json({
        ok: true,
        total: filtered.length,
        page,
        pageSize,
        totalPages: Math.ceil(filtered.length / pageSize),
        entries: items,
    });
});

// ── Auth + User Routes ──
app.use('/api/auth', authRouter);

// ── Recipe Engine ──
const recipeMessages = [];

const recipeEngine = createRecipeEngine({
  app,
  runPowerShell,
  logEvent,
  apiUsage,
  recipeMessages,
});

app.get('/api/recipes/log/all', (req, res) => {
  res.json({ ok: true, entries: recipeEngine.getRecipeLog() });
});

app.get('/api/recipes/messages/pending', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const newMessages = recipeMessages.filter(m => m.timestamp > since);
  res.json({ ok: true, messages: newMessages, serverTime: Date.now() });
});

app.get('/api/recipes/pending-blob', (req, res) => {
  res.json({ ok: true, actions: recipeEngine.getPendingBlobActions() });
});

recipeEngine.start();

// ── Vision / Image Analysis Endpoint ──
app.post('/api/chat/vision', optionalAuth, async (req, res) => {
    try {
        const { message, imageBase64, imageMimeType, voice, rate, voiceMode, speakingRate, language } = req.body || {};
        const voicePrefs = resolveVoicePrefs(
            { voice, rate, voiceMode, speakingRate, language },
            serverVoiceSettings.voice,
        );

        if (!imageBase64) {
            return res.status(400).json({ error: 'No image data provided' });
        }

        const dataUrl = `data:${imageMimeType || 'image/jpeg'};base64,${imageBase64}`;
        const userText = (message || '').trim() || 'What is in this image? Describe it in detail.';

        apiUsage.llmCalls++;
        logEvent('llm', 'Vision call', userText);

        const messages = [{
            role: 'user',
            content: [
                { type: 'text', text: userText },
                { type: 'image_url', image_url: { url: dataUrl } },
            ],
        }];

        const result = await modelRouter.routeVision(serverModelPrefs, messages, {
          preferredProvider: serverModelPrefs.provider,
          preferredModel: serverModelPrefs.visionModel,
          category: 'general',
          forVision: true,
        });

        const textResponse = result.text;
        if (!textResponse) {
            logEvent('error', 'Vision LLM empty response');
            return res.status(502).json({ error: 'Vision model returned an empty response' });
        }

        const speech = await synthesizeSpeech(textResponse, voicePrefs, TTS_VOICE);
        apiUsage.ttsCalls++;

        res.json({
            text: textResponse,
            ...speech,
            model: `${result.provider}/${result.model}`,
            vision: true,
        });

    } catch (err) {
        console.error('Vision API Error:', err);
        logEvent('error', 'Vision API error', err.message);
        res.status(500).json({ error: err.message || 'Vision analysis failed' });
    }
});

app.post('/api/chat', optionalAuth, async (req, res) => {
    try {
        const { message, voice, rate, voiceMode, speakingRate, language } = req.body || {};
        const voicePrefs = resolveVoicePrefs(
            { voice, rate, voiceMode, speakingRate, language },
            serverVoiceSettings.voice,
        );
        serverVoiceSettings = voicePrefs;
        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Message required' });
        }

        apiUsage.totalChats++;
        const systemCommand = detectSystemCommand(message);

        // --- Confirmation Logic ---
        if (pendingSystemAction && Date.now() - pendingSystemAction.time < COMMAND_TIMEOUT) {
            const normalizedMsg = normalizeCommand(message);
            const isConfirmed = normalizedMsg.includes('confirm') || normalizedMsg.includes('yes') || normalizedMsg.includes('haan') || normalizedMsg.includes(pendingSystemAction.keyword);
            
            if (isConfirmed) {
                const action = pendingSystemAction.action;
                const actionName = pendingSystemAction.name.replace('_init', '');
                pendingSystemAction = null;
                
                try {
                    await action();
                    const confirmReply = `${actionName.charAt(0).toUpperCase() + actionName.slice(1)} process initiated successfully.`;
                    const speech = await synthesizeSpeech(confirmReply, voicePrefs, TTS_VOICE);
                    apiUsage.ttsCalls++;
                    logEvent('system', `Confirmation executed: ${actionName}`);
                    return res.json({ text: confirmReply, ...speech, model: 'nexus-system-tools' });
                } catch (err) {
                    const failReply = `NEXUS was unable to complete the action: ${err.message}`;
                    const speech = await synthesizeSpeech(failReply, voicePrefs, TTS_VOICE);
                    apiUsage.ttsCalls++;
                    logEvent('error', `Confirmation failed: ${actionName}`, err.message);
                    return res.status(500).json({ text: failReply, ...speech, error: err.message });
                }
            } else if (normalizedMsg.includes('no') || normalizedMsg.includes('cancel') || normalizedMsg.includes('nahi')) {
                pendingSystemAction = null;
                const cancelReply = "Action cancelled. System standby.";
                const speech = await synthesizeSpeech(cancelReply, voicePrefs, TTS_VOICE);
                apiUsage.ttsCalls++;
                return res.json({ text: cancelReply, ...speech });
            }
        }

        const infoQuery = detectInfoQuery(message);
        if (infoQuery) {
            try {
                const infoReply = await handleInfoQuery(infoQuery);
                const speech = await synthesizeSpeech(infoReply, voicePrefs, TTS_VOICE);
                apiUsage.infoQueries++;
                apiUsage.ttsCalls++;
                logEvent('info', `${infoQuery.type} query`, message);
                // Store in memory
                if (req.userId) {
                  try {
                    await memoryStore.add(groq, req.userId, 'user', 'user', message.trim());
                    await memoryStore.add(groq, req.userId, 'nexus', 'assistant', infoReply);
                  } catch {}
                }
                return res.json({
                    text: infoReply,
                    ...speech,
                    model: 'nexus-info',
                    toolUsed: infoQuery.type,
                });
            } catch (infoError) {
                console.error('[NEXUS Info] Failed:', infoQuery.type, infoError.message);
                logEvent('error', `Info query failed: ${infoQuery.type}`, infoError.message);
                // Fall through to LLM + RAG instead of returning error
            }
        }

        if (systemCommand) {
            if (systemCommand.requiresConfirmation) {
                pendingSystemAction = {
                    action: systemCommand.run,
                    name: systemCommand.name,
                    keyword: systemCommand.confirmKeyword,
                    time: Date.now()
                };
                logEvent('system', `Pending confirmation: ${systemCommand.name}`, message);
            } else {
                try {
                    await systemCommand.run();
                    apiUsage.systemCommands++;
                    logEvent('system', `Executed: ${systemCommand.name}`, message);
                } catch (error) {
                    console.error('[NEXUS Tool] Launch failed:', systemCommand.name, error);
                    const failReply = `${systemCommand.name.replace(/_/g, ' ')} open nahi ho paya. Administrator privileges check karein.`;
                    const speech = await synthesizeSpeech(failReply, voicePrefs, TTS_VOICE);
                    apiUsage.ttsCalls++;
                    logEvent('error', `System command failed: ${systemCommand.name}`, error.message);

                    return res.status(500).json({
                        error: failReply,
                        text: failReply,
                        ...speech,
                        model: 'nexus-system-tools',
                        toolUsed: systemCommand.name,
                    });
                }
            }

            const speech = await synthesizeSpeech(systemCommand.reply, voicePrefs, TTS_VOICE);
            apiUsage.ttsCalls++;
            if (!systemCommand.requiresConfirmation) {
                apiUsage.systemCommands++;
            }

            return res.json({
                text: systemCommand.reply,
                ...speech,
                model: 'nexus-system-tools',
                toolUsed: systemCommand.name,
            });
        }


        // ── Agent Task Detection ──
        if (agentOrchestrator.detectTaskRequest(message)) {
          try {
            logEvent('agent', 'Task detected', message);
            const taskResult = await agentOrchestrator.processTask(
              message.trim(),
              serverModelPrefs,
              (type, msg) => {
                if (type === 'log') console.log('[Agent]', msg);
              },
            );
            const taskSummary = taskResult.summary;
            const speech = await synthesizeSpeech(taskSummary, voicePrefs, TTS_VOICE);
            apiUsage.ttsCalls++;
            apiUsage.llmCalls++;
            return res.json({
              text: taskSummary,
              ...speech,
              model: 'nexus-agent',
              taskResult,
            });
          } catch (taskErr) {
            logEvent('error', 'Agent task failed', taskErr.message);
            // Fall through to normal LLM
          }
        }

        if (!process.env.GROQ_API_KEY) {
            return res.status(500).json({ error: 'GROQ_API_KEY is missing in Backend/.env' });
        }

        apiUsage.llmCalls++;
        logEvent('llm', 'LLM call', message);

        const emotion = detectEmotion(message.trim());
        let systemContent = buildSystemPrompt(
          'You are NEXUS, a concise voice assistant. Reply naturally in the same language or Hinglish style as the user. Keep responses voice-friendly and avoid markdown unless absolutely needed.',
          emotion,
        );
        if (emotion) logEvent('emotion', `Detected: ${emotion.emotion} (score: ${emotion.score})`);

        // Only add system tool capabilities when user asks for tool operations
        const needsTools = detectToolNeed(message.trim());
        if (needsTools) {
          systemContent += '\n\n' + systemCommander.buildToolSystemPrompt();
          logEvent('tool', 'Tool instructions added to prompt', message);
        }

        // ── RAG: Web Search + Memory Retrieval ──
        let ragContext = '';
        const userId = req.userId || null;
        const needsMemory = userId && detectMemoryQuery(message);
        const needsWebSearch = detectSearchQuery(message);

        if (needsMemory || needsWebSearch) {
          // Retrieve past conversation memory
          if (needsMemory && userId) {
            try {
              const memories = await memoryStore.query(groq, userId, message, 5);
              if (memories.length > 0) {
                ragContext += '\nPast conversation context:\n' + memories.map(m =>
                  `[${m.role}]: ${m.content}`
                ).join('\n') + '\n';
                logEvent('rag', 'Memory retrieved', `${memories.length} entries`);
              }
            } catch (memErr) {
              logEvent('error', 'Memory retrieval failed', memErr.message);
            }
          }

          // Web search for external info (skip if only memory query)
          if (needsWebSearch) {
            const searchQuery = message
              .replace(/search|find|look up|google|khoj|dhoondh|dhundo|pata karo|kya\s+hota\s+hai|kya\s+hai|batao|tell me|about|info|yaad\s*dilao|yaad\s*karo|kal|pehle/gi, '')
              .replace(/\s+/g, ' ')
              .trim();
            if (searchQuery.length > 3) {
              try {
                const webResults = await searchWeb(searchQuery, 3);
                if (webResults.snippets.length > 0) {
                  ragContext += '\nWeb search results:\n' + webResults.snippets.map((s, i) =>
                    `[${i + 1}] ${s}`
                  ).join('\n') + '\nSources: ' + webResults.sources.map(s => s.url).join(', ');
                  apiUsage.infoQueries++;
                  logEvent('rag', 'Web search for chat', searchQuery);
                }
              } catch (webErr) {
                logEvent('error', 'Web search failed in chat', webErr.message);
              }
            }
          }
        }

        if (ragContext) {
          systemContent += '\n\nRelevant context (use this to answer the user):\n' + ragContext;
          logEvent('rag', 'Context injected', `${ragContext.length} chars`);
        }

        const messages = [
          { role: 'system', content: systemContent },
          { role: 'user', content: message.trim() },
        ];

        const result = await modelRouter.routeQuery(serverModelPrefs, messages, {
          preferredProvider: serverModelPrefs.provider,
          preferredModel: serverModelPrefs.model,
          autoRoute: serverModelPrefs.autoRoute,
        });

        const textResponse = result.text;
        if (!textResponse) {
            logEvent('error', 'LLM empty response', message);
            return res.status(502).json({ error: 'LLM returned an empty response' });
        }

        // ── Execute any tool calls from LLM response (only if tool instructions were given) ──
        let displayText = textResponse;
        let toolResults = [];
        const toolCalls = needsTools ? systemCommander.parseToolCalls(textResponse) : [];
        for (const tc of toolCalls) {
          try {
            const toolResult = await systemCommander.executeTool(tc);
            toolResults.push({ type: tc.type, action: tc.action, result: toolResult });
            logEvent('tool', `${tc.type}/${tc.action}`, JSON.stringify(tc.params || {}).slice(0, 200));
            apiUsage.systemCommands++;
          } catch (toolErr) {
            toolResults.push({ type: tc.type, action: tc.action, error: toolErr.message });
            logEvent('error', `Tool failed: ${tc.type}/${tc.action}`, toolErr.message);
          }
        }
        if (toolCalls.length > 0) {
          // Feed tool results back to the LLM so it can formulate a proper response with actual data
          const toolSummary = toolResults.map(t =>
            t.error
              ? `${t.type}/${t.action}: Error - ${t.error}`
              : `${t.type}/${t.action}: ${JSON.stringify(t.result).slice(0, 800)}`
          ).join('\n\n');
          const followUpMessages = [
            { role: 'system', content: systemContent },
            { role: 'user', content: message.trim() },
            { role: 'assistant', content: textResponse },
            { role: 'user', content: `You used the tools above. Here are the results:\n${toolSummary}\n\nBased on this data, respond to the user's original query naturally. Keep it concise and voice-friendly.` },
          ];
          try {
            const followUpResult = await modelRouter.routeQuery(serverModelPrefs, followUpMessages, {
              preferredProvider: serverModelPrefs.provider,
              preferredModel: serverModelPrefs.model,
              autoRoute: serverModelPrefs.autoRoute,
            });
            apiUsage.llmCalls++;
            displayText = followUpResult.text || textResponse.replace(/```tool[\s\S]*?```/g, '').trim();
          } catch (followUpErr) {
            logEvent('error', 'Tool follow-up LLM failed', followUpErr.message);
            displayText = textResponse.replace(/```tool[\s\S]*?```/g, '').trim();
          }
          if (!displayText) {
            const toolSummary = toolResults.map(t =>
              t.error ? `${t.type}/${t.action}: Error - ${t.error}` : `${t.type}/${t.action}: Ok`
            ).join(', ');
            displayText = `Done: ${toolSummary}`;
          }
        }

        // Store in memory
        if (userId) {
          try {
            await memoryStore.add(groq, userId, 'user', 'user', message.trim());
            await memoryStore.add(groq, userId, 'nexus', 'assistant', textResponse);
          } catch (memErr) {
            logEvent('error', 'Memory store failed', memErr.message);
          }
        }

        const speech = await synthesizeSpeech(displayText, voicePrefs, TTS_VOICE);
        apiUsage.ttsCalls++;
        apiUsage.llmCalls++;

        res.json({
            text: displayText,
            ...speech,
            model: `${result.provider}/${result.model}`,
            emotion: emotion ? emotion.emotion : null,
            ragUsed: Boolean(ragContext),
            category: result.category,
            fallbacksUsed: result.fallbacksUsed,
            toolCalls: toolCalls.length > 0 ? toolCalls.map(t => ({ type: t.type, action: t.action })) : undefined,
            toolResults: toolResults.length > 0 ? toolResults : undefined,
        });

    } catch (err) {
        console.error('API Error:', err);
        logEvent('error', 'Chat API error', err.message);
        res.status(500).json({ error: err.message || 'Backend request failed' });
    }
});

// ── Code Execution Sandbox ──
app.post('/api/execute', express.raw({ type: '*/*', limit: '64kb' }), async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const sendEvent = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { code, language = 'auto' } = body || {};

    if (!code || !code.trim()) {
      sendEvent('error', { message: 'No code provided' });
      sendEvent('done', { exitCode: 1, duration: 0 });
      res.end();
      return;
    }

    logEvent('code', `Executing ${language}`, `${code.length} chars`);

    await executeCode({
      language,
      code,
      onOutput: (text) => sendEvent('output', { type: 'stdout', text }),
      onError: (text) => sendEvent('output', { type: 'stderr', text }),
      onDone: (result) => {
        sendEvent('done', result);
        res.end();
      },
    });
  } catch (err) {
    sendEvent('error', { message: err.message });
    sendEvent('done', { exitCode: -1, duration: 0 });
    if (!res.writableEnded) res.end();
  }
});

// ── Screen Action Endpoint (before generic /:action to avoid route conflict) ──
app.post('/api/system/screen-action', async (req, res) => {
  try {
    const { action, params } = req.body || {};
    if (!action) return res.status(400).json({ ok: false, error: 'Action required' });

    logEvent('system', `Screen action: ${action}`, JSON.stringify(params));

    const result = await systemCommander.executeTool({
      type: 'system',
      action: action === 'click' ? 'mouse-click' : action === 'type' ? 'type-text' : action === 'scroll' ? 'scroll' : action,
      params: params || {},
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    logEvent('error', 'Screen action failed', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Image Generation API ──
app.post('/api/image/generate', async (req, res) => {
  try {
    const { prompt, width, height, model } = req.body || {};
    if (!prompt || !prompt.trim()) return res.status(400).json({ ok: false, error: 'Prompt is required' });
    logEvent('image', 'Generating image', prompt);
    const result = await imageGen.generateImage({ prompt, width, height, model });
    res.json({ ok: true, ...result });
  } catch (err) {
    logEvent('error', 'Image generation failed', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Translation API ──
app.get('/api/translate/languages', (req, res) => {
  res.json({ ok: true, languages: translationService.SUPPORTED_LANGUAGES });
});

app.post('/api/translate', async (req, res) => {
  try {
    const { text, sourceLang, targetLang } = req.body || {};
    if (!text || !text.trim()) return res.status(400).json({ ok: false, error: 'Text is required' });
    if (!targetLang) return res.status(400).json({ ok: false, error: 'Target language is required' });
    logEvent('translate', `Translating to ${targetLang}`, text.slice(0, 100));
    const result = await translationService.translate({ text, sourceLang, targetLang });
    res.json({ ok: true, ...result });
  } catch (err) {
    logEvent('error', 'Translation failed', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Voice Lab API ──
app.get('/api/tts/voices', async (req, res) => {
  try {
    const voices = await voiceLab.listVoices();
    res.json({ ok: true, voices, count: voices.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/tts/preview', async (req, res) => {
  try {
    const { voice, text } = req.body || {};
    if (!voice) return res.status(400).json({ ok: false, error: 'Voice name is required' });
    logEvent('tts', 'Voice preview', `${voice}: ${(text || '').slice(0, 50)}`);
    const result = await voiceLab.previewVoice(voice, text || 'Hello, this is a voice preview.');
    res.json({ ok: true, ...result });
  } catch (err) {
    logEvent('error', 'Voice preview failed', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Email API ──
app.get('/api/email/config', (req, res) => {
  try {
    const config = emailService.getConfig();
    res.json({ ok: true, config: { smtp: { ...config.smtp, pass: config.smtp.pass ? '****' : '' }, imap: { ...config.imap, pass: config.imap.pass ? '****' : '' }, defaultFrom: config.defaultFrom } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/email/config', (req, res) => {
  try {
    emailService.updateConfig(req.body);
    logEvent('email', 'Email config updated');
    res.json({ ok: true, message: 'Email config updated' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/email/send', async (req, res) => {
  try {
    const { to, subject, text, html, attachments } = req.body || {};
    if (!to || !subject || (!text && !html)) {
      return res.status(400).json({ ok: false, error: 'Missing required fields: to, subject, and text or html' });
    }
    logEvent('email', `Sending email to ${to}: ${subject}`);
    const result = await emailService.sendEmail({ to, subject, text, html, attachments });
    res.json({ ok: true, ...result });
  } catch (err) {
    logEvent('error', 'Email send failed', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/email/read', async (req, res) => {
  try {
    const { folder, limit } = req.body || {};
    logEvent('email', `Reading emails from ${folder || 'INBOX'}`);
    const emails = await emailService.readEmails({ folder, limit });
    res.json({ ok: true, emails, count: emails.length });
  } catch (err) {
    logEvent('error', 'Email read failed', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── System Commander API ──
app.post('/api/system/:action', async (req, res) => {
  try {
    const { action } = req.params;
    const params = req.body || {};
    logEvent('system', `API tool: ${action}`, JSON.stringify(params).slice(0, 200));

    let result;
    switch (action) {
      case 'file-read': result = await systemCommander.readFile(params.path); break;
      case 'file-write': result = await systemCommander.writeFile(params.path, params.content); break;
      case 'file-list': result = await systemCommander.listDir(params.path); break;
      case 'project-create': result = await systemCommander.createProject(params.name, params.structure); break;
      case 'git-status': result = await systemCommander.gitRun('status', params.path); break;
      case 'git-log': result = await systemCommander.gitRun('log', params.path); break;
      case 'git-commit': result = await systemCommander.gitRun('commit', params.path, { message: params.message }); break;
      case 'git-diff': result = await systemCommander.gitRun('diff', params.path); break;
      case 'git-push': result = await systemCommander.gitRun('push', params.path); break;
      case 'git-pull': result = await systemCommander.gitRun('pull', params.path); break;
      case 'git-branch': result = await systemCommander.gitRun('branch', params.path); break;
      case 'browser': result = await systemCommander.browserAction(params.action || 'open', params); break;
      case 'system-info': result = await systemCommander.systemControl('system-info'); break;
      case 'system-volume': result = await systemCommander.systemControl('volume', params); break;
      case 'system-brightness': result = await systemCommander.systemControl('brightness', params); break;
      case 'system-open': result = await systemCommander.systemControl('open-app', params); break;
      case 'system-processes': result = await systemCommander.systemControl('process-list'); break;
      case 'system-kill': result = await systemCommander.systemControl('kill-process', params); break;
      case 'file-search': result = await systemCommander.executeTool({ type: 'system', action: 'search-files', params }); break;
      case 'clipboard-read': result = await systemCommander.executeTool({ type: 'system', action: 'clipboard-read' }); break;
      case 'clipboard-write': result = await systemCommander.executeTool({ type: 'system', action: 'clipboard-write', params }); break;
      case 'clipboard-history': result = await systemCommander.executeTool({ type: 'system', action: 'clipboard-history' }); break;
      case 'read-document': result = await systemCommander.executeTool({ type: 'system', action: 'read-document', params }); break;
      default: return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
    }

    res.json({ ok: true, action, result });
  } catch (err) {
    logEvent('error', `System API error: ${req.params.action}`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Agent Task API (SSE streaming) ──
app.post('/api/task', async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || !message.trim()) return res.status(400).json({ ok: false, error: 'Message required' });

    logEvent('agent', 'Task API', message);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const sendEvent = (event, data) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const result = await agentOrchestrator.processTask(
      message.trim(),
      serverModelPrefs,
      (type, msg) => {
        if (type === 'log') {
          const isStep = msg.match(/Step (\d+)\/(\d+)/);
          if (isStep) sendEvent('step', { current: parseInt(isStep[1]), total: parseInt(isStep[2]), text: msg });
          else sendEvent('log', { text: msg });
        }
      },
    );

    sendEvent('done', result);
    res.end();
  } catch (err) {
    logEvent('error', 'Task API error', err.message);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: err.message });
    res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
    res.end();
  }
});

// ── Screen Analysis Endpoint ──
// ── Screen Analysis Endpoint (file-system aware) ──
const DRIVE_QUERY = /\b([a-zA-Z])\s*drive\b|\b([a-zA-Z]):\\?\b/;

app.post('/api/screen/analyze', async (req, res) => {
  try {
    const { query } = req.body || {};
    const rawQuery = (query || '').trim();
    const userText = rawQuery || 'What is on my screen? Describe it in detail.';

    logEvent('screen', 'Screen analysis requested', userText);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const sendEvent = (event, data) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Check if query is about files/directories (e.g., "D drive me konse files hai")
    const driveMatch = rawQuery.match(DRIVE_QUERY);
    const driveLetter = driveMatch && (driveMatch[1] || driveMatch[2]);

    if (driveLetter) {
      const targetPath = driveLetter.toUpperCase() + ':\\';
      sendEvent('log', { text: `📂 Scanning ${targetPath}...` });

      try {
        const dirResult = await systemCommander.executeTool({
          type: 'file', action: 'list', params: { path: targetPath },
        });
        if (dirResult && dirResult.items) {
          const folders = dirResult.items.filter(i => i.type === 'dir').map(i => i.name);
          const files = dirResult.items.filter(i => i.type === 'file').map(i => `${i.name} (${(i.size / 1024).toFixed(0)} KB)`);
          const text = `**${targetPath}** — ${dirResult.count} items\n\n📁 **Folders:**\n${folders.join('\n') || '(none)'}\n\n📄 **Files:**\n${files.join('\n') || '(none)'}`;
          sendEvent('log', { text: `✅ Found ${dirResult.count} items (${folders.length} folders, ${files.length} files)` });
          sendEvent('result', { text, model: 'system/file', screenshot: null });
          return res.end();
        }
      } catch (err) {
        sendEvent('log', { text: `❌ ${targetPath}: ${err.message}` });
        sendEvent('result', { text: `Could not access ${targetPath}: ${err.message}`, model: 'system/file', screenshot: null });
        return res.end();
      }
    }

    // Default: take screenshot + vision model
    sendEvent('log', { text: '📸 Capturing desktop screenshot...' });

    const ssResult = await systemCommander.executeTool({
      type: 'system', action: 'screenshot', params: {},
    });

    if (!ssResult || !ssResult.screenshot) {
      sendEvent('error', { message: 'Failed to capture screenshot' });
      return res.end();
    }

    sendEvent('log', { text: `🔍 Analyzing screenshot (${(ssResult.size / 1024).toFixed(0)} KB)...` });

    const dataUrl = `data:${ssResult.mimeType || 'image/png'};base64,${ssResult.screenshot}`;
    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }];

    const result = await modelRouter.routeVision(serverModelPrefs, messages, {
      preferredProvider: serverModelPrefs.provider,
      preferredModel: serverModelPrefs.visionModel,
      forVision: true,
    });

    sendEvent('result', {
      text: result.text,
      model: `${result.provider}/${result.model}`,
      screenshot: ssResult.screenshot,
    });
    res.end();
  } catch (err) {
    logEvent('error', 'Screen analysis failed', err.message);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: err.message });
    res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
    res.end();
  }
});

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

// ── Voice Transcription Endpoint ──
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/api/voice/transcribe', upload.single('audio'), async (req, res) => {
  let tmpPath = null;
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No audio file' });
    tmpPath = path.join(os.tmpdir(), `nexus-voice-${Date.now()}.webm`);
    fs.writeFileSync(tmpPath, req.file.buffer);

    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: 'whisper-large-v3-turbo',
      language: 'en',
      response_format: 'text',
    });

    res.json({ ok: true, text: transcription || '' });
  } catch (err) {
    logEvent('error', 'Transcription failed', err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    if (tmpPath) try { fs.unlinkSync(tmpPath); } catch {}
  }
});

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
process.on('unhandledRejection', (reason) => {
  console.error('[CRASH] Unhandled rejection:', reason?.message || reason);
});

const PORT = process.env.PORT || 5060;
server.on('error', (err) => {
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

if (process.stdin && process.stdin.resume) {
    process.stdin.resume();
}

// Some local Windows shells can detach idle Node listeners; keep this assistant
// process foregrounded until the user stops it.
setInterval(() => {}, 1 << 30);
