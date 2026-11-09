// Player phone (/play).
(function () {
  const { esc, Clock, Sound, toast, num } = G;
  const socket = io({ reconnectionDelay: 400, reconnectionDelayMax: 2000 });
  const $app = document.getElementById('app');
  const $head = document.getElementById('head');
  const $conn = document.getElementById('conn');

  const AVATARS = ['😎', '🤠', '🥸', '🤓', '😈', '👻', '🤖', '👽', '🐵', '🐸', '🐼', '🦊', '🐯', '🦄', '🐔', '🐙', '🦖', '🍌', '🌶️', '🍕', '🥑', '🧋', '🚀', '⚡'];
  const ID_KEY = 'sprintgame:identity';
  const urlCode = (new URLSearchParams(location.search).get('c') || '').trim().toUpperCase();

  let state = null;
  let joined = false;
  let curKey = null;
  let tickTimer = null;
  let lockTimer = null;
  let prevMyTurn = false;
  let wakeLock = null;

  const loadId = () => { try { return JSON.parse(localStorage.getItem(ID_KEY)); } catch { return null; } };
  const saveId = (v) => { try { localStorage.setItem(ID_KEY, JSON.stringify(v)); } catch {} };
  const clearId = () => { try { localStorage.removeItem(ID_KEY); } catch {} };
  const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      keepAwake();
      if (!socket.connected) socket.connect();
    }
  });

  // ---------- Connection & identity ----------
  socket.on('connect', () => {
    $conn.classList.add('hidden');
    const id = loadId();
    if (id && (!urlCode || id.code === urlCode)) {
      socket.emit('player:resume', id, (res) => {
        if (res && res.ok) {
          joined = true;
        } else {
          clearId();
          joined = false;
          state = null;
          showJoin(res && res.closed ? 'Sesi lamamu sudah ditutup. Join sesi baru ya!' : '');
        }
      });
    } else if (!joined && curKey !== 'join') {
      showJoin();
    }
  });
  socket.on('disconnect', () => { if (joined) $conn.classList.remove('hidden'); });

  socket.on('state', (v) => {
    if (!joined) return;
    state = v;
    Clock.sync(v.serverNow);
    G.setTheme(v.session && v.session.color);
    render();
  });

  socket.on('kicked', () => {
    clearId();
    joined = false;
    state = null;
    showJoin('Kamu dikeluarkan sama host 😢 Bisa join lagi kok.');
  });

  socket.on('fx', (fx) => {
    if (!state || !joined) return;
    const me = state.me.id;
    const nameOf = (pid) => (state.players.find((p) => p.id === pid) || {}).name || '?';
    switch (fx.type) {
      case 'bomb:explode':
        Sound.boom();
        if (fx.victims.includes(me)) {
          vibrate([500, 150, 500, 150, 300]);
          document.body.classList.remove('flash');
          void document.body.offsetWidth;
          document.body.classList.add('flash');
          setTimeout(() => document.body.classList.remove('flash'), 1600);
        }
        break;
      case 'bomb:pass':
        if (fx.to === me) {
          vibrate([120, 60, 120]);
          Sound.whoosh();
          toast(fx.auto ? 'Bom nyasar ke kamu!' : `Bom dari ${nameOf(fx.from)}!`);
        }
        break;
      case 'bomb:start':
        if (fx.holders.includes(me)) vibrate([200, 80, 200]);
        break;
      case 'fake:start':
        Sound.notify();
        vibrate(150);
        break;
      case 'fake:phase':
        if (fx.phase === 'vote') { Sound.notify(); vibrate(150); }
        break;
      case 'score':
        if (fx.pid === me) toast(`Host ngasih kamu ${G.fmtScore(fx.delta)} poin`);
        break;
      case 'reset':
        toast('Sesi di-reset host. Skor balik ke 0!');
        break;
    }
  });

  // ---------- Join ----------
  function showJoin(msg) {
    curKey = 'join';
    document.body.classList.remove('hot');
    $head.classList.add('hidden');
    stopTick();
    let avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    $app.innerHTML = `
      <div style="margin-top:6px">
        <div class="brand">Sprint<br><span>Games!</span></div>
        <div class="muted" style="font-size:16px;font-weight:600;margin-top:14px">Bom Kentang Panas + Fake It Till You Make It</div>
      </div>
      ${msg ? `<div class="panel center err">${esc(msg)}</div>` : ''}
      <div class="panel stack">
        <div class="${urlCode ? 'hidden' : ''}">
          <label class="muted">Kode sesi (lihat di layar besar)</label>
          <input id="code" type="text" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="ABCD" value="${esc(urlCode)}" style="text-transform:uppercase;letter-spacing:6px;font-size:26px;text-align:center" />
        </div>
        <div>
          <label class="muted">Nama kamu</label>
          <input id="name" type="text" maxlength="16" autocomplete="off" placeholder="Misal: Budi" />
        </div>
        <div>
          <label class="muted">Pilih avatar</label>
          <div class="avatar-pick" id="avs">${AVATARS.map((a) => `<button type="button" data-a="${a}" class="${a === avatar ? 'sel' : ''}">${a}</button>`).join('')}</div>
        </div>
        <div id="jerr" class="err"></div>
        <button class="btn primary big" id="go">Tap buat ikutan chaos!</button>
      </div>`;
    const $name = $app.querySelector('#name');
    const prev = loadId();
    if (prev && prev.name) $name.value = prev.name;
    $app.querySelector('#avs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-a]');
      if (!b) return;
      avatar = b.dataset.a;
      $app.querySelectorAll('#avs button').forEach((x) => x.classList.toggle('sel', x === b));
    });
    const go = $app.querySelector('#go');
    const submit = () => {
      Sound.unlock();
      keepAwake();
      const code = (urlCode || $app.querySelector('#code').value).trim().toUpperCase();
      const name = $name.value.trim();
      const $err = $app.querySelector('#jerr');
      if (!code) return void ($err.textContent = 'Isi kode sesinya dulu!');
      if (!name) return void ($err.textContent = 'Isi nama dulu dong!');
      go.disabled = true;
      socket.emit('player:join', { code, name, avatar }, (res) => {
        go.disabled = false;
        if (!res || !res.ok) return void ($err.textContent = (res && res.error) || 'Gagal join, coba lagi.');
        saveId({ sid: res.sid, pid: res.pid, token: res.token, code: res.code, name });
        joined = true;
        Sound.success();
      });
    };
    go.addEventListener('click', submit);
    $name.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  // ---------- Render ----------
  function renderHead() {
    const m = state.me;
    $head.classList.remove('hidden');
    $head.innerHTML = `
      <span class="avatar" style="--pc:${m.color}">${m.avatar}</span>
      <span class="name">${esc(m.name)}</span>
      <span><div class="score">${num(m.score)}</div><div class="rank">#${m.rank} dari ${m.total}</div></span>`;
  }

  function render() {
    if (!joined || !state) return;
    renderHead();
    const v = pickView(state);
    document.body.classList.toggle('hot', !!v.hot);
    if (v.key !== curKey) {
      curKey = v.key;
      const view = document.createElement('div');
      view.className = 'view';
      $app.replaceChildren(view);
      v.build(view);
    }
    if (v.after) v.after();
    syncTick(!!v.hot);
  }

  function syncTick(on) {
    if (on && !tickTimer) tickTimer = setInterval(() => Sound.tick(), 650);
    if (!on) stopTick();
  }
  function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }

  const simple = (key, html, hot = false) => ({ key, hot, build: (el) => { el.innerHTML = html; } });

  function pickView(st) {
    if (st.session.status !== 'open') {
      return {
        key: 'closed',
        build: (el) => {
          el.innerHTML = `<div class="fill-center center"><div class="big-msg">Sesi udah ditutup</div><div class="mid-msg muted">Makasih udah main! Skor akhirmu: <b>${num(st.me.score)}</b></div><button class="btn ghost" id="newj">Join sesi baru</button></div>`;
          el.querySelector('#newj').onclick = () => { clearId(); joined = false; state = null; showJoin(); };
        },
      };
    }
    if (st.final) return simple(`final-${st.me.rank}-${st.me.score}`, `<div class="fill-center center"><div class="big-msg">Lihat layar besar!</div><div class="mid-msg">Pengumuman juara lagi berlangsung… 🥁</div><div class="panel mid-msg">Peringkat kamu: <b>#${st.me.rank}</b><br>Skor: <b>${num(st.me.score)}</b></div></div>`);
    const busy = (st.bomb && st.bomb.phase === 'live') || (st.fake && ['role', 'clue', 'discuss', 'vote', 'reveal', 'lastchance'].includes(st.fake.phase));
    if (st.overlay === 'leaderboard' && !busy) return simple(`lb-${st.me.rank}-${st.me.score}`, `<div class="fill-center center"><div class="big-msg">Cek leaderboard di layar besar!</div><div class="panel mid-msg">Kamu peringkat <b>#${st.me.rank}</b> dengan <b>${num(st.me.score)}</b> poin</div></div>`);
    if (st.activeGame === 'bomb' && st.bomb) return bombView(st);
    if (st.activeGame === 'fake' && st.fake) return fakeView(st);
    const others = st.players.filter((p) => p.id !== st.me.id);
    return simple(
      `lobby-${others.map((p) => p.id + p.name + p.online).join()}`,
      `<div class="fill-center center">
        <div class="emoji-xl">${st.me.avatar}</div>
        <div class="big-msg">Kamu udah masuk, ${esc(st.me.name)}!</div>
        <div class="mid-msg muted">Tunggu host mulai game ya… sambil pemanasan jempol 👍</div>
        <div class="panel"><div class="muted" style="margin-bottom:8px">Pemain lain (${others.length}):</div>
        <div class="row" style="justify-content:center">${others.map((p) => `<span class="chip">${p.avatar} ${esc(p.name)}</span>`).join('') || '<span class="muted">Belum ada… kamu yang pertama! 🥇</span>'}</div></div>
      </div>`
    );
  }

  // ---------- Bom Kentang Panas ----------
  function bombView(st) {
    const b = st.bomb;
    const me = st.me;
    if (b.phase === 'live') {
      const mine = b.myBombs;
      if (mine.length) {
        const bm = mine[0];
        const lockLeft = Clock.left(bm.lockedUntil);
        const locked = lockLeft > 0;
        if (locked) {
          clearTimeout(lockTimer);
          lockTimer = setTimeout(() => { curKey = null; render(); }, lockLeft + 60);
        }
        const tkey = bm.solved ? bm.targets.map((t) => t.id).join(',') : '';
        return {
          key: `bh-${bm.id}-${bm.challenge.id}-${bm.solved}-${locked}-${mine.length}-${tkey}`,
          hot: true,
          build: (el) => buildHolder(el, st, bm, mine.length, locked),
        };
      }
      const names = b.holders.map((h) => esc(h.name));
      const uniq = [...new Set(names)];
      return simple(
        `bw-${b.round}-${b.holders.map((h) => h.id).join()}-${me.score}`,
        `<div class="fill-center center">
          <div class="bomb-icon">💣</div>
          <div class="big-msg">${uniq.join(' & ')} lagi pegang bom!</div>
          <div class="mid-msg muted">Ronde ${b.round}/${b.totalRounds}${b.mega ? ' · MEGA BOM' : ''}${b.double ? ' · BOM GANDA' : ''}</div>
          <div class="panel mid-msg">Skor kamu: <b>${num(me.score)}</b><br><span class="muted" style="font-size:16px">Teriakin dia biar panik 📣</span></div>
        </div>`
      );
    }
    if (b.phase === 'blast' && b.lastBlast) {
      const v = b.lastBlast.victims.find((x) => x.id === me.id);
      if (v) {
        return simple(`bb-${b.round}-me`, `<div class="fill-center center"><div class="emoji-xl">💥</div><div class="big-msg">DUAR! Kamu meledak!</div><div class="big-msg neg-text">${G.fmtScore(v.penalty)}</div><div class="mid-msg muted">Tenang, masih ada ronde berikutnya… mungkin 😅</div></div>`);
      }
      return simple(`bb-${b.round}-${me.score}`, `<div class="fill-center center"><div class="emoji-xl">💥</div><div class="big-msg">${b.lastBlast.victims.map((x) => esc(x.name)).join(' & ')} meledak!</div><div class="mid-msg">Kamu selamat… untuk sekarang 😏</div><div class="panel mid-msg">Skor kamu: <b>${num(me.score)}</b></div></div>`);
    }
    if (b.phase === 'over') {
      return simple(`bo-${me.score}`, `<div class="fill-center center"><div class="big-msg">Bom Kentang Panas selesai!</div><div class="panel mid-msg">Skor kamu: <b>${num(me.score)}</b><br>Peringkat #${me.rank}</div><div class="mid-msg muted">Lihat layar besar 👀</div></div>`);
    }
    return simple(
      `bi-${b.round}`,
      `<div class="fill-center center">
        <div class="bomb-icon">💣</div>
        <div class="big-msg">Bom Kentang Panas</div>
        <div class="mid-msg">Ronde ${b.round + 1} sebentar lagi. Siap-siap!</div>
        <div class="panel" style="text-align:left;font-size:17px;line-height:1.5">
          Pegang bom? Selesaikan challenge, terus lempar!<br>
          Tiap oper: <b>+${b.mega ? 20 : 10}</b><br>
          Meledak di tangan: <b>−${b.mega ? 200 : 100}</b><br>
          Nggak boleh oper balik ke yang barusan ngelempar
        </div>
      </div>`
    );
  }

  function buildHolder(el, st, bm, count, locked) {
    const top = `${count > 1 ? '<div class="two-bombs">Kamu pegang 2 BOM!!</div>' : ''}`;
    if (locked) {
      el.innerHTML = `${top}<div class="fill-center"><div class="bomb-icon">💣</div><div class="locked">Salah! Terkunci…<div class="num" data-ends="${bm.lockedUntil}">3</div></div></div>`;
      return;
    }
    if (bm.solved) {
      const blocked = bm.blocked && !bm.targets.some((t) => t.id === bm.blocked.id) ? bm.blocked : null;
      el.innerHTML = `${top}
        <div class="chal-title">Mantap! Lempar ke siapa?</div>
        <div class="targets">
          ${bm.targets.map((t) => `<button class="btn" data-t="${t.id}"><span class="av">${t.avatar}</span>${esc(t.name)}</button>`).join('')}
          ${blocked ? `<button class="btn blocked" disabled><span class="av">${blocked.avatar}</span>${esc(blocked.name)}<small>baru ngoper ke kamu</small></button>` : ''}
        </div>
        <button class="btn warn big" data-t="random">Lempar Acak!</button>`;
      el.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-t]');
        if (!btn || btn.disabled) return;
        el.querySelectorAll('button').forEach((x) => (x.disabled = true));
        Sound.whoosh();
        socket.emit('bomb:throw', { bombId: bm.id, target: btn.dataset.t }, (res) => {
          if (!res || !res.ok) {
            toast((res && res.error) || 'Gagal lempar!');
            curKey = null;
            render();
          }
        });
      });
      return;
    }
    el.innerHTML = `${top}<div class="chal-title">${esc(bm.challenge.title)}</div><div class="chal-prompt">${esc(bm.challenge.prompt)}</div><div id="chal" class="stack"></div>`;
    let answered = false;
    const done = (ok) => {
      if (answered) return;
      answered = true;
      if (ok) {
        Sound.success();
        socket.emit('bomb:solve', { bombId: bm.id, challengeId: bm.challenge.id }, (res) => {
          if (!res || !res.ok) { toast((res && res.error) || 'Ups'); curKey = null; render(); }
        });
      } else {
        Sound.buzz();
        vibrate(250);
        socket.emit('bomb:fail', { bombId: bm.id }, () => {});
      }
    };
    buildChallenge(el.querySelector('#chal'), bm.challenge, done);
  }

  function buildChallenge(el, c, done) {
    const opts = (list, cls = '') => `<div class="opts ${cls}">${list.map((o) => `<button class="btn" data-o="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
    const onOpt = (answer) => el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-o]');
      if (b) done(b.dataset.o === answer);
    });
    switch (c.type) {
      case 'tap': {
        let n = 0;
        el.innerHTML = `<button class="tap-bomb" id="tb">💣</button><div class="tap-count"><span id="tc">0</span> / ${c.count}</div>`;
        const tb = el.querySelector('#tb');
        tb.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          n++;
          el.querySelector('#tc').textContent = n;
          tb.style.transform = `scale(${0.9 + Math.random() * 0.2}) rotate(${Math.random() * 30 - 15}deg)`;
          if (n >= c.count) done(true);
        });
        tb.addEventListener('contextmenu', (e) => e.preventDefault());
        break;
      }
      case 'hitung':
        el.innerHTML = `<div class="reverse-word" style="letter-spacing:2px">${esc(c.prompt)}</div>${opts(c.options)}`;
        el.parentElement.querySelector('.chal-prompt').textContent = 'Jawab secepatnya!';
        onOpt(c.answer);
        break;
      case 'jebakan':
        el.innerHTML = opts(c.options, 'long');
        onOpt(c.answer);
        break;
      case 'warna':
        el.innerHTML = `<div class="color-word" style="color:${esc(c.ink)}">${esc(c.word)}</div>${opts(c.options)}`;
        onOpt(c.answer);
        break;
      case 'beda':
        el.innerHTML = `<div class="grid9">${c.grid.map((g, i) => `<button data-i="${i}">${g}</button>`).join('')}</div>`;
        el.addEventListener('click', (e) => {
          const b = e.target.closest('button[data-i]');
          if (b) done(Number(b.dataset.i) === c.answer);
        });
        break;
      case 'kebalik': {
        el.innerHTML = `<div class="reverse-word">${esc(c.shown)}</div><input id="rv" type="text" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" maxlength="20" style="text-transform:uppercase;font-size:28px;text-align:center" /><button class="btn primary big" id="rvb">Jawab!</button>`;
        const inp = el.querySelector('#rv');
        const check = () => {
          const v = inp.value.replace(/\s+/g, '').toUpperCase();
          if (v) done(v === c.answer.replace(/\s+/g, ''));
        };
        el.querySelector('#rvb').onclick = check;
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
        inp.addEventListener('input', () => { if (inp.value.replace(/\s+/g, '').toUpperCase() === c.answer) check(); });
        setTimeout(() => inp.focus(), 50);
        break;
      }
      case 'geser': {
        el.innerHTML = `<div class="slider-wrap"><div class="slider-zone-track"><div class="slider-zone" style="left:${c.zoneStart}%;width:${c.zoneWidth}%"></div></div><input type="range" class="defuse" min="0" max="100" step="0.5" value="0" id="sl" /></div><div class="mid-msg">Lepas jarinya pas di zona hijau</div>`;
        const sl = el.querySelector('#sl');
        let moved = false;
        sl.addEventListener('input', () => { moved = true; });
        sl.addEventListener('change', () => {
          if (!moved) return;
          const v = Number(sl.value);
          done(v >= c.zoneStart - 1 && v <= c.zoneStart + c.zoneWidth + 1);
        });
        break;
      }
      case 'tahan': {
        el.innerHTML = `<div class="hold-btn" id="hb">TAHAN</div><div class="mid-msg" id="hr">Hitung dalam hati…</div>`;
        const hb = el.querySelector('#hb');
        let t0 = 0;
        const down = (e) => { e.preventDefault(); if (t0) return; t0 = performance.now(); hb.classList.add('down'); };
        const up = (e) => {
          e.preventDefault();
          if (!t0) return;
          const ms = performance.now() - t0;
          t0 = 0;
          hb.classList.remove('down');
          el.querySelector('#hr').textContent = `${(ms / 1000).toFixed(2).replace('.', ',')} detik`;
          done(Math.abs(ms - c.targetMs) <= c.toleranceMs);
        };
        hb.addEventListener('pointerdown', down);
        hb.addEventListener('pointerup', up);
        hb.addEventListener('pointercancel', up);
        hb.addEventListener('pointerleave', up);
        hb.addEventListener('contextmenu', (e) => e.preventDefault());
        break;
      }
      default:
        el.innerHTML = `<button class="btn good big">Tap buat lanjut</button>`;
        el.querySelector('button').onclick = () => done(true);
    }
  }

  // ---------- Fake It Till You Make It ----------
  const ACTIVE = ['role', 'clue', 'discuss', 'vote', 'reveal', 'lastchance'];

  function clueListHtml(f) {
    if (!f.clues || !f.clues.length) return '';
    const by = {};
    for (const c of f.clues) (by[c.pid] = by[c.pid] || []).push(c);
    return `<div class="clue-list">${f.order
      .filter((p) => by[p.id])
      .map((p) => `<div class="clue-item"><span>${p.avatar}</span><span class="grow">${esc(p.name)}</span>${by[p.id].map((c) => `<b>${esc(c.text)}</b>`).join(' · ')}</div>`)
      .join('')}</div>`;
  }

  function peekHtml(card) {
    const body = card.role === 'impostor'
      ? `<div>Kategori: ${esc(card.category)}</div><span class="w">Kamu PENIPU!</span><div style="font-size:17px;margin-top:6px">Jangan sampai ketahuan…</div>`
      : `<div>Kategori: ${esc(card.category)}</div><span class="w">${esc(card.word.toUpperCase())}</span><div style="font-size:17px;margin-top:6px">Kasih petunjuk yang nggak terlalu jelas!</div>`;
    return `<div class="peek" id="peek"><div class="cover">Tahan di sini buat lihat kartumu</div><div class="reveal">${body}</div></div>`;
  }

  function bindPeek(el) {
    const pk = el.querySelector('#peek');
    if (!pk) return;
    const on = (e) => { e.preventDefault(); pk.classList.add('down'); };
    const off = () => pk.classList.remove('down');
    pk.addEventListener('pointerdown', on);
    pk.addEventListener('pointerup', off);
    pk.addEventListener('pointercancel', off);
    pk.addEventListener('pointerleave', off);
    pk.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    pk.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function fakeView(st) {
    const f = st.fake;
    const me = st.me;
    if (f.phase === 'idle') {
      return simple('fi', `<div class="fill-center center"><div class="emoji-xl">🎭</div><div class="big-msg">Fake It Till You Make It</div>
        <div class="panel" style="text-align:left;font-size:17px;line-height:1.5">
        Semua dapat kata rahasia yang sama, kecuali <b>si Penipu</b>.<br>
        Gantian kasih <b>satu kata</b> petunjuk.<br>
        Vote siapa penipunya!<br>
        Nebak penipu bener: <b>+50</b> · Penipu lolos: <b>+150</b></div></div>`);
    }
    if (f.phase === 'cancelled') return simple(`fc-${f.cancelReason}`, `<div class="fill-center center"><div class="big-msg">Ronde dibatalkan</div><div class="mid-msg">${esc(f.cancelReason)}</div><div class="mid-msg muted">Ronde baru sebentar lagi…</div></div>`);
    if (f.phase === 'over') return simple(`fo-${me.score}`, `<div class="fill-center center"><div class="big-msg">Fake It selesai!</div><div class="panel mid-msg">Skor kamu: <b>${num(me.score)}</b><br>Peringkat #${me.rank}</div></div>`);
    if (f.phase === 'result') {
      const d = (f.result.deltas && f.result.deltas[me.id]) || 0;
      const imp = f.order.find((p) => p.id === f.impostor) || { name: '?', avatar: '❓' };
      return simple(`fr-${f.round}-${me.score}`, `<div class="fill-center center">
        <div class="emoji-xl">${f.impostor === me.id ? '🎭' : imp.avatar}</div>
        <div class="big-msg">${f.impostor === me.id ? 'Kamu penipunya!' : `Penipunya: ${esc(imp.name)}`}</div>
        <div class="mid-msg">Kata rahasia: <b class="hl">${esc(f.word)}</b></div>
        <div class="big-msg ${d > 0 ? 'pos-text' : d < 0 ? 'neg-text' : 'muted'}">${d ? G.fmtScore(d) : '±0'}</div>
        <div class="mid-msg muted">${f.result.captions.map(esc).join('<br>')}</div></div>`);
    }
    if (!ACTIVE.includes(f.phase)) return simple('fx-' + f.phase, '');
    if (!f.participant) {
      return simple(`fnp-${f.round}`, `<div class="fill-center center"><div class="big-msg">Kamu baru join!</div><div class="mid-msg">Ikut ronde berikutnya ya. Sekarang nonton dulu 🍿</div></div>`);
    }

    // Shell: peek card stays mounted for the whole round; only the body re-renders.
    return {
      key: `fs-${f.round}-${f.card ? f.card.role + (f.card.word || '') : 'x'}`,
      build: (el) => {
        el.innerHTML = `${f.card ? peekHtml(f.card) : ''}<div id="fkb" class="stack" style="flex:1"></div>`;
        bindPeek(el);
      },
      after: () => renderFakeBody(st),
    };
  }

  function renderFakeBody(st) {
    const f = st.fake;
    const box = document.getElementById('fkb');
    if (!box) return;
    let key;
    let html;
    let bind = null;
    const nameOf = (pid) => (f.order.find((p) => p.id === pid) || {}).name || '?';
    const head = `<div class="muted center" style="font-weight:700">Ronde ${f.round}/${f.totalRounds} · Kategori: ${esc(f.category)}${f.double ? ' · POIN DOBEL' : ''}</div>`;

    if (f.myTurn && !prevMyTurn) { vibrate([150, 80, 150]); Sound.notify(); }
    prevMyTurn = !!f.myTurn;

    switch (f.phase) {
      case 'role':
        key = 'role';
        html = `${head}<div class="fill-center center"><div class="big-msg">Cek kartumu diam-diam!</div><div class="mid-msg muted">Tahan kotak di atas. Jangan sampai diintip orang sebelah 👀</div><div class="timer-big" data-ends="${f.phaseEndsAt}"></div></div>`;
        break;
      case 'clue':
        if (f.myTurn) {
          key = `myturn-${f.clues.length}`;
          html = `${head}<div class="panel stack center"><div class="big-msg">Giliran KAMU!</div><div class="mid-msg">Putaran ${f.clueRound}/2 · Satu kata aja</div>
            <div class="timer-big" data-bind="turnEndsAt" data-ends="${f.turnEndsAt}"></div>
            <input id="clue" type="text" maxlength="20" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Petunjuk…" style="font-size:26px;text-align:center" />
            <div id="cerr" class="err"></div>
            <button class="btn primary big" id="csend">Kirim</button></div>${clueListHtml(f)}`;
          bind = (el) => {
            const inp = el.querySelector('#clue');
            const btn = el.querySelector('#csend');
            inp.addEventListener('input', () => { if (/\s/.test(inp.value)) inp.value = inp.value.replace(/\s+/g, ''); });
            const send = () => {
              const text = inp.value.trim();
              if (!text) return;
              btn.disabled = true;
              socket.emit('fake:clue', { text }, (res) => {
                btn.disabled = false;
                if (!res || !res.ok) {
                  el.querySelector('#cerr').textContent = (res && res.error) || 'Gagal kirim';
                  Sound.buzz();
                }
              });
            };
            btn.onclick = send;
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
            setTimeout(() => inp.focus(), 80);
          };
        } else {
          key = `turn-${f.turnPid}-${f.clues.length}`;
          html = `${head}<div class="panel center stack"><div class="mid-msg">Putaran ${f.clueRound}/2</div><div class="big-msg">Giliran ${esc(nameOf(f.turnPid))}</div><div class="timer-big" data-bind="turnEndsAt" data-ends="${f.turnEndsAt}"></div></div>${clueListHtml(f)}`;
        }
        break;
      case 'discuss':
        key = 'discuss';
        html = `${head}<div class="panel center stack"><div class="big-msg">Debat!</div><div class="mid-msg">Siapa yang mencurigakan? Ngomong langsung!</div><div class="timer-big" data-bind="phaseEndsAt" data-ends="${f.phaseEndsAt}"></div></div>${clueListHtml(f)}`;
        break;
      case 'vote': {
        const opts = f.order.filter((p) => p.id !== st.me.id);
        key = `vote-${f.myVote}`;
        html = `${head}<div class="center"><div class="big-msg">Siapa penipunya?</div><div class="timer-big" data-bind="phaseEndsAt" data-ends="${f.phaseEndsAt}"></div></div>
          <div class="vote-list">${opts.map((p) => `<button class="btn ${f.myVote === p.id ? 'sel' : ''}" data-v="${p.id}"><span class="av">${p.avatar}</span>${esc(p.name)}</button>`).join('')}</div>
          <div class="mid-msg muted">${f.myVote ? `Vote kamu: <b>${esc(nameOf(f.myVote))}</b> (masih bisa ganti)` : 'Tap salah satu'}</div>${clueListHtml(f)}`;
        bind = (el) => el.addEventListener('click', (e) => {
          const b = e.target.closest('button[data-v]');
          if (!b) return;
          socket.emit('fake:vote', { target: b.dataset.v }, (res) => { if (!res || !res.ok) toast((res && res.error) || 'Gagal vote'); });
        });
        break;
      }
      case 'reveal':
        key = 'reveal';
        html = `${head}<div class="fill-center center"><div class="big-msg">Lihat layar besar!</div><div class="mid-msg">Vote lagi dibuka satu-satu… 🥁</div></div>`;
        break;
      case 'lastchance':
        if (f.amImpostorGuessing && !f.alreadyGuessed) {
          key = 'guess';
          html = `<div class="panel stack center"><div class="big-msg">Kamu ketahuan!</div><div class="mid-msg">Kesempatan terakhir: tebak kata rahasianya!</div>
            <div class="timer-big" data-bind="phaseEndsAt" data-ends="${f.phaseEndsAt}"></div>
            <input id="guess" type="text" maxlength="40" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Kata rahasianya…" style="font-size:24px;text-align:center" />
            <button class="btn primary big" id="gsend">Tebak!</button></div>${clueListHtml(f)}`;
          bind = (el) => {
            const inp = el.querySelector('#guess');
            const send = () => {
              if (!inp.value.trim()) return;
              socket.emit('fake:guess', { text: inp.value }, (res) => { if (!res || !res.ok) toast((res && res.error) || 'Gagal'); });
            };
            el.querySelector('#gsend').onclick = send;
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
            setTimeout(() => inp.focus(), 80);
          };
        } else {
          key = `lc-${f.alreadyGuessed}`;
          html = `<div class="fill-center center"><div class="emoji-xl">🎭</div><div class="big-msg">${esc(nameOf(f.impostor))} ketahuan!</div><div class="mid-msg">${f.alreadyGuessed ? 'Tebakan masuk… deg-degan 😬' : 'Lagi nebak kata rahasia… kesempatan terakhir!'}</div><div class="timer-big" data-bind="phaseEndsAt" data-ends="${f.phaseEndsAt}"></div></div>`;
        }
        break;
    }
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      const inner = document.createElement('div');
      inner.className = 'view';
      inner.innerHTML = html;
      box.replaceChildren(inner);
      if (bind) bind(inner);
    }
    box.querySelectorAll('[data-bind]').forEach((el) => { el.dataset.ends = f[el.dataset.bind]; });
  }

  // Show the join form right away on first visit, instead of a blank page until the socket connects.
  if (!loadId()) showJoin();
})();
