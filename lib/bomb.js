// Game 1: Bom Kentang Panas. All timing is absolute timestamps so state survives a server restart.
const MC = require('./minichallenges');
const { randInt, pick, shuffle, fill } = require('./util');

const LOCK_MS = 3000;
const DISCONNECT_PASS_MS = 5000;

const CAPTIONS = [
  '{nama} telah menjadi abu 💀',
  'RIP {nama}, gugur dalam tugas 🪦',
  '{nama} meledak kayak petasan lebaran 🎆',
  'Selamat jalan {nama}, kamu akan dikenang… mungkin 😔',
  '{nama} kena DUAR! Rambutnya jadi kribo 🤯',
  'Breaking news: {nama} hangus di tempat 📰',
  '{nama}: "tadi aku mau lempar kok…" 💥',
  '{nama} sekarang jadi kentang goreng 🍟',
  '{nama} lupa kalau bom itu bukan martabak 🔥',
];
const DOUBLE_CAPTIONS = [
  '{nama} pegang DUA bom… double kill! 💀💀',
  '{nama} serakah, dua bom diembat sendiri 💥💥',
];

function defaultState() {
  return {
    settings: { fuseMin: 15, fuseMax: 40, revenge: false, double: false, mega: false, totalRounds: 7 },
    round: 0,
    phase: 'idle', // idle | live | blast | over
    bombs: [],
    trail: [],
    fuseEnd: 0,
    roundMega: false,
    roundDouble: false,
    used: {}, // pid -> challenge types already used this round
    lastBlast: null,
  };
}

const err = (error) => ({ ok: false, error });

function newChallenge(s, ctx, pid) {
  const b = s.bomb;
  const used = b.used[pid] || (b.used[pid] = []);
  const c = MC.generate(ctx.mini(), used);
  used.push(c.type);
  return c;
}

function start(s, ctx) {
  const b = s.bomb;
  if (b.phase === 'live') return err('Ronde masih jalan!');
  if (s.fake && ctx.fakeBusy(s)) return err('Ronde Fake It masih jalan. Selesaikan dulu.');
  if (b.round >= b.settings.totalRounds) return err(`Sudah ${b.round} ronde. Naikkan jumlah ronde kalau mau lanjut.`);
  const online = ctx.onlinePlayers(s);
  if (online.length < 2) return err('Minimal 2 pemain online buat main bom.');

  const now = ctx.now();
  const mega = !!b.settings.mega;
  const count = b.settings.double && online.length >= 3 ? 2 : 1;
  let min = b.settings.fuseMin;
  let max = b.settings.fuseMax;
  if (mega) {
    min = Math.max(5, Math.round(min * 0.6));
    max = Math.max(min + 2, Math.round(max * 0.6));
  }

  let holders = [];
  if (b.settings.revenge && b.lastBlast) {
    holders = b.lastBlast.victims.filter((pid) => online.includes(pid)).slice(0, count);
  }
  for (const pid of shuffle(online)) {
    if (holders.length >= count) break;
    if (!holders.includes(pid)) holders.push(pid);
  }

  b.round += 1;
  b.phase = 'live';
  b.used = {};
  b.trail = [];
  b.roundMega = mega;
  b.roundDouble = count === 2;
  b.fuseEnd = now + randInt(min * 1000, max * 1000);
  b.bombs = holders.map((pid, i) => ({
    id: i + 1,
    holder: pid,
    prevHolder: null,
    receivedAt: now,
    solved: false,
    lockedUntil: 0,
    challenge: newChallenge(s, ctx, pid),
  }));
  for (const pid of holders) b.trail.push(pid);
  s.activeGame = 'bomb';
  s.overlay = null;
  ctx.fx(s, { type: 'bomb:start', round: b.round, mega, double: b.roundDouble, holders });
  ctx.changed(s);
  return { ok: true };
}

function validTargets(s, ctx, bomb) {
  const others = ctx.onlinePlayers(s).filter((pid) => pid !== bomb.holder);
  const noBack = others.filter((pid) => pid !== bomb.prevHolder);
  return noBack.length ? noBack : others;
}

function doPass(s, ctx, bomb, to, { auto = false } = {}) {
  const b = s.bomb;
  const now = ctx.now();
  const from = bomb.holder;
  if (!auto) {
    const pts = b.roundMega ? 20 : 10;
    ctx.addScore(s, from, pts, 'Oper bom');
    const p = s.players[from];
    if (p) {
      p.stats.passes += 1;
      p.stats.passTimeTotal += now - bomb.receivedAt;
    }
  }
  bomb.prevHolder = from;
  bomb.holder = to;
  bomb.receivedAt = now;
  bomb.solved = false;
  bomb.lockedUntil = 0;
  bomb.challenge = newChallenge(s, ctx, to);
  b.trail.push(to);
  if (b.trail.length > 30) b.trail = b.trail.slice(-30);
  ctx.fx(s, { type: 'bomb:pass', bombId: bomb.id, from, to, auto });
  ctx.changed(s);
}

function solve(s, ctx, pid, { bombId, challengeId }) {
  const b = s.bomb;
  if (b.phase !== 'live') return err('Ronde belum jalan.');
  const bomb = b.bombs.find((x) => x.id === bombId && x.holder === pid);
  if (!bomb) return err('Bomnya udah nggak di kamu.');
  if (bomb.challenge.id !== challengeId) return err('Challenge-nya udah ganti.');
  if (ctx.now() < bomb.lockedUntil) return err('Masih terkunci!');
  bomb.solved = true;
  ctx.changed(s);
  return { ok: true };
}

function fail(s, ctx, pid, { bombId }) {
  const b = s.bomb;
  if (b.phase !== 'live') return err('Ronde belum jalan.');
  const bomb = b.bombs.find((x) => x.id === bombId && x.holder === pid);
  if (!bomb || bomb.solved) return err('Nggak ada challenge aktif.');
  bomb.lockedUntil = ctx.now() + LOCK_MS;
  bomb.challenge = newChallenge(s, ctx, pid);
  ctx.changed(s);
  return { ok: true };
}

function throwBomb(s, ctx, pid, { bombId, target }) {
  const b = s.bomb;
  if (b.phase !== 'live') return err('Ronde belum jalan.');
  const bomb = b.bombs.find((x) => x.id === bombId && x.holder === pid);
  if (!bomb) return err('Bomnya udah nggak di kamu.');
  if (!bomb.solved) return err('Selesaikan challenge dulu!');
  const valid = validTargets(s, ctx, bomb);
  if (!valid.length) return err('Nggak ada target online 😅');
  let to = target;
  if (target === 'random') to = pick(valid);
  if (!valid.includes(to)) {
    if (to === bomb.prevHolder) return err('Nggak boleh oper balik! 🙅');
    return err('Target nggak valid (mungkin offline).');
  }
  doPass(s, ctx, bomb, to);
  return { ok: true, to };
}

function explode(s, ctx) {
  const b = s.bomb;
  const counts = {};
  for (const bomb of b.bombs) counts[bomb.holder] = (counts[bomb.holder] || 0) + 1;
  const base = b.roundMega ? 200 : 100;
  const victims = Object.keys(counts);
  const penalties = {};
  const captions = [];
  for (const pid of victims) {
    const n = counts[pid];
    const pen = base * n;
    penalties[pid] = -pen;
    ctx.addScore(s, pid, -pen, n > 1 ? 'Meledak (dobel!)' : 'Meledak');
    const p = s.players[pid];
    if (p) p.stats.explosions += n;
    const name = p ? p.name : 'Seseorang';
    captions.push(fill(pick(n > 1 ? DOUBLE_CAPTIONS : CAPTIONS), name));
  }
  b.lastBlast = { victims, penalties, captions, at: ctx.now(), round: b.round, counts };
  b.phase = 'blast';
  b.bombs = [];
  ctx.fx(s, { type: 'bomb:explode', victims, penalties, captions, counts });
  ctx.changed(s);
}

function tick(s, ctx, now) {
  const b = s.bomb;
  if (b.phase !== 'live') return;
  if (now >= b.fuseEnd) return explode(s, ctx);
  for (const bomb of b.bombs) {
    const gone = !s.players[bomb.holder];
    if (gone || ctx.offlineFor(s, bomb.holder, now) > DISCONNECT_PASS_MS) {
      const valid = validTargets(s, ctx, bomb);
      if (valid.length) doPass(s, ctx, bomb, pick(valid), { auto: true });
    }
  }
}

function end(s, ctx) {
  const b = s.bomb;
  b.phase = 'over';
  b.bombs = [];
  s.activeGame = 'bomb';
  ctx.fx(s, { type: 'bomb:over' });
  ctx.changed(s);
  return { ok: true };
}

function setSettings(s, ctx, patch) {
  const st = s.bomb.settings;
  const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v))));
  if (patch.fuseMin != null && !isNaN(patch.fuseMin)) st.fuseMin = num(patch.fuseMin, 3, 120);
  if (patch.fuseMax != null && !isNaN(patch.fuseMax)) st.fuseMax = num(patch.fuseMax, 4, 180);
  if (st.fuseMax <= st.fuseMin) st.fuseMax = st.fuseMin + 1;
  if (patch.totalRounds != null && !isNaN(patch.totalRounds)) st.totalRounds = num(patch.totalRounds, 1, 20);
  for (const k of ['revenge', 'double', 'mega']) if (k in patch) st[k] = !!patch[k];
  ctx.changed(s);
  return { ok: true };
}

const pub = (s, pid) => {
  const p = s.players[pid];
  return p ? { id: p.id, name: p.name, avatar: p.avatar, color: p.color } : { id: pid, name: '???', avatar: '❓', color: '#888' };
};

function common(s) {
  const b = s.bomb;
  return {
    phase: b.phase,
    round: b.round,
    totalRounds: b.settings.totalRounds,
    mega: b.phase === 'live' ? b.roundMega : b.settings.mega,
    double: b.phase === 'live' ? b.roundDouble : b.settings.double,
    holders: b.bombs.map((x) => ({ bombId: x.id, ...pub(s, x.holder) })),
    trail: b.trail.slice(-8).map((pid) => pub(s, pid)),
    lastBlast: b.lastBlast
      ? {
          victims: b.lastBlast.victims.map((pid) => ({ ...pub(s, pid), penalty: b.lastBlast.penalties[pid], count: b.lastBlast.counts[pid] })),
          captions: b.lastBlast.captions,
          round: b.lastBlast.round,
          at: b.lastBlast.at,
        }
      : null,
  };
}

function playerView(s, ctx, pid) {
  const b = s.bomb;
  const mine = b.bombs
    .filter((x) => x.holder === pid)
    .map((x) => ({
      id: x.id,
      solved: x.solved,
      lockedUntil: x.lockedUntil,
      challenge: x.challenge,
      prevHolder: x.prevHolder,
      targets: x.solved ? validTargets(s, ctx, x).map((t) => pub(s, t)) : [],
      blocked: x.solved && x.prevHolder && s.players[x.prevHolder] ? pub(s, x.prevHolder) : null,
    }));
  return { ...common(s), myBombs: mine, passPoints: b.roundMega ? 20 : 10, penalty: b.roundMega ? 200 : 100 };
}

// Screen and host never see fuseEnd: the fuse animation is deliberately fake.
const screenView = (s) => common(s);
const hostView = (s) => ({ ...common(s), settings: s.bomb.settings });

module.exports = { defaultState, start, solve, fail, throwBomb, tick, end, setSettings, playerView, screenView, hostView };
