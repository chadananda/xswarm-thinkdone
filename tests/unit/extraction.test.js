import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/test-db.js';
import { ensureSchema, seedPersonality } from '../../src/lib/db.js';
import {
  processExtractions, persistConversation, carryOverDeferred, extractFromTranscript,
  snapshotConversation, ensureExtractions, persistResolutions,
} from '../../src/lib/extraction.js';
import { getTasks } from '../../src/lib/db.js';
//
let db;
beforeEach(async () => {
  db = await createTestDb();
  await ensureSchema(db);
  await seedPersonality(db);
});
//
describe('processExtractions', () => {
  it('creates tasks with correct fields and date', async () => {
    const extractions = {
      tasks: [{ text: 'Send curriculum draft ~30m — drbi', deadline: '2026-02-15' }],
    };
    const result = await processExtractions(db, extractions);
    assert.equal(result.tasks.length, 1);
    const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(result.tasks[0]));
    assert.equal(task.text, 'Send curriculum draft ~30m — drbi');
    assert.equal(task.plan_date, '2026-02-15');
    assert.equal(task.source, 'meeting');
  });
  //
  it('normalizes garbage deadline to today', async () => {
    const extractions = {
      tasks: [{ text: 'Buy groceries after work', deadline: 'today-after-work' }],
    };
    const result = await processExtractions(db, extractions);
    const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(result.tasks[0]));
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(task.plan_date, today, 'garbage deadline should default to today');
  });
  //
  it('stores decision memories', async () => {
    const extractions = {
      decisions: [{ content: 'Focus on Templeton grant', project: 'drbi' }],
    };
    const result = await processExtractions(db, extractions);
    assert.equal(result.memories.length, 1);
    const mem = await db.prepare('SELECT * FROM memories WHERE id = ?').get(result.memories[0]);
    assert.equal(mem.type, 'decision');
    assert.equal(mem.project, 'drbi');
    assert.equal(mem.source, 'conversation');
  });
});
//
describe('persistConversation', () => {
  it('inserts conversation with correct fields', async () => {
    const session = {
      type: 'morning_meeting',
      startedAt: '2026-02-10T09:00:00.000Z',
      endedAt: '2026-02-10T09:20:00.000Z',
      messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }],
      agenda: [{ status: 'resolved', content: 'Review priorities', resolution: 'Focus on grant' }],
      keyDecisions: ['Focus on Templeton grant'],
      mood: 'productive',
      memoriesCreated: [1, 2, 3],
    };
    const id = await persistConversation(db, session);
    assert.ok(id > 0);
    const row = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    assert.equal(row.session_type, 'morning_meeting');
    assert.ok(row.summary.includes('2 turns'));
    assert.deepEqual(JSON.parse(row.key_decisions), ['Focus on Templeton grant']);
  });
  //
  it('closes an existing snapshot row', async () => {
    const session = {
      type: 'morning_meeting',
      startedAt: '2026-02-10T09:00:00.000Z',
      messages: [{ role: 'user', content: 'Hi' }],
      agenda: [],
    };
    await snapshotConversation(db, session);
    const snapshotId = session._convId;
    session.endedAt = '2026-02-10T09:20:00.000Z';
    const id = await persistConversation(db, session);
    assert.equal(id, snapshotId);
    const row = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    assert.ok(row.ended_at);
  });
});
//
describe('snapshotConversation', () => {
  it('creates a new row on first call', async () => {
    const session = {
      type: 'morning_meeting',
      startedAt: new Date().toISOString(),
      messages: [{ role: 'user', content: 'Hi' }],
      agenda: [{ status: 'pending', content: 'Plan' }],
    };
    await snapshotConversation(db, session);
    assert.ok(session._convId);
    const row = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(session._convId);
    assert.equal(row.ended_at, null);
  });
  //
  it('updates the same row on subsequent calls', async () => {
    const session = {
      type: 'morning_meeting',
      startedAt: new Date().toISOString(),
      messages: [{ role: 'user', content: 'Hi' }],
      agenda: [{ status: 'pending', content: 'Plan' }],
    };
    await snapshotConversation(db, session);
    const firstId = session._convId;
    session.messages.push({ role: 'assistant', content: 'Hello!' });
    await snapshotConversation(db, session);
    assert.equal(session._convId, firstId);
  });

  it('persists messages, agenda, and state to DB', async () => {
    const session = {
      type: 'morning_meeting',
      startedAt: new Date().toISOString(),
      state: 'AGENDA_LOOP',
      messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello!' }],
      agenda: [
        { status: 'resolved', content: 'Review priorities', resolution: 'Focus on grant' },
        { status: 'pending', content: 'Plan sprint' },
      ],
    };
    await snapshotConversation(db, session);
    const row = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(session._convId);
    assert.equal(row.state, 'AGENDA_LOOP');
    const msgs = JSON.parse(row.messages);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].content, 'Hi');
    const agenda = JSON.parse(row.agenda);
    assert.equal(agenda.length, 2);
    assert.equal(agenda[0].status, 'resolved');
  });

  it('updates messages/agenda/state on subsequent snapshots', async () => {
    const session = {
      type: 'morning_meeting',
      startedAt: new Date().toISOString(),
      state: 'OPENING',
      messages: [{ role: 'user', content: 'Hi' }],
      agenda: [{ status: 'pending', content: 'Plan' }],
    };
    await snapshotConversation(db, session);
    // Advance state
    session.state = 'AGENDA_LOOP';
    session.messages.push({ role: 'assistant', content: 'Hello!' });
    session.agenda[0].status = 'resolved';
    await snapshotConversation(db, session);
    const row = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(session._convId);
    assert.equal(row.state, 'AGENDA_LOOP');
    assert.equal(JSON.parse(row.messages).length, 2);
    assert.equal(JSON.parse(row.agenda)[0].status, 'resolved');
  });
});
//
describe('carryOverDeferred', () => {
  it('carries over deferred items as follow-up memories', async () => {
    const session = {
      agenda: [
        { id: 'item-1', status: 'deferred', content: 'Review pricing page', priority: 'normal' },
      ],
    };
    const carried = await carryOverDeferred(db, session);
    assert.equal(carried.length, 1);
    assert.equal(carried[0].content, 'Review pricing page');
    const mems = await db.prepare("SELECT * FROM memories WHERE type = 'follow_up'").all();
    assert.equal(mems.length, 1);
    assert.ok(mems[0].content.includes('Review pricing page'));
  });
  //
  it('flags items deferred 3+ times as pattern', async () => {
    await db.prepare(
      "INSERT INTO memories (content, type, source, priority, created_at) VALUES (?, 'pattern', 'conversation', 0, ?)"
    ).run('deferred:1x: Revisit backlog', new Date().toISOString());
    await db.prepare(
      "INSERT INTO memories (content, type, source, priority, created_at) VALUES (?, 'pattern', 'conversation', 0, ?)"
    ).run('deferred:2x: Revisit backlog', new Date().toISOString());
    const session = {
      agenda: [
        { id: 'item-1', status: 'deferred', content: 'Revisit backlog', priority: 'normal' },
      ],
    };
    const carried = await carryOverDeferred(db, session);
    assert.equal(carried[0].deferCount, 3);
    const patterns = await db.prepare("SELECT * FROM memories WHERE type = 'pattern' AND content LIKE '%3x%'").all();
    assert.equal(patterns.length, 1);
    assert.ok(patterns[0].content.includes('Consider breaking down or dropping'));
  });
});
//
describe('extractFromTranscript', () => {
  function geminiMock(xml) {
    return async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: xml }] } }] }),
    });
  }
  //
  it('parses tasks and decisions from Gemini response', async () => {
    const xml = `<meeting_state>
  <extractions>
    <task deadline="2026-02-15" project="drbi">Email John about the proposal</task>
    <decision project="thinkdone">Use Gemini for S2S meetings</decision>
  </extractions>
  <agenda_updates>
    <resolve id="item-1" resolution="Discussed"/>
  </agenda_updates>
  <next_item></next_item>
</meeting_state>`;
    const result = await extractFromTranscript(
      'We should email John about the proposal.',
      { apiKey: 'test-key', fetchFn: geminiMock(xml) }
    );
    assert.equal(result.extractions.tasks.length, 1);
    assert.equal(result.extractions.tasks[0].text, 'Email John about the proposal');
    assert.equal(result.extractions.decisions.length, 1);
    assert.equal(result.agendaUpdates.resolves.length, 1);
  });
  //
  it('returns empty on API error', async () => {
    const mockFetch = async () => ({ ok: false, status: 500, text: async () => 'Server error' });
    const result = await extractFromTranscript('some transcript', { apiKey: 'test-key', fetchFn: mockFetch });
    assert.equal(result.extractions.tasks.length, 0);
  });
  //
  it('returns empty on malformed response (no XML)', async () => {
    const result = await extractFromTranscript('some transcript', {
      apiKey: 'test-key',
      fetchFn: geminiMock('Just some text with no XML'),
    });
    assert.equal(result.extractions.tasks.length, 0);
  });
  //
  it('returns empty when no credentials and server proxy fails', async () => {
    const mockFetch = async () => { throw new Error('network'); };
    const result = await extractFromTranscript('add a task: buy groceries', { fetchFn: mockFetch });
    assert.equal(result.extractions.tasks.length, 0);
  });
});
//
describe('ensureExtractions', () => {
  function geminiMock(xml) {
    return async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: xml }] } }] }),
    });
  }
  //
  it('returns original when inline extractions exist', async () => {
    const result = {
      displayText: 'Got it, task added.',
      extractions: { tasks: [{ text: 'Call dentist' }], decisions: [], commitments: [], waitingFor: [], profiles: [] },
      agendaUpdates: { resolves: [], defers: [], adds: [] },
    };
    const out = await ensureExtractions(result, { apiKey: 'k', fetchFn: geminiMock('') });
    assert.equal(out.extractions.tasks[0].text, 'Call dentist');
  });
  //
  it('falls back to extraction API when no inline XML', async () => {
    const result = {
      displayText: 'Sure, I added a task to call the dentist before dinner.',
      extractions: { tasks: [], decisions: [], commitments: [], waitingFor: [], profiles: [] },
      agendaUpdates: { resolves: [], defers: [], adds: [] },
    };
    const xml = `<meeting_state><extractions><task deadline="" project="">Call dentist before dinner</task></extractions><agenda_updates></agenda_updates><next_item></next_item></meeting_state>`;
    const out = await ensureExtractions(result, { apiKey: 'k', fetchFn: geminiMock(xml) });
    assert.equal(out.extractions.tasks.length, 1);
    assert.equal(out.extractions.tasks[0].text, 'Call dentist before dinner');
  });
  //
  it('survives fallback API failure gracefully', async () => {
    const result = {
      displayText: 'Added a task for you.',
      extractions: { tasks: [], decisions: [], commitments: [], waitingFor: [], profiles: [] },
      agendaUpdates: { resolves: [], defers: [], adds: [] },
    };
    const failFetch = async () => { throw new Error('network'); };
    const out = await ensureExtractions(result, { apiKey: 'k', fetchFn: failFetch });
    assert.equal(out.extractions.tasks.length, 0);
  });
  //
  it('skips fallback when no text to extract from', async () => {
    let called = false;
    const spy = async () => { called = true; return { ok: true, json: async () => ({}) }; };
    const result = {
      displayText: '',
      extractions: { tasks: [], decisions: [], commitments: [], waitingFor: [], profiles: [] },
      agendaUpdates: { resolves: [], defers: [], adds: [] },
    };
    await ensureExtractions(result, { apiKey: 'k', fetchFn: spy });
    assert.equal(called, false);
  });
});
//
describe('persistResolutions', () => {
  it('stores resolved agenda Q+A as insight memory', async () => {
    const agenda = [
      { id: 'item-1', content: 'Major projects', question: 'What are your major projects?', status: 'pending' },
    ];
    const updates = { resolves: [{ id: 'item-1', resolution: 'ThinkDone and WholeReader' }], defers: [], adds: [] };
    const result = await persistResolutions(db, agenda, updates, 'morning_meeting');
    assert.equal(result.length, 1);
    const mem = await db.prepare('SELECT * FROM memories WHERE id = ?').get(result[0]);
    assert.equal(mem.type, 'insight');
    assert.ok(mem.content.includes('Major projects'));
    assert.ok(mem.content.includes('ThinkDone and WholeReader'));
  });
  //
  it('skips resolves without a resolution value', async () => {
    const agenda = [
      { id: 'item-1', content: 'Review tasks', question: 'Any updates?', status: 'pending' },
    ];
    const updates = { resolves: [{ id: 'item-1', resolution: '' }], defers: [], adds: [] };
    const result = await persistResolutions(db, agenda, updates, 'morning_meeting');
    assert.equal(result.length, 0);
  });
  //
  it('skips items without a question', async () => {
    const agenda = [
      { id: 'item-1', content: 'Active projects: foo, bar', status: 'pending' },
    ];
    const updates = { resolves: [{ id: 'item-1', resolution: 'Discussed' }], defers: [], adds: [] };
    const result = await persistResolutions(db, agenda, updates, 'morning_meeting');
    assert.equal(result.length, 0);
  });
  //
  it('updates personality.disposition for onboarding profile questions', async () => {
    const agenda = [
      { id: 'item-1', content: 'Your name', question: 'What do you wish me to call you?', status: 'pending' },
      { id: 'item-2', content: 'Name your assistant', question: 'What should you call me?', status: 'pending' },
    ];
    const updates = {
      resolves: [
        { id: 'item-1', resolution: 'Chad' },
        { id: 'item-2', resolution: 'Jafar' },
      ],
      defers: [], adds: [],
    };
    await persistResolutions(db, agenda, updates, 'onboarding');
    const row = await db.prepare('SELECT disposition FROM personality WHERE id = 1').get();
    const disp = JSON.parse(row.disposition);
    assert.equal(disp.user_name, 'Chad');
    assert.equal(disp.ai_name, 'Jafar');
  });
  //
  it('stores onboarding answers as memories too', async () => {
    const agenda = [
      { id: 'item-1', content: 'Work style and preferences', question: 'When do you like to plan?', status: 'pending' },
    ];
    const updates = { resolves: [{ id: 'item-1', resolution: 'Mornings, with coffee' }], defers: [], adds: [] };
    const result = await persistResolutions(db, agenda, updates, 'onboarding');
    assert.equal(result.length, 1);
    const mem = await db.prepare('SELECT * FROM memories WHERE id = ?').get(result[0]);
    assert.ok(mem.content.includes('Mornings, with coffee'));
  });
  //
  it('deduplicates — does not store same Q+A twice', async () => {
    const agenda = [
      { id: 'item-1', content: 'Daily habits', question: 'Any daily habits?', status: 'pending' },
    ];
    const updates = { resolves: [{ id: 'item-1', resolution: 'Exercise and reading' }], defers: [], adds: [] };
    await persistResolutions(db, agenda, updates, 'morning_meeting');
    await persistResolutions(db, agenda, updates, 'morning_meeting');
    const mems = await db.prepare("SELECT * FROM memories WHERE content LIKE '%Daily habits%'").all();
    assert.equal(mems.length, 1);
  });
});
//
describe('full pipeline: AI response → extraction → task in DB', () => {
  it('creates task from response without inline XML', async () => {
    const aiResponse = {
      displayText: 'Got it — I added "Call dentist before dinner" to your tasks for today.',
      extractions: { tasks: [], decisions: [], commitments: [], waitingFor: [], profiles: [] },
      agendaUpdates: { resolves: [], defers: [], adds: [] },
    };
    const xml = `<meeting_state><extractions><task deadline="" project="">Call dentist before dinner</task></extractions><agenda_updates></agenda_updates><next_item></next_item></meeting_state>`;
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: xml }] } }] }),
    });
    const result = await ensureExtractions(aiResponse, {
      apiKey: 'k',
      fetchFn: mockFetch,
      transcript: 'User: Please add a task to call the dentist before dinner.\n\nAssistant: Got it!',
    });
    assert.equal(result.extractions.tasks.length, 1);
    const created = await processExtractions(db, result.extractions);
    assert.equal(created.tasks.length, 1);
    const today = new Date().toISOString().slice(0, 10);
    const tasks = await getTasks(db, today);
    assert.equal(tasks.length, 1);
    assert.ok(tasks[0].text.includes('dentist'));
  });
});
