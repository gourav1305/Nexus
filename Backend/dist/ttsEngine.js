"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.synthesizeSpeech = void 0;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const voiceCatalog_1 = require("./voiceCatalog");
const escapeForPowerShell = (value) => String(value)
    .replace(/`/g, '``')
    .replace(/'/g, "''")
    .replace(/\$/g, '`$');
const runPowerShell = (script) => new Promise((resolve, reject) => {
    const child = (0, child_process_1.spawn)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
        if (code === 0)
            resolve();
        else
            reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
    });
});
const synthesizeEdgeTts = async (text, resolved) => {
    const { tts } = await Promise.resolve().then(() => __importStar(require('./node_modules/edge-tts/out/index.js')));
    return tts(text, {
        voice: resolved.voice,
        rate: resolved.rate,
        pitch: '+0Hz',
    });
};
const synthesizeWindowsSapi = async (text, resolved) => {
    if (process.platform !== 'win32') {
        throw new Error('Windows SAPI is only available on Windows');
    }
    const wavPath = path.join(os.tmpdir(), `nexus-tts-${Date.now()}.wav`);
    const gender = resolved.gender === 'male' ? 'Male' : 'Female';
    const cleanText = escapeForPowerShell(text);
    const safePath = escapeForPowerShell(wavPath);
    const script = `
Add-Type -AssemblyName System.Speech;
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
$installed = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo };
$preferred = $installed | Where-Object { $_.Gender -eq [System.Speech.Synthesis.VoiceGender]::${gender} } | Select-Object -First 1;
if ($preferred) { $synth.SelectVoice($preferred.Name); }
$synth.Rate = 0;
$synth.SetOutputToWaveFile('${safePath}');
$synth.Speak('${cleanText}');
$synth.Dispose();
`;
    await runPowerShell(script);
    try {
        const audioBuffer = fs.readFileSync(wavPath);
        return audioBuffer;
    }
    finally {
        try {
            fs.unlinkSync(wavPath);
        }
        catch {
            // ignore cleanup errors
        }
    }
};
const synthesizeSpeech = async (text, voicePrefs = {}, fallbackVoice) => {
    const cleanText = text
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/[*_~`#>\[\]()]/g, '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
    const resolved = (0, voiceCatalog_1.resolveVoicePrefs)(voicePrefs, fallbackVoice);
    let audioBuffer = null;
    let ttsError = null;
    let engine = null;
    let audioMimeType = 'audio/mpeg';
    try {
        audioBuffer = await synthesizeEdgeTts(cleanText, resolved);
        engine = 'edge-tts';
    }
    catch (edgeError) {
        ttsError = edgeError.message || 'edge-tts failed';
        console.warn('edge-tts failed, trying Windows SAPI:', ttsError);
        try {
            audioBuffer = await synthesizeWindowsSapi(cleanText, resolved);
            engine = 'windows-sapi';
            audioMimeType = 'audio/wav';
            ttsError = null;
        }
        catch (sapiError) {
            ttsError = sapiError.message || ttsError;
            console.warn('Windows SAPI failed:', ttsError);
        }
    }
    return {
        audioBase64: audioBuffer ? audioBuffer.toString('base64') : null,
        audioMimeType,
        ttsError,
        engine,
        voice: resolved.voice,
        rate: resolved.rate,
        voiceMode: resolved.voiceMode,
        speakingRate: resolved.speakingRate,
        language: resolved.language,
        gender: resolved.gender,
    };
};
exports.synthesizeSpeech = synthesizeSpeech;
