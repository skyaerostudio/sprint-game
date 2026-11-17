// Satu Dalam Sejuta: the single data source data/prompts.json (prompts, answers, tiers, scoring, sering_salah).
// Validated on start (server refuses to start when invalid), reloaded when the file changes on disk,
// and written back (with a timestamped backup) when the host edits it.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { norm } = require('./util');

const FILE = 'prompts.json';
const MAX_BACKUPS = 30;
const ANSWER_KEYS = ['teks', 'alias', 'tier', 'mutiara', 'sok_pinter', 'catatan'];

const isNum = (v) => typeof v === 'number' && isFinite(v);

/** Returns a list of human-readable problems (Bahasa Indonesia). Empty list = valid. */
function validate(d) {
  const errs = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['File bukan objek JSON.'];

  const sk = d.skoring;
  if (!sk || typeof sk !== 'object') errs.push('skoring: tidak ada.');
  else {
    for (const t of ['1', '2', '3', '4', '5']) {
      const z = sk.tier && sk.tier[t];
      if (!z || typeof z.zona !== 'string' || !isNum(z.poin) || !isNum(z.kedalaman_m)) errs.push(`skoring.tier.${t}: wajib punya zona, poin, kedalaman_m.`);
    }
    const m = sk.mutiara;
    if (!m || typeof m.zona !== 'string' || !isNum(m.poin) || !isNum(m.kedalaman_m)) errs.push('skoring.mutiara: wajib punya zona, poin, kedalaman_m.');
    const mod = sk.modifier || {};
    for (const k of ['tabrakan_persen', 'sendirian_bonus', 'ngambang_poin', 'prompt_terakhir_kali']) {
      if (!isNum(mod[k])) errs.push(`skoring.modifier.${k}: wajib angka.`);
    }
  }

  if (!Array.isArray(d.prompts) || !d.prompts.length) errs.push('prompts: wajib array berisi minimal 1 prompt.');
  const ids = new Set();
  (Array.isArray(d.prompts) ? d.prompts : []).forEach((p, i) => {
    const where = `prompts[${i}]${p && p.id ? ` (${p.id})` : ''}`;
    if (!p || typeof p !== 'object') return void errs.push(`${where}: bukan objek.`);
    if (typeof p.id !== 'string' || !p.id.trim()) errs.push(`${where}: id kosong.`);
    else if (ids.has(p.id)) errs.push(`${where}: id "${p.id}" dobel.`);
    else ids.add(p.id);
    if (typeof p.prompt !== 'string' || !p.prompt.trim()) errs.push(`${where}: teks prompt kosong.`);
    if (p.awalan != null && !(Array.isArray(p.awalan) && p.awalan.every((x) => typeof x === 'string'))) errs.push(`${where}: awalan harus array teks.`);
    if (!Array.isArray(p.jawaban) || !p.jawaban.length) return void errs.push(`${where}: jawaban kosong.`);
    const seen = new Map();
    let mutiara = 0;
    p.jawaban.forEach((j, k) => {
      const w = `${where} jawaban #${k + 1}${j && j.teks ? ` "${j.teks}"` : ''}`;
      if (!j || typeof j !== 'object') return void errs.push(`${w}: bukan objek.`);
      if (typeof j.teks !== 'string' || !norm(j.teks)) errs.push(`${w}: teks kosong.`);
      if (!Number.isInteger(j.tier) || j.tier < 1 || j.tier > 5) errs.push(`${w}: tier harus 1–5 (sekarang ${JSON.stringify(j.tier)}).`);
      if (j.alias != null && !(Array.isArray(j.alias) && j.alias.every((a) => typeof a === 'string'))) errs.push(`${w}: alias harus array teks.`);
      if (j.mutiara) mutiara++;
      for (const t of [j.teks, ...(Array.isArray(j.alias) ? j.alias : [])]) {
        const key = norm(t);
        if (!key) continue;
        if (seen.has(key) && seen.get(key) !== k) errs.push(`${w}: "${t}" dobel dengan jawaban #${seen.get(key) + 1} "${p.jawaban[seen.get(key)].teks}".`);
        else seen.set(key, k);
      }
      const extra = Object.keys(j).filter((x) => !ANSWER_KEYS.includes(x));
      if (extra.length) errs.push(`${w}: field nggak dikenal: ${extra.join(', ')}.`);
    });
    if (mutiara !== 1) errs.push(`${where}: harus tepat 1 Mutiara (sekarang ${mutiara}).`);
  });

  if (d.sering_salah != null && !Array.isArray(d.sering_salah)) errs.push('sering_salah: harus array.');
  (Array.isArray(d.sering_salah) ? d.sering_salah : []).forEach((s, i) => {
    const w = `sering_salah[${i}]${s && s.jawaban ? ` "${s.jawaban}"` : ''}`;
    if (!s || typeof s.jawaban !== 'string' || !norm(s.jawaban)) return void errs.push(`${w}: jawaban kosong.`);
    if (!ids.has(s.prompt_id)) errs.push(`${w}: prompt_id "${s.prompt_id}" nggak ada.`);
  });
  return errs;
}

let file = null;
let cache = null;
let mtime = 0;

/** Load + validate. Throws with every problem listed if the file is invalid (server must not start). */
function init() {
  file = store.ensureFile(FILE);
  const raw = fs.readFileSync(file, 'utf8');
  let d;
  try { d = JSON.parse(raw); } catch (e) { throw new Error(`${file} bukan JSON yang valid: ${e.message}`); }
  const errs = validate(d);
  if (errs.length) throw new Error(`${file} nggak valid (${errs.length} masalah):\n - ${errs.join('\n - ')}`);
  cache = d;
  mtime = fs.statSync(file).mtimeMs;
  return d;
}

/** Current bank. Picks up hand edits on disk; an invalid edit is logged and the last good copy is kept. */
function get() {
  if (!cache) init();
  try {
    const m = fs.statSync(file).mtimeMs;
    if (m !== mtime) {
      mtime = m;
      const d = store.readJSON(file, null);
      const errs = d ? validate(d) : ['bukan JSON yang valid'];
      if (errs.length) console.error(`[prompts] Perubahan ${file} diabaikan, nggak valid:\n - ${errs.join('\n - ')}`);
      else cache = d;
    }
  } catch {}
  return cache;
}

function backup() {
  const dir = path.join(store.DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  try { fs.copyFileSync(file, path.join(dir, `prompts-${stamp}.json`)); } catch (e) { console.error('[prompts] Backup gagal:', e.message); }
  const old = fs.readdirSync(dir).filter((f) => /^prompts-.*\.json$/.test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - MAX_BACKUPS))) {
    try { fs.unlinkSync(path.join(dir, f)); } catch {}
  }
}

/** Validate and write a whole new bank (backup first). Returns { ok } or { ok:false, errors }. */
function save(d) {
  const errs = validate(d);
  if (errs.length) return { ok: false, error: `Bank nggak valid: ${errs.slice(0, 5).join(' · ')}${errs.length > 5 ? ` (+${errs.length - 5} lagi)` : ''}`, errors: errs };
  if (!cache) init();
  backup();
  store.writeJSON(file, d);
  cache = d;
  try { mtime = fs.statSync(file).mtimeMs; } catch {}
  return { ok: true };
}

/** Deep copy of the current bank, for editing. */
const clone = () => JSON.parse(JSON.stringify(get()));

const findPrompt = (d, id) => d.prompts.find((p) => p.id === id) || null;
const seringFor = (d, id) => (d.sering_salah || []).filter((s) => s.prompt_id === id);

module.exports = { validate, init, get, save, clone, findPrompt, seringFor };
