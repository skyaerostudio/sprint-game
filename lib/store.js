// File-based persistence: sessions, meta (active session), word bank, mini-challenges.
const fs = require('fs');
const path = require('path');

const DEFAULT_DATA = path.join(__dirname, '..', 'data');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : DEFAULT_DATA;
const SESS_DIR = path.join(DATA_DIR, 'sessions');
fs.mkdirSync(SESS_DIR, { recursive: true });

function ensureFile(name) {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) fs.copyFileSync(path.join(DEFAULT_DATA, name), p);
  return p;
}

function readJSON(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`[store] Gagal baca ${p}:`, e.message);
    return fallback;
  }
}

function writeJSON(p, obj) {
  const data = JSON.stringify(obj, null, 2);
  const tmp = p + '.tmp';
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, p);
  } catch (e) {
    // Windows can refuse rename if another process has the file open; fall back to direct write.
    fs.writeFileSync(p, data);
    try { fs.unlinkSync(tmp); } catch {}
  }
}

/** JSON file cached by mtime, so hand edits are picked up without restart. */
function cachedJSON(p, validate, fallback) {
  let cache = null;
  let mtime = 0;
  return {
    get() {
      try {
        const m = fs.statSync(p).mtimeMs;
        if (!cache || m !== mtime) {
          const v = readJSON(p, null);
          if (v && validate(v)) {
            cache = v;
            mtime = m;
          } else if (!cache) {
            console.error(`[store] ${p} tidak valid, pakai default.`);
            cache = fallback;
          }
        }
      } catch {
        if (!cache) cache = fallback;
      }
      return cache;
    },
    set(v) {
      writeJSON(p, v);
      cache = v;
      try { mtime = fs.statSync(p).mtimeMs; } catch {}
    },
  };
}

const wordBankFile = ensureFile('word-bank.json');
const miniFile = ensureFile('mini-challenges.json');

const wordBank = cachedJSON(
  wordBankFile,
  (v) => Array.isArray(v) && v.every((c) => c && typeof c.kategori === 'string' && Array.isArray(c.kata)),
  []
);
const mini = cachedJSON(miniFile, (v) => v && typeof v === 'object' && Array.isArray(v.aktif), { aktif: ['tap'], tap: { jumlah: 15 } });

function loadSessions() {
  const map = new Map();
  for (const f of fs.readdirSync(SESS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const s = readJSON(path.join(SESS_DIR, f), null);
    if (s && s.id) map.set(s.id, s);
  }
  return map;
}

function saveSession(s) {
  writeJSON(path.join(SESS_DIR, `${s.id}.json`), s);
}

const metaFile = path.join(DATA_DIR, 'meta.json');
const loadMeta = () => readJSON(metaFile, { activeId: null });
const saveMeta = (m) => writeJSON(metaFile, m);

module.exports = { DATA_DIR, wordBank, mini, loadSessions, saveSession, loadMeta, saveMeta };
