import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/test-db.js';
import { ensureSchema, seedPersonality, storeMemory } from '../../src/lib/db.js';
import { generateOnboardingAgenda } from '../../src/lib/agenda.js';
import { parseMeetingState, createSession, initializeSession, transitionState } from '../../src/lib/conversation.js';
import {
  processOnboardingExtractions, persistOnboardingSummary,
} from '../../src/lib/extraction.js';
//
let db;
beforeEach(async () => {
  db = await createTestDb();
  await ensureSchema(db);
  await seedPersonality(db);
});
//
// --- generateOnboardingAgenda ---
describe('generateOnboardingAgenda', () => {
  it('returns 6 agenda items', () => {
    const agenda = generateOnboardingAgenda();
    assert.equal(agenda.length, 6);
  });
  //
  it('has correct types and priorities in order', () => {
    const agenda = generateOnboardingAgenda();
    assert.equal(agenda[0].type, 'INFORM');
    assert.equal(agenda[0].priority, 'critical');
    assert.equal(agenda[1].type, 'DECIDE');
    assert.equal(agenda[1].priority, 'critical');
    assert.equal(agenda[2].type, 'DECIDE');
    assert.equal(agenda[2].priority, 'high');
    assert.equal(agenda[3].type, 'FOLLOW-UP');
    assert.equal(agenda[3].priority, 'normal');
    assert.equal(agenda[4].type, 'PLAN');
    assert.equal(agenda[4].priority, 'normal');
    assert.equal(agenda[5].type, 'REFLECT');
    assert.equal(agenda[5].priority, 'low');
  });
  //
  it('includes AI naming step', () => {
    const agenda = generateOnboardingAgenda();
    assert.ok(agenda.some(a => a.content.includes('Name your assistant')));
  });
  //
  it('each item has content and question', () => {
    const agenda = generateOnboardingAgenda();
    for (const item of agenda) {
      assert.ok(item.content, `item ${item.id} missing content`);
      assert.ok(item.question, `item ${item.id} missing question`);
      assert.equal(item.status, 'pending');
    }
  });
});
//
// --- parseMeetingState — profile extraction ---
describe('parseMeetingState profile extraction', () => {
  it('extracts profile fields from response', () => {
    const response = `Great to meet you, Chad!
<meeting_state>
  <extractions>
    <profile field="user_name">Chad</profile>
    <profile field="preferred_name">Chad</profile>
    <profile field="timezone">US/Pacific</profile>
  </extractions>
</meeting_state>`;
    const result = parseMeetingState(response);
    assert.equal(result.extractions.profiles.length, 3);
    assert.deepEqual(result.extractions.profiles[0], { field: 'user_name', value: 'Chad' });
    assert.deepEqual(result.extractions.profiles[1], { field: 'preferred_name', value: 'Chad' });
    assert.deepEqual(result.extractions.profiles[2], { field: 'timezone', value: 'US/Pacific' });
  });
  //
  it('extracts profiles alongside standard tags', () => {
    const response = `Got it! I'll track that.
<meeting_state>
  <extractions>
    <profile field="role">Entrepreneur</profile>
    <task deadline="" project="thinkdone">Set up ThinkDone onboarding</task>
    <decision project="">Focus on product first</decision>
  </extractions>
</meeting_state>`;
    const result = parseMeetingState(response);
    assert.equal(result.extractions.profiles.length, 1);
    assert.equal(result.extractions.profiles[0].field, 'role');
    assert.equal(result.extractions.tasks.length, 1);
    assert.equal(result.extractions.decisions.length, 1);
  });
  //
  it('returns empty profiles array when none present', () => {
    const response = `Hello!
<meeting_state>
  <extractions>
    <task deadline="" project="">Do something</task>
  </extractions>
</meeting_state>`;
    const result = parseMeetingState(response);
    assert.deepEqual(result.extractions.profiles, []);
  });
  //
  it('strips meeting_state from display text', () => {
    const response = `Nice to meet you!
<meeting_state>
  <extractions>
    <profile field="user_name">Chad</profile>
  </extractions>
</meeting_state>`;
    const result = parseMeetingState(response);
    assert.equal(result.displayText, 'Nice to meet you!');
  });
});
//
// --- processOnboardingExtractions ---
describe('processOnboardingExtractions', () => {
  it('stores profile fields in disposition JSON', async () => {
    const extractions = {
      profiles: [
        { field: 'user_name', value: 'Chad' },
        { field: 'timezone', value: 'US/Pacific' },
      ],
      tasks: [],
      decisions: [],
      commitments: [],
      waitingFor: [],
    };
    await processOnboardingExtractions(db, extractions);
    const row = await db.prepare('SELECT disposition FROM personality WHERE id = 1').get();
    const disp = JSON.parse(row.disposition);
    assert.equal(disp.user_name, 'Chad');
    assert.equal(disp.timezone, 'US/Pacific');
  });
  //
  it('merges profile fields with existing disposition', async () => {
    // Pre-set some disposition
    await db.prepare("UPDATE personality SET disposition = ? WHERE id = 1").run(
      JSON.stringify({ energy: 'high' })
    );
    const extractions = {
      profiles: [{ field: 'user_name', value: 'Chad' }],
      tasks: [],
      decisions: [],
      commitments: [],
      waitingFor: [],
    };
    await processOnboardingExtractions(db, extractions);
    const row = await db.prepare('SELECT disposition FROM personality WHERE id = 1').get();
    const disp = JSON.parse(row.disposition);
    assert.equal(disp.energy, 'high');
    assert.equal(disp.user_name, 'Chad');
  });
  //
  it('processes standard extractions alongside profiles', async () => {
    const extractions = {
      profiles: [{ field: 'role', value: 'Engineer' }],
      tasks: [{ text: 'Set up project' }],
      decisions: [{ content: 'Use React', project: 'webapp' }],
      commitments: [],
      waitingFor: [],
    };
    const result = await processOnboardingExtractions(db, extractions);
    assert.equal(result.tasks.length, 1);
    assert.equal(result.memories.length, 1);
    // Verify profile stored
    const row = await db.prepare('SELECT disposition FROM personality WHERE id = 1').get();
    const disp = JSON.parse(row.disposition);
    assert.equal(disp.role, 'Engineer');
  });
  //
  it('handles empty profiles gracefully', async () => {
    const extractions = {
      profiles: [],
      tasks: [],
      decisions: [],
      commitments: [],
      waitingFor: [],
    };
    const result = await processOnboardingExtractions(db, extractions);
    assert.deepEqual(result, { tasks: [], memories: [] });
  });
});
//
// --- persistOnboardingSummary ---
describe('persistOnboardingSummary', () => {
  it('persists conversation and stores summary memory', async () => {
    const session = {
      type: 'onboarding',
      startedAt: '2026-02-10T09:00:00.000Z',
      endedAt: '2026-02-10T09:20:00.000Z',
      agenda: [],
    };
    const id = await persistOnboardingSummary(db, session);
    assert.ok(id > 0);
    // Verify conversation row
    const row = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    assert.equal(row.session_type, 'onboarding');
    // Verify summary memory was stored
    const mem = await db.prepare("SELECT * FROM memories WHERE content LIKE '%Onboarding completed%'").get();
    assert.ok(mem);
    assert.equal(mem.type, 'status');
    assert.equal(mem.source, 'conversation');
  });
});
//
// --- First-time detection ---
describe('first-time detection', () => {
  it('returns true when conversations table is empty', async () => {
    const row = await db.prepare('SELECT COUNT(*) as cnt FROM conversations').get();
    assert.equal(row.cnt, 0);
  });
  //
  it('returns false when conversations exist', async () => {
    await db.prepare(
      "INSERT INTO conversations (session_type, started_at) VALUES ('onboarding', ?)"
    ).run(new Date().toISOString());
    const row = await db.prepare('SELECT COUNT(*) as cnt FROM conversations').get();
    assert.ok(row.cnt > 0);
  });
});
//
// --- Onboarding session state machine ---
describe('onboarding session state machine', () => {
  it('creates onboarding session and transitions through states', () => {
    const session = createSession('onboarding');
    assert.equal(session.type, 'onboarding');
    assert.equal(session.state, 'INITIALIZING');
    // Simulate agenda ready
    transitionState(session, 'agenda_ready');
    assert.equal(session.state, 'OPENING');
    // Simulate user message
    transitionState(session, 'user_message');
    assert.equal(session.state, 'AGENDA_LOOP');
  });
  //
  it('resolving all agenda items reaches OPEN_FLOOR', () => {
    const agenda = generateOnboardingAgenda();
    const session = createSession('onboarding');
    session.agenda = agenda;
    transitionState(session, 'agenda_ready');
    transitionState(session, 'user_message');
    // Resolve all items
    for (const item of agenda) {
      item.status = 'resolved';
    }
    transitionState(session, 'turn_complete');
    assert.equal(session.state, 'OPEN_FLOOR');
  });
  //
  it('initializes with onboarding agenda via initializeSession', async () => {
    const session = createSession('onboarding');
    await initializeSession(session, db, () => generateOnboardingAgenda());
    assert.equal(session.state, 'OPENING');
    assert.equal(session.agenda.length, 6);
  });
});
//
// --- Onboarding meeting rules ---
describe('onboarding meeting rules', () => {
  it('getMeetingRules returns onboarding rules for onboarding type', async () => {
    const session = createSession('onboarding');
    session.agenda = generateOnboardingAgenda();
    // assembleSystemPrompt includes meeting rules — just verify it runs
    const result = await (await import('../../src/lib/conversation.js')).assembleSystemPrompt(session, db);
    assert.ok(result.flat.includes('Onboarding Interview'));
    assert.ok(result.flat.includes('<profile'));
  });
});
