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
exports.listVoices = listVoices;
exports.previewVoice = previewVoice;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
// ── Cached voice list ──
let cachedVoices = null;
async function listVoices() {
    if (cachedVoices)
        return cachedVoices;
    return new Promise((resolve, reject) => {
        const chunks = [];
        const child = (0, child_process_1.spawn)('edge-tts', ['--list-voices'], { shell: true });
        child.stdout.on('data', (chunk) => chunks.push(chunk));
        child.stderr.on('data', (chunk) => chunks.push(chunk));
        child.on('close', (code) => {
            const output = Buffer.concat(chunks).toString();
            // Parse the table output
            const lines = output.split('\n').filter(l => l.trim());
            const voices = [];
            let headerPassed = false;
            for (const line of lines) {
                if (line.includes('---')) {
                    headerPassed = true;
                    continue;
                }
                if (!headerPassed)
                    continue;
                const parts = line.trim().split(/\s{2,}/);
                if (parts.length >= 2) {
                    const name = parts[0].trim();
                    const locale = parts.length >= 3 ? parts[parts.length - 2].trim() : '';
                    const gender = parts.length >= 4 ? parts[parts.length - 1].trim() : '';
                    voices.push({ name, locale, gender, lang: locale.split('-')[0] || '' });
                }
            }
            // Fallback if parsing failed — provide core voices
            if (voices.length === 0) {
                cachedVoices = getDefaultVoices();
            }
            else {
                cachedVoices = voices;
            }
            resolve(cachedVoices);
        });
        child.on('error', () => {
            cachedVoices = getDefaultVoices();
            resolve(cachedVoices);
        });
    });
}
function getDefaultVoices() {
    return [
        { name: 'en-IN-NeerjaNeural', locale: 'en-IN', gender: 'Female', lang: 'en' },
        { name: 'en-IN-PrabhatNeural', locale: 'en-IN', gender: 'Male', lang: 'en' },
        { name: 'hi-IN-SwaraNeural', locale: 'hi-IN', gender: 'Female', lang: 'hi' },
        { name: 'hi-IN-MadhurNeural', locale: 'hi-IN', gender: 'Male', lang: 'hi' },
        { name: 'en-US-JennyNeural', locale: 'en-US', gender: 'Female', lang: 'en' },
        { name: 'en-US-GuyNeural', locale: 'en-US', gender: 'Male', lang: 'en' },
        { name: 'en-GB-SoniaNeural', locale: 'en-GB', gender: 'Female', lang: 'en' },
        { name: 'en-GB-RyanNeural', locale: 'en-GB', gender: 'Male', lang: 'en' },
        { name: 'mr-IN-AarohiNeural', locale: 'mr-IN', gender: 'Female', lang: 'mr' },
        { name: 'mr-IN-ManoharNeural', locale: 'mr-IN', gender: 'Male', lang: 'mr' },
        { name: 'gu-IN-DhwaniNeural', locale: 'gu-IN', gender: 'Female', lang: 'gu' },
        { name: 'gu-IN-NiranjanNeural', locale: 'gu-IN', gender: 'Male', lang: 'gu' },
        { name: 'bn-IN-BashkarNeural', locale: 'bn-IN', gender: 'Male', lang: 'bn' },
        { name: 'bn-IN-TanishaaNeural', locale: 'bn-IN', gender: 'Female', lang: 'bn' },
        { name: 'ta-IN-PallaviNeural', locale: 'ta-IN', gender: 'Female', lang: 'ta' },
        { name: 'ta-IN-ValluvarNeural', locale: 'ta-IN', gender: 'Male', lang: 'ta' },
        { name: 'te-IN-MohanNeural', locale: 'te-IN', gender: 'Male', lang: 'te' },
        { name: 'te-IN-ShrutiNeural', locale: 'te-IN', gender: 'Female', lang: 'te' },
        { name: 'kn-IN-GaganNeural', locale: 'kn-IN', gender: 'Male', lang: 'kn' },
        { name: 'kn-IN-SapnaNeural', locale: 'kn-IN', gender: 'Female', lang: 'kn' },
        { name: 'ml-IN-MidhunNeural', locale: 'ml-IN', gender: 'Male', lang: 'ml' },
        { name: 'ml-IN-SobhanaNeural', locale: 'ml-IN', gender: 'Female', lang: 'ml' },
        { name: 'pa-IN-GurnekNeural', locale: 'pa-IN', gender: 'Male', lang: 'pa' },
        { name: 'pa-IN-GurpreetNeural', locale: 'pa-IN', gender: 'Female', lang: 'pa' },
        { name: 'ur-IN-KashifNeural', locale: 'ur-IN', gender: 'Male', lang: 'ur' },
        { name: 'ur-IN-SalmanNeural', locale: 'ur-IN', gender: 'Male', lang: 'ur' },
        { name: 'ru-RU-DariyaNeural', locale: 'ru-RU', gender: 'Female', lang: 'ru' },
        { name: 'ru-RU-DmitryNeural', locale: 'ru-RU', gender: 'Male', lang: 'ru' },
        { name: 'fr-FR-DeniseNeural', locale: 'fr-FR', gender: 'Female', lang: 'fr' },
        { name: 'fr-FR-HenriNeural', locale: 'fr-FR', gender: 'Male', lang: 'fr' },
        { name: 'es-ES-AlvaroNeural', locale: 'es-ES', gender: 'Male', lang: 'es' },
        { name: 'es-ES-ElviraNeural', locale: 'es-ES', gender: 'Female', lang: 'es' },
        { name: 'de-DE-KatjaNeural', locale: 'de-DE', gender: 'Female', lang: 'de' },
        { name: 'de-DE-ConradNeural', locale: 'de-DE', gender: 'Male', lang: 'de' },
        { name: 'ja-JP-NanamiNeural', locale: 'ja-JP', gender: 'Female', lang: 'ja' },
        { name: 'ja-JP-KeitaNeural', locale: 'ja-JP', gender: 'Male', lang: 'ja' },
        { name: 'zh-CN-XiaoxiaoNeural', locale: 'zh-CN', gender: 'Female', lang: 'zh' },
        { name: 'zh-CN-YunxiNeural', locale: 'zh-CN', gender: 'Male', lang: 'zh' },
        { name: 'ar-SA-ZariyahNeural', locale: 'ar-SA', gender: 'Female', lang: 'ar' },
        { name: 'ar-SA-HamedNeural', locale: 'ar-SA', gender: 'Male', lang: 'ar' },
    ];
}
async function previewVoice(voiceName, text = 'Hello, this is a voice preview.') {
    const ttsPath = path.join(os.tmpdir(), `nexus_voice_preview_${Date.now()}.mp3`);
    return new Promise((resolve, reject) => {
        const child = (0, child_process_1.spawn)('edge-tts', [
            '--voice', voiceName,
            '--text', text,
            '--write-media', ttsPath,
        ], { shell: true });
        let stderr = '';
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('close', (code) => {
            if (code !== 0 || !fs.existsSync(ttsPath)) {
                reject(new Error(stderr || `Voice preview failed (exit code ${code})`));
                return;
            }
            const buffer = fs.readFileSync(ttsPath);
            fs.unlinkSync(ttsPath);
            resolve({
                voice: voiceName,
                audioBase64: buffer.toString('base64'),
                audioMimeType: 'audio/mpeg',
                size: buffer.length,
            });
        });
        child.on('error', reject);
    });
}
