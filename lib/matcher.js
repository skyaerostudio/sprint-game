// Satu Dalam Sejuta: answer matcher (PRD §6).
// Order: sering_salah → exact (teks/alias) → exact without category prefix → typo (Levenshtein).
// An exact hit always wins, because the bank is full of real near-twins (Iran/Irak, Solo/Solok, Kasir/Kusir…).
const { norm } = require('./util');

// Category words players tend to type in front of the answer ("buah matoa", "kota Malang").
// A prompt can override this with an `awalan` array in data/prompts.json.
const DEFAULT_PREFIXES = {
  buah: ['buah'],
  provinsi: ['provinsi', 'prov', 'propinsi'],
  kota: ['kota', 'kabupaten', 'kab'],
  hewan: ['hewan', 'binatang'],
  makanan: ['makanan'],
  motor: ['motor', 'merek', 'merk'],
  mobil: ['mobil', 'merek', 'merk'],
  olahraga: ['olahraga', 'cabor'],
  sayur: ['sayur', 'sayuran'],
  minuman: ['minuman'],
  negara: ['negara'],
  profesi: ['profesi', 'pekerjaan', 'kerja'],
  warna: ['warna'],
  bumbu: ['bumbu', 'rempah'],
};

/** Edit distance allowed for a target of this (normalized) length. */
const tolerance = (len) => (len <= 4 ? 0 : len <= 8 ? 1 : 2);

function levenshtein(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Variants of the raw input to try: the full text, then the text without a leading category word. */
function variants(raw, prefixes) {
  const words = String(raw || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
  const out = [];
  const full = words.join('');
  if (full) out.push(full);
  if (words.length > 1 && prefixes.includes(words[0])) {
    const rest = words.slice(1).join('');
    if (rest && rest !== full) out.push(rest);
  }
  return out;
}

const cache = new WeakMap();

/** Build (and cache per prompt object) the lookup index. `sering` = sering_salah rows for this prompt. */
function compile(prompt, sering = []) {
  const hit = cache.get(prompt);
  if (hit && hit.sering === sering) return hit.idx;
  const keys = new Map(); // normKey -> answer
  for (const j of prompt.jawaban) {
    for (const t of [j.teks, ...(j.alias || [])]) {
      const k = norm(t);
      if (k && !keys.has(k)) keys.set(k, j);
    }
  }
  const ss = new Map();
  for (const s of sering) {
    const k = norm(s.jawaban);
    if (k) ss.set(k, s);
  }
  const prefixes = (Array.isArray(prompt.awalan) ? prompt.awalan : DEFAULT_PREFIXES[prompt.id] || []).map((p) => norm(p)).filter(Boolean);
  const idx = { keys, ss, prefixes };
  cache.set(prompt, { sering, idx });
  return idx;
}

/**
 * Match a player's raw answer against one prompt.
 * Returns one of:
 *   { type: 'empty' }
 *   { type: 'found', answer, via: 'exact' | 'typo' }
 *   { type: 'ambiguous', options: [answer, …] }   (typo equally close to 2+ answers)
 *   { type: 'sering_salah', alasan, jawaban }       (goes to Sidang Banding)
 *   { type: 'notfound' }
 */
function match(prompt, raw, sering = []) {
  const idx = compile(prompt, sering);
  const vs = variants(raw, idx.prefixes);
  if (!vs.length) return { type: 'empty' };

  // 1. sering_salah (exact) — never matched to an answer.
  for (const v of vs) {
    const s = idx.ss.get(v);
    if (s) return { type: 'sering_salah', alasan: s.alasan || '', jawaban: s.jawaban };
  }
  // 2/3. Exact on full text, then without the category prefix.
  for (const v of vs) {
    const a = idx.keys.get(v);
    if (a) return { type: 'found', answer: a, via: 'exact' };
  }
  // 4. Typo tolerance, per target length. Ties between different answers are ambiguous.
  let best = Infinity;
  let found = new Set();
  let bestSS = null;
  for (const v of vs) {
    for (const [k, a] of idx.keys) {
      const tol = tolerance(k.length);
      if (!tol) continue;
      const d = levenshtein(v, k, tol);
      if (d > tol) continue;
      if (d < best) { best = d; found = new Set([a]); bestSS = null; }
      else if (d === best) found.add(a);
    }
    for (const [k, s] of idx.ss) {
      const tol = tolerance(k.length);
      if (!tol) continue;
      const d = levenshtein(v, k, tol);
      if (d <= tol && d < best) { best = d; found = new Set(); bestSS = s; }
    }
  }
  if (bestSS) return { type: 'sering_salah', alasan: bestSS.alasan || '', jawaban: bestSS.jawaban };
  if (found.size === 1) return { type: 'found', answer: [...found][0], via: 'typo' };
  if (found.size > 1) return { type: 'ambiguous', options: [...found] };
  return { type: 'notfound' };
}

module.exports = { match, compile, levenshtein, tolerance, variants, DEFAULT_PREFIXES };
