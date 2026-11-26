import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initial, collection, makeCard, addNext, completeNext, moveCards, normalizeWorkspace } from '../extension/model.js';

describe('Given two collections containing the same URL', () => {
  let workspace, first, second, original, copy;
  beforeEach(() => {
    workspace = initial();
    first = collection('Reading');
    second = collection('Travel');
    original = makeCard('https://example.org/article', 'Article');
    copy = makeCard(original.url, 'Trip idea');
    first.cards.push(original);
    second.cards.push(copy);
    workspace.collections.push(first, second);
  });

  it('when both links are queued, then Next contains one entry', () => {
    addNext(workspace, [original.id, copy.id]);
    assert.deepEqual(workspace.next, [original.id]);
  });

  it('when moving onto an existing copy, then the original stays in place', () => {
    const result = moveCards(workspace, new Set([original.id]), second);
    assert.deepEqual(result, { moved: 0, skipped: 1 });
    assert.deepEqual(first.cards, [original]);
    assert.deepEqual(second.cards, [copy]);
  });

  it('when a queued link is completed, then its date is recorded and the bookmark survives', () => {
    addNext(workspace, [original.id]);
    completeNext(workspace, original.id, 12345);
    assert.deepEqual(workspace.next, []);
    assert.equal(workspace.completed[0].at, 12345);
    assert.equal(workspace.completed[0].url, original.url);
    assert.deepEqual(first.cards, [original]);
  });

  it('when a legacy queue contains a collection, then it expands into unique links', () => {
    workspace.next = [first.id, copy.id];
    normalizeWorkspace(workspace);
    assert.deepEqual(workspace.next, [original.id]);
  });
});
