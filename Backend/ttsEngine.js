const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { resolveVoicePrefs } = require('./voiceCatalog');

const escapeForPowerShell = (value) => String(value)
    .replace(/`/g, '``')
    .replace(/'/g, "''")
    .replace(/\$/g, '`$');

const runPowerShell = (script) => new Promise((resolve, reject) => {
    const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { windowsHide: true },
    );

    let stderr = '';
    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
    });
});

const synthesizeEdgeTts = async (text, resolved) => {
    const { tts } = await import('./node_modules/edge-tts/out/index.js');
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
    } finally {
        try {
            fs.unlinkSync(wavPath);
        } catch {
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

    const resolved = resolveVoicePrefs(voicePrefs, fallbackVoice);
    let audioBuffer = null;
    let ttsError = null;
    let engine = null;
    let audioMimeType = 'audio/mpeg';

    try {
        audioBuffer = await synthesizeEdgeTts(cleanText, resolved);
        engine = 'edge-tts';
    } catch (edgeError) {
        ttsError = edgeError.message || 'edge-tts failed';
        console.warn('edge-tts failed, trying Windows SAPI:', ttsError);

        try {
            audioBuffer = await synthesizeWindowsSapi(cleanText, resolved);
            engine = 'windows-sapi';
            audioMimeType = 'audio/wav';
            ttsError = null;
        } catch (sapiError) {
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

module.exports = { synthesizeSpeech };
