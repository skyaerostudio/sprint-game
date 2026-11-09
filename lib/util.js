const crypto = require('crypto');

const rid = (n = 8) => crypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n);
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
/** Lowercase, strip accents/spaces/punctuation. Used for clue & guess matching. */
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fill = (tpl, name) => tpl.replace(/\{nama\}/g, name);

module.exports = { rid, randInt, pick, shuffle, norm, clamp, fill };
