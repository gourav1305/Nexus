import {
  DEFAULT_SPEAKING_RATE,
  DEFAULT_VOICE_MODE,
  SPEAKING_RATES,
  VOICE_MODES,
  inferVoiceMode,
  resolveVoicePrefs,
} from './voiceCatalog';

const STORAGE_KEY = 'nexus_settings';

export const DEFAULT_BLOB_CONFIG = {
  color: '#aa3bff',
  size: 0.5,
  sensitivity: 2.2,
  position: { x: 0, y: 0 },
  bloomIntensity: 2.5,
  afterimageDamp: 0.92,
  rotationSpeed: 1.0,
};

export const DEFAULT_UI_CONFIG = {
  particlesEnabled: true,
  scanlinesEnabled: true,
  audioFeedbackEnabled: true,
};

export const DEFAULT_ASSISTANT_SETTINGS = {
  language: 'en-IN',
  voiceMode: DEFAULT_VOICE_MODE,
  ttsVoice: 'en-IN-NeerjaNeural',
  speakingRate: DEFAULT_SPEAKING_RATE,
};

export { VOICE_MODES, SPEAKING_RATES, resolveVoicePrefs };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const parsePosition = (position) => {
  if (!position || typeof position !== 'object') {
    return { ...DEFAULT_BLOB_CONFIG.position };
  }
  return {
    x: Number.isFinite(Number(position.x)) ? Number(position.x) : 0,
    y: Number.isFinite(Number(position.y)) ? Number(position.y) : 0,
  };
};

const normalizeAssistant = (assistant = {}) => {
  const voiceMode = VOICE_MODES.some((m) => m.id === assistant.voiceMode)
    ? assistant.voiceMode
    : inferVoiceMode(assistant.ttsVoice);

  const speakingRate = SPEAKING_RATES.some((r) => r.id === assistant.speakingRate)
    ? assistant.speakingRate
    : DEFAULT_SPEAKING_RATE;

  const resolved = resolveVoicePrefs({
    voiceMode,
    speakingRate,
    ttsVoice: assistant.ttsVoice,
    language: assistant.language,
  });

  return {
    language: resolved.language,
    voiceMode: resolved.voiceMode,
    ttsVoice: resolved.ttsVoice,
    speakingRate: resolved.speakingRate,
  };
};

export const loadBlobConfig = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BLOB_CONFIG, isDraggable: false };

    const parsed = JSON.parse(raw);
    const blob = parsed?.blob || {};

    return {
      color: typeof blob.color === 'string' ? blob.color : DEFAULT_BLOB_CONFIG.color,
      size: clamp(Number(blob.size) || DEFAULT_BLOB_CONFIG.size, 0.5, 3),
      sensitivity: clamp(Number(blob.sensitivity) || DEFAULT_BLOB_CONFIG.sensitivity, 0.5, 5),
      position: parsePosition(blob.position),
      isDraggable: false,
      bloomIntensity: clamp(Number(blob.bloomIntensity) ?? DEFAULT_BLOB_CONFIG.bloomIntensity, 0, 5),
      afterimageDamp: clamp(Number(blob.afterimageDamp) ?? DEFAULT_BLOB_CONFIG.afterimageDamp, 0, 1),
      rotationSpeed: clamp(Number(blob.rotationSpeed) ?? DEFAULT_BLOB_CONFIG.rotationSpeed, 0, 3),
    };
  } catch (e) {
    console.warn('Failed to load blob settings:', e);
    return { ...DEFAULT_BLOB_CONFIG, isDraggable: false };
  }
};

export const loadUiConfig = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_UI_CONFIG };

    const parsed = JSON.parse(raw);
    const ui = parsed?.ui || {};
    return {
      particlesEnabled: ui.particlesEnabled !== false,
      scanlinesEnabled: ui.scanlinesEnabled !== false,
      audioFeedbackEnabled: ui.audioFeedbackEnabled !== false,
    };
  } catch (e) {
    console.warn('Failed to load UI settings:', e);
    return { ...DEFAULT_UI_CONFIG };
  }
};

export const loadAssistantSettings = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ASSISTANT_SETTINGS };

    const parsed = JSON.parse(raw);
    return normalizeAssistant(parsed?.assistant || {});
  } catch (e) {
    console.warn('Failed to load assistant settings:', e);
    return { ...DEFAULT_ASSISTANT_SETTINGS };
  }
};

const readStored = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const writeStored = (next) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    console.warn('Failed to save settings:', e);
  }
};

export const saveBlobConfig = (blobConfig) => {
  const stored = readStored();
  writeStored({
    ...stored,
    blob: {
      color: blobConfig.color,
      size: blobConfig.size,
      sensitivity: blobConfig.sensitivity,
      position: parsePosition(blobConfig.position),
      bloomIntensity: blobConfig.bloomIntensity,
      afterimageDamp: blobConfig.afterimageDamp,
      rotationSpeed: blobConfig.rotationSpeed,
    },
  });
};

export const saveUiConfig = (uiConfig) => {
  const stored = readStored();
  writeStored({
    ...stored,
    ui: {
      particlesEnabled: uiConfig.particlesEnabled,
      scanlinesEnabled: uiConfig.scanlinesEnabled,
      audioFeedbackEnabled: uiConfig.audioFeedbackEnabled,
    },
  });
};

export const saveAssistantSettings = (assistantSettings) => {
  const stored = readStored();
  const normalized = normalizeAssistant(assistantSettings);
  writeStored({
    ...stored,
    assistant: normalized,
  });
  return normalized;
};

export const resetAllSettings = () => {
  localStorage.removeItem(STORAGE_KEY);
  return {
    blob: { ...DEFAULT_BLOB_CONFIG, isDraggable: false },
    ui: { ...DEFAULT_UI_CONFIG },
    assistant: { ...DEFAULT_ASSISTANT_SETTINGS },
  };
};
