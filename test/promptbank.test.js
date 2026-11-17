// Bank editor ops + write-back with backup, against a temp DATA_DIR (never touches data/prompts.json).
const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdj-bank-'));
process.env.DATA_DIR = tmp;

const test = require('node:test');
const assert = require('node:assert/strict');
const pb = require('../lib/promptbank');

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('init copies the default bank into DATA_DIR', () => {
  const d = pb.init();
  assert.ok(fs.existsSync(path.join(tmp, 'prompts.json')));
  assert.equal(d.prompts.length, 16);
});

test('answer add / update / mutiara / remove are saved, with a backup', () => {
  let r = pb.applyOp({ op: 'answer:add', id: 'buah', teks: 'Buah Uji', alias: 'Uji Satu, Uji Dua', tier: 4 });
  assert.equal(r.ok, true, r.error);
  const onDisk = () => JSON.parse(fs.readFileSync(path.join(tmp, 'prompts.json'), 'utf8')).prompts.find((p) => p.id === 'buah');
  assert.deepEqual(onDisk().jawaban.find((j) => j.teks === 'Buah Uji').alias, ['Uji Satu', 'Uji Dua']);
  assert.ok(fs.readdirSync(path.join(tmp, 'backups')).length >= 1);

  r = pb.applyOp({ op: 'answer:update', id: 'buah', teks: 'Buah Uji', tier: 2, sok_pinter: true, catatan: 'cek' });
  assert.equal(r.ok, true, r.error);
  const j = onDisk().jawaban.find((x) => x.teks === 'Buah Uji');
  assert.equal(j.tier, 2);
  assert.equal(j.sok_pinter, true);

  r = pb.applyOp({ op: 'answer:mutiara', id: 'buah', teks: 'Buah Uji' });
  assert.equal(r.ok, true);
  assert.equal(onDisk().jawaban.filter((x) => x.mutiara).length, 1);
  assert.equal(pb.applyOp({ op: 'answer:remove', id: 'buah', teks: 'Buah Uji' }).ok, false); // it's the Mutiara now
  pb.applyOp({ op: 'answer:mutiara', id: 'buah', teks: 'Maja' });
  assert.equal(pb.applyOp({ op: 'answer:remove', id: 'buah', teks: 'Buah Uji' }).ok, true);
  assert.equal(onDisk().jawaban.some((x) => x.teks === 'Buah Uji'), false);
});

test('invalid edits are refused and nothing is written', () => {
  const before = fs.readFileSync(path.join(tmp, 'prompts.json'), 'utf8');
  const r = pb.applyOp({ op: 'answer:add', id: 'buah', teks: 'Pisang', tier: 3 }); // duplicate
  assert.equal(r.ok, false);
  assert.match(r.error, /dobel/);
  assert.equal(pb.applyOp({ op: 'answer:update', id: 'buah', teks: 'Pisang', tier: 9 }).ok, false);
  assert.equal(pb.applyOp({ op: 'import', bank: { prompts: [] } }).ok, false);
  assert.equal(fs.readFileSync(path.join(tmp, 'prompts.json'), 'utf8'), before);
});

test('prompt add / update / remove', () => {
  assert.equal(pb.applyOp({ op: 'prompt:add', newId: 'HP Merek!', prompt: 'Sebutkan merek HP', mutiara: 'Nexian' }).ok, true);
  const p = pb.get().prompts.find((x) => x.id === 'hp-merek');
  assert.ok(p);
  assert.equal(p.jawaban[0].mutiara, true);
  assert.equal(pb.applyOp({ op: 'prompt:update', id: 'hp-merek', prompt: 'Sebutkan merek HP jadul', bebas: true }).ok, true);
  assert.equal(pb.get().prompts.find((x) => x.id === 'hp-merek').kategori_bebas_tambah, true);
  assert.equal(pb.applyOp({ op: 'prompt:remove', id: 'hp-merek' }).ok, true);
  assert.equal(pb.get().prompts.length, 16);
});
