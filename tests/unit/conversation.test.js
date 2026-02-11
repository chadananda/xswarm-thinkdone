import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSession, transitionState, parseMeetingState, assembleSystemPrompt,
} from '../../src/lib/conversation.js';
import { createTestDb } from '../helpers/test-db.js';
import { ensureSchema, storeMemory, seedPersonality } from '../../src/lib/db.js';

let db;
beforeEach(async () => {
  db = await createTestDb();
  await ensureSchema(db);
  await seedPersonality(db);
});

describe('createSession', () => {
  it('creates a session with correct defaults', () => {
    const s = createSession('morning_meeting');
    assert.equal(s.type, 'morning_meeting');
    assert.equal(s.state, 'INITIALIZING');
    assert.ok(Array.isArray(s.agenda));
    assert.ok(Array.isArray(s.messages));
    assert.equal(s.summary, null);
    assert.ok(s.id);
  });

  it('supports different session types', () => {
    for (const type of ['morning_meeting', 'check_in', 'evening_review', 'weekly_review', 'strategic']) {
      const s = createSession(type);
      assert.equal(s.type, type);
    }
  });
});

describe('transitionState', () => {
  it('INITIALIZING → OPENING on agenda_ready', () => {
    const s = createSession('morning_meeting');
    transitionState(s, 'agenda_ready');
    assert.equal(s.state, 'OPENING');
  });

  it('OPENING → AGENDA_LOOP on user_message', () => {
    const s = createSession('morning_meeting');
    s.state = 'OPENING';
    transitionState(s, 'user_message');
    assert.equal(s.state, 'AGENDA_LOOP');
  });

  it('AGENDA_LOOP → AGENDA_LOOP when agenda has pending items', () => {
    const s = createSession('morning_meeting');
    s.state = 'AGENDA_LOOP';
    s.agenda = [{ id: '1', status: 'pending' }];
    transitionState(s, 'turn_complete');
    assert.equal(s.state, 'AGENDA_LOOP');
  });

  it('AGENDA_LOOP → OPEN_FLOOR when agenda is empty', () => {
    const s = createSession('morning_meeting');
    s.state = 'AGENDA_LOOP';
    s.agenda = [{ id: '1', status: 'resolved' }];
    transitionState(s, 'turn_complete');
    assert.equal(s.state, 'OPEN_FLOOR');
  });

  it('OPEN_FLOOR → AGENDA_LOOP on new_items', () => {
    const s = createSession('morning_meeting');
    s.state = 'OPEN_FLOOR';
    transitionState(s, 'new_items');
    assert.equal(s.state, 'AGENDA_LOOP');
  });

  it('OPEN_FLOOR → CLOSING on user_done', () => {
    const s = createSession('morning_meeting');
    s.state = 'OPEN_FLOOR';
    transitionState(s, 'user_done');
    assert.equal(s.state, 'CLOSING');
  });

  it('any state → PAUSED on timeout', () => {
    for (const state of ['OPENING', 'AGENDA_LOOP', 'OPEN_FLOOR']) {
      const s = createSession('morning_meeting');
      s.state = state;
      transitionState(s, 'timeout');
      assert.equal(s.state, 'PAUSED');
    }
  });

  it('PAUSED → AGENDA_LOOP on resume', () => {
    const s = createSession('morning_meeting');
    s.state = 'PAUSED';
    s.agenda = [{ id: '1', status: 'pending' }];
    transitionState(s, 'resume');
    assert.equal(s.state, 'AGENDA_LOOP');
  });

  it('PAUSED → CLOSING on quick_summary', () => {
    const s = createSession('morning_meeting');
    s.state = 'PAUSED';
    transitionState(s, 'quick_summary');
    assert.equal(s.state, 'CLOSING');
  });
});

describe('parseMeetingState', () => {
  it('extracts display text and strips meeting_state XML', () => {
    const response = `Great, let's focus on that grant.

<meeting_state>
  <extractions>
    <task deadline="2026-02-15" project="drbi">Send curriculum draft</task>
    <decision project="drbi">Focus on Templeton grant</decision>
  </extractions>
  <agenda_updates>
    <resolve id="item-1" resolution="Committed to Thursday"/>
  </agenda_updates>
  <next_item>item-2</next_item>
</meeting_state>`;

    const result = parseMeetingState(response);
    assert.equal(result.displayText.trim(), "Great, let's focus on that grant.");
    assert.ok(!result.displayText.includes('<meeting_state>'));
  });

  it('extracts tasks', () => {
    const response = `Done.<meeting_state><extractions><task deadline="2026-02-15" project="drbi">Send curriculum draft</task></extractions><agenda_updates></agenda_updates><next_item></next_item></meeting_state>`;
    const result = parseMeetingState(response);
    assert.equal(result.extractions.tasks.length, 1);
    assert.equal(result.extractions.tasks[0].text, 'Send curriculum draft');
    assert.equal(result.extractions.tasks[0].project, 'drbi');
    assert.equal(result.extractions.tasks[0].deadline, '2026-02-15');
  });

  it('extracts decisions', () => {
    const response = `OK.<meeting_state><extractions><decision project="drbi">Focus on Templeton</decision></extractions><agenda_updates></agenda_updates><next_item></next_item></meeting_state>`;
    const result = parseMeetingState(response);
    assert.equal(result.extractions.decisions.length, 1);
    assert.equal(result.extractions.decisions[0].content, 'Focus on Templeton');
  });

  it('extracts commitments', () => {
    const response = `Tracked.<meeting_state><extractions><commitment to="Gilbert" deadline="2026-02-13">Pricing page</commitment></extractions><agenda_updates></agenda_updates><next_item></next_item></meeting_state>`;
    const result = parseMeetingState(response);
    assert.equal(result.extractions.commitments.length, 1);
    assert.equal(result.extractions.commitments[0].to, 'Gilbert');
  });

  it('extracts waiting_for', () => {
    const response = `Noted.<meeting_state><extractions><waiting_for from="Riazati" due="2026-02-03">Tablet schema</waiting_for></extractions><agenda_updates></agenda_updates><next_item></next_item></meeting_state>`;
    const result = parseMeetingState(response);
    assert.equal(result.extractions.waitingFor.length, 1);
    assert.equal(result.extractions.waitingFor[0].from, 'Riazati');
  });

  it('extracts agenda updates', () => {
    const response = `Moving on.<meeting_state><extractions></extractions><agenda_updates><resolve id="item-3" resolution="Committed to Thursday"/><defer id="item-5"/><add type="FOLLOW-UP" priority="high" content="Check eligibility"/></agenda_updates><next_item>item-4</next_item></meeting_state>`;
    const result = parseMeetingState(response);
    assert.equal(result.agendaUpdates.resolves.length, 1);
    assert.equal(result.agendaUpdates.resolves[0].id, 'item-3');
    assert.equal(result.agendaUpdates.defers.length, 1);
    assert.equal(result.agendaUpdates.defers[0].id, 'item-5');
    assert.equal(result.agendaUpdates.adds.length, 1);
    assert.equal(result.agendaUpdates.adds[0].type, 'FOLLOW-UP');
    assert.equal(result.nextItem, 'item-4');
  });

  it('handles response with no meeting_state block', () => {
    const response = 'Just a simple response with no XML.';
    const result = parseMeetingState(response);
    assert.equal(result.displayText, response);
    assert.equal(result.extractions.tasks.length, 0);
    assert.equal(result.agendaUpdates.resolves.length, 0);
    assert.equal(result.nextItem, null);
  });
});

describe('assembleSystemPrompt', () => {
  it('returns { blocks, flat } object', async () => {
    const session = createSession('morning_meeting');
    session.state = 'OPENING';
    const result = await assembleSystemPrompt(session, db);
    assert.ok(result.blocks, 'Should have blocks array');
    assert.ok(Array.isArray(result.blocks), 'blocks should be an array');
    assert.ok(typeof result.flat === 'string', 'flat should be a string');
  });

  it('blocks are TextBlockParam format with type and text', async () => {
    const session = createSession('morning_meeting');
    session.state = 'OPENING';
    const result = await assembleSystemPrompt(session, db);
    for (const block of result.blocks) {
      assert.equal(block.type, 'text', 'Each block should have type "text"');
      assert.ok(typeof block.text === 'string', 'Each block should have text string');
    }
  });

  it('first 2 blocks have cache_control ephemeral', async () => {
    const session = createSession('morning_meeting');
    session.state = 'OPENING';
    const result = await assembleSystemPrompt(session, db);
    // Block 1: SOUL, Block 2: meeting rules — both should be cached
    assert.ok(result.blocks.length >= 2, 'Should have at least 2 blocks');
    assert.deepEqual(result.blocks[0].cache_control, { type: 'ephemeral' }, 'SOUL block should be cached');
    assert.deepEqual(result.blocks[1].cache_control, { type: 'ephemeral' }, 'Meeting rules block should be cached');
  });

  it('last block (turn context) has no cache_control when present', async () => {
    const session = createSession('morning_meeting');
    session.state = 'AGENDA_LOOP';
    session.messages = [{ role: 'user', content: 'Hello' }];
    const result = await assembleSystemPrompt(session, db);
    const lastBlock = result.blocks[result.blocks.length - 1];
    // Turn context block should NOT have cache_control
    assert.equal(lastBlock.cache_control, undefined, 'Turn context block should not be cached');
  });

  it('layer order: SOUL first, meeting rules second', async () => {
    const session = createSession('morning_meeting');
    session.state = 'OPENING';
    const result = await assembleSystemPrompt(session, db);
    assert.ok(result.blocks[0].text.includes('Strategic Partner'), 'First block should be SOUL');
    assert.ok(result.blocks[1].text.includes('Morning Meeting') || result.blocks[1].text.includes('meeting_state'), 'Second block should be meeting rules');
  });

  it('flat string contains all text joined', async () => {
    const session = createSession('morning_meeting');
    session.state = 'OPENING';
    const result = await assembleSystemPrompt(session, db);
    assert.ok(result.flat.includes('Strategic Partner'), 'flat should include SOUL content');
    assert.ok(result.flat.includes('Morning Meeting') || result.flat.includes('ACKNOWLEDGE'), 'flat should include meeting rules');
  });

  it('includes memory context as cached block when available', async () => {
    await storeMemory(db, 'Server deployment blocked', { type: 'blocker', project: 'ocean' });
    const session = createSession('morning_meeting');
    session.state = 'AGENDA_LOOP';
    const result = await assembleSystemPrompt(session, db);
    const memBlock = result.blocks.find(b => b.text.includes('Server deployment blocked'));
    assert.ok(memBlock, 'Should have a memory context block');
    assert.deepEqual(memBlock.cache_control, { type: 'ephemeral' }, 'Memory block should be cached');
    assert.ok(result.flat.includes('Server deployment blocked'), 'flat should include memory context');
  });
});
