import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/test-db.js';
import { ensureSchema, storeMemory } from '../../src/lib/db.js';
import {
  extractKeywords,
  buildRecallQuery,
  searchMemories,
  searchConversations,
  recallForTurn,
  formatRecalledContext
} from '../../src/lib/recall.js';

let db;
beforeEach(async () => {
  db = await createTestDb();
  await ensureSchema(db);
});

describe('extractKeywords', () => {
  it('extracts keywords from text, filters stopwords', () => {
    const text = 'Schedule dentist appointment for next Tuesday';
    const keywords = extractKeywords(text);
    assert.ok(keywords.includes('schedule'));
    assert.ok(keywords.includes('dentist'));
    assert.ok(keywords.includes('appointment'));
    assert.ok(keywords.includes('tuesday'));
    assert.ok(!keywords.includes('for'));
    assert.ok(!keywords.includes('next'));
  });
  it('returns empty array for stopwords-only input', () => {
    const text = 'the and but for not you all can';
    const keywords = extractKeywords(text);
    assert.deepEqual(keywords, []);
  });
  it('caps at 8 keywords', () => {
    const text = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo';
    const keywords = extractKeywords(text);
    assert.equal(keywords.length, 8);
  });
  it('strips punctuation before filtering', () => {
    const text = 'Hello, world! Testing... punctuation?';
    const keywords = extractKeywords(text);
    assert.ok(keywords.includes('hello'));
    assert.ok(keywords.includes('world'));
    assert.ok(keywords.includes('testing'));
    assert.ok(keywords.includes('punctuation'));
  });
});

describe('buildRecallQuery', () => {
  it('builds from last 2 user messages', () => {
    const session = {
      messages: [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'Response' },
        { role: 'user', content: 'Second message' },
        { role: 'user', content: 'Third message' }
      ],
      agenda: []
    };
    const query = buildRecallQuery(session);
    assert.ok(query.includes('Second message'));
    assert.ok(query.includes('Third message'));
    assert.ok(!query.includes('First message'));
  });
  it('includes active agenda items', () => {
    const session = {
      messages: [],
      agenda: [
        { status: 'active', content: 'Review dentist schedule' },
        { status: 'pending', content: 'Plan marketing campaign' },
        { status: 'completed', content: 'Done item' }
      ]
    };
    const query = buildRecallQuery(session);
    assert.ok(query.includes('Review dentist schedule'));
    assert.ok(query.includes('Plan marketing campaign'));
    assert.ok(!query.includes('Done item'));
  });
  it('returns empty string for empty session', () => {
    const session = { messages: [], agenda: [] };
    const query = buildRecallQuery(session);
    assert.equal(query, '');
  });
  it('caps at 500 chars', () => {
    const longText = 'a'.repeat(300);
    const session = {
      messages: [
        { role: 'user', content: longText },
        { role: 'user', content: longText }
      ],
      agenda: []
    };
    const query = buildRecallQuery(session);
    assert.ok(query.length <= 500);
  });
});

describe('searchMemories', () => {
  it('finds memories matching keywords', async () => {
    await storeMemory(db, 'Dentist appointment scheduled for March 15', { type: 'decision' });
    await storeMemory(db, 'Marketing campaign needs budget approval', { type: 'status' });
    await storeMemory(db, 'Code review completed successfully', { type: 'status' });
    const results = await searchMemories(db, ['dentist', 'appointment']);
    assert.equal(results.length, 1);
    assert.ok(results[0].content.includes('Dentist'));
  });
  it('excludes P1 types (blocker, commitment, waiting_for)', async () => {
    await storeMemory(db, 'Dentist blocker issue', { type: 'blocker' });
    await storeMemory(db, 'Dentist commitment made', { type: 'commitment' });
    await storeMemory(db, 'Waiting for dentist callback', { type: 'waiting_for' });
    await storeMemory(db, 'Dentist appointment scheduled', { type: 'decision' });
    const results = await searchMemories(db, ['dentist']);
    assert.equal(results.length, 1);
    assert.equal(results[0].type, 'decision');
  });
  it('excludes superseded memories', async () => {
    const firstId = await storeMemory(db, 'Old dentist date March 1', { type: 'decision' });
    await storeMemory(db, 'New dentist date March 15', { type: 'decision' });
    await db.prepare('UPDATE memories SET superseded_by = ? WHERE id = ?').run(2, firstId);
    const results = await searchMemories(db, ['dentist', 'date']);
    assert.equal(results.length, 1);
    assert.ok(results[0].content.includes('March 15'));
  });
  it('respects limit parameter', async () => {
    await storeMemory(db, 'Project alpha update', { type: 'status' });
    await storeMemory(db, 'Project beta update', { type: 'status' });
    await storeMemory(db, 'Project gamma update', { type: 'status' });
    await storeMemory(db, 'Project delta update', { type: 'status' });
    const results = await searchMemories(db, ['project'], 2);
    assert.equal(results.length, 2);
  });
});

describe('searchConversations', () => {
  it('finds past conversations by summary keywords', async () => {
    await db.prepare(
      'INSERT INTO conversations (session_type, started_at, ended_at, summary) VALUES (?, ?, ?, ?)'
    ).run('morning_meeting', '2025-01-15T09:00:00Z', '2025-01-15T09:30:00Z', 'Discussed dentist appointment scheduling');
    await db.prepare(
      'INSERT INTO conversations (session_type, started_at, ended_at, summary) VALUES (?, ?, ?, ?)'
    ).run('checkin', '2025-01-16T14:00:00Z', '2025-01-16T14:15:00Z', 'Marketing campaign brainstorm');
    const results = await searchConversations(db, ['dentist', 'appointment']);
    assert.equal(results.length, 1);
    assert.ok(results[0].summary.includes('dentist'));
  });
  it('excludes open conversations (no ended_at)', async () => {
    await db.prepare(
      'INSERT INTO conversations (session_type, started_at, ended_at, summary) VALUES (?, ?, ?, ?)'
    ).run('morning_meeting', '2025-01-15T09:00:00Z', '2025-01-15T09:30:00Z', 'Completed dentist discussion');
    await db.prepare(
      'INSERT INTO conversations (session_type, started_at, ended_at, summary) VALUES (?, ?, ?, ?)'
    ).run('morning_meeting', '2025-01-17T09:00:00Z', null, 'Ongoing dentist conversation');
    const results = await searchConversations(db, ['dentist']);
    assert.equal(results.length, 1);
    assert.equal(results[0].summary, 'Completed dentist discussion');
  });
  it('respects limit parameter', async () => {
    await db.prepare(
      'INSERT INTO conversations (session_type, started_at, ended_at, summary) VALUES (?, ?, ?, ?)'
    ).run('morning_meeting', '2025-01-15T09:00:00Z', '2025-01-15T09:30:00Z', 'Project review session');
    await db.prepare(
      'INSERT INTO conversations (session_type, started_at, ended_at, summary) VALUES (?, ?, ?, ?)'
    ).run('checkin', '2025-01-16T14:00:00Z', '2025-01-16T14:15:00Z', 'Project status update');
    await db.prepare(
      'INSERT INTO conversations (session_type, started_at, ended_at, summary) VALUES (?, ?, ?, ?)'
    ).run('planning', '2025-01-17T10:00:00Z', '2025-01-17T10:45:00Z', 'Project planning meeting');
    const results = await searchConversations(db, ['project'], 2);
    assert.equal(results.length, 2);
  });
});

describe('recallForTurn', () => {
  it('returns null for empty session (no messages)', async () => {
    const session = { messages: [], agenda: [] };
    const result = await recallForTurn(db, session);
    assert.equal(result, null);
  });
  it('returns memories and conversations matching context', async () => {
    await storeMemory(db, 'Dentist appointment March 15', { type: 'decision' });
    await db.prepare(
      'INSERT INTO conversations (session_type, started_at, ended_at, summary) VALUES (?, ?, ?, ?)'
    ).run('morning_meeting', '2025-01-15T09:00:00Z', '2025-01-15T09:30:00Z', 'Discussed dentist scheduling');
    const session = {
      messages: [
        { role: 'user', content: 'Need to follow up on dentist appointment' }
      ],
      agenda: []
    };
    const result = await recallForTurn(db, session);
    assert.ok(result);
    assert.ok(result.memories.length > 0);
    assert.ok(result.conversations.length > 0);
  });
  it('returns null when no matches found', async () => {
    await storeMemory(db, 'Marketing budget approval', { type: 'decision' });
    const session = {
      messages: [
        { role: 'user', content: 'Talk about dentist appointment' }
      ],
      agenda: []
    };
    const result = await recallForTurn(db, session);
    assert.equal(result, null);
  });
});

describe('formatRecalledContext', () => {
  it('formats memories section', () => {
    const recalled = {
      memories: [
        { type: 'decision', content: 'Dentist March 15' },
        { type: 'status', content: 'Marketing approved' }
      ],
      conversations: []
    };
    const formatted = formatRecalledContext(recalled);
    assert.ok(formatted.includes('RECALLED MEMORIES:'));
    assert.ok(formatted.includes('[decision] Dentist March 15'));
    assert.ok(formatted.includes('[status] Marketing approved'));
  });
  it('formats conversations section', () => {
    const recalled = {
      memories: [],
      conversations: [
        { session_type: 'morning_meeting', started_at: '2025-01-15T09:00:00Z', summary: 'Dentist planning' }
      ]
    };
    const formatted = formatRecalledContext(recalled);
    assert.ok(formatted.includes('RELATED PAST SESSIONS:'));
    assert.ok(formatted.includes('[2025-01-15 morning_meeting] Dentist planning'));
  });
  it('returns empty string for null input', () => {
    const formatted = formatRecalledContext(null);
    assert.equal(formatted, '');
  });
  it('formats both sections together', () => {
    const recalled = {
      memories: [
        { type: 'decision', content: 'Dentist March 15' }
      ],
      conversations: [
        { session_type: 'morning_meeting', started_at: '2025-01-15T09:00:00Z', summary: 'Dentist planning' }
      ]
    };
    const formatted = formatRecalledContext(recalled);
    assert.ok(formatted.includes('RECALLED MEMORIES:'));
    assert.ok(formatted.includes('RELATED PAST SESSIONS:'));
    assert.ok(formatted.includes('[decision] Dentist March 15'));
    assert.ok(formatted.includes('[2025-01-15 morning_meeting] Dentist planning'));
  });
});
