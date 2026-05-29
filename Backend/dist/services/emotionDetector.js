"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SYSTEM_PROMPT = exports.EMOTION_PATTERNS = void 0;
exports.detectEmotion = detectEmotion;
exports.buildSystemPrompt = buildSystemPrompt;
const EMOTION_PATTERNS = {
    angry: {
        weight: 1.5,
        keywords: [
            'frustrated', 'angry', 'annoyed', 'furious', 'mad', 'rage',
            'irritated', 'fed up', 'sick of', 'damn', 'hate', 'stupid',
            'useless', 'worst', 'terrible', 'horrible', 'awful',
            'band karo', 'chup karo', 'pagal', 'baka', 'saala',
            'ghatiya', 'bakwas', 'bewakoof', 'frustrate',
        ],
        systemPrompt: 'The user seems frustrated or angry. Respond calmly, patiently, and apologetically. Keep responses short, helpful, and avoid technical jargon. Use a soothing tone.',
    },
    sad: {
        weight: 1.2,
        keywords: [
            'sad', 'depressed', 'lonely', 'crying', 'disappointed',
            'heartbroken', 'upset', 'gloomy', 'miserable', 'hopeless',
            'hurt', 'regret', 'sorry', 'miss',
            'udaas', 'dukhi', 'tanha', 'afsos',
        ],
        systemPrompt: 'The user sounds sad or down. Respond with warmth, empathy, and gentle encouragement. Be supportive and kind.',
    },
    excited: {
        weight: 1.0,
        keywords: [
            'amazing', 'awesome', 'incredible', 'fantastic', 'wonderful',
            'excited', 'thrilled', 'love', 'perfect', 'brilliant',
            'great', 'superb', 'magnificent', 'yay', 'woohoo',
            'kamaal', 'mast', 'shaandar', 'wah', 'awesome',
        ],
        systemPrompt: 'The user is excited or happy! Match their energy with enthusiasm and positivity. Use exclamation marks and a lively tone.',
    },
    anxious: {
        weight: 1.3,
        keywords: [
            'nervous', 'worried', 'anxious', 'scared', 'afraid',
            'panic', 'stress', 'overwhelmed', 'tension',
            'confused', 'unsure', 'doubt', 'fear',
            'ghabrahat', 'tension', 'fikar', 'dar',
        ],
        systemPrompt: 'The user seems anxious or worried. Respond with reassurance, clarity, and calm confidence. Keep explanations simple and offer step-by-step guidance.',
    },
};
exports.EMOTION_PATTERNS = EMOTION_PATTERNS;
const DEFAULT_SYSTEM_PROMPT = 'You are NEXUS, a concise voice assistant. Reply naturally in the same language or Hinglish style as the user. Keep responses voice-friendly and avoid markdown unless absolutely needed.';
exports.DEFAULT_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT;
function detectEmotion(text) {
    if (!text || typeof text !== 'string')
        return null;
    const lower = text.toLowerCase();
    let maxScore = 0;
    let detected = null;
    for (const [emotion, config] of Object.entries(EMOTION_PATTERNS)) {
        let score = 0;
        for (const keyword of config.keywords) {
            const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            if (regex.test(lower)) {
                score += config.weight;
            }
        }
        if (score > maxScore) {
            maxScore = score;
            detected = emotion;
        }
    }
    return detected ? { emotion: detected, score: maxScore, prompt: EMOTION_PATTERNS[detected].systemPrompt } : null;
}
function buildSystemPrompt(basePrompt, emotionResult) {
    if (!emotionResult)
        return basePrompt || DEFAULT_SYSTEM_PROMPT;
    return `${basePrompt || DEFAULT_SYSTEM_PROMPT}\n\n${emotionResult.prompt}`;
}
