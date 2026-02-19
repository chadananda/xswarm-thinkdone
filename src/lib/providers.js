// AI provider catalog — all supported providers, their models, auth, and cost
// Pure data + selection logic. No side effects, no browser/server dependencies.

export const PROVIDERS = {
  thinkdone: {
    id: 'thinkdone',
    name: 'ThinkDone',
    description: 'Built-in AI — included with your account',
    freeTier: 'included with subscription',
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
    freeTier: 'free — 1500 req/day',
    icon: '\u2726',
    auth: ['oauth', 'api_key'],
    authLabel: 'API Key',
    authPlaceholder: 'AIzaSy...',
    oauthUrl: '/api/auth/google',
    oauthLabel: 'Sign in with Google',
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
    freeTier: 'free — no card needed',
    icon: '\u26A1',
    auth: 'api_key',
    authLabel: 'API Key',
    authPlaceholder: 'gsk_...',
    apiBase: 'https://api.groq.com/openai/v1',
    endpoint: '/api/chat/openai',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', input: 0, output: 0 },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', input: 0, output: 0, weak: true },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', input: 0, output: 0, weak: true },
    ],
    free: true,
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'Strong reasoning — free tokens on signup',
    freeTier: '$8 free credit on signup',
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
    freeTier: '$25 free credit on signup',
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
    freeTier: 'pay-per-use',
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
    freeTier: 'pay-per-use',
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
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    description: 'European AI — free tier available',
    freeTier: 'free — 1B tokens/mo',
    icon: '\u25B2',
    auth: 'api_key',
    authLabel: 'API Key',
    authPlaceholder: 'sk-...',
    apiBase: 'https://api.mistral.ai/v1',
    endpoint: '/api/chat/openai',
    models: [
      { id: 'mistral-large-latest', name: 'Mistral Large', input: 2.0, output: 6.0 },
      { id: 'mistral-small-latest', name: 'Mistral Small', input: 0.1, output: 0.3 },
      { id: 'open-mistral-nemo', name: 'Mistral Nemo', input: 0.15, output: 0.15, weak: true },
    ],
  },
  together: {
    id: 'together',
    name: 'Together AI',
    description: 'Open-source models — $25 free credits',
    freeTier: 'pay-per-use',
    icon: '\u229A',
    auth: 'api_key',
    authLabel: 'API Key',
    authPlaceholder: 'sk-...',
    apiBase: 'https://api.together.xyz/v1',
    endpoint: '/api/chat/openai',
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B', input: 0.88, output: 0.88 },
      { id: 'meta-llama/Llama-3.1-8B-Instruct-Turbo', name: 'Llama 3.1 8B', input: 0.18, output: 0.18, weak: true },
      { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', name: 'Qwen 2.5 72B', input: 1.2, output: 1.2 },
    ],
  },
  fireworks: {
    id: 'fireworks',
    name: 'Fireworks AI',
    description: 'Fast open-source inference',
    freeTier: '$1 free credit on signup',
    icon: '\uD83C\uDF86',
    auth: 'api_key',
    authLabel: 'API Key',
    authPlaceholder: 'fw_...',
    apiBase: 'https://api.fireworks.ai/inference/v1',
    endpoint: '/api/chat/openai',
    models: [
      { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', name: 'Llama 3.3 70B', input: 0.9, output: 0.9 },
      { id: 'accounts/fireworks/models/qwen2p5-72b-instruct', name: 'Qwen 2.5 72B', input: 0.9, output: 0.9 },
    ],
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Multi-provider gateway — free models available',
    freeTier: 'free models available',
    icon: '\u21C4',
    auth: 'api_key',
    authLabel: 'API Key',
    authPlaceholder: 'sk-or-...',
    apiBase: 'https://openrouter.ai/api/v1',
    endpoint: '/api/chat/openai',
    models: [
      { id: 'anthropic/claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', input: 3.0, output: 15.0 },
      { id: 'openai/gpt-4o', name: 'GPT-4o', input: 2.5, output: 10.0 },
      { id: 'google/gemini-2.0-flash-exp', name: 'Gemini Flash', input: 0, output: 0 },
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', input: 0.5, output: 0.5 },
    ],
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    description: 'Search-augmented AI — answers with citations',
    freeTier: 'pay-per-use',
    icon: '\uD83D\uDD0D',
    auth: 'api_key',
    authLabel: 'API Key',
    authPlaceholder: 'pplx-...',
    apiBase: 'https://api.perplexity.ai',
    endpoint: '/api/chat/openai',
    models: [
      { id: 'sonar-pro', name: 'Sonar Pro', input: 3.0, output: 15.0 },
      { id: 'sonar', name: 'Sonar', input: 1.0, output: 1.0 },
    ],
  },
  kimi: {
    id: 'kimi',
    name: 'Kimi',
    description: 'Moonshot AI — open-source MoE, very affordable',
    freeTier: 'free — 1.5M tokens/day',
    icon: '\uD83C\uDF19',
    auth: 'api_key',
    authLabel: 'API Key',
    authPlaceholder: 'sk-...',
    apiBase: 'https://api.moonshot.cn/v1',
    endpoint: '/api/chat/openai',
    models: [
      { id: 'kimi-k2.5', name: 'Kimi K2.5', input: 0.60, output: 2.50 },
    ],
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local models — runs on your machine',
    freeTier: 'free — runs locally',
    icon: '\uD83E\uDDCA',
    auth: 'local',
    authLabel: 'API Key (optional)',
    authPlaceholder: 'Model ID (e.g. llama3.2)',
    apiBase: 'http://localhost:11434/v1',
    endpoint: '/api/chat/openai',
    models: [],
    local: true,
  },
  lmstudio: {
    id: 'lmstudio',
    name: 'LM Studio',
    description: 'Local models — desktop app',
    freeTier: 'free — runs locally',
    icon: '\uD83D\uDDA5\uFE0F',
    auth: 'local',
    authLabel: 'API Key (optional)',
    authPlaceholder: 'Model ID (e.g. mistral-7b)',
    apiBase: 'http://localhost:1234/v1',
    endpoint: '/api/chat/openai',
    models: [],
    local: true,
  },
};

// Provider groups for settings page layout
export const PROVIDER_GROUPS = [
  { label: 'Built-in & Cloud', ids: ['thinkdone', 'anthropic', 'openai', 'gemini', 'grok', 'mistral', 'perplexity'] },
  { label: 'Open Source Inference', ids: ['groq', 'together', 'fireworks', 'openrouter', 'deepseek', 'kimi'] },
  { label: 'Local', ids: ['ollama', 'lmstudio'] },
];

// Display order for settings page
export const PROVIDER_ORDER = PROVIDER_GROUPS.flatMap(g => g.ids);
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
  basic: ['haiku', 'mini', 'flash', 'instant', '8b', 'small', 'nemo'],
  standard: ['sonnet', 'flash', 'chat', 'gpt-4o-mini', '70b', 'grok-2-mini', 'small', 'nemo', '72b', 'sonar', 'k2.5'],
  reasoning: ['sonnet', 'pro', 'gpt-4o', 'reasoner', 'grok-2', 'opus', 'large', 'sonar-pro', '72b', 'k2.5'],
};

// Get the best model for a given tier from a provider
// Skips models marked weak: true (can't handle structured XML extraction)
// For reasoning tier, excludes models that also match basic-tier keywords (e.g. gpt-4o-mini)
export function getModelForTier(providerId, tier = 'standard') {
  const p = PROVIDERS[providerId];
  if (!p?.models?.length) return null;
  const capable = p.models.filter(m => !m.weak);
  if (!capable.length) return null;
  const keywords = TIER_KEYWORDS[tier] || TIER_KEYWORDS.standard;
  const basicKws = tier === 'reasoning' ? TIER_KEYWORDS.basic : null;
  const matches = capable.filter(m => {
    const id = m.id.toLowerCase();
    const name = m.name.toLowerCase();
    const hit = keywords.some(kw => id.includes(kw) || name.includes(kw));
    if (!hit) return false;
    if (basicKws && basicKws.some(kw => id.includes(kw) || name.includes(kw))) return false;
    return true;
  });
  if (matches.length === 0) {
    // Fall back to cheapest capable model
    const sorted = [...capable].sort((a, b) => (a.input + a.output) - (b.input + b.output));
    return sorted[0];
  }
  const sorted = [...matches].sort((a, b) => (a.input + a.output) - (b.input + b.output));
  return sorted[0];
}
//
// Get the cheapest capable model for a provider (skips weak models)
export function getCheapestModel(providerId) {
  const p = PROVIDERS[providerId];
  if (!p?.models?.length) return null;
  const capable = p.models.filter(m => !m.weak);
  if (!capable.length) return null;
  const sorted = [...capable].sort((a, b) => (a.input + a.output) - (b.input + b.output));
  return sorted[0];
}

// Model cost for sorting — average of input + output per MTok
function modelCost(model) {
  return (model.input + model.output) / 2;
}

// Parse custom providers from settings JSON string
export function parseCustomProviders(jsonStr) {
  if (!jsonStr) return [];
  try {
    const arr = JSON.parse(jsonStr);
    if (!Array.isArray(arr)) return [];
    return arr.filter(c => c.id && c.name && c.baseUrl).map(c => ({
      id: c.id,
      name: c.name,
      description: c.baseUrl,
      icon: '\u2699',
      auth: 'local',
      apiBase: c.baseUrl,
      endpoint: '/api/chat/openai',
      models: [],
      local: true,
      custom: true,
    }));
  } catch { return []; }
}

// Merge built-in providers with custom providers into single object
export function getAllProviders(customJson) {
  const custom = parseCustomProviders(customJson);
  if (!custom.length) return PROVIDERS;
  const merged = { ...PROVIDERS };
  for (const c of custom) merged[c.id] = c;
  return merged;
}

// Read fetched models from a connection's scopes JSON
export function getFetchedModels(conn) {
  if (!conn?.scopes) return [];
  try {
    const meta = JSON.parse(conn.scopes);
    return Array.isArray(meta.models) ? meta.models : [];
  } catch { return []; }
}

// Get effective models for a provider: hardcoded catalog + fetched from connection
export function getEffectiveModels(providerId, conn, allProviders = PROVIDERS) {
  const p = allProviders[providerId];
  if (!p) return [];
  if (p.models.length > 0) return p.models;
  // For providers with empty hardcoded models, use fetched models from connection scopes
  const fetched = getFetchedModels(conn);
  return fetched.map(m => ({ id: m.id, name: m.name || m.id, input: 0, output: 0 }));
}

// Build sorted provider chain for API calls
// Returns array of { providerId, model, endpoint, connection } sorted cheapest-first
export function buildProviderChain(enabledIds, connections, tier = 'standard', allProviders = PROVIDERS) {
  const chain = [];
  for (const id of enabledIds) {
    const p = allProviders[id];
    if (!p) continue;
    if (p.auth === 'builtin') {
      const model = getModelForTier(id, tier);
      if (model) chain.push({ providerId: id, model: model.id, endpoint: p.endpoint, connection: null });
      continue;
    }
    const conn = connections.find(c => c.provider === id);
    // Local providers don't require access_token
    if (p.auth !== 'local' && !conn?.access_token) continue;
    // For providers with empty hardcoded models, use fetched models from connection scopes
    let modelId;
    if (p.models.length === 0) {
      const effective = getEffectiveModels(id, conn, allProviders);
      if (effective.length === 0) {
        // Backward compat: check for legacy modelId in scopes
        let meta = {};
        try { if (conn?.scopes) meta = JSON.parse(conn.scopes); } catch {}
        modelId = meta.modelId;
        if (!modelId) continue;
      } else {
        // Use tier matching on fetched models
        const keywords = TIER_KEYWORDS[tier] || TIER_KEYWORDS.standard;
        const match = effective.find(m => {
          const lo = (m.id + ' ' + m.name).toLowerCase();
          return keywords.some(kw => lo.includes(kw));
        });
        modelId = match ? match.id : effective[0].id;
      }
    } else {
      const model = getModelForTier(id, tier);
      if (!model) continue;
      modelId = model.id;
    }
    chain.push({ providerId: id, model: modelId, endpoint: p.endpoint, connection: conn || null });
  }

  chain.sort((a, b) => {
    const connA = connections.find(c => c.provider === a.providerId);
    const connB = connections.find(c => c.provider === b.providerId);
    const modelsA = getEffectiveModels(a.providerId, connA, allProviders);
    const modelsB = getEffectiveModels(b.providerId, connB, allProviders);
    const mA = modelsA.find(m => m.id === a.model);
    const mB = modelsB.find(m => m.id === b.model);
    return modelCost(mA || { input: 999, output: 999 }) - modelCost(mB || { input: 999, output: 999 });
  });

  return chain;
}

// Format pricing for display
export function formatProviderPricing(providerId, allProviders = PROVIDERS) {
  const p = allProviders[providerId];
  if (!p) return '';
  if (providerId === 'thinkdone') return 'Default';
  if (p.free) return 'Free tier';
  if (p.local) return 'Self-hosted';
  if (!p.models.length) return '';
  const cheapest = getCheapestModel(providerId);
  if (!cheapest) return '';
  if (cheapest.input === 0 && cheapest.output === 0) return 'Free tier';
  return `From $${cheapest.input.toFixed(2)}/MTok`;
}
