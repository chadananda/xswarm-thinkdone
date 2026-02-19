// AI provider abstraction — routes calls to the right proxy, with cost-sorted fallback
// Pure functions (translate*, parse*) are testable without fetch
import { PROVIDERS } from './providers.js';

// --- Helpers ---

// Extract flat string from system (may be string or { blocks, flat })
function flatSystem(system) {
  if (!system) return '';
  if (typeof system === 'string') return system;
  return system.flat || '';
}

// --- Gemini format translation ---

export function translateToGeminiFormat(system, messages) {
  const systemInstruction = { parts: [{ text: flatSystem(system) }] };
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : m.role,
    parts: [{ text: m.content }],
  }));
  return { systemInstruction, contents };
}

export function parseGeminiSSEChunk(data, model) {
  if (!data) return null;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text !== undefined) return { text };
  if (data.usageMetadata) {
    return {
      usage: {
        input_tokens: data.usageMetadata.promptTokenCount,
        output_tokens: data.usageMetadata.candidatesTokenCount,
        model,
      },
    };
  }
  return null;
}

// --- OpenAI format translation ---

export function translateToOpenAIFormat(system, messages) {
  const result = [];
  const s = flatSystem(system);
  if (s) result.push({ role: 'system', content: s });
  for (const m of messages) {
    result.push({ role: m.role, content: m.content });
  }
  return result;
}

export function parseOpenAISSEChunk(data, model) {
  if (!data) return null;
  const delta = data.choices?.[0]?.delta;
  if (delta?.content) return { text: delta.content };
  if (data.usage) {
    return {
      usage: {
        input_tokens: data.usage.prompt_tokens,
        output_tokens: data.usage.completion_tokens,
        model: data.model || model,
      },
    };
  }
  return null;
}

// --- Token refresh (OAuth providers only) ---

export async function ensureFreshToken(tokenData) {
  if (!tokenData?.access_token) return null;
  // API key auth — no refresh needed (refresh_token is empty)
  if (!tokenData.refresh_token) return tokenData.access_token;
  // OAuth: check expiry
  const now = Date.now() / 1000;
  if (tokenData.expires_at && tokenData.expires_at > now + 60) {
    return tokenData.access_token;
  }
  // Token expired or expiring soon — refresh
  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: tokenData.refresh_token }),
  });
  if (!res.ok) throw new Error('Token refresh failed');
  const fresh = await res.json();
  tokenData.access_token = fresh.access_token;
  tokenData.expires_at = fresh.expires_at;
  tokenData._refreshed = true;
  return fresh.access_token;
}

// --- Browser-direct Gemini call ---
// Calls Gemini API directly from the browser — no server proxy needed.
// Returns a Response with normalized SSE stream ({ text } / { usage } chunks).

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function callGeminiBrowser(model, system, messages, connection) {
  const { systemInstruction, contents } = translateToGeminiFormat(system, messages);
  const token = connection?.refresh_token
    ? await ensureFreshToken(connection)
    : connection?.access_token;

  let url = `${GEMINI_API_BASE}/models/${model}:streamGenerateContent?alt=sse`;
  const headers = { 'Content-Type': 'application/json' };

  if (connection?.refresh_token) {
    // OAuth — Bearer token
    headers['Authorization'] = `Bearer ${token}`;
  } else {
    // API key — query param
    url += `&key=${token}`;
  }

  const apiResponse = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ systemInstruction, contents }),
  });

  if (!apiResponse.ok) return apiResponse;

  // Transform Gemini SSE into normalized { text } / { usage } format
  const transformed = new ReadableStream({
    async start(controller) {
      const reader = apiResponse.body.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const parsed = parseGeminiSSEChunk(JSON.parse(line.slice(6)), model);
              if (parsed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
            } catch {}
          }
        }
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return new Response(transformed, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

// --- Single provider call ---

async function callSingleProvider(entry, { system, messages }) {
  const { providerId, model, endpoint, connection } = entry;
  const p = PROVIDERS[providerId];

  // Browser-direct: Gemini with a connection token bypasses server proxy entirely
  if (providerId === 'gemini' && connection?.access_token) {
    return callGeminiBrowser(model, system, messages, connection);
  }

  // Anthropic-compatible endpoints get structured blocks; others get flat string
  const isAnthropicEndpoint = endpoint === '/api/chat';
  const systemPayload = (isAnthropicEndpoint && system?.blocks) ? system.blocks : flatSystem(system);
  const body = { messages, system: systemPayload, model };

  if (providerId === 'anthropic') {
    body.api_key = connection.access_token;
  } else if (p?.auth === 'local') {
    // Local providers (Ollama, LM Studio, custom) — read URL override from connection scopes
    let meta = {};
    try { if (connection?.scopes) meta = JSON.parse(connection.scopes); } catch {}
    body.base_url = meta.baseUrl || p.apiBase;
    if (connection?.access_token) body.api_key = connection.access_token;
  } else if (p?.apiBase) {
    // OpenAI-compatible (Groq, OpenAI, Grok, DeepSeek, etc.)
    body.api_key = connection.access_token;
    body.base_url = p.apiBase;
  }
  // thinkdone: no extra auth fields — server uses env key

  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// --- Fallback chain: try each provider, skip on 429/503 ---

export async function callWithFallback(chain, { system, messages }) {
  let lastError = null;
  for (const entry of chain) {
    try {
      const response = await callSingleProvider(entry, { system, messages });
      if (response.ok) return { response, provider: entry };
      if (response.status === 429 || response.status === 503) {
        lastError = { status: response.status, provider: entry.providerId };
        continue;
      }
      return { response, provider: entry };
    } catch (err) {
      lastError = { error: err.message, provider: entry.providerId };
    }
  }
  throw new Error(`All providers failed: ${JSON.stringify(lastError)}`);
}

// --- Legacy single-provider call (backward compat) ---

export async function callProvider(provider, { system, messages, model, accessToken }) {
  if (provider === 'gemini') {
    const token = await ensureFreshToken(accessToken);
    return fetch('/api/chat/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, system, model, access_token: token }),
    });
  }
  return fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, system, model }),
  });
}
