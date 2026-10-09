const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../src/games/scramble');

test('scramble preserves all letters and does not return the original word', () => {
    const word = 'COMPUTER';
    const result = _test.scrambleWord(word).replace(/ /g, '');

    assert.notEqual(result, word);
    assert.deepEqual([...result].sort(), [...word].sort());
});

test('speed scoring rewards faster solves and applies special-round multiplier', () => {
    assert.equal(_test.calculatePoints(4000, 25000), 100);
    assert.equal(_test.calculatePoints(11000, 25000), 75);
    assert.equal(_test.calculatePoints(20000, 25000), 50);
    assert.equal(_test.calculatePoints(4000, 25000, 2), 200);
});

test('answers are compared case-insensitively while ignoring spaces and hyphens', () => {
    assert.equal(_test.normalizeAnswer('  ice-cream '), 'ICECREAM');
});
