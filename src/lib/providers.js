// AI provider catalog — all supported providers, their models, auth, and cost
// Pure data + selection logic. No side effects, no browser/server dependencies.

export const PROVIDERS = {
  thinkdone: {
    id: 'thinkdone',
    name: 'ThinkDone',
    description: 'Built-in AI — included with your account',
    icon: '\u25C8',
    auth: 'builtin',
    endpoint: '/api/chat',
    models: [
      { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', input: 3.0, output: 15.0 },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', input: 1.0, output: 5.0 },
    ],
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Free tier — sign in with Google or use API key',
    icon: '\u2726',
    auth: ['oauth', 'api_key'],
    authLabel: 'API Key',
    authPlaceholder: 'AIzaSy...',
    oauthUrl: '/api/auth/google',
    endpoint: '/api/chat/gemini',
    models: [
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', input: 0, output: 0 },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', input: 0, output: 0 },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', input: 0, output: 0 },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', input: 0, output: 0 },
    ],
    free: true,
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    description: 'Fast inference — generous free tier',
    icon: '\u26A1',
    auth: 'api_key',
    authLabel: 'API Key',
    authPlaceholder: 'gsk_...',
    apiBase: 'https://api.groq.com/openai/v1',
    endpoint: '/api/chat/openai',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', input: 0, output: 0 },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', input: 0, output: 0 },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', input: 0, output: 0 },
    ],
    free: true,
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'Very affordable — strong reasoning',
    icon: '\u25C7',
    auth: 'api_key',
    authLabel: 'API Key',
    authPlaceholder: 'sk-...',
    apiBase: 'https://api.deepseek.com',
    endpoint: '/api/chat/openai',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', input: 0.14, output: 0.28 },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', input: 0.55, output: 2.19 },
    ],
  },
  grok: {
    id: 'grok',
    name: 'xAI (Grok)',
    description: 'Grok models from xAI',
    icon: '\u2715',
    auth: 'api_key',
    authLabel: 'API Key',
    authPlaceholder: 'xai-...',
    apiBase: 'https://api.x.ai/v1',
    endpoint: '/api/chat/openai',
    models: [
      { id: 'grok-2', name: 'Grok 2', input: 2.0, output: 10.0 },
      { id: 'grok-2-mini', name: 'Grok 2 Mini', input: 0.3, output: 0.5 },
    ],
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT models',
    icon: '\u25C9',
    auth: 'api_key',
    authLabel: 'API Key',
    authPlaceholder: 'sk-...',
    apiBase: 'https://api.openai.com/v1',
    endpoint: '/api/chat/openai',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', input: 2.5, output: 10.0 },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', input: 0.15, output: 0.6 },
      { id: 'o3-mini', name: 'o3 Mini', input: 1.1, output: 4.4 },
    ],
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Use your own Claude API key',
    icon: '\u2B21',
    auth: 'api_key',
    authLabel: 'API Key',
    authPlaceholder: 'sk-ant-...',
    endpoint: '/api/chat',
    models: [
      { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', input: 3.0, output: 15.0 },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', input: 1.0, output: 5.0 },
      { id: 'claude-opus-4-5-20250929', name: 'Claude Opus 4.5', input: 5.0, output: 25.0 },
    ],
  },
};

// Display order for settings page
export const PROVIDER_ORDER = ['thinkdone', 'gemini', 'groq', 'deepseek', 'grok', 'openai', 'anthropic'];
//
// Session type → model tier mapping
export const SESSION_TIER_MAP = {
  check_in: 'basic',
  morning_meeting: 'standard',
  evening_review: 'standard',
  onboarding: 'standard',
  weekly_review: 'reasoning',
  strategic: 'reasoning',
};
//
const TIER_KEYWORDS = {
  basic: ['haiku', 'mini', 'flash', 'instant', '8b'],
  standard: ['sonnet', 'flash', 'chat', 'gpt-4o-mini', '70b', 'grok-2-mini'],
  reasoning: ['sonnet', 'pro', 'gpt-4o', 'reasoner', 'grok-2', 'opus'],
};

// Get the best model for a given tier from a provider
// For reasoning tier, excludes models that also match basic-tier keywords (e.g. gpt-4o-mini)
export function getModelForTier(providerId, tier = 'standard') {
  const p = PROVIDERS[providerId];
  if (!p?.models?.length) return null;
  const keywords = TIER_KEYWORDS[tier] || TIER_KEYWORDS.standard;
  const basicKws = tier === 'reasoning' ? TIER_KEYWORDS.basic : null;
  const matches = p.models.filter(m => {
    const id = m.id.toLowerCase();
    const name = m.name.toLowerCase();
    const hit = keywords.some(kw => id.includes(kw) || name.includes(kw));
    if (!hit) return false;
    // For reasoning tier, exclude models that also match basic keywords (mini, flash, etc.)
    if (basicKws && basicKws.some(kw => id.includes(kw) || name.includes(kw))) return false;
    return true;
  });
  if (matches.length === 0) return getCheapestModel(providerId);
  const sorted = [...matches].sort((a, b) => (a.input + a.output) - (b.input + b.output));
  return sorted[0];
}
//
// Get the cheapest model for a provider (used for auto-selection)
export function getCheapestModel(providerId) {
  const p = PROVIDERS[providerId];
  if (!p?.models?.length) return null;
  const sorted = [...p.models].sort((a, b) => (a.input + a.output) - (b.input + b.output));
  return sorted[0];
}

// Model cost for sorting — average of input + output per MTok
function modelCost(model) {
  return (model.input + model.output) / 2;
}

// Build sorted provider chain for API calls
// Returns array of { providerId, model, endpoint, connection } sorted cheapest-first
export function buildProviderChain(enabledIds, connections, tier = 'standard') {
  const chain = [];
  for (const id of enabledIds) {
    const p = PROVIDERS[id];
    if (!p) continue;
    if (p.auth === 'builtin') {
      const model = getModelForTier(id, tier);
      if (model) chain.push({ providerId: id, model: model.id, endpoint: p.endpoint, connection: null });
      continue;
    }
    const conn = connections.find(c => c.provider === id);
    if (!conn?.access_token) continue;
    const model = getModelForTier(id, tier);
    if (model) chain.push({ providerId: id, model: model.id, endpoint: p.endpoint, connection: conn });
  }

  chain.sort((a, b) => {
    const mA = PROVIDERS[a.providerId]?.models?.find(m => m.id === a.model);
    const mB = PROVIDERS[b.providerId]?.models?.find(m => m.id === b.model);
    return modelCost(mA || { input: 999, output: 999 }) - modelCost(mB || { input: 999, output: 999 });
  });

  return chain;
}
