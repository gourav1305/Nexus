const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const os = require('os');
const { spawn } = require('child_process');

const app = express();
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

const {
    VOICE_MODES,
    SPEAKING_RATES,
    DEFAULT_VOICE_MODE,
    DEFAULT_SPEAKING_RATE,
    resolveVoicePrefs,
} = require('./voiceCatalog');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const VISION_MODEL = process.env.VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
const TTS_VOICE = process.env.TTS_VOICE || 'en-IN-NeerjaNeural';

let serverVoiceSettings = resolveVoicePrefs({
    voiceMode: DEFAULT_VOICE_MODE,
    speakingRate: DEFAULT_SPEAKING_RATE,
    voice: TTS_VOICE,
});

// ── Monitoring & Usage Tracking ──
let pendingSystemAction = null;
const COMMAND_TIMEOUT = 30000;

const apiUsage = {
    groqCalls: 0,
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

const launchProcess = (command, args = [], options = {}) => new Promise((resolve, reject) => {
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
    const settle = (callback, value) => {
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

const openApp = async (appName, options = {}) => {
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

    if (/\b(restart|reboot)\b/.test(text)) {
        return {
            name: 'system_restart_init',
            reply: 'NEXUS command locked: Are you sure you want to restart the computer? Please say "Confirm Restart" to proceed.',
            requiresConfirmation: true,
            confirmKeyword: 'restart',
            run: () => runPowerShell('shutdown /r /t 10 /f'),
        };
    }

    return null;
};


const { synthesizeSpeech } = require('./ttsEngine');
const { detectInfoQuery, handleInfoQuery, getInfoApiStatus } = require('./services/infoServices');
const { createRecipeEngine } = require('./recipeEngine');
const { router: authRouter, authMiddleware } = require('./auth');

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

app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        model: GROQ_MODEL,
        voice: serverVoiceSettings.voice,
        voiceMode: serverVoiceSettings.voiceMode,
        speakingRate: serverVoiceSettings.speakingRate,
        groqKeyConfigured: Boolean(process.env.GROQ_API_KEY),
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
app.post('/api/chat/vision', async (req, res) => {
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

        apiUsage.groqCalls++;
        logEvent('llm', 'Groq vision call', userText);

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: userText },
                        { type: 'image_url', image_url: { url: dataUrl } },
                    ],
                },
            ],
            model: VISION_MODEL,
            temperature: 0.7,
        });

        const textResponse = chatCompletion.choices?.[0]?.message?.content?.trim();
        if (!textResponse) {
            logEvent('error', 'Vision LLM empty response');
            return res.status(502).json({ error: 'Vision model returned an empty response' });
        }

        const speech = await synthesizeSpeech(textResponse, voicePrefs, TTS_VOICE);
        apiUsage.ttsCalls++;

        res.json({
            text: textResponse,
            ...speech,
            model: VISION_MODEL,
            vision: true,
        });

    } catch (err) {
        console.error('Vision API Error:', err);
        logEvent('error', 'Vision API error', err.message);
        res.status(500).json({ error: err.message || 'Vision analysis failed' });
    }
});

app.post('/api/chat', async (req, res) => {
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
                return res.json({
                    text: infoReply,
                    ...speech,
                    model: 'nexus-info',
                    toolUsed: infoQuery.type,
                });
            } catch (infoError) {
                console.error('[NEXUS Info] Failed:', infoQuery.type, infoError.message);
                const failReply = `Sorry, ${infoQuery.type} data fetch nahi ho paya: ${infoError.message}`;
                const speech = await synthesizeSpeech(failReply, voicePrefs, TTS_VOICE);
                apiUsage.ttsCalls++;
                logEvent('error', `Info query failed: ${infoQuery.type}`, infoError.message);
                return res.status(502).json({
                    text: failReply,
                    ...speech,
                    model: 'nexus-info',
                    toolUsed: infoQuery.type,
                    error: infoError.message,
                });
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


        if (!process.env.GROQ_API_KEY) {
            return res.status(500).json({ error: 'GROQ_API_KEY is missing in Backend/.env' });
        }

        apiUsage.groqCalls++;
        logEvent('llm', 'Groq LLM call', message);
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: 'You are NEXUS, a concise voice assistant. Reply naturally in the same language or Hinglish style as the user. Keep responses voice-friendly and avoid markdown unless absolutely needed.',
                },
                { role: 'user', content: message.trim() },
            ],
            model: GROQ_MODEL,
            temperature: 0.7,
        });

        const textResponse = chatCompletion.choices?.[0]?.message?.content?.trim();
        if (!textResponse) {
            logEvent('error', 'LLM empty response', message);
            return res.status(502).json({ error: 'LLM returned an empty response' });
        }

        const speech = await synthesizeSpeech(textResponse, voicePrefs, TTS_VOICE);
        apiUsage.ttsCalls++;

        res.json({
            text: textResponse,
            ...speech,
            model: GROQ_MODEL,
        });

    } catch (err) {
        console.error('API Error:', err);
        logEvent('error', 'Chat API error', err.message);
        res.status(500).json({ error: err.message || 'Backend request failed' });
    }
});

// ── Production: serve built frontend ──
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
if (require('fs').existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      res.sendFile(path.join(frontendDist, 'index.html'));
    } else { next(); }
  });
}

const PORT = process.env.PORT || 5060;
const server = app.listen(PORT, () => {
    console.log(`JARVIS backend running on http://localhost:${PORT}`);
    console.log(`Groq model: ${GROQ_MODEL}`);
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
