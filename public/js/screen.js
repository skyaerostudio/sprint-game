// Big screen (/screen).
(function () {
  const { esc, Clock, Sound, num, countUp, confetti } = G;
  const socket = io({ reconnectionDelay: 400, reconnectionDelayMax: 2000 });
  const $stage = document.getElementById('stage');
  const $overlay = document.getElementById('overlay');
  const $fx = document.getElementById('fxlayer');
  const $corner = document.getElementById('corner');
  const $gate = document.getElementById('gate');

  let st = null;
  let mode = null;
  let overlayKey = null;
  let joinBase = location.origin;
  const seenPlayers = new Set();
  let lastClue = null; // {pid, pass, at}

  // ---- Sound gate ----
  $gate.addEventListener('click', () => { Sound.unlock(); setTimeout(checkGate, 150); });
  function checkGate() { $gate.classList.toggle('hidden', Sound.ready()); }
  setInterval(checkGate, 1000);

  fetch('/api/info').then((r) => r.json()).then((info) => {
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
    if (info.publicUrl) joinBase = info.publicUrl;
    else if (local && info.lanIps && info.lanIps.length) joinBase = `http://${info.lanIps[0]}:${location.port || info.port}`;
    mode = null;
    render();
  }).catch(() => {});

  socket.on('connect', () => socket.emit('screen:hello', () => {}));
  socket.on('state', (v) => {
    st = v;
    Clock.sync(v.serverNow);
    if (v.session) G.setTheme(v.session.color);
    render();
  });
  socket.on('fx', onFx);

  const joinUrl = () => (st && st.session ? `${joinBase}/play?c=${st.session.code}` : '');
  const av = (p, extra = '') => `<span class="avatar" style="--pc:${p.color || '#888'}" ${extra}>${p.avatar}</span>`;

  // ---------- Render dispatch ----------
  function render() {
    if (!st) return;
    renderOverlay();
    let m;
    if (!st.session) m = 'none';
    else if (st.activeGame === 'bomb' && st.bomb) m = `bomb-${st.session.id}`;
    else if (st.activeGame === 'fake' && st.fake) m = `fake-${st.session.id}`;
    else m = `lobby-${st.session.id}`;
    if (m !== mode) {
      mode = m;
      stopBombLoops();
      $stage.innerHTML = '';
      if (m === 'none') buildNone();
      else if (m.startsWith('bomb')) buildBomb();
      else if (m.startsWith('fake')) buildFake();
      else buildLobby();
    }
    if (m.startsWith('bomb')) updateBomb();
    else if (m.startsWith('fake')) updateFake();
    else if (m.startsWith('lobby')) updateLobby();

    const showCorner = st.session && !m.startsWith('lobby');
    $corner.classList.toggle('hidden', !showCorner);
    if (showCorner) $corner.innerHTML = `Join / nyambung lagi: ${esc(joinBase.replace(/^https?:\/\//, ''))}/play · kode <b>${esc(st.session.code)}</b>`;
  }

  function buildNone() {
    $stage.innerHTML = `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2vw">
      <div class="scr-title">Sprint Event Games</div>
      <div class="scr-sub">Belum ada sesi aktif. Host, bikin sesi dulu di <b>/host</b> ya!</div></div>`;
  }

  // ---------- Lobby ----------
  function buildLobby() {
    const s = st.session;
    $stage.innerHTML = `
      <div class="scr-head"><div><div class="scr-title"><span class="theme-text">${esc(s.squad)}</span></div><div class="scr-sub">Sprint Games: Bom Kentang Panas + Fake It Till You Make It</div></div>
      <div class="scr-sub" id="lcount"></div></div>
      <div class="lobby">
        <div class="qr-box"><div class="lead">Scan buat join!</div><img id="qr" alt="QR" /><div class="code">${esc(s.code)}</div><div class="url" id="jurl"></div></div>
        <div class="lobby-players" id="lp"></div>
      </div>`;
    const url = joinUrl();
    $stage.querySelector('#qr').src = `/api/qr.svg?text=${encodeURIComponent(url)}`;
    $stage.querySelector('#jurl').textContent = url;
  }

  function updateLobby() {
    const lp = document.getElementById('lp');
    if (!lp) return;
    lp.innerHTML = st.players.map((p) => {
      const isNew = !seenPlayers.has(p.id);
      seenPlayers.add(p.id);
      return `<div class="lp ${isNew ? 'new' : ''} ${p.online ? '' : 'off'}">${av(p)}<div class="nm">${esc(p.name)}</div></div>`;
    }).join('') || '<div class="scr-sub" style="margin-top:4vw">Belum ada yang join… siapa yang paling berani? 👀</div>';
    document.getElementById('lcount').textContent = `${st.players.filter((p) => p.online).length} pemain online`;
  }

  // ---------- Leaderboard ----------
  function lbHtml(list, compact = false) {
    return `<div class="lb ${compact ? 'compact' : ''}">${list.map((e, i) => `
      <div class="lb-row ${!compact && e.rank <= 3 ? 'r' + e.rank : ''}" style="animation-delay:${compact ? 0 : i * 0.08}s">
        <div class="rk">#${e.rank}</div>${av(e)}<div class="nm">${esc(e.name)}</div><div class="sc" data-score="${e.score}">${num(e.score)}</div>
      </div>`).join('')}</div>`;
  }

  function renderOverlay() {
    let key = null;
    if (st.session && st.final) key = `final-${st.final.startedAt}`;
    else if (st.session && st.overlay === 'leaderboard') key = `lb-${st.leaderboard.map((e) => e.id + e.score).join()}`;
    if (key === overlayKey) return;
    const wasFinal = overlayKey && overlayKey.startsWith('final');
    overlayKey = key;
    if (!key || !key.startsWith('final')) stopFinal();
    if (!key) { $overlay.innerHTML = ''; return; }
    if (key.startsWith('lb')) {
      $overlay.innerHTML = `<div class="overlay-full"><div class="scr-title center">Leaderboard <span class="theme-text">${esc(st.session.squad)}</span></div>${lbHtml(st.leaderboard)}</div>`;
      $overlay.querySelectorAll('[data-score]').forEach((el) => countUp(el, Number(el.dataset.score), 1400));
      Sound.ding();
      return;
    }
    if (!wasFinal) startFinal();
  }

  // ---------- Final reveal ----------
  let finalTimers = [];
  function stopFinal() { finalTimers.forEach(clearTimeout); finalTimers = []; }
  function startFinal() {
    stopFinal();
    const f = st.final;
    const lb = f.leaderboard;
    const top = [lb[0], lb[1], lb[2]];
    const elapsed = Clock.now() - f.startedAt;
    const podSlot = (e, n) => (e ? `<div class="pod p${n}" id="pod${n}">${av(e)}<div class="nm">${esc(e.name)}</div><div class="sc" data-final="${e.score}">0</div><div class="block">${n}</div></div>` : '');
    $overlay.innerHTML = `<div class="final" id="final">
      <div class="final-msg" id="fmsg">Saatnya pengumuman JUARA!</div>
      <div class="podium">${podSlot(top[1], 2)}${podSlot(top[0], 1)}${podSlot(top[2], 3)}</div>
      <div class="titles" id="ftitles"></div>
      <div id="frest" class="row" style="justify-content:center"></div>
    </div>`;
    const $msg = $overlay.querySelector('#fmsg');
    const live = (t) => elapsed < t + 400; // only play effects for steps that happen now, not on reload catch-up
    const at = (t, fn) => finalTimers.push(setTimeout(() => fn(live(t)), Math.max(0, t - elapsed)));
    const showPod = (n, isLive) => {
      const el = $overlay.querySelector(`#pod${n}`);
      if (!el) return;
      el.classList.add('show');
      const sc = el.querySelector('[data-final]');
      if (isLive) countUp(sc, Number(sc.dataset.final), 1500);
      else sc.textContent = num(Number(sc.dataset.final));
    };
    at(0, (l) => l && Sound.drumroll(3));
    at(3500, (l) => { if (top[2]) { $msg.textContent = 'Juara 3'; showPod(3, l); l && Sound.ding(); } });
    at(7000, (l) => { if (top[1]) { $msg.textContent = 'Juara 2'; showPod(2, l); l && Sound.ding(); } });
    at(10500, (l) => { $msg.textContent = 'Dan juara pertama adalah…'; l && Sound.drumroll(3); });
    at(14000, (l) => {
      if (top[0]) {
        $msg.textContent = `${top[0].name} JUARA!`;
        showPod(1, l);
        if (l) { Sound.fanfare(); confetti(6000); }
      }
    });
    const titles = f.titles || [];
    at(19000, () => { $overlay.querySelector('#final').classList.add('compact'); $msg.textContent = 'Gelar Kehormatan'; });
    titles.forEach((t, i) => at(19800 + i * 1500, (l) => {
      const box = $overlay.querySelector('#ftitles');
      box.insertAdjacentHTML('beforeend', `<div class="title-card"><div class="ic">${t.icon}</div><div class="tt">${esc(t.title)}</div><div class="wn">${t.winners.map((w) => `${w.avatar} ${esc(w.name)}`).join(', ')}</div><div class="vl">${esc(t.value)}</div></div>`);
      l && Sound.pop();
    }));
    at(19800 + titles.length * 1500 + 500, (l) => {
      $overlay.querySelector('#frest').innerHTML = lb.slice(3).map((e) => `<span class="chip" style="font-size:1.5vw">#${e.rank} ${e.avatar} ${esc(e.name)} · ${num(e.score)}</span>`).join('');
      $msg.textContent = 'Makasih udah main, kalian keren!';
      if (l) confetti(4000);
    });
  }

  // ---------- Bom Kentang Panas ----------
  let fuseP = 0;
  let fuseTimer = null;
  let tickTimer = null;
  function stopBombLoops() { clearInterval(fuseTimer); clearTimeout(tickTimer); fuseTimer = tickTimer = null; }

  function buildBomb() {
    $stage.innerHTML = `
      <div class="scr-head"><div><div class="scr-title">Bom Kentang Panas <span id="bbadges"></span></div><div class="scr-sub" id="bsub"></div></div></div>
      <div class="bomb-stage">
        <div class="stack" style="min-height:0">
          <div class="fuse hidden" id="fuse"><div class="burn" id="burn"></div><div class="spark" id="spark">✨</div></div>
          <div class="bomb-area" id="barea" style="flex:1"></div>
          <div class="trail" id="trail"></div>
        </div>
        <div class="side-panel"><h3>Skor</h3><div id="blb"></div></div>
      </div>`;
  }

  function updateBomb() {
    const b = st.bomb;
    document.getElementById('bbadges').innerHTML = `${b.mega ? '<span class="badge mega">MEGA BOM</span>' : ''}${b.double ? '<span class="badge double">BOM GANDA</span>' : ''}`;
    document.getElementById('bsub').textContent = b.round ? `Ronde ${b.round} dari ${b.totalRounds}` : `${b.totalRounds} ronde · siap-siap!`;
    document.getElementById('blb').innerHTML = lbHtml(st.leaderboard, true);
    const $area = document.getElementById('barea');
    const $fuse = document.getElementById('fuse');
    const $trail = document.getElementById('trail');
    $fuse.classList.toggle('hidden', b.phase !== 'live');

    if (b.phase === 'live') {
      const key = 'live-' + b.round + '-' + b.holders.map((h) => h.bombId + h.id).join();
      if ($area.dataset.key !== key) {
        $area.dataset.key = key;
        const two = b.holders.length > 1;
        $area.innerHTML = b.holders.map((h) => `<div class="bomb-unit ${two ? 'two' : ''}" data-bomb="${h.bombId}"><div class="bomb-big">💣</div><div class="holder">${av(h)}<span class="nm">${esc(h.name)}</span></div></div>`).join('');
      }
      $trail.innerHTML = b.trail.length ? `Jejak: ${b.trail.map((p) => `<span class="t">${p.avatar} ${esc(p.name)}</span>`).join(' → ')}` : '';
      startBombLoops();
    } else {
      stopBombLoops();
      $trail.innerHTML = '';
      let key;
      let html;
      if (b.phase === 'blast' && b.lastBlast) {
        key = 'blast-' + b.round;
        html = `<div class="center stack" style="align-items:center"><div style="font-size:10vw">💥</div>
          ${b.lastBlast.captions.map((c) => `<div class="scr-title" style="font-size:3.2vw">${esc(c)}</div>`).join('')}
          <div class="scr-sub">${b.round >= b.totalRounds ? 'Itu ronde terakhir!' : `Ronde ${b.round + 1} sebentar lagi…`}</div></div>`;
      } else if (b.phase === 'over') {
        key = 'over';
        html = `<div class="center stack" style="align-items:center"><div class="scr-title">Bom Kentang Panas selesai!</div><div class="scr-sub">Cek skor di samping 👉</div></div>`;
      } else {
        key = 'idle-' + b.round;
        html = `<div class="center stack" style="align-items:center"><div style="font-size:12vw;animation:pulse 1.2s infinite">💣</div>
          <div class="scr-title">Ronde ${b.round + 1} siap-siap!</div>
          <div class="scr-sub" style="max-width:50vw">Pegang bom → selesaikan challenge → lempar! Oper: <b>+${b.mega ? 20 : 10}</b> · Meledak: <b>−${b.mega ? 200 : 100}</b> · Nggak boleh oper balik!</div></div>`;
      }
      if ($area.dataset.key !== key) { $area.dataset.key = key; $area.innerHTML = html; }
    }
  }

  function startBombLoops() {
    if (!fuseTimer) {
      fuseP = 0.04;
      fuseTimer = setInterval(() => {
        // Deliberately unrelated to the real fuse: random wobble that never reaches the end.
        const r = Math.random();
        if (r < 0.08) fuseP -= 0.08 + Math.random() * 0.1;
        else fuseP += Math.random() * 0.05 - 0.008;
        fuseP = Math.min(0.94, Math.max(0.03, fuseP));
        const burn = document.getElementById('burn');
        const spark = document.getElementById('spark');
        if (burn) { burn.style.left = fuseP * 100 + '%'; burn.style.width = (1 - fuseP) * 100 + '%'; }
        if (spark) spark.style.left = fuseP * 100 + '%';
      }, 280);
    }
    if (!tickTimer) {
      const loop = () => { Sound.tick(); tickTimer = setTimeout(loop, 300 + Math.random() * 700); };
      loop();
    }
  }

  function bombFx(fx) {
    const nameOf = (pid) => (st.players.find((p) => p.id === pid) || {}).name || '?';
    if (fx.type === 'bomb:start') { Sound.notify(); fuseP = 0.04; }
    if (fx.type === 'bomb:pass') {
      Sound.whoosh();
      setTimeout(() => {
        const unit = document.querySelector(`[data-bomb="${fx.bombId}"] .bomb-big`);
        const fly = document.createElement('div');
        fly.className = 'fly';
        fly.textContent = '💣';
        if (unit) {
          const r = unit.getBoundingClientRect();
          fly.style.left = r.left + r.width / 2 - innerWidth * 0.045 + 'px';
          fly.style.top = r.top + r.height / 2 - innerWidth * 0.05 + 'px';
        } else { fly.style.left = '40vw'; fly.style.top = '35vh'; }
        $fx.appendChild(fly);
        setTimeout(() => fly.remove(), 800);
      }, 30);
      const area = document.getElementById('barea');
      if (area) {
        area.querySelectorAll('.pass-banner').forEach((x) => x.remove());
        const ban = document.createElement('div');
        ban.className = 'pass-banner';
        ban.textContent = fx.auto ? `${nameOf(fx.from)} hilang sinyal → bom nyasar ke ${nameOf(fx.to)}!` : `${nameOf(fx.from)} → ${nameOf(fx.to)}`;
        area.appendChild(ban);
        setTimeout(() => ban.remove(), 1800);
      }
    }
    if (fx.type === 'bomb:explode') {
      Sound.boom();
      $stage.classList.remove('shake-screen');
      void $stage.offsetWidth;
      $stage.classList.add('shake-screen');
      const vic = fx.victims.map((pid) => st.players.find((p) => p.id === pid)).filter(Boolean);
      const ov = document.createElement('div');
      ov.className = 'boom-overlay';
      ov.innerHTML = `<div class="bx">💥</div>${fx.captions.map((c) => `<div class="cap">${esc(c)}</div>`).join('')}
        <div class="row" style="justify-content:center">${vic.map((p) => `<span class="pen">${p.avatar} ${esc(p.name)} ${G.fmtScore(fx.penalties[p.id])}</span>`).join('')}</div>`;
      $fx.appendChild(ov);
      setTimeout(() => ov.remove(), 4600);
    }
  }

  // ---------- Fake It ----------
  let rv = null; // reveal animation state
  let rvTimer = null;

  function buildFake() {
    $stage.innerHTML = `
      <div class="scr-head"><div><div class="scr-title">Fake It Till You Make It <span id="fbadges"></span></div><div class="scr-sub" id="fsub"></div></div>
      <div class="fk-center"><div class="fk-big-timer" id="ftimer"></div></div></div>
      <div class="fk-banner" id="fban"></div>
      <div class="fk-stage"><div class="fk-cards" id="fcards"></div><svg class="arrows" id="farrows"></svg></div>
      <div id="fbot"></div>`;
  }

  const ACTIVE = ['role', 'clue', 'discuss', 'vote', 'reveal', 'lastchance'];

  function updateFake() {
    const f = st.fake;
    document.getElementById('fbadges').innerHTML = f.double ? '<span class="badge mega">POIN DOBEL</span>' : '';
    document.getElementById('fsub').innerHTML = f.round ? `Ronde ${f.round} dari ${f.totalRounds}${f.category ? ` · Kategori: <b class="theme-text">${esc(f.category)}</b>` : ''}` : `${f.totalRounds} ronde · siap-siap!`;
    const $timer = document.getElementById('ftimer');
    const $ban = document.getElementById('fban');
    const $cards = document.getElementById('fcards');
    const $bot = document.getElementById('fbot');
    const nameOf = (pid) => ((f.order || []).find((p) => p.id === pid) || st.players.find((p) => p.id === pid) || {}).name || '?';

    const timerEnds = f.phase === 'clue' ? 0 : ['role', 'discuss', 'vote', 'lastchance'].includes(f.phase) ? f.phaseEndsAt : 0;
    $timer.dataset.ends = timerEnds || '';
    if (!timerEnds) $timer.textContent = '';

    if (f.phase !== 'reveal') stopReveal();
    document.getElementById('farrows').innerHTML = f.phase === 'reveal' ? document.getElementById('farrows').innerHTML : '';

    const setBan = (key, html) => { if ($ban.dataset.key !== key) { $ban.dataset.key = key; $ban.innerHTML = html; } };

    if (!ACTIVE.includes(f.phase) && f.phase !== 'result') {
      $cards.innerHTML = '';
      if (f.phase === 'cancelled') setBan('c' + f.cancelReason, `${esc(f.cancelReason)}`);
      else if (f.phase === 'over') setBan('over', 'Fake It selesai!');
      else setBan('idle' + f.round, `Ronde ${f.round + 1} sebentar lagi…`);
      $bot.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:3vw;align-items:start">
        <div class="side-panel" style="font-size:1.9vw;line-height:1.6">Semua dapat <b>kata rahasia</b> sama, kecuali <b>si Penipu</b><br>Gantian kasih <b>satu kata</b> petunjuk (2 putaran)<br>Debat, lalu vote!<br>Nebak penipu: <b>+50</b> · Penipu lolos: <b>+150</b></div>
        <div class="side-panel"><h3>Skor</h3>${lbHtml(st.leaderboard, true)}</div></div>`;
      return;
    }

    renderCards(f);
    $bot.innerHTML = '';

    switch (f.phase) {
      case 'role':
        setBan('role' + f.round, `Cek HP kalian! <span class="muted">Tahan tombol buat lihat kata rahasia</span>`);
        break;
      case 'clue':
        setBan(`clue-${f.turnPid}-${f.clueRound}`, `Putaran ${f.clueRound}/2 · Giliran <span class="theme-text">${esc(nameOf(f.turnPid))}</span>`);
        break;
      case 'discuss':
        setBan('discuss', 'Debat! Siapa yang mencurigakan?');
        break;
      case 'vote':
        setBan('vote', `Waktunya vote di HP! <span class="muted">(${f.votedIds.length}/${f.order.length})</span>`);
        $ban.dataset.key = 'vote-' + f.votedIds.length;
        break;
      case 'reveal':
        runReveal(f);
        break;
      case 'lastchance':
        setBan('lc', `<span class="theme-text">${esc(nameOf(f.impostor))}</span> ketahuan! Kesempatan terakhir nebak kata…`);
        break;
      case 'result': {
        const r = f.result;
        setBan('res' + f.round, `${r.captions.map((c) => `<div class="fk-caption">${esc(c)}</div>`).join('')}`);
        $bot.innerHTML = `<div class="center" style="font-size:2.6vw;font-weight:800">Kata rahasia: <span class="fk-word">${esc(f.word)}</span>${r.guess != null ? ` <span class="muted" style="font-size:2vw">· tebakan penipu: "${esc(r.guess)}" ${r.guessCorrect ? '(benar!)' : '(salah)'}</span>` : ''}</div>`;
        break;
      }
    }
  }

  function renderCards(f) {
    const $cards = document.getElementById('fcards');
    const by = {};
    for (const c of f.clues || []) by[`${c.pid}:${c.pass}`] = c;
    const showImp = f.phase === 'lastchance' || f.phase === 'result' || (rv && rv.unmasked);
    const tally = (f.reveal && (f.phase !== 'reveal' || (rv && rv.unmasked))) ? f.reveal.tally : null;
    const key = JSON.stringify([f.phase, f.round, f.turnPid, f.clues && f.clues.length, f.votedIds, showImp, f.order.map((p) => p.online), tally, f.result && f.result.deltas]);
    if ($cards.dataset.key === key) return;
    $cards.dataset.key = key;
    const n = f.order.length;
    const rows = n > 8 ? Math.ceil(n / 8) : 1;
    $cards.style.setProperty('--n', Math.max(5, Math.ceil(n / rows)));
    $cards.classList.toggle('many', n > 5);
    $cards.classList.toggle('multi', rows > 1);
    $cards.innerHTML = f.order.map((p) => {
      const slot = (pass) => {
        const c = by[`${p.id}:${pass}`];
        if (!c) return '<div class="clue empty">·</div>';
        const pop = lastClue && lastClue.pid === p.id && lastClue.pass === pass && Date.now() - lastClue.at < 1500;
        return `<div class="clue ${c.silent ? 'silent' : ''} ${pop ? 'pop' : ''}">${esc(c.text)}</div>`;
      };
      const isTurn = f.phase === 'clue' && f.turnPid === p.id;
      const isImp = showImp && f.reveal && f.reveal.impostor === p.id;
      const t = tally && tally[p.id] ? `<div class="tally">${tally[p.id]}</div>` : '';
      const d = f.phase === 'result' && f.result.deltas[p.id] ? `<div class="delta ${f.result.deltas[p.id] > 0 ? 'pos' : 'neg'}">${G.fmtScore(f.result.deltas[p.id])}</div>` : '';
      return `<div class="fk-card ${isTurn ? 'turn' : ''} ${isImp ? 'impostor' : ''} ${showImp && !isImp ? 'dim' : ''}" data-pid="${p.id}" style="${p.online ? '' : 'opacity:.5'}">
        ${isTurn ? `<div class="turn-timer" data-ends="${f.turnEndsAt}"></div>` : ''}
        ${f.phase === 'vote' && f.votedIds.includes(p.id) ? '<div class="voted">sudah vote</div>' : ''}
        ${t}${av(p)}<div class="nm">${esc(p.name)}</div><div class="clues">${slot(1)}${slot(2)}</div>${d}</div>`;
    }).join('');
  }

  // Reveal animation is a pure function of elapsed time, so a reload mid-reveal resumes at the right step.
  function runReveal(f) {
    const R = f.reveal;
    if (!rv || rv.startedAt !== R.startedAt) {
      rv = { startedAt: R.startedAt, shown: -1, drum: false, unmasked: false, first: true };
    }
    rv.f = f;
    if (!rvTimer) rvTimer = setInterval(stepReveal, 100);
    stepReveal(true);
  }
  function stopReveal() { clearInterval(rvTimer); rvTimer = null; if (st && st.fake && st.fake.phase !== 'reveal') rv = null; }

  function stepReveal(forceRedraw) {
    if (!rv) return;
    const f = rv.f;
    const R = f.reveal;
    const el = Clock.now() - R.startedAt;
    const n = R.seq.length;
    const k = Math.max(0, Math.min(n, Math.floor((el - R.intro) / R.perVote) + 1));
    const drumAt = R.intro + n * R.perVote;
    const unmaskAt = drumAt + R.drum;
    const live = !rv.first;
    const $ban = document.getElementById('fban');
    const nameOf = (pid) => (f.order.find((p) => p.id === pid) || {}).name || '?';

    if (forceRedraw === true || k !== rv.shown) {
      const newOne = live && k === rv.shown + 1;
      rv.shown = k;
      drawArrows(f, k, newOne);
      if (newOne && k > 0) Sound.pop();
      if (!rv.drum && el < drumAt) {
        const v = R.seq[k - 1];
        $ban.dataset.key = 'rv' + k;
        $ban.innerHTML = k === 0 ? 'Buka vote satu per satu…' : `${esc(nameOf(v.from))} ➜ <span class="theme-text">${esc(nameOf(v.to))}</span>`;
        if (n === 0) $ban.innerHTML = 'Nggak ada yang vote!';
      }
    }
    if (el >= drumAt && !rv.drum) {
      rv.drum = true;
      $ban.dataset.key = 'drum';
      $ban.innerHTML = 'Dan penipunya adalah…';
      if (live && el < unmaskAt) Sound.drumroll(Math.max(0.5, (unmaskAt - el) / 1000 - 0.2));
    }
    if (el >= unmaskAt && !rv.unmasked) {
      rv.unmasked = true;
      const name = esc(nameOf(R.impostor)).toUpperCase();
      $ban.dataset.key = 'unmask';
      $ban.innerHTML = `<div class="fk-caption">${R.caught ? `Ternyata ${name} penipunya! 😱` : `${name} sukses menipu kalian semua 🎭`}</div>`;
      document.getElementById('fcards').dataset.key = '';
      renderCards(f);
      drawArrows(f, n, false);
      if (live) { if (R.caught) { Sound.fanfare(); confetti(2500); } else Sound.sad(); }
    }
    rv.first = false;
  }

  function drawArrows(f, k, animateLast) {
    const svg = document.getElementById('farrows');
    const box = document.querySelector('.fk-stage');
    if (!svg || !box) return;
    const R = f.reveal;
    const base = box.getBoundingClientRect();
    const center = (pid) => {
      const c = document.querySelector(`.fk-card[data-pid="${pid}"]`);
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2, h: r.height, w: r.width };
    };
    // live tally on cards
    const tally = {};
    R.seq.slice(0, k).forEach((v) => { tally[v.to] = (tally[v.to] || 0) + 1; });
    document.querySelectorAll('.fk-card').forEach((c) => {
      const old = c.querySelector('.tally');
      const n = tally[c.dataset.pid];
      if (!n) { if (old) old.remove(); return; }
      if (old) { if (old.textContent !== String(n)) { old.textContent = n; old.style.animation = 'none'; void old.offsetWidth; old.style.animation = ''; } }
      else c.insertAdjacentHTML('afterbegin', `<div class="tally">${n}</div>`);
    });
    let out = '';
    R.seq.slice(0, k).forEach((v, i) => {
      const a = center(v.from);
      const b = center(v.to);
      if (!a || !b) return;
      const color = (f.order.find((p) => p.id === v.from) || {}).color || '#fff';
      // Cards sit in one row, so arc each arrow upward above the cards (bigger arc for longer jumps).
      // Land beside the tally badge (top-center), on the side the arrow comes from.
      const dir = Math.sign(b.x - a.x) || 1;
      const x1 = a.x + dir * a.w * 0.18;
      const y1 = a.y - a.h * 0.5;
      const x2 = b.x - dir * b.w * 0.24;
      const y2 = b.y - b.h * 0.5 + 4;
      const span = Math.abs(x2 - x1);
      const cx = (x1 + x2) / 2;
      const cy = Math.min(y1, y2) - Math.min(110, Math.max(40, span * 0.12)) - (i % 3) * 12;
      // Arrowhead follows the curve's tangent at the end (control point -> end).
      let ux = x2 - cx;
      let uy = y2 - cy;
      const ul = Math.hypot(ux, uy) || 1;
      ux /= ul; uy /= ul;
      const hs = 24;
      const p1 = `${x2},${y2}`;
      const p2 = `${x2 - ux * hs - uy * hs * 0.6},${y2 - uy * hs + ux * hs * 0.6}`;
      const p3 = `${x2 - ux * hs + uy * hs * 0.6},${y2 - uy * hs - ux * hs * 0.6}`;
      const isLast = i === k - 1;
      const cls = isLast && animateLast ? 'draw' : isLast ? '' : 'old';
      const dc = cls === 'draw' ? 'draw' : '';
      const d = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
      out += `<g class="${cls === 'old' ? 'old' : ''}"><path class="ink ${dc}" d="${d}" /><path class="col ${dc}" d="${d}" stroke="${color}" /><polygon class="${dc}" points="${p1} ${p2} ${p3}" fill="${color}" /></g>`;
    });
    svg.innerHTML = out;
  }

  // ---------- FX ----------
  function onFx(fx) {
    if (!st || !st.session || fx.sid !== st.session.id) return;
    switch (fx.type) {
      case 'join': Sound.pop(); break;
      case 'fake:clue':
        lastClue = { pid: fx.pid, pass: fx.pass, at: Date.now() };
        fx.silent ? Sound.buzz() : Sound.pop();
        break;
      case 'fake:start': Sound.notify(); break;
      case 'fake:phase': if (fx.phase === 'vote' || fx.phase === 'discuss') Sound.notify(); break;
      case 'fake:result': if (fx.guessCorrect) { Sound.fanfare(); confetti(2500); } break;
      case 'fake:cancel': Sound.buzz(); break;
      case 'score': Sound.ding(); break;
      default:
        if (fx.type.startsWith('bomb:')) bombFx(fx);
    }
  }

  window.addEventListener('resize', () => { if (rv && rv.f) drawArrows(rv.f, rv.shown, false); });
})();
