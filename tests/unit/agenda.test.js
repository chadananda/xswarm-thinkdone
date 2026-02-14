import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAgendaItem, resolveItem, deferItem, getNextItem,
  generateMorningAgenda, generateCheckInAgenda,
  applyAgendaUpdates,
} from '../../src/lib/agenda.js';
import { createTestDb } from '../helpers/test-db.js';
import { ensureSchema, storeMemory, addTask } from '../../src/lib/db.js';

let db;
beforeEach(async () => {
  db = await createTestDb();
  await ensureSchema(db);
});

describe('createAgendaItem', () => {
  it('creates an item with all fields', () => {
    const item = createAgendaItem('DECIDE', 'high', 'Focus on grant', 'Which grant?');
    assert.equal(item.type, 'DECIDE');
    assert.equal(item.priority, 'high');
    assert.equal(item.content, 'Focus on grant');
    assert.equal(item.question, 'Which grant?');
    assert.equal(item.status, 'pending');
    assert.ok(item.id);
  });
});

describe('resolveItem', () => {
  it('sets status to resolved with resolution text', () => {
    const agenda = [createAgendaItem('DECIDE', 'high', 'Grant focus', 'Which?')];
    resolveItem(agenda, agenda[0].id, 'Chose Templeton');
    assert.equal(agenda[0].status, 'resolved');
    assert.equal(agenda[0].resolution, 'Chose Templeton');
  });
});

describe('deferItem', () => {
  it('sets status to deferred and escalates priority', () => {
    const agenda = [createAgendaItem('FOLLOW-UP', 'normal', 'Check status', 'Update?')];
    deferItem(agenda, agenda[0].id);
    assert.equal(agenda[0].status, 'deferred');
    assert.equal(agenda[0].priority, 'high'); // normal → high
  });

  it('escalates high → critical', () => {
    const agenda = [createAgendaItem('FOLLOW-UP', 'high', 'Overdue item', 'Status?')];
    deferItem(agenda, agenda[0].id);
    assert.equal(agenda[0].priority, 'critical');
  });

  it('critical stays critical', () => {
    const agenda = [createAgendaItem('FOLLOW-UP', 'critical', 'Urgent item', 'Now?')];
    deferItem(agenda, agenda[0].id);
    assert.equal(agenda[0].priority, 'critical');
  });
});

describe('getNextItem', () => {
  it('returns highest-priority pending item', () => {
    const agenda = [
      createAgendaItem('INFORM', 'low', 'Low item', null),
      createAgendaItem('DECIDE', 'critical', 'Critical item', 'Decide now?'),
      createAgendaItem('FOLLOW-UP', 'high', 'High item', 'Update?'),
    ];
    const next = getNextItem(agenda);
    assert.equal(next.priority, 'critical');
    assert.equal(next.content, 'Critical item');
  });

  it('returns null when all items are resolved', () => {
    const agenda = [
      createAgendaItem('INFORM', 'normal', 'Done', null),
    ];
    agenda[0].status = 'resolved';
    assert.equal(getNextItem(agenda), null);
  });

  it('skips resolved and deferred items', () => {
    const agenda = [
      createAgendaItem('DECIDE', 'critical', 'Resolved', 'Done?'),
      createAgendaItem('INFORM', 'normal', 'Pending', null),
    ];
    agenda[0].status = 'resolved';
    const next = getNextItem(agenda);
    assert.equal(next.content, 'Pending');
  });
});

describe('generateMorningAgenda', () => {
  it('generates agenda from blockers', async () => {
    await storeMemory(db, 'Server is down', { type: 'blocker', project: 'ocean' });
    const agenda = await generateMorningAgenda(db);
    assert.ok(agenda.length > 0);
    const blockerItem = agenda.find(a => a.content.includes('Server is down'));
    assert.ok(blockerItem, 'Should include blocker as agenda item');
    assert.equal(blockerItem.priority, 'critical');
  });

  it('includes commitments as high priority', async () => {
    await storeMemory(db, 'Send draft to Gilbert by Friday', { type: 'commitment', person: 'Gilbert' });
    const agenda = await generateMorningAgenda(db);
    const item = agenda.find(a => a.content.includes('Gilbert'));
    assert.ok(item);
    assert.equal(item.priority, 'high');
  });

  it('includes waiting_for as follow-up items', async () => {
    await storeMemory(db, 'Schema from Riazati due Feb 3', { type: 'waiting_for', person: 'Riazati' });
    const agenda = await generateMorningAgenda(db);
    const item = agenda.find(a => a.content.includes('Riazati'));
    assert.ok(item);
    assert.equal(item.type, 'FOLLOW-UP');
  });

  it('stays within 6-12 item budget', async () => {
    // Add many items
    for (let i = 0; i < 20; i++) {
      await storeMemory(db, `Status update ${i}`, { type: 'status', project: `proj${i}` });
    }
    const agenda = await generateMorningAgenda(db);
    assert.ok(agenda.length <= 12, `Got ${agenda.length} items, max 12`);
  });

  it('returns empty array when nothing to discuss', async () => {
    const agenda = await generateMorningAgenda(db);
    assert.ok(agenda.length === 0);
  });
});

describe('applyAgendaUpdates', () => {
  it('resolves matching items', () => {
    const agenda = [
      createAgendaItem('DECIDE', 'high', 'Pick framework', 'Which?'),
      createAgendaItem('FOLLOW-UP', 'normal', 'Check status', 'Update?'),
    ];
    applyAgendaUpdates(agenda, {
      resolves: [{ id: agenda[0].id, resolution: 'Chose React' }],
    });
    assert.equal(agenda[0].status, 'resolved');
    assert.equal(agenda[0].resolution, 'Chose React');
    assert.equal(agenda[1].status, 'pending');
  });

  it('defers matching items', () => {
    const agenda = [
      createAgendaItem('FOLLOW-UP', 'normal', 'Review PR', 'Done?'),
    ];
    applyAgendaUpdates(agenda, {
      defers: [{ id: agenda[0].id }],
    });
    assert.equal(agenda[0].status, 'deferred');
    assert.equal(agenda[0].priority, 'high');
  });

  it('adds new items with FOLLOW-UP defaults', () => {
    const agenda = [];
    applyAgendaUpdates(agenda, {
      adds: [{ content: 'New item from AI' }],
    });
    assert.equal(agenda.length, 1);
    assert.equal(agenda[0].type, 'FOLLOW-UP');
    assert.equal(agenda[0].priority, 'normal');
    assert.equal(agenda[0].content, 'New item from AI');
    assert.equal(agenda[0].status, 'pending');
  });

  it('adds items with explicit type and priority', () => {
    const agenda = [];
    applyAgendaUpdates(agenda, {
      adds: [{ type: 'DECIDE', priority: 'high', content: 'Choose vendor' }],
    });
    assert.equal(agenda[0].type, 'DECIDE');
    assert.equal(agenda[0].priority, 'high');
  });

  it('no-ops on null updates', () => {
    const agenda = [createAgendaItem('INFORM', 'low', 'FYI', null)];
    applyAgendaUpdates(agenda, null);
    assert.equal(agenda.length, 1);
    assert.equal(agenda[0].status, 'pending');
  });

  it('no-ops on undefined updates', () => {
    const agenda = [createAgendaItem('INFORM', 'low', 'FYI', null)];
    applyAgendaUpdates(agenda, undefined);
    assert.equal(agenda.length, 1);
  });

  it('no-ops on empty updates', () => {
    const agenda = [createAgendaItem('INFORM', 'low', 'FYI', null)];
    applyAgendaUpdates(agenda, {});
    assert.equal(agenda.length, 1);
    assert.equal(agenda[0].status, 'pending');
  });

  it('handles combined resolve + defer + add in one call', () => {
    const agenda = [
      createAgendaItem('DECIDE', 'high', 'Item A', 'A?'),
      createAgendaItem('FOLLOW-UP', 'normal', 'Item B', 'B?'),
    ];
    applyAgendaUpdates(agenda, {
      resolves: [{ id: agenda[0].id, resolution: 'Done' }],
      defers: [{ id: agenda[1].id }],
      adds: [{ content: 'Item C' }],
    });
    assert.equal(agenda[0].status, 'resolved');
    assert.equal(agenda[1].status, 'deferred');
    assert.equal(agenda.length, 3);
    assert.equal(agenda[2].content, 'Item C');
  });
});

describe('generateCheckInAgenda', () => {
  it('returns minimal agenda', async () => {
    const agenda = await generateCheckInAgenda(db, 'Quick update on DRBI');
    assert.ok(agenda.length <= 3, 'Check-in agenda should be 0-3 items');
  });
});
