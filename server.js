// Sprint Event Games server: Express + Socket.IO, in-memory state persisted to JSON files.
const path = require('path');
const http = require('http');
const os = require('os');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const store = require('./lib/store');
const bomb = require('./lib/bomb');
const fake = require('./lib/fakeit');
const { rid, pick } = require('./lib/util');

const PORT = Number(process.env.PORT) || 3000;
const HOST_PASSWORD = process.env.HOST_PASSWORD || 'sprint';
// Render sets RENDER_EXTERNAL_URL automatically, so the QR code works there without extra config.
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
const BOOT = Date.now();
const RESTART_GRACE_MS = 10000;

const PLAYER_COLORS = ['#e8402a', '#ffc83d', '#2fa36b', '#8ad7c1', '#f26ca7', '#ff8a3d', '#b79cff', '#62b6f5', '#a8d44a', '#d9b98c'];
const AVATARS = ['😎', '🤠', '🥸', '🤓', '😈', '👻', '🤖', '👽', '🐵', '🐸', '🐼', '🦊', '🐯', '🦄', '🐔', '🐙', '🦖', '🍌', '🌶️', '🍕', '🥑', '🧋', '🚀', '⚡'];

// ---------------- App & sockets ----------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 4000, pingTimeout: 5000, maxHttpBufferSize: 1e5 });

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));
app.get('/api/info', (req, res) => res.json({ publicUrl: PUBLIC_URL, lanIps: lanIps(), port: PORT }));
app.get('/api/qr.svg', async (req, res) => {
  try {
    const text = String(req.query.text || '').slice(0, 500);
    const svg = await QRCode.toString(text || ' ', { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
  } catch (e) {
    res.status(500).send('QR gagal');
  }
});

// ---------------- State ----------------
const sessions = store.loadSessions();
const meta = store.loadMeta();
if (meta.activeId && !sessions.has(meta.activeId)) meta.activeId = null;
const presence = new Map(); // `${sid}:${pid}` -> { sockets:Set, disconnectedAt }
const dirty = new Set();
const pending = new Set();
let flushScheduled = false;

const activeSession = () => (meta.activeId ? sessions.get(meta.activeId) : null) || null;

function pres(sid, pid) {
  const k = `${sid}:${pid}`;
  let p = presence.get(k);
  // After a (re)start everyone gets a grace period to reconnect before turn-skip / bomb auto-pass kicks in.
  if (!p) presence.set(k, (p = { sockets: new Set(), disconnectedAt: BOOT + RESTART_GRACE_MS }));
  return p;
}
const isOnline = (s, pid) => pres(s.id, pid).sockets.size > 0;
const offlineFor = (s, pid, now = Date.now()) => {
  const p = pres(s.id, pid);
  return p.sockets.size > 0 ? 0 : now - p.disconnectedAt;
};
const onlinePlayers = (s) => Object.keys(s.players).filter((pid) => isOnline(s, pid));

function addScore(s, pid, delta, reason) {
  const p = s.players[pid];
  if (!p || !delta) return;
  p.score += delta;
  s.log.push({ t: Date.now(), pid, delta, reason });
  if (s.log.length > 1000) s.log = s.log.slice(-1000);
}

function changed(s) {
  s.updatedAt = Date.now();
  dirty.add(s.id);
  pending.add(s.id);
  if (!flushScheduled) {
    flushScheduled = true;
    setImmediate(flush);
  }
}

const ctx = {
  now: () => Date.now(),
  isOnline,
  offlineFor,
  onlinePlayers,
  addScore,
  changed,
  fx: emitFx,
  mini: () => store.mini.get(),
  wordBank: () => store.wordBank.get(),
  fakeBusy: (s) => fake.isBusy(s),
  bombBusy: (s) => s.bomb.phase === 'live',
};

function emitFx(s, ev) {
  const payload = { ...ev, at: Date.now(), sid: s.id };
  io.to(`s:${s.id}`).emit('fx', payload);
  if (meta.activeId === s.id) io.to('screen').emit('fx', payload);
}

// ---------------- Session helpers ----------------
function genCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    const c = Array.from({ length: 4 }, () => L[Math.floor(Math.random() * L.length)]).join('');
    if (![...sessions.values()].some((s) => s.code === c)) return c;
  }
}

function newStats() {
  return { explosions: 0, passes: 0, passTimeTotal: 0, impostorEscapes: 0, correctVotes: 0, wrongAccused: 0, impostorRounds: 0 };
}

function createSession(squad, color) {
  const now = Date.now();
  const s = {
    id: now.toString(36) + rid(4),
    code: genCode(),
    squad,
    color,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    players: {},
    joinSeq: 0,
    activeGame: null,
    overlay: null,
    final: null,
    log: [],
    bomb: bomb.defaultState(),
    fake: fake.defaultState(),
  };
  sessions.set(s.id, s);
  return s;
}

function leaderboard(s) {
  const list = Object.values(s.players)
    .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, color: p.color, score: p.score, online: isOnline(s, p.id) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let rank = 0;
  let prev = null;
  list.forEach((e, i) => {
    if (e.score !== prev) rank = i + 1;
    prev = e.score;
    e.rank = rank;
  });
  return list;
}

function computeTitles(s) {
  const ps = Object.values(s.players);
  const titles = [];
  const add = (icon, title, desc, rows, fmt, lowerIsBetter = false) => {
    const valid = rows.filter((r) => r.v != null && (lowerIsBetter ? true : r.v > 0));
    if (!valid.length) return;
    const best = lowerIsBetter ? Math.min(...valid.map((r) => r.v)) : Math.max(...valid.map((r) => r.v));
    const winners = valid.filter((r) => r.v === best).map((r) => ({ id: r.p.id, name: r.p.name, avatar: r.p.avatar, color: r.p.color }));
    titles.push({ icon, title, desc, winners, value: fmt(best) });
  };
  add('💣', 'Paling Sering Meledak', 'Bom paling sayang sama dia', ps.map((p) => ({ p, v: p.stats.explosions })), (v) => `${v}× meledak`);
  add('⚡', 'Tangan Tercepat', 'Rata-rata oper bom paling cepat', ps.map((p) => ({ p, v: p.stats.passes > 0 ? Math.round(p.stats.passTimeTotal / p.stats.passes / 100) / 10 : null })), (v) => `rata-rata ${String(v).replace('.', ',')} detik`, true);
  add('🎭', 'Aktor Terbaik', 'Penipu yang paling sering lolos', ps.map((p) => ({ p, v: p.stats.impostorEscapes })), (v) => `lolos ${v}×`);
  add('🕵️', 'Detektif Kantor', 'Paling jago nebak penipu', ps.map((p) => ({ p, v: p.stats.correctVotes })), (v) => `${v} tebakan benar`);
  add('🤡', 'Paling Sering Dituduh', 'Padahal bukan penipu…', ps.map((p) => ({ p, v: p.stats.wrongAccused })), (v) => `${v} vote nyasar`);
  return titles;
}

// ---------------- Views ----------------
function sessionInfo(s) {
  return { id: s.id, code: s.code, squad: s.squad, color: s.color, status: s.status };
}

function playerView(s, pid) {
  const p = s.players[pid];
  const lb = leaderboard(s);
  const me = lb.find((e) => e.id === pid);
  return {
    role: 'player',
    serverNow: Date.now(),
    session: sessionInfo(s),
    me: { id: p.id, name: p.name, avatar: p.avatar, color: p.color, score: p.score, rank: me ? me.rank : null, total: lb.length },
    players: lb.map(({ id, name, avatar, color, online }) => ({ id, name, avatar, color, online })),
    activeGame: s.activeGame,
    overlay: s.overlay,
    final: !!s.final,
    bomb: s.activeGame === 'bomb' ? bomb.playerView(s, ctx, pid) : null,
    fake: s.activeGame === 'fake' ? fake.playerView(s, ctx, pid) : null,
  };
}

function screenView(s) {
  if (!s) return { role: 'screen', serverNow: Date.now(), session: null };
  const lb = leaderboard(s);
  return {
    role: 'screen',
    serverNow: Date.now(),
    session: sessionInfo(s),
    players: lb,
    leaderboard: lb,
    activeGame: s.activeGame,
    overlay: s.overlay,
    final: s.final ? { startedAt: s.final.startedAt, titles: computeTitles(s), leaderboard: lb } : null,
    bomb: s.activeGame === 'bomb' ? bomb.screenView(s, ctx) : null,
    fake: s.activeGame === 'fake' ? fake.screenView(s, ctx) : null,
  };
}

function sessionSummary(s) {
  const lb = leaderboard(s);
  return {
    ...sessionInfo(s),
    createdAt: s.createdAt,
    playerCount: lb.length,
    active: meta.activeId === s.id,
    leaderboard: lb.map(({ name, avatar, score, rank }) => ({ name, avatar, score, rank })),
    titles: s.status === 'closed' || s.final ? computeTitles(s) : [],
  };
}

function hostView() {
  const s = activeSession();
  return {
    serverNow: Date.now(),
    sessions: [...sessions.values()].sort((a, b) => b.createdAt - a.createdAt).map(sessionSummary),
    wordBank: store.wordBank.get(),
    active: s
      ? {
          ...sessionInfo(s),
          activeGame: s.activeGame,
          overlay: s.overlay,
          final: !!s.final,
          players: leaderboard(s).map((e) => ({ ...e, stats: s.players[e.id].stats })),
          log: s.log.slice(-15).reverse().map((l) => ({ ...l, name: s.players[l.pid] ? s.players[l.pid].name : '?' })),
          bomb: bomb.hostView(s, ctx),
          fake: fake.hostView(s, ctx),
          titles: computeTitles(s),
        }
      : null,
  };
}

function flush() {
  flushScheduled = false;
  const ids = [...pending];
  pending.clear();
  let hostNeeded = false;
  for (const sid of ids) {
    const s = sessions.get(sid);
    if (!s) continue;
    for (const pid of Object.keys(s.players)) {
      const p = pres(s.id, pid);
      if (!p.sockets.size) continue;
      const v = playerView(s, pid);
      for (const sockId of p.sockets) io.to(sockId).emit('state', v);
    }
    if (meta.activeId === sid) io.to('screen').emit('state', screenView(s));
    hostNeeded = true;
  }
  if (hostNeeded) io.to('host').emit('host:state', hostView());
}

function refreshAll() {
  for (const s of sessions.values()) changed(s);
  io.to('screen').emit('state', screenView(activeSession()));
  io.to('host').emit('host:state', hostView());
}

// ---------------- Player identity ----------------
function attach(socket, s, pid) {
  detach(socket);
  socket.data.sid = s.id;
  socket.data.pid = pid;
  socket.join(`s:${s.id}`);
  const p = pres(s.id, pid);
  p.sockets.add(socket.id);
  changed(s);
}

function detach(socket) {
  const { sid, pid } = socket.data;
  if (!sid || !pid) return;
  socket.leave(`s:${sid}`);
  const p = pres(sid, pid);
  p.sockets.delete(socket.id);
  if (!p.sockets.size) p.disconnectedAt = Date.now();
  socket.data.sid = socket.data.pid = null;
  const s = sessions.get(sid);
  if (s) changed(s);
}

function cleanName(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

function playerFromSocket(socket) {
  const s = sessions.get(socket.data.sid);
  const pid = socket.data.pid;
  if (!s || !pid || !s.players[pid] || s.status !== 'open') return null;
  return { s, pid };
}

function removePlayer(s, pid) {
  delete s.players[pid];
  const k = `${s.id}:${pid}`;
  const p = presence.get(k);
  if (p) {
    for (const sockId of p.sockets) {
      const sock = io.sockets.sockets.get(sockId);
      if (sock) {
        sock.emit('kicked');
        sock.leave(`s:${s.id}`);
        sock.data.sid = sock.data.pid = null;
      }
    }
    presence.delete(k);
  }
  // Game cleanup happens in the tick loops (bomb auto-pass, fake turn skip / cancel).
  changed(s);
}

// ---------------- Host actions ----------------
const err = (error) => ({ ok: false, error });

function needActive() {
  const s = activeSession();
  if (!s) throw new Error('Belum ada sesi aktif. Bikin atau buka sesi dulu.');
  if (s.status !== 'open') throw new Error('Sesi ini sudah ditutup (read-only).');
  return s;
}

function resetSession(s) {
  for (const p of Object.values(s.players)) {
    p.score = 0;
    p.stats = newStats();
  }
  const bs = s.bomb.settings;
  const fs = s.fake.settings;
  s.bomb = bomb.defaultState();
  s.bomb.settings = bs;
  s.fake = fake.defaultState();
  s.fake.settings = fs;
  s.activeGame = null;
  s.overlay = null;
  s.final = null;
  s.log = [];
  emitFx(s, { type: 'reset' });
  changed(s);
}

const HOST_ACTIONS = {
  createSession({ squad, color }) {
    const name = String(squad || '').trim().slice(0, 40);
    if (!name) return err('Isi nama squad dulu.');
    const c = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#ff6d00';
    const s = createSession(name, c);
    meta.activeId = s.id;
    store.saveMeta(meta);
    changed(s);
    refreshAll();
    return { ok: true, id: s.id };
  },
  activateSession({ id }) {
    const s = sessions.get(id);
    if (!s) return err('Sesi nggak ketemu.');
    s.status = 'open';
    meta.activeId = s.id;
    store.saveMeta(meta);
    changed(s);
    refreshAll();
    return { ok: true };
  },
  closeSession({ id }) {
    const s = sessions.get(id);
    if (!s) return err('Sesi nggak ketemu.');
    s.status = 'closed';
    if (s.bomb.phase === 'live') { s.bomb.phase = 'over'; s.bomb.bombs = []; }
    if (fake.isBusy(s) || s.fake.phase === 'cancelled') { s.fake.phase = 'over'; s.fake.r = null; s.fake.restartAt = 0; }
    if (meta.activeId === id) meta.activeId = null;
    store.saveMeta(meta);
    emitFx(s, { type: 'closed' });
    changed(s);
    refreshAll();
    return { ok: true };
  },
  deleteSession({ id }) {
    const s = sessions.get(id);
    if (!s) return err('Sesi nggak ketemu.');
    if (s.status === 'open') return err('Tutup sesinya dulu sebelum dihapus.');
    sessions.delete(id);
    try { require('fs').unlinkSync(path.join(store.DATA_DIR, 'sessions', `${id}.json`)); } catch {}
    dirty.delete(id);
    refreshAll();
    return { ok: true };
  },
  kick({ pid }) {
    const s = needActive();
    if (!s.players[pid]) return err('Pemain nggak ketemu.');
    removePlayer(s, pid);
    return { ok: true };
  },
  rename({ pid, name }) {
    const s = needActive();
    const p = s.players[pid];
    const n = cleanName(name);
    if (!p || !n) return err('Nama nggak valid.');
    if (Object.values(s.players).some((o) => o.id !== pid && o.name.toLowerCase() === n.toLowerCase())) return err('Nama itu sudah dipakai.');
    p.name = n;
    changed(s);
    return { ok: true };
  },
  score({ pid, delta }) {
    const s = needActive();
    const d = Math.round(Number(delta));
    if (!s.players[pid] || !d) return err('Isi poin yang valid.');
    addScore(s, pid, d, 'Manual dari host');
    emitFx(s, { type: 'score', pid, delta: d });
    changed(s);
    return { ok: true };
  },
  showLobby() {
    const s = needActive();
    if (s.bomb.phase === 'live' || fake.isBusy(s)) return err('Masih ada ronde yang jalan.');
    s.activeGame = null;
    s.overlay = null;
    s.final = null;
    changed(s);
    return { ok: true };
  },
  showGame({ game }) {
    const s = needActive();
    if (!['bomb', 'fake'].includes(game)) return err('Game nggak dikenal.');
    if ((game === 'bomb' && fake.isBusy(s)) || (game === 'fake' && s.bomb.phase === 'live')) return err('Game lain masih jalan.');
    s.activeGame = game;
    s.overlay = null;
    s.final = null;
    changed(s);
    return { ok: true };
  },
  toggleLeaderboard() {
    const s = needActive();
    s.overlay = s.overlay === 'leaderboard' ? null : 'leaderboard';
    changed(s);
    return { ok: true };
  },
  revealFinal() {
    const s = needActive();
    if (s.bomb.phase === 'live' || fake.isBusy(s)) return err('Masih ada ronde yang jalan.');
    s.final = { startedAt: Date.now() };
    s.overlay = null;
    emitFx(s, { type: 'final' });
    changed(s);
    return { ok: true };
  },
  hideFinal() {
    const s = needActive();
    s.final = null;
    changed(s);
    return { ok: true };
  },
  resetSession() {
    resetSession(needActive());
    return { ok: true };
  },
  'bomb:start': () => bomb.start(needActive(), ctx),
  'bomb:end': () => bomb.end(needActive(), ctx),
  'bomb:settings': (a) => bomb.setSettings(needActive(), ctx, a.patch || {}),
  'fake:start': () => fake.start(needActive(), ctx),
  'fake:skip': () => fake.skipPhase(needActive(), ctx),
  'fake:skipTurn': () => fake.skipTurn(needActive(), ctx),
  'fake:addTime': (a) => fake.addTime(needActive(), ctx, Number(a.sec) || 30),
  'fake:cancel': () => fake.cancel(needActive(), ctx, 'Ronde dibatalkan host. Diulang sebentar lagi!'),
  'fake:end': () => fake.end(needActive(), ctx),
  'fake:settings': (a) => fake.setSettings(needActive(), ctx, a.patch || {}),
  'words:add'({ kategori, kata }) {
    const cat = String(kategori || '').trim().slice(0, 30);
    const words = (Array.isArray(kata) ? kata : String(kata || '').split(','))
      .map((w) => String(w).replace(/\s+/g, ' ').trim().slice(0, 30))
      .filter(Boolean);
    if (!cat) return err('Isi nama kategori.');
    const bank = JSON.parse(JSON.stringify(store.wordBank.get()));
    let c = bank.find((x) => x.kategori.toLowerCase() === cat.toLowerCase());
    if (!c) bank.push((c = { kategori: cat, kata: [] }));
    let added = 0;
    for (const w of words) if (!c.kata.some((k) => k.toLowerCase() === w.toLowerCase())) { c.kata.push(w); added++; }
    store.wordBank.set(bank);
    refreshAll();
    return { ok: true, added };
  },
  'words:remove'({ kategori, kata }) {
    const bank = JSON.parse(JSON.stringify(store.wordBank.get()));
    const c = bank.find((x) => x.kategori === kategori);
    if (!c) return err('Kategori nggak ketemu.');
    if (kata == null) bank.splice(bank.indexOf(c), 1);
    else c.kata = c.kata.filter((k) => k !== kata);
    store.wordBank.set(bank);
    refreshAll();
    return { ok: true };
  },
};

// ---------------- Socket handlers ----------------
function safe(fn) {
  return (...args) => {
    const ack = typeof args[args.length - 1] === 'function' ? args.pop() : () => {};
    try {
      const res = fn(...args);
      ack(res || { ok: true });
    } catch (e) {
      if (!(e instanceof Error) || !/Belum ada sesi|ditutup/.test(e.message)) console.error('[socket]', e);
      ack({ ok: false, error: e.message || 'Terjadi kesalahan' });
    }
  };
}

io.on('connection', (socket) => {
  socket.data = { sid: null, pid: null, host: false };

  socket.on('screen:hello', safe(() => {
    socket.join('screen');
    socket.emit('state', screenView(activeSession()));
    return { ok: true };
  }));

  socket.on('host:auth', safe((pw) => {
    if (String(pw || '') !== HOST_PASSWORD) return err('Password salah 🙅');
    socket.data.host = true;
    socket.join('host');
    socket.emit('host:state', hostView());
    return { ok: true };
  }));

  socket.on('host:action', safe((a) => {
    if (!socket.data.host) return err('Belum login host.');
    const fn = HOST_ACTIONS[a && a.type];
    if (!fn) return err('Aksi nggak dikenal.');
    return fn(a);
  }));

  socket.on('player:join', safe((d) => {
    const code = String((d && d.code) || '').trim().toUpperCase();
    const s = [...sessions.values()].find((x) => x.code === code && x.status === 'open');
    if (!s) return err('Kode sesi nggak ketemu atau sesinya sudah ditutup.');
    const name = cleanName(d.name);
    if (!name) return err('Isi nama dulu dong!');
    if (Object.values(s.players).some((p) => p.name.toLowerCase() === name.toLowerCase())) return err('Nama itu sudah dipakai, pilih yang lain!');
    const avatar = AVATARS.includes(d.avatar) ? d.avatar : pick(AVATARS);
    const pid = rid(10);
    const token = rid(24);
    s.players[pid] = {
      id: pid,
      token,
      name,
      avatar,
      color: PLAYER_COLORS[s.joinSeq++ % PLAYER_COLORS.length],
      score: 0,
      joinedAt: Date.now(),
      stats: newStats(),
    };
    attach(socket, s, pid);
    emitFx(s, { type: 'join', pid, name, avatar });
    return { ok: true, sid: s.id, pid, token, code: s.code };
  }));

  socket.on('player:resume', safe((d) => {
    const s = sessions.get(d && d.sid);
    const p = s && s.players[d.pid];
    if (!s || !p || p.token !== d.token) return { ok: false, error: 'Identitas nggak ketemu.' };
    if (s.status !== 'open') return { ok: false, closed: true, error: 'Sesi sudah ditutup.' };
    attach(socket, s, p.id);
    return { ok: true, code: s.code };
  }));

  socket.on('player:leave', safe(() => {
    const me = playerFromSocket(socket);
    detach(socket);
    return { ok: !!me };
  }));

  const playerAction = (fn) => safe((d) => {
    const me = playerFromSocket(socket);
    if (!me) return err('Kamu belum join.');
    return fn(me.s, me.pid, d || {});
  });

  socket.on('bomb:solve', playerAction((s, pid, d) => bomb.solve(s, ctx, pid, d)));
  socket.on('bomb:fail', playerAction((s, pid, d) => bomb.fail(s, ctx, pid, d)));
  socket.on('bomb:throw', playerAction((s, pid, d) => bomb.throwBomb(s, ctx, pid, d)));
  socket.on('fake:clue', playerAction((s, pid, d) => fake.submitClue(s, ctx, pid, d.text)));
  socket.on('fake:vote', playerAction((s, pid, d) => fake.vote(s, ctx, pid, d.target)));
  socket.on('fake:guess', playerAction((s, pid, d) => fake.submitGuess(s, ctx, pid, d.text)));

  socket.on('disconnect', () => detach(socket));
});

// ---------------- Loops ----------------
setInterval(() => {
  const now = Date.now();
  for (const s of sessions.values()) {
    if (s.status !== 'open') continue;
    try {
      bomb.tick(s, ctx, now);
      fake.tick(s, ctx, now);
    } catch (e) {
      console.error('[tick]', e);
    }
  }
}, 200);

function saveDirty() {
  for (const sid of dirty) {
    const s = sessions.get(sid);
    if (s) {
      try { store.saveSession(s); } catch (e) { console.error('[save]', e.message); }
    }
  }
  dirty.clear();
}
setInterval(saveDirty, 2000);

function shutdown() {
  saveDirty();
  store.saveMeta(meta);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (e) => console.error('[uncaught]', e));

server.listen(PORT, () => {
  const ips = lanIps();
  console.log(`\n🎉 Sprint Event Games jalan di port ${PORT}`);
  console.log(`   Big screen : http://localhost:${PORT}/screen`);
  console.log(`   Panel host : http://localhost:${PORT}/host   (password: ${HOST_PASSWORD === 'sprint' ? 'sprint — ganti lewat env HOST_PASSWORD' : '••••'})`);
  for (const ip of ips) console.log(`   HP pemain  : http://${ip}:${PORT}/play`);
  console.log('');
});
