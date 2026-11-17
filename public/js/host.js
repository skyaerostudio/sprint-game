// Host panel (/host).
(function () {
  const { esc, Clock, toast, num, fmtScore } = G;
  const socket = io({ reconnectionDelay: 400, reconnectionDelayMax: 2000 });
  const PW_KEY = 'sprintgame:hostpw';
  const THEMES = ['#ffc83d', '#ff8a3d', '#ff6a4d', '#f26ca7', '#b79cff', '#62b6f5', '#3fc1d6', '#2fa36b', '#a8d44a', '#d9b98c'];
  const FAKE_PHASE = { idle: 'Belum mulai', role: 'Lihat peran', clue: 'Petunjuk', discuss: 'Diskusi', vote: 'Vote', reveal: 'Reveal', lastchance: 'Kesempatan terakhir', result: 'Hasil', cancelled: 'Dibatalkan', over: 'Selesai' };
  const BOMB_PHASE = { idle: 'Belum mulai / antar ronde', live: 'Ronde jalan', blast: 'Baru meledak', over: 'Selesai' };

  let hs = null;
  let authed = false;
  let pw = '';
  try { pw = localStorage.getItem(PW_KEY) || ''; } catch {}
  const expanded = new Set();
  let showSecret = false;

  const $ = (id) => document.getElementById(id);
  const cache = new Map();
  /** Replace innerHTML only when changed, and never while the user is typing inside it. */
  function put(id, html) {
    const el = $(id);
    if (!el || cache.get(id) === html) return;
    const ae = document.activeElement;
    if (ae && el.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) return;
    cache.set(id, html);
    el.innerHTML = html;
  }

  // ---------- Auth ----------
  function auth(p) {
    socket.emit('host:auth', p, (res) => {
      if (res && res.ok) {
        authed = true;
        pw = p;
        try { localStorage.setItem(PW_KEY, p); } catch {}
        $('login').classList.add('hidden');
        $('main').classList.remove('hidden');
        // The server sends host:state before this ack arrives, so render what we already have.
        cache.clear();
        render();
      } else {
        $('lerr').textContent = (res && res.error) || 'Gagal login';
        $('login').classList.remove('hidden');
        $('main').classList.add('hidden');
      }
    });
  }
  $('lgo').onclick = () => auth($('pw').value);
  $('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') auth($('pw').value); });
  socket.on('connect', () => { if (pw) auth(pw); });
  socket.on('host:state', (v) => {
    hs = v;
    Clock.sync(v.serverNow);
    render();
  });

  function act(type, args = {}) {
    return new Promise((resolve) => {
      socket.emit('host:action', { type, ...args }, (res) => {
        if (!res || !res.ok) toast(`${(res && res.error) || 'Gagal'}`);
        resolve(res || {});
      });
    });
  }

  // ---------- Static UI ----------
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('section[data-panel]').forEach((s) => s.classList.toggle('hidden', s.dataset.panel !== b.dataset.tab));
  });

  $('swatches').innerHTML = THEMES.map((c, i) => `<label><input type="radio" name="theme" value="${c}" ${i === 0 ? 'checked' : ''} /><span style="background:${c}"></span></label>`).join('');
  $('create').onclick = async () => {
    const squad = $('squad').value.trim();
    if (!squad) return toast('Isi nama squad dulu!');
    const color = (document.querySelector('input[name=theme]:checked') || {}).value;
    const res = await act('createSession', { squad, color });
    if (res.ok) { $('squad').value = ''; toast(`Sesi "${squad}" aktif di layar besar`); }
  };
  $('wadd').onclick = async () => {
    const kategori = $('wcat').value.trim();
    const kata = $('wwords').value;
    if (!kategori || !kata.trim()) return toast('Isi kategori dan katanya!');
    const res = await act('words:add', { kategori, kata });
    if (res.ok) { $('wwords').value = ''; toast(`${res.added} kata ditambahkan`); }
  };

  // Generic buttons: data-act, data-args (JSON), data-confirm, data-prompt
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
    const args = b.dataset.args ? JSON.parse(b.dataset.args) : {};
    if (b.dataset.prompt) {
      const v = prompt(b.dataset.prompt, b.dataset.default || '');
      if (v == null) return;
      args[b.dataset.promptKey || 'value'] = v;
    }
    b.disabled = true;
    await act(b.dataset.act, args);
    b.disabled = false;
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle-exp]');
    if (t) { const id = t.dataset.toggleExp; expanded.has(id) ? expanded.delete(id) : expanded.add(id); render(); }
    if (e.target.closest('#secretBox')) { showSecret = !showSecret; cache.delete('fsecret'); render(); }
  });
  // Settings inputs: data-set="bomb:fuseMin" (number) / checkbox
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-set]');
    if (!el) return;
    const [game, key] = el.dataset.set.split(':');
    let val;
    if (el.type === 'checkbox') val = el.checked;
    else if (el.dataset.kind === 'str') val = el.value || null;
    else val = Number(el.value);
    if (key === 'cat') {
      const all = [...document.querySelectorAll('[data-set="fake:cat"]')];
      const on = all.filter((x) => x.checked).map((x) => x.value);
      if (!on.length) { el.checked = true; return toast('Minimal satu kategori aktif!'); }
      act('fake:settings', { patch: { activeCategories: on.length === all.length ? null : on } });
      return;
    }
    act(`${game}:settings`, { patch: { [key]: val } });
  });

  // ---------- Urutan game per sesi ----------
  const GAME_NAMES = { bomb: 'Bom Kentang Panas', sdj: 'Satu Dalam Sejuta', fake: 'Fake It Till You Make It' };
  const GAME_TAB = { bomb: 'bom', sdj: 'sdj', fake: 'fake' };
  let tabOrderKey = '';

  function orderLists(a) {
    const on = (a.order || []).map((g) => g.key);
    return { on, all: [...on, ...Object.keys(GAME_NAMES).filter((k) => !on.includes(k))] };
  }

  function renderOrder(a) {
    if (!a) { put('order', '<div class="muted">Belum ada sesi aktif.</div>'); return; }
    const { on, all } = orderLists(a);
    put('order', all.map((k) => {
      const i = on.indexOf(k);
      return `<div class="order-row" style="${i >= 0 ? '' : 'opacity:.5'}"><b style="width:28px">${i >= 0 ? `${i + 1}.` : '–'}</b><span class="grow">${GAME_NAMES[k]}</span>
        ${i >= 0 ? `<button class="btn small" data-ord="up" data-k="${k}" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn small" data-ord="down" data-k="${k}" ${i === on.length - 1 ? 'disabled' : ''}>↓</button>` : ''}
        <label class="toggle"><input type="checkbox" data-ordtoggle="${k}" ${i >= 0 ? 'checked' : ''} /> Dimainkan</label></div>`;
    }).join('') + '<div class="muted">Urutan ini tampil di lobby layar besar. Tab game di panel ini ikut diurutkan.</div>');
    // Reorder the game tabs to match.
    const key = all.join() + '|' + on.join();
    if (key !== tabOrderKey) {
      tabOrderKey = key;
      let prev = document.querySelector('#tabs [data-tab=pemain]');
      for (const k of all) {
        const b = document.querySelector(`#tabs [data-tab=${GAME_TAB[k]}]`);
        if (!b || !prev) continue;
        prev.after(b);
        prev = b;
        b.style.opacity = on.includes(k) ? '' : '.5';
      }
    }
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ord]');
    if (!b || !hs || !hs.active) return;
    const { on } = orderLists(hs.active);
    const i = on.indexOf(b.dataset.k);
    const j = b.dataset.ord === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= on.length) return;
    [on[i], on[j]] = [on[j], on[i]];
    act('setOrder', { order: on });
  });
  document.addEventListener('change', (e) => {
    const c = e.target.closest('[data-ordtoggle]');
    if (!c || !hs || !hs.active) return;
    const { on } = orderLists(hs.active);
    const k = c.dataset.ordtoggle;
    const next = c.checked ? [...on.filter((x) => x !== k), k] : on.filter((x) => x !== k);
    if (!next.length) { c.checked = true; toast('Minimal satu game dimainkan!'); return; }
    act('setOrder', { order: next });
  });

  // ---------- Satu Dalam Sejuta ----------
  const SDJ_PHASE = { idle: 'Belum mulai', jawab: 'Fase jawab', banding: 'Sidang Banding', reveal: 'Reveal di layar', hasil: 'Hasil prompt', over: 'Selesai' };
  const SDJ_ST = { found: '✅ cocok', ambiguous: '❓ ambigu', notfound: '🤔 nggak ada', perlu_banding: '🧐 sering salah', banding: '⚖️ banding', sah: '✅ sah', tolak: '❌ ditolak', ngambang: '🫧 ngambang' };
  const tierPill = (t, m) => (m ? '<span class="tierpill m">🦪</span>' : t ? `<span class="tierpill t${t}">${t}</span>` : '<span class="muted">-</span>');
  const zoneName = (d, t) => ((d.zones || []).find((z) => z.tier === t) || {}).zona || '';

  function renderSdj(a) {
    if (!a) { ['sstatus', 'scourt', 'sanswers', 'ssettings'].forEach((id) => put(id, id === 'sstatus' ? '<div class="muted">Belum ada sesi aktif.</div>' : '')); return; }
    const d = a.sdj;
    const busy = ['jawab', 'banding', 'reveal'].includes(d.phase);
    const timer = d.phase === 'jawab' ? d.phaseEndsAt : d.phase === 'banding' && d.cur ? d.cur.endsAt : 0;
    const canNext = !busy && d.round < d.totalPrompts;
    put('sstatus', `<div class="kv">
      <b>Status</b><span>${SDJ_PHASE[d.phase] || d.phase}${timer ? ` · <span data-ends="${timer}"></span> dtk` : ''}</span>
      <b>Prompt</b><span>${d.round} / ${d.totalPrompts}${d.double ? ' · ×2 PENYELAMAN GANDA' : ''}</span>
      ${d.prompt ? `<b>Sekarang</b><span><b>${esc(d.prompt)}</b> <span class="muted">(${esc(d.promptId)}${d.bebas ? ' · jawaban bebas' : ''})</span></span>` : ''}
      ${d.phase === 'jawab' ? `<b>Terkunci</b><span>${d.lockedIds.length} / ${a.players.length}</span>` : ''}
    </div>
    <div class="row">
      <button class="btn primary" data-act="sdj:start" ${canNext ? '' : 'disabled'}>${d.round === 0 ? 'Mulai prompt pertama' : 'Prompt berikutnya'}</button>
      <button class="btn" data-act="showGame" data-args='{"game":"sdj"}'>Tampilkan di layar</button>
      ${d.phase === 'jawab' ? `<button class="btn" data-act="sdj:addTime" data-args='{"sec":15}'>+15 detik</button><button class="btn warn" data-act="sdj:endAnswer">Akhiri fase jawab</button>` : ''}
      ${d.phase === 'banding' ? `<button class="btn" data-act="sdj:addTime" data-args='{"sec":15}'>+15 detik banding</button>` : ''}
      ${d.phase === 'reveal' ? '<button class="btn" data-act="sdj:skip">Skip reveal</button>' : ''}
      <button class="btn bad" data-act="sdj:end" data-confirm="Akhiri game Satu Dalam Sejuta?${['jawab', 'banding'].includes(d.phase) ? ' Prompt yang lagi jalan nggak dihitung.' : ''}">Akhiri Game</button>
    </div>
    ${d.phase === 'hasil' && d.round >= d.totalPrompts ? '<div class="chip hint">Itu prompt terakhir! Tekan Akhiri Game, lalu lanjut game berikutnya.</div>' : ''}`);

    const q = d.queue || [];
    put('scourt', !q.length ? '<div class="muted">Belum ada banding.</div>' : q.map((b) => {
      const isCur = d.cur && d.cur.id === b.id;
      if (b.status !== 'banding') {
        return `<div class="court-box"><div>${b.avatar} <b>${esc(b.name)}</b>: “${esc(b.raw)}” → ${b.status === 'sah' ? `✅ Sah tier ${b.tier}${b.auto ? ' (otomatis)' : ''}` : '❌ Ditolak'}</div></div>`;
      }
      return `<div class="court-box ${isCur ? 'cur' : ''}" data-court="${b.id}">
        <div style="font-size:20px">${b.avatar} <b>${esc(b.name)}</b>: <span class="hl"><b>“${esc(b.raw)}”</b></span> ${isCur ? `<span class="chip">di layar · <span data-ends="${d.cur.endsAt}"></span> dtk</span>` : ''}</div>
        ${b.alasan ? `<div><span class="chip hint">Sering salah: ${esc(b.alasan)}</span></div>` : ''}
        ${b.kasar ? '<div><span class="chip no">⚠️ Kayaknya kata kasar</span></div>' : ''}
        <div class="row">
          <label>Tier <select data-tier style="width:auto">${[1, 2, 3, 4, 5].map((t) => `<option value="${t}" ${t === 3 ? 'selected' : ''}>${t} · ${esc(zoneName(d, t))}</option>`).join('')}</select></label>
          <button class="btn good small" data-judge="sah">Sah</button>
          <button class="btn good small" data-judge="sah" data-save="1">Sah + simpan ke daftar</button>
          <button class="btn bad small" data-judge="tolak">Tolak</button>
        </div></div>`;
    }).join('') + `<div class="muted">Banding bisa diputus kapan saja. Kalau nggak diputus dalam ${d.bandingSec} detik saat sidang, otomatis Sah di tier 3.</div>`);

    const rows = d.answers || [];
    put('sanswers', !d.prompt ? '<div class="muted">Belum ada prompt.</div>' : `<table class="ptable sdj-ans"><tr><th>Pemain</th><th>Ketik</th><th>Cocok ke</th><th>Tier</th><th>Status</th>${d.canCorrect ? '<th>Poin</th><th>Koreksi</th>' : ''}</tr>
      ${rows.map((x) => `<tr>
        <td>${x.avatar} <b>${esc(x.name)}</b>${x.online ? '' : ' <span class="muted">(offline)</span>'}</td>
        <td>${x.raw ? esc(x.raw) : '<span class="muted">-</span>'} <span class="muted" style="font-size:12px">${x.tries}/${d.maxTries}</span></td>
        <td>${x.teks ? esc(x.teks) : x.options ? `<span class="muted">${x.options.map(esc).join(' / ')}?</span>` : '-'}${x.sok ? ' 🤓' : ''}${x.catatan ? `<div class="muted" style="font-size:12px">📝 ${esc(x.catatan)}</div>` : ''}${x.alasan ? `<div class="muted" style="font-size:12px">🧐 ${esc(x.alasan)}</div>` : ''}</td>
        <td>${tierPill(x.tier, x.mutiara)}${x.override ? ' <span class="muted" style="font-size:12px">dikoreksi</span>' : ''}</td>
        <td>${SDJ_ST[x.status] || '…'}${x.locked ? ' 🔒' : ''}${x.kasar ? ' ⚠️' : ''}${x.auto ? ' (otomatis)' : ''}</td>
        ${d.canCorrect ? `<td><b>${x.result ? x.result.points : 0}</b> <span class="muted" style="font-size:12px">${x.result ? (x.result.collision ? 'tabrakan' : x.result.solo ? 'sendirian' : '') : ''}</span></td>
        <td data-fix="${x.id}"><div class="row" style="gap:4px;flex-wrap:nowrap"><input type="text" data-fixtext placeholder="teks (opsional)" style="font-size:14px;padding:4px 6px;width:140px" />
          <select data-fixtier style="width:auto;font-size:14px;padding:4px"><option value="">tier…</option><option value="0">0 · Ngambang</option>${[1, 2, 3, 4, 5].map((t) => `<option value="${t}">${t}</option>`).join('')}</select>
          <button class="btn small" data-fixgo>Koreksi</button></div></td>` : ''}
      </tr>`).join('')}</table>
      ${d.canCorrect ? '<div class="muted">Koreksi: isi teks saja buat cocokkan ulang ke daftar · pilih tier buat ubah tier / nge-Sah-kan · tier 0 = Ngambang. Skor semua pemain dihitung ulang otomatis.</div>' : '<div class="muted">Jawaban cuma kelihatan di sini. Jangan tunjukkan ke pemain!</div>'}`);

    const st = d.settings;
    const prompts = d.prompts || [];
    put('ssettings', `<div class="grid2">
      <div class="field"><label>Jumlah prompt</label><input type="number" min="1" max="${prompts.length}" value="${st.totalPrompts}" data-set="sdj:totalPrompts" /></div>
      <div class="field"><label>Waktu jawab (detik)</label><input type="number" min="10" max="120" value="${st.answerSec}" data-set="sdj:answerSec" /></div>
      <div class="field"><label>Prompt berikutnya</label><select data-set="sdj:nextPrompt" data-kind="str"><option value="">🎲 Acak (yang paling jarang dipakai)</option>${prompts.filter((p) => !p.used).map((p) => `<option value="${esc(p.id)}" ${st.nextPrompt === p.id ? 'selected' : ''}>${esc(p.prompt)}</option>`).join('')}</select></div>
    </div>
    <label class="toggle"><input type="checkbox" data-set="sdj:doubleLast" ${st.doubleLast ? 'checked' : ''} /> Penyelaman Ganda (×2) di prompt terakhir</label>
    <h3>Prompt di bank <span class="muted" style="font-size:14px">(✔ = sudah dipakai di sesi ini · angka = dipakai di semua sesi)</span></h3>
    <div>${prompts.map((p) => `<span class="chip" style="margin:2px;${p.used ? 'opacity:.45' : ''}">${p.used ? '✔ ' : ''}${esc(p.prompt)} · ${p.count} · ${p.usage}×</span>`).join('')}</div>`);
  }

  document.addEventListener('click', async (e) => {
    const j = e.target.closest('[data-judge]');
    if (j) {
      const box = j.closest('[data-court]');
      const tier = Number(box.querySelector('[data-tier]').value);
      j.disabled = true;
      const res = await act('sdj:judge', { pid: box.dataset.court, verdict: j.dataset.judge, tier, save: !!j.dataset.save });
      j.disabled = false;
      if (res.ok && res.warning) toast(res.warning, 5000);
      else if (res.ok && res.saved) { toast('Disimpan ke daftar jawaban'); bank = null; }
      return;
    }
    const f = e.target.closest('[data-fixgo]');
    if (f) {
      const td = f.closest('[data-fix]');
      const text = td.querySelector('[data-fixtext]').value.trim();
      const tier = td.querySelector('[data-fixtier]').value;
      if (!text && tier === '') return toast('Isi teks atau pilih tier dulu.');
      f.disabled = true;
      const res = await act('sdj:correct', { pid: td.dataset.fix, text, tier: tier === '' ? null : Number(tier) });
      f.disabled = false;
      if (res.ok) toast('Dikoreksi, skor dihitung ulang');
    }
  });

  // ---------- Bank Jawaban (editor data/prompts.json) ----------
  let bank = null;
  let bankSel = null;
  let bankQ = '';
  const normC = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

  async function loadBank() {
    $('bkhead').innerHTML = '<div class="muted">Memuat bank…</div>';
    const res = await act('bank:get');
    if (res.ok) { bank = res.bank; renderBank(); }
  }
  async function bankOp(op, okMsg) {
    const res = await act('bank:op', { op });
    if (res.ok) { bank = res.bank; if (okMsg) toast(okMsg); }
    renderBank(); // on failure this reverts the inputs to what's saved
    return res;
  }
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b && b.dataset.tab === 'bank' && !bank) loadBank();
  });

  function renderBank() {
    const hd = $('bkhead');
    const el = $('bkbody');
    if (!bank) { hd.innerHTML = '<div class="muted">Belum dimuat.</div>'; el.innerHTML = ''; return; }
    if (!bankSel || !bank.prompts.find((p) => p.id === bankSel)) bankSel = bank.prompts[0].id;
    const p = bank.prompts.find((x) => x.id === bankSel);
    const total = bank.prompts.reduce((n, x) => n + x.jawaban.length, 0);
    const tiers = [1, 2, 3, 4, 5];
    const zn = (t) => bank.skoring.tier[t].zona;
    hd.innerHTML = `<div class="muted">${bank.prompts.length} prompt · ${total} jawaban · ${(bank.sering_salah || []).length} "sering salah" · versi ${esc(bank.versi || '-')}. Tiap perubahan langsung disimpan ke <b>data/prompts.json</b> (backup otomatis di data/backups).</div>
      <div class="row"><select id="bksel" style="width:auto;max-width:100%">${bank.prompts.map((x) => `<option value="${esc(x.id)}" ${x.id === bankSel ? 'selected' : ''}>${esc(x.prompt)} (${x.jawaban.length})</option>`).join('')}</select>
        <button class="btn small" id="bknewp">+ Prompt baru</button>
        <button class="btn small bad" id="bkdelp">Hapus prompt ini</button>
        <span class="grow"></span>
        <button class="btn small ghost" id="bkreload">Muat ulang</button>
        <button class="btn small" id="bkexp">Export JSON</button>
        <label class="btn small">Import JSON<input type="file" id="bkimp" accept=".json,application/json" hidden /></label></div>`;
    const q = normC(bankQ);
    const list = p.jawaban.filter((j) => !q || [j.teks, ...(j.alias || [])].some((t) => normC(t).includes(q)))
      .sort((a, b) => a.tier - b.tier || a.teks.localeCompare(b.teks));
    el.innerHTML = `<div class="grid2">
        <div class="field"><label>Teks prompt</label><input type="text" id="bkptext" maxlength="120" value="${esc(p.prompt)}" /></div>
        <div class="field"><label>Id (tetap)</label><input type="text" value="${esc(p.id)}" disabled /></div></div>
      <label class="toggle"><input type="checkbox" id="bkbebas" ${p.kategori_bebas_tambah ? 'checked' : ''} /> Jawaban bebas (misal "alasan telat": bakal lebih banyak banding)</label>
      <h3>Tambah jawaban</h3>
      <div class="row"><input type="text" id="bkat" placeholder="Teks jawaban" style="width:200px" /><input type="text" id="bkaa" placeholder="Alias (pisah koma)" style="width:220px" />
        <select id="bkatier" style="width:auto">${tiers.map((t) => `<option value="${t}" ${t === 3 ? 'selected' : ''}>${t} · ${esc(zn(t))}</option>`).join('')}</select>
        <button class="btn small primary" id="bkadd">Tambah</button></div>
      <div class="row"><input type="text" id="bkq" placeholder="Cari jawaban / alias…" value="${esc(bankQ)}" style="width:260px" />
        <span class="muted">${list.length} dari ${p.jawaban.length} · per tier: ${tiers.map((t) => `${t}=${p.jawaban.filter((j) => j.tier === t).length}`).join(' ')}</span></div>
      <div style="overflow-x:auto"><table class="bank-table"><tr><th>Teks</th><th>Alias</th><th>Tier</th><th title="Sok Pinter">🤓</th><th title="Mutiara (tepat satu)">🦪</th><th>Catatan host</th><th></th></tr>
      ${list.map((j) => `<tr data-teks="${esc(j.teks)}">
        <td><input type="text" data-f="newTeks" value="${esc(j.teks)}" /></td>
        <td><input type="text" data-f="alias" value="${esc((j.alias || []).join(', '))}" /></td>
        <td><select data-f="tier">${tiers.map((t) => `<option value="${t}" ${t === j.tier ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td><input type="checkbox" data-f="sok_pinter" ${j.sok_pinter ? 'checked' : ''} /></td>
        <td><input type="radio" name="bkmut" data-f="mutiara" ${j.mutiara ? 'checked' : ''} /></td>
        <td><input type="text" data-f="catatan" value="${esc(j.catatan || '')}" /></td>
        <td><button class="btn small bad" data-f="remove" ${j.mutiara ? 'disabled title="Pilih Mutiara lain dulu"' : ''}>×</button></td></tr>`).join('')}</table></div>`;
  }

  $('bkhead').addEventListener('change', (e) => {
    if (e.target.id === 'bksel') { bankSel = e.target.value; bankQ = ''; renderBank(); }
    if (e.target.id === 'bkimp') {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const rd = new FileReader();
      rd.onload = () => {
        let data;
        try { data = JSON.parse(rd.result); } catch { toast('File itu bukan JSON yang valid.'); return; }
        const n = Array.isArray(data.prompts) ? data.prompts.length : 0;
        if (!confirm(`Ganti SELURUH bank dengan file ini (${n} prompt)? Bank lama di-backup otomatis.`)) return;
        bankOp({ op: 'import', bank: data }, 'Bank diimport');
      };
      rd.readAsText(file);
      e.target.value = '';
    }
  });
  $('bkhead').addEventListener('click', (e) => {
    const id = e.target.id;
    if (id === 'bkreload') loadBank();
    if (id === 'bkexp') {
      const blob = new Blob([JSON.stringify(bank, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `prompts-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    if (id === 'bkdelp') {
      const p = bank.prompts.find((x) => x.id === bankSel);
      if (p && confirm(`Hapus prompt "${p.prompt}" beserta ${p.jawaban.length} jawabannya?`)) bankOp({ op: 'prompt:remove', id: bankSel }, 'Prompt dihapus');
    }
    if (id === 'bknewp') {
      const prompt = window.prompt('Teks prompt baru (misal: Sebutkan merek HP):');
      if (!prompt) return;
      const newId = window.prompt('Id singkat (huruf kecil, tanpa spasi), misal: hp', normC(prompt.replace(/^sebutkan\s+/i, '')).slice(0, 20));
      if (!newId) return;
      const mutiara = window.prompt('Satu jawaban paling langka buat jadi Mutiara (bisa diganti nanti):');
      if (!mutiara) return;
      bankOp({ op: 'prompt:add', newId, prompt, mutiara }, 'Prompt ditambahkan').then((res) => {
        if (res.ok) { bankSel = res.bank.prompts[res.bank.prompts.length - 1].id; renderBank(); }
      });
    }
  });
  $('bkbody').addEventListener('input', (e) => {
    if (e.target.id !== 'bkq') return;
    bankQ = e.target.value;
    renderBank();
    const q = $('bkq');
    q.focus();
    q.setSelectionRange(q.value.length, q.value.length);
  });
  $('bkbody').addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'bkptext') return void bankOp({ op: 'prompt:update', id: bankSel, prompt: t.value });
    if (t.id === 'bkbebas') return void bankOp({ op: 'prompt:update', id: bankSel, bebas: t.checked });
    const f = t.dataset.f;
    const tr = t.closest('tr[data-teks]');
    if (!f || !tr) return;
    const base = { id: bankSel, teks: tr.dataset.teks };
    if (f === 'mutiara') return void bankOp({ op: 'answer:mutiara', ...base }, `Mutiara sekarang: ${tr.dataset.teks}`);
    if (f === 'sok_pinter') return void bankOp({ op: 'answer:update', ...base, sok_pinter: t.checked });
    if (f === 'tier') return void bankOp({ op: 'answer:update', ...base, tier: Number(t.value) });
    bankOp({ op: 'answer:update', ...base, [f]: t.value });
  });
  $('bkbody').addEventListener('click', (e) => {
    if (e.target.id === 'bkadd') {
      const teks = $('bkat').value.trim();
      if (!teks) return toast('Isi teks jawabannya.');
      bankOp({ op: 'answer:add', id: bankSel, teks, alias: $('bkaa').value, tier: Number($('bkatier').value) }, `"${teks}" ditambahkan`);
      return;
    }
    const rm = e.target.closest('[data-f=remove]');
    if (rm) {
      const tr = rm.closest('tr[data-teks]');
      if (confirm(`Hapus jawaban "${tr.dataset.teks}"?`)) bankOp({ op: 'answer:remove', id: bankSel, teks: tr.dataset.teks });
    }
  });

  // ---------- Render ----------
  function render() {
    if (!hs || !authed) return;
    const a = hs.active;
    if (a) G.setTheme(a.color);
    renderTop(a);
    renderSessions();
    renderPlayers(a);
    renderBomb(a);
    renderFake(a);
    renderSdj(a);
    renderOrder(a);
    renderWords(a);
  }

  function renderTop(a) {
    if (!a) {
      put('top', `<h1>Panel Host</h1><span class="muted">Belum ada sesi aktif. Bikin sesi baru di tab Sesi.</span>`);
      return;
    }
    const screenMode = a.final ? 'Reveal final' : a.overlay === 'leaderboard' ? 'Leaderboard' : a.activeGame === 'bomb' ? 'Bom' : a.activeGame === 'fake' ? 'Fake It' : a.activeGame === 'sdj' ? 'Satu Dalam Sejuta' : 'Lobby';
    const online = a.players.filter((p) => p.online).length;
    put('top', `
      <h1 style="color:var(--theme)">${esc(a.squad)}</h1>
      <span class="status-pill">Kode: <b>${esc(a.code)}</b></span>
      <span class="status-pill">${online}/${a.players.length} online</span>
      <span class="status-pill">Layar: ${screenMode}</span>
      <span class="grow"></span>
      <button class="btn small" data-act="showLobby">Lobby</button>
      <button class="btn small ${a.overlay === 'leaderboard' ? 'warn' : ''}" data-act="toggleLeaderboard">${a.overlay === 'leaderboard' ? 'Tutup' : 'Tampilkan'} Leaderboard</button>
      ${a.final ? '<button class="btn small" data-act="hideFinal">Tutup Final</button>' : '<button class="btn small primary" data-act="revealFinal" data-confirm="Mulai reveal juara final di layar besar?">Reveal Final</button>'}
      <a class="btn small ghost" href="/screen" target="_blank">Buka layar</a>`);
  }

  function renderSessions() {
    put('sessions', hs.sessions.map((s) => {
      const top3 = s.leaderboard.slice(0, 3).map((e) => `#${e.rank} ${e.avatar} ${esc(e.name)} (${num(e.score)})`).join(' · ');
      const exp = expanded.has(s.id);
      return `<div class="sess-item" style="--sc:${s.color}">
        <div class="info"><b style="font-size:18px">${esc(s.squad)}</b> ${s.active ? '<span class="chip ok">AKTIF</span>' : ''} ${s.status === 'closed' ? '<span class="chip">Ditutup</span>' : ''}
          <div class="muted" style="font-size:14px">Kode ${esc(s.code)} · ${new Date(s.createdAt).toLocaleString('id-ID')} · ${s.playerCount} pemain</div>
          <div style="font-size:14px;margin-top:4px">${top3 || '<span class="muted">Belum ada skor</span>'}</div>
          ${exp ? `<div style="margin-top:8px;font-size:15px">${s.leaderboard.map((e) => `#${e.rank} ${e.avatar} ${esc(e.name)}: <b>${num(e.score)}</b>`).join('<br>')}
            ${s.titles.length ? `<div style="margin-top:6px">${s.titles.map((t) => `${t.icon} ${esc(t.title)}: ${t.winners.map((w) => esc(w.name)).join(', ')}`).join('<br>')}</div>` : ''}</div>` : ''}
        </div>
        <div class="row">
          <button class="btn small ghost" data-toggle-exp="${s.id}">${exp ? 'Sembunyikan' : 'Hasil'}</button>
          ${!s.active ? `<button class="btn small" data-act="activateSession" data-args='{"id":"${s.id}"}' ${s.status === 'closed' ? 'data-confirm="Buka lagi sesi yang sudah ditutup?"' : ''}>${s.status === 'closed' ? 'Buka lagi' : 'Aktifkan'}</button>` : ''}
          ${s.status === 'open' ? `<button class="btn small warn" data-act="closeSession" data-args='{"id":"${s.id}"}' data-confirm="Tutup sesi ${esc(s.squad)}? Pemain nggak bisa join/main lagi (hasil tetap tersimpan).">Tutup</button>` : `<button class="btn small bad" data-act="deleteSession" data-args='{"id":"${s.id}"}' data-confirm="Hapus permanen sesi ${esc(s.squad)}?">Hapus</button>`}
        </div></div>`;
    }).join('') || '<div class="muted">Belum ada sesi.</div>');
  }

  function renderPlayers(a) {
    if (!a) { put('players', '<div class="muted">Belum ada sesi aktif.</div>'); put('log', ''); put('titles', ''); return; }
    put('players', a.players.length ? `<table class="ptable"><tr><th></th><th>Nama</th><th>Skor</th><th>Ubah skor</th><th></th></tr>
      ${a.players.map((p) => `<tr>
        <td><span class="avatar" style="--pc:${p.color}">${p.avatar}</span></td>
        <td><span class="dot ${p.online ? 'on' : ''}"></span> <b>${esc(p.name)}</b><div class="muted" style="font-size:12px">meledak ${p.stats.explosions} · oper ${p.stats.passes} · lolos ${p.stats.impostorEscapes} · tebakan benar ${p.stats.correctVotes} · dituduh ${p.stats.wrongAccused}</div></td>
        <td style="font-size:20px;font-weight:800">${num(p.score)}</td>
        <td><div class="row" style="gap:4px">
          ${[-50, -10, 10, 50].map((d) => `<button class="btn small ${d < 0 ? 'bad' : 'good'}" data-act="score" data-args='{"pid":"${p.id}","delta":${d}}'>${d > 0 ? '+' : ''}${d}</button>`).join('')}
          <button class="btn small" data-act="score" data-args='{"pid":"${p.id}"}' data-prompt="Tambah/kurangi berapa poin untuk ${esc(p.name)}? (pakai minus untuk ngurangin)" data-prompt-key="delta">±</button>
        </div></td>
        <td><div class="row" style="gap:4px">
          <button class="btn small" data-act="rename" data-args='{"pid":"${p.id}"}' data-prompt="Nama baru:" data-default="${esc(p.name)}" data-prompt-key="name">Ganti nama</button>
          <button class="btn small bad" data-act="kick" data-args='{"pid":"${p.id}"}' data-confirm="Keluarkan ${esc(p.name)}? Skornya ikut hilang.">Keluarkan</button>
        </div></td></tr>`).join('')}</table>` : '<div class="muted">Belum ada pemain. Suruh scan QR di layar besar!</div>');
    put('log', a.log.map((l) => `<div>${new Date(l.t).toLocaleTimeString('id-ID')} · <b>${esc(l.name)}</b> ${fmtScore(l.delta)} <span>(${esc(l.reason)})</span></div>`).join('') || 'Belum ada.');
    put('titles', a.titles.map((t) => `<div>${t.icon} <b>${esc(t.title)}</b>: ${t.winners.map((w) => `${w.avatar} ${esc(w.name)}`).join(', ')} <span class="muted">(${esc(t.value)})</span></div>`).join('') || '<div class="muted">Belum ada data.</div>');
  }

  function renderBomb(a) {
    if (!a) { put('bstatus', '<div class="muted">Belum ada sesi aktif.</div>'); put('bsettings', ''); return; }
    const b = a.bomb;
    const st = b.settings;
    const next = b.round + 1;
    const hints = [];
    if (b.phase !== 'live' && next >= 4 && !st.double) hints.push('Ronde 4+: saatnya nyalain <b>Bom Ganda</b>!');
    if (b.phase !== 'live' && next === st.totalRounds && !st.mega) hints.push('Ronde terakhir: nyalain <b>Mega Bom</b>!');
    put('bstatus', `<div class="kv">
      <b>Status</b><span>${BOMB_PHASE[b.phase] || b.phase}</span>
      <b>Ronde</b><span>${b.round} / ${b.totalRounds}</span>
      <b>Pegang bom</b><span>${b.holders.map((h) => `${h.avatar} ${esc(h.name)}`).join(', ') || '-'}</span>
      <b>Jejak</b><span>${b.trail.map((t) => esc(t.name)).join(' → ') || '-'}</span>
      ${b.lastBlast ? `<b>Ledakan terakhir</b><span>${b.lastBlast.victims.map((v) => `${esc(v.name)} ${fmtScore(v.penalty)}`).join(', ')} (ronde ${b.lastBlast.round})</span>` : ''}
    </div>${hints.map((h) => `<div class="chip hint">${h}</div>`).join('')}`);
    put('bsettings', `<div class="grid2">
        <div class="field"><label>Sumbu min (detik)</label><input type="number" min="3" max="120" value="${st.fuseMin}" data-set="bomb:fuseMin" /></div>
        <div class="field"><label>Sumbu max (detik)</label><input type="number" min="4" max="180" value="${st.fuseMax}" data-set="bomb:fuseMax" /></div>
        <div class="field"><label>Jumlah ronde</label><input type="number" min="1" max="20" value="${st.totalRounds}" data-set="bomb:totalRounds" /></div>
      </div>
      <label class="toggle"><input type="checkbox" data-set="bomb:revenge" ${st.revenge ? 'checked' : ''} /> Aturan Balas Dendam (yang meledak mulai ronde berikutnya pegang bom)</label>
      <label class="toggle"><input type="checkbox" data-set="bomb:double" ${st.double ? 'checked' : ''} /> Bom Ganda (2 bom sekaligus, minimal 3 pemain)</label>
      <label class="toggle"><input type="checkbox" data-set="bomb:mega" ${st.mega ? 'checked' : ''} /> Mega Bom (−200, sumbu lebih pendek, oper +20)</label>
      <div class="muted">Perubahan berlaku mulai ronde berikutnya.</div>`);
  }

  function renderFake(a) {
    if (!a) { put('fstatus', '<div class="muted">Belum ada sesi aktif.</div>'); put('fsecret', ''); put('fsettings', ''); return; }
    const f = a.fake;
    const nameOf = (pid) => ((f.order || []).find((p) => p.id === pid) || {}).name || '?';
    const timer = f.phase === 'clue' ? f.turnEndsAt : ['role', 'discuss', 'vote', 'lastchance'].includes(f.phase) ? f.phaseEndsAt : 0;
    put('fstatus', `<div class="kv">
      <b>Status</b><span>${FAKE_PHASE[f.phase] || f.phase} ${timer ? `· <span data-ends="${timer}"></span> dtk` : ''}</span>
      <b>Ronde</b><span>${f.round} / ${f.totalRounds}${f.double ? ' · POIN DOBEL' : ''}</span>
      ${f.phase === 'clue' ? `<b>Giliran</b><span>${esc(nameOf(f.turnPid))} (putaran ${f.clueRound}/2)</span>` : ''}
      ${f.order ? `<b>Urutan</b><span>${f.order.map((p) => `${p.avatar} ${esc(p.name)}${p.online ? '' : ' (offline)'}`).join(' → ')}</span>` : ''}
      ${f.clues && f.clues.length ? `<b>Petunjuk</b><span>${f.clues.map((c) => `${esc(nameOf(c.pid))}: <b>${esc(c.text)}</b>`).join(' · ')}</span>` : ''}
      ${f.votes && f.votes.length ? `<b>Vote</b><span>${f.votes.map((v) => `${esc(v.from.name)} → ${esc(v.to.name)}`).join(' · ')}</span>` : ''}
      ${f.result ? `<b>Hasil</b><span>${f.result.captions.map(esc).join('<br>')}</span>` : ''}
      ${f.phase === 'cancelled' ? `<b>Info</b><span>${esc(f.cancelReason)}</span>` : ''}
    </div>`);
    put('fsecret', f.secret
      ? `<div class="secret ${showSecret ? '' : 'blur'}" id="secretBox"><div class="inner">Penipu: <b>${f.secret.impostor.avatar} ${esc(f.secret.impostor.name)}</b><br>Kata: <b style="color:var(--warn)">${esc(f.secret.word)}</b> <span class="muted">(${esc(f.secret.category)})</span></div><div class="hint">Tap buat intip (jangan sampai kelihatan pemain!)</div></div>`
      : '<div class="muted">Belum ada ronde berjalan.</div>');
    const st = f.settings;
    const cats = hs.wordBank.map((c) => c.kategori);
    const act = st.activeCategories;
    put('fsettings', `<div class="grid2">
        <div class="field"><label>Jumlah ronde (0 = sesuai jumlah pemain)</label><input type="number" min="0" max="30" value="${st.totalRounds}" data-set="fake:totalRounds" /></div>
        <div class="field"><label>Waktu petunjuk (detik)</label><input type="number" min="5" max="120" value="${st.clueSec}" data-set="fake:clueSec" /></div>
        <div class="field"><label>Waktu diskusi (detik)</label><input type="number" min="10" max="600" value="${st.discussSec}" data-set="fake:discussSec" /></div>
        <div class="field"><label>Waktu vote (detik)</label><input type="number" min="5" max="120" value="${st.voteSec}" data-set="fake:voteSec" /></div>
      </div>
      <label class="toggle"><input type="checkbox" data-set="fake:penalty" ${st.penalty ? 'checked' : ''} /> Penalti −20 untuk pemain biasa yang paling banyak dituduh</label>
      <label class="toggle"><input type="checkbox" data-set="fake:doubleLast" ${st.doubleLast ? 'checked' : ''} /> Poin Dobel di ronde terakhir</label>
      <h3>Kategori aktif sesi ini <span class="muted" style="font-size:14px">(${f.usedCount} kata sudah dipakai)</span></h3>
      <div class="row">${cats.map((c) => `<label class="toggle chip" style="font-size:16px"><input type="checkbox" data-set="fake:cat" value="${esc(c)}" ${!act || act.includes(c) ? 'checked' : ''} /> ${esc(c)}</label>`).join('')}</div>`);
  }

  function renderWords() {
    const bank = hs.wordBank;
    put('catlist', bank.map((c) => `<option value="${esc(c.kategori)}">`).join(''));
    put('wbank', bank.map((c) => `<div style="margin-bottom:12px">
      <div class="row"><b style="font-size:18px">${esc(c.kategori)}</b><span class="muted">${c.kata.length} kata</span>
      <button class="btn small bad" data-act="words:remove" data-args='${esc(JSON.stringify({ kategori: c.kategori }))}' data-confirm="Hapus kategori ${esc(c.kategori)} beserta semua katanya?">Hapus kategori</button></div>
      <div>${c.kata.map((k) => `<span class="word-chip">${esc(k)}<button data-act="words:remove" data-args='${esc(JSON.stringify({ kategori: c.kategori, kata: k }))}' title="Hapus">×</button></span>`).join('')}</div></div>`).join('') || '<div class="muted">Bank kata kosong.</div>');
  }
})();
