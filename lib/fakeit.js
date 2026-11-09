// Game 2: Fake It Till You Make It.
// SECURITY: the secret word must never be sent to the impostor's phone, nor to the screen before the result phase.
const { pick, shuffle, norm, fill } = require('./util');

const SILENT = '🤐 …';
const ROLE_MS = 8000;
const TURN_SKIP_OFFLINE_MS = 3000;
const IMPOSTOR_OFFLINE_CANCEL_MS = 30000;
const CANCEL_RESTART_MS = 5000;
// Reveal timeline (screen animates against these, server waits for them).
const REVEAL = { intro: 2000, perVote: 1600, drum: 3500, hold: 4500 };

const ACTIVE_PHASES = ['role', 'clue', 'discuss', 'vote', 'reveal', 'lastchance'];

const CAUGHT = ['Ternyata {nama} penipunya! 😱', 'Ketahuan! {nama} si tukang tipu 🕵️', '{nama}, aktingmu kurang meyakinkan 🎬', 'Topeng {nama} terbuka! 🎭💥'];
const ESCAPED = ['{nama} sukses menipu kalian semua 🎭', 'Kalian semua ketipu sama {nama}! 🤡', '{nama} layak dapat Piala Citra 🏆', '{nama} senyum-senyum puas… kalian ketipu! 😏'];
const COMEBACK = 'Comeback! {nama} berhasil nebak kata rahasianya 🤯';
const FAILED_GUESS = '{nama} nebak salah. Gagal total! 😂';
const ACCUSED = 'Kenapa kamu mencurigakan banget sih, {nama}? 🤨';

function defaultState() {
  return {
    settings: {
      activeCategories: null, // null = semua kategori
      penalty: true,
      doubleLast: true,
      totalRounds: 0, // 0 = jumlah pemain
      clueSec: 20,
      discussSec: 60,
      voteSec: 20,
      guessSec: 15,
    },
    round: 0,
    impostorHistory: [],
    usedWords: [],
    phase: 'idle', // idle | role | clue | discuss | vote | reveal | lastchance | result | cancelled | over
    r: null,
    restartAt: 0,
    cancelReason: '',
  };
}

const err = (error) => ({ ok: false, error });
const isBusy = (s) => ACTIVE_PHASES.includes(s.fake.phase);

function totalRounds(s) {
  const t = s.fake.settings.totalRounds;
  return t > 0 ? t : Math.max(3, Object.keys(s.players).length);
}

function activeCategories(s, bank) {
  const act = s.fake.settings.activeCategories;
  return bank.filter((c) => !act || act.includes(c.kategori));
}

function start(s, ctx, { force = false } = {}) {
  const f = s.fake;
  if (isBusy(s)) return err('Ronde masih jalan!');
  if (ctx.bombBusy(s)) return err('Ronde Bom masih jalan. Tunggu meledak dulu 💣');
  if (!force && f.round >= totalRounds(s)) return err(`Sudah ${f.round} ronde. Naikkan jumlah ronde kalau mau lanjut.`);
  const online = ctx.onlinePlayers(s);
  if (online.length < 3) return err('Minimal 3 pemain online buat Fake It.');

  const pool = [];
  for (const c of activeCategories(s, ctx.wordBank())) {
    for (const k of c.kata) {
      const key = `${c.kategori}|${k}`;
      if (!f.usedWords.includes(key)) pool.push({ category: c.kategori, word: k, key });
    }
  }
  if (!pool.length) return err('Bank kata habis untuk kategori aktif! Tambah kata atau aktifkan kategori lain.');
  const chosen = pick(pool);

  let candidates = online.filter((pid) => !f.impostorHistory.includes(pid));
  if (!candidates.length) {
    f.impostorHistory = [];
    candidates = online;
  }
  const impostor = pick(candidates);
  f.impostorHistory.push(impostor);
  f.usedWords.push(chosen.key);

  // Impostor speaks at position 3 or later in clue round 1.
  const others = shuffle(online.filter((pid) => pid !== impostor));
  const pos = 2 + Math.floor(Math.random() * (online.length - 2));
  const order = [...others.slice(0, pos), impostor, ...others.slice(pos)];

  const now = ctx.now();
  f.round += 1;
  f.phase = 'role';
  f.restartAt = 0;
  f.cancelReason = '';
  f.r = {
    impostor,
    category: chosen.category,
    word: chosen.word,
    order,
    turn: -1,
    turnEndsAt: 0,
    clues: [], // {pid, text, pass, silent}
    phaseEndsAt: now + ROLE_MS,
    votes: {},
    reveal: null,
    guess: null,
    guessCorrect: false,
    double: f.settings.doubleLast && f.round >= totalRounds(s),
    result: null,
  };
  s.players[impostor].stats.impostorRounds = (s.players[impostor].stats.impostorRounds || 0) + 1;
  s.activeGame = 'fake';
  s.overlay = null;
  ctx.fx(s, { type: 'fake:start', round: f.round });
  ctx.changed(s);
  return { ok: true };
}

const curPid = (r) => (r.turn >= 0 ? r.order[r.turn % r.order.length] : null);

function nextTurn(s, ctx) {
  const f = s.fake;
  const r = f.r;
  r.turn += 1;
  if (r.turn >= r.order.length * 2) {
    f.phase = 'discuss';
    r.phaseEndsAt = ctx.now() + f.settings.discussSec * 1000;
    r.turnEndsAt = 0;
    ctx.fx(s, { type: 'fake:phase', phase: 'discuss' });
  } else {
    r.turnEndsAt = ctx.now() + f.settings.clueSec * 1000;
  }
  ctx.changed(s);
}

function recordClue(s, ctx, pid, text, silent) {
  const r = s.fake.r;
  const pass = r.turn < r.order.length ? 1 : 2;
  r.clues.push({ pid, text, pass, silent: !!silent });
  ctx.fx(s, { type: 'fake:clue', pid, text, pass, silent: !!silent });
  nextTurn(s, ctx);
}

function submitClue(s, ctx, pid, raw) {
  const f = s.fake;
  const r = f.r;
  if (f.phase !== 'clue' || !r) return err('Belum waktunya kasih petunjuk.');
  if (curPid(r) !== pid) return err('Bukan giliranmu!');
  const text = String(raw || '').trim();
  if (!text) return err('Isi dulu petunjuknya!');
  if (/\s/.test(text)) return err('Satu kata aja, tanpa spasi!');
  if ([...text].length > 20) return err('Maksimal 20 huruf ya.');
  const n = norm(text);
  const key = n || text.toLowerCase();
  if (n) {
    const secret = norm(r.word);
    const parts = r.word.split(/\s+/).map(norm).filter((t) => t.length >= 3);
    // Deliberately generic message, so the impostor learns nothing.
    if (n.includes(secret) || parts.some((t) => n.includes(t))) return err('Kata itu nggak boleh 🙅 Coba kata lain!');
  }
  if (r.clues.some((c) => !c.silent && (norm(c.text) || c.text.toLowerCase()) === key)) return err('Udah dipakai orang lain! Cari kata lain.');
  recordClue(s, ctx, pid, text, false);
  return { ok: true };
}

function vote(s, ctx, pid, target) {
  const f = s.fake;
  const r = f.r;
  if (f.phase !== 'vote' || !r) return err('Belum waktunya vote.');
  if (!r.order.includes(pid)) return err('Kamu nggak ikut ronde ini.');
  if (pid === target) return err('Nggak bisa vote diri sendiri 😅');
  if (!r.order.includes(target) || !s.players[target]) return err('Pilihan nggak valid.');
  r.votes[pid] = target;
  ctx.fx(s, { type: 'fake:voted', pid });
  ctx.changed(s);
  if (allVoted(s, ctx)) beginReveal(s, ctx);
  return { ok: true };
}

function allVoted(s, ctx) {
  const r = s.fake.r;
  const voters = r.order.filter((pid) => s.players[pid] && ctx.isOnline(s, pid));
  return voters.length > 0 && voters.every((pid) => r.votes[pid]);
}

function beginReveal(s, ctx) {
  const f = s.fake;
  const r = f.r;
  const tally = {};
  for (const t of Object.values(r.votes)) tally[t] = (tally[t] || 0) + 1;
  const max = Math.max(0, ...Object.values(tally));
  const top = max > 0 ? Object.keys(tally).filter((k) => tally[k] === max) : [];
  const caught = top.length === 1 && top[0] === r.impostor;
  const seq = shuffle(Object.entries(r.votes).map(([from, to]) => ({ from, to })));
  const now = ctx.now();
  r.reveal = { startedAt: now, seq, tally, top, max, caught, ...REVEAL };
  f.phase = 'reveal';
  r.phaseEndsAt = now + REVEAL.intro + seq.length * REVEAL.perVote + REVEAL.drum + REVEAL.hold;
  ctx.fx(s, { type: 'fake:phase', phase: 'reveal' });
  ctx.changed(s);
}

function submitGuess(s, ctx, pid, raw) {
  const f = s.fake;
  const r = f.r;
  if (f.phase !== 'lastchance' || !r) return err('Bukan waktunya nebak.');
  if (pid !== r.impostor) return err('Cuma penipu yang boleh nebak.');
  if (r.guess != null) return err('Udah nebak.');
  const text = String(raw || '').trim().slice(0, 40);
  if (!text) return err('Isi tebakanmu dulu!');
  r.guess = text;
  r.guessCorrect = norm(text) === norm(r.word);
  finalize(s, ctx);
  return { ok: true, correct: r.guessCorrect };
}

function finalize(s, ctx) {
  const f = s.fake;
  const r = f.r;
  const rv = r.reveal;
  const m = r.double ? 2 : 1;
  const deltas = {};
  const add = (pid, d) => { if (s.players[pid]) deltas[pid] = (deltas[pid] || 0) + d; };
  const imp = s.players[r.impostor];
  const impName = imp ? imp.name : 'Penipu';
  const captions = [];

  if (!rv.caught) {
    add(r.impostor, 150 * m);
    if (imp) imp.stats.impostorEscapes += 1;
    captions.push(fill(pick(ESCAPED), impName));
  } else {
    captions.push(fill(pick(CAUGHT), impName));
    if (r.guessCorrect) {
      add(r.impostor, 100 * m);
      captions.push(fill(COMEBACK, impName));
    } else if (r.guess != null) {
      captions.push(fill(FAILED_GUESS, impName));
    }
  }
  for (const [voter, target] of Object.entries(r.votes)) {
    if (target === r.impostor) {
      if (rv.caught) add(voter, 50 * m);
      if (s.players[voter]) s.players[voter].stats.correctVotes += 1;
    }
  }
  for (const [pid, n] of Object.entries(rv.tally)) {
    if (pid !== r.impostor && s.players[pid]) s.players[pid].stats.wrongAccused += n;
  }
  const accused = rv.top.filter((pid) => pid !== r.impostor && s.players[pid]);
  if (f.settings.penalty) {
    for (const pid of accused) {
      add(pid, -20 * m);
      captions.push(fill(ACCUSED, s.players[pid].name));
    }
  }
  for (const [pid, d] of Object.entries(deltas)) ctx.addScore(s, pid, d, `Fake It ronde ${f.round}`);

  r.result = { caught: rv.caught, guess: r.guess, guessCorrect: r.guessCorrect, deltas, captions, accused, double: r.double };
  f.phase = 'result';
  r.phaseEndsAt = 0;
  ctx.fx(s, { type: 'fake:result', caught: rv.caught, guessCorrect: r.guessCorrect });
  ctx.changed(s);
}

function cancel(s, ctx, reason) {
  const f = s.fake;
  if (!isBusy(s) || !f.r) return err('Nggak ada ronde yang jalan.');
  // Round doesn't count: give the impostor slot back and repeat the round number.
  const idx = f.impostorHistory.lastIndexOf(f.r.impostor);
  if (idx >= 0) f.impostorHistory.splice(idx, 1);
  const imp = s.players[f.r.impostor];
  if (imp) imp.stats.impostorRounds = Math.max(0, (imp.stats.impostorRounds || 1) - 1);
  f.round = Math.max(0, f.round - 1);
  f.r = null;
  f.phase = 'cancelled';
  f.cancelReason = reason || 'Ronde dibatalkan.';
  f.restartAt = ctx.now() + CANCEL_RESTART_MS;
  ctx.fx(s, { type: 'fake:cancel', reason: f.cancelReason });
  ctx.changed(s);
  return { ok: true };
}

function tick(s, ctx, now) {
  const f = s.fake;
  if (f.phase === 'cancelled' && f.restartAt && now >= f.restartAt) {
    f.restartAt = 0;
    const res = start(s, ctx, { force: true });
    if (!res.ok) {
      f.cancelReason = `Gagal mulai ulang: ${res.error}`;
      ctx.changed(s);
    }
    return;
  }
  if (!isBusy(s) || !f.r) return;
  const r = f.r;

  if (!s.players[r.impostor]) return void cancel(s, ctx, 'Penipunya keluar dari game. Ronde diulang!');
  if (ctx.offlineFor(s, r.impostor, now) > IMPOSTOR_OFFLINE_CANCEL_MS) {
    return void cancel(s, ctx, 'Penipunya hilang sinyal lebih dari 30 detik. Ronde diulang!');
  }

  switch (f.phase) {
    case 'role':
      if (now >= r.phaseEndsAt) {
        f.phase = 'clue';
        ctx.fx(s, { type: 'fake:phase', phase: 'clue' });
        nextTurn(s, ctx);
      }
      break;
    case 'clue': {
      const pid = curPid(r);
      const gone = !s.players[pid];
      if (gone || now >= r.turnEndsAt || ctx.offlineFor(s, pid, now) > TURN_SKIP_OFFLINE_MS) recordClue(s, ctx, pid, SILENT, true);
      break;
    }
    case 'discuss':
      if (now >= r.phaseEndsAt) toVote(s, ctx);
      break;
    case 'vote':
      if (now >= r.phaseEndsAt || allVoted(s, ctx)) beginReveal(s, ctx);
      break;
    case 'reveal':
      if (now >= r.phaseEndsAt) {
        if (r.reveal.caught) {
          f.phase = 'lastchance';
          r.phaseEndsAt = now + f.settings.guessSec * 1000;
          ctx.fx(s, { type: 'fake:phase', phase: 'lastchance' });
          ctx.changed(s);
        } else finalize(s, ctx);
      }
      break;
    case 'lastchance':
      if (now >= r.phaseEndsAt) finalize(s, ctx);
      break;
  }
}

function toVote(s, ctx) {
  const f = s.fake;
  f.phase = 'vote';
  f.r.phaseEndsAt = ctx.now() + f.settings.voteSec * 1000;
  ctx.fx(s, { type: 'fake:phase', phase: 'vote' });
  ctx.changed(s);
}

// ---- Host controls ----
function skipPhase(s, ctx) {
  const f = s.fake;
  const r = f.r;
  if (!r) return err('Nggak ada ronde yang jalan.');
  if (f.phase === 'role') r.phaseEndsAt = 0;
  else if (f.phase === 'clue') return skipTurn(s, ctx);
  else if (f.phase === 'discuss') return toVote(s, ctx), { ok: true };
  else if (f.phase === 'vote') beginReveal(s, ctx);
  else return err('Fase ini nggak bisa di-skip.');
  return { ok: true };
}

function skipTurn(s, ctx) {
  const f = s.fake;
  if (f.phase !== 'clue' || !f.r) return err('Bukan fase petunjuk.');
  recordClue(s, ctx, curPid(f.r), SILENT, true);
  return { ok: true };
}

function addTime(s, ctx, sec = 30) {
  const f = s.fake;
  if (!f.r) return err('Nggak ada ronde yang jalan.');
  if (f.phase === 'discuss' || f.phase === 'vote') f.r.phaseEndsAt += sec * 1000;
  else if (f.phase === 'clue') f.r.turnEndsAt += sec * 1000;
  else return err('Fase ini nggak pakai timer yang bisa ditambah.');
  ctx.changed(s);
  return { ok: true };
}

function end(s, ctx) {
  const f = s.fake;
  if (isBusy(s) && f.r) {
    const idx = f.impostorHistory.lastIndexOf(f.r.impostor);
    if (idx >= 0) f.impostorHistory.splice(idx, 1);
    f.round = Math.max(0, f.round - 1);
  }
  f.phase = 'over';
  f.r = null;
  f.restartAt = 0;
  s.activeGame = 'fake';
  ctx.fx(s, { type: 'fake:over' });
  ctx.changed(s);
  return { ok: true };
}

function setSettings(s, ctx, patch) {
  const st = s.fake.settings;
  const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v))));
  if (patch.totalRounds != null && !isNaN(patch.totalRounds)) st.totalRounds = num(patch.totalRounds, 0, 30);
  if (patch.discussSec != null && !isNaN(patch.discussSec)) st.discussSec = num(patch.discussSec, 10, 600);
  if (patch.clueSec != null && !isNaN(patch.clueSec)) st.clueSec = num(patch.clueSec, 5, 120);
  if (patch.voteSec != null && !isNaN(patch.voteSec)) st.voteSec = num(patch.voteSec, 5, 120);
  for (const k of ['penalty', 'doubleLast']) if (k in patch) st[k] = !!patch[k];
  if ('activeCategories' in patch) {
    const v = patch.activeCategories;
    st.activeCategories = Array.isArray(v) ? v.map(String) : null;
  }
  if (s.fake.r && 'doubleLast' in patch) s.fake.r.double = st.doubleLast && s.fake.round >= totalRounds(s);
  ctx.changed(s);
  return { ok: true };
}

// ---- Views ----
const pub = (s, pid) => {
  const p = s.players[pid];
  return p ? { id: p.id, name: p.name, avatar: p.avatar, color: p.color } : { id: pid, name: '???', avatar: '❓', color: '#888' };
};

function base(s, ctx) {
  const f = s.fake;
  const r = f.r;
  const v = {
    phase: f.phase,
    round: f.round,
    totalRounds: totalRounds(s),
    cancelReason: f.phase === 'cancelled' ? f.cancelReason : '',
    restartAt: f.restartAt,
  };
  if (!r) return v;
  v.double = r.double;
  v.category = r.category; // category is public to everyone
  v.order = r.order.map((pid) => ({ ...pub(s, pid), online: ctx.isOnline(s, pid) }));
  v.clues = r.clues.map((c) => ({ pid: c.pid, text: c.text, pass: c.pass, silent: c.silent }));
  v.turnPid = f.phase === 'clue' ? curPid(r) : null;
  v.turnEndsAt = f.phase === 'clue' ? r.turnEndsAt : 0;
  v.clueRound = f.phase === 'clue' ? (r.turn < r.order.length ? 1 : 2) : 0;
  v.phaseEndsAt = r.phaseEndsAt;
  v.votedIds = Object.keys(r.votes);
  if (['reveal', 'lastchance', 'result'].includes(f.phase)) {
    // Vote reveal: impostor identity is part of the reveal animation (after voting has closed).
    v.reveal = { ...r.reveal, impostor: r.impostor };
  }
  if (f.phase === 'lastchance') v.impostor = r.impostor;
  if (f.phase === 'result') {
    v.impostor = r.impostor;
    v.word = r.word;
    v.result = r.result;
  }
  return v;
}

function playerView(s, ctx, pid) {
  const f = s.fake;
  const r = f.r;
  const v = base(s, ctx);
  if (!r) return v;
  v.participant = r.order.includes(pid);
  if (v.participant && f.phase !== 'result') {
    v.card = pid === r.impostor
      ? { role: 'impostor', category: r.category } // NEVER the word
      : { role: 'civil', category: r.category, word: r.word };
  }
  v.myTurn = v.turnPid === pid;
  v.myVote = r.votes[pid] || null;
  v.amImpostorGuessing = f.phase === 'lastchance' && pid === r.impostor;
  v.alreadyGuessed = r.guess != null;
  return v;
}

const screenView = (s, ctx) => base(s, ctx);

function hostView(s, ctx) {
  const f = s.fake;
  const v = base(s, ctx);
  v.settings = f.settings;
  v.usedCount = f.usedWords.length;
  if (f.r) {
    v.secret = { impostor: pub(s, f.r.impostor), word: f.r.word, category: f.r.category };
    v.votes = Object.entries(f.r.votes).map(([a, b]) => ({ from: pub(s, a), to: pub(s, b) }));
  }
  return v;
}

module.exports = {
  defaultState, start, submitClue, vote, submitGuess, cancel, tick, skipPhase, skipTurn, addTime, end, setSettings,
  playerView, screenView, hostView, isBusy, totalRounds, REVEAL,
};
