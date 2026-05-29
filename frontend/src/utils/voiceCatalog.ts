// @ts-nocheck
export const VOICE_MODES = [
  {
    id: 'female',
    label: 'Female Voice',
    voice: 'en-IN-NeerjaNeural',
    language: 'en-IN',
    gender: 'female',
  },
  {
    id: 'male',
    label: 'Male Voice',
    voice: 'en-IN-PrabhatNeural',
    language: 'en-IN',
    gender: 'male',
  },
  {
    id: 'hindi',
    label: 'Hindi Voice',
    voice: 'hi-IN-SwaraNeural',
    language: 'hi-IN',
    gender: 'female',
  },
  {
    id: 'hindi-male',
    label: 'Hindi Male',
    voice: 'hi-IN-MadhurNeural',
    language: 'hi-IN',
    gender: 'male',
  },
  {
    id: 'english',
    label: 'English Voice',
    voice: 'en-US-JennyNeural',
    language: 'en-US',
    gender: 'female',
  },
  {
    id: 'english-male',
    label: 'English Male',
    voice: 'en-US-GuyNeural',
    language: 'en-US',
    gender: 'male',
  },
];

export const SPEAKING_RATES = [
  { id: 'slow', label: 'Slow', rate: '-25%', utteranceRate: 0.82 },
  { id: 'normal', label: 'Normal', rate: '+0%', utteranceRate: 0.96 },
  { id: 'fast', label: 'Fast', rate: '+25%', utteranceRate: 1.12 },
];

const MODE_BY_ID = Object.fromEntries(VOICE_MODES.map((m) => [m.id, m]));
const MODE_BY_VOICE = Object.fromEntries(VOICE_MODES.map((m) => [m.voice, m]));
const RATE_BY_ID = Object.fromEntries(SPEAKING_RATES.map((r) => [r.id, r]));

export const DEFAULT_VOICE_MODE = 'female';
export const DEFAULT_SPEAKING_RATE = 'normal';

export const inferVoiceMode = (voiceId) => MODE_BY_VOICE[voiceId]?.id || DEFAULT_VOICE_MODE;

const FEMALE_NAME_RE = /neerja|swara|jenny|zira|samantha|heera|aria|emma|sonia|natasha|linda|lisa|michelle|female|woman|girl/i;
const MALE_NAME_RE = /prabhat|madhur|guy|ravi|david|mark|james|george|male|man|ryan|brian|hamza/i;

export const resolveVoicePrefs = (settings = {}) => {
  const mode = MODE_BY_ID[settings.voiceMode] || MODE_BY_VOICE[settings.ttsVoice] || MODE_BY_ID[DEFAULT_VOICE_MODE];
  const rate = RATE_BY_ID[settings.speakingRate] || RATE_BY_ID[DEFAULT_SPEAKING_RATE];

  return {
    voiceMode: mode.id,
    speakingRate: rate.id,
    voice: mode.voice,
    ttsVoice: mode.voice,
    language: settings.language || mode.language,
    gender: mode.gender,
    rate: rate.rate,
    utteranceRate: rate.utteranceRate,
    label: mode.label,
  };
};

/** Pick a browser speechSynthesis voice that matches gender + language. */
export const pickBrowserVoice = (voices, prefs) => {
  if (!voices?.length || !prefs) return null;

  const { language, gender, voice } = prefs;
  const langPrefix = (language || 'en-IN').split('-').slice(0, 2).join('-');
  const langPool = voices.filter(
    (v) => v.lang === language || v.lang.replace('_', '-').startsWith(langPrefix),
  );
  const pool = langPool.length ? langPool : voices;

  const voiceKey = (voice || '').split('-')[2]?.replace('Neural', '') || '';
  if (voiceKey) {
    const exact = pool.find((v) => v.name.toLowerCase().includes(voiceKey.toLowerCase()));
    if (exact) return exact;
  }

  const wantFemale = gender !== 'male';
  if (wantFemale) {
    return (
      pool.find((v) => FEMALE_NAME_RE.test(v.name))
      || pool.find((v) => !MALE_NAME_RE.test(v.name))
      || pool[0]
    );
  }

  return (
    pool.find((v) => MALE_NAME_RE.test(v.name))
    || pool.find((v) => !FEMALE_NAME_RE.test(v.name))
    || pool[0]
  );
};

export const getBrowserUtterancePitch = (gender) => (gender === 'male' ? 0.9 : 1.1);

export const applyVoiceMode = (settings, voiceModeId) => {
  const mode = MODE_BY_ID[voiceModeId] || MODE_BY_ID[DEFAULT_VOICE_MODE];
  return {
    ...settings,
    voiceMode: mode.id,
    ttsVoice: mode.voice,
    language: mode.language,
  };
};
