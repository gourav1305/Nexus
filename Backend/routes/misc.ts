import { Router } from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import multer from 'multer';
import * as imageGen from '../services/imageGen';
import * as translationService from '../services/translationService';
import * as voiceLab from '../services/voiceLab';
import { getGroq, logEvent } from './context';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Image Generation ──
router.post('/image/generate', async (req, res) => {
  try {
    const { prompt, width, height, model } = req.body || {};
    if (!prompt || !prompt.trim()) return res.status(400).json({ ok: false, error: 'Prompt is required' });
    logEvent('image', 'Generating image', prompt);
    const result = await imageGen.generateImage({ prompt, width, height, model });
    res.json({ ok: true, ...result });
  } catch (err: any) {
    logEvent('error', 'Image generation failed', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Translation ──
router.get('/translate/languages', (req, res) => {
  res.json({ ok: true, languages: translationService.SUPPORTED_LANGUAGES });
});

router.post('/translate', async (req, res) => {
  try {
    const { text, sourceLang, targetLang } = req.body || {};
    if (!text || !text.trim()) return res.status(400).json({ ok: false, error: 'Text is required' });
    if (!targetLang) return res.status(400).json({ ok: false, error: 'Target language is required' });
    logEvent('translate', `Translating to ${targetLang}`, text.slice(0, 100));
    const result = await translationService.translate({ text, sourceLang, targetLang });
    res.json({ ok: true, ...result });
  } catch (err: any) {
    logEvent('error', 'Translation failed', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Voice Transcription ──
router.post('/voice/transcribe', upload.single('audio'), async (req, res) => {
  let tmpPath: string | null = null;
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No audio file' });
    tmpPath = path.join(os.tmpdir(), `nexus-voice-${Date.now()}.webm`);
    fs.writeFileSync(tmpPath, req.file.buffer);
    const transcription = await getGroq().audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: 'whisper-large-v3-turbo',
      language: 'en',
      response_format: 'text',
    });
    res.json({ ok: true, text: transcription || '' });
  } catch (err: any) {
    logEvent('error', 'Transcription failed', err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    if (tmpPath) try { fs.unlinkSync(tmpPath); } catch {}
  }
});

export default router;
