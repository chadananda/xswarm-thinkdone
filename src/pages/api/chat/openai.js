// OpenAI-compatible SSE proxy — works with Groq, OpenAI, Grok, DeepSeek, etc.
// Receives messages from browser, translates to OpenAI format, streams back unified SSE
import { translateToOpenAIFormat, parseOpenAISSEChunk } from '../../../lib/provider.js';

export async function POST({ request }) {
  const { messages, system, model, api_key, base_url } = await request.json();
  if (!base_url) {
    return new Response(JSON.stringify({ error: 'Missing base_url' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const openaiMessages = translateToOpenAIFormat(system, messages);
  const url = `${base_url.replace(/\/$/, '')}/chat/completions`;

  const headers = { 'Content-Type': 'application/json' };
  if (api_key) headers['Authorization'] = `Bearer ${api_key}`;

  const upstream = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: model || 'gpt-4o',
      messages: openaiMessages,
      max_tokens: 4096,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => 'Unknown error');
    return new Response(JSON.stringify({ error: `API error (${upstream.status}): ${errText}` }), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  let buffer = '';

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
              const chunk = parseOpenAISSEChunk(parsed, model);
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

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
