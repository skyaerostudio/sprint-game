// Shared client helpers: escaping, clock sync, countdowns, synthesized sounds, confetti.
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- Server clock ----
  let offset = 0;
  const Clock = {
    sync(serverNow) { if (serverNow) offset = serverNow - Date.now(); },
    now() { return Date.now() + offset; },
    left(endsAt) { return Math.max(0, endsAt - (Date.now() + offset)); },
  };

  // Elements with data-ends="<serverTs>" show a live countdown in seconds.
  setInterval(() => {
    document.querySelectorAll('[data-ends]').forEach((el) => {
      const ends = Number(el.dataset.ends);
      if (!ends) return;
      const sec = Math.ceil(Clock.left(ends) / 1000);
      const txt = el.dataset.fmt === 'mmss' ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : String(sec);
      if (el.textContent !== txt) el.textContent = txt;
      el.classList.toggle('urgent', sec <= 5);
    });
  }, 200);

  // ---- Sound (Web Audio, all synthesized) ----
  let ac = null;
  let master = null;
  function ctx() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.8;
      master.connect(ac.destination);
    }
    return ac;
  }
  function noiseBuffer(sec) {
    const c = ctx();
    const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * sec)), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function tone(freq, dur, { type = 'sine', gain = 0.3, when = 0, slideTo = null, attack = 0.005 } = {}) {
    const c = ctx();
    if (!c || c.state !== 'running') return;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function noise(dur, { gain = 0.4, when = 0, filter = 'lowpass', from = 1000, to = null, q = 1 } = {}) {
    const c = ctx();
    if (!c || c.state !== 'running') return;
    const t = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(dur + 0.1);
    const f = c.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  const Sound = {
    unlock() {
      const c = ctx();
      if (!c) return;
      if (c.state !== 'running') c.resume().catch(() => {});
      // iOS needs a sound started inside the gesture.
      try {
        const b = c.createBuffer(1, 1, 22050);
        const s = c.createBufferSource();
        s.buffer = b;
        s.connect(c.destination);
        s.start(0);
      } catch {}
    },
    ready() { return !!ac && ac.state === 'running'; },
    tick() { tone(1400, 0.05, { type: 'square', gain: 0.12 }); tone(700, 0.04, { type: 'square', gain: 0.08, when: 0.06 }); },
    boom() {
      noise(1.8, { gain: 0.9, from: 1800, to: 60 });
      tone(90, 0.9, { type: 'sine', gain: 0.8, slideTo: 30 });
      tone(55, 1.2, { type: 'triangle', gain: 0.5, slideTo: 25, when: 0.05 });
    },
    whoosh() { noise(0.55, { gain: 0.5, filter: 'bandpass', from: 300, to: 4000, q: 2 }); },
    pop() { tone(500, 0.12, { gain: 0.35, slideTo: 1300 }); },
    ding() { tone(1320, 0.6, { gain: 0.25 }); tone(1760, 0.8, { gain: 0.18, when: 0.08 }); },
    buzz() { tone(150, 0.35, { type: 'sawtooth', gain: 0.25 }); },
    success() { tone(660, 0.12, { type: 'triangle', gain: 0.3 }); tone(990, 0.2, { type: 'triangle', gain: 0.3, when: 0.1 }); },
    notify() { tone(880, 0.15, { gain: 0.3 }); tone(1175, 0.25, { gain: 0.3, when: 0.15 }); },
    sad() { [392, 370, 349, 330].forEach((f, i) => tone(f, i === 3 ? 0.9 : 0.35, { type: 'triangle', gain: 0.28, when: i * 0.35 })); },
    fanfare() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, { type: 'square', gain: 0.15, when: i * 0.13 }));
      [1047, 1319, 1568].forEach((f) => tone(f, 1.2, { type: 'triangle', gain: 0.15, when: 0.55 }));
    },
    drumroll(sec = 3) {
      const c = ctx();
      if (!c || c.state !== 'running') return;
      const n = Math.floor(sec / 0.045);
      for (let i = 0; i < n; i++) noise(0.05, { gain: 0.08 + 0.25 * (i / n), when: i * 0.045, filter: 'bandpass', from: 200 + Math.random() * 80, q: 0.8 });
      noise(1.2, { gain: 0.45, when: sec, filter: 'highpass', from: 5000 });
      tone(110, 0.4, { gain: 0.6, when: sec, slideTo: 50 });
    },
  };
  // Any tap anywhere unlocks audio (iOS).
  ['pointerdown', 'touchend', 'keydown'].forEach((ev) => document.addEventListener(ev, () => Sound.unlock(), { passive: true }));

  // ---- Confetti ----
  function confetti(duration = 4000) {
    const cv = document.createElement('canvas');
    cv.className = 'confetti';
    document.body.appendChild(cv);
    const g = cv.getContext('2d');
    const resize = () => { cv.width = innerWidth; cv.height = innerHeight; };
    resize();
    const colors = ['#ff5252', '#ffd740', '#69f0ae', '#40c4ff', '#e040fb', '#ff9100', '#fff'];
    const parts = Array.from({ length: 220 }, () => ({
      x: Math.random() * cv.width,
      y: -20 - Math.random() * cv.height * 0.6,
      w: 6 + Math.random() * 8,
      h: 8 + Math.random() * 12,
      vy: 2 + Math.random() * 4,
      vx: -2 + Math.random() * 4,
      r: Math.random() * Math.PI,
      vr: -0.2 + Math.random() * 0.4,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    const t0 = performance.now();
    (function frame(t) {
      g.clearRect(0, 0, cv.width, cv.height);
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vy += 0.03;
        g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
      }
      if (t - t0 < duration) requestAnimationFrame(frame);
      else cv.remove();
    })(t0);
  }

  // ---- Count-up number ----
  function countUp(el, to, ms = 1500, from = 0) {
    const t0 = performance.now();
    (function f(t) {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (to - from) * e).toLocaleString('id-ID');
      if (k < 1) requestAnimationFrame(f);
    })(t0);
  }

  function toast(msg, ms = 2600) {
    let box = document.getElementById('toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 400);
  }

  const fmtScore = (n) => (n > 0 ? '+' : '') + Number(n).toLocaleString('id-ID');
  const num = (n) => Number(n).toLocaleString('id-ID');

  function setTheme(color) {
    if (color) document.documentElement.style.setProperty('--theme', color);
  }

  window.G = { esc, Clock, Sound, confetti, countUp, toast, fmtScore, num, setTheme };
})();
