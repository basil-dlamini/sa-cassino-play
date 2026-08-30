/* ads.js — monetisation layer with PLUGGABLE ad networks.
   Version 1 ships a MockAdapter: every ad type works and looks real, but no
   network is called and nothing is earned yet. When the game is packaged for
   the app stores, we register a real adapter (AdMob / Unity Ads / etc.) with
   the same three methods — showBanner, showInterstitial, showRewarded — and
   the rest of the game does not change at all.

   Frequency policy (deliberately gentle, as agreed):
   - Banner: always visible during play (hidden if ads were removed).
   - Interstitial: at most one every 2 finished games AND at least 3 minutes
     apart, shown between a game ending and the results screen, or when
     returning to the main menu.
   - Rewarded video: only ever shown when the player asks for it (the Hint
     button). Full watch required; closing early gives nothing. */
(function (root) {
  const LS_KEY = 'sacassino.adsRemoved';

  /* ---------- mock ad network ---------- */
  const MockAdapter = {
    name: 'mock',
    showBanner(container) {
      container.innerHTML =
        '<div class="ad-banner-inner">' +
        '<span class="ad-tag">AD</span>' +
        '<span>Your banner ad appears here — 320×50 — from AdMob or Unity Ads once the game is published.</span>' +
        '</div>';
      return Promise.resolve('shown');
    },
    showInterstitial(kind) {
      return runFakeFullscreenAd({ kind, label: 'Interstitial Ad', seconds: 2.5, skippableAfter: 1.2 });
    },
    showRewarded(kind) {
      return runFakeFullscreenAd({ kind, label: 'Rewarded Video', seconds: 5, skippableAfter: 0, rewarded: true });
    }
  };

  /* A fake full-screen ad that behaves like the real thing:
     countdown, close button once allowed, reward only on full watch.
     Implementation lives at the bottom of this file (needs the DOM). */

  /* ---------- manager ---------- */
  const Ads = {
    adapter: MockAdapter,
    gamesFinished: 0,
    lastInterstitialAt: 0,
    lastShownKind: null,

    get removed() { return localStorage.getItem(LS_KEY) === '1'; },

    init(bannerEl) {
      this.bannerEl = bannerEl;
      if (!this.removed && bannerEl) this.adapter.showBanner(bannerEl);
    },

    registerAdapter(adapter) { // future: real AdMob/Unity adapter
      this.adapter = adapter;
      if (!this.removed && this.bannerEl) this.adapter.showBanner(this.bannerEl);
    },

    onGameFinished() { this.gamesFinished++; },

    /* Returns a Promise<'shown'|'skipped'|'removed'>. */
    maybeInterstitial(kind) {
      if (this.removed) return Promise.resolve('removed');
      if (this.gamesFinished % 2 !== 0) return Promise.resolve('skipped'); // every 2nd game
      if (Date.now() - this.lastInterstitialAt < 3 * 60 * 1000) return Promise.resolve('skipped');
      this.lastInterstitialAt = Date.now();
      return this.adapter.showInterstitial(kind).then(() => 'shown');
    },

    /* Returns a Promise<'rewarded'|'cancelled'>. */
    showRewarded(kind) {
      if (this.removed) return Promise.resolve('rewarded'); // paying players get hints free
      return this.adapter.showRewarded(kind).then((r) => (r === 'completed' ? 'rewarded' : 'cancelled'));
    },

    purchaseRemoveAds() {
      localStorage.setItem(LS_KEY, '1');
      if (this.bannerEl) this.bannerEl.innerHTML = '';
      if (this.bannerEl) this.bannerEl.classList.add('hidden');
    },
    restorePurchaseState(bannerEl) {
      if (this.removed && bannerEl) { bannerEl.innerHTML = ''; bannerEl.classList.add('hidden'); }
    }
  };

  root.Ads = Ads;

  /* ---------- fake fullscreen ad implementation (DOM) ---------- */
  function runFakeFullscreenAdReal(opts) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'ad-interstitial' + (opts.rewarded ? ' rewarded' : '');
      const left = Math.ceil(opts.seconds);
      overlay.innerHTML =
        '<div class="ad-fake-card">' +
        '<div class="ad-fake-title">' + opts.label + '</div>' +
        '<div class="ad-fake-body">Your ' + (opts.rewarded ? 'rewarded video' : 'interstitial') +
        ' ad plays here once the game is published with a real ad network.</div>' +
        '<div class="ad-fake-countdown">' + left + '</div>' +
        '<button class="ad-fake-close hidden" type="button">✕</button>' +
        (opts.rewarded ? '<div class="ad-fake-note">Watch to the end to earn your hint</div>' : '') +
        '</div>';
      document.body.appendChild(overlay);
      const countdownEl = overlay.querySelector('.ad-fake-countdown');
      const closeBtn = overlay.querySelector('.ad-fake-close');
      let done = false;
      const t0 = Date.now();
      const tick = setInterval(() => {
        const elapsed = (Date.now() - t0) / 1000;
        const remaining = Math.max(0, Math.ceil(opts.seconds - elapsed));
        countdownEl.textContent = remaining;
        if (opts.skippableAfter > 0 && elapsed >= opts.skippableAfter && !done) closeBtn.classList.remove('hidden');
        if (elapsed >= opts.seconds && !done) {
          done = true;
          clearInterval(tick);
          countdownEl.textContent = opts.rewarded ? '✓ Reward earned' : '';
          closeBtn.textContent = opts.rewarded ? 'Claim reward' : 'Continue';
          closeBtn.classList.remove('hidden');
        }
      }, 200);
      closeBtn.addEventListener('click', () => {
        clearInterval(tick);
        overlay.remove();
        resolve(done ? 'completed' : 'abandoned'); // reward only after a full watch
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay && opts.skippableAfter > 0 && !done && (Date.now() - t0) / 1000 >= opts.skippableAfter) {
          clearInterval(tick); overlay.remove(); resolve('abandoned');
        }
      });
    });
  }
  // swap the placeholder for the real implementation
  MockAdapter.showInterstitial = (kind) => runFakeFullscreenAdReal({ kind, label: 'Interstitial Ad', seconds: 2.5, skippableAfter: 1.2 });
  MockAdapter.showRewarded = (kind) => runFakeFullscreenAdReal({ kind, label: 'Rewarded Video', seconds: 5, skippableAfter: 0, rewarded: true });
})(typeof window !== 'undefined' ? window : globalThis);
