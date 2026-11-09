// Generates auto-graded mini-challenges for the bomb holder. Content comes from data/mini-challenges.json.
const { rid, randInt, pick, shuffle } = require('./util');

const GEN = {
  tap(c) {
    const n = c.jumlah || 15;
    return { title: 'Tap gila-gilaan!', prompt: `Tap bomnya ${n} kali!`, count: n };
  },
  hitung(c) {
    const min = c.min || 2;
    const max = c.max || 12;
    const op = pick(c.operasi && c.operasi.length ? c.operasi : ['×']);
    let a = randInt(min, max);
    let b = randInt(min, max);
    let ans;
    if (op === '+') { a = randInt(10, 60); b = randInt(5, 40); ans = a + b; }
    else if (op === '−') { a = randInt(20, 90); b = randInt(5, a - 5); ans = a - b; }
    else ans = a * b;
    const set = new Set([ans]);
    const cand = shuffle([ans + 1, ans - 1, ans + 10, ans - 10, ans + a, ans - b, ans + 2, ans - 2]);
    for (const x of cand) {
      if (set.size >= 4) break;
      if (x >= 0) set.add(x);
    }
    let k = 3;
    while (set.size < 4) set.add(ans + k++);
    return {
      title: 'Hitung cepat!',
      prompt: `${a} ${op} ${b} = ?`,
      options: shuffle([...set]).map(String),
      answer: String(ans),
    };
  },
  beda(c) {
    const pairs = c.pasangan && c.pasangan.length ? c.pasangan : [['🍎', '🍏']];
    const [same, diff] = shuffle(pick(pairs));
    const idx = randInt(0, 8);
    const grid = Array(9).fill(same);
    grid[idx] = diff;
    return { title: 'Cari yang beda!', prompt: 'Tap yang beda sendiri!', grid, answer: idx };
  },
  kebalik(c) {
    const w = String(pick(c.kata && c.kata.length ? c.kata : ['PISANG'])).toUpperCase();
    return { title: 'Ketik kebalik!', prompt: 'Balik kata ini, terus ketik:', shown: [...w].reverse().join(''), answer: w };
  },
  warna(c) {
    const cols = c.warna && c.warna.length >= 4 ? c.warna : [
      { nama: 'MERAH', hex: '#e53935' }, { nama: 'BIRU', hex: '#1e88e5' },
      { nama: 'HIJAU', hex: '#43a047' }, { nama: 'KUNING', hex: '#fdd835' },
    ];
    const [word, ink, ...rest] = shuffle(cols);
    const options = shuffle([word, ink, ...rest.slice(0, 2)]).map((o) => o.nama);
    return {
      title: 'Jebakan warna!',
      prompt: 'Tap WARNA tulisannya, bukan bacaannya!',
      word: word.nama,
      ink: ink.hex,
      options,
      answer: ink.nama,
    };
  },
  jebakan(list) {
    const qs = Array.isArray(list) && list.length ? list : [
      { tanya: 'Mana yang lebih berat: 1 kg kapas atau 1 kg besi?', pilihan: ['Kapas', 'Besi', 'Sama', 'Tergantung'], jawaban: 'Sama' },
    ];
    const q = pick(qs);
    return { title: 'Pertanyaan jebakan!', prompt: q.tanya, options: shuffle(q.pilihan.map(String)), answer: String(q.jawaban) };
  },
  geser(c) {
    const w = c.lebarZona || 12;
    return { title: 'Geser untuk menjinakkan!', prompt: 'Geser ke zona hijau, terus lepas!', zoneStart: randInt(25, 92 - w), zoneWidth: w };
  },
  tahan(c) {
    const t = c.targetMs || 2000;
    return {
      title: 'Tahan!',
      prompt: `Tekan & tahan tepat ${(t / 1000).toLocaleString('id-ID')} detik`,
      targetMs: t,
      toleranceMs: c.toleransiMs || 300,
    };
  },
};

function generate(cfg, exclude = []) {
  const all = (cfg.aktif || []).filter((t) => GEN[t]);
  const types = all.length ? all : ['tap'];
  let pool = types.filter((t) => !exclude.includes(t));
  if (!pool.length) pool = types;
  const type = pick(pool);
  const c = GEN[type](cfg[type] || {});
  return { id: rid(8), type, ...c };
}

module.exports = { generate };
