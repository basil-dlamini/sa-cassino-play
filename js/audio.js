/* audio.js — the card table's own voice, synthesised with the Web Audio API.
   No audio files; every sound is shaped noise and short body tones — flicks,
   slides, slaps, taps and riffles, the way real cards actually sound. The
   palette carries a volume scale so the AI plays the same table a touch
   quieter than your own moves. Browsers only allow audio after the user's
   first click, so the context attaches lazily. */
(function (root) {
  let ctx = null;
  let noiseBuf = null;
  const LS_KEY = 'sacassino.sound';

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function noise() {
    const c = ac(); if (!c) return null;
    if (!noiseBuf) {                       // two seconds of white noise, reused
      noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  /* A burst of filtered noise — the body of every card sound. `shape` rides
     the filter frequency from f0 to f1 across the burst. */
  function burst(dur, vol, f0, f1, type, delay, q) {
    if (root.Sound.muted) return;
    const c = ac(), buf = noise(); if (!c || !buf) return;
    const t0 = c.currentTime + (delay || 0);
    const src = c.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;   // never identical twice
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
    src.start(t0, Math.random() * 1.2);    // a different slice each time
    src.stop(t0 + dur + 0.02);
  }
  /* A short low tone — the thump of card stock landing. */
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
  /* A tiny click transient — card edges and button ticks. */
  function tick(vol, delay) {
    burst(0.012, vol, 3600, 3000, 'bandpass', delay, 1.4);
  }
  /* The riffle: a run of quick ticks with human spacing — shuffles and
     flourishes. `rise` gathers density toward the end. */
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

  const Sound = {
    get muted() { return localStorage.getItem(LS_KEY) === '0'; },
    set muted(v) { localStorage.setItem(LS_KEY, v ? '0' : '1'); },
    unlock() { ac(); },

    /* UI voice: a paper tick — quiet, quick, never musical */
    click(v) { tick(0.05 * (v || 1)); },

    /* dealing / shuffle — the riffle that opens every game */
    deal() { riffle(16, 0.16, 0.42, 0); thump(150, 0.08, 0.05, 0.46); },

    /* a card leaves the hand — the flick */
    place(v) { v = v || 1; burst(0.03, 0.3 * v, 2600, 1200, 'bandpass'); tick(0.12 * v); thump(210, 0.045, 0.08 * v); },

    /* a discard slides into its slot */
    drift(v) { v = v || 1; burst(0.09, 0.16 * v, 900, 2100, 'bandpass'); thump(170, 0.05, 0.07 * v, 0.07); },

    /* a capture: the slap on the pile, then the gathering swish */
    capture(v) { v = v || 1; burst(0.045, 0.32 * v, 1500, 700, 'lowpass'); thump(140, 0.06, 0.14 * v);
                 burst(0.13, 0.18 * v, 650, 350, 'bandpass', 0.08); },

    /* building, folding, augmenting: a slide squared off with a stack tap */
    build(v) { v = v || 1; burst(0.08, 0.17 * v, 1100, 2000, 'bandpass'); tick(0.12 * v, 0.07); thump(230, 0.04, 0.08 * v, 0.08); },

    /* digging, stealing a pile top: the short sharp pluck of taking */
    steal(v) { v = v || 1; burst(0.018, 0.3 * v, 3800, 2600, 'bandpass', 0, 1.6); tick(0.16 * v, 0.015); thump(260, 0.03, 0.06 * v, 0.02); },

    /* sweeping the table clean */
    sweep(v) { v = v || 1; burst(0.3, 0.22 * v, 1900, 380, 'lowpass'); burst(0.12, 0.12 * v, 800, 500, 'bandpass', 0.16); thump(130, 0.07, 0.08 * v, 0.26); },

    /* results: a riffle flourish, or one soft flat drop */
    win()  { const end = riffle(20, 0.14, 0.34, 0, true); thump(180, 0.06, 0.1, end + 0.05); burst(0.1, 0.15, 1400, 700, 'lowpass', end + 0.06); },
    lose() { burst(0.06, 0.16, 900, 450, 'lowpass'); thump(120, 0.09, 0.1, 0.03); }
  };
  root.Sound = Sound;
})(typeof window !== 'undefined' ? window : globalThis);
