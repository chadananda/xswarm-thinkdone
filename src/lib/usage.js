// Token usage cost calculation and formatting utilities

const PRICING = {
  // Anthropic / ThinkDone
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001':  { input: 1.0, output: 5.0 },
  'claude-opus-4-5-20250929':   { input: 5.0, output: 25.0 },
  // Google Gemini (free tier)
  'gemini-2.0-flash':           { input: 0.0, output: 0.0 },
  'gemini-2.5-pro':             { input: 0.0, output: 0.0 },
  'gemini-1.5-flash':           { input: 0.0, output: 0.0 },
  'gemini-1.5-pro':             { input: 0.0, output: 0.0 },
  // Groq (free tier)
  'llama-3.3-70b-versatile':    { input: 0.0, output: 0.0 },
  'llama-3.1-8b-instant':       { input: 0.0, output: 0.0 },
  'mixtral-8x7b-32768':         { input: 0.0, output: 0.0 },
  // DeepSeek
  'deepseek-chat':              { input: 0.14, output: 0.28 },
  'deepseek-reasoner':          { input: 0.55, output: 2.19 },
  // xAI Grok
  'grok-2':                     { input: 2.0, output: 10.0 },
  'grok-2-mini':                { input: 0.3, output: 0.5 },
  // OpenAI
  'gpt-4o':                     { input: 2.5, output: 10.0 },
  'gpt-4o-mini':                { input: 0.15, output: 0.6 },
  'o3-mini':                    { input: 1.1, output: 4.4 },
};

const FALLBACK_PRICING = { input: 3.0, output: 15.0 };

export function calculateCost(model, inputTokens, outputTokens, { cacheReadTokens = 0, cacheWriteTokens = 0 } = {}) {
  const pricing = PRICING[model] || FALLBACK_PRICING;
  const regularInput = inputTokens - cacheReadTokens - cacheWriteTokens;
  const inputCost = regularInput * pricing.input;
  const cacheReadCost = cacheReadTokens * pricing.input * 0.1;   // 90% savings
  const cacheWriteCost = cacheWriteTokens * pricing.input * 1.25; // 25% surcharge
  const outputCost = outputTokens * pricing.output;
  return (inputCost + cacheReadCost + cacheWriteCost + outputCost) / 1_000_000;
}

export function formatCost(usd) {
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
