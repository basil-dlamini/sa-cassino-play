/* ui.js — everything the player sees and touches (v4: the approved mockup).
   TWO-HAND layout (the locked design):
   - control bar (top): score coin · round · log · speed · home
   - opponent's face-down fan, then their full-width navy bar (dimmed End Turn)
   - their area slots + their message zone · the 4-column discard grid ·
     my message zone + my area slots — all slots exactly card-sized
   - MY bar carries the action cluster: Confirm/Cancel while a move is armed,
     End Turn once the turn's gate is satisfied; notes stand in my message zone
   - my fan packs right; the ad strip sits at the foot
   THREE-HAND: Sipho (seat 1) right, Thandi (seat 2) left — anticlockwise.
   FOUR-HAND: four corners, anticlockwise — partner Thandi (seat 2) top-left,
   Sipho (seat 1) top-right, Naledi (seat 3) bottom-left, me bottom-right.
   Each corner owns a TRIANGLE of boxes: captured pile on the corner, one
   build box along each edge, framing the discard grid. */
(function (root) {
  const C = root.Cards, R = root.Rules, AI = root.AI, Ads = root.Ads, Snd = root.Sound;
  const $ = (id) => document.getElementById(id);

  const AI_SEATS = [
    null,
    { name: 'Sipho',  personality: 'sipho'  },
    { name: 'Thandi', personality: 'thandi' },
    { name: 'Naledi', personality: 'naledi' }
  ];
  const HUMAN = 0;
  const personalityOf = (key) => (AI && AI.PERSONALITIES && AI.PERSONALITIES[key]) || null;

  /* ---------------- persistent session ---------------- */
  /* the deal is drawn at random when a session begins — no seat is born to lead */
  function freshSession() { return { numPlayers: 2, mode: 'competitive', dealer: Math.floor(Math.random() * 4), wins: [0, 0, 0, 0], games: 0 }; }
  function loadSession() {
    try {
      const s = JSON.parse(localStorage.getItem('sacassino.session'));
      return s ? Object.assign(freshSession(), s) : freshSession();
    } catch (e) { return freshSession(); }
  }
  function saveSession() { localStorage.setItem('sacassino.session', JSON.stringify(session)); }
  let session = loadSession();

  /* tutorial progress: finishing the N-hand tutorial unlocks the next size */
  function loadProgress() {
    try { return JSON.parse(localStorage.getItem('sacassino.progress')) || {}; } catch (e) { return {}; }
  }
  function saveProgress(p) { localStorage.setItem('sacassino.progress', JSON.stringify(p)); }

  /* ---------------- runtime state ---------------- */
  let g = null;
  let humanActions = [];
  let selectedCard = null;      // the hand card the move is built around
  let tableSel = new Set();     // loose table cards tapped for the move
  let buildSel = null;          // index of the tapped build box
  let pileTopSel = null;        // victim seat whose pile top was tapped (dig)
  let tableSlots = {};          // table card id → grid-area it occupies
  let pendingConfirm = null;    // { matches:[actions], discardArea? } in the popup
  let lastAction = null;
  let humanBusy = false;
  let shiyaTick = null;
  let shiyaTimer = null;
  let demoMode = false;
  let tutorialMode = false;    // coach on: guidance, hints, AI explanations
  let coachMsg = null;         // the AI's last move, explained (tutorial)
  let oppNote = null;          // Sipho's last move, one line (two hands)
  let lastWinnerSeat = null;   // the last game's solo winner — the loser leads the rematch
  let turnArmed = false;       // the human's moves are computed — the turn is LIVE

  function clearSelection() {
    selectedCard = null;
    tableSel = new Set();
    buildSel = null;
    pileTopSel = null;
  }
  const hasSideSelection = () => tableSel.size > 0 || buildSel != null || pileTopSel != null;
  const discardLegalFor = (card) =>
    humanActions.some((a) => a.type === 'discard' && a.card === card);

  function aiSpeed() { return parseInt(localStorage.getItem('sacassino.aiSpeed') || '900', 10); }
  const isHumanTurn = () => g && g.phase === 'play' && g.turn === HUMAN;

  /* Card size — TWO HANDS: as big as the screen allows. The overlap runs as
     deep as the locked sizes permit; the ceilings are the 4-column discard
     grid fitting edge to edge and the vertical stack (five card-heights
     between the bars and the ad) fitting EXACTLY — the reserve is the real
     chrome, measured (the ad strip lives outside the game screen and is
     therefore NOT subtracted here). */
  /* LOCKED (owner's ruling, 2026-09-07): every phone-width screen runs the
     two-hand discard grid FIVE columns wide — 5×2 = 10 slots, verified from
     320px-class phones up. Wider screens keep the classic 4×2. */
  function p2FiveCols() {
    return session.numPlayers === 2 && $('screen-game').clientWidth <= 560;
  }

  /* the wide two-hand table (owner 2026-09-17): ONE landscape design for every
     PC and tablet at 900px or wider — the SAME approved layout with room to
     breathe, plus Sipho's full face-down hand above his banner. Narrower
     screens and every three/four-hand game keep exactly what they had.
     Measured on the VIEWPORT, never on the screen element: the wide class is
     what widens the screen, so its own width can never be the test. */
  function p2Wide() {
    return session.numPlayers === 2 && window.innerWidth >= 900;
  }
  let p2WideOn = false;
  let p2FiveOn = false;

  function fitCards() {
    const n = R.DEAL[session.numPlayers].per;
    const col = $('screen-game');
    const availW = col.clientWidth - 24;
    if (session.numPlayers === 2) {
      /* crossing the 900px floor dresses/undresses the wide table (his fan),
         and either grid crossing (900 wide↔narrow, or the 560 column change)
         re-deals the SLOT LAYOUT itself — the grid must re-render with the
         cards keeping their slots, judged on the viewport: the class itself
         widens the screen element */
      const wide = window.innerWidth >= 900;
      const five = p2FiveCols();
      if (wide !== p2WideOn || five !== p2FiveOn) {
        p2WideOn = wide;
        p2FiveOn = five;
        col.classList.toggle('w2', wide);
        if (g && !dealSeq) { renderOppZone(); renderSides(); renderTable(); }
      }
      const wDeep = Math.floor((col.clientWidth - 16) / (1 + 9 * 0.25));
      /* THE BAND (owner 2026-09-19): the areas ride the slot lines BESIDE ONE
         ANOTHER — my flank (pile + build) left of the grid at the bottom row,
         his (build + pile) right at the top row — nine cards span the table.
         The info rails are 86 each — LOCKED by the owner (900 − 728 = 172,
         172 ÷ 2 = 86; do not change until asked) */
      const gridCols = wide ? 9 : (p2FiveCols() ? 5 : 4);
      const gridGaps = wide ? 4 * 5 + 2 * 10 + 2 * 8 : (p2FiveCols() ? 4 * 5 : 3 * 5);
      const railPad = wide ? 172 : 0;
      const innerPad = wide ? 0 : 16;   /* wide: the rails ARE the padding */
      const wGrid = Math.floor((col.clientWidth - innerPad - gridGaps - railPad) / gridCols);
      /* wide: the fan, TWO grid rows, my hand — four rows of card height
         (the areas ride the grid's own lines now, costing none) */
      const wH = Math.floor((col.clientHeight - 195) / ((wide ? 4 : 5) * 1.4));
      const w = Math.max(52, Math.min(104, Math.min(wDeep, wGrid, wH)));
      document.documentElement.style.setProperty('--card-w', w + 'px');
      /* the fan's overlap follows the card size — but NEVER mid-ceremony:
         a first-load viewport settle fires resize right as the first deal
         plays, and re-rendering the hand here wiped the staged face-down
         cards (the owner's missing first-game animation, 2026-09-14) */
      if (g && !dealSeq) renderHand();
      return;
    }
    const wW = Math.floor(availW / (1 + (n - 1) / 3));
    /* four hands: three opponent strips crowd the column, so reserve more
       height and cap the card smaller than the two/three-hand games;
       three hands: the banners now carry area boxes underneath them */
    const reserve = session.numPlayers === 4 ? 310 : 330;
    const cap = session.numPlayers === 4 ? 64 : 72;
    const wH = Math.floor((col.clientHeight - reserve) / 4.8);
    const w = Math.max(52, Math.min(cap, Math.min(wW, wH)));
    document.documentElement.style.setProperty('--card-w', w + 'px');
    /* four hands only: the corner-trio boxes flank the grid, so their card
       size follows whatever width is left beside the discard grid */
    if (session.numPlayers === 4) {
      const bandAvail = availW - (3 * w + 14) - 16 - 20;  // grid + gaps + padding
      const bw = Math.max(36, Math.min(48, Math.floor((bandAvail - 58) / 4)));
      document.documentElement.style.setProperty('--area-card', bw + 'px');
    }
  }

  function show(screenId) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
    $(screenId).classList.remove('hidden');
  }

  /* ---------------- cards ---------------- */
  const PIP_LAYOUT = {
    1:  [[.5, .5]],
    2:  [[.5, .1], [.5, .9]],
    3:  [[.5, .1], [.5, .5], [.5, .9]],
    4:  [[.25, .1], [.75, .1], [.25, .9], [.75, .9]],
    5:  [[.25, .1], [.75, .1], [.5, .5], [.25, .9], [.75, .9]],
    6:  [[.25, .1], [.75, .1], [.25, .5], [.75, .5], [.25, .9], [.75, .9]],
    7:  [[.25, .1], [.75, .1], [.5, .3], [.25, .5], [.75, .5], [.25, .9], [.75, .9]],
    8:  [[.25, .1], [.75, .1], [.5, .3], [.25, .5], [.75, .5], [.5, .7], [.25, .9], [.75, .9]],
    9:  [[.25, .08], [.75, .08], [.25, .39], [.75, .39], [.5, .5], [.25, .61], [.75, .61], [.25, .92], [.75, .92]],
    10: [[.25, .08], [.75, .08], [.5, .23], [.25, .39], [.75, .39], [.25, .61], [.75, .61], [.5, .77], [.25, .92], [.75, .92]]
  };
  function pipHtml(rank, glyph) {
    return PIP_LAYOUT[rank].map(([x, y]) =>
      '<span class="pip' + (y > 0.55 ? ' flip' : '') + (rank === 1 ? ' ace' : '') +
      '" style="left:' + x * 100 + '%;top:' + y * 100 + '%">' + glyph + '</span>'
    ).join('');
  }
  /* cards currently in flight (owner 2026-09-15): the board re-renders at
     any moment, so "hidden until landing" must live in state — cardEl hides
     any card in this set at draw time, whatever render draws it. The ghost
     re-shows itself; landing clears the id */
  const flyingIds = new Set();
  /* the moment every animation of the current move completes — the table
     waits for it: the next move (and the player's input) begins only when
     the cards have settled (owner's ruling 2026-09-15) */
  let motionEndsAt = 0;
  function cardEl(id, opts) {
    opts = opts || {};
    const c = C.parse(id);
    const el = document.createElement('div');
    el.className = 'card' + (c.suit === 'H' || c.suit === 'D' ? ' red' : '')
      + (opts.selected ? ' selected' : '')
      + (opts.highlight ? ' highlight' : '') + (opts.dim ? ' dim' : '');
    el.dataset.id = id;
    if (flyingIds.has(id)) el.style.visibility = 'hidden';
    const glyph = C.SUIT_GLYPH[c.suit];
    const rank = C.RANK_LABEL[c.rank];
    el.innerHTML =
      '<span class="corner tl">' + rank + '<span class="s">' + glyph + '</span></span>' +
      '<span class="pips">' + pipHtml(c.rank, glyph) + '</span>' +
      '<span class="corner br">' + rank + '<span class="s">' + glyph + '</span></span>';
    el.title = C.longLabel(id);
    return el;
  }
  /* the Motorcycle back medallion — wings, line-art bike, wordmark.
     One tiny inline SVG, no image files (kind to slow data). */
  const MOTO_EMBLEM =
    '<div class="embl"><svg viewBox="0 0 72 52" aria-hidden="true">' +
    '<g fill="none" stroke="#f4efe2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M36 1 l1.7 2.8 -1.7 2.8 -1.7 -2.8 z" fill="#f4efe2" stroke="none"/>' +
      '<path d="M31 6.5 Q22 1.5 13 4.5" stroke-width="1.2"/>' +
      '<path d="M31 10 Q19 5 10 9.5" stroke-width="1.2"/>' +
      '<path d="M31 13.5 Q17 9 7.5 14" stroke-width="1.2"/>' +
      '<path d="M41 6.5 Q50 1.5 59 4.5" stroke-width="1.2"/>' +
      '<path d="M41 10 Q53 5 62 9.5" stroke-width="1.2"/>' +
      '<path d="M41 13.5 Q55 9 64.5 14" stroke-width="1.2"/>' +
      '<circle cx="15" cy="33" r="8" stroke-width="1.6"/>' +
      '<circle cx="15" cy="33" r="4.6" stroke-width="1.1"/>' +
      '<path d="M5.5 31 A9.5 9.5 0 0 1 24.5 31" stroke-width="1.1"/>' +
      '<circle cx="57" cy="33" r="8" stroke-width="1.6"/>' +
      '<circle cx="57" cy="33" r="4.6" stroke-width="1.1"/>' +
      '<path d="M47.5 31 A9.5 9.5 0 0 1 66.5 31" stroke-width="1.1"/>' +
      '<circle cx="15" cy="33" r="1.7" fill="#f4efe2" stroke="none"/>' +
      '<circle cx="57" cy="33" r="1.7" fill="#f4efe2" stroke="none"/>' +
      '<path d="M15 33 L26 24 L28 22" stroke-width="1.5"/>' +
      '<path d="M19 21 h10 M28 21 l-3 1" stroke-width="1.5"/>' +
      '<path d="M29 19.5 Q38 14.5 47 18.5" stroke-width="1.5"/>' +
      '<path d="M30 21.5 L46 21.5" stroke-width="1.2"/>' +
      '<path d="M57 33 L50 17" stroke-width="1.5"/>' +
      '<path d="M50 17 L49 12 M44.5 12.5 L53 10.5" stroke-width="1.4"/>' +
      '<rect x="31" y="25" width="11" height="7.5" rx="1.2" stroke-width="1.4"/>' +
      '<path d="M32.5 27.5 h8 M32.5 30 h8" stroke-width="1"/>' +
      '<path d="M15 33 L31 29 M36 32 L57 33" stroke-width="1.4"/>' +
      '<path d="M38 32.5 Q30 36 24 36.5" stroke-width="1.3"/>' +
      '<path d="M24 36.5 L13 36" stroke-width="2.8"/>' +
    '</g>' +
    '<text x="36" y="49.5" font-size="5.2" letter-spacing="1.6" text-anchor="middle" fill="#f4efe2" ' +
      'font-family="Georgia,serif">MOTORCYCLE</text>' +
    '</svg></div>';
  function cardBack() {
    const el = document.createElement('div');
    el.className = 'card back';
    el.innerHTML = MOTO_EMBLEM;
    return el;
  }

  /* ---------------- build zones & piles (shared by all players) ---------------- */
  /* Pile height: stacked card edges behind the top card — cheap box-shadows,
     no images, kind to low-end phones. Honest proportions per the mockup:
     a full 28-card pile is ~10px of edge, a half pile two layers. */
  function stackShadow(n) {
    const layers = n >= 13 ? 4 : n >= 7 ? 2 : n >= 4 ? 1 : 0;
    if (!layers) return '';
    const parts = [];
    for (let i = 1; i <= layers; i++) parts.push((i * 2.4) + 'px ' + (i * 2.4) + 'px 0 -1px #d9cfae');
    parts.push((layers * 2.4 + 1.4) + 'px ' + (layers * 2.4 + 1.4) + 'px 3px rgba(0,0,0,.3)');
    return parts.join(', ');
  }

  function buildZoneEl(seat, b) {
    const z = document.createElement('div');
    z.className = 'area-box build-box' + (b ? ' has-build' : '');
    if (b && b.scaffold) z.classList.add('scaffold');   // must resolve this turn
    if (b && b.captLock) z.classList.add('capt-lock');   // the capture of this build is owed
    if (b) {
      const bIdx = g.builds.indexOf(b);
      z.dataset.idx = bIdx;
      const fresh = lastAction && ['build', 'augment', 'dig', 'preg', 'scaffold', 'caugment', 'edig', 'efold', 'basetop'].includes(lastAction.type) &&
        (lastAction.buildIdx === bIdx || (lastAction.type === 'build' && lastAction.value === b.value && lastAction.owner === seat));
      if (fresh) z.classList.add('highlight');
      const cards = document.createElement('div');
      cards.className = 'bz-cards';
      /* collapsed: only the TOP card shows — the rest live in memory */
      const el = cardEl(b.cards[b.cards.length - 1]);
      el.style.boxShadow = stackShadow(b.cards.length);
      const badge = document.createElement('span');
      badge.className = 'build-val';
      badge.textContent = b.value;
      el.appendChild(badge);
      if (b.augmented) el.appendChild(Object.assign(document.createElement('span'),
        { className: 'build-lock', textContent: '🔒' }));
      cards.appendChild(el);
      if (tutorialMode) {
        /* same trio as the pile strip — what the build's cards are worth
           (they only score once the build is captured into the pile) */
        const st = R.pileStats(b.cards);
        const cnt = document.createElement('span');
        cnt.className = 'pile-stats';
        cnt.innerHTML = st.cards + ' cards · ' + st.spades + ' ♠ · ' + st.points + ' pts';
        cards.appendChild(cnt);
      }
      z.appendChild(cards);
    }
    return z;
  }

  function pileEl(seat) {
    const p = g.players[seat];
    const z = document.createElement('div');
    z.className = 'area-box pile-box';
    z.dataset.seat = seat;   // tappable for digs
    const top = p.pile[p.pile.length - 1];
    if (top) {
      const wrap = document.createElement('div');
      wrap.className = 'pile-top';
      const el = cardEl(top);
      el.style.boxShadow = stackShadow(p.pile.length);
      wrap.appendChild(el);
      if (tutorialMode) {
        const st = R.pileStats(p.pile);
        const cnt = document.createElement('span');
        cnt.className = 'pile-stats';
        cnt.innerHTML = st.cards + ' cards · ' + st.spades + ' ♠ · ' + st.points + ' pts';
        wrap.appendChild(cnt);
      }
      z.appendChild(wrap);
    }
    return z;
  }

  function areaRow(seat) {
    const row = document.createElement('div');
    row.className = 'area-row';
    const slots = R.maxSlots(g);
    const owned = g.builds.filter((b) => b.owner === seat && !b.scaffold);
    row.appendChild(pileEl(seat));
    for (let i = 0; i < slots; i++) row.appendChild(buildZoneEl(seat, owned[i] || null));
    return row;
  }

  /* ---------------- opponent zone (rendered per mode) ---------------- */
  const SEAT_EMBLEM = ['♠', '♥', '♣', '♦'];
  /* the ribbon chip is the PLAYING ORDER of this deal: whoever moves first
     is 1, the rotation follows — not the chair number */
  function playOrder(g2, seat) {
    const first = (g2.dealer + 1) % g2.numPlayers;
    return ((seat - first + g2.numPlayers) % g2.numPlayers) + 1;
  }
  function nameBar(g2, seat, opts) {
    const bar = document.createElement('div');
    bar.className = 'namebar' + (opts.me ? ' me' : '');
    const p = g2.players[seat];
    bar.innerHTML = '<span class="nb-emblem">' + SEAT_EMBLEM[seat] + '</span><span class="nb-name">' +
      escapeHtml(p.name) + '</span><span class="nb-emblem">' + SEAT_EMBLEM[seat] + '</span>' +
      '<span class="nb-order">' + playOrder(g2, seat) + '</span>';
    if (g2.phase === 'play' && g2.turn === seat) bar.classList.add('active');
    return bar;
  }

  /* message zones (two hands): navy panels beside the area slots */
  function warnZone(id) {
    const el = document.createElement('div');
    el.className = 'warn-zone';
    el.id = id;
    return el;
  }
  /* Sipho's zone: what he is doing, or what he just did */
  function oppWarnText() {
    if (!g) return '';
    if (g.phase === 'gameover') return 'Game over.';
    if (g.phase === 'play' && g.turn === 1) return 'Sipho is thinking…';
    return oppNote || 'Your move.';
  }

  function renderOppZone() {
    const zone = $('opp-zone');
    zone.innerHTML = '';
    zone.className = 'mode-' + g.numPlayers;
    if (g.numPlayers === 2) {
      /* the wide table (owner 2026-09-17): Sipho's FULL hand stands face-down
         above his banner — every back visible, thinning as he plays. The
         phone keeps the banner-only screen (the standing portrait ruling).
         The backs carry no ids: hidden information never enters the page. */
      if (p2Wide()) {
        const fan = document.createElement('div');
        fan.id = 'opp-fan';
        for (let i = 0, n = g.players[1].hand.length; i < n; i++) fan.appendChild(cardBack());
        zone.appendChild(fan);
        /* HIS FAN FILLS THE ROW like mine (owner 2026-09-18): the same spread
           law the hand uses — the backs fill the table's width while many,
           thin to edge-to-edge as he plays, never more overlap than needed */
        const avail = zone.clientWidth - 16;
        const cw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-w')) || 70;
        const n = g.players[1].hand.length;
        if (n > 1 && avail > cw) {
          const slice = Math.floor((avail - cw) / (n - 1));
          fan.style.setProperty('--fan-shift', (Math.min(slice, cw) - cw) + 'px');
        }
      }
      zone.appendChild(nameBar(g, 1, {}));
    } else if (g.numPlayers === 3) {
      /* Anticlockwise play: seat 1 (Sipho) sits RIGHT, seat 2 (Thandi) LEFT.
         Each opponent's areas run horizontally under their own banner — the
         captured pile at the far edge of the screen, build box beside it. */
      const row = document.createElement('div');
      row.className = 'corner-row';
      const thandi = document.createElement('div');
      thandi.className = 'opp-corner left';
      thandi.appendChild(nameBar(g, 2, {}));
      const thandiAreas = areaRow(2);
      thandiAreas.classList.toggle('active', g.phase === 'play' && g.turn === 2);
      thandi.appendChild(thandiAreas);
      row.appendChild(thandi);
      const sipho = document.createElement('div');
      sipho.className = 'opp-corner right';
      sipho.appendChild(nameBar(g, 1, {}));
      const siphoAreas = areaRow(1);
      siphoAreas.classList.add('mirror'); // pile lands at the far right
      siphoAreas.classList.toggle('active', g.phase === 'play' && g.turn === 1);
      sipho.appendChild(siphoAreas);
      row.appendChild(sipho);
      zone.appendChild(row);
    } else {
      /* FOUR HANDS — four corners, anticlockwise: partner Thandi (seat 2)
         top-left, Sipho (seat 1) top-right (he plays right after me), Naledi
         (seat 3) bottom-left beside my bar, me bottom-right. */
      const row = document.createElement('div');
      row.className = 'corner-row';
      row.appendChild(oppCorner(2)); // Thandi — partner, top-left
      row.appendChild(oppCorner(1)); // Sipho — top-right
      zone.appendChild(row);
    }
  }

  /* Banners only — like three hands, opponents' face-down cards are not shown;
     card counts follow from the turn sequence and your own hand. */
  function oppCorner(seat) {
    const block = document.createElement('div');
    block.className = 'opp-corner' + (seat === 2 ? ' partner' : '');
    block.appendChild(nameBar(g, seat, {}));
    return block;
  }

  /* ---------------- side columns: areas flanking the discard grid ---------------- */
  function renderSides() {
    const mid = $('table-middle');
    const oppSide = $('opp-side');
    const mySide = $('my-side');
    oppSide.innerHTML = '';
    mySide.innerHTML = '';
    mid.classList.toggle('mode-4', g.numPlayers === 4);
    /* three hands: opponents' areas sit under their banners (see renderOppZone),
       so the left flank is empty; only my areas flank the grid */
    oppSide.classList.toggle('hidden', g.numPlayers === 3);
    if (g.numPlayers === 4) {
      /* FOUR HANDS — corner triangles frame the grid: the pile box sits on the
         player's corner, one build box along each edge. The left band serves
         the left players (partner Thandi above, Naledi below), the right band
         the right players (Sipho above, me below). */
      const left = document.createElement('div');
      left.className = 'band';
      left.appendChild(cornerTrio(2, 'tl'));
      left.appendChild(cornerTrio(3, 'bl'));
      oppSide.appendChild(left);
      const right = document.createElement('div');
      right.className = 'band';
      right.appendChild(cornerTrio(1, 'tr'));
      const chip = shiyaChip();
      if (chip) right.appendChild(chip);
      right.appendChild(cornerTrio(HUMAN, 'br'));
      mySide.appendChild(right);
      return;
    }
    if (g.numPlayers === 2) {
      /* (owner 2026-09-19) the box orders inside each row: HIS pile stands at
         his far edge (build LEFT of the pile), MY pile at my far edge (build
         RIGHT of the pile) — one order serving the phone rows and the wide
         band's side-by-side flanks alike */
      const theirs = document.createElement('div');
      theirs.className = 'area-row';
      {
        const slots = R.maxSlots(g);
        const owned = g.builds.filter((b) => b.owner === 1 && !b.scaffold);
        for (let i = 0; i < slots; i++) theirs.appendChild(buildZoneEl(1, owned[i] || null));
        theirs.appendChild(pileEl(1));
      }
      const ow = warnZone('opp-warn');
      ow.textContent = oppWarnText();
      const mine = document.createElement('div');
      mine.className = 'area-row';
      mine.appendChild(pileEl(HUMAN));
      {
        const slots = R.maxSlots(g);
        const owned = g.builds.filter((b) => b.owner === HUMAN && !b.scaffold);
        for (let i = 0; i < slots; i++) mine.appendChild(buildZoneEl(HUMAN, owned[i] || null));
      }
      if (p2Wide()) {
        /* (owner 2026-09-19) MY info rail LEFT, HIS RIGHT. The areas sit BESIDE
           ONE ANOTHER (not stacked): my flank at the LEFT of the grid, pile
           far-left then build, aligned to the BOTTOM row; his flank at the
           RIGHT, build then pile far-right, aligned to the TOP row */
        const rl = $('rail-l'), rr = $('rail-r');
        rl.innerHTML = ''; rr.innerHTML = '';
        rl.appendChild(warnZone('my-warn'));
        rr.appendChild(ow);
        mySide.appendChild(mine);
        oppSide.appendChild(theirs);
        return;
      }
      oppSide.appendChild(ow);
      oppSide.appendChild(theirs);   /* HIS boxes sit RIGHT of his row */
      mySide.appendChild(mine);      /* MY boxes sit LEFT of my row */
      mySide.appendChild(warnZone('my-warn'));
      return;
    }
    /* three hands: my areas flank the grid on the right (vertical) */
    const mine3 = document.createElement('div');
    mine3.className = 'area-row';
    {
      const slots = R.maxSlots(g);
      const owned = g.builds.filter((b) => b.owner === HUMAN && !b.scaffold);
      for (let i = 0; i < slots; i++) mine3.appendChild(buildZoneEl(HUMAN, owned[i] || null));
      mine3.appendChild(pileEl(HUMAN));
    }
    mine3.classList.add('vertical', 'keep-bottom');
    mine3.classList.toggle('active', isHumanTurn());
    mySide.appendChild(mine3);
  }

  /* ---------------- four hands: corner triangles + bottom-left opponent ---------------- */
  /* Where each box goes inside a corner's 2×2 mini-grid (row/col). The pile
     takes the corner cell, builds the two edge cells; the fourth stays empty. */
  const TRIO_PLACE = {
    tl: { pile: '1/1', b1: '1/2', b2: '2/1' }, // partner: pile top-left, build right, build below
    tr: { pile: '1/2', b1: '1/1', b2: '2/2' }, // Sipho: pile top-right, build left, build below
    bl: { pile: '2/1', b1: '2/2', b2: '1/1' }, // Naledi: pile bottom-left, build right, build above
    br: { pile: '2/2', b1: '2/1', b2: '1/2' }  // me: pile bottom-right, build left, build above
  };
  function cornerTrio(seat, corner) {
    const trio = document.createElement('div');
    trio.className = 'trio trio-' + corner;
    const owned = g.builds.filter((b) => b.owner === seat && !b.scaffold);
    const place = TRIO_PLACE[corner];
    const pile = pileEl(seat);
    const b1 = buildZoneEl(seat, owned[0] || null);
    const b2 = buildZoneEl(seat, owned[1] || null);
    pile.style.gridArea = place.pile;
    b1.style.gridArea = place.b1;
    b2.style.gridArea = place.b2;
    trio.appendChild(pile);
    trio.appendChild(b1);
    trio.appendChild(b2);
    if (g.phase === 'play' && g.turn === seat) trio.classList.add('active');
    return trio;
  }

  function shiyaChip() {
    const partner = 2;
    const pBuild = g.builds.find((b) => b.owner === partner);
    if (!pBuild) { shiyaTick = null; return null; }
    const chip = document.createElement('label');
    chip.className = 'shiya-chip';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!(shiyaTick && shiyaTick.value === pBuild.value && shiyaTick.owner === partner);
    cb.addEventListener('change', () => {
      shiyaTick = cb.checked ? { value: pBuild.value, owner: partner } : null;
      toast(cb.checked
        ? 'Shiya set — the ' + pBuild.value + '-build comes to you when ' + g.players[partner].name + ' captures it.'
        : 'Shiya request cleared.');
    });
    chip.appendChild(cb);
    chip.appendChild(document.createTextNode(' Shiya'));
    return chip;
  }

  /* Naledi's banner, bottom-left beside my name bar. */
  function renderBottomCorner() {
    const bl = $('opp-corner-bl');
    bl.innerHTML = '';
    if (g.numPlayers !== 4) { bl.classList.add('hidden'); return; }
    bl.classList.remove('hidden');
    const block = document.createElement('div');
    block.className = 'bl-block';
    block.appendChild(nameBar(g, 3, {}));
    bl.appendChild(block);
  }

  /* ---------------- bars & control strip ---------------- */
  function renderBars() {
    const p = g.players[g.turn];
    const myBar = $('my-bar');
    let turnText = '';
    if (g.phase === 'gameover') turnText = 'game over';
    else if (g.phase === 'shiya') turnText = g.players[g.shiyaPending.caller].name + ' — Shiya window…';
    else turnText = p.isHuman ? 'your turn' : p.name + ' is thinking…';
    if (g.numPlayers === 2) {
      /* the two-hand bar carries its own action cluster — filled by
         renderActionPanel2 (Confirm/Cancel or End Turn) */
      myBar.innerHTML = '<span class="nb-emblem">♠</span><span class="nb-name">YOU</span>' +
        '<span class="nb-emblem">♠</span><span class="nb-order">' + playOrder(g, HUMAN) + '</span>' +
        '<span class="nb-acts" id="bar-acts"></span>';
      /* Sipho's message zone: what he is doing, or what he just did */
      const ow = $('opp-warn');
      if (ow) ow.textContent = oppWarnText();
    } else {
      if (!$('turn-text')) {
        myBar.innerHTML = '<span id="turn-text"></span><span class="nb-emblem">♠</span>' +
          '<span class="nb-name">YOU</span><span class="nb-emblem">♠</span><span class="nb-order">' +
          playOrder(g, HUMAN) + '</span>';
      }
      $('turn-text').textContent = turnText;
    }
    myBar.classList.toggle('active', (isHumanTurn() && turnArmed) ||
      (g.phase === 'shiya' && g.shiyaPending.caller === HUMAN));
    // live score: my side's captured points vs theirs
    const teams = R.teamsOf(g) || g.players.map((p2) => [p2.id]);
    const myTeam = teams.find((t) => t.includes(HUMAN)) || [HUMAN];
    let mine = 0, theirs = 0;
    for (const t of teams) {
      const pts = t.reduce((n, id) => n + R.pileStats(g.players[id].pile).points, 0);
      if (t === myTeam) mine = pts; else theirs = Math.max(theirs, pts);
    }
    $('score-box').textContent = mine + ' · ' + theirs;
    /* the score coin and the hint button are tutorial-only */
    $('score-box').classList.toggle('hidden', !tutorialMode);
    $('btn-hint').classList.toggle('hidden', !tutorialMode);
    $('round-label').textContent = (tutorialMode ? 'Tutorial · ' : '') + (g.numPlayers === 2
      ? (g.wave === 1 ? '1st Round' : '2nd Round')
      : (g.numPlayers === 3 ? 'Three Hands' : 'Pairs'));
  }

  /* ---------------- discard grid ---------------- */
  /* Slots carry stable grid-area strings ("row / col"), so a card placed by
     the player stays in its slot even when the grid grows. Cards without a
     slot (opening table cards, AI discards) fill free slots in reading order. */
  function assignSlots(slots) {
    const live = new Set(g.table);
    for (const sc of g.builds) {
      /* a scaffold stands on its BOTTOM card's slot — the base it was
         founded over, or the highest founding card when there is no base */
      if (sc.scaffold) live.add(sc.cards[0]);
    }
    for (const k of Object.keys(tableSlots)) if (!live.has(k)) delete tableSlots[k];
    const occupied = new Set(Object.values(tableSlots));
    const free = slots.filter((a) => !occupied.has(a));
    let fi = 0;
    for (const id of live) {
      if (tableSlots[id]) continue;
      tableSlots[id] = free[fi++];
    }
  }

  function renderTable() {
    const wrap = $('discard-grid-wrap');
    const area = $('table-cards');
    area.innerHTML = '';
    const n = g.table.length;
    const cw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-w')) || 70;
    const ch = cw * 1.4 + 5;
    let slots = [];
    if (g.numPlayers === 4) {
      /* FOUR HANDS — plus-shaped grid: 3 columns, no corner slots. The top
         and bottom rows carry only the middle slot; extra full rows grow in
         between when the table needs more than 8 places, so the diamond
         silhouette never breaks. */
      const rows = Math.max(4, Math.ceil((n + 4) / 3));
      for (let r = 1; r <= rows; r++) {
        const cap = r === 1 || r === rows;
        for (let c = 1; c <= 3; c++) {
          if (cap && c !== 2) continue;
          slots.push(r + ' / ' + c);
        }
      }
    } else {
      /* 2/3 hands — rectangle grid; two-hand phones run FIVE columns (the
         owner's 5×2 ruling), everything else keeps the mockup's four.
         (owner 2026-09-18: the wide table returned to the original 5×2 too —
         the v119 single staggered row is retired; ten slots, the same slot
         identities as the phone, no translation) */
      const cols = g.numPlayers === 2 ? (p2FiveCols() || p2Wide() ? 5 : 4) : 4;
      area.classList.remove('cols-10w');
      area.classList.toggle('cols-4', cols === 4);
      area.classList.toggle('cols-5', cols === 5);
      const minRows = g.numPlayers === 2 ? 2 : 3;
      const rows = p2Wide() ? 2 : Math.max(minRows, Math.floor((wrap.clientHeight - 8) / ch));
      /* cell floor: two full rows of whatever the column count is */
      const floor = g.numPlayers === 2 ? cols * 2 : 9;
      const cells = Math.max(rows * cols, Math.ceil(Math.max(n, floor) / cols) * cols);
      for (let i = 0; i < cells; i++) slots.push(Math.floor(i / cols) + 1 + ' / ' + (i % cols + 1));
    }
    assignSlots(slots);
    for (const s of slots) {
      let el = null, id = null;
      for (const t of g.table) if (tableSlots[t] === s) { id = t; break; }
      if (id) {
        const involved = lastAction && lastAction.loose && lastAction.loose.includes(id);
        const arrived = lastAction && lastAction.type === 'discard' && lastAction.card === id;
        const live = g.correctable && g.correctable.seat === HUMAN && id === g.correctable.card;
        el = cardEl(id, { highlight: involved || arrived, selected: selectedCard === id });
        if (live) el.classList.add('correctable');   // still in play — tap to use it
        el.style.gridArea = s;
      } else {
        el = document.createElement('div');
        el.className = 'grid-cell';
        el.dataset.area = s;
        el.style.gridArea = s;
      }
      area.appendChild(el);
    }
    /* the scaffold: an UNREGISTERED stack standing in the discard area, ON
       ITS BOTTOM CARD'S SLOT — the base never moves from its place and the
       founding cards fold on top of it; a baseless founding stands on its
       highest card's slot the same way. The TOP card shows as the face.
       Tapping the stack selects it (capture, or graduation by topping) */
    const scBuild = g.builds.find((b) => b.scaffold);
    if (scBuild) {
      const anchor = scBuild.cards[0];             // the bottom card holds the slot
      if (!tableSlots[anchor]) tableSlots[anchor] = slots[0];
      const z = document.createElement('div');
      z.className = 'area-box build-box has-build scaffold';
      z.dataset.idx = g.builds.indexOf(scBuild);
      z.style.gridArea = tableSlots[anchor];
      const el = cardEl(scBuild.cards[scBuild.cards.length - 1]);   // the face is the top card
      el.style.boxShadow = stackShadow(scBuild.cards.length);
      z.appendChild(el);
      const badge = document.createElement('span');
      badge.className = 'build-val';
      badge.textContent = scBuild.value;
      el.appendChild(badge);
      area.appendChild(z);
    }
  }

  /* ---------------- my hand ---------------- */
  function renderHand() {
    const box = $('my-hand');
    box.innerHTML = '';
    const me = g.players[HUMAN];
    const hand = me.hand.slice().sort(C.compare);
    for (const id of hand) {
      /* no dimming, ever: every hand card stays fully visible whether or not
         it could start a move — selection is a quiet lift (owner's ruling) */
      const opts = {
        selected: selectedCard === id,
        highlight: lastAction && lastAction.card === id
      };
      const el = cardEl(id, opts);
      el.classList.add('in-hand');
      box.appendChild(el);
    }
    /* two hands: the fan reorganizes as the hand empties — neighbours spread
       apart until there is no overlap left (each card edge to edge), and once
     no overlap remains the group packs to the LEFT. The width is measured on
     the ROW, never on the hand itself: the hand's own box follows its
     content, and a stale shift would feed back into the measurement. */
    if (g.numPlayers === 2 && box.children.length > 1) {
      const row = $('my-row');
      if (row) {
        const avail = row.clientWidth - 16;   // the row's 8px side padding
        const w = box.children[0].offsetWidth;
        if (w > 0 && avail > w) {
          const slice = Math.floor((avail - w) / (box.children.length - 1));
          const s = Math.min(slice, w);       // spread at most to zero overlap
          box.style.setProperty('--fan-shift', (s - w) + 'px');
        }
      }
    }
  }

  /* ---------------- select-then-confirm action model ---------------- */
  /* Short popup titles — the affirmation of the intended move, suits always
     shown. Dig, preg and combine-augment all read "Build (sum)". A claimed
     move carries its claim on its face — you always know whose move it was. */
  function actionTitle(a) {
    if (a.claim) {
      const v = a.type === 'preg' ? a.value : (g.builds[a.buildIdx] || {}).value;
      if (a.type === 'preg') return 'Claim: preg to ' + v;
      if (a.type === 'topdig' || a.type === 'digfold') return 'Claim: dig into the ' + v + '-build';
      if (a.type === 'caugment') return 'Claim: fold into the ' + v + '-build';
      if (a.victim != null) return 'Claim: dig into the ' + v + '-build';
      return 'Claim: fold ' + C.label(a.card) + ' into the ' + v + '-build';
    }
    switch (a.type) {
      case 'capture': return 'Capture ' + C.label(a.card);
      case 'build':   return 'Build ' + a.value;
      case 'augment':
        return a.method === 'top'
          ? 'Top ' + C.label(a.card)
          : 'Build ' + g.builds[a.buildIdx].value;
      case 'dig':     return 'Build ' + g.builds[a.buildIdx].value;
      case 'topdig':  return 'Build ' + g.builds[a.buildIdx].value;
      case 'scaffold': return 'Build ' + a.value;
      case 'caugment': return 'Build ' + g.builds[a.buildIdx].value;
      case 'efold':    return 'Build ' + g.builds[a.buildIdx].value + ' for capture';
      case 'basetop':  return 'Top ' + C.label(a.card);
      case 'edig': {
        const v0 = a.victims[0];
        const top = g.players[v0].pile[g.players[v0].pile.length - 1];
        return 'Dig ' + (top ? C.label(top) : g.builds[a.buildIdx].value) + ' for capture';
      }
      case 'preg':    return 'Build ' + a.value;
      case 'digfold': return 'Build ' + g.builds[a.buildIdx].value;
      case 'discard': return 'Discard ' + C.label(a.card);
    }
    return a.type;
  }

  function cardsOfAction(a) {
    if (a.type === 'scaffold') return a.cards.slice();
    const ids = [];
    if (a.card) ids.push(a.card);
    if (a.victim != null) {                       // the pile card being dug
      const top = g.players[a.victim].pile[g.players[a.victim].pile.length - 1];
      if (top) ids.push(top);
    }
    if (a.victims) {                              // an enemy dig may span several piles
      for (const seat of a.victims) {
        const top = g.players[seat].pile[g.players[seat].pile.length - 1];
        if (top) ids.push(top);
      }
    }
    if (a.loose) ids.push(...a.loose);
    for (const idx of (a.buildIds || [])) ids.push(...g.builds[idx].cards);
    if (a.buildIdx != null) ids.push(...g.builds[a.buildIdx].cards);
    return ids;
  }

  /* Which legal actions match the current selection exactly? A hand card is
     optional: pile-top digs need only the victim's pile (plus optionally the
     build box). */
  function matchesForSelection() {
    if (!selectedCard) {
      /* cardless moves: pile-top digs, scaffolds from table cards, folds */
      if (pileTopSel != null) {
        /* cardless moves: pile-top digs, mixed folds, scaffolds from table cards, folds */
        const sameCards = (arr) => tableSel.size === (arr || []).length && (arr || []).every((x) => tableSel.has(x));
        const digs = humanActions.filter((a) => a.type === 'topdig' && a.victim === pileTopSel &&
          (buildSel == null || a.buildIdx === buildSel));
        const digfolds = humanActions.filter((a) => a.type === 'digfold' && a.victim === pileTopSel &&
          sameCards(a.loose) && (buildSel == null || a.buildIdx === buildSel));
        const edigs = humanActions.filter((a) => a.type === 'edig' &&
          a.victims.includes(pileTopSel) && sameCards(a.loose) &&
          (buildSel == null || a.buildIdx === buildSel));
        /* a dig-founding's BASE may or may not be in the selection — it folds
           beneath automatically either way (the owner's tap: his 7 + the 7) */
        const scaffs = humanActions.filter((a) => {
          if (a.type !== 'scaffold' || a.victim !== pileTopSel) return false;
          if (sameCards(a.cards)) return true;
          if (a.cards.length + 1 !== tableSel.size) return false;
          const extra = [...tableSel].find((id) => !a.cards.includes(id));
          return extra != null && C.rank(extra) === a.value && g.table.includes(extra);
        });
        const all = digs.concat(digfolds).concat(edigs).concat(scaffs);
        if (all.length) return all;
      }
      if (tableSel.size) {
        const sameCards = (arr) => tableSel.size === arr.length && arr.every((x) => tableSel.has(x));
        if (buildSel != null) {
          return humanActions.filter((a) =>
            (a.type === 'caugment' || a.type === 'efold') && a.buildIdx === buildSel && sameCards(a.loose || []));
        }
        /* no build tapped: the sum itself identifies the target — a fold can
           only belong to the build of that value (values are unique) */
        let m = humanActions.filter((a) => a.type === 'scaffold' && sameCards(a.cards || []));
        if (!m.length && pileTopSel == null) {
          m = humanActions.filter((a) =>
            (a.type === 'caugment' || a.type === 'efold') && sameCards(a.loose || []));
        }
        if (m.length) return m;
      }
      return [];
    }
    const same = (set, arr) => set.size === (arr || []).length && (arr || []).every((x) => set.has(x));
    return humanActions.filter((a) => {
      if (a.card !== selectedCard) return false;
      /* top-the-base: the hand card tapped onto the loose base card */
      if (a.type === 'basetop') {
        return tableSel.size === 1 && tableSel.has(a.base) && buildSel == null && pileTopSel == null;
      }
      if (!same(tableSel, a.loose)) return false;
      /* a tapped pile top pairs only with actions that dig from that victim */
      if (pileTopSel != null && a.victim !== pileTopSel) return false;
      if (pileTopSel == null && a.victim != null) return false;
      switch (a.type) {
        case 'capture': return same(new Set(buildSel == null ? [] : [buildSel]), a.buildIds);
        case 'build':   return buildSel == null;
        /* the combining cards identify the build — tapping it is optional */
        case 'augment':
        case 'preg':    return buildSel == null || a.buildIdx === buildSel;
        case 'dig':     return buildSel == null || a.buildIdx === buildSel;
        case 'discard': return !hasSideSelection();
      }
      return false;
    });
  }

  /* can this move still GROW? if any legal action strictly contains the
     matched one's cards, the player is mid-assembly — direct mode waits for
     the maximal selection instead of ambushing a legal partial (5+A must
     not fire as a 6-scaffold while 2+5+A=8 is still reachable) */
  function selectionCanGrow(match) {
    const base = cardsOfAction(match);
    return humanActions.some((a) => {
      if (a === match) return false;
      const ids = cardsOfAction(a);
      return ids.length > base.length && base.every((id) => ids.includes(id));
    });
  }

  /* could this hand+table selection still GROW into a legal move by adding
     more table cards? A growing selection is mid-assembly, not dead — the
     explainer stays quiet until the shape is final */
  function selectionCouldGrow() {
    return humanActions.some((a) => {
      if (a.card !== selectedCard) return false;
      const loose = a.loose || [];
      return loose.length > tableSel.size && [...tableSel].every((id) => loose.includes(id));
    });
  }

  /* the table explains its own law: a finished hand+table selection with no
     legal move gets one small line of WHY (the owner's ruling 2026-09-13 —
     no more silent dead ends) */
  function explainDeadSelection() {
    const me = g.players[HUMAN];
    const hv = C.rank(selectedCard);
    const v = hv + [...tableSel].reduce((n, id) => n + C.rank(id), 0);
    if (v > 10) { toast('That makes ' + v + ' — past the ceiling of 10.'); return; }
    if (g.builds.some((b) => b.value === v && !b.scaffold)) {
      toast('A ' + v + '-build already stands — two of a value never live together.'); return;
    }
    if (!me.hand.some((h) => h !== selectedCard && C.rank(h) === v)) {
      toast('A ' + v + '-build needs a ' + v + ' in hand to capture it later — you hold none.'); return;
    }
    if (g.builds.find((b) => b.value === hv && b.owner === HUMAN && !b.scaffold)) {
      toast('Your ' + hv + ' stands on your own ' + hv + '-build — it may only capture or augment it, unless you hold another.');
      return;
    }
    toast('That combination makes no legal move.');
  }

  function afterSelectionChange() {
    const m = matchesForSelection();
    const armed = selectedCard ? hasSideSelection() : (pileTopSel != null || tableSel.size > 0);
    /* DIRECT mode: a complete, MAXIMAL selection that means exactly one move
       plays at once — the confirmation returns only for real choices.
       Returns true when the tap EXECUTED a move, so the caller plays the
       selection sound only when the tap merely selected */
    if (directMode() && m.length === 1 && armed && !humanBusy && !selectionCanGrow(m[0])) {
      executeHuman(m[0]);
      return true;
    }
    pendingConfirm = (m.length && armed) ? { matches: m } : null;
    renderActionPanel();
    applySelClasses();
    /* a cardless combine that matched nothing: if the shape would otherwise
       be legal, the failing reason is the reservation law — say so */
    if (!m.length && !selectedCard && tableSel.size + (pileTopSel != null ? 1 : 0) >= 2) maybeReservedAlert();
    /* and a hand+table selection that is final and dead gets its one line */
    else if (!m.length && selectedCard && tableSel.size && pileTopSel == null && buildSel == null &&
             !selectionCouldGrow()) explainDeadSelection();
    return false;
  }

  function refreshAfterSelect() {
    renderHand();
    return afterSelectionChange();
  }

  /* The reserved-card notice: "capture" with one copy held, "top or capture"
     with two or more. */
  function maybeReservedAlert() {
    const me = g.players[HUMAN];
    const sum = [...tableSel].reduce((n, id) => n + C.rank(id), 0);
    let value = null;
    if (buildSel != null && g.builds[buildSel]) value = g.builds[buildSel].value;
    else if (me.hand.some((h) => C.rank(h) === sum) && !g.builds.some((b) => b.value === sum)) value = sum;
    if (value == null) return;   // not a reservation shape — stay silent
    const held = me.hand.filter((h) => C.rank(h) === value).length;
    openAlertDialog(held >= 2 ? 'Top, capture or scaffold' : 'Capture or scaffold',
      'Those table cards are reserved for the ' + value +
      ' — scaffold them into a stack, then capture the whole stack with your ' + value +
      ' (one card or one stack per capture), or top it.');
  }

  function openAlertDialog(title, text) {
    $('alert-title').textContent = title;
    $('alert-text').textContent = text;
    $('modal-alert').classList.remove('hidden');
    Snd.click();
  }

  /* --- selection toggles: nothing is selectable until the turn is LIVE --- */
  function toggleTableSel(id) {
    if (!isHumanTurn() || humanBusy || !turnArmed) return;   // loose cards pair with a hand card or found a cardless build
    const removing = tableSel.has(id);
    if (removing) tableSel.delete(id); else tableSel.add(id);
    if (!afterSelectionChange()) (removing ? Snd.deselect() : Snd.select());
  }
  function toggleBuildSel(idx) {
    if (!isHumanTurn() || !turnArmed) return;
    const removing = buildSel === idx;
    buildSel = removing ? null : idx;
    if (!afterSelectionChange()) (removing ? Snd.deselect() : Snd.select());
  }
  function togglePileSel(seat) {
    if (!isHumanTurn() || !turnArmed) return;
    const removing = pileTopSel === seat;
    pileTopSel = removing ? null : seat;
    if (!afterSelectionChange()) (removing ? Snd.deselect() : Snd.select());
  }

  /* --- discard: tap an empty slot with a hand card selected --- */
  function tryDiscardTo(areaStr) {
    if (!isHumanTurn() || !turnArmed || !selectedCard || hasSideSelection()) return;
    const card = selectedCard;
    /* the live discarded card is not droppable again — a re-discard is not a
       Card down rule; use it for a move or end the turn */
    if (g.correctable && g.correctable.seat === HUMAN && card === g.correctable.card) {
      if (tutorialMode) toast('That discard is made — use the card for a move, or end the turn.');
      return;
    }
    if (discardLegalFor(card)) {
      if (directMode()) { executeHuman({ type: 'discard', card }, areaStr); return; }
      pendingConfirm = { matches: [{ type: 'discard', card }], discardArea: areaStr };
      renderActionPanel();
      Snd.click();
      return;
    }
    redirectIllegalDiscard(card);
    Snd.click();
  }

  /* An illegal discard never just fails — the game explains it and offers
     the legal alternative as a confirmation. */
  function redirectIllegalDiscard(card) {
    const v = C.rank(card);
    /* two-hand round one: EVERY discard is barred — there is no target */
    if (g.numPlayers === 2 && g.wave === 1 && g.builds.some((b) => b.owner === HUMAN)) {
      openAlertDialog('Illegal move',
        'Illegal move, no card discards allowed while you have a live build in the first round.');
      return;
    }
    const b = g.builds.find((x) => x.value === v);
    let reminder, matches = [];
    if (b) {
      const bi = g.builds.indexOf(b);
      if (b.owner === HUMAN) {
        matches = humanActions.filter((a) => a.card === card &&
          ((a.type === 'capture' && a.buildIds.includes(bi)) ||
           (a.type === 'augment' && a.method === 'top' && a.buildIdx === bi)));
        reminder = 'Illegal move — the ' + v + '-build is yours: capture it' +
          (matches.some((a) => a.type === 'augment') ? ' or top it' : '') + '.';
      } else if (R.sameSide(g, b.owner, HUMAN)) {
        matches = humanActions.filter((a) => a.card === card && a.type === 'augment' &&
          a.method === 'top' && a.buildIdx === bi);
        reminder = 'Illegal move — that is your partner\u2019s ' + v + '-build: top it.';
      } else {
        matches = humanActions.filter((a) => a.card === card && a.type === 'capture' &&
          a.buildIds.includes(bi));
        reminder = 'Illegal move — that is your opponent\u2019s ' + v + '-build: capture it.';
      }
    } else {
      const twin = g.table.find((t) => C.rank(t) === v);
      if (twin) {
        matches = humanActions.filter((a) => a.card === card && a.type === 'capture' &&
          (a.loose || []).includes(twin));
        reminder = 'Illegal move — the ' + C.label(twin) + ' is on the table: capture it.';
      } else {
        reminder = C.label(card) + ' can\u2019t be discarded right now.';
      }
    }
    if (matches.length) {
      pendingConfirm = { matches, reminder };
      renderActionPanel();
      toast(reminder);
    } else {
      openAlertDialog('Illegal move', reminder);
    }
  }

  /* one teaching line per action — tutorial popups only */
  function actionExplainer(a) {
    switch (a.type) {
      case 'discard': return 'The card drops face-up — anyone may capture it later.';
      case 'capture': return 'A build falls to its exact match — or take one set of table cards summing to your card.';
      case 'build':   return 'Together they count ' + a.value + ' — capture them later with a ' + a.value + '.';
      case 'augment':
        return a.method === 'top'
          ? 'An equal card joins the build — same value, more cards to take.'
          : 'Extra cards fold in — the value stays ' + g.builds[a.buildIdx].value + '.';
      case 'dig':     return 'Their pile top folds into the build — it stays worth ' + g.builds[a.buildIdx].value + '.';
      case 'topdig':  return 'Their pile top folds into the build — it stays worth ' + g.builds[a.buildIdx].value + ' and locks.';
      case 'scaffold':
        return g.builds.some((b) => !b.scaffold && b.owner === g.turn)
          ? 'Built from the table alone — with a build already yours, capture it with your ' + a.value + ' before your turn ends.'
          : 'Built from the table alone — capture it or top it before your turn ends.';
      case 'caugment': return 'Table cards fold in — the value stays ' + g.builds[a.buildIdx].value + ' and locks.';
      case 'efold':    return 'Table cards join THEIR build — then your ' + g.builds[a.buildIdx].value + ' captures all of it.';
      case 'edig':     return 'Their card joins THEIR build — then your ' + g.builds[a.buildIdx].value + ' captures all of it.';
      case 'basetop':  return 'Your card tops the loose base — a live build, locked at ' + C.rank(a.card) + '.';
      case 'digfold':  return 'The dug card and the table set fold in — the value stays ' + g.builds[a.buildIdx].value + '.';
      case 'preg':    return 'The build rises to ' + a.value + (g.builds[a.buildIdx].owner !== HUMAN ? ' — and becomes yours.' : '.');
    }
    return '';
  }

  /* --- confirming: the live strip — the board stays visible and tappable --- */
  /* Move confirmation (owner's ruling 2026-09-07): DIRECT by default — a
     complete selection that means exactly ONE legal action plays at once.
     The prompt survives only where one selection could mean two moves
     (capture vs build, capture vs top, scaffold vs fold). Settings toggle:
     'direct' | 'prompt' */
  function directMode() {
    return (localStorage.getItem('sacassino.confirmMode') || 'direct') === 'direct';
  }

  function executeHuman(a, area) {
    if (a.type === 'discard' && area) {
      tableSlots[a.card] = area;   // snap to the chosen slot
    }
    clearSelection();
    humanBusy = true;
    setTimeout(() => (humanBusy = false), 300);   // double-tap guard only — direct play must flow
    performAction(a, { human: true });            // the action's own sound is the voice
  }

  function confirmAction(i) {
    if (!pendingConfirm || humanBusy) return;
    const a = pendingConfirm.matches[i];
    const area = pendingConfirm.discardArea;
    pendingConfirm = null;
    executeHuman(a, area);
  }
  function cancelConfirm() {
    pendingConfirm = null;
    clearSelection();          // cancel always clears the selection
    Snd.click();
    render();
  }

  /* selection highlights on the board */
  function applySelClasses() {
    document.querySelectorAll('#table-cards .card').forEach((el) => {
      el.classList.toggle('sel-table', tableSel.has(el.dataset.id));
      /* the live discarded card: still selectable in its slot, still glowing */
      el.classList.toggle('selected', selectedCard === el.dataset.id);
      el.classList.toggle('correctable',
        !!(g.correctable && g.correctable.seat === HUMAN && el.dataset.id === g.correctable.card));
    });
    document.querySelectorAll('.build-box.has-build').forEach((z) =>
      z.classList.toggle('selected', buildSel === Number(z.dataset.idx)));
    document.querySelectorAll('.pile-box').forEach((z) =>
      z.classList.toggle('selected', pileTopSel === Number(z.dataset.seat)));
    const droppable = isHumanTurn() && !!selectedCard && !hasSideSelection() && discardLegalFor(selectedCard);
    document.querySelectorAll('#table-cards .grid-cell').forEach((c) =>
      c.classList.toggle('can-drop', droppable));
  }

  function mkBtn(text, kind, onClick) {
    const b = document.createElement('button');
    b.className = 'btn ' + (kind || 'default');
    b.innerHTML = text;
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  /* The End Turn button: ready once the turn's gate is satisfied. Lives in
     the floating strip (3/4 hands) or MY bar (two hands). */
  function mkEndTurnBtn() {
    const canEnd = humanActions.some((a) => a.type === 'endturn');
    /* no ✓ glyph in the label — on phones it renders as a green emoji; the
       filled (ready) vs dimmed (waiting) style carries the state */
    const end = mkBtn('End Turn', (canEnd ? 'primary' : 'secondary') + ' small', () => {
      Snd.click();
      if (!canEnd) {
        if (!g.turnUsed) toast('Play a card from your hand first — digs alone can\u2019t end a turn.');
        else if (g.builds.some((b) => b.scaffold)) toast('Resolve your table-build first — capture it or top it.');
        else if (g.builds.some((b) => b.captLock)) toast('Capture the build you dug into before ending the turn.');
        else toast('You opened without a hand card — capture or top before ending the turn.');
        return;
      }
      performAction({ type: 'endturn' }, { human: true });
    });
    if (!canEnd) end.classList.add('dimmed');
    return end;
  }

  /* competitive: the specific rule enforcing the turn, stated plainly */
  function ruleNoteNow() {
    if (tutorialMode) return null;
    if (g.openedCardless && !g.resolved) {
      return 'You opened without a hand card — you must capture (or top a build) before this turn can end.';
    }
    if (g.builds.some((b) => b.scaffold)) {
      return 'Your table-build must be captured or topped before this turn can end.';
    }
    if (g.builds.some((b) => b.captLock)) {
      return 'You folded into their build — you must capture it before this turn can end.';
    }
    return null;
  }

  /* tutorial hints that belong in a message zone, whatever hosts it */
  function appendTutorialHints(host) {
    if (!selectedCard) {
      if (g.turnUsed) {
        const h = document.createElement('div');
        h.className = 'panel-hint';
        h.innerHTML = 'Hand card spent — dig a matching opponent pile top into a build, or end the turn.';
        host.appendChild(h);
      }
      const sb = g.builds.find((b) => b.scaffold);
      const h = document.createElement('div');
      h.className = 'panel-hint';
      h.innerHTML = sb
        ? 'The <b>' + sb.value + '-build from the table must be captured or topped this turn</b> — select your ' + sb.value + '.'
        : 'Your turn — tap a card in your hand' + (!g.turnUsed ? ', or tap table cards alone to found a build' : '') + '.';
      host.appendChild(h);
      const forced = humanActions.length && humanActions.every((a) => a.type === 'capture');
      if (forced) {
        const f = document.createElement('div');
        f.className = 'panel-hint';
        f.innerHTML = '<b>You own two builds — you must capture one.</b>';
        host.appendChild(f);
      }
      return;
    }
    const h = document.createElement('div');
    h.className = 'panel-hint';
    h.innerHTML = !hasSideSelection()
      ? '<b>' + C.label(selectedCard) + '</b> — tap table cards, a build, an opponent&rsquo;s pile top' +
        ' to form a move, or tap an empty discard slot.'
      : 'Keep tapping to adjust — or confirm the move.';
    host.appendChild(h);
  }

  function warnLine(cls, text) {
    const el = document.createElement('div');
    el.className = 'panel-hint ' + (cls || '');
    el.textContent = text;
    return el;
  }

  /* TWO HANDS — the action cluster lives in MY bar; notes stand in my
     message zone. Sipho's zone is filled by renderBars. */
  function renderActionPanel2() {
    const acts = document.getElementById('bar-acts');
    const warn = document.getElementById('my-warn');
    if (!acts || !warn) return;
    acts.innerHTML = '';
    warn.innerHTML = '';
    /* the blue panel NEVER goes dark (owner 2026-09-17): it stands on with
       standing text and only the words ever change */
    if (!g || g.phase === 'gameover') { warn.textContent = 'Game over.'; return; }
    if (g.phase === 'shiya') {
      warn.textContent = g.players[g.shiyaPending.caller].name + ' — Shiya window…';
      return;
    }
    if (!isHumanTurn()) {
      /* his turn, his business: NOTHING of the opponent's reflects in my
         ribbon — it lights up only when the turn is mine (owner's ruling) */
      if (tutorialMode && coachMsg) warn.appendChild(warnLine('coach', coachMsg));
      else warn.textContent = 'Sipho is thinking…';
      return;
    }
    if (!turnArmed) { warn.textContent = 'Your move.'; return; }   // the turn is not live yet — no controls appear
    /* the live confirmation: reminder + title in the bar, teaching in the zone */
    if (pendingConfirm && pendingConfirm.matches.length) {
      const m = pendingConfirm.matches;
      if (pendingConfirm.reminder) warn.appendChild(warnLine('rule-note', pendingConfirm.reminder));
      if (m.length === 1) {
        const ahead = document.createElement('span');
        ahead.className = 'ahead';
        ahead.textContent = actionTitle(m[0]);
        acts.appendChild(ahead);
        if (tutorialMode) warn.appendChild(warnLine('confirm-note', actionExplainer(m[0])));
        acts.appendChild(mkBtn('Confirm', 'primary small', () => confirmAction(0)));
      } else {
        /* several options: compact buttons, no caption — they must all fit */
        acts.classList.add('multi');
        m.forEach((a, i) =>
          acts.appendChild(mkBtn(actionTitle(a), (i === 0 ? 'primary' : 'default') + ' small', () => confirmAction(i))));
      }
      acts.appendChild(mkBtn('Cancel', 'secondary small', cancelConfirm));
      if (!warn.childNodes.length) warn.textContent = actionTitle(m[0]);
      return;
    }
    /* the neglect claim (owner's law 2026-09-18): his skipped augments sit
       quietly among the choices — no alert, no popup until tapped. Playing
       any move of your own closes the window for good */
    const claims = humanActions.filter((a) => a.claim);
    if (claims.length) {
      const opp = g.players.find((p) => !R.sameSide(g, p.id, HUMAN));
      const btn = mkBtn('Claim (' + claims.length + ')', 'small claim-btn', () => {
        pendingConfirm = {
          matches: claims,
          reminder: (opp ? opp.name : 'The opponent') + ' left a move unmade — claim it, or play on and it stands.'
        };
        render();
      });
      acts.appendChild(btn);
    }
    acts.appendChild(mkEndTurnBtn());
    const note = ruleNoteNow();
    if (note) warn.appendChild(warnLine('rule-note', note));
    else if (claims.length) warn.textContent = 'A neglected move can be claimed.';
    else warn.textContent = 'Your move.';
    if (tutorialMode && coachMsg) warn.appendChild(warnLine('coach', coachMsg));
    if (tutorialMode) appendTutorialHints(warn);
  }

  function renderActionPanel() {
    if (g && g.numPlayers === 2) { renderActionPanel2(); return; }
    const panel = $('action-panel');
    panel.innerHTML = '';
    if (!g || g.phase === 'gameover') return;
    if (g.phase === 'shiya') {
      panel.innerHTML = '<div class="panel-hint">' + escapeHtml(g.players[g.shiyaPending.caller].name) + ' — Shiya window…</div>';
      return;
    }
    /* the live confirmation strip — words only, board stays open */
    if (isHumanTurn() && pendingConfirm && pendingConfirm.matches.length) {
      const m = pendingConfirm.matches;
      if (pendingConfirm.reminder) {
        const rem = document.createElement('div');
        rem.className = 'panel-hint rule-note';
        rem.textContent = pendingConfirm.reminder;
        panel.appendChild(rem);
      }
      const head = document.createElement('div');
      head.className = 'confirm-head';
      head.textContent = m.length === 1 ? actionTitle(m[0]) : 'Choose your move';
      panel.appendChild(head);
      if (tutorialMode && m.length === 1) {
        const note = document.createElement('div');
        note.className = 'confirm-note';
        note.textContent = actionExplainer(m[0]);
        panel.appendChild(note);
      }
      const row = document.createElement('div');
      row.className = 'confirm-row';
      if (m.length === 1) {
        row.appendChild(mkBtn('Confirm', 'primary', () => confirmAction(0)));
      } else {
        m.forEach((a, i) =>
          row.appendChild(mkBtn(actionTitle(a), i === 0 ? 'primary' : 'default', () => confirmAction(i))));
      }
      row.appendChild(mkBtn('Cancel', 'secondary', cancelConfirm));
      panel.appendChild(row);
      return;
    }
    if (isHumanTurn()) {
      /* the neglect claim (owner's law 2026-09-18) — quiet, among the choices */
      const claims = humanActions.filter((a) => a.claim);
      if (claims.length) {
        const opp = g.players.find((p) => !R.sameSide(g, p.id, HUMAN));
        const cbtn = mkBtn('Claim a neglected move (' + claims.length + ')', 'claim-btn', () => {
          pendingConfirm = {
            matches: claims,
            reminder: (opp ? opp.name : 'The opponent') + ' left a move unmade — claim it, or play on and it stands.'
          };
          render();
        });
        panel.appendChild(cbtn);
      }
      /* End Turn lives here: ready once the gate is satisfied */
      panel.appendChild(mkEndTurnBtn());
      const note = ruleNoteNow();
      if (note) {
        const el = document.createElement('div');
        el.className = 'panel-hint rule-note';
        el.textContent = note;
        panel.appendChild(el);
      }
    }
    const p = g.players[g.turn];
    if (!p.isHuman) return;   // whose turn it is lives on the name banner
    /* tutorial only: the coach explains the opponent's last move */
    if (tutorialMode && coachMsg) {
      const coach = document.createElement('div');
      coach.className = 'panel-hint coach';
      coach.textContent = coachMsg;
      panel.appendChild(coach);
    }
    if (!tutorialMode) return;
    appendTutorialHints(panel);
  }

  /* ---------------- log ---------------- */
  function renderLog() {
    const box = $('log-entries');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.innerHTML = g.log.slice(-120).map((e) =>
      '<div class="log-entry ' + e.kind + '">' + escapeHtml(e.text) + '</div>').join('');
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  }

  function render() {
    if (!g) return;
    /* the whole board's interactivity state in one class: hover lifts,
       cursors, affordances — everything that says "you may touch this"
       exists only while the human's turn is LIVE */
    $('screen-game').classList.toggle('turn-live', isHumanTurn() && turnArmed);
    renderBars(); renderOppZone(); renderSides(); renderBottomCorner(); renderTable(); renderHand(); renderActionPanel(); renderLog();
    applySelClasses();
  }

  /* ---------------- lifecycle ---------------- */
  /* ---------------- the dealing ceremony ---------------- */
  /* Cards slide out of the deck face down, one beat each, then the whole
     hand turns face up — the riffle lands on the TURN (the owner's ruling:
     the opening sound suits the moment the cards are flipped). Pure
     staging: the engine has already dealt; nothing here touches a rule.
     Any tap skips to the end — the tenth game of a session owes no wait. */
  let dealSeq = null;
  let lastHandLen = 0;
  function runDealSequence(then) {
    const hand = g.players[HUMAN].hand.slice().sort(C.compare);
    const n = hand.length;
    if (!n || dealSeq) { then(); return; }
    const box = $('my-hand');
    box.innerHTML = '';
    /* the deck, face down at the table's middle */
    const deckEl = document.createElement('div');
    deckEl.id = 'deal-deck';
    const stackN = Math.min(4, Math.max(2, Math.ceil(n / 3)));
    for (let i = 0; i < stackN; i++) {
      const b = cardBack();
      b.style.setProperty('--i', i);
      deckEl.appendChild(b);
    }
    $('table-middle').appendChild(deckEl);
    /* the row of face-down cards */
    const staged = [];
    for (let i = 0; i < n; i++) {
      const back = cardBack();
      back.classList.add('in-hand', 'deal-in');
      back.style.animationDelay = (i * 150) + 'ms';
      box.appendChild(back);
      staged.push(back);
    }
    const timers = [];
    let finished = false;
    const finish = (e) => {
      if (finished) return;
      finished = true;
      if (e && e.stopPropagation) e.stopPropagation();
      timers.forEach(clearTimeout);
      deckEl.remove();
      $('screen-game').removeEventListener('click', finish, true);
      dealSeq = null;
      clearSelection();
      render();
      then();
    };
    dealSeq = { finish };
    $('screen-game').addEventListener('click', finish, true);
    /* one slide voice per card; the deck thins as it goes */
    for (let i = 0; i < n; i++) {
      timers.push(setTimeout(() => Snd.dealCard(), i * 150 + 60));
      if (i % 2 === 1 && deckEl.children.length > 1) {
        timers.push(setTimeout(() => { if (deckEl.lastChild) deckEl.lastChild.remove(); }, i * 150 + 140));
      }
    }
    /* the turn: the riffle first, then the faces stagger in */
    const flipAt = n * 150 + 260;
    timers.push(setTimeout(() => Snd.deal(), flipAt));
    for (let i = 0; i < n; i++) {
      timers.push(setTimeout(() => {
        if (!staged[i].parentNode) return;
        const real = cardEl(hand[i], {});
        real.classList.add('in-hand', 'flip-in');
        staged[i].parentNode.replaceChild(real, staged[i]);
      }, flipAt + i * 70));
    }
    timers.push(setTimeout(finish, flipAt + n * 70 + 480));
    timers.push(setTimeout(finish, flipAt + n * 70 + 1500));   /* safety: a game never hangs on a ceremony */
  }

  function newGame(opts) {
    opts = opts || {};
    demoMode = !!opts.demo;   // the AI plays every seat ONLY in an explicit demo
    const n = session.numPlayers;
    tutorialMode = session.mode === 'tutorial';
    const players = [{ name: 'You', isHuman: true }];
    for (let i = 1; i < n; i++) players.push(Object.assign({}, AI_SEATS[i], { isHuman: false }));
    g = R.createGame({ numPlayers: n, players, dealer: session.dealer % n });
    clearSelection();
    lastAction = null; humanActions = [];
    turnArmed = false;
    oppNote = null;
    tableSlots = {};          // fresh discard grid
    /* the fly corridor starts clean — a finished game's sweep pins must
       never float over the new one (found in verification 2026-09-15) */
    flyingIds.clear();
    if (flyLayerEl) flyLayerEl.innerHTML = '';
    motionEndsAt = 0;
    shiyaTick = null; shiyaOfferValue = null; clearTimeout(shiyaTimer);
    show('screen-game');
    $('screen-game').classList.toggle('p2', n === 2);   // the two-hand layout
    $('screen-game').classList.toggle('w2', p2Wide());  // …and its wide twin at ≥900px
    p2WideOn = p2Wide();
    fitCards();
    render();
    lastHandLen = g.players[HUMAN].hand.length;
    runDealSequence(() => tick());   // the ceremony, then the game goes live
  }

  function tick() {
    if (!g) return;
    /* the table waits for the cards to settle before ANYTHING continues —
       including the results: the sheet opens only when the last sweep has
       landed (owner's ruling 2026-09-16) */
    if (Date.now() < motionEndsAt) {
      setTimeout(() => tick(), motionEndsAt - Date.now() + 30);
      return;
    }
    if (g.phase === 'gameover') { finishGame(); return; }
    if (g.phase === 'shiya') {
      render();
      if (g.shiyaPending.caller === HUMAN && !demoMode) {
        if (shiyaTick && shiyaTick.value === g.shiyaPending.value && shiyaTick.owner === g.shiyaPending.capturer) {
          toast('Your Shiya request fires!');
          setTimeout(() => performAction({ type: 'shiya' }), 700);
        } else {
          openShiyaModal();
        }
      } else scheduleAi();
      return;
    }
    /* the second round's deal gets the same ceremony (two hands: the stock
       re-deals the moment the hands empty) */
    const handLen = g.players[HUMAN].hand.length;
    if (g.phase === 'play' && handLen > 0 && lastHandLen === 0 && !dealSeq) {
      lastHandLen = handLen;
      render();
      runDealSequence(() => tick());
      return;
    }
    lastHandLen = handLen;
    humanActions = R.legalActions(g);
    turnArmed = true;             // the turn is live — selections and controls may open
    if (!humanActions.length) { reportDeadlock(); return; }
    pendingConfirm = null;
    selectedCard = null;
    render();
    /* the AI keeps moving (digs, folds, end turn) while it is still their turn */
    if (!g.players[g.turn].isHuman || demoMode) scheduleAi();
  }

  /* Sipho's message-zone line — computed BEFORE the move is applied, while
     the builds he touches are still on the table */
  function aiNote(a) {
    const who = g.players[g.turn].name;
    const bVal = (a.buildIdx != null && g.builds[a.buildIdx]) ? g.builds[a.buildIdx].value : a.value;
    if (a.claim) {
      /* the neglect claim (owner's law 2026-09-18): his own words — he took
         the move you left unmade */
      if (a.type === 'preg') return who + ': claimed your neglected preg — merged into the ' + a.value + '-build.';
      if (a.victim != null || a.victims) return who + ': claimed your neglected dig into the ' + bVal + '-build.';
      return who + ': claimed your neglected fold into the ' + bVal + '-build.';
    }
    switch (a.type) {
      case 'capture':   return who + ': captured with ' + C.label(a.card) + '.';
      case 'build':
      case 'scaffold':
      case 'preg':      return who + ': built ' + a.value + '.';
      case 'augment':   return who + (a.method === 'top' ? ': topped the ' + bVal + '-build.' : ': folded cards into the ' + bVal + '-build.');
      case 'dig':
      case 'topdig':    return who + ': dug a pile top into the ' + bVal + '-build.';
      case 'caugment':  return who + ': folded table cards into the ' + bVal + '-build.';
      case 'efold':
      case 'edig':      return who + ': folded into the ' + bVal + '-build for capture.';
      case 'basetop':   return who + ': topped the loose ' + C.rank(a.card) + '.';
      case 'discard':   return who + ': discarded ' + C.label(a.card) + '.';
      case 'digfold': {
        const dug = g.players[a.victim].pile[g.players[a.victim].pile.length - 1];
        return who + ': dug ' + C.label(dug) + ' into the ' + bVal + '-build.';
      }
    }
    return null;
  }

  function scheduleAi() {
    setTimeout(() => {
      if (!g || g.phase === 'gameover') return;
      const a = AI.chooseAction(g);
      if (!a) { reportDeadlock(); return; }
      if (g.numPlayers === 2 && !g.players[g.turn].isHuman && a.type !== 'endturn' && a.type !== 'skip') {
        const note = aiNote(a);
        if (note) oppNote = note;
      }
      /* tutorial: explain the move while the board still shows the "before" */
      const why = tutorialMode && !['skip', 'shiya'].includes(a.type)
        ? AI.explain(g, a) : null;
      performAction(a, { why });
    }, aiSpeed());
  }

  /* Special case: no legal moves anywhere — stop and report, never auto-resolve */
  function reportDeadlock() {
    render();
    openAlertDialog('Special case detected',
      'No legal moves are available right now. This is a rule case we have not settled yet — ' +
      'please note what led here (the game log tells the story) and report it.');
    toast('\u26A0 Special case: no legal moves — please report.');
  }

  /* ---------------- the motion layer ---------------- */
  /* Every card tells its journey (owner 2026-09-15): the move applies in the
     engine at once; the cards then visibly travel — hand to slot, table to
     build, pile to build, everything to the pile on captures. Ghosts fly in
     a fixed layer above the board; the real destination stays hidden until
     the ghost lands on it. The action sound lands WITH the card. Flights
     ride inside the AI pacing (never longer than ~half the AI speed), so
     the turn flow itself never waits. A safety timer always clears up. */
  let flyLayerEl = null;
  function flyLayer() {
    if (!flyLayerEl) {
      flyLayerEl = document.createElement('div');
      flyLayerEl.id = 'fly-layer';
    }
    /* RE-ATTACH the same element — a rebuild must never orphan the ghosts
       already flying inside it (the stalled chains of 2026-09-15) */
    if (!flyLayerEl.parentNode) $('screen-game').appendChild(flyLayerEl);
    return flyLayerEl;
  }
  function motionDur() {
    return Math.max(220, Math.min(600, Math.round(aiSpeed() * 0.45)));
  }
  function boardSnapshot() {
    const cards = {}, piles = {}, builds = {}, buildFaces = {}, pileTops = {};
    const buildRendered = {}, pileTopRendered = {};
    document.querySelectorAll('#screen-game .card[data-id]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width && !cards[el.dataset.id]) cards[el.dataset.id] = r;
    });
    document.querySelectorAll('.pile-box[data-seat]').forEach((el) => {
      piles[el.dataset.seat] = el.getBoundingClientRect();
      const c = el.querySelector('.pile-top .card[data-id]');
      if (c) pileTopRendered[el.dataset.seat] = c.dataset.id;
    });
    document.querySelectorAll('.build-box.has-build[data-idx]').forEach((el) => {
      builds[Number(el.dataset.idx)] = el.getBoundingClientRect();
      const c = el.querySelector('.card[data-id]');
      if (c) buildRendered[Number(el.dataset.idx)] = c.dataset.id;
    });
    g.builds.forEach((b, i) => { if (b.cards.length) buildFaces[i] = b.cards[b.cards.length - 1]; });
    g.players.forEach((p, s) => { pileTops[s] = p.pile.length ? p.pile[p.pile.length - 1] : null; });
    /* what each seat's chrome said BEFORE the move — a stand-in card must
       wear the same stack edge, badge and lock the seat was wearing, or the
       flight reads as the counter switching off (owner 2026-09-17) */
    const pileLens = g.players.map((p) => p.pile.length);
    const buildMeta = g.builds.map((b) => ({ value: b.value, count: b.cards.length, augmented: !!b.augmented }));
    /* whole contents too — the numbers strip's previous reading is rebuilt
       from them while a flight is live (owner 2026-09-18) */
    const pileCards = g.players.map((p) => p.pile.slice());
    const buildCards = g.builds.map((b) => b.cards.slice());
    return { cards, piles, builds, buildFaces, pileTops, buildRendered, pileTopRendered, pileLens, buildMeta, pileCards, buildCards, table: g.table.slice() };
  }
  /* returns the landing delay for the played card (0 when nothing flies) */
  /* returns the TOTAL animation time — the table waits for all of it.
     onCatch, when given, is told every card event with the card's id and
     its kind: 'takeoff' when the mover lifts (for a cardless dig, the
     moment the card leaves the victim's pile) and 'collect' at every
     collection — a capture listens for its first collect; a dig listens
     for its dug card, whichever event carries it */
  function playMotion(prev, a, actor, onCatch) {
    const dur = motionDur();
    const pause = 70;   /* a breath between hops so each collection reads */
    const rectOf = (sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect() : null; };
    const cardRect = (id) => rectOf('#screen-game .card[data-id="' + id + '"]:not(.flying)');
    const buildRect = (idx) => rectOf('.build-box.has-build[data-idx="' + idx + '"]');
    const buildRectByValue = (v) => {
      const b = g.builds.find((x) => x.value === v);
      return b ? buildRect(g.builds.indexOf(b)) : null;
    };
    const pileRect = (seat) => rectOf('.pile-box[data-seat="' + seat + '"]');
    /* your cards lift from your hand. An AI's hand is never rendered — their
       cards ENTER FROM OUTSIDE the top of the screen (owner 2026-09-16):
       born fully above the edge — over the banner at the middle top — then
       seen sliding down into the play area */
    const origin = (id, to) => {
      if (prev.cards[id]) return prev.cards[id];
      /* the wide table shows his hand (owner 2026-09-17): a card Sipho plays
         lifts from his standing fan. His backs carry no ids, so the fan's own
         last back stands in as the take-off spot */
      const back = document.querySelector('#opp-fan .card:last-child');
      if (back) {
        const r = back.getBoundingClientRect();
        if (r.width) return r;
      }
      const w = (to && to.width) || 60, h = (to && to.height) || 84;
      let cx = null, top = null;
      if (g.numPlayers === 2) {
        const bar = document.querySelector('#opp-zone .namebar');
        if (bar) { const r = bar.getBoundingClientRect(); cx = r.left + r.width / 2; top = r.top; }
      }
      const sg = $('screen-game').getBoundingClientRect();
      if (cx == null) { cx = sg.left + sg.width / 2; top = sg.top; }
      return { left: cx - w / 2, top: top - h, width: w, height: h };   /* fully above the edge — it enters, it does not appear */
    };
    const bIdx = (a.buildIdx != null && g.builds[a.buildIdx]) ? a.buildIdx : null;

    /* THE CHAIN (owner's choreography 2026-09-15): the mover travels to the
       card it combines with and sits ON TOP of it; the stack then moves as a
       stack to the next higher card, collecting upward; when every card is
       gathered the whole stack settles into its designated place. A hand
       card always moves FIRST — to the lowest card; without one, the lowest
       card itself starts the chain. A capture's hand card flies onto what it
       captures (one card or one whole stack), then the stack goes to the pile */
    const parts = [];   /* {id, rect} in motion order — parts[0] moves first */
    let dest = null;
    const asc = (ids) => ids.filter(Boolean).sort((x, y) => C.rank(x) - C.rank(y));
    const dug = (victim) => (victim != null ? prev.pileTops[victim] : null);
    const dugRect = (victim) => (victim != null ? prev.piles[victim] : null);
    const collectInto = (hand, ids, destRect, last) => {
      /* the base card(s) join LAST: the chain's final collection point —
         the movers land on top of the base where it lies, then all travel
         together (owner 2026-09-16) */
      const tails = Array.isArray(last) ? last.filter(Boolean) : (last ? [last] : []);
      const movers = (hand ? [hand] : []).concat(asc(ids), tails);
      for (const id of movers) {
        const rect = (id === hand) ? origin(hand, destRect)
          : (prev.cards[id] || dugRect(a.victim) || cardRect(id));
        if (id && rect) parts.push({ id, rect });
      }
      dest = destRect;
    };
    switch (a.type) {
      case 'discard':
        parts.push({ id: a.card, rect: origin(a.card, cardRect(a.card)) });
        dest = cardRect(a.card);
        break;
      case 'capture': {
        /* one card or one whole stack (owner's law): the target joins under
           the played card, then both go to the pile together */
        const to = pileRect(actor);
        let target = null, tRect = null, deco = null;
        if (a.scaffoldCap || (a.buildIds || []).length) {
          const idx = a.scaffoldCap ? a.buildIds[0] : a.buildIds[0];
          target = prev.buildFaces[idx];
          tRect = prev.builds[idx] || prev.cards[target];
          deco = prev.buildMeta[idx];   /* the pinned stack keeps its badge and edge */
        } else if ((a.loose || []).length) {
          target = a.loose[0];
          tRect = prev.cards[target];
        }
        if (target && tRect && to) {
          parts.push({ id: a.card, rect: origin(a.card, to) });
          parts.push({ id: target, rect: tRect, deco });
          dest = to;
        }
        break;
      }
      case 'build': {
        const to = buildRectByValue(a.value);
        const ids = (a.loose || []).filter((id) => id !== a.base).concat([dug(a.victim)]);
        /* the base the law engine folds in SILENTLY (owner 2026-09-17): a
           plain founding carries no base field — the loose table card of the
           build's value is the base absorbBases will take. The animation
           finds it itself: it pins where it lies, the stack climbs and folds
           onto it, and only then does everything travel to the build area —
           the base never leaves alone */
        const bases = a.base ? [a.base]
          : prev.table.filter((id) => C.rank(id) === a.value && !(a.loose || []).includes(id));
        collectInto(a.card, ids, to, bases);
        break;
      }
      case 'augment': case 'dig': {
        const to = bIdx != null ? buildRect(bIdx) : buildRectByValue(a.value);
        const ids = (a.loose || []).concat([dug(a.victim)]);
        collectInto(a.card, ids, to);
        break;
      }
      case 'preg': {
        /* a true chain (owner 2026-09-16): the hand card flies ONTO the
           target build where it stands, they combine, and the whole stack
           travels to the pregger's area — no teleporting builds. A MERGE
           landing obeys the same law (owner 2026-09-17): the stop is the
           PREGGED build, never the destination — the pregged stack is part
           of the journey, it does not teleport into the survivor. The sort
           lands at the combine beat (owner's ruling 2026-09-17): cards
           combine, THEN sort lowest-on-top, THEN fly as one stack. A preg
           can also fold in a SILENT base (absorbBases — a rise only, never
           a merge): the base pins where it lies and the stack collects it
           last */
        const targetIdx = a.buildIdx;
        const face = prev.buildFaces[targetIdx];
        const faceRect = prev.builds[targetIdx] || (face ? prev.cards[face] : null);
        const to = buildRectByValue(a.value);
        if (face && faceRect) {
          parts.push({ id: a.card, rect: origin(a.card, faceRect) });
          parts.push({ id: face, rect: faceRect, deco: prev.buildMeta[targetIdx] });
          if (a.mergeInto == null) {
            for (const b of prev.table) {
              if (C.rank(b) === a.value && prev.cards[b]) parts.push({ id: b, rect: prev.cards[b] });
            }
          }
          dest = to;
        } else {
          parts.push({ id: a.card, rect: origin(a.card, to) });
          dest = to;
        }
        break;
      }
      case 'topdig':
        parts.push({ id: dug(a.victim), rect: dugRect(a.victim) });
        dest = bIdx != null ? buildRect(bIdx) : null;
        break;
      case 'digfold': case 'edig': {
        const to = bIdx != null ? buildRect(bIdx) : null;
        const ids = (a.victims || (a.victim != null ? [a.victim] : [])).map(dug)
          .concat(a.loose || []);
        collectInto(null, ids, to);
        break;
      }
      case 'scaffold': {
        /* the base HOLDS ITS GROUND (owner 2026-09-17): the combination
           stacks up first — lowest onto higher — then the whole stack
           travels to where the base stands and folds onto it. The
           scaffold's lot IS the base's place; the base never relocates.
           A scaffold can also fold in a SILENT base (absorbBases takes any
           loose table card of the value) — the animation finds it the same
           way the law engine does */
        const ids = (a.cards || []).concat([dug(a.victim)]);
        const bases = a.base ? [a.base]
          : prev.table.filter((id) => C.rank(id) === a.value && !(a.cards || []).includes(id));
        const baseRect = (bases.length && (prev.cards[bases[0]] ||
          (a.buildIdx != null ? prev.builds[a.buildIdx] : null))) || null;
        collectInto(null, ids, baseRect || buildRectByValue(a.value), bases);
        break;
      }
      case 'basetop': {
        const to = buildRectByValue(C.rank(a.card));
        collectInto(a.card, [], to, a.base);
        break;
      }
      case 'caugment': case 'efold': {
        const to = bIdx != null ? buildRect(bIdx) : null;
        collectInto(null, a.loose || [], to);
        break;
      }
      case 'endturn':
        /* the gameover sweep: the leftovers glide to the last capturer */
        if (g.phase === 'gameover' && g.lastCapturer != null) {
          const to = pileRect(g.lastCapturer);
          collectInto(null, prev.table, to);
        }
        break;
    }
    parts.splice(0, parts.length, ...parts.filter((p) => p && p.id && p.rect));
    if (!parts.length || !dest) return 0;

    const layer = flyLayer();
    /* every card hides from the renders while its journey plays — the table
       shows pins where each waiting card lay */
    parts.forEach((p) => flyingIds.add(p.id));
    /* and hidden NOW: the table WAITS during the chain, so no redraw will
       ever apply the rule — without this act the played card renders at its
       destination in the post-move redraw and the flight reads as a teleport
       (the owner's report 2026-09-16). The card exists only as its flying
       ghost until it lands */
    parts.forEach((p) => {
      const cur = document.querySelector('#screen-game .card[data-id="' + p.id + '"]:not(.flying)');
      if (cur) cur.style.visibility = 'hidden';
    });
    const pins = new Map();
    /* a stand-in wears what the seat wore (owner 2026-09-17): stack edge,
       value badge, lock — so the counter never switches off mid-flight */
    const decorate = (el, deco) => {
      if (!deco) return;
      if (deco.count) el.style.boxShadow = stackShadow(deco.count);
      if (deco.value != null) {
        const badge = document.createElement('span');
        badge.className = 'build-val';
        badge.textContent = deco.value;
        el.appendChild(badge);
        if (deco.augmented) el.appendChild(Object.assign(document.createElement('span'),
          { className: 'build-lock', textContent: '🔒' }));
      }
    };
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      const pin = cardEl(p.id);
      pin.style.visibility = 'visible';   /* a pin SHOWS the waiting card — the in-flight rule must not hide it */
      decorate(pin, p.deco);
      Object.assign(pin.style, {
        position: 'fixed', margin: 0, zIndex: 55,
        left: p.rect.left + 'px', top: p.rect.top + 'px',
        width: p.rect.width + 'px', height: p.rect.height + 'px'
      });
      layer.appendChild(pin);
      pins.set(p.id, pin);
    }
    /* the seat never empties while the cards travel (owner 2026-09-16).
       Build boxes keep showing their previous face; and ANY pile receiving
       arrivals is held by its previous top — unconditionally, from staging
       to reveal, so a pile never blanks mid-capture */
    const holders = [];
    const makeHolder = (rect, oldId, z, deco) => {
      const pin = cardEl(oldId);
      pin.style.visibility = 'visible';
      decorate(pin, deco);
      Object.assign(pin.style, {
        position: 'fixed', margin: 0, zIndex: z,
        left: rect.left + 'px', top: rect.top + 'px',
        width: rect.width + 'px', height: rect.height + 'px'
      });
      layer.appendChild(pin);
      holders.push(pin);
    };
    const holdPile = (seat) => {
      const box = document.querySelector('.pile-box[data-seat="' + seat + '"]');
      const oldId = prev.pileTopRendered[seat];
      const top = box && box.querySelector('.pile-top');
      if (!box || !oldId || !top) return;
      /* the slant never collapses (owner 2026-09-17): the stand-in wears
         the pile's edge, so a capture only ever thickens it at landing */
      makeHolder(top.getBoundingClientRect(), oldId, 58, { count: prev.pileLens[seat] });
    };
    const holdDest = () => {
      let boxSel = null, oldId = null, deco = null;
      const buildSelByValue = (v) => {
        const b = g.builds.find((x) => x.value === v);
        return b ? '.build-box.has-build[data-idx="' + g.builds.indexOf(b) + '"]' : null;
      };
      if (a.type === 'augment' || a.type === 'dig' || a.type === 'topdig' ||
          a.type === 'digfold' || a.type === 'edig' || a.type === 'caugment' || a.type === 'efold') {
        boxSel = bIdx != null ? '.build-box.has-build[data-idx="' + bIdx + '"]' : buildSelByValue(a.value);
        oldId = prev.buildRendered[a.buildIdx];
        deco = prev.buildMeta[a.buildIdx];
      } else if (a.type === 'preg') {
        /* the destination keeps a face ONLY when it HAD one: a MERGE folds
           into an existing build, so the survivor's box keeps its old face,
           badge and edge from take-off to landing. A preg that changes hands
           lands in a FOUNDING slot — no stand-in, or the pregged build's old
           face appears in the pregger's area before the cards do (owner
           2026-09-17: his Ace must never stand in Sipho's slot early) */
        if (a.mergeInto == null) return;
        boxSel = buildSelByValue(a.value);
        oldId = prev.buildRendered[a.mergeInto];
        deco = prev.buildMeta[a.mergeInto];
      }
      if (!boxSel || !oldId) return;
      const box = document.querySelector(boxSel);
      if (!box) return;
      const now = box.querySelector('.card[data-id]');
      if (!now || !flyingIds.has(now.dataset.id)) return;   // occupant visible — hold nothing
      makeHolder(now.getBoundingClientRect(), oldId, 60, deco);
    };
    if (a.type === 'capture') holdPile(actor);
    else if (a.type === 'endturn' && g.phase === 'gameover' && g.lastCapturer != null) holdPile(g.lastCapturer);
    else holdDest();
    /* the numbers strip obeys the same law as the cards (owner 2026-09-18):
       the count WAITS for the cards — during the flight the destination's
       strip reads the seat's PREVIOUS numbers, and the fresh count is
       written at the landing beat. A seat that was empty before keeps its
       strip hidden until the cards arrive. Departing seats (a dig victim's
       pile) keep their old reading until their card has flown */
    const pendingStrips = [];
    const stripText = (cards2) => {
      const st = R.pileStats(cards2);
      return st.cards + ' cards · ' + st.spades + ' ♠ · ' + st.points + ' pts';
    };
    const gateStrip = (boxSel, prevCards) => {
      if (!boxSel) return;
      const box = document.querySelector(boxSel);
      const strip = box && box.querySelector('.pile-stats');
      if (!strip) return;
      if (!prevCards || !prevCards.length) {
        strip.style.display = 'none';
        pendingStrips.push({ el: strip, show: true });
      } else {
        pendingStrips.push({ el: strip, text: strip.textContent });
        strip.textContent = stripText(prevCards);
      }
    };
    const buildBoxSelByValue = (v) => {
      const b = g.builds.find((x) => x.value === v);
      return b ? '.build-box.has-build[data-idx="' + g.builds.indexOf(b) + '"]' : null;
    };
    const pileBoxSel = (seat) => '.pile-box[data-seat="' + seat + '"]';
    if (a.type === 'capture') gateStrip(pileBoxSel(actor), prev.pileCards[actor]);
    else if (a.type === 'endturn' && g.phase === 'gameover' && g.lastCapturer != null)
      gateStrip(pileBoxSel(g.lastCapturer), prev.pileCards[g.lastCapturer]);
    else if (a.type === 'augment' || a.type === 'dig' || a.type === 'topdig' ||
             a.type === 'digfold' || a.type === 'edig' || a.type === 'caugment' || a.type === 'efold')
      gateStrip(bIdx != null ? '.build-box.has-build[data-idx="' + bIdx + '"]' : buildBoxSelByValue(a.value),
        prev.buildCards[a.buildIdx]);
    else if (a.type === 'preg')
      /* a merge reads the survivor's previous numbers until landing; a
         change of hands is a FOUNDING — the strip waits, hidden, with the
         cards (owner 2026-09-17) */
      gateStrip(buildBoxSelByValue(a.value),
        a.mergeInto != null ? prev.buildCards[a.mergeInto] : []);
    /* founding slots (build, basetop, scaffold) are covered by the arriving
       gate — their strips surface with the box at landing */
    if (a.victim != null && a.type !== 'capture') gateStrip(pileBoxSel(a.victim), prev.pileCards[a.victim]);
    /* a founding stack's lot keeps its EMPTY look until the cards land
       (owner 2026-09-17) — the counter appears only when the build arrives,
       never before */
    const arriving = [];
    /* cards hidden OUTSIDE the flight cast — the landing gate restores them
       with everything else at the settle beat */
    const hiddenExtras = [];
    if (a.type === 'build' || a.type === 'basetop') {
      const V = (a.type === 'basetop') ? C.rank(a.card) : a.value;
      const b = g.builds.find((x) => x.value === V && x.owner === actor && !x.scaffold);
      if (b) {
        const box = document.querySelector('.build-box.has-build[data-idx="' + g.builds.indexOf(b) + '"]');
        if (box) { box.classList.add('arriving'); arriving.push(box); }
      }
    } else if (a.type === 'scaffold') {
      const box = document.querySelector('.build-box.scaffold');
      if (box) { box.classList.add('arriving'); arriving.push(box); }
    } else if (a.type === 'preg' && a.mergeInto == null) {
      /* a change-of-hands preg FOUNDS its landing slot (owner 2026-09-17):
         the empty founding look holds until the stack arrives — no face, no
         strip, nothing early. The risen stack's rendered face waits too,
         even when it is a card the flight never carries (a buried card the
         re-sort surfaced) */
      const bsel = buildBoxSelByValue(a.value);
      const box = bsel && document.querySelector(bsel);
      if (box) {
        box.classList.add('arriving'); arriving.push(box);
        const c = box.querySelector('.card[data-id]');
        if (c && c.style.visibility !== 'hidden') {
          c.style.visibility = 'hidden';
          hiddenExtras.push(c);
        }
      }
    }

    /* the carrier: a perfect stack of ghosts — joiners slot BENEATH, so the
       mover rides on top (owner's rule) */
    const makeGhost = (id, rect, transform0) => {
      const el = cardEl(id);
      el.classList.add('flying');
      el.style.visibility = 'visible';
      Object.assign(el.style, {
        position: 'fixed', margin: 0, zIndex: 95,
        left: rect.left + 'px', top: rect.top + 'px',
        width: rect.width + 'px', height: rect.height + 'px',
        transformOrigin: 'top left', transition: 'none', opacity: '1'
      });
      el.style.transform = transform0 || 'none';
      /* the card remembers only its OWN start — every hop tells it exactly
        where to stand (target minus own start), so a card collected
        mid-journey joins the stack precisely where it stands (2026-09-15) */
      /* THE missing line (found 2026-09-16): the mover was created but never
         placed on the corridor — it flew its whole journey off-screen while
         every later joiner was inserted properly. The discard's ghost, the
         build's hand card, every departure: all invisible for this one gap */
      layer.appendChild(el);
      return { el, id, bx: rect.left, by: rect.top, w: rect.width || 1, h: rect.height || 1 };
    };
    let carrier = [makeGhost(parts[0].id, parts[0].rect)];
    let curL = parts[0].rect.left, curT = parts[0].rect.top;
    let curW = parts[0].rect.width, curH = parts[0].rect.height;
    const hop = (to, done) => {
      if (!to) { done(); return; }
      flyLayer();   /* self-heal: if anything detached the corridor, its flying cards return with it */
      curL = to.left; curT = to.top; curW = to.width || curW; curH = to.height || curH;
      carrier.forEach((gh) => {
        gh.el.style.transition = 'transform ' + dur + 'ms cubic-bezier(.25,.7,.3,1)';
        gh.el.style.transform = 'translate(' + (to.left - gh.bx) + 'px,' + (to.top - gh.by) +
          'px) scale(' + (curW / gh.w) + ',' + (curH / gh.h) + ')';
      });
      setTimeout(done, dur + 20);
    };
    const settle = () => {
      if (settle.done) return;   /* idempotent — the chain or the janitor, whoever comes first */
      settle.done = true;
      carrier.forEach((gh) => gh.el.remove());
      holders.forEach((h) => h.remove());
      arriving.forEach((el) => el.classList.remove('arriving'));   /* the lot lights up as the stack lands */
      hiddenExtras.forEach((c) => { c.style.visibility = ''; });   /* the gate's own hidden cards land with it */
      pendingStrips.forEach((s) => {   /* the count lands with the cards */
        if (s.text != null) s.el.textContent = s.text;
        else if (s.show) s.el.style.display = '';
      });
      for (const p of parts) {
        flyingIds.delete(p.id);
        const cur = document.querySelector('#screen-game .card[data-id="' + p.id + '"]:not(.flying)');
        if (cur) cur.style.visibility = '';
      }
    };
    let i = 1;
    const total = parts.length * (dur + pause);
    const nextHop = () => {
      if (i < parts.length) {
        const p = parts[i];
        hop(p.rect, () => {
          const pin = pins.get(p.id);
          if (pin) pin.remove();
          const gh = makeGhost(p.id,
            { left: curL, top: curT, width: p.rect.width || curW, height: p.rect.height || curH });
          /* beneath — the mover rides on top */
          if (carrier[0].el.parentNode === layer) layer.insertBefore(gh.el, carrier[0].el);
          else layer.appendChild(gh.el);
          carrier.unshift(gh);
          /* the travelling stack of a COLLECTION is always SORTED (owner
             2026-09-16): highest at the bottom, lowest riding on top — when
             the 7 collects the 2, the 2 sits on the 7. The DOM order is the
             paint order, so the ghosts re-stack by rank at rest. A PREG
             joins this law (owner 2026-09-17): the sort lands AT the combine
             beat — cards combine, sort, then fly as one stack.
             A CAPTURE keeps the other law (owner 2026-09-17): the played
             card rides ON TOP of what it takes, whatever the ranks — the
             sort would bury a 10 under a build's low face card */
          if (['build', 'scaffold', 'augment', 'dig', 'preg', 'digfold', 'edig',
               'caugment', 'efold', 'basetop'].includes(a.type)) {
            carrier.slice().sort((x, y) => C.rank(y.id) - C.rank(x.id))
              .forEach((cgh) => layer.appendChild(cgh.el));
          }
          /* a catch speaks as the mover lands on what it takes (owner
             2026-09-17): the capture at the card it captures, the dig at
             the pile-top it digs — in the same task as the collect itself,
             never later at the journey's end. Every collection is announced
             with the collected card's id; the listener decides which beat
             is the one that speaks */
          if (onCatch) onCatch(p.id, 'collect');
          i++;
          setTimeout(nextHop, pause);
        });
      } else {
        hop(dest, () => settle());
      }
    };
    /* the browser must SEE the mover standing at its start before the first
       hop fires — two frames of rest, or the opening leg teleports (the
       guard lost in the chain rebuild, restored 2026-09-15) */
    /* start without depending on paint frames: a forced layout gives the
       browser its "before" (a hidden or busy tab stalls rAF forever — the
       journey must still run; the janitor below finishes it regardless) */
    void carrier[0].el.offsetWidth;
    /* a cardless dig's mover IS the dug card (owner 2026-09-17): it is dug
       the instant it lifts from the victim's pile — announce the take-off
       with the chain's first step */
    if (onCatch) onCatch(parts[0].id, 'takeoff');
    setTimeout(nextHop, 30);
    /* safety — and the guaranteed janitor: no card may stay hidden and no
       ghost may linger, whatever happens to frames or timers */
    setTimeout(() => { if (!settle.done) settle(); }, total + 1500);
    setTimeout(() => {
      for (const p of parts) {
        if (!layer.querySelector('.flying[data-id="' + p.id + '"]')) flyingIds.delete(p.id);
      }
    }, total + 1500);
    return total;
  }

  function performAction(a, opts) {
    opts = opts || {};
    const actor = g.turn;
    const prev = boardSnapshot();   // where every card sits before the move
    try {
      R.applyAction(g, a);
    } catch (err) {
      console.error(err);
      toast('Something went wrong: ' + err.message);
      return;
    }
    lastAction = (a.type === 'skip' || a.type === 'shiya') ? null : a;
    clearSelection();
    pendingConfirm = null;
    humanActions = [];   // stale actions must not flash into the next player's ribbon
    turnArmed = false;   // and the incoming turn is not live until its moves are computed
    coachMsg = (opts && opts.why) || null;
    render();
    /* the cards tell their journey — and the table's own voice lands WITH
       the card (owner 2026-09-15): your moves at full presence, the AI's a
       touch quieter. A capture ALWAYS speaks as a capture (the owner's
       recording) — the sweep sound belongs to the end-of-game sweep alone.
       The capture's voice is the CATCH itself (owner 2026-09-17): it kicks
       in the instant the capturing card lands on the card or cards being
       captured — the chain hands it to playMotion, which fires it in the
       same task as the collect.
       EVERY dug card speaks (owner 2026-09-17): any move that pulls a card
       from a captured pile — a dig, a dig-fold combine, a founding, a
       scaffold, a fold, an enemy dig — sounds the steal the instant that
       card is dug: the mover at its take-off from the pile, a scooped card
       at its collection. The move's other voice, when it has one, still
       lands at the end of the journey as before */
    const q = (opts && opts.human) ? 1 : 0.45;
    let captureSpoken = false;   /* the catch beat owns the capture's voice — never twice */
    const captureBeat = (id, kind) => {
      if (kind !== 'takeoff' && !captureSpoken) { captureSpoken = true; Snd.capture(q); }
    };
    const dugIds = new Set();
    if (a.type !== 'capture') {
      if (a.victim != null && prev.pileTops[a.victim]) dugIds.add(prev.pileTops[a.victim]);
      for (const s of (a.victims || [])) if (prev.pileTops[s]) dugIds.add(prev.pileTops[s]);
    }
    const stealSpoken = new Set();
    const stealBeat = (id) => {
      if (dugIds.has(id) && !stealSpoken.has(id)) { stealSpoken.add(id); Snd.steal(q); }
    };
    const fire = () => {
      if (a.type === 'capture') { captureBeat(); return; }
      if (dugIds.size && !stealSpoken.size) Snd.steal(q);   /* fallback — the flight never showed the dig */
      if (a.type === 'build' || a.type === 'augment' || a.type === 'preg' ||
          (a.claim && (a.type === 'caugment' || a.type === 'digfold' || a.type === 'topdig'))) Snd.build(q);
      else if (a.type === 'discard') Snd.drift(q);
    };
    const catchCb = dugIds.size ? stealBeat : (a.type === 'capture' ? captureBeat : null);
    const landAt = playMotion(prev, a, actor, catchCb);
    if (landAt > 0) {
      /* the whole chain plays out; the table — next move and input alike —
         waits for the cards to settle (owner's ruling 2026-09-15) */
      motionEndsAt = Date.now() + landAt + 40;
      humanBusy = true;   // no taps while the cards are in the air
      setTimeout(() => { humanBusy = false; }, landAt + 160);
      setTimeout(fire, landAt);
    } else fire();
    /* pairs: the partner just completed a build whose value the human holds —
       offer Shiya immediately */
    if (a.type === 'build' && g.numPlayers === 4 && a.owner === 2 && !opts.human && g.phase === 'play') {
      const v = a.value;
      if (g.players[HUMAN].hand.some((h) => C.rank(h) === v) &&
          document.querySelectorAll('.modal:not(.hidden)').length === 0) {
        setTimeout(() => openShiyaOffer(v), 450);
      }
    }
    /* the next turn arms in the SAME task the move lands — no timer, no blank
       frame between "move painted" and "ribbon lit" (owner's ruling: zero gap
       from the AI's last move to the player's turn) */
    tick();
  }

  /* ---------------- Shiya offer (partner completed a build) ---------------- */
  let shiyaOfferValue = null;
  function openShiyaOffer(value) {
    if (!g || g.phase === 'gameover') return;
    shiyaOfferValue = value;
    $('shiya-offer-title').textContent = 'Shiya — Build ' + value + '?';
    $('shiya-offer-text').innerHTML = '<b>' + escapeHtml(g.players[2].name) + '</b> completed the <b>' + value +
      '-build</b> and you hold a ' + value + '. Call <b>Shiya</b> and it comes to you.';
    $('modal-shiya-offer').classList.remove('hidden');
  }

  /* ---------------- Shiya modal ---------------- */
  function openShiyaModal() {
    const sp = g.shiyaPending;
    const cards = sp.cards.length + 1;
    $('shiya-text').innerHTML = '<b>' + escapeHtml(g.players[sp.capturer].name) + '</b> captured ' +
      sp.cards.map((id) => C.label(id)).join(' + ') + ' with <b>' + C.label(sp.playedCard) + '</b>.<br>' +
      'Call <b>Shiya</b> to turn it into a ' + sp.value + '-build (' + cards + ' cards) in YOUR build area — ' +
      'you hold a ' + sp.value + ' to capture it later.';
    $('modal-shiya').classList.remove('hidden');
    let left = 3;
    const cd = $('shiya-countdown');
    cd.textContent = '(' + left + ')';
    clearTimeout(shiyaTimer);
    const step = () => {
      left--;
      if (left <= 0) { closeShiyaModal(); performAction({ type: 'skip' }); return; }
      cd.textContent = '(' + left + ')';
      shiyaTimer = setTimeout(step, 1000);
    };
    shiyaTimer = setTimeout(step, 1000);
  }
  function closeShiyaModal() {
    clearTimeout(shiyaTimer);
    $('modal-shiya').classList.add('hidden');
  }

  /* ---------------- hint ---------------- */
  function requestHint() {
    if (!g || g.phase === 'gameover' || !isHumanTurn()) {
      toast('Hints only work on your turn.'); return;
    }
    const run = () => {
      const h = AI.hint(g);
      if (h.action && h.action.card) { selectedCard = h.action.card; renderHand(); }
      renderActionPanel();
      /* two hands: the hint stands in my message zone; otherwise the strip */
      const host = (g.numPlayers === 2) ? document.getElementById('my-warn') : $('action-panel');
      if (host) {
        const chip = document.createElement('div');
        chip.className = 'panel-hint coach';
        chip.textContent = '💡 ' + h.text;
        host.insertBefore(chip, host.firstChild);
      }
      toast(h.text);
    };
    if (Ads.removed) { run(); return; }
    Ads.showRewarded('hint').then((r) => {
      if (r === 'rewarded') run();
      else toast('No hint — the ad has to be watched to the end.');
    });
  }

  /* ---------------- end of game ---------------- */
  function finishGame() {
    /* the end-of-game leftover sweep is the sweep sound's one moment
       (owner's ruling 2026-09-10) — cards left on the table, swept up */
    if (g.finalSweep > 0) Snd.sweep(1);
    Ads.onGameFinished();
    session.games++;
    /* finishing a tutorial unlocks the next table size */
    if (tutorialMode) {
      const prog = loadProgress();
      if (g.numPlayers === 2) prog.t3 = true;
      if (g.numPlayers === 3) prog.t4 = true;
      saveProgress(prog);
    }
    const res = R.scoreGame(g);
    const teams = R.teamsOf(g) || g.players.map((p) => [p.id]);
    res.stats.forEach((t, i) => {
      if (res.winners.includes(t.name)) {
        for (const seat of teams[i]) session.wins[seat] = (session.wins[seat] || 0) + 1;
      }
    });
    saveSession();
    render();
    Ads.maybeInterstitial('results').then(() => showResults(res));
  }

  function showResults(res) {
    const box = $('results-body');
    /* rematch is a two-hand privilege (the lobby flow keeps 3/4-hand tables
       turning); the loser of the last game always plays first — the winner deals */
    const soloWinner = res.stats.find((t) => res.winners.includes(t.name) && t.members.length === 1);
    lastWinnerSeat = soloWinner ? soloWinner.members[0] : null;
    $('btn-again').classList.toggle('hidden', g.numPlayers !== 2);

    /* the portrait ledger (owner-approved 2026-09-14): the verdict first,
       then one card per side stacked full-width — counts left, points right,
       your card always on top. The arithmetic stays in the open; only the
       shape turns sideways to fit the phone */
    const mineIdx = res.stats.findIndex((t) => t.members.includes(HUMAN));
    const stats = res.stats.slice();
    if (mineIdx > 0) stats.unshift(stats.splice(mineIdx, 1)[0]);
    const youWon = res.stats.some((t) => t.members.includes(HUMAN) && res.winners.includes(t.name));
    let title, vClass;
    if (res.tie) { title = 'It&rsquo;s a tie'; vClass = 'tie'; }
    else if (youWon) { title = 'You win!'; vClass = 'win'; }
    else {
      const verb = (res.winners.length > 1 || res.winners[0] === 'You' || res.winners[0].indexOf('&') >= 0) ? ' win!' : ' wins!';
      title = escapeHtml(res.winners[0]) + verb; vClass = 'lose';
    }
    let html = '<div class="verdict ' + vClass + '">' +
      '<div class="verdict-title">' + title + '</div>' +
      '<div class="verdict-score">' + stats.map((t) => t.total).join('<small>&ndash;</small>') + '</div>' +
      '<div class="verdict-session">Session: ' + escapeHtml(sessionTallyText()) + '</div>' +
      '</div>';
    /* the table (owner 2026-09-15): no column headers — the middle column
       carries the row headers, the values flank them, and the OUTERMOST
       columns carry the points, one per side, reading down to the total */
    const lab = (t) => t.members.includes(HUMAN)
      ? 'You' + (t.members.length > 1 ? ' &amp; partner' : '')
      : escapeHtml(t.name);
    /* COLOUR-CODED RESULTS (owner 2026-09-18): my side blue, the enemy side
      crimson — the head badges and the table's columns carry their side */
    const sideCls = (t) => ' vs-' + (t.members.includes(HUMAN) ? 'me' : 'opp');
    /* bare numbers only (owner 2026-09-15): no ×, no suit icons, no 'pts'
       suffix — and the Spy 2 / Big 10 indicators read 1 or 0.
       Row order (owner 2026-09-15): Big 10, Spy 2, ONE ROW PER ACE from the
       final pile, then Spades, then Cards; Sweep and Total close */
    const P = (t, pts, side) => '<td class="t-pts' + (side ? ' ' + side : '') + (pts ? ' win' : '') + '">' + (pts || '') + '</td>';
    const pileOf = (t) => t.members.flatMap((m) => g.players[m].pile);
    const rows = [
      { name: '10&diams; Big 10', val: (t) => t.d10 ? '1' : '0', pts: (t) => t.d10 * 2 },
      { name: '2&spades; Spy', val: (t) => t.s2 ? '1' : '0', pts: (t) => t.s2 }
    ];
    for (const s of ['S', 'H', 'D', 'C']) {
      const glyph = { S: '&spades;', H: '&hearts;', D: '&diams;', C: '&clubs;' }[s];
      const held = (t) => pileOf(t).includes(s + '1');
      rows.push({ name: 'A' + glyph, val: (t) => held(t) ? '1' : '0', pts: (t) => held(t) ? 1 : 0 });
    }
    /* the two sweeps (owner 2026-09-15): POINTS sweep (all six point cards)
       and CARDS sweep (all forty) — each reads 1/0 from the final pile,
       and only the one that scored carries its flat points */
    const pointCards = ['S1', 'H1', 'D1', 'C1', 'S2', 'D10'];
    const allPoints = (t) => pointCards.every((c) => pileOf(t).includes(c));
    const allCards = (t) => pileOf(t).length === 40;
    const cleanPts2 = res.teamMode ? 44 : 22;
    const pointSweepPts = res.teamMode ? 22 : 11;
    rows.push(
      { name: 'Spades', val: (t) => String(t.spades), pts: (t) => t.mostSpades },
      { name: 'Cards', val: (t) => String(t.cards), pts: (t) => t.mostCards },
      { name: 'Points sweep', val: (t) => allPoints(t) ? '1' : '0',
        pts: (t) => (t.sweep && t.sweep < cleanPts2) ? pointSweepPts : 0 },
      { name: 'Cards sweep', val: (t) => allCards(t) ? '1' : '0',
        pts: (t) => t.sweep >= cleanPts2 ? t.sweep : 0 }
    );
    const sheetCard = document.querySelector('#modal-results .modal-card');
    /* (owner 2026-09-19, refined same day) THE FORMAT NEVER CHANGES — the
       classic ledger on every screen; on the wide PC felt only the CARD
       turns landscape (land-sheet) so the sheet reads wide, not tall */
    sheetCard.classList.toggle('land-sheet', p2Wide() && stats.length === 2);
    /* one true table (owner-approved preview 2026-09-15): every column a
       single shared channel — the vertical lines run straight from the
       first row to the Total, all text centred in its cell */
    html += '<div class="versus' + (stats.length === 3 ? ' three' : '') + '">';
    html += '<div class="vs-head">' + (stats.length === 3 ? '<i></i>' : '') +
      stats.map((t) => '<div class="vs-side' + sideCls(t) + (res.winners.includes(t.name) ? ' winner' : '') + '">' +
        '<span class="vs-name">' + lab(t) + '</span><span class="vs-total">' + t.total + '</span></div>')
        .join(stats.length === 2 ? '<span class="vs-mid">vs</span>' : '') + '</div>';
    html += '<table class="vs-table">';
    for (const r of rows) {
      if (stats.length === 3) {
        html += '<tr><th class="t-lab" scope="row">' + r.name + '</th>' +
          stats.map((t) => '<td class="t-val">' + r.val(t) + '</td>' + P(t, r.pts(t))).join('') + '</tr>';
      } else {
        const a = stats[0], b = stats[1];
        html += '<tr>' + P(a, r.pts(a), 'col-me') +
          '<td class="t-val col-me">' + r.val(a) + '</td><th class="t-lab" scope="row">' + r.name + '</th>' +
          '<td class="t-val col-opp">' + r.val(b) + '</td>' + P(b, r.pts(b), 'col-opp') + '</tr>';
      }
    }
    /* the totals close the table: each side's points column sums to it */
    if (stats.length === 3) {
      html += '<tr class="total"><th class="t-lab" scope="row">Total</th>' +
        stats.map((t) => '<td class="t-val"></td>' +
          '<td class="t-pts tot' + (res.winners.includes(t.name) ? ' win' : '') + '">' + t.total + '</td>').join('') + '</tr>';
    } else {
      const a = stats[0], b = stats[1];
      html += '<tr class="total">' +
        '<td class="t-pts tot col-me' + (res.winners.includes(a.name) ? ' win' : '') + '">' + a.total + '</td>' +
        '<td class="t-val col-me"></td><th class="t-lab" scope="row">Total</th><td class="t-val col-opp"></td>' +
        '<td class="t-pts tot col-opp' + (res.winners.includes(b.name) ? ' win' : '') + '">' + b.total + '</td></tr>';
    }
    html += '</table></div>';
    html += '<details class="score-law"><summary>&#9432; ' + res.totalInPlay +
      ' points were in play &mdash; how scoring works</summary><p>' +
      (res.teamMode
        ? 'Pairs scoring. Most cards and most spades score 2 — a tie pays 1 point to each tied side. A sweep IS the score: the 11 doubled to 22, a clean sweep (all forty cards) quadrupled to 44.'
        : 'Singles scoring. Card points only — no most bonuses in three hands. A sweep IS the score: 11; a clean sweep 22.') +
      '</p></details>';
    box.innerHTML = html;
    $('modal-results').classList.remove('hidden');
    const mine = res.stats.find((t) => t.members.includes(HUMAN));
    const other = res.stats.find((t) => !t.members.includes(HUMAN));
    const cleanPts = res.teamMode ? 44 : 22;
    if (mine && mine.sweep >= cleanPts) Snd.sweepKing();
    else if (mine && mine.sweep) Snd.sweepWin();
    else if (other && other.sweep >= cleanPts) Snd.sweptClean();
    else if (other && other.sweep) Snd.sweptPoint();
    else if (youWon) Snd.win();
    else Snd.lose();
  }

  function sessionTallyText() {
    const parts = [];
    for (let i = 0; i < session.numPlayers; i++) {
      parts.push((i === HUMAN ? 'You' : (AI_SEATS[i] && AI_SEATS[i].name) || ('Seat ' + i)) + ' ' + (session.wins[i] || 0));
    }
    return parts.join(' · ') + ' — ' + session.games + ' game' + (session.games === 1 ? '' : 's');
  }

  /* ---------------- setup / toast / settings ---------------- */
  function renderSetup() {
    document.querySelectorAll('#mode-row .choice').forEach((b) => {
      b.classList.toggle('on', b.dataset.mode === session.mode);
    });
    const prog = loadProgress();
    document.querySelectorAll('#player-count .choice').forEach((b) => {
      const n = parseInt(b.dataset.n, 10);
      b.classList.toggle('on', n === session.numPlayers);
      /* tutorial walks up: 2 hands first, 3 then 4 unlocked by finishing */
      const locked = session.mode === 'tutorial' &&
        ((n === 3 && !prog.t3) || (n === 4 && !prog.t4));
      b.classList.toggle('locked', locked);
      b.disabled = locked;
      const small = b.querySelector('small');
      if (!b.dataset.small) b.dataset.small = small.textContent;   // keep the original caption
      small.textContent = locked
        ? (n === 3 ? 'locked — finish the 2-hand tutorial' : 'locked — finish the 3-hand tutorial')
        : b.dataset.small;
    });
    $('setup-preview').textContent = previewText();
  }
  function previewText() {
    const d = R.DEAL[session.numPlayers];
    let t = d.per + ' cards each, ' + (d.table ? d.table + ' card on the table, ' : 'no table cards, ') +
      (40 - d.per * session.numPlayers - d.table) + ' in the stock.';
    if (session.numPlayers === 2) t += ' Two rounds — the stock re-deals once.';
    if (session.numPlayers === 3) t += ' You against Sipho and Thandi — 7 points in play.';
    if (session.numPlayers === 4) t += ' Pairs: you partner with Thandi (opposite seat) against Sipho & Naledi.';
    if (session.mode === 'tutorial') {
      t += ' A coach guides you: hints (ad-funded), move explanations and the live score.';
    }
    return t;
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
  }

  function openSettings() {
    renderSettings();
    $('modal-settings').classList.remove('hidden');
  }
  function renderSettings() {
    $('snd-toggle').textContent = Snd.muted ? 'Sound: OFF' : 'Sound: ON';
    $('confirm-toggle').textContent = directMode()
      ? 'Moves: Direct (tap to play)'
      : 'Moves: Prompt every move';
    $('speed-select').value = localStorage.getItem('sacassino.aiSpeed') || '900';
    $('btn-remove-ads').textContent = Ads.removed ? '✓ Ads removed — thank you!' : 'Remove ads — $2.99 (one-time)';
    $('btn-remove-ads').disabled = Ads.removed;
    /* the personal table voice — the truth about which recordings the game
       has loaded and by which route: instant = sample-accurate, converted =
       self-converted WAV, element = the slower player, failed = tell the dev */
    const box = $('my-sounds');
    if (box) {
      const st = Snd.ownerStatus();
      const mine = st.filter((s) => s.mine).map((s) => s.key);
      const labels = { place: 'card played', discard: 'discard', build: 'build', steal: 'dig',
        deal: 'shuffle', capture: 'capture', sweep: 'sweep', win: 'win', lose: 'lose',
        click: 'button', select: 'select', deselect: 'deselect' };
      box.innerHTML = st.map((s) => {
        let tag = '';
        if (s.mine) {
          if (s.route === 'instant' || s.route === 'converted') tag = ' ✓instant';
          else if (s.route === 'failed') tag = ' ✗failed';
          else tag = ' ✓slow';
          if (s.ms) tag += ' ' + s.ms + 'ms';
        }
        return '<span class="' + (s.mine ? 'snd-mine' : 'snd-ship') + '">' +
          (labels[s.key] || s.key) + tag + '</span>';
      }).join('');
      box.title = mine.length ? mine.length + ' of your recordings live' : 'no personal recordings loaded on this device';
    }
  }

  function refreshMenu() {
    $('session-tally').textContent = session.games ? 'Session so far: ' + sessionTallyText() : '';
  }

  /* ---------------- wiring ---------------- */
  function init() {
    Ads.init($('banner-ad-slot'));

    $('btn-play').addEventListener('click', () => { Snd.unlock(); Snd.click(); renderSetup(); show('screen-setup'); });
    $('btn-how').addEventListener('click', () => { Snd.click(); show('screen-how'); });
    $('btn-settings-menu').addEventListener('click', () => { Snd.click(); openSettings(); });
    $('btn-quit').addEventListener('click', () => {
      window.close();
      toast('You can close this browser tab to quit.');
    });

    document.querySelectorAll('#mode-row .choice').forEach((b) => {
      b.addEventListener('click', () => {
        session.mode = b.dataset.mode;
        saveSession(); renderSetup(); Snd.click();
      });
    });
    document.querySelectorAll('#player-count .choice').forEach((b) => {
      b.addEventListener('click', () => {
        session.numPlayers = parseInt(b.dataset.n, 10);
        saveSession(); renderSetup(); Snd.click();
      });
    });
    $('btn-start').addEventListener('click', () => { Snd.click(); newGame(); });
    $('btn-setup-back').addEventListener('click', () => { Snd.click(); refreshMenu(); show('screen-menu'); });
    $('btn-how-back').addEventListener('click', () => { Snd.click(); refreshMenu(); show('screen-menu'); });

    $('btn-log').addEventListener('click', () => {
      document.body.classList.toggle('log-open');
      $('log-panel').classList.toggle('open');
      Snd.click();
    });
    $('btn-log-close').addEventListener('click', () => {
      document.body.classList.remove('log-open');
      $('log-panel').classList.remove('open');
      Snd.click();
    });
    $('btn-speed').addEventListener('click', () => {
      const speeds = [400, 900, 1600];
      const cur = aiSpeed();
      const next = speeds[(speeds.indexOf(cur) + 1) % speeds.length];
      localStorage.setItem('sacassino.aiSpeed', String(next));
      Snd.click();
      toast('AI speed: ' + (next === 400 ? 'Fast' : next === 900 ? 'Normal' : 'Relaxed'));
    });
    /* leaving the game strips any demo/auto address, so refreshing the page
       lands on the menu instead of re-launching an AI demo */
    function clearAutoHash() {
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    }

    $('btn-home').addEventListener('click', () => {
      Snd.click();
      if (confirm('Leave this game? It will be abandoned.')) {
        g = null;
        clearAutoHash();
        Ads.maybeInterstitial('menu').then(() => { refreshMenu(); show('screen-menu'); });
      }
    });
    $('my-hand').addEventListener('click', (e) => {
      const el = e.target.closest('.card');
      if (!el || !isHumanTurn() || humanBusy || !turnArmed) return;
      if (g.turnUsed) {           // the turn's one hand card is already spent
        if (tutorialMode) toast(g.correctable && g.correctable.seat === HUMAN
          ? 'Card down rule — tap the discarded card in its slot to use it, or end the turn.'
          : 'You already used your hand card this turn — dig or end the turn.');
        return;
      }
      if (el.dataset.id === selectedCard) {   // tap the selected card again → deselect
        clearSelection();
        pendingConfirm = null;
        Snd.deselect();
        render();
        return;
      }
      selectedCard = el.dataset.id;   // the move's hand card — an existing table/
                                        // pile selection is KEPT (order never matters)
      if (!refreshAfterSelect()) Snd.select();
    });

    /* the board itself is tappable: table cards, builds, pile tops, empty slots */
    $('table-cards').addEventListener('click', (e) => {
      const cell = e.target.closest('.grid-cell');
      if (cell) { tryDiscardTo(cell.dataset.area); return; }
      const el = e.target.closest('.card');
      if (!el) return;
      /* the Card down rule: the just-discarded card plays as if still in
         hand — tapping it in its slot selects it as the move's hand card */
      if (g.correctable && g.correctable.seat === HUMAN && el.dataset.id === g.correctable.card &&
          isHumanTurn() && !humanBusy && turnArmed) {
        if (selectedCard === el.dataset.id) {
          clearSelection(); pendingConfirm = null; Snd.deselect(); render(); return;
        }
        selectedCard = el.dataset.id;
        if (!refreshAfterSelect()) Snd.select();
        return;
      }
      /* a scaffold stack's face is the STACK, not a loose card — toggling it
         into the table selection poisoned the capture match and froze the game */
      if (!el.closest('.build-box')) toggleTableSel(el.dataset.id);
    });
    $('screen-game').addEventListener('click', (e) => {
      const bz = e.target.closest('.build-box.has-build');
      if (bz && bz.dataset.idx != null) { toggleBuildSel(Number(bz.dataset.idx)); return; }
      const pz = e.target.closest('.pile-box');
      if (pz && pz.dataset.seat != null) { togglePileSel(Number(pz.dataset.seat)); return; }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (pendingConfirm) { cancelConfirm(); return; }
      if (selectedCard || hasSideSelection()) { clearSelection(); render(); }
    });

    $('btn-shiya-offer-yes').addEventListener('click', () => {
      Snd.click();
      shiyaTick = { value: shiyaOfferValue, owner: 2 };
      $('modal-shiya-offer').classList.add('hidden');
      toast('Shiya set — the ' + shiyaOfferValue + '-build comes to you when ' + g.players[2].name + ' captures it.');
    });
    $('btn-shiya-offer-no').addEventListener('click', () => {
      Snd.click();
      shiyaTick = null;
      $('modal-shiya-offer').classList.add('hidden');
    });
    $('btn-alert-ok').addEventListener('click', () => {
      Snd.click();
      $('modal-alert').classList.add('hidden');
    });

    $('btn-hint').addEventListener('click', () => { Snd.click(); requestHint(); });

    $('btn-shiya-call').addEventListener('click', () => { Snd.click(); closeShiyaModal(); performAction({ type: 'shiya' }, { human: true }); });
    $('btn-shiya-skip').addEventListener('click', () => { Snd.click(); closeShiyaModal(); performAction({ type: 'skip' }, { human: true }); });

    $('btn-again').addEventListener('click', () => {
      $('modal-results').classList.add('hidden');
      if (session.numPlayers === 2 && lastWinnerSeat != null) {
        session.dealer = lastWinnerSeat;   // the winner deals — the loser plays first
      } else {
        session.dealer = (session.dealer + 1) % session.numPlayers;
      }
      saveSession(); Snd.click(); newGame();
    });
    $('btn-results-menu').addEventListener('click', () => {
      $('modal-results').classList.add('hidden');
      clearAutoHash();
      Ads.maybeInterstitial('menu').then(() => { refreshMenu(); show('screen-menu'); });
    });

    $('btn-settings-close').addEventListener('click', () => { Snd.click(); $('modal-settings').classList.add('hidden'); });
    $('snd-toggle').addEventListener('click', () => { Snd.muted = !Snd.muted; renderSettings(); if (!Snd.muted) Snd.click(); });
    /* THE VOICE BRIDGE (owner 2026-09-19): the personal recordings live in
       this device's browser storage alone — the phone that made them plays
       them, a fresh device plays the shipped samples. SAVE them to a file on
       the phone, send the file to the PC, LOAD it there once — both screens
       then speak with exactly the same voice */
    $('btn-voice-save').addEventListener('click', async () => {
      Snd.click();
      const pack = await Snd.exportVoice();
      if (!pack) { toast('No recordings of yours on this device yet.'); return; }
      const file = new File([JSON.stringify(pack)], 'sa-cassino-my-sounds.json', { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'SA Cassino — my table voice' });
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return;   /* changed his mind — no download needed */
          /* share refused — fall through to a plain download */
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Saved — send this file to your other device, then Load it there.');
    });
    $('btn-voice-load').addEventListener('click', () => { Snd.click(); $('voice-file').click(); });
    $('voice-file').addEventListener('change', async () => {
      const f = $('voice-file').files[0];
      $('voice-file').value = '';
      if (!f) return;
      try {
        const n = await Snd.importVoice(f);
        Snd.reloadOwnerSounds();
        renderSettings();
        toast('Loaded ' + n + ' of your recordings — this device now plays your voice.');
      } catch (e) {
        toast('That file is not an SA Cassino sounds file.');
      }
    });
    $('confirm-toggle').addEventListener('click', () => {
      localStorage.setItem('sacassino.confirmMode', directMode() ? 'prompt' : 'direct');
      renderSettings(); Snd.click();
      toast(directMode()
        ? 'Direct moves: a complete selection plays at once.'
        : 'Prompt every move: Confirm is back.');
    });
    $('speed-select').addEventListener('change', () => localStorage.setItem('sacassino.aiSpeed', $('speed-select').value));
    $('btn-remove-ads').addEventListener('click', () => {
      if (Ads.removed) { toast('Ads are already removed on this device.'); return; }
      if (confirm('Mock purchase: remove all ads forever for $2.99?\n(Nothing is charged in this preview build.)')) {
        Ads.purchaseRemoveAds();
        renderSettings();
        toast('Ads removed. Thank you!');
      }
    });
    $('btn-reset-session').addEventListener('click', () => {
      session = freshSession(); saveSession(); refreshMenu(); toast('Session tally reset.');
    });
    window.addEventListener('resize', fitCards);
    /* the column's own box is the truth: a scrollbar appearing or vanishing,
       the pane resizing, rotation — all resize the column without firing the
       window event. Size the cards off the real box every time it changes. */
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => { if (g) { fitCards(); } });
      ro.observe($('screen-game'));
    }

    refreshMenu();

    /* automation/quick-check hooks: #auto2/#auto3/#auto4 jump into a game,
       #demo4 watches the AI play every seat, #tut2 opens the tutorial game.
       They fire on page load only — anything started from the menu is the
       player's own game. */
    const m = location.hash.match(/^#(auto|demo|tut)([234])$/);
    if (m) {
      session.mode = m[1] === 'tut' ? 'tutorial' : 'competitive';
      session.numPlayers = parseInt(m[2], 10);
      saveSession();
      newGame({ demo: m[1] === 'demo' });
    }

    /* the version marker (owner 2026-09-16): read from the LOADED assets
       themselves — a stale page shows a stale number, and we never again
       guess which build a phone is running */
    const vsrc = (document.querySelector('script[src*="js/ui.js?v="]') || {}).src || '';
    const vm = vsrc.match(/v=(\d+)/);
    const badge = document.createElement('div');
    badge.id = 'ver-badge';
    badge.textContent = 'v' + (vm ? vm[1] : '?');
    document.body.appendChild(badge);
  }

  root.UI = { init, toast };
})(typeof window !== 'undefined' ? window : globalThis);
