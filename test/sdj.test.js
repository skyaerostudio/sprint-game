// Unit tests for Satu Dalam Sejuta scoring + reveal ordering (node --test).
const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreEntries, buildSteps } = require('../lib/sdj');
const { skoring } = require('../data/prompts.json');

const ok = (key, tier, extra = {}) => ({ valid: true, key, label: key, tier, mutiara: false, sok: false, ...extra });
const none = () => ({ valid: false, key: '', label: '', tier: 0 });

test('tier points + Sendirian bonus for a unique answer (read from skoring)', () => {
  const { results } = scoreEntries({ a: ok('x', 4), b: ok('y', 1) }, skoring, false);
  assert.equal(results.a.points, skoring.tier['4'].poin + skoring.modifier.sendirian_bonus);
  assert.equal(results.a.depth, skoring.tier['4'].kedalaman_m);
  assert.equal(results.a.solo, true);
  assert.equal(results.b.points, 10 + 15);
});

test('Tabrakan: same answer from 2+ players = 50% each, no Sendirian bonus', () => {
  const { results } = scoreEntries({ a: ok('x', 3), b: ok('x', 3), c: ok('y', 2) }, skoring, false);
  assert.equal(results.a.points, 25);
  assert.equal(results.b.points, 25);
  assert.equal(results.a.collision, true);
  assert.equal(results.c.points, 25 + 15);
});

test('Mutiara uses skoring.mutiara, not the tier', () => {
  const { results } = scoreEntries({ a: ok('m', 5, { mutiara: true }), b: ok('m', 5, { mutiara: true }) }, skoring, false);
  assert.equal(results.a.points, 100); // 200 × 50% (collision)
  assert.equal(results.a.depth, 10000);
  const solo = scoreEntries({ a: ok('m', 5, { mutiara: true }) }, skoring, false).results;
  assert.equal(solo.a.points, 215);
});

test('Ngambang = ngambang_poin, depth 0', () => {
  const { results } = scoreEntries({ a: none(), b: ok('x', 2) }, skoring, false);
  assert.equal(results.a.points, 0);
  assert.equal(results.a.ngambang, true);
  assert.equal(results.a.depth, 0);
});

test('Penyelaman Ganda doubles everything, Sendirian bonus included', () => {
  const { results } = scoreEntries({ a: ok('x', 5), b: ok('y', 1), c: ok('y', 1) }, skoring, true);
  assert.equal(results.a.points, (120 + 15) * 2);
  assert.equal(results.b.points, 5 * 2);
});

test('Sok Pinter keeps its tier points', () => {
  const { results } = scoreEntries({ a: ok('durian', 1, { sok: true }) }, skoring, false);
  assert.equal(results.a.points, 25);
  assert.equal(results.a.sok, true);
});

test('"Satu otak": everyone gave the same valid answer', () => {
  assert.equal(scoreEntries({ a: ok('x', 1), b: ok('x', 1), c: ok('x', 1) }, skoring, false).satuOtak, true);
  assert.equal(scoreEntries({ a: ok('x', 1), b: ok('x', 1), c: none() }, skoring, false).satuOtak, false);
  assert.equal(scoreEntries({ a: ok('x', 1), b: ok('y', 1) }, skoring, false).satuOtak, false);
});

test('reveal steps go Ngambang → shallow → deep → Mutiara, collisions grouped', () => {
  const { results } = scoreEntries({ a: ok('m', 5, { mutiara: true }), b: ok('p', 5), c: ok('s', 1), d: ok('s', 1), e: none() }, skoring, false);
  const steps = buildSteps(results);
  assert.deepEqual(steps.map((s) => (s.ngambang ? '~' : s.label)), ['~', 's', 'p', 'm']);
  assert.deepEqual(steps[1].pids.sort(), ['c', 'd']);
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i].at > steps[i - 1].at);
});
