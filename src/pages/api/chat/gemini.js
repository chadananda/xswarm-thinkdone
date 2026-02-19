// Gemini SSE proxy — mirrors chat.js structure for Google AI
// Receives translated messages from browser, streams to Gemini API
import { translateToGeminiFormat, parseGeminiSSEChunk } from '../../../lib/provider.js';
//
export async function POST({ request }) {
  const { messages, system, model, access_token, api_key } = await request.json();
  if (!access_token && !api_key) {
    return new Response(JSON.stringify({ error: 'Missing access_token or api_key' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  //
  const geminiModel = model || 'gemini-2.0-flash';
  const { systemInstruction, contents } = translateToGeminiFormat(system, messages);
  // API key auth uses ?key= query param; OAuth uses Bearer header
  let url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?alt=sse`;
  const headers = { 'Content-Type': 'application/json' };
  if (api_key) {
    url += `&key=${encodeURIComponent(api_key)}`;
  } else {
    headers['Authorization'] = `Bearer ${access_token}`;
  }
  //
  const upstream = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      systemInstruction,
      contents,
      generationConfig: { maxOutputTokens: 4096 },
    }),
  });
  //
  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => 'Unknown error');
    const status = upstream.status === 429 ? 429 : upstream.status;
    return new Response(JSON.stringify({ error: `Gemini API error (${status}): ${errText}` }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  //
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  let buffer = '';
  //
  const readable = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === '[DONE]') continue;
            try {
              const parsed = JSON.parse(raw);
              const chunk = parseGeminiSSEChunk(parsed, geminiModel);
              if (chunk) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              }
            } catch {}
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (err) {
        const errData = JSON.stringify({ error: err.message });
        controller.enqueue(encoder.encode(`data: ${errData}\n\n`));
        controller.close();
      }
    },
  });
  //
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
