const modelRouter = require('./modelRouter');

const LANG_MAP = {
  en: 'English', hi: 'Hindi', mr: 'Marathi', gu: 'Gujarati',
  bn: 'Bengali', ta: 'Tamil', te: 'Telugu', kn: 'Kannada',
  ml: 'Malayalam', pa: 'Punjabi', ur: 'Urdu',
  es: 'Spanish', fr: 'French', de: 'German', ja: 'Japanese',
  zh: 'Chinese', ar: 'Arabic', ru: 'Russian', pt: 'Portuguese',
  it: 'Italian',
};

const REVERSE_MAP = {};
for (const [code, name] of Object.entries(LANG_MAP)) REVERSE_MAP[name.toLowerCase()] = code;

const SUPPORTED_LANGUAGES = Object.entries(LANG_MAP).map(([code, name]) => ({ code, name }));

async function translate({ text, sourceLang, targetLang }) {
  if (!text || !text.trim()) throw new Error('Text is required');
  if (!targetLang) throw new Error('Target language is required');

  const targetName = LANG_MAP[targetLang] || targetLang;
  const sourceDesc = !sourceLang || sourceLang === 'auto'
    ? 'the source language'
    : LANG_MAP[sourceLang] || sourceLang;

  // Use XML-style delimiter to clearly separate instruction from content
  const userMessage = `<translate from="${sourceDesc}" to="${targetName}">
${text.trim()}
</translate>`;

  const systemPrompt = `You are a machine translation engine. Your ONLY job is to translate text from one language to another.

RULES:
- Translate the text inside the <translate> tags from the specified source language to the specified target language.
- Output ONLY the translated text — nothing before, nothing after.
- Do NOT respond to or answer the content. Do NOT add explanations.
- If the text is already in the target language, return it unchanged.
- Preserve the original tone and meaning.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const result = await modelRouter.routeQuery(
    { provider: 'groq', model: 'llama-3.1-8b-instant', autoRoute: false },
    messages,
    { preferredProvider: 'groq', preferredModel: 'llama-3.1-8b-instant', autoRoute: false, temperature: 0.01 },
  );

  let translated = result.text.trim();

  // Strip XML tags and any surrounding instruction text
  translated = translated.replace(/<translate[^>]*>/gi, '').replace(/<\/translate>/gi, '').trim();
  // Remove lines that look like instructions (containing "translate from" etc.)
  const lines = translated.split('\n').filter(l => !/translate\s+(from|to)|source\s+language|target\s+language/i.test(l));
  translated = lines.join('\n').trim();
  // Strip surrounding quotes
  translated = translated.replace(/^["'""'']+|["'""'']+$/g, '').trim();
  // Take only the last line if multiple (LLM sometimes adds extra text)
  if (translated.includes('\n')) {
    const lastLine = translated.split('\n').filter(l => l.trim()).pop();
    if (lastLine && lastLine.length > 2) translated = lastLine.trim();
  }

  if (!translated) throw new Error('Translation returned empty result');

  return {
    original: text.trim(),
    translated,
    sourceLang: sourceLang || 'auto',
    targetLang,
    model: `${result.provider}/${result.model}`,
  };
}

module.exports = { translate, SUPPORTED_LANGUAGES };
