// Model discovery proxy — queries any OpenAI-compatible or Gemini provider for available models
// Browser can't hit these directly due to CORS, so we proxy the GET /models call

export async function POST({ request }) {
  const { base_url, api_key, provider } = await request.json();

  // Gemini uses a different models endpoint
  if (provider === 'gemini') {
    return fetchGeminiModels(api_key);
  }

  if (!base_url) {
    return new Response(JSON.stringify({ error: 'Missing base_url' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = `${base_url.replace(/\/$/, '')}/models`;
  const headers = {};
  if (api_key) headers['Authorization'] = `Bearer ${api_key}`;

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return new Response(JSON.stringify({ error: `${res.status}: ${errText.slice(0, 200)}` }), {
        status: res.status, headers: { 'Content-Type': 'application/json' },
      });
    }
    const data = await res.json();
    // OpenAI format: { data: [{ id, object, owned_by }] }
    const raw = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
    const models = raw.map(m => ({
      id: m.id || m.name?.replace('models/', '') || '',
      name: m.name || m.id || '',
      owned_by: m.owned_by || '',
    })).filter(m => m.id);

    return new Response(JSON.stringify({ models }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function fetchGeminiModels(apiKey) {
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Missing api_key for Gemini' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return new Response(JSON.stringify({ error: `${res.status}: ${errText.slice(0, 200)}` }), {
        status: res.status, headers: { 'Content-Type': 'application/json' },
      });
    }
    const data = await res.json();
    const models = (data.models || [])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => ({
        id: m.name?.replace('models/', '') || '',
        name: m.displayName || m.name || '',
        owned_by: 'google',
      }))
      .filter(m => m.id);
    return new Response(JSON.stringify({ models }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }
}
