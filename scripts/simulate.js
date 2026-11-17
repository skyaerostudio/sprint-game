#!/usr/bin/env node
// Simulated players for load/flow testing.
//
//   node scripts/simulate.js --code ABCD                 # 7 bots join an existing session and auto-play
//   node scripts/simulate.js --auto                      # also act as host: create session, play both games, reveal final
//
// Options: --url http://localhost:3000  --players 7  --password sprint  --bomb-rounds 2  --sdj-rounds 2  --fake-rounds 2  --keep
const { io } = require('socket.io-client');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const URL = opt('url', 'http://localhost:3000');
const N = Number(opt('players', 7));
const AUTO = !!opt('auto', false);
const PASSWORD = opt('password', process.env.HOST_PASSWORD || 'sprint');
const BOMB_ROUNDS = Number(opt('bomb-rounds', 2));
const FAKE_ROUNDS = Number(opt('fake-rounds', 2));
const SDJ_ROUNDS = Number(opt('sdj-rounds', 2));
// Mix of very common answers (across all prompts), near-misses and junk, so found / notfound / banding all happen.
const GUESSES = ['Pisang', 'Apel', 'Jakarta', 'Bandung', 'Kucing', 'Ayam', 'Bakso', 'Rendang', 'Honda', 'Yamaha', 'Toyota', 'Sepak Bola', 'Badminton', 'Bayam', 'Kangkung', 'Es Teh', 'Kopi', 'Printer', 'Laptop', 'Macet', 'Hujan', 'Jepang', 'Indonesia', 'Guru', 'Dokter', 'Merah', 'Biru', 'Bawang Putih', 'Jahe', 'Jawa Barat', 'Bali', 'Durian', 'Kepel Raksasa', 'Qwertyuiop', 'Benda Ajaib'];
let CODE = opt('code', '');

const NAMES = ['Budi', 'Sari', 'Dimas', 'Rina', 'Joko', 'Tari', 'Agus', 'Wati', 'Eko', 'Lina'];
const AVATARS = ['😎', '🤠', '🤓', '👻', '🤖', '🐸', '🦊', '🐼', '🦄', '🐙'];
const CLUES = ['enak', 'pedas', 'manis', 'ramai', 'jauh', 'besar', 'kecil', 'murah', 'mahal', 'malam', 'pagi', 'panas', 'dingin', 'lucu', 'cepat', 'lambat', 'putih', 'hitam', 'bulat', 'ribet', 'santai', 'wangi', 'kenyang', 'capek', 'seru', 'mantap', 'basah', 'kering', 'tinggi', 'rendah', 'lama', 'baru'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const problems = [];
let secret = null; // { word, impostorId } as seen by the host, used for leak checks

function bot(i) {
  const name = NAMES[i % NAMES.length] + (i >= NAMES.length ? i : '');
  const s = io(URL, { transports: ['websocket'], reconnectionDelay: 400, reconnectionDelayMax: 2000 });
  const me = { name, s, id: null, state: null, busy: new Set(), turnSent: null, voted: null, guessed: false, sdjBusy: null };

  s.on('connect', () => {
    if (me.identity) {
      // Same flow as a phone waking up: resume with the stored identity.
      s.emit('player:resume', me.identity, (res) => {
        if (!res.ok) problems.push(`${name} gagal resume: ${res.error}`);
        else me.resumed = true;
      });
      return;
    }
    s.emit('player:join', { code: CODE, name, avatar: AVATARS[i % AVATARS.length] }, (res) => {
      if (!res.ok) { problems.push(`${name} gagal join: ${res.error}`); return; }
      me.id = res.pid;
      me.identity = { sid: res.sid, pid: res.pid, token: res.token };
    });
  });

  s.on('state', async (st) => {
    me.state = st;
    // --- Leak check: the impostor must never receive the secret word before the result phase ---
    const f = st.fake;
    if (f && f.card && f.card.role === 'impostor' && 'word' in f.card) problems.push(`BOCOR: ${name} (penipu) menerima field word di kartu`);
    if (f && secret && secret.impostorId === me.id && f.phase !== 'result') {
      if (JSON.stringify(st).toLowerCase().includes(`"${secret.word.toLowerCase()}"`)) problems.push(`BOCOR: kata rahasia "${secret.word}" terkirim ke HP penipu ${name} (fase ${f.phase})`);
    }

    // --- Bomb: solve challenge (sometimes fail), then throw ---
    const b = st.bomb;
    if (b && b.phase === 'live') {
      for (const bm of b.myBombs) {
        const k = `${bm.id}:${bm.challenge.id}:${bm.solved}`;
        if (me.busy.has(k)) continue;
        me.busy.add(k);
        const wait = Math.max(0, bm.lockedUntil - st.serverNow);
        await sleep(wait + rand(400, 1800));
        // Re-check against the latest state: the round may have ended or the bomb moved while we "thought".
        const cur = me.state.bomb && me.state.bomb.phase === 'live' && me.state.bomb.myBombs.find((x) => x.id === bm.id && x.challenge.id === bm.challenge.id && x.solved === bm.solved);
        if (!cur) continue;
        if (!bm.solved) {
          if (Math.random() < 0.12) s.emit('bomb:fail', { bombId: bm.id }, () => {});
          else s.emit('bomb:solve', { bombId: bm.id, challengeId: bm.challenge.id }, () => {});
        } else {
          s.emit('bomb:throw', { bombId: bm.id, target: Math.random() < 0.5 ? 'random' : pick(bm.targets).id }, (r) => {
            // Throwing in the same instant the bomb explodes / moves is an expected race, not a bug.
            if (!r.ok && !/Ronde belum jalan|udah nggak di kamu/.test(r.error)) problems.push(`${name} gagal lempar: ${r.error}`);
          });
        }
      }
    }

    // --- Satu Dalam Sejuta ---
    const d = st.sdj;
    if (d) {
      // Leak check: phones must never see tiers, the answer list or other players' answers before reveal.
      const txt = JSON.stringify(d);
      if (['jawab', 'banding', 'reveal'].includes(d.phase) && /"(tier|zones|snap|answers|jawaban|steps|catatan|alasan|deeper)"/.test(txt)) problems.push(`BOCOR: HP ${name} menerima data rahasia SDJ (fase ${d.phase})`);
      if (d.phase === 'jawab' && d.my && !d.my.locked && me.sdjBusy !== d.round + ':' + d.my.triesLeft + ':' + d.my.status) {
        me.sdjBusy = d.round + ':' + d.my.triesLeft + ':' + d.my.status;
        await sleep(rand(200, 900));
        const cur = me.state.sdj;
        if (!cur || cur.phase !== 'jawab' || cur.my.locked) return;
        const my = cur.my;
        if (my.status === 'found') {
          if (Math.random() < 0.7 || my.triesLeft === 0) s.emit('sdj:lock', {}, () => {});
          else s.emit('sdj:submit', { text: pick(GUESSES) }, () => {});
        } else if (my.status === 'ambiguous') {
          s.emit('sdj:choose', { teks: my.options[0] }, () => {});
        } else if ((my.status === 'notfound' || my.status === 'perlu_banding') && (my.triesLeft === 0 || Math.random() < 0.5)) {
          if (Math.random() < 0.75) s.emit('sdj:appeal', {}, () => {});
        } else if (my.triesLeft > 0) {
          s.emit('sdj:submit', { text: pick(GUESSES) }, (r) => {
            if (!r.ok && !/habis/.test(r.error)) problems.push(`${name} gagal jawab SDJ: ${r.error}`);
          });
        }
      }
    }

    // --- Fake It ---
    if (f) {
      if (f.phase === 'clue' && f.myTurn && me.turnSent !== `${f.round}:${f.clues.length}`) {
        me.turnSent = `${f.round}:${f.clues.length}`;
        await sleep(rand(300, 1200));
        const trySend = (n) => s.emit('fake:clue', { text: pick(CLUES) + (n > 2 ? n : '') }, (r) => { if (!r.ok && n < 6) trySend(n + 1); });
        trySend(0);
      }
      if (f.phase === 'vote' && f.participant && me.voted !== f.round) {
        me.voted = f.round;
        await sleep(rand(200, 900));
        const others = f.order.filter((p) => p.id !== me.id);
        // Bias toward the real impostor so the "caught + last chance" path gets exercised.
        const smart = secret && Math.random() < 0.6 && secret.impostorId !== me.id && others.find((p) => p.id === secret.impostorId);
        s.emit('fake:vote', { target: smart ? secret.impostorId : pick(others).id }, () => {});
      }
      if (f.phase === 'lastchance' && f.amImpostorGuessing && !f.alreadyGuessed && !me.guessed) {
        me.guessed = true;
        await sleep(500);
        s.emit('fake:guess', { text: Math.random() < 0.5 && secret ? secret.word : 'nggak tau' }, () => {});
      }
      if (f.phase !== 'lastchance') me.guessed = false;
    }
  });
  return me;
}

function hostClient() {
  const s = io(URL, { transports: ['websocket'], reconnectionDelay: 400, reconnectionDelayMax: 2000 });
  const h = { s, state: null };
  s.on('host:state', (v) => {
    h.state = v;
    const f = v.active && v.active.fake;
    if (f && f.secret) secret = { word: f.secret.word, impostorId: f.secret.impostor.id };
  });
  h.auth = () => new Promise((res, rej) => s.emit('host:auth', PASSWORD, (r) => (r.ok ? res() : rej(new Error(r.error)))));
  h.act = (type, a = {}) => new Promise((res) => s.emit('host:action', { type, ...a }, res));
  h.waitFor = async (pred, ms = 60000, label = '') => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (h.state && pred(h.state)) return;
      await sleep(100);
    }
    throw new Error(`Timeout menunggu: ${label}`);
  };
  return h;
}

async function main() {
  let host = null;
  if (AUTO) {
    host = hostClient();
    await new Promise((r) => host.s.on('connect', r));
    await host.auth();
    const r = await host.act('createSession', { squad: 'Squad Simulasi', color: '#2979ff' });
    if (!r.ok) throw new Error(r.error);
    await host.waitFor((v) => v.active, 5000, 'sesi aktif');
    CODE = host.state.active.code;
    console.log(`✅ Sesi dibuat, kode ${CODE}`);
  }
  if (!CODE) {
    console.error('Pakai --code ABCD atau --auto');
    process.exit(1);
  }
  const bots = Array.from({ length: N }, (_, i) => bot(i));
  await sleep(1500);
  console.log(`✅ ${bots.filter((b) => b.id).length}/${N} bot join`);

  if (!AUTO) {
    console.log('Bot siap main. Jalankan game dari panel host. Ctrl+C buat berhenti.');
    return;
  }

  // Game 1
  await host.act('bomb:settings', { patch: { fuseMin: 4, fuseMax: 7, totalRounds: BOMB_ROUNDS + 1 } });
  for (let r = 1; r <= BOMB_ROUNDS; r++) {
    if (r === BOMB_ROUNDS) await host.act('bomb:settings', { patch: { double: true, mega: true, revenge: true } });
    const res = await host.act('bomb:start');
    if (!res.ok) throw new Error(`bomb:start: ${res.error}`);
    await host.waitFor((v) => v.active.bomb.phase === 'blast' && v.active.bomb.round === r, 20000, `bom ronde ${r} meledak`);
    const lb = host.state.active.bomb.lastBlast;
    console.log(`💥 Bom ronde ${r}: ${lb.victims.map((v) => `${v.name} ${v.penalty}`).join(', ')} | jejak ${host.state.active.bomb.trail.length}`);
  }
  await host.act('bomb:end');

  // Game: Satu Dalam Sejuta
  await host.act('sdj:settings', { patch: { totalPrompts: SDJ_ROUNDS, answerSec: 8, doubleLast: true } });
  const scoreOf = (pid) => host.state.active.players.find((p) => p.id === pid).score;
  for (let r = 1; r <= SDJ_ROUNDS; r++) {
    const res = await host.act('sdj:start');
    if (!res.ok) throw new Error(`sdj:start: ${res.error}`);
    await host.waitFor((v) => v.active.sdj.phase === 'jawab' && v.active.sdj.round === r, 5000, 'fase jawab');
    // Judge appeals as they come in: alternate Sah (tier 4) / Tolak. Leave nothing for the 30s auto-Sah.
    let n = 0;
    while (true) {
      await host.waitFor((v) => ['banding', 'reveal', 'hasil'].includes(v.active.sdj.phase) || (v.active.sdj.queue || []).some((q) => q.status === 'banding'), 30000, 'banding/reveal');
      const d = host.state.active.sdj;
      if (['reveal', 'hasil'].includes(d.phase)) break;
      const q = d.queue.find((x) => x.status === 'banding');
      if (!q) { await sleep(100); continue; }
      const verdict = n++ % 2 === 0 ? 'sah' : 'tolak';
      const jr = await host.act('sdj:judge', { pid: q.id, verdict, tier: 4 });
      if (!jr.ok && !/udah diputus|Nggak ada sidang/.test(jr.error)) problems.push(`judge gagal: ${jr.error}`);
    }
    await host.waitFor((v) => v.active.sdj.phase === 'hasil' && v.active.sdj.round === r, 60000, 'hasil prompt');
    const d = host.state.active.sdj;
    const summary = d.answers.map((a) => `${a.name}:${a.teks || a.raw || '-'}(${a.result ? a.result.points : 0})`).join(', ');
    console.log(`🐙 SDJ prompt ${r} "${d.prompt}"${d.double ? ' ×2' : ''} | ${summary}`);
    // Bots' own result must be visible after the reveal, and the reveal must have shown every player.
    for (const b of bots) {
      const bd = b.state && b.state.sdj;
      if (bd && !bd.myResult) problems.push(`${b.name} nggak dapat hasil SDJ setelah reveal`);
    }
    if (r === 1) {
      // Correction: force first player to tier 5 → score must change by exactly the rescored difference.
      const a = d.answers[0];
      const before = scoreOf(a.id);
      const cr = await host.act('sdj:correct', { pid: a.id, tier: 5, text: a.teks ? '' : 'Jawaban Koreksi' });
      if (!cr.ok) problems.push(`koreksi gagal: ${cr.error}`);
      await sleep(300);
      const after = host.state.active.sdj.answers[0].result.points;
      const exp = before - (a.result ? a.result.points : 0) + after;
      if (scoreOf(a.id) !== exp) problems.push(`Skor setelah koreksi ${scoreOf(a.id)}, harusnya ${exp}`);
      else console.log(`✅ Koreksi host: ${a.name} → tier 5, skor ${before} → ${scoreOf(a.id)}`);
    }
  }
  await host.act('sdj:end');

  // Game 2
  await host.act('fake:settings', { patch: { discussSec: 10, clueSec: 8, voteSec: 10, totalRounds: FAKE_ROUNDS } });
  for (let r = 1; r <= FAKE_ROUNDS; r++) {
    const res = await host.act('fake:start');
    if (!res.ok) throw new Error(`fake:start: ${res.error}`);
    await host.waitFor((v) => v.active.fake.phase === 'role', 5000, 'fase role');
    const order = host.state.active.fake.order.map((p) => p.id);
    const impIdx = order.indexOf(host.state.active.fake.secret.impostor.id);
    if (impIdx < 2) problems.push(`Penipu di posisi ${impIdx + 1} (harusnya ≥3)`);
    await host.act('fake:skip'); // skip role phase
    await host.waitFor((v) => v.active.fake.phase === 'discuss', 120000, 'fase diskusi');
    const clues = host.state.active.fake.clues;
    if (clues.length !== order.length * 2) problems.push(`Jumlah petunjuk ${clues.length}, harusnya ${order.length * 2}`);
    await host.act('fake:skip'); // skip discussion
    await host.waitFor((v) => v.active.fake.phase === 'result' && v.active.fake.round === r, 120000, 'hasil ronde');
    const f = host.state.active.fake;
    console.log(`🎭 Fake ronde ${r}: kata "${f.word}", penipu ${f.secret ? f.secret.impostor.name : '?'} | ${f.result.captions.join(' / ')}`);
  }
  await host.act('fake:end');

  await host.act('revealFinal');
  await sleep(500);
  const a = host.state.active;
  console.log('\n🏆 Leaderboard:');
  a.players.forEach((p) => console.log(`  #${p.rank} ${p.avatar} ${p.name}: ${p.score}`));
  console.log('🏅 Gelar:');
  a.titles.forEach((t) => console.log(`  ${t.icon} ${t.title}: ${t.winners.map((w) => w.name).join(', ')} (${t.value})`));

  // Reconnect test: a bot drops and resumes with its token
  const victim = bots[0];
  victim.s.disconnect();
  await sleep(300);
  await host.waitFor((v) => v.active.players.some((p) => p.id === victim.id && !p.online), 15000, 'bot offline');
  victim.s.connect();
  await host.waitFor((v) => v.active.players.some((p) => p.id === victim.id && p.online), 15000, 'bot online lagi');
  if (!victim.resumed) problems.push('Bot reconnect tidak lewat resume');
  if (!victim.state || victim.state.me.id !== victim.id) problems.push('State setelah resume tidak sesuai');
  console.log('✅ Tes reconnect: offline terdeteksi, resume berhasil, state kembali');

  if (!opt('keep', false)) {
    await host.act('closeSession', { id: a.id });
  }

  console.log(problems.length ? `\n❌ ${problems.length} masalah:\n - ${problems.join('\n - ')}` : '\n✅ Semua beres, nggak ada masalah.');
  process.exit(problems.length ? 1 : 0);
}

main().catch((e) => {
  console.error('❌', e.message);
  if (problems.length) console.error(problems.join('\n'));
  process.exit(1);
});
