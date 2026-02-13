// Meeting conversation engine — state machine, prompt assembly, extraction parsing
// Runs in the browser. Server is only a streaming proxy.

import { buildContext } from './memory-engine.js';
import { callProvider, callWithFallback } from './provider.js';

let _sessionCounter = 0;

// --- Session Lifecycle ---

export function createSession(type) {
  return {
    id: `session-${++_sessionCounter}-${Date.now()}`,
    type,
    state: 'INITIALIZING',
    agenda: [],
    messages: [],
    summary: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
  };
}

export async function initializeSession(session, db, generateAgenda) {
  if (generateAgenda) {
    session.agenda = await generateAgenda(db);
  }
  transitionState(session, 'agenda_ready');
  return session;
}

// --- State Machine ---

const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };

export function transitionState(session, event) {
  const { state } = session;

  switch (event) {
    case 'agenda_ready':
      if (state === 'INITIALIZING') session.state = 'OPENING';
      break;

    case 'user_message':
      if (state === 'OPENING') session.state = 'AGENDA_LOOP';
      break;

    case 'turn_complete': {
      if (state !== 'AGENDA_LOOP') break;
      const hasPending = session.agenda.some(
        a => a.status === 'pending' || a.status === 'active'
      );
      session.state = hasPending ? 'AGENDA_LOOP' : 'OPEN_FLOOR';
      break;
    }

    case 'new_items':
      if (state === 'OPEN_FLOOR') session.state = 'AGENDA_LOOP';
      break;

    case 'user_done':
      if (state === 'OPEN_FLOOR') session.state = 'CLOSING';
      break;

    case 'timeout':
      if (['OPENING', 'AGENDA_LOOP', 'OPEN_FLOOR'].includes(state)) {
        session.state = 'PAUSED';
      }
      break;

    case 'resume': {
      if (state !== 'PAUSED') break;
      const hasPendingItems = session.agenda.some(
        a => a.status === 'pending' || a.status === 'active'
      );
      session.state = hasPendingItems ? 'AGENDA_LOOP' : 'OPEN_FLOOR';
      break;
    }

    case 'quick_summary':
      if (state === 'PAUSED') session.state = 'CLOSING';
      break;

    case 'closed':
      session.state = 'CLOSED';
      session.endedAt = new Date().toISOString();
      break;
  }
}

// --- Prompt Assembly (4 blocks, stable → volatile for cache optimization) ---

export async function assembleSystemPrompt(session, db) {
  const blocks = [];

  // Block 1 — SOUL + calibration (most stable, changes rarely)
  let soulText = '';
  const personality = await db.prepare('SELECT soul, disposition FROM personality WHERE id = 1').get();
  if (personality) {
    soulText = personality.soul;
    if (personality.disposition) {
      try {
        const disp = JSON.parse(personality.disposition);
        soulText += '\n\n## Personality Calibration\n' + Object.entries(disp).map(([k, v]) => `- ${k}: ${v}`).join('\n');
      } catch {}
    }
  }
  if (soulText) {
    blocks.push({ type: 'text', text: soulText, cache_control: { type: 'ephemeral' } });
  }

  // Block 2 — Meeting type rules (stable per session type)
  blocks.push({ type: 'text', text: getMeetingRules(session.type), cache_control: { type: 'ephemeral' } });

  // Block 3 — Memory context (changes when memories added, but stable within a turn)
  const context = await buildContext(db, { maxTokens: 8000 });
  if (context.text) {
    blocks.push({ type: 'text', text: '\n## Current Context\n' + context.text, cache_control: { type: 'ephemeral' } });
  }

  // Block 4 — Turn context (volatile, changes every turn — no cache)
  const turnContext = buildTurnContext(session);
  if (turnContext) {
    blocks.push({ type: 'text', text: turnContext });
  }

  // Flat string for non-Anthropic providers
  const flat = blocks.map(b => b.text).join('\n\n---\n\n');

  return { blocks, flat };
}

export function getMeetingRules(type) {
  const rules = {
    morning_meeting: `# Morning Meeting Rules

You are running a morning planning meeting. Follow these rules precisely:

## Turn Structure
Every response follows: ACKNOWLEDGE → ACT → BRIDGE → PRESENT

## The One-Question Rule
NEVER ask two questions in the same message. End with exactly ONE question.

## Opening Turn
1. Brief greeting (time-aware)
2. One-two sentences of day context
3. The single most important thing or first agenda item
4. One question

## Conversation Rules
- Maximum 2 follow-ups per agenda item
- If user gives 3+ short answers in a row, compress remaining agenda into one confirmation turn
- When transitioning topics: use natural bridges, never "Item 3 of 8"
- Surface connections between topics when confidence is high
- Confirm extractions briefly: "Got it — pricing page to Gilbert by Thursday. Tracked."

## Extraction Format
After your conversational response, append a <meeting_state> block (the system strips this before display):
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
  <next_item>item-id-or-empty</next_item>
</meeting_state>

## Closing
When agenda is empty:
1. Brief summary of outcomes (2-4 sentences)
2. "That's my list. Anything on your mind?"
3. If user is done: brief send-off, one sentence`,

    check_in: `# Check-In Meeting Rules

You are running an ad-hoc check-in. The user is driving.

## Posture
Efficient, context-aware, responsive. No pre-set agenda.

## Behavior
- Build context dynamically from user's opening message
- Reference what was planned this morning if applicable
- Keep responses short — 1-3 sentences typically
- Extract tasks/decisions/status updates as they come up
- End with exactly ONE question if more context is needed

## Duration
Target: 1-5 minutes, 1-5 turns. Don't pad the conversation.

## Extraction Format
Same <meeting_state> format as morning meeting.`,

    evening_review: `# Evening Review Rules

You are running an evening review. Reflective, warm, celebratory of wins, gentle about misses.

## Behavior
- Compare morning plan to actual completions
- Celebrate wins genuinely but briefly
- For incomplete items: ask what happened, offer to reschedule
- Check habits completed vs. skipped
- Light prep for tomorrow (optional)
- Ask: "Anything happen today I should know about?"

## Extraction Format
Same <meeting_state> format.`,

    weekly_review: `# Weekly Review Rules

You are running a weekly review. Thorough, methodical, strategic.

## Six Phases
1. CAPTURE: "Dump everything floating in your head." Extract each item.
2. REVIEW PROJECTS: One question per active project. Still active? Next action?
3. REVIEW COMMITMENTS & WAITING-FOR: Status check on each.
4. HABIT REVIEW: Present weekly scorecard. Identify patterns.
5. LOOKING AHEAD: Next week's highlights, deadlines, events.
6. STRATEGIC REFLECTION: "Is your time going where it matters most?"

## Extraction Format
Same <meeting_state> format.`,

    onboarding: `# Onboarding Interview Rules

You are meeting a new user for the very first time. You don't have a name yet — the user will give you one. Be warm, curious, and efficient.

## Opening
Introduce what you do: "I'm your strategic planning partner — I help you plan your days, track projects, and stay on top of commitments. But first, let's get to know each other."
Then ask: "What should I call you?"

## Interview Flow
Walk through these topics one at a time, with max 2 follow-ups per topic:
1. **Their name** — "What should I call you?"
2. **Your name** — After learning their name, ask: "And what would you like to call me? Pick any name you'd like — I'll answer to it from now on."
3. **Projects & Goals** — "What are the main things you're working on right now?" Capture each as a project.
4. **People** — "Who are the key people you work with or are accountable to?" Capture names and relationships.
5. **Work Style** — "When do you like to plan your day? Morning, evening, or as-needed?" Capture preferences.
6. **Habits** — "Any regular habits, routines, or recurring meetings I should know about?" Capture each.

## The One-Question Rule
NEVER ask two questions in the same message. End with exactly ONE question.

## Name Handling
When the user gives you a name, USE IT IMMEDIATELY. Acknowledge it with personality — "I like it. [Name] it is." Then use that name naturally when referring to yourself going forward.
Store the user's name as <profile field="user_name"> and your own name as <profile field="ai_name">.

## Extraction Format
After your conversational response, append a <meeting_state> block:
<meeting_state>
  <extractions>
    <profile field="user_name">value</profile>
    <profile field="ai_name">value</profile>
    <profile field="preferred_name">value</profile>
    <profile field="timezone">value</profile>
    <profile field="role">value</profile>
    <profile field="planning_time">value</profile>
    <profile field="work_style">value</profile>
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
  <next_item>item-id-or-empty</next_item>
</meeting_state>

Use <profile> tags for identity data (name, timezone, role, preferences).
Use standard tags (task, decision, commitment) for projects, people, and action items.
Only emit profile tags when you actually learn new information — don't emit empty ones.

## Closing
When all topics are covered, give a brief summary of what you learned. Use your new name. Express excitement to start working together. Mention their first morning meeting will use everything you just learned.`,

    strategic: `# Strategic Session Rules

You are in a deep-dive strategic session. Collaborative, Socratic, probing.

## Phases
- Turns 1-3: UNDERSTAND — clarify what the user is figuring out
- Turns 4-6: SYNTHESIZE — present framework or options
- Turns 7+: REFINE and COMMIT — iterate, extract concrete next steps

## Behavior
- Ask probing questions to sharpen thinking
- Draw on memory and context aggressively
- Make connections the user hasn't made
- End with concrete actions

## Extraction Format
Same <meeting_state> format.`,
  };

  return rules[type] || rules.check_in;
}

export function stripExtractionFormat(rules) {
  // Remove ## Extraction Format section and everything until the next ## heading or end
  return rules.replace(/\n## Extraction Format[\s\S]*?(?=\n## |\s*$)/, '');
}

export async function assembleS2sSystemPrompt(session, db) {
  const blocks = [];
  // Block 1 — SOUL + calibration (same as assembleSystemPrompt)
  let soulText = '';
  const personality = await db.prepare('SELECT soul, disposition FROM personality WHERE id = 1').get();
  if (personality) {
    soulText = personality.soul;
    if (personality.disposition) {
      try {
        const disp = JSON.parse(personality.disposition);
        soulText += '\n\n## Personality Calibration\n' + Object.entries(disp).map(([k, v]) => `- ${k}: ${v}`).join('\n');
      } catch {}
    }
  }
  if (soulText) {
    blocks.push({ type: 'text', text: soulText, cache_control: { type: 'ephemeral' } });
  }
  // Block 2 — Meeting type rules WITHOUT extraction format (key difference)
  blocks.push({ type: 'text', text: stripExtractionFormat(getMeetingRules(session.type)), cache_control: { type: 'ephemeral' } });
  // Block 3 — Memory context
  const context = await buildContext(db, { maxTokens: 8000 });
  if (context.text) {
    blocks.push({ type: 'text', text: '\n## Current Context\n' + context.text, cache_control: { type: 'ephemeral' } });
  }
  // Block 4 — Turn context
  const turnContext = buildTurnContext(session);
  if (turnContext) {
    blocks.push({ type: 'text', text: turnContext });
  }
  const flat = blocks.map(b => b.text).join('\n\n---\n\n');
  return { blocks, flat };
}

function buildTurnContext(session) {
  const parts = [];

  // Current agenda state
  if (session.agenda.length) {
    const pending = session.agenda.filter(a => a.status === 'pending');
    const active = session.agenda.filter(a => a.status === 'active');
    const resolved = session.agenda.filter(a => a.status === 'resolved');

    parts.push('## Current Agenda');
    if (active.length) {
      parts.push('ACTIVE:\n' + active.map(a =>
        `  [${a.id}] ${a.type} (${a.priority}): ${a.content}${a.question ? '\n    Question: ' + a.question : ''}`
      ).join('\n'));
    }
    if (pending.length) {
      parts.push('PENDING:\n' + pending.map(a =>
        `  [${a.id}] ${a.type} (${a.priority}): ${a.content}`
      ).join('\n'));
    }
    if (resolved.length) {
      parts.push(`RESOLVED: ${resolved.length} items`);
    }
  }

  // Conversation summary (compressed after 5 turns)
  if (session.messages.length > 0) {
    const recent = session.messages.slice(-6);
    parts.push('## Recent Conversation');
    for (const msg of recent) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const text = msg.content.length > 200 ? msg.content.slice(0, 200) + '...' : msg.content;
      parts.push(`${role}: ${text}`);
    }
  }

  return parts.join('\n\n');
}

// --- AI-First Opening Turn ---

export async function deliverOpeningTurn(session, db, streamCallback, providerOpts = {}) {
  // Assemble prompt
  const systemPrompt = await assembleSystemPrompt(session, db);

  // No user messages — AI speaks first
  const claudeMessages = session.messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  let fullResponse = '';
  let usage = null;
  let usedProvider = null;
  try {
    let response;
    if (providerOpts.chain?.length) {
      const result = await callWithFallback(providerOpts.chain, {
        system: systemPrompt,
        messages: claudeMessages,
      });
      response = result.response;
      usedProvider = result.provider;
    } else {
      response = await callProvider(providerOpts.provider || 'claude', {
        system: systemPrompt,
        messages: claudeMessages,
        model: providerOpts.model,
        accessToken: providerOpts.accessToken,
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.text) {
              fullResponse += parsed.text;
              if (streamCallback) streamCallback(parsed.text);
            } else if (parsed.usage) {
              usage = parsed.usage;
            }
          } catch {}
        }
      }
    }
  } catch (err) {
    fullResponse = `Good morning! I'm having trouble connecting right now, but let's get started when the connection is restored.`;
    if (streamCallback) streamCallback(fullResponse);
  }

  // Parse meeting state
  const { displayText, extractions, agendaUpdates, nextItem } = parseMeetingState(fullResponse);

  // Store assistant message
  session.messages.push({ role: 'assistant', content: displayText });

  return { displayText, extractions, agendaUpdates, nextItem, usage, usedProvider };
}

// --- Main Loop ---

export async function processUserMessage(session, message, db, streamCallback, providerOpts = {}) {
  // Add user message
  session.messages.push({ role: 'user', content: message });

  // Transition state
  if (session.state === 'OPENING') {
    transitionState(session, 'user_message');
  }

  // Assemble prompt
  const systemPrompt = await assembleSystemPrompt(session, db);

  // Build messages array for Claude
  const claudeMessages = session.messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  // Call AI provider — use fallback chain if available, else legacy single provider
  let fullResponse = '';
  let usage = null;
  let usedProvider = null;
  try {
    let response;
    if (providerOpts.chain?.length) {
      const result = await callWithFallback(providerOpts.chain, {
        system: systemPrompt,
        messages: claudeMessages,
      });
      response = result.response;
      usedProvider = result.provider;
    } else {
      response = await callProvider(providerOpts.provider || 'claude', {
        system: systemPrompt,
        messages: claudeMessages,
        model: providerOpts.model,
        accessToken: providerOpts.accessToken,
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.text) {
              fullResponse += parsed.text;
              if (streamCallback) streamCallback(parsed.text);
            } else if (parsed.usage) {
              usage = parsed.usage;
            }
          } catch {}
        }
      }
    }
  } catch (err) {
    fullResponse = `I'm having trouble connecting right now. Let's continue when the connection is restored.`;
    if (streamCallback) streamCallback(fullResponse);
  }

  // Parse meeting state
  const { displayText, extractions, agendaUpdates, nextItem } = parseMeetingState(fullResponse);

  // Store assistant message (display text only)
  session.messages.push({ role: 'assistant', content: displayText });

  // Advance agenda based on state
  transitionState(session, 'turn_complete');

  return { displayText, extractions, agendaUpdates, nextItem, usage, usedProvider };
}

// --- Extraction Parsing ---

export function parseMeetingState(fullResponse) {
  const result = {
    displayText: fullResponse,
    extractions: { tasks: [], decisions: [], commitments: [], waitingFor: [], profiles: [] },
    agendaUpdates: { resolves: [], defers: [], adds: [] },
    nextItem: null,
  };

  // Extract and strip <meeting_state> block
  const stateMatch = fullResponse.match(/<meeting_state>([\s\S]*?)<\/meeting_state>/);
  if (!stateMatch) return result;

  result.displayText = fullResponse.replace(/<meeting_state>[\s\S]*?<\/meeting_state>/, '').trim();
  const xml = stateMatch[1];

  // Parse tasks
  const taskRe = /<task\s+([^>]*)>([\s\S]*?)<\/task>/g;
  let m;
  while ((m = taskRe.exec(xml))) {
    const attrs = parseAttrs(m[1]);
    result.extractions.tasks.push({
      text: m[2].trim(),
      deadline: attrs.deadline || '',
      project: attrs.project || '',
    });
  }

  // Parse decisions
  const decisionRe = /<decision\s+([^>]*)>([\s\S]*?)<\/decision>/g;
  while ((m = decisionRe.exec(xml))) {
    const attrs = parseAttrs(m[1]);
    result.extractions.decisions.push({
      content: m[2].trim(),
      project: attrs.project || '',
    });
  }

  // Parse commitments
  const commitRe = /<commitment\s+([^>]*)>([\s\S]*?)<\/commitment>/g;
  while ((m = commitRe.exec(xml))) {
    const attrs = parseAttrs(m[1]);
    result.extractions.commitments.push({
      content: m[2].trim(),
      to: attrs.to || '',
      deadline: attrs.deadline || '',
    });
  }

  // Parse waiting_for
  const waitRe = /<waiting_for\s+([^>]*)>([\s\S]*?)<\/waiting_for>/g;
  while ((m = waitRe.exec(xml))) {
    const attrs = parseAttrs(m[1]);
    result.extractions.waitingFor.push({
      content: m[2].trim(),
      from: attrs.from || '',
      due: attrs.due || '',
    });
  }

  // Parse profile fields
  const profileRe = /<profile\s+([^>]*)>([\s\S]*?)<\/profile>/g;
  while ((m = profileRe.exec(xml))) {
    const attrs = parseAttrs(m[1]);
    result.extractions.profiles.push({
      field: attrs.field || '',
      value: m[2].trim(),
    });
  }

  // Parse agenda updates
  const resolveRe = /<resolve\s+([^/>]*)\/?>/g;
  while ((m = resolveRe.exec(xml))) {
    const attrs = parseAttrs(m[1]);
    result.agendaUpdates.resolves.push({
      id: attrs.id || '',
      resolution: attrs.resolution || '',
    });
  }

  const deferRe = /<defer\s+([^/>]*)\/?>/g;
  while ((m = deferRe.exec(xml))) {
    const attrs = parseAttrs(m[1]);
    result.agendaUpdates.defers.push({ id: attrs.id || '' });
  }

  const addRe = /<add\s+([^/>]*)\/?>/g;
  while ((m = addRe.exec(xml))) {
    const attrs = parseAttrs(m[1]);
    result.agendaUpdates.adds.push({
      type: attrs.type || '',
      priority: attrs.priority || 'normal',
      content: attrs.content || '',
    });
  }

  // Parse next_item
  const nextMatch = xml.match(/<next_item>(.*?)<\/next_item>/);
  if (nextMatch && nextMatch[1].trim()) {
    result.nextItem = nextMatch[1].trim();
  }

  return result;
}

function parseAttrs(str) {
  const attrs = {};
  const re = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(str))) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}
