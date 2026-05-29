import { Router } from 'express';
import { VOICE_MODES, SPEAKING_RATES, DEFAULT_VOICE_MODE, DEFAULT_SPEAKING_RATE, resolveVoicePrefs } from '../voiceCatalog';
import { getInfoApiStatus } from '../services/infoServices';
import * as voiceLab from '../services/voiceLab';
import modelRouter = require('../services/modelRouter');
import {
  serverModelPrefs, updateServerModelPrefs, serverVoiceSettings, updateServerVoiceSettings, TTS_VOICE, userHome, logEvent,
} from './context';

const router = Router();

// ── Voices List ──
router.get('/voices', (req, res) => {
  res.json({
    ok: true, modes: VOICE_MODES, rates: SPEAKING_RATES,
    default: { voiceMode: DEFAULT_VOICE_MODE, speakingRate: DEFAULT_SPEAKING_RATE, voice: serverVoiceSettings.voice },
    active: serverVoiceSettings,
  });
});

// ── Voice Settings ──
router.get('/settings/voice', (req, res) => { res.json({ ok: true, settings: serverVoiceSettings }); });

router.post('/settings/voice', (req, res) => {
  try {
    const settings = updateServerVoiceSettings(req.body || {});
    res.json({ ok: true, settings });
  } catch (error: any) { res.status(400).json({ ok: false, error: error.message || 'Invalid voice settings' }); }
});

// ── Model Info ──
router.get('/models', async (req, res) => {
  try {
    const info = modelRouter.detectProviders();
    const ollama = await modelRouter.checkOllama();
    if (ollama.available && !info.providers.includes('ollama')) {
      info.providers.push('ollama');
      info.models.ollama = ollama.models;
    }
    res.json({ ok: true, ...info, ollama, active: serverModelPrefs });
  } catch (err: any) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/settings/models', (req, res) => { res.json({ ok: true, settings: serverModelPrefs }); });

router.post('/settings/models', (req, res) => {
  try {
    updateServerModelPrefs(req.body || {});
    res.json({ ok: true, settings: serverModelPrefs });
  } catch (error: any) { res.status(400).json({ ok: false, error: error.message }); }
});

// ── Health ──
router.get('/health', (req, res) => {
  res.json({
    ok: true, model: serverModelPrefs.model, modelProvider: serverModelPrefs.provider,
    visionModel: serverModelPrefs.visionModel, autoRoute: serverModelPrefs.autoRoute,
    voice: serverVoiceSettings.voice, voiceMode: serverVoiceSettings.voiceMode,
    speakingRate: serverVoiceSettings.speakingRate,
    groqKeyConfigured: Boolean(process.env.GROQ_API_KEY),
    openaiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
    anthropicKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    systemTools: true, platform: process.platform, home: userHome,
  });
});

// ── Info Status ──
router.get('/info/status', (req, res) => { res.json({ ok: true, apis: getInfoApiStatus() }); });

// ── Tools ──
router.get('/tools', (req, res) => {
  res.json({
    ok: true, platform: process.platform, home: userHome,
    commands: [
      'open notepad', 'open calculator', 'open youtube', 'youtube par arijit singh search karo',
      'open google', 'open file explorer', 'open downloads folder', 'open documents folder',
      'open this pc', 'aaj delhi ka weather kya hai', 'mumbai ka mausam batao',
      'latest tech news batao', 'latest sports news', 'virat kohli ke baare me batao',
      'wikipedia par taj mahal', 'search latest ai news', 'google artificial intelligence',
    ],
    infoApis: getInfoApiStatus(),
    launcher: 'powershell Start-Process with explorer/rundll32 fallback',
  });
});

// ── TTS Voices ──
router.get('/tts/voices', async (req, res) => {
  try { res.json({ ok: true, voices: await voiceLab.listVoices() }); }
  catch (err: any) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/tts/preview', async (req, res) => {
  try {
    const { voice, text } = req.body || {};
    const previewUrl = await voiceLab.previewVoice(voice, text || 'Hello, this is a voice preview.');
    logEvent('tts', 'Voice preview', `${voice}: ${text}`);
    res.json({ ok: true, previewUrl });
  } catch (err: any) { res.status(500).json({ ok: false, error: err.message }); }
});

export default router;
