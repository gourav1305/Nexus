import Groq from 'groq-sdk';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// ── Provider Detection ──
import axios from 'axios';
const PROVIDERS: Record<string, any> = {};

function detectProviders(): { providers: string[]; models: Record<string, string[]>; [key: string]: any } {
  const result: any = { providers: [], models: {} };

  // Groq
  if (process.env.GROQ_API_KEY) {
    PROVIDERS.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    result.providers.push('groq');
    result.models.groq = [
      'llama-3.1-8b-instant', 'llama-3.3-70b-versatile',
      'llama-3.2-90b-vision-preview',
      'gemma2-9b-it', 'mixtral-8x7b-32768',
    ];
  }

  // OpenAI
  if (process.env.OPENAI_API_KEY) {
    PROVIDERS.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    result.providers.push('openai');
    result.models.openai = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'];
  }

  // Anthropic
  if (process.env.ANTHROPIC_API_KEY) {
    PROVIDERS.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    result.providers.push('anthropic');
    result.models.anthropic = ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307', 'claude-3-opus-20240229'];
  }

  // Ollama (detect via API)
  const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
  if (!result.ollamaChecked) {
    result.ollamaHost = OLLAMA_HOST;
  }

  return result;
}

// ── Query Classification ──
const CODE_PATTERNS = /\b(code|program|function|debug|compile|syntax|script|coding|api|endpoint|bug|error|fix|refactor|implement|class|module|import|export|async|promise|callback|variable|loop|array|object|string|json|sql|query|database|algorithm|sort|search|function|method|component|react|vue|node|python|javascript|java|typescript|html|css|bash|docker|git)\b/i;
const CREATIVE_PATTERNS = /\b(story|poem|poetry|creative|imagine|fantasy|fiction|write|essay|letter|song|lyrics|script|dialogue|describe|picture|draw|design|idea|suggest|recommend|fun|joke|funny|mast|maza)\b/i;
const MATH_PATTERNS = /\b(math|calculate|solve|equation|formula|derivative|integral|algebra|geometry|trigonometry|probability|statistics|sum|difference|product|quotient|percentage|ratio|prove|theorem)\b/i;

function classifyQuery(text) {
  const t = text.toLowerCase();
  let codeScore = 0, creativeScore = 0, mathScore = 0;

  const codeMatches = t.match(CODE_PATTERNS);
  if (codeMatches) codeScore = codeMatches.length;

  const creativeMatches = t.match(CREATIVE_PATTERNS);
  if (creativeMatches) creativeScore = creativeMatches.length;

  const mathMatches = t.match(MATH_PATTERNS);
  if (mathMatches) mathScore = mathMatches.length;

  if (codeScore >= mathScore && codeScore >= creativeScore && codeScore >= 1) return 'code';
  if (mathScore >= codeScore && mathScore >= creativeScore && mathScore >= 1) return 'math';
  if (creativeScore >= codeScore && creativeScore >= mathScore && creativeScore >= 1) return 'creative';
  return 'general';
}

// ── Model Selection ──
const MODEL_MAP = {
  groq: { code: 'llama-3.3-70b-versatile', creative: 'llama-3.1-8b-instant', math: 'gemma2-9b-it', general: 'llama-3.1-8b-instant', vision: 'meta-llama/llama-4-scout-17b-16e-instruct' },
  openai: { code: 'gpt-4o', creative: 'gpt-4o-mini', math: 'gpt-4o', general: 'gpt-4o-mini', vision: 'gpt-4o' },
  anthropic: { code: 'claude-3-5-sonnet-20241022', creative: 'claude-3-haiku-20240307', math: 'claude-3-sonnet-20240229', general: 'claude-3-haiku-20240307', vision: 'claude-3-5-sonnet-20241022' },
};

const PROVIDER_ORDER = ['groq', 'openai', 'anthropic', 'ollama'];

function selectModel(provider, category, forVision) {
  if (forVision && MODEL_MAP[provider]?.vision) return MODEL_MAP[provider].vision;
  return MODEL_MAP[provider]?.[category] || MODEL_MAP[provider]?.general || null;
}

// ── Provider Call Functions ──

async function callGroq(messages: any, model: string, options: any = {}) {
  const groq = PROVIDERS.groq;
  if (!groq) throw new Error('Groq provider not initialized');
  const completion = await groq.chat.completions.create({
    messages,
    model,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
  });
  return completion.choices?.[0]?.message?.content?.trim() || '';
}

async function callOpenAI(messages: any, model: string, options: any = {}) {
  const openai = PROVIDERS.openai;
  if (!openai) throw new Error('OpenAI provider not initialized');
  const completion = await openai.chat.completions.create({
    messages,
    model,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
  });
  return completion.choices?.[0]?.message?.content?.trim() || '';
}

async function callAnthropic(messages: any, model: string, options: any = {}) {
  const anthropic = PROVIDERS.anthropic;
  if (!anthropic) throw new Error('Anthropic provider not initialized');
  // Extract system message
  let system = '';
  const msgs = messages.filter(m => {
    if (m.role === 'system') { system = m.content; return false; }
    return true;
  });
  // Anthropic expects vision content as array of {type, source} or text
  const mapped = msgs.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: typeof m.content === 'string' ? m.content : m.content.map(c => {
      if (c.type === 'image_url') {
        // Convert base64 data URL to Anthropic's format
        const match = c.image_url?.url?.match(/^data:(image\/\w+);base64,(.+)$/);
        if (match) return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
        return { type: 'text', text: c.image_url?.url || '' };
      }
      return c;
    }),
  }));
  const completion = await anthropic.messages.create({
    model,
    messages: mapped,
    system: system || undefined,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
  });
  return completion.content?.[0]?.text?.trim() || '';
}

async function callOllama(messages: any, model: string, options: any = {}) {
  const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
  // Ollama chat API accepts content as array for vision
  const mapped = messages.map(m => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : m.content.map(c => {
      if (c.type === 'image_url') {
        const match = c.image_url?.url?.match(/^data:(image\/\w+);base64,(.+)$/);
        if (match) return { type: 'image_url', image_url: c.image_url.url };
        return { type: 'text', text: c.image_url?.url || '' };
      }
      return c;
    }),
  }));
  const res = await axios.post(`${host}/api/chat`, {
    model: model || 'llama3',
    messages: mapped,
    stream: false,
    options: { temperature: options.temperature ?? 0.7, num_predict: options.maxTokens ?? 4096 },
  }, { timeout: 30000 });
  return res.data?.message?.content?.trim() || '';
}

const PROVIDER_CALLS = { groq: callGroq, openai: callOpenAI, anthropic: callAnthropic, ollama: callOllama };

// ── Streaming Provider Functions ──

async function streamGroq(messages: any, model: string, options: any, onToken: (t: string) => void) {
  const groq = PROVIDERS.groq;
  if (!groq) throw new Error('Groq provider not initialized');
  const stream = await groq.chat.completions.create({
    messages,
    model,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
    stream: true,
  });
  let full = '';
  for await (const chunk of stream) {
    const token = chunk.choices?.[0]?.delta?.content || '';
    if (token) { full += token; onToken(token); }
  }
  return full.trim();
}

async function streamOpenAI(messages: any, model: string, options: any, onToken: (t: string) => void) {
  const openai = PROVIDERS.openai;
  if (!openai) throw new Error('OpenAI provider not initialized');
  const stream = await openai.chat.completions.create({
    messages,
    model,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
    stream: true,
  });
  let full = '';
  for await (const chunk of stream) {
    const token = chunk.choices?.[0]?.delta?.content || '';
    if (token) { full += token; onToken(token); }
  }
  return full.trim();
}

async function streamAnthropic(messages: any, model: string, options: any, onToken: (t: string) => void) {
  const anthropic = PROVIDERS.anthropic;
  if (!anthropic) throw new Error('Anthropic provider not initialized');
  let system = '';
  const msgs = messages.filter((m: any) => {
    if (m.role === 'system') { system = m.content; return false; }
    return true;
  });
  const mapped = msgs.map((m: any) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: typeof m.content === 'string' ? m.content : m.content.map((c: any) => {
      if (c.type === 'image_url') {
        const match = c.image_url?.url?.match(/^data:(image\/\w+);base64,(.+)$/);
        if (match) return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
        return { type: 'text', text: c.image_url?.url || '' };
      }
      return c;
    }),
  }));
  const stream = await anthropic.messages.create({
    model,
    messages: mapped,
    system: system || undefined,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
    stream: true,
  });
  let full = '';
  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && (chunk as any).delta?.text) {
      const token = (chunk as any).delta.text;
      full += token;
      onToken(token);
    }
  }
  return full.trim();
}

async function streamOllama(messages: any, model: string, options: any, onToken: (t: string) => void) {
  const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
  const mapped = messages.map((m: any) => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : m.content.map((c: any) => {
      if (c.type === 'image_url') return { type: 'image_url', image_url: c.image_url.url };
      return c;
    }),
  }));
  const res = await axios.post(`${host}/api/chat`, {
    model: model || 'llama3',
    messages: mapped,
    stream: true,
    options: { temperature: options.temperature ?? 0.7, num_predict: options.maxTokens ?? 4096 },
  }, { responseType: 'stream', timeout: 60000 });
  let full = '';
  return new Promise<string>((resolve, reject) => {
    let buffer = '';
    res.data.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) {
            full += parsed.message.content;
            onToken(parsed.message.content);
          }
          if (parsed.done) resolve(full.trim());
        } catch {}
      }
    });
    res.data.on('end', () => resolve(full.trim()));
    res.data.on('error', reject);
  });
}

const STREAM_PROVIDER_CALLS: Record<string, any> = {
  groq: streamGroq,
  openai: streamOpenAI,
  anthropic: streamAnthropic,
  ollama: streamOllama,
};

// ── Main Route Function ──

// Fallback models when primary is rate-limited
const FALLBACK_MODELS = {
  groq: ['llama-3.1-8b-instant', 'gemma2-9b-it', 'mixtral-8x7b-32768'],
  openai: ['gpt-4o-mini'],
  anthropic: ['claude-3-haiku-20240307'],
};

async function routeQuery(userPrefs: any, messages: any, options: any = {}) {
  const { preferredProvider, preferredModel, category: forcedCategory, forVision, autoRoute } = options;
  const category = forcedCategory || classifyQuery(messages.map(m => m.content).join(' '));
  const errors = [];

  // Build provider list: preferred first, then fallbacks
  const available = detectProviders().providers;
  let providerList = [];

  if (preferredProvider && available.includes(preferredProvider)) {
    providerList.push(preferredProvider);
  }
  for (const p of PROVIDER_ORDER) {
    if (available.includes(p) && !providerList.includes(p)) {
      providerList.push(p);
    }
  }
  // Try Ollama always if available (skip for vision - Ollama vision models are unreliable)
  if (forVision) {
    if (providerList.length === 0) {
      throw new Error('No AI providers available. Configure GROQ_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY in .env');
    }
  } else if (!providerList.includes('ollama')) {
    try {
      await axios.get(`${process.env.OLLAMA_HOST || 'http://localhost:11434'}/api/tags`, { timeout: 2000 });
      providerList.push('ollama');
      if (!PROVIDERS.ollama) PROVIDERS.ollama = true;
    } catch {}
  }

  if (providerList.length === 0) {
    throw new Error('No AI providers available. Configure GROQ_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY in .env');
  }

  for (const provider of providerList) {
    try {
      const isPreferred = provider === preferredProvider;
      let model;
      if (isPreferred && preferredModel && !autoRoute) {
        model = preferredModel;
      } else {
        model = selectModel(provider, category, forVision);
      }
      if (!model) continue;
      const caller = PROVIDER_CALLS[provider];
      if (!caller) continue;

      try {
        const result = await caller(messages, model, { temperature: options.temperature ?? 0.7, maxTokens: options.maxTokens });
        return { text: result, provider, model, category, fallbacksUsed: errors.length };
      } catch (err) {
        // If rate-limited (429), try fallback models within same provider
        if (err.message && (err.message.includes('429') || err.message.includes('rate_limit'))) {
          console.warn(`[ModelRouter] ${provider}/${model} rate-limited. Trying fallback models...`);
          const fallbacks = FALLBACK_MODELS[provider] || [];
          for (const fbModel of fallbacks) {
            if (fbModel === model) continue; // Skip the same model
            try {
              const result = await caller(messages, fbModel, { temperature: options.temperature ?? 0.7, maxTokens: options.maxTokens });
              console.log(`[ModelRouter] Fallback ${provider}/${fbModel} succeeded`);
              return { text: result, provider, model: fbModel, category, fallbacksUsed: errors.length + 1 };
            } catch (fbErr) {
              console.warn(`[ModelRouter] Fallback ${provider}/${fbModel} also failed: ${fbErr.message}`);
            }
          }
        }
        throw err; // Re-throw if no fallback worked
      }
    } catch (err) {
      errors.push({ provider, error: err.message });
      console.warn(`[ModelRouter] ${provider} failed: ${err.message}. Trying next...`);
    }
  }

  throw new Error(`All providers failed. Errors: ${errors.map(e => `${e.provider}: ${e.error}`).join(' | ')}`);
}

async function streamRouteQuery(userPrefs: any, messages: any, options: any = {}, onToken: (t: string) => void) {
  const { preferredProvider, preferredModel, category: forcedCategory, forVision, autoRoute } = options;
  const category = forcedCategory || classifyQuery(messages.map((m: any) => m.content).join(' '));
  const errors: any[] = [];

  const available = detectProviders().providers;
  const providerList: string[] = [];

  if (preferredProvider && available.includes(preferredProvider)) {
    providerList.push(preferredProvider);
  }
  for (const p of PROVIDER_ORDER) {
    if (available.includes(p) && !providerList.includes(p)) {
      providerList.push(p);
    }
  }
  if (forVision) {
    if (providerList.length === 0) {
      throw new Error('No AI providers available. Configure GROQ_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY in .env');
    }
  } else if (!providerList.includes('ollama')) {
    try {
      await axios.get(`${process.env.OLLAMA_HOST || 'http://localhost:11434'}/api/tags`, { timeout: 2000 });
      providerList.push('ollama');
      if (!PROVIDERS.ollama) PROVIDERS.ollama = true;
    } catch {}
  }

  if (providerList.length === 0) {
    throw new Error('No AI providers available. Configure GROQ_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY in .env');
  }

  for (const provider of providerList) {
    try {
      const isPreferred = provider === preferredProvider;
      let model: string | null;
      if (isPreferred && preferredModel && !autoRoute) {
        model = preferredModel;
      } else {
        model = selectModel(provider, category, forVision);
      }
      if (!model) continue;
      const caller = STREAM_PROVIDER_CALLS[provider];
      if (!caller) continue;

      try {
        const text = await caller(messages, model, { temperature: options.temperature ?? 0.7, maxTokens: options.maxTokens }, onToken);
        return { text, provider, model, category, fallbacksUsed: errors.length };
      } catch (err: any) {
        if (err.message && (err.message.includes('429') || err.message.includes('rate_limit'))) {
          console.warn(`[ModelRouter] ${provider}/${model} rate-limited. Trying fallback models...`);
          const fallbacks = FALLBACK_MODELS[provider] || [];
          for (const fbModel of fallbacks) {
            if (fbModel === model) continue;
            try {
              const text = await caller(messages, fbModel, { temperature: options.temperature ?? 0.7, maxTokens: options.maxTokens }, onToken);
              return { text, provider, model: fbModel, category, fallbacksUsed: errors.length + 1 };
            } catch (fbErr: any) {
              console.warn(`[ModelRouter] Fallback ${provider}/${fbModel} also failed: ${fbErr.message}`);
            }
          }
        }
        throw err;
      }
    } catch (err: any) {
      errors.push({ provider, error: err.message });
      console.warn(`[ModelRouter] ${provider} failed: ${err.message}. Trying next...`);
    }
  }

  throw new Error(`All providers failed. Errors: ${errors.map(e => `${e.provider}: ${e.error}`).join(' | ')}`);
}

async function routeVision(userPrefs: any, messages: any, options: any = {}) {
  return routeQuery(userPrefs, messages, { ...options, forVision: true });
}

async function checkOllama() {
  try {
    const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
    const res = await axios.get(`${host}/api/tags`, { timeout: 3000 });
    const models = res.data?.models || [];
    return { available: true, host, models: models.map(m => m.name) };
  } catch {
    return { available: false, host: process.env.OLLAMA_HOST || 'http://localhost:11434', models: [] };
  }
}

export { detectProviders, classifyQuery, routeQuery, streamRouteQuery, routeVision, checkOllama, MODEL_MAP, PROVIDER_ORDER };
