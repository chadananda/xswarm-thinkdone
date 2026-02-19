// Non-streaming extraction endpoint — POST transcript → JSON extraction result
// Used as fallback when no Gemini credentials for client-side extraction
import Anthropic from '@anthropic-ai/sdk';

export async function POST({ request }) {
  const { transcript, agenda, meetingType } = await request.json();
  if (!transcript) {
    return new Response(JSON.stringify({ error: 'No transcript' }), { status: 400 });
  }

  const agendaContext = agenda?.length
    ? '\n\nCurrent agenda items:\n' + agenda.map(a => `- [${a.id}] (${a.status}): ${a.content}`).join('\n')
    : '';

  const systemPrompt = `You are a meeting extraction assistant. Analyze the following planning conversation and extract structured data.

## What to Extract
- **Tasks**: Any action item, to-do, or thing the user wants to do or was told to add. Include tasks mentioned explicitly ("add a task") AND tasks implied by discussion ("I need to call the dentist").
- **Decisions**: Conclusions reached during discussion.
- **Commitments**: Promises made to specific people.
- **Waiting for**: Things the user is waiting on from others.
${agendaContext}

## Output Format
Respond with ONLY a <meeting_state> XML block:
<meeting_state>
  <extractions>
    <task deadline="" project="">description</task>
    <decision project="">what was decided</decision>
    <commitment to="" deadline="">what was promised</commitment>
    <waiting_for from="" due="">what you're waiting for</waiting_for>
  </extractions>
  <agenda_updates>
    <resolve id="" resolution=""/>
    <defer id=""/>
    <add type="" priority="" content=""/>
  </agenda_updates>
  <next_item></next_item>
</meeting_state>

Only include tags for items actually found. If nothing to extract, return empty tags.`;

  try {
    const client = new Anthropic({
      apiKey: import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
    });

    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      system: systemPrompt,
      messages: [{ role: 'user', content: transcript }],
      max_tokens: 1024,
    });

    const text = msg.content?.[0]?.text || '';
    return new Response(JSON.stringify({ text }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
