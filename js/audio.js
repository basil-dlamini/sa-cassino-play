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
  /* round 1 (owner-approved 2026-09-08): place=playcard, discard/UI=flick,
     build=contact, steal=draw, deal=shuffle. Capture/sweep/win/lose stay
     interim pending the owner's own recordings (record.html) */
  const GROUPS = {
    place:   ['playcard.wav'],
    discard: ['mixkit-2001.mp3'],
    build:   ['pcs-contact1.wav'],
    steal:   ['draw.wav'],
    deal:    ['mixkit-3175.mp3'],
    capture: ['card-shove-1.ogg', 'card-shove-2.ogg'],
    sweep:   ['card-shove-1.ogg', 'card-shove-2.ogg'],
    win:     ['card-fan-1.ogg'],
    lose:    ['playcard.wav'],
    click:   ['mixkit-2001.mp3'],
    select:  ['playcard.wav']
  };
  /* the owner's own recordings (record.html, same site) outrank the shipped
     samples on the device that made them — the personal table voice */
  const ownerBufs = {};
  function openDb() {
    return new Promise((res) => {
      const rq = indexedDB.open('sacassino', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('ownerSounds');
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
    });
  }
  function loadOwnerSounds() {
    openDb().then((db) => {
      if (!db) return;
      try {
        const tx = db.transaction('ownerSounds', 'readonly').objectStore('ownerSounds');
        const rq = tx.openCursor();
        rq.onsuccess = () => {
          const cur = rq.result;
          if (!cur) return;
          const blob = cur.value;
          blob.arrayBuffer().then((ab) => ac().decodeAudioData(ab))
            .then((buf) => { ownerBufs[cur.key] = buf; })
            .catch(() => {});
          cur.continue();
        };
      } catch (e) { /* no personal voice — samples stand in */ }
    });
  }
  function loadSamples() {
    if (loading) return;
    loading = true;
    loadOwnerSounds();
    const names = [...new Set(Object.values(GROUPS).reduce((a, b) => a.concat(b), []))];
    names.forEach((name) => {
      fetch('sounds/' + name)
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then((ab) => ac().decodeAudioData(ab))
        .then((buf) => { buffers[name] = buf; })
        .catch(() => { /* the synth fallback stands in */ });
    });
  }
  /* play the owner's own recording if present, else a random variant of the
     group; returns false when nothing real is available */
  function sample(group, vol, rate) {
    if (root.Sound.muted) return true;
    const c = ac(); if (!c) return false;
    let buf = null;
    if (ownerBufs[group]) buf = ownerBufs[group];
    else {
      const list = GROUPS[group].filter((n) => buffers[n]);
      if (list.length) buf = buffers[list[Math.floor(Math.random() * list.length)]];
    }
    if (!buf) return false;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (rate || 1) * (ownerBufs[group] ? 1 : (0.94 + Math.random() * 0.12));
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
      if (sample('click', 0.28 * v, 1.7)) return;      // a short pitched slide = paper tick
      tick(0.05 * v); },

    deal() { if (sample('deal', 0.9, 1)) return;
      riffle(16, 0.16, 0.42, 0); thump(150, 0.08, 0.05, 0.46); },

    place(v) { v = v || 1;
      if (sample('place', 0.85 * v, 1)) return;
      burst(0.03, 0.3 * v, 2600, 1200, 'bandpass'); tick(0.12 * v); thump(210, 0.045, 0.08 * v); },

    drift(v) { v = v || 1;
      if (sample('discard', 0.7 * v, 1)) return;
      burst(0.09, 0.16 * v, 900, 2100, 'bandpass'); thump(170, 0.05, 0.07 * v, 0.07); },

    capture(v) { v = v || 1;
      if (sample('capture', 0.9 * v, 1)) return;         // the shove IS slap + gather
      burst(0.045, 0.32 * v, 1500, 700, 'lowpass'); thump(140, 0.06, 0.14 * v);
      burst(0.13, 0.18 * v, 650, 350, 'bandpass', 0.08); },

    build(v) { v = v || 1;
      if (sample('build', 0.8 * v, 1)) return;     // the approved card contact
      burst(0.08, 0.17 * v, 1100, 2000, 'bandpass'); tick(0.12 * v, 0.07); thump(230, 0.04, 0.08 * v, 0.08); },

    steal(v) { v = v || 1;
      if (sample('steal', 0.85 * v, 1.05)) return;     // a card drawn from the pack
      burst(0.018, 0.3 * v, 3800, 2600, 'bandpass', 0, 1.6); tick(0.16 * v, 0.015); thump(260, 0.03, 0.06 * v, 0.02); },

    sweep(v) { v = v || 1;
      if (sample('sweep', 0.9 * v, 0.85)) return;
      burst(0.3, 0.22 * v, 1900, 380, 'lowpass'); burst(0.12, 0.12 * v, 800, 500, 'bandpass', 0.16); thump(130, 0.07, 0.08 * v, 0.26); },

    win()  { if (sample('win', 0.9, 1)) return;
      const end = riffle(20, 0.14, 0.34, 0, true); thump(180, 0.06, 0.1, end + 0.05); burst(0.1, 0.15, 1400, 700, 'lowpass', end + 0.06); },
    lose() { if (sample('lose', 0.6, 0.75)) return;
      burst(0.06, 0.16, 900, 450, 'lowpass'); thump(120, 0.09, 0.1, 0.03); },

    /* card selection: its own subtle voice, quieter than any play */
    select() { if (sample('place', 0.22, 1.5)) return; tick(0.06); },

    /* SWEEP MOMENTS — placeholders until the owner's car/crowd recordings
       arrive (record.html). The shapes hint at the coming voices */
    sweepWin()   { const e = riffle(10, 0.13, 0.24, 0, true);   /* crowd nods: a rising riffle */
      burst(0.1, 0.16, 1300, 600, 'lowpass', e + 0.05); thump(170, 0.06, 0.1, e + 0.06); },
    sweepKing()  { const e = riffle(20, 0.15, 0.38, 0, true);   /* the king: a long flourish */
      burst(0.14, 0.2, 1500, 500, 'lowpass', e + 0.05); thump(150, 0.08, 0.13, e + 0.07); thump(120, 0.1, 0.11, e + 0.16); },
    sweptPoint() { thump(90, 0.12, 0.12, 0); thump(85, 0.12, 0.12, 0.22);   /* the car: struggle, struggle… */
      burst(0.35, 0.3, 900, 2200, 'bandpass', 0.45); thump(70, 0.3, 0.2, 0.45); },  /* …then the roar */
    sweptClean() { riffle(16, 0.13, 0.5, 0, true);                              /* revving, spinning… */
      [300, 240, 190].forEach((f, i) => thump(f, 0.12, 0.08, 0.55 + i * 0.13)); }  /* …the mocking fall */
  };
  root.Sound = Sound;
})(typeof window !== 'undefined' ? window : globalThis);
