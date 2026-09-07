/* audio.js — the card table's own voice.
   Primary: REAL recorded card sounds (CC0, Kenney's Casino Audio pack),
   fetched once and cached by the browser; every event picks a random
   variant with a slight pitch jitter so no two plays sound identical.
   Fallback: the in-code shaped-noise synth (below) — used while the samples
   load, if they fail (offline, file://), or on browsers that cannot decode
   them. The palette carries a volume scale: your moves full presence, the
   AI's the same sounds a touch quieter. */
(function (root) {
  let ctx = null;
  let noiseBuf = null;
  const LS_KEY = 'sacassino.sound';
  const buffers = {};          // loaded sample buffers, by file base name
  let loading = false;

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /* ---------- the real recordings ---------- */
  const GROUPS = {
    place:   ['card-place-1', 'card-place-2', 'card-place-3', 'card-place-4'],
    slide:   ['card-slide-1', 'card-slide-2', 'card-slide-3', 'card-slide-4'],
    shove:   ['card-shove-1', 'card-shove-2'],
    shuffle: ['card-shuffle'],
    pluck:   ['cards-pack-take-out-1'],
    fan:     ['card-fan-1']
  };
  function loadSamples() {
    if (loading) return;
    loading = true;
    const names = Object.values(GROUPS).reduce((a, b) => a.concat(b), []);
    names.forEach((name) => {
      fetch('sounds/' + name + '.ogg')
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then((ab) => ac().decodeAudioData(ab))
        .then((buf) => { buffers[name] = buf; })
        .catch(() => { /* the synth fallback stands in */ });
    });
  }
  /* play a random variant of a group; returns false when unavailable */
  function sample(group, vol, rate) {
    if (root.Sound.muted) return true;
    const list = GROUPS[group].filter((n) => buffers[n]);
    if (!list.length) return false;
    const c = ac(); if (!c) return false;
    const src = c.createBufferSource();
    src.buffer = buffers[list[Math.floor(Math.random() * list.length)]];
    src.playbackRate.value = (rate || 1) * (0.94 + Math.random() * 0.12);
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(g); g.connect(c.destination);
    src.start();
    return true;
  }

  /* ---------- the synth fallback (as before) ---------- */
  function noise() {
    const c = ac(); if (!c) return null;
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }
  function burst(dur, vol, f0, f1, type, delay, q) {
    if (root.Sound.muted) return;
    const c = ac(), buf = noise(); if (!c || !buf) return;
    const t0 = c.currentTime + (delay || 0);
    const src = c.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const flt = c.createBiquadFilter();
    flt.type = type || 'bandpass';
    flt.frequency.setValueAtTime(f0, t0);
    flt.frequency.linearRampToValueAtTime(f1, t0 + dur);
    flt.Q.value = q || 0.9;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.012, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt); flt.connect(g); g.connect(c.destination);
    src.start(t0, Math.random() * 1.2);
    src.stop(t0 + dur + 0.02);
  }
  function thump(freq, dur, vol, delay) {
    if (root.Sound.muted) return;
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function tick(vol, delay) { burst(0.012, vol, 3600, 3000, 'bandpass', delay, 1.4); }
  function riffle(n, vol, dur, delay, rise) {
    let t = delay || 0;
    for (let i = 0; i < n; i++) {
      const frac = i / n;
      const step = (rise ? (0.55 + frac * 0.75) : (1.3 - frac * 0.6)) * dur / n;
      t += step * (0.6 + Math.random() * 0.8);
      tick(vol * (0.55 + Math.random() * 0.5), t);
      if (i % 4 === 3) burst(0.02, vol * 0.4, 1800, 900, 'lowpass', t);
    }
    return t;
  }

  /* ---------- the palette: real recording first, synth standing in ---------- */
  const Sound = {
    get muted() { return localStorage.getItem(LS_KEY) === '0'; },
    set muted(v) { localStorage.setItem(LS_KEY, v ? '0' : '1'); },
    unlock() { ac(); loadSamples(); },

    click(v) { v = v || 1;
      if (sample('slide', 0.28 * v, 1.7)) return;      // a short pitched slide = paper tick
      tick(0.05 * v); },

    deal() { if (sample('shuffle', 0.9, 1)) return;
      riffle(16, 0.16, 0.42, 0); thump(150, 0.08, 0.05, 0.46); },

    place(v) { v = v || 1;
      if (sample('place', 0.85 * v, 1)) return;
      burst(0.03, 0.3 * v, 2600, 1200, 'bandpass'); tick(0.12 * v); thump(210, 0.045, 0.08 * v); },

    drift(v) { v = v || 1;
      if (sample('slide', 0.7 * v, 1)) return;
      burst(0.09, 0.16 * v, 900, 2100, 'bandpass'); thump(170, 0.05, 0.07 * v, 0.07); },

    capture(v) { v = v || 1;
      if (sample('shove', 0.9 * v, 1)) return;         // the shove IS slap + gather
      burst(0.045, 0.32 * v, 1500, 700, 'lowpass'); thump(140, 0.06, 0.14 * v);
      burst(0.13, 0.18 * v, 650, 350, 'bandpass', 0.08); },

    build(v) { v = v || 1;
      if (sample('place', 0.75 * v, 0.92)) return;     // a firmer, lower placement
      burst(0.08, 0.17 * v, 1100, 2000, 'bandpass'); tick(0.12 * v, 0.07); thump(230, 0.04, 0.08 * v, 0.08); },

    steal(v) { v = v || 1;
      if (sample('pluck', 0.85 * v, 1.05)) return;     // a card drawn from the pack
      burst(0.018, 0.3 * v, 3800, 2600, 'bandpass', 0, 1.6); tick(0.16 * v, 0.015); thump(260, 0.03, 0.06 * v, 0.02); },

    sweep(v) { v = v || 1;
      if (sample('shove', 0.9 * v, 0.85)) return;
      burst(0.3, 0.22 * v, 1900, 380, 'lowpass'); burst(0.12, 0.12 * v, 800, 500, 'bandpass', 0.16); thump(130, 0.07, 0.08 * v, 0.26); },

    win()  { if (sample('fan', 0.9, 1)) return;
      const end = riffle(20, 0.14, 0.34, 0, true); thump(180, 0.06, 0.1, end + 0.05); burst(0.1, 0.15, 1400, 700, 'lowpass', end + 0.06); },
    lose() { if (sample('place', 0.6, 0.75)) return;
      burst(0.06, 0.16, 900, 450, 'lowpass'); thump(120, 0.09, 0.1, 0.03); }
  };
  root.Sound = Sound;
})(typeof window !== 'undefined' ? window : globalThis);
