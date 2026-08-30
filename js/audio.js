/* audio.js — tiny sound-effect synth using the Web Audio API.
   No audio files to download; every sound is generated. Browsers only allow
   audio after the user's first click, so we attach lazily. */
(function (root) {
  let ctx = null;
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
  function tone(freq, dur, type, vol, delay) {
    if (root.Sound.muted) return;
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  const Sound = {
    get muted() { return localStorage.getItem(LS_KEY) === '0'; },
    set muted(v) { localStorage.setItem(LS_KEY, v ? '0' : '1'); },
    unlock() { ac(); },
    place()  { tone(220, 0.06, 'triangle', 0.10); },
    capture(){ tone(392, 0.08, 'triangle', 0.12); tone(523, 0.10, 'triangle', 0.12, 0.07); },
    sweep()  { [392, 494, 587, 784].forEach((f, i) => tone(f, 0.09, 'triangle', 0.10, i * 0.06)); },
    build()  { tone(147, 0.12, 'square', 0.06); },
    steal()  { tone(196, 0.10, 'sawtooth', 0.10); tone(185, 0.14, 'sawtooth', 0.08, 0.09); },
    drift()  { tone(165, 0.07, 'sine', 0.08); },
    win()    { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.12, i * 0.12)); },
    lose()   { [330, 262, 196].forEach((f, i) => tone(f, 0.18, 'sine', 0.10, i * 0.14)); },
    click()  { tone(660, 0.04, 'sine', 0.06); }
  };
  root.Sound = Sound;
})(typeof window !== 'undefined' ? window : globalThis);
