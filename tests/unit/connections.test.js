import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CONNECTIONS, CONNECTION_MAP, CONNECTION_CATEGORIES, getConnectionsByCategory } from '../../src/lib/connections.js';
//
describe('CONNECTIONS catalog', () => {
  it('has 25 connections', () => {
    assert.equal(CONNECTIONS.length, 25);
  });
  //
  it('every connection has required fields', () => {
    for (const c of CONNECTIONS) {
      assert.ok(c.id, `missing id`);
      assert.ok(c.name, `${c.id} missing name`);
      assert.ok(c.icon, `${c.id} missing icon`);
      assert.ok(c.category, `${c.id} missing category`);
      assert.ok(c.description, `${c.id} missing description`);
      assert.equal(typeof c.available, 'boolean', `${c.id} available not boolean`);
      assert.ok(c.authType, `${c.id} missing authType`);
    }
  });
  //
  it('all currently unavailable', () => {
    const available = CONNECTIONS.filter(c => c.available);
    assert.equal(available.length, 0);
  });
  //
  it('every connection category exists in CONNECTION_CATEGORIES', () => {
    const catIds = CONNECTION_CATEGORIES.map(c => c.id);
    for (const c of CONNECTIONS) {
      assert.ok(catIds.includes(c.category), `${c.id} has unknown category: ${c.category}`);
    }
  });
});
//
describe('CONNECTION_MAP', () => {
  it('looks up connections by id', () => {
    assert.equal(CONNECTION_MAP['gmail'].name, 'Gmail');
    assert.equal(CONNECTION_MAP['slack'].name, 'Slack');
    assert.equal(CONNECTION_MAP['todoist'].name, 'Todoist');
  });
  //
  it('has same count as array', () => {
    assert.equal(Object.keys(CONNECTION_MAP).length, CONNECTIONS.length);
  });
});
//
describe('CONNECTION_CATEGORIES', () => {
  it('has 7 categories', () => {
    assert.equal(CONNECTION_CATEGORIES.length, 7);
  });
  //
  it('every category has id, label, icon', () => {
    for (const cat of CONNECTION_CATEGORIES) {
      assert.ok(cat.id, `missing id`);
      assert.ok(cat.label, `${cat.id} missing label`);
      assert.ok(cat.icon, `${cat.id} missing icon`);
    }
  });
});
//
describe('getConnectionsByCategory', () => {
  it('returns grouped connections', () => {
    const groups = getConnectionsByCategory();
    assert.ok(Array.isArray(groups));
    assert.equal(groups.length, CONNECTION_CATEGORIES.length);
  });
  //
  it('each group has category info and connections array', () => {
    const groups = getConnectionsByCategory();
    for (const g of groups) {
      assert.ok(g.id);
      assert.ok(g.label);
      assert.ok(Array.isArray(g.connections));
      assert.ok(g.connections.length > 0);
    }
  });
  //
  it('connections are alphabetized within each group', () => {
    const groups = getConnectionsByCategory();
    for (const g of groups) {
      for (let i = 1; i < g.connections.length; i++) {
        assert.ok(
          g.connections[i - 1].name.localeCompare(g.connections[i].name) <= 0,
          `${g.label}: ${g.connections[i - 1].name} should come before ${g.connections[i].name}`
        );
      }
    }
  });
  //
  it('total connections across groups equals CONNECTIONS length', () => {
    const groups = getConnectionsByCategory();
    const total = groups.reduce((sum, g) => sum + g.connections.length, 0);
    assert.equal(total, CONNECTIONS.length);
  });
});
//
