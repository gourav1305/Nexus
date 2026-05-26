const VOICE_MODES = [
    {
        id: 'female',
        label: 'Female Voice',
        description: 'Warm female voice (India English)',
        voice: 'en-IN-NeerjaNeural',
        language: 'en-IN',
        gender: 'female',
        locale: 'india',
    },
    {
        id: 'male',
        label: 'Male Voice',
        description: 'Clear male voice (India English)',
        voice: 'en-IN-PrabhatNeural',
        language: 'en-IN',
        gender: 'male',
        locale: 'india',
    },
    {
        id: 'hindi',
        label: 'Hindi Voice',
        description: 'Natural Hindi female voice',
        voice: 'hi-IN-SwaraNeural',
        language: 'hi-IN',
        gender: 'female',
        locale: 'hindi',
    },
    {
        id: 'hindi-male',
        label: 'Hindi Male',
        description: 'Natural Hindi male voice',
        voice: 'hi-IN-MadhurNeural',
        language: 'hi-IN',
        gender: 'male',
        locale: 'hindi',
    },
    {
        id: 'english',
        label: 'English Voice',
        description: 'US English female voice',
        voice: 'en-US-JennyNeural',
        language: 'en-US',
        gender: 'female',
        locale: 'english',
    },
    {
        id: 'english-male',
        label: 'English Male',
        description: 'US English male voice',
        voice: 'en-US-GuyNeural',
        language: 'en-US',
        gender: 'male',
        locale: 'english',
    },
];

const SPEAKING_RATES = [
    { id: 'slow', label: 'Slow', rate: '-25%', utteranceRate: 0.82 },
    { id: 'normal', label: 'Normal', rate: '+0%', utteranceRate: 0.96 },
    { id: 'fast', label: 'Fast', rate: '+25%', utteranceRate: 1.12 },
];

const ALLOWED_VOICES = new Set(VOICE_MODES.map((mode) => mode.voice));
const MODE_BY_ID = Object.fromEntries(VOICE_MODES.map((mode) => [mode.id, mode]));
const MODE_BY_VOICE = Object.fromEntries(VOICE_MODES.map((mode) => [mode.voice, mode]));
const RATE_BY_ID = Object.fromEntries(SPEAKING_RATES.map((rate) => [rate.id, rate]));

const DEFAULT_VOICE_MODE = 'female';
const DEFAULT_SPEAKING_RATE = 'normal';

const inferVoiceMode = (voiceId) => MODE_BY_VOICE[voiceId]?.id || DEFAULT_VOICE_MODE;

const resolveSpeakingRate = (speakingRate) => RATE_BY_ID[speakingRate] || RATE_BY_ID[DEFAULT_SPEAKING_RATE];

const resolveVoicePrefs = (input = {}, fallbackVoice = process.env.TTS_VOICE || 'en-IN-NeerjaNeural') => {
    const voiceModeId = typeof input.voiceMode === 'string' ? input.voiceMode : null;
    const modeFromId = voiceModeId ? MODE_BY_ID[voiceModeId] : null;

    let mode = modeFromId;
    if (!mode && typeof input.voice === 'string' && ALLOWED_VOICES.has(input.voice)) {
        mode = MODE_BY_VOICE[input.voice];
    }
    if (!mode && typeof fallbackVoice === 'string' && ALLOWED_VOICES.has(fallbackVoice)) {
        mode = MODE_BY_VOICE[fallbackVoice];
    }
    if (!mode) {
        mode = MODE_BY_ID[inferVoiceMode(fallbackVoice)] || MODE_BY_ID[DEFAULT_VOICE_MODE];
    }

    const ratePreset = resolveSpeakingRate(input.speakingRate);
    const language = typeof input.language === 'string' && input.language.trim()
        ? input.language.trim()
        : mode.language;

    return {
        voiceMode: mode.id,
        speakingRate: ratePreset.id,
        voice: mode.voice,
        language,
        rate: ratePreset.rate,
        utteranceRate: ratePreset.utteranceRate,
        label: mode.label,
        gender: mode.gender,
        locale: mode.locale,
    };
};

module.exports = {
    VOICE_MODES,
    SPEAKING_RATES,
    ALLOWED_VOICES,
    DEFAULT_VOICE_MODE,
    DEFAULT_SPEAKING_RATE,
    inferVoiceMode,
    resolveVoicePrefs,
};
