// Host panel (/host).
(function () {
  const { esc, Clock, toast, num, fmtScore } = G;
  const socket = io({ reconnectionDelay: 400, reconnectionDelayMax: 2000 });
  const PW_KEY = 'sprintgame:hostpw';
  const THEMES = ['#ff6d00', '#ff1744', '#f50057', '#d500f9', '#651fff', '#2979ff', '#00b0ff', '#00e5ff', '#1de9b6', '#00e676', '#c6ff00', '#ffd600'];
  const FAKE_PHASE = { idle: 'Belum mulai', role: '🤫 Lihat peran', clue: '✍️ Petunjuk', discuss: '🗣️ Diskusi', vote: '🗳️ Vote', reveal: '🥁 Reveal', lastchance: '🎯 Kesempatan terakhir', result: '📋 Hasil', cancelled: '🔁 Dibatalkan', over: '🏁 Selesai' };
  const BOMB_PHASE = { idle: 'Belum mulai / antar ronde', live: '🔥 Ronde jalan', blast: '💥 Baru meledak', over: '🏁 Selesai' };

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
        if (!res || !res.ok) toast(`⚠️ ${(res && res.error) || 'Gagal'}`);
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
    if (res.ok) { $('squad').value = ''; toast(`✅ Sesi "${squad}" aktif di layar besar`); }
  };
  $('wadd').onclick = async () => {
    const kategori = $('wcat').value.trim();
    const kata = $('wwords').value;
    if (!kategori || !kata.trim()) return toast('Isi kategori dan katanya!');
    const res = await act('words:add', { kategori, kata });
    if (res.ok) { $('wwords').value = ''; toast(`✅ ${res.added} kata ditambahkan`); }
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
    renderWords(a);
  }

  function renderTop(a) {
    if (!a) {
      put('top', `<h1>🎛️ Panel Host</h1><span class="muted">Belum ada sesi aktif. Bikin sesi baru di tab 📁 Sesi.</span>`);
      return;
    }
    const screenMode = a.final ? '🏆 Reveal final' : a.overlay === 'leaderboard' ? '📊 Leaderboard' : a.activeGame === 'bomb' ? '💣 Bom' : a.activeGame === 'fake' ? '🎭 Fake It' : '🏠 Lobby';
    const online = a.players.filter((p) => p.online).length;
    put('top', `
      <h1 style="color:var(--theme)">${esc(a.squad)}</h1>
      <span class="status-pill">Kode: <b>${esc(a.code)}</b></span>
      <span class="status-pill">👥 ${online}/${a.players.length} online</span>
      <span class="status-pill">Layar: ${screenMode}</span>
      <span class="grow"></span>
      <button class="btn small" data-act="showLobby">🏠 Lobby</button>
      <button class="btn small ${a.overlay === 'leaderboard' ? 'warn' : ''}" data-act="toggleLeaderboard">📊 ${a.overlay === 'leaderboard' ? 'Tutup' : 'Tampilkan'} Leaderboard</button>
      ${a.final ? '<button class="btn small" data-act="hideFinal">↩️ Tutup Final</button>' : '<button class="btn small primary" data-act="revealFinal" data-confirm="Mulai reveal juara final di layar besar?">🏆 Reveal Final</button>'}
      <a class="btn small ghost" href="/screen" target="_blank">🖥️ Buka layar</a>`);
  }

  function renderSessions() {
    put('sessions', hs.sessions.map((s) => {
      const top3 = s.leaderboard.slice(0, 3).map((e) => `${['🥇', '🥈', '🥉'][e.rank - 1] || '#' + e.rank} ${e.avatar} ${esc(e.name)} (${num(e.score)})`).join(' · ');
      const exp = expanded.has(s.id);
      return `<div class="sess-item" style="--sc:${s.color}">
        <div class="info"><b style="font-size:18px">${esc(s.squad)}</b> ${s.active ? '<span class="chip" style="background:var(--good);color:#062b14">AKTIF</span>' : ''} ${s.status === 'closed' ? '<span class="chip">🔒 Ditutup</span>' : ''}
          <div class="muted" style="font-size:14px">Kode ${esc(s.code)} · ${new Date(s.createdAt).toLocaleString('id-ID')} · ${s.playerCount} pemain</div>
          <div style="font-size:14px;margin-top:4px">${top3 || '<span class="muted">Belum ada skor</span>'}</div>
          ${exp ? `<div style="margin-top:8px;font-size:15px">${s.leaderboard.map((e) => `#${e.rank} ${e.avatar} ${esc(e.name)}: <b>${num(e.score)}</b>`).join('<br>')}
            ${s.titles.length ? `<div style="margin-top:6px">${s.titles.map((t) => `${t.icon} ${esc(t.title)}: ${t.winners.map((w) => esc(w.name)).join(', ')}`).join('<br>')}</div>` : ''}</div>` : ''}
        </div>
        <div class="row">
          <button class="btn small ghost" data-toggle-exp="${s.id}">${exp ? 'Sembunyikan' : '👁️ Hasil'}</button>
          ${!s.active ? `<button class="btn small" data-act="activateSession" data-args='{"id":"${s.id}"}' ${s.status === 'closed' ? 'data-confirm="Buka lagi sesi yang sudah ditutup?"' : ''}>${s.status === 'closed' ? '🔓 Buka lagi' : '📺 Aktifkan'}</button>` : ''}
          ${s.status === 'open' ? `<button class="btn small warn" data-act="closeSession" data-args='{"id":"${s.id}"}' data-confirm="Tutup sesi ${esc(s.squad)}? Pemain nggak bisa join/main lagi (hasil tetap tersimpan).">🔒 Tutup</button>` : `<button class="btn small bad" data-act="deleteSession" data-args='{"id":"${s.id}"}' data-confirm="Hapus permanen sesi ${esc(s.squad)}?">🗑️</button>`}
        </div></div>`;
    }).join('') || '<div class="muted">Belum ada sesi.</div>');
  }

  function renderPlayers(a) {
    if (!a) { put('players', '<div class="muted">Belum ada sesi aktif.</div>'); put('log', ''); put('titles', ''); return; }
    put('players', a.players.length ? `<table class="ptable"><tr><th></th><th>Nama</th><th>Skor</th><th>Ubah skor</th><th></th></tr>
      ${a.players.map((p) => `<tr>
        <td><span class="avatar" style="--pc:${p.color}">${p.avatar}</span></td>
        <td><span class="dot ${p.online ? 'on' : ''}"></span> <b>${esc(p.name)}</b><div class="muted" style="font-size:12px">💥${p.stats.explosions} · 🔁${p.stats.passes} · 🎭${p.stats.impostorEscapes} · 🕵️${p.stats.correctVotes} · 🤡${p.stats.wrongAccused}</div></td>
        <td style="font-size:20px;font-weight:800">${num(p.score)}</td>
        <td><div class="row" style="gap:4px">
          ${[-50, -10, 10, 50].map((d) => `<button class="btn small ${d < 0 ? 'bad' : 'good'}" data-act="score" data-args='{"pid":"${p.id}","delta":${d}}'>${d > 0 ? '+' : ''}${d}</button>`).join('')}
          <button class="btn small" data-act="score" data-args='{"pid":"${p.id}"}' data-prompt="Tambah/kurangi berapa poin untuk ${esc(p.name)}? (pakai minus untuk ngurangin)" data-prompt-key="delta">±</button>
        </div></td>
        <td><div class="row" style="gap:4px">
          <button class="btn small" data-act="rename" data-args='{"pid":"${p.id}"}' data-prompt="Nama baru:" data-default="${esc(p.name)}" data-prompt-key="name">✏️</button>
          <button class="btn small bad" data-act="kick" data-args='{"pid":"${p.id}"}' data-confirm="Keluarkan ${esc(p.name)}? Skornya ikut hilang.">🚫</button>
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
    if (b.phase !== 'live' && next >= 4 && !st.double) hints.push('💡 Ronde 4+: saatnya nyalain <b>Bom Ganda</b>!');
    if (b.phase !== 'live' && next === st.totalRounds && !st.mega) hints.push('💡 Ronde terakhir: nyalain <b>Mega Bom</b>!');
    put('bstatus', `<div class="kv">
      <b>Status</b><span>${BOMB_PHASE[b.phase] || b.phase}</span>
      <b>Ronde</b><span>${b.round} / ${b.totalRounds}</span>
      <b>Pegang bom</b><span>${b.holders.map((h) => `${h.avatar} ${esc(h.name)}`).join(', ') || '-'}</span>
      <b>Jejak</b><span>${b.trail.map((t) => esc(t.name)).join(' → ') || '-'}</span>
      ${b.lastBlast ? `<b>Ledakan terakhir</b><span>${b.lastBlast.victims.map((v) => `${esc(v.name)} ${fmtScore(v.penalty)}`).join(', ')} (ronde ${b.lastBlast.round})</span>` : ''}
    </div>${hints.map((h) => `<div class="chip" style="background:var(--warn);color:#3a2a00">${h}</div>`).join('')}`);
    put('bsettings', `<div class="grid2">
        <div class="field"><label>Sumbu min (detik)</label><input type="number" min="3" max="120" value="${st.fuseMin}" data-set="bomb:fuseMin" /></div>
        <div class="field"><label>Sumbu max (detik)</label><input type="number" min="4" max="180" value="${st.fuseMax}" data-set="bomb:fuseMax" /></div>
        <div class="field"><label>Jumlah ronde</label><input type="number" min="1" max="20" value="${st.totalRounds}" data-set="bomb:totalRounds" /></div>
      </div>
      <label class="toggle"><input type="checkbox" data-set="bomb:revenge" ${st.revenge ? 'checked' : ''} /> 😈 Aturan Balas Dendam (yang meledak mulai ronde berikutnya pegang bom)</label>
      <label class="toggle"><input type="checkbox" data-set="bomb:double" ${st.double ? 'checked' : ''} /> 💣💣 Bom Ganda (2 bom sekaligus, minimal 3 pemain)</label>
      <label class="toggle"><input type="checkbox" data-set="bomb:mega" ${st.mega ? 'checked' : ''} /> 💥 Mega Bom (−200, sumbu lebih pendek, oper +20)</label>
      <div class="muted">Perubahan berlaku mulai ronde berikutnya.</div>`);
  }

  function renderFake(a) {
    if (!a) { put('fstatus', '<div class="muted">Belum ada sesi aktif.</div>'); put('fsecret', ''); put('fsettings', ''); return; }
    const f = a.fake;
    const nameOf = (pid) => ((f.order || []).find((p) => p.id === pid) || {}).name || '?';
    const timer = f.phase === 'clue' ? f.turnEndsAt : ['role', 'discuss', 'vote', 'lastchance'].includes(f.phase) ? f.phaseEndsAt : 0;
    put('fstatus', `<div class="kv">
      <b>Status</b><span>${FAKE_PHASE[f.phase] || f.phase} ${timer ? `· <span data-ends="${timer}"></span> dtk` : ''}</span>
      <b>Ronde</b><span>${f.round} / ${f.totalRounds}${f.double ? ' · 🔥 POIN DOBEL' : ''}</span>
      ${f.phase === 'clue' ? `<b>Giliran</b><span>${esc(nameOf(f.turnPid))} (putaran ${f.clueRound}/2)</span>` : ''}
      ${f.order ? `<b>Urutan</b><span>${f.order.map((p) => `${p.avatar} ${esc(p.name)}${p.online ? '' : ' 📡'}`).join(' → ')}</span>` : ''}
      ${f.clues && f.clues.length ? `<b>Petunjuk</b><span>${f.clues.map((c) => `${esc(nameOf(c.pid))}: <b>${esc(c.text)}</b>`).join(' · ')}</span>` : ''}
      ${f.votes && f.votes.length ? `<b>Vote</b><span>${f.votes.map((v) => `${esc(v.from.name)} → ${esc(v.to.name)}`).join(' · ')}</span>` : ''}
      ${f.result ? `<b>Hasil</b><span>${f.result.captions.map(esc).join('<br>')}</span>` : ''}
      ${f.phase === 'cancelled' ? `<b>Info</b><span>${esc(f.cancelReason)}</span>` : ''}
    </div>`);
    put('fsecret', f.secret
      ? `<div class="secret ${showSecret ? '' : 'blur'}" id="secretBox"><div class="inner">🎭 Penipu: <b>${f.secret.impostor.avatar} ${esc(f.secret.impostor.name)}</b><br>🔑 Kata: <b style="color:var(--warn)">${esc(f.secret.word)}</b> <span class="muted">(${esc(f.secret.category)})</span></div><div class="hint">👆 Tap buat intip (jangan sampai kelihatan pemain!)</div></div>`
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
      <label class="toggle"><input type="checkbox" data-set="fake:penalty" ${st.penalty ? 'checked' : ''} /> 🤨 Penalti −20 untuk pemain biasa yang paling banyak dituduh</label>
      <label class="toggle"><input type="checkbox" data-set="fake:doubleLast" ${st.doubleLast ? 'checked' : ''} /> 🔥 Poin Dobel di ronde terakhir</label>
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
