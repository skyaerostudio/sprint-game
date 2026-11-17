// Satu Dalam Sejuta game flow with a fake clock: answer → banding (incl. 30s auto-Sah) → reveal → hasil → koreksi.
const test = require('node:test');
const assert = require('node:assert/strict');
const sdj = require('../lib/sdj');

function setup(names = ['a', 'b', 'c']) {
  let t = 1_000_000;
  const s = { players: {}, activeGame: null, overlay: null, bomb: { phase: 'idle' }, sdj: sdj.defaultState() };
  for (const n of names) s.players[n] = { id: n, name: n.toUpperCase(), avatar: '😎', color: '#fff', score: 0 };
  const fx = [];
  const ctx = {
    now: () => t,
    isOnline: () => true,
    offlineFor: () => 0,
    onlinePlayers: (x) => Object.keys(x.players),
    addScore: (x, pid, d) => { x.players[pid].score += d; },
    changed: () => {},
    fx: (x, e) => fx.push(e),
    bombBusy: () => false,
    fakeBusy: () => false,
    promptUsage: () => ({}),
    bumpPromptUsage: () => {},
  };
  const advance = (ms) => { t += ms; sdj.tick(s, ctx, t); };
  return { s, ctx, fx, advance };
}

test('full prompt: match, collision, appeal auto-Sah at tier 3, reveal, scores, correction', () => {
  const { s, ctx, advance } = setup();
  s.sdj.settings.nextPrompt = 'buah';
  s.sdj.settings.totalPrompts = 2; // first prompt is not the last → no ×2
  assert.equal(sdj.start(s, ctx).ok, true);
  assert.equal(s.sdj.phase, 'jawab');

  // a + b both say Pisang (tier 1 → collision), c types something not in the list and appeals.
  assert.equal(sdj.submit(s, ctx, 'a', 'pisang').status, 'found');
  assert.equal(sdj.submit(s, ctx, 'b', 'Pisang').status, 'found');
  assert.equal(sdj.submit(s, ctx, 'c', 'Buah Ajaib Sekali').status, 'notfound');
  assert.equal(sdj.lock(s, ctx, 'a').ok, true);
  assert.equal(sdj.appeal(s, ctx, 'c').ok, true);
  // b never locks: a matched answer still counts when time runs out.
  advance(s.sdj.settings.answerSec * 1000 + 1);
  assert.equal(s.sdj.phase, 'banding');
  assert.equal(s.sdj.r.cur.pid, 'c');

  // Host forgets → after 30s auto-Sah at tier 3.
  advance(30_001);
  assert.equal(s.sdj.r.answers.c.status, 'sah');
  assert.equal(s.sdj.r.answers.c.tier, 3);
  assert.equal(s.sdj.r.answers.c.auto, true);
  assert.equal(s.sdj.phase, 'reveal');

  // Phones only learn their own result after their step is on screen.
  assert.equal(sdj.playerView(s, ctx, 'c').myResult, undefined);
  advance(s.sdj.r.reveal.end + 1);
  assert.equal(s.sdj.phase, 'hasil');
  assert.equal(s.players.a.score, 5); // Pisang tier 1, 50% of 10
  assert.equal(s.players.b.score, 5);
  assert.equal(s.players.c.score, 50 + 15); // tier 3 + Sendirian
  assert.equal(sdj.playerView(s, ctx, 'c').myResult.points, 65);

  // Host correction: b actually meant something else → Ngambang. a loses the collision (→ Sendirian).
  assert.equal(sdj.correct(s, ctx, { pid: 'b', tier: 0 }).ok, true);
  assert.equal(s.players.b.score, 0);
  assert.equal(s.players.a.score, 10 + 15);
  const totals = sdj.totals(s);
  assert.equal(totals.a.points, 25);
  assert.equal(totals.c.depth, 200);
});

test('retry limit, ambiguous choice, sering_salah needs banding, last prompt ×2', () => {
  const { s, ctx, advance } = setup(['a', 'b']);
  s.sdj.settings.nextPrompt = 'profesi';
  s.sdj.settings.totalPrompts = 1; // this is the last prompt → Penyelaman Ganda
  sdj.start(s, ctx);
  assert.equal(s.sdj.r.double, true);

  const amb = sdj.submit(s, ctx, 'a', 'Pramugar');
  assert.equal(amb.status, 'ambiguous');
  assert.equal(amb.triesLeft, sdj.MAX_TRIES); // asking doesn't cost a try
  assert.equal(sdj.choose(s, ctx, 'a', 'Pramugari').status, 'found');

  assert.equal(sdj.submit(s, ctx, 'b', 'zzzz1').status, 'notfound');
  assert.equal(sdj.submit(s, ctx, 'b', 'zzzz2').status, 'notfound');
  assert.equal(sdj.submit(s, ctx, 'b', 'Pengangguran').status, 'perlu_banding'); // sering_salah for profesi
  assert.equal(sdj.submit(s, ctx, 'b', 'Guru').ok, false); // 3 tries used
  assert.equal(sdj.appeal(s, ctx, 'b').ok, true);
  assert.equal(sdj.judge(s, ctx, { pid: 'b', verdict: 'tolak' }).ok, true);
  assert.equal(sdj.lock(s, ctx, 'a').ok, true); // everyone locked → answer phase ends early
  assert.equal(s.sdj.phase, 'reveal');
  advance(s.sdj.r.reveal.end + 1);
  const tier = s.sdj.r.snap.jawaban.find((j) => j.teks === 'Pramugari').tier;
  const z = s.sdj.r.skoring;
  assert.equal(s.players.a.score, (z.tier[tier].poin + z.modifier.sendirian_bonus) * 2);
  assert.equal(s.players.b.score, 0);
  assert.equal(sdj.start(s, ctx).ok, false); // prompt limit reached
});

test('a later appeal of an already-judged answer gets the same verdict', () => {
  const { s, ctx } = setup(['a', 'b', 'c']);
  sdj.start(s, ctx);
  sdj.submit(s, ctx, 'a', 'Buah Ajaib');
  sdj.appeal(s, ctx, 'a');
  sdj.judge(s, ctx, { pid: 'a', verdict: 'sah', tier: 4 });
  sdj.submit(s, ctx, 'b', 'buah ajaib!');
  sdj.appeal(s, ctx, 'b');
  assert.equal(s.sdj.r.answers.b.status, 'sah');
  assert.equal(s.sdj.r.answers.b.tier, 4);
});

test('player view never contains the answer list or tiers before reveal', () => {
  const { s, ctx } = setup(['a', 'b']);
  sdj.start(s, ctx);
  sdj.submit(s, ctx, 'a', 'zzzz');
  sdj.appeal(s, ctx, 'a');
  const txt = JSON.stringify(sdj.playerView(s, ctx, 'b'));
  assert.ok(!/"(tier|zones|snap|answers|jawaban|steps|catatan|alasan|deeper)"/.test(txt), txt);
});
