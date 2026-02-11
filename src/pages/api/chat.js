// Thin Claude API proxy — POST prompt → SSE stream
// All intelligence lives browser-side. This is just a relay.
import Anthropic from '@anthropic-ai/sdk';

export async function POST({ request }) {
  const { messages, system, model, api_key } = await request.json();

  const client = new Anthropic({
    apiKey: api_key || import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
  });

  const stream = client.messages.stream({
    model: model || 'claude-sonnet-4-5-20250929',
    system: system || undefined,
    messages,
    max_tokens: 4096,
  });

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta?.text) {
            const data = JSON.stringify({ text: event.delta.text });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
        }
        // Send token usage as final event before [DONE]
        try {
          const finalMsg = await stream.finalMessage();
          if (finalMsg?.usage) {
            const usageData = JSON.stringify({
              usage: {
                input_tokens: finalMsg.usage.input_tokens,
                output_tokens: finalMsg.usage.output_tokens,
                model: model || 'claude-sonnet-4-5-20250929',
                cache_creation_input_tokens: finalMsg.usage.cache_creation_input_tokens || 0,
                cache_read_input_tokens: finalMsg.usage.cache_read_input_tokens || 0,
              },
            });
            controller.enqueue(encoder.encode(`data: ${usageData}\n\n`));
          }
        } catch {}
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
