// Game: Satu Dalam Sejuta (PRD_SATU_DALAM_SEJUTA.md).
// SECURITY: phones never receive the answer list, tiers, or other players' answers before reveal.
// All matching happens here on the server.
const { pick, shuffle, norm, clamp } = require('./util');
const matcher = require('./matcher');
const promptbank = require('./promptbank');

const MAX_TRIES = 3; // first try + 2 retries (PRD §3)
const BANDING_MS = 30000; // per appeal; then auto-Sah at tier 3
const AUTO_TIER = 3;
const REVEAL = { intro: 2600, step: 2300, mutiara: 4500, hold: 2500 };
const BUSY = ['jawab', 'banding', 'reveal'];
const ANSWER_MAX = 40;

// Simple profanity list. Only checked for answers that are NOT in the bank (so "Anjing" the animal is fine).
const KASAR = ['kontol', 'memek', 'ngentot', 'entot', 'jancok', 'jancuk', 'cok', 'bangsat', 'bajingan', 'tolol', 'goblok', 'goblog', 'kampret', 'pepek', 'titit', 'perek', 'lonte', 'pelacur', 'bego', 'idiot', 'tai', 'taik', 'fuck', 'shit', 'bitch', 'asu', 'jembut', 'pantek', 'puki', 'sundal'];

const err = (error) => ({ ok: false, error });
const isBusy = (s) => !!s.sdj && BUSY.includes(s.sdj.phase);

function defaultState() {
  return {
    settings: { totalPrompts: 7, answerSec: 25, doubleLast: true, nextPrompt: null },
    round: 0,
    usedPrompts: [],
    rounds: [], // finished prompts: { round, promptId, prompt, double, results: { pid: result } }
    phase: 'idle', // idle | jawab | banding | reveal | hasil | over
    r: null,
  };
}

const cleanText = (raw) => String(raw || '').replace(/\s+/g, ' ').trim().slice(0, ANSWER_MAX);
const isKasar = (text) => {
  const words = String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const whole = norm(text);
  return words.some((w) => KASAR.includes(w)) || KASAR.some((k) => k.length >= 5 && whole.includes(k));
};
const titleCase = (t) => cleanText(t).replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());

// ---------------- Scoring (pure) ----------------
/**
 * entries: { pid: { valid, key, tier, mutiara, sok, label, banding, auto, ditolak } }
 * Returns { pid: { ...entry, zona, emoji, depth, base, points, collision, solo, ngambang } } + satuOtak flag.
 */
function scoreEntries(entries, skoring, double) {
  const mod = skoring.modifier;
  const counts = {};
  for (const e of Object.values(entries)) if (e.valid) counts[e.key] = (counts[e.key] || 0) + 1;
  const out = {};
  for (const [pid, e] of Object.entries(entries)) {
    if (!e.valid) {
      out[pid] = { ...e, ngambang: true, zona: 'Ngambang', emoji: '🫧', depth: 0, base: 0, points: mod.ngambang_poin, collision: false, solo: false };
      continue;
    }
    const z = e.mutiara ? skoring.mutiara : skoring.tier[String(e.tier)];
    const collision = counts[e.key] >= 2;
    let points = collision ? Math.round((z.poin * mod.tabrakan_persen) / 100) : z.poin + mod.sendirian_bonus;
    if (double) points *= mod.prompt_terakhir_kali;
    out[pid] = { ...e, ngambang: false, zona: z.zona, emoji: z.emoji || '', depth: z.kedalaman_m, base: z.poin, points, collision, solo: !collision };
  }
  const list = Object.values(entries);
  const keys = new Set(list.filter((e) => e.valid).map((e) => e.key));
  const satuOtak = list.length >= 2 && list.every((e) => e.valid) && keys.size === 1;
  return { results: out, satuOtak };
}

// ---------------- Helpers ----------------
function totalPrompts(s) {
  return s.sdj.settings.totalPrompts;
}

function ans(r, pid) {
  if (!r.answers[pid]) r.answers[pid] = { raw: '', teks: null, status: null, options: null, tries: 0, locked: false, alasan: '', kasar: false, tier: null, tierOverride: null, auto: false };
  return r.answers[pid];
}

const snapAnswer = (r, teks) => r.snap.jawaban.find((j) => j.teks === teks) || null;

function entryFor(r, pid) {
  const a = r.answers[pid];
  if (a && a.status === 'found') {
    const j = snapAnswer(r, a.teks);
    if (j) {
      const over = a.tierOverride != null;
      return { valid: true, key: 'a:' + norm(j.teks), label: j.teks, tier: over ? a.tierOverride : j.tier, mutiara: !over && !!j.mutiara, sok: !!j.sok_pinter, banding: false };
    }
  }
  if (a && a.status === 'sah') return { valid: true, key: 'b:' + norm(a.raw), label: a.raw, tier: a.tier, mutiara: false, sok: false, banding: true, auto: !!a.auto };
  return { valid: false, key: '', label: (a && a.raw) || '', tier: 0, mutiara: false, sok: false, banding: a && a.status === 'tolak', ditolak: !!a && a.status === 'tolak' };
}

function computeResults(s, r) {
  const entries = {};
  for (const pid of r.pids) if (s.players[pid]) entries[pid] = entryFor(r, pid);
  return scoreEntries(entries, r.skoring, r.double);
}

/** Group results into reveal steps, shallow → deep, with time offsets. */
function buildSteps(results) {
  const groups = new Map();
  for (const [pid, e] of Object.entries(results)) {
    const k = e.ngambang ? '~ngambang' : e.key;
    if (!groups.has(k)) groups.set(k, { key: k, pids: [], ...e });
    groups.get(k).pids.push(pid);
  }
  const list = shuffle([...groups.values()]).sort((a, b) => (a.ngambang === b.ngambang ? 0 : a.ngambang ? -1 : 1) || a.depth - b.depth || (a.mutiara ? 1 : 0) - (b.mutiara ? 1 : 0));
  let t = REVEAL.intro;
  return list.map((g) => {
    const step = {
      at: t,
      label: g.ngambang ? '' : g.label,
      pids: g.pids,
      ngambang: g.ngambang,
      tier: g.tier,
      mutiara: g.mutiara,
      sok: g.sok,
      banding: g.banding && !g.ngambang,
      zona: g.zona,
      emoji: g.emoji,
      depth: g.depth,
      points: g.points,
      collision: g.collision,
      solo: g.solo,
    };
    t += g.mutiara ? REVEAL.mutiara : REVEAL.step;
    return step;
  });
}

function revealEnd(steps) {
  if (!steps.length) return REVEAL.intro + REVEAL.hold;
  const last = steps[steps.length - 1];
  return last.at + (last.mutiara ? REVEAL.mutiara : REVEAL.step) + REVEAL.hold;
}

/** 3 rare answers nobody said (+ the Mutiara if nobody found it). */
function deeper(r, results) {
  const said = new Set(Object.values(results).filter((e) => e.valid && !e.banding).map((e) => e.label));
  const pool = r.snap.jawaban.filter((j) => !j.mutiara && !said.has(j.teks));
  const rare = [...shuffle(pool.filter((j) => j.tier === 5)), ...shuffle(pool.filter((j) => j.tier === 4))].slice(0, 3);
  const mut = r.snap.jawaban.find((j) => j.mutiara);
  const z = (t) => r.skoring.tier[String(t)];
  return {
    rare: rare.map((j) => ({ teks: j.teks, zona: z(j.tier).zona, emoji: z(j.tier).emoji || '', depth: z(j.tier).kedalaman_m })),
    mutiara: mut && !said.has(mut.teks) ? { teks: mut.teks, zona: r.skoring.mutiara.zona, emoji: r.skoring.mutiara.emoji || '🦪', depth: r.skoring.mutiara.kedalaman_m } : null,
  };
}

// ---------------- Flow ----------------
function choosePrompt(s, ctx) {
  const bank = promptbank.get();
  const used = new Set(s.sdj.usedPrompts);
  const free = bank.prompts.filter((p) => !used.has(p.id));
  if (!free.length) return null;
  const want = s.sdj.settings.nextPrompt;
  const manual = want && free.find((p) => p.id === want);
  if (manual) return manual;
  // Least used across all squads first, random among ties.
  const usage = ctx.promptUsage();
  const min = Math.min(...free.map((p) => usage[p.id] || 0));
  return pick(free.filter((p) => (usage[p.id] || 0) === min));
}

function start(s, ctx) {
  const g = s.sdj;
  if (isBusy(s)) return err('Prompt masih jalan!');
  if (ctx.bombBusy(s)) return err('Ronde Bom masih jalan. Tunggu meledak dulu 💣');
  if (ctx.fakeBusy(s)) return err('Ronde Fake It masih jalan. Selesaikan dulu.');
  if (g.round >= totalPrompts(s)) return err(`Sudah ${g.round} prompt. Naikkan jumlah prompt kalau mau lanjut.`);
  if (ctx.onlinePlayers(s).length < 2) return err('Minimal 2 pemain online buat Satu Dalam Sejuta.');
  const p = choosePrompt(s, ctx);
  if (!p) return err('Semua prompt di bank sudah dipakai di sesi ini! Tambah prompt di tab Bank Jawaban.');
  const bank = promptbank.get();

  const now = ctx.now();
  g.round += 1;
  g.usedPrompts.push(p.id);
  g.settings.nextPrompt = null;
  ctx.bumpPromptUsage(p.id);
  g.phase = 'jawab';
  g.r = {
    promptId: p.id,
    prompt: p.prompt,
    bebas: !!p.kategori_bebas_tambah,
    snap: JSON.parse(JSON.stringify(p)), // edits to the bank mid-prompt don't change scoring
    sering: JSON.parse(JSON.stringify(promptbank.seringFor(bank, p.id))),
    skoring: JSON.parse(JSON.stringify(bank.skoring)),
    double: g.settings.doubleLast && g.round >= totalPrompts(s),
    startedAt: now,
    phaseEndsAt: now + g.settings.answerSec * 1000,
    answers: {},
    queue: [],
    cur: null,
    pids: [],
    reveal: null,
    result: null,
    deeper: null,
    applied: null,
  };
  s.activeGame = 'sdj';
  s.overlay = null;
  ctx.fx(s, { type: 'sdj:start', round: g.round });
  ctx.changed(s);
  return { ok: true };
}

const jawabRound = (s) => (s.sdj.phase === 'jawab' && s.sdj.r) || null;
const NOT_NOW = 'Waktu jawab udah habis ⏰';

function submit(s, ctx, pid, raw) {
  const r = jawabRound(s);
  if (!r) return err(NOT_NOW);
  const a = ans(r, pid);
  if (a.locked) return err('Jawabanmu udah dikunci 🔒');
  const text = cleanText(raw);
  if (!norm(text)) return err('Isi jawabannya dulu!');
  if (a.tries >= MAX_TRIES) return err('Kesempatan ngetik habis. Kunci atau ajukan banding!');
  const m = matcher.match(r.snap, text, r.sering);
  Object.assign(a, { raw: text, teks: null, options: null, alasan: '', kasar: false });
  if (m.type === 'found') {
    a.tries += 1;
    a.status = 'found';
    a.teks = m.answer.teks;
  } else if (m.type === 'ambiguous') {
    a.status = 'ambiguous'; // choosing an option is what costs the try
    a.options = m.options.map((o) => o.teks);
  } else if (m.type === 'sering_salah') {
    a.tries += 1;
    a.status = 'perlu_banding';
    a.alasan = m.alasan;
  } else {
    a.tries += 1;
    a.status = 'notfound';
    a.kasar = isKasar(text);
  }
  ctx.changed(s);
  return { ok: true, status: a.status, teks: a.teks, options: a.options, triesLeft: MAX_TRIES - a.tries };
}

function choose(s, ctx, pid, teks) {
  const r = jawabRound(s);
  if (!r) return err(NOT_NOW);
  const a = ans(r, pid);
  if (a.locked) return err('Jawabanmu udah dikunci 🔒');
  if (a.status !== 'ambiguous' || !a.options || !a.options.includes(teks)) return err('Pilihan nggak valid.');
  a.tries += 1;
  a.status = 'found';
  a.teks = teks;
  a.options = null;
  ctx.changed(s);
  return { ok: true, status: 'found', teks };
}

function lock(s, ctx, pid) {
  const r = jawabRound(s);
  if (!r) return err(NOT_NOW);
  const a = ans(r, pid);
  if (a.locked) return { ok: true };
  if (a.status !== 'found') return err('Belum ada jawaban yang diterima buat dikunci.');
  a.locked = true;
  ctx.fx(s, { type: 'sdj:locked', pid });
  ctx.changed(s);
  checkAllDone(s, ctx);
  return { ok: true };
}

function appeal(s, ctx, pid) {
  const r = jawabRound(s);
  if (!r) return err(NOT_NOW);
  const a = ans(r, pid);
  if (a.locked) return err('Jawabanmu udah dikunci 🔒');
  if (!['notfound', 'perlu_banding'].includes(a.status) || !norm(a.raw)) return err('Nggak ada jawaban yang bisa dibanding.');
  a.status = 'banding';
  a.locked = true;
  if (!r.queue.includes(pid)) r.queue.push(pid);
  // Same answer already judged this prompt → same verdict, so two players never get different rulings for it.
  const prev = r.queue.map((p) => r.answers[p]).find((b) => b && b !== a && ['sah', 'tolak'].includes(b.status) && norm(b.raw) === norm(a.raw));
  if (prev) Object.assign(a, { status: prev.status, tier: prev.tier, auto: prev.auto });
  ctx.fx(s, { type: 'sdj:appeal', pid });
  ctx.fx(s, { type: 'sdj:locked', pid });
  ctx.changed(s);
  checkAllDone(s, ctx);
  return { ok: true };
}

function checkAllDone(s, ctx) {
  const r = s.sdj.r;
  const online = Object.keys(s.players).filter((pid) => ctx.isOnline(s, pid));
  if (online.length && online.every((pid) => r.answers[pid] && r.answers[pid].locked)) endAnswer(s, ctx);
}

function endAnswer(s, ctx) {
  const g = s.sdj;
  const r = g.r;
  if (g.phase !== 'jawab' || !r) return err('Bukan fase jawab.');
  r.pids = Object.keys(s.players);
  for (const pid of r.pids) {
    const a = ans(r, pid);
    // A matched answer counts even if not locked. Anything else that wasn't appealed floats.
    if (a.status === 'found' || a.status === 'banding' || a.status === 'sah' || a.status === 'tolak') a.locked = true;
    else a.status = 'ngambang';
  }
  r.phaseEndsAt = 0;
  ctx.fx(s, { type: 'sdj:phase', phase: 'banding' });
  nextBanding(s, ctx);
  return { ok: true };
}

function nextBanding(s, ctx) {
  const g = s.sdj;
  const r = g.r;
  const pid = r.queue.find((p) => s.players[p] && r.answers[p] && r.answers[p].status === 'banding');
  if (!pid) return beginReveal(s, ctx);
  g.phase = 'banding';
  r.cur = { pid, endsAt: ctx.now() + BANDING_MS };
  ctx.fx(s, { type: 'sdj:banding', pid, raw: r.answers[pid].raw });
  ctx.changed(s);
}

function saveToBank(promptId, text, tier) {
  const d = promptbank.clone();
  const p = promptbank.findPrompt(d, promptId);
  if (!p) return err('Prompt nggak ada lagi di bank.');
  const teks = titleCase(matcher.stripPrefix(p, text));
  const k = norm(teks);
  if (p.jawaban.some((j) => [j.teks, ...(j.alias || [])].some((t) => norm(t) === k))) return { ok: true, already: true };
  p.jawaban.push({ teks, tier });
  // A saved answer must stop being "sering salah" for this prompt, or the matcher would keep sending it to banding.
  d.sering_salah = (d.sering_salah || []).filter((x) => !(x.prompt_id === promptId && norm(x.jawaban) === k));
  return promptbank.save(d);
}

/** Host decision. verdict: 'sah' | 'tolak'. Same answer from other players gets the same verdict. */
function judge(s, ctx, { pid, verdict, tier, save }) {
  const g = s.sdj;
  const r = g.r;
  if (!r || !['jawab', 'banding'].includes(g.phase)) return err('Nggak ada sidang banding sekarang.');
  const a = r.answers[pid];
  if (!a || a.status !== 'banding') return err('Banding itu udah diputus atau nggak ada.');
  if (!['sah', 'tolak'].includes(verdict)) return err('Putusan nggak dikenal.');
  const t = clamp(Math.round(Number(tier) || AUTO_TIER), 1, 5);
  const k = norm(a.raw);
  let saved = null;
  for (const p of r.queue) {
    const b = r.answers[p];
    if (!b || b.status !== 'banding' || norm(b.raw) !== k) continue;
    if (verdict === 'sah') Object.assign(b, { status: 'sah', tier: t, auto: false });
    else b.status = 'tolak';
  }
  if (verdict === 'sah' && save) {
    saved = saveToBank(r.promptId, a.raw, t);
    if (!saved.ok) console.error('[sdj] Gagal simpan ke bank:', saved.error);
  }
  ctx.fx(s, { type: 'sdj:judged', pid, verdict });
  if (g.phase === 'banding' && r.cur && (!r.answers[r.cur.pid] || r.answers[r.cur.pid].status !== 'banding')) nextBanding(s, ctx);
  ctx.changed(s);
  if (saved && !saved.ok) return { ok: true, warning: `Putusan tersimpan, tapi gagal simpan ke daftar: ${saved.error}` };
  return { ok: true, saved: !!(saved && saved.ok && !saved.already) };
}

function beginReveal(s, ctx) {
  const g = s.sdj;
  const r = g.r;
  const { results, satuOtak } = computeResults(s, r);
  const steps = buildSteps(results);
  const now = ctx.now();
  r.cur = null;
  r.result = { results, satuOtak };
  r.deeper = deeper(r, results);
  r.reveal = { startedAt: now, intro: REVEAL.intro, steps, shown: 0, end: revealEnd(steps) };
  r.phaseEndsAt = now + r.reveal.end;
  g.phase = 'reveal';
  ctx.fx(s, { type: 'sdj:phase', phase: 'reveal' });
  ctx.changed(s);
}

function roundRecord(r, results, round) {
  const out = {};
  for (const [pid, e] of Object.entries(results)) {
    out[pid] = { label: e.label, tier: e.tier, mutiara: e.mutiara, sok: e.sok, depth: e.depth, points: e.points, ngambang: e.ngambang, collision: e.collision, solo: e.solo, banding: e.banding };
  }
  return { round, promptId: r.promptId, prompt: r.prompt, double: r.double, results: out };
}

function toHasil(s, ctx) {
  const g = s.sdj;
  const r = g.r;
  const results = r.result.results;
  r.applied = {};
  for (const [pid, e] of Object.entries(results)) {
    r.applied[pid] = e.points;
    ctx.addScore(s, pid, e.points, `Satu Dalam Sejuta #${g.round}`);
  }
  g.rounds = g.rounds.filter((x) => x.round !== g.round);
  g.rounds.push(roundRecord(r, results, g.round));
  r.reveal.shown = r.reveal.steps.length;
  r.phaseEndsAt = 0;
  g.phase = 'hasil';
  ctx.fx(s, { type: 'sdj:hasil', satuOtak: r.result.satuOtak, mutiara: Object.values(results).some((e) => e.mutiara) });
  ctx.changed(s);
}

/**
 * Host fixes one player's answer after the reveal; the whole prompt is rescored and only the difference is applied.
 * fix: { text } (re-match against this prompt's list), { tier: 1–5 } (override / Sah at tier), { tier: 0 } (Ngambang), or { text, tier } (Sah this text).
 */
function correct(s, ctx, { pid, text, tier }) {
  const g = s.sdj;
  const r = g.r;
  if (!r || !r.applied) return err('Koreksi cuma bisa setelah reveal prompt terakhir.');
  if (!r.pids.includes(pid) || !s.players[pid]) return err('Pemain nggak ikut prompt ini.');
  const a = ans(r, pid);
  const t = tier === '' || tier == null ? null : Math.round(Number(tier));
  const txt = cleanText(text);
  if (t != null && (isNaN(t) || t < 0 || t > 5)) return err('Tier harus 0–5 (0 = Ngambang).');
  if (txt && t == null) {
    const m = matcher.match(r.snap, txt, []);
    if (m.type === 'found') Object.assign(a, { status: 'found', teks: m.answer.teks, raw: txt, tierOverride: null });
    else if (m.type === 'ambiguous') return err(`Ambigu: ${m.options.map((o) => o.teks).join(' / ')}. Ketik lebih lengkap.`);
    else return err('Nggak ketemu di daftar. Isi tier juga buat nge-Sah-kan teks ini.');
  } else if (t === 0) {
    a.status = 'tolak';
  } else if (t != null) {
    if (txt) Object.assign(a, { status: 'sah', raw: txt, tier: t, auto: false, teks: null });
    else if (a.status === 'found') a.tierOverride = t;
    else if (norm(a.raw)) Object.assign(a, { status: 'sah', tier: t, auto: false });
    else return err('Pemain ini nggak jawab apa-apa. Isi teks jawabannya juga.');
  } else return err('Isi teks atau tier.');

  const prevApplied = r.applied;
  const { results, satuOtak } = computeResults(s, r);
  r.result = { results, satuOtak };
  const now = {};
  for (const [p, e] of Object.entries(results)) {
    now[p] = e.points;
    const diff = e.points - (prevApplied[p] || 0);
    if (diff) ctx.addScore(s, p, diff, `Koreksi host Satu Dalam Sejuta #${g.round}`);
  }
  r.applied = now;
  const steps = buildSteps(results);
  r.reveal = { ...r.reveal, steps, shown: steps.length, end: revealEnd(steps) };
  r.deeper = deeper(r, results);
  const rec = g.rounds.find((x) => x.round === g.round);
  const fresh = roundRecord(r, results, g.round);
  if (rec) rec.results = fresh.results;
  else g.rounds.push(fresh);
  ctx.fx(s, { type: 'sdj:corrected', pid });
  ctx.changed(s);
  return { ok: true };
}

function tick(s, ctx, now) {
  const g = s.sdj;
  if (!g || !isBusy(s) || !g.r) return;
  const r = g.r;
  if (g.phase === 'jawab') {
    if (now >= r.phaseEndsAt) endAnswer(s, ctx);
  } else if (g.phase === 'banding') {
    if (!r.cur || !s.players[r.cur.pid]) return void nextBanding(s, ctx);
    if (now >= r.cur.endsAt) {
      // Host forgot: auto-Sah at tier 3 so the game keeps moving (host can correct later).
      const k = norm(r.answers[r.cur.pid].raw);
      for (const p of r.queue) {
        const b = r.answers[p];
        if (b && b.status === 'banding' && norm(b.raw) === k) Object.assign(b, { status: 'sah', tier: AUTO_TIER, auto: true });
      }
      ctx.fx(s, { type: 'sdj:judged', pid: r.cur.pid, verdict: 'sah', auto: true });
      nextBanding(s, ctx);
    }
  } else if (g.phase === 'reveal') {
    const el = now - r.reveal.startedAt;
    const shown = r.reveal.steps.filter((st) => st.at <= el).length;
    if (shown !== r.reveal.shown) {
      r.reveal.shown = shown; // phones learn their own result once their step is on the big screen
      ctx.changed(s);
    }
    if (now >= r.phaseEndsAt) toHasil(s, ctx);
  }
}

// ---------------- Host controls ----------------
function addTime(s, ctx, sec = 15) {
  const g = s.sdj;
  if (!g.r) return err('Nggak ada prompt yang jalan.');
  if (g.phase === 'jawab') g.r.phaseEndsAt += sec * 1000;
  else if (g.phase === 'banding' && g.r.cur) g.r.cur.endsAt += sec * 1000;
  else return err('Fase ini nggak pakai timer yang bisa ditambah.');
  ctx.changed(s);
  return { ok: true };
}

function skip(s, ctx) {
  const g = s.sdj;
  if (g.phase === 'jawab') return endAnswer(s, ctx);
  if (g.phase === 'reveal') { toHasil(s, ctx); return { ok: true }; }
  return err('Fase ini nggak bisa di-skip.');
}

function end(s, ctx) {
  const g = s.sdj;
  if (g.phase === 'reveal') toHasil(s, ctx);
  if (['jawab', 'banding'].includes(g.phase) && g.r) {
    // Unfinished prompt doesn't count (it stays "used" so it won't come back this session).
    g.round = Math.max(0, g.round - 1);
    g.r = null;
  }
  g.phase = 'over';
  s.activeGame = 'sdj';
  ctx.fx(s, { type: 'sdj:over' });
  ctx.changed(s);
  return { ok: true };
}

function setSettings(s, ctx, patch) {
  const st = s.sdj.settings;
  const num = (v, lo, hi) => clamp(Math.round(Number(v)), lo, hi);
  if (patch.totalPrompts != null && !isNaN(patch.totalPrompts)) st.totalPrompts = num(patch.totalPrompts, Math.max(1, s.sdj.round), promptbank.get().prompts.length);
  if (patch.answerSec != null && !isNaN(patch.answerSec)) st.answerSec = num(patch.answerSec, 10, 120);
  if ('doubleLast' in patch) st.doubleLast = !!patch.doubleLast;
  if ('nextPrompt' in patch) {
    const id = patch.nextPrompt || null;
    if (id && !promptbank.findPrompt(promptbank.get(), id)) return err('Prompt nggak ada di bank.');
    if (id && s.sdj.usedPrompts.includes(id)) return err('Prompt itu sudah dipakai di sesi ini.');
    st.nextPrompt = id;
  }
  const r = s.sdj.r;
  if (r && !r.applied && ('doubleLast' in patch || 'totalPrompts' in patch)) r.double = st.doubleLast && s.sdj.round >= st.totalPrompts;
  ctx.changed(s);
  return { ok: true };
}

/** Per-player totals across finished prompts (used for standings and end-of-event titles). */
function totals(s) {
  const t = {};
  for (const rd of s.sdj ? s.sdj.rounds : []) {
    for (const [pid, e] of Object.entries(rd.results)) {
      const x = (t[pid] = t[pid] || { points: 0, depth: 0, surface: 0, sok: 0, mutiara: 0, prompts: 0 });
      x.points += e.points;
      x.depth += e.depth;
      x.prompts += 1;
      if (!e.ngambang && e.tier === 1 && !e.mutiara) x.surface += 1;
      if (e.sok) x.sok += 1;
      if (e.mutiara) x.mutiara += 1;
    }
  }
  return t;
}

// ---------------- Views ----------------
const pub = (s, pid) => {
  const p = s.players[pid];
  return p ? { id: p.id, name: p.name, avatar: p.avatar, color: p.color } : { id: pid, name: '???', avatar: '❓', color: '#888' };
};

function standings(s) {
  const t = totals(s);
  const last = s.sdj.r && s.sdj.r.applied ? s.sdj.r.applied : {};
  return Object.keys(s.players)
    .map((pid) => ({ ...pub(s, pid), last: last[pid] != null ? last[pid] : null, points: (t[pid] || {}).points || 0, depth: (t[pid] || {}).depth || 0 }))
    .sort((a, b) => b.points - a.points || b.depth - a.depth || a.name.localeCompare(b.name));
}

function zones(sk) {
  return [1, 2, 3, 4, 5].map((t) => ({ tier: t, zona: sk.tier[t].zona, emoji: sk.tier[t].emoji || '', depth: sk.tier[t].kedalaman_m, poin: sk.tier[t].poin }))
    .concat([{ tier: 6, mutiara: true, zona: sk.mutiara.zona, emoji: sk.mutiara.emoji || '🦪', depth: sk.mutiara.kedalaman_m, poin: sk.mutiara.poin }]);
}

function base(s, ctx) {
  const g = s.sdj;
  const r = g.r;
  const sk = r ? r.skoring : promptbank.get().skoring;
  const v = { phase: g.phase, round: g.round, totalPrompts: totalPrompts(s), zones: zones(sk), modifier: sk.modifier };
  if (!r) return v;
  v.prompt = r.prompt;
  v.double = r.double;
  v.phaseEndsAt = g.phase === 'jawab' ? r.phaseEndsAt : 0;
  v.lockedIds = Object.keys(r.answers).filter((pid) => r.answers[pid].locked && s.players[pid]);
  v.answeredIds = Object.keys(r.answers).filter((pid) => norm(r.answers[pid].raw) && s.players[pid]);
  // Appeals are public on purpose: the big screen shows "Buah Kepel?" for the room to argue about.
  v.banding = r.queue.filter((pid) => s.players[pid] && r.answers[pid]).map((pid) => {
    const a = r.answers[pid];
    return { ...pub(s, pid), raw: a.raw, status: a.status === 'banding' ? 'menunggu' : a.status, auto: !!a.auto };
  });
  v.cur = g.phase === 'banding' && r.cur ? { ...pub(s, r.cur.pid), raw: r.answers[r.cur.pid].raw, endsAt: r.cur.endsAt } : null;
  if (['hasil', 'over'].includes(g.phase) && r.applied) {
    v.satuOtak = r.result.satuOtak;
    v.deeper = r.deeper;
    v.standings = standings(s);
  }
  return v;
}

function playerView(s, ctx, pid) {
  const g = s.sdj;
  const r = g.r;
  const v = base(s, ctx);
  delete v.zones;
  if (!r) return v;
  const a = r.answers[pid];
  v.my = a
    ? { raw: a.raw, teks: a.teks, status: a.status, options: a.options, triesLeft: MAX_TRIES - a.tries, locked: a.locked, sering: a.status === 'perlu_banding' }
    : { raw: '', teks: null, status: null, options: null, triesLeft: MAX_TRIES, locked: false };
  v.maxTries = MAX_TRIES;
  if (r.reveal && r.result) {
    // Only once this player's group has been shown on the big screen.
    const shown = r.reveal.steps.slice(0, g.phase === 'reveal' ? r.reveal.shown : r.reveal.steps.length);
    if (shown.some((st) => st.pids.includes(pid))) {
      const e = r.result.results[pid];
      v.myResult = { label: e.label, zona: e.zona, emoji: e.emoji, depth: e.depth, points: e.points, ngambang: e.ngambang, ditolak: !!e.ditolak, collision: e.collision, solo: e.solo, sok: e.sok, mutiara: e.mutiara };
    }
  }
  return v;
}

function screenView(s, ctx) {
  const g = s.sdj;
  const r = g.r;
  const v = base(s, ctx);
  if (r && r.reveal && ['reveal', 'hasil', 'over'].includes(g.phase)) {
    v.reveal = { startedAt: r.reveal.startedAt, intro: r.reveal.intro, steps: r.reveal.steps, end: r.reveal.end, done: g.phase !== 'reveal' };
    v.pids = r.pids.filter((pid) => s.players[pid]).map((pid) => pub(s, pid));
  }
  return v;
}

function hostView(s, ctx) {
  const g = s.sdj;
  const r = g.r;
  const v = base(s, ctx);
  const bank = promptbank.get();
  const usage = ctx.promptUsage();
  v.settings = g.settings;
  v.maxTries = MAX_TRIES;
  v.bandingSec = BANDING_MS / 1000;
  v.prompts = bank.prompts.map((p) => ({ id: p.id, prompt: p.prompt, count: p.jawaban.length, used: g.usedPrompts.includes(p.id), usage: usage[p.id] || 0 }));
  if (r) {
    v.promptId = r.promptId;
    v.bebas = r.bebas;
    v.cur = r.cur ? { ...pub(s, r.cur.pid), raw: r.answers[r.cur.pid].raw, endsAt: r.cur.endsAt } : null;
    const ids = [...new Set([...Object.keys(s.players), ...Object.keys(r.answers)])].filter((pid) => s.players[pid]);
    v.answers = ids.map((pid) => {
      const a = r.answers[pid] || {};
      const j = a.teks ? snapAnswer(r, a.teks) : null;
      return {
        ...pub(s, pid),
        online: ctx.isOnline(s, pid),
        raw: a.raw || '',
        teks: a.teks || null,
        status: a.status || null,
        tries: a.tries || 0,
        locked: !!a.locked,
        tier: a.status === 'sah' ? a.tier : a.status !== 'found' ? null : a.tierOverride != null ? a.tierOverride : j ? j.tier : null,
        override: a.status === 'found' && a.tierOverride != null,
        mutiara: !!(a.status === 'found' && j && j.mutiara && a.tierOverride == null),
        sok: !!(a.status === 'found' && j && j.sok_pinter),
        catatan: (j && j.catatan) || '',
        alasan: a.alasan || '',
        kasar: !!a.kasar,
        auto: !!a.auto,
        options: a.options || null,
        result: r.result && r.result.results[pid] ? { points: r.result.results[pid].points, zona: r.result.results[pid].zona, collision: r.result.results[pid].collision, solo: r.result.results[pid].solo } : null,
      };
    });
    v.queue = r.queue.filter((pid) => s.players[pid] && r.answers[pid]).map((pid) => {
      const a = r.answers[pid];
      return { ...pub(s, pid), raw: a.raw, status: a.status, tier: a.tier, auto: !!a.auto, alasan: a.alasan || '', kasar: !!a.kasar };
    });
    v.canCorrect = !!r.applied;
  }
  return v;
}

module.exports = {
  defaultState, start, submit, choose, lock, appeal, endAnswer, judge, correct, tick, addTime, skip, end, setSettings,
  playerView, screenView, hostView, isBusy, totals, scoreEntries, buildSteps, MAX_TRIES, REVEAL,
};
