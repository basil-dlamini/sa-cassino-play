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
  function fitCards() {
    const n = R.DEAL[session.numPlayers].per;
    const col = $('screen-game');
    const availW = col.clientWidth - 24;
    if (session.numPlayers === 2) {
      const wDeep = Math.floor((col.clientWidth - 16) / (1 + 9 * 0.25));
      const wGrid = Math.floor((col.clientWidth - 16 - 15) / 4);
      const wH = Math.floor((col.clientHeight - 175) / (5 * 1.4));
      const w = Math.max(52, Math.min(104, Math.min(wDeep, wGrid, wH)));
      document.documentElement.style.setProperty('--card-w', w + 'px');
      if (g) renderHand();   // the fan's overlap follows the card size
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
  function cardEl(id, opts) {
    opts = opts || {};
    const c = C.parse(id);
    const el = document.createElement('div');
    el.className = 'card' + (c.suit === 'H' || c.suit === 'D' ? ' red' : '')
      + (opts.selected ? ' selected' : '')
      + (opts.highlight ? ' highlight' : '') + (opts.dim ? ' dim' : '');
    el.dataset.id = id;
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
        const cnt = document.createElement('span');
        cnt.className = 'pile-stats';
        cnt.textContent = b.cards.length + ' cards';
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
      /* no face-down fan (owner's ruling) — Sipho is his banner, his slots and
         his message zone; his card count follows from the turn sequence */
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
      /* Sipho's row: captured pile, build box, then the message zone —
         the mirror of mine (owner's ruling) */
      const theirs = document.createElement('div');
      theirs.className = 'area-row';
      theirs.appendChild(pileEl(1));
      {
        const slots = R.maxSlots(g);
        const owned = g.builds.filter((b) => b.owner === 1 && !b.scaffold);
        for (let i = 0; i < slots; i++) theirs.appendChild(buildZoneEl(1, owned[i] || null));
      }
      oppSide.appendChild(theirs);
      const ow = warnZone('opp-warn');
      ow.textContent = oppWarnText();
      oppSide.appendChild(ow);
    }
    // my areas: build box ABOVE the captured pile (opponents keep pile-above-build)
    const mine = document.createElement('div');
    mine.className = 'area-row';
    {
      const slots = R.maxSlots(g);
      const owned = g.builds.filter((b) => b.owner === HUMAN && !b.scaffold);
      for (let i = 0; i < slots; i++) mine.appendChild(buildZoneEl(HUMAN, owned[i] || null));
      mine.appendChild(pileEl(HUMAN));
    }
    if (g.numPlayers === 2) {
      /* my message zone comes first, then my slots — mirror of Sipho's row */
      mySide.appendChild(warnZone('my-warn'));
      mySide.appendChild(mine);
      return;
    }
    mine.classList.add('vertical', 'keep-bottom');
    mine.classList.toggle('active', isHumanTurn());
    mySide.appendChild(mine);
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
      if (sc.scaffold) live.add(sc.cards[sc.cards.length - 1]);   // scaffold anchors hold their slots
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
      /* 2/3 hands — rectangle grid, four columns wide (the mockup lock) */
      const cols = g.numPlayers === 3 || g.numPlayers === 2 ? 4 : 3;
      area.classList.toggle('cols-4', cols === 4);
      const minRows = g.numPlayers === 2 ? 2 : 3;
      const rows = Math.max(minRows, Math.floor((wrap.clientHeight - 8) / ch));
      /* cell floor: two full rows (8 cells) — the mockup's 4×2 discard area */
      const floor = g.numPlayers === 2 ? 8 : 9;
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
        el = cardEl(id, { highlight: involved || arrived });
        el.style.gridArea = s;
      } else {
        el = document.createElement('div');
        el.className = 'grid-cell';
        el.dataset.area = s;
        el.style.gridArea = s;
      }
      area.appendChild(el);
    }
    /* the scaffold: an UNREGISTERED stack standing in the discard area —
       the founding cards slid together, the base beneath them all. Tapping
       the stack selects it (for its capture, or its graduation by topping) */
    const scBuild = g.builds.find((b) => b.scaffold);
    if (scBuild) {
      const anchor = scBuild.cards[scBuild.cards.length - 1];
      if (!tableSlots[anchor]) tableSlots[anchor] = slots[0];
      const z = document.createElement('div');
      z.className = 'area-box build-box has-build scaffold';
      z.dataset.idx = g.builds.indexOf(scBuild);
      z.style.gridArea = tableSlots[anchor];
      const el = cardEl(anchor);
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
     shown. Dig, preg and combine-augment all read "Build (sum)". */
  function actionTitle(a) {
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
        const scaffs = humanActions.filter((a) => a.type === 'scaffold' &&
          a.victim === pileTopSel && sameCards(a.cards));
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

  function afterSelectionChange() {
    const m = matchesForSelection();
    const armed = selectedCard ? hasSideSelection() : (pileTopSel != null || tableSel.size > 0);
    pendingConfirm = (m.length && armed) ? { matches: m } : null;
    renderActionPanel();
    applySelClasses();
    /* a cardless combine that matched nothing: if the shape would otherwise
       be legal, the failing reason is the reservation law — say so */
    if (!m.length && !selectedCard && tableSel.size + (pileTopSel != null ? 1 : 0) >= 2) maybeReservedAlert();
  }

  function refreshAfterSelect() {
    renderHand();
    afterSelectionChange();
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
    openAlertDialog(held >= 2 ? 'Top or capture' : 'Capture',
      'Those table cards are reserved — you must capture or top the ' + value +
      ' before this turn can end. Fold other cards, or play your ' + value + '.');
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
    if (tableSel.has(id)) tableSel.delete(id); else tableSel.add(id);
    Snd.click();
    afterSelectionChange();
  }
  function toggleBuildSel(idx) {
    if (!isHumanTurn() || !turnArmed) return;
    buildSel = buildSel === idx ? null : idx;
    Snd.click();
    afterSelectionChange();
  }
  function togglePileSel(seat) {
    if (!isHumanTurn() || !turnArmed) return;
    pileTopSel = pileTopSel === seat ? null : seat;
    Snd.click();
    afterSelectionChange();
  }

  /* --- discard: tap an empty slot with a hand card selected --- */
  function tryDiscardTo(areaStr) {
    if (!isHumanTurn() || !turnArmed || !selectedCard || hasSideSelection()) return;
    const card = selectedCard;
    if (discardLegalFor(card)) {
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
      case 'scaffold': return 'Built from the table alone — capture it or top it before your turn ends.';
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
  function confirmAction(i) {
    if (!pendingConfirm || humanBusy) return;
    const a = pendingConfirm.matches[i];
    const area = pendingConfirm.discardArea;
    pendingConfirm = null;
    if (a.type === 'discard' && area) {
      tableSlots[a.card] = area;   // snap to the chosen slot
    }
    clearSelection();
    humanBusy = true;
    setTimeout(() => (humanBusy = false), 700);
    Snd.click();
    performAction(a, { human: true });
  }
  function cancelConfirm() {
    pendingConfirm = null;
    clearSelection();          // cancel always clears the selection
    Snd.click();
    render();
  }

  /* selection highlights on the board */
  function applySelClasses() {
    document.querySelectorAll('#table-cards .card').forEach((el) =>
      el.classList.toggle('sel-table', tableSel.has(el.dataset.id)));
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
    if (!g || g.phase === 'gameover') return;
    if (g.phase === 'shiya') {
      warn.textContent = g.players[g.shiyaPending.caller].name + ' — Shiya window…';
      return;
    }
    if (!isHumanTurn()) {
      /* his turn, his business: NOTHING of the opponent's reflects in my
         ribbon — it lights up only when the turn is mine (owner's ruling) */
      if (tutorialMode && coachMsg) warn.appendChild(warnLine('coach', coachMsg));
      return;
    }
    if (!turnArmed) return;   // the turn is not live yet — no controls appear
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
      return;
    }
    acts.appendChild(mkEndTurnBtn());
    const note = ruleNoteNow();
    if (note) warn.appendChild(warnLine('rule-note', note));
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
    shiyaTick = null; shiyaOfferValue = null; clearTimeout(shiyaTimer);
    show('screen-game');
    $('screen-game').classList.toggle('p2', n === 2);   // the two-hand layout
    fitCards();
    render();
    tick();
  }

  function tick() {
    if (!g) return;
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

  function performAction(a, opts) {
    opts = opts || {};
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
    if (a.type === 'capture') Snd.capture();
    else if (a.type === 'build' || a.type === 'augment' || a.type === 'preg') Snd.build();
    else if (a.type === 'dig' || a.type === 'topdig') Snd.steal();
    else if (a.type === 'discard') Snd.drift();
    if (a.type === 'capture' && g.phase !== 'gameover' && g.table.length === 0 && g.builds.length === 0) Snd.sweep();
    render();
    /* pairs: the partner just completed a build whose value the human holds —
       offer Shiya immediately */
    if (a.type === 'build' && g.numPlayers === 4 && a.owner === 2 && !opts.human && g.phase === 'play') {
      const v = a.value;
      if (g.players[HUMAN].hand.some((h) => C.rank(h) === v) &&
          document.querySelectorAll('.modal:not(.hidden)').length === 0) {
        setTimeout(() => openShiyaOffer(v), 450);
      }
    }
    setTimeout(tick, 200);
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
    $('btn-again').classList.toggle('hidden', g.numPlayers !== 2);    const verb = (res.winners.length > 1 || res.winners[0] === 'You' || res.winners[0].indexOf('&') >= 0) ? ' win!' : ' wins!';
    let html = res.tie
      ? '<div class="results-banner tie">It&rsquo;s a tie — ' + escapeHtml(res.winners.join(' and ')) + ' share it!</div>'
      : '<div class="results-banner win">' + escapeHtml(res.winners[0]) + verb + '</div>';
    html += '<table class="results-table"><tr><th></th><th>Cards</th><th>♠</th><th>2♠</th><th>10♦</th><th>Aces</th><th>Most cards</th><th>Most ♠</th><th>Total</th></tr>';
    for (const t of res.stats) {
      html += '<tr><td class="name">' + escapeHtml(t.name) + '</td><td>' + t.cards + '</td><td>' + t.spades +
        '</td><td>' + t.s2 + '</td><td>' + t.d10 + '</td><td>' + t.aces + '</td><td>' +
        (t.mostCards ? '+2' : '—') + '</td><td>' + (t.mostSpades ? '+2' : '—') +
        '</td><td class="total">' + t.total + '</td></tr>';
    }
    html += '</table><div class="results-note">' + res.totalInPlay + ' points were in play' +
      (res.teamMode ? ' (pairs scoring).' : ' (singles scoring).') + '</div>';
    html += '<div class="results-tally">Session: ' + escapeHtml(sessionTallyText()) + '</div>';
    box.innerHTML = html;
    $('modal-results').classList.remove('hidden');
    const youWon = res.stats.some((t) => t.members.includes(HUMAN) && res.winners.includes(t.name));
    if (youWon) Snd.win(); else Snd.lose();
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
    $('speed-select').value = localStorage.getItem('sacassino.aiSpeed') || '900';
    $('btn-remove-ads').textContent = Ads.removed ? '✓ Ads removed — thank you!' : 'Remove ads — $2.99 (one-time)';
    $('btn-remove-ads').disabled = Ads.removed;
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
        if (tutorialMode) toast('You already used your hand card this turn — dig or end the turn.');
        return;
      }
      if (el.dataset.id === selectedCard) {   // tap the selected card again → deselect
        clearSelection();
        pendingConfirm = null;
        Snd.click();
        render();
        return;
      }
      selectedCard = el.dataset.id;   // the move starts with a hand card
      tableSel = new Set(); buildSel = null; pileTopSel = null;
      Snd.click();
      refreshAfterSelect();
    });

    /* the board itself is tappable: table cards, builds, pile tops, empty slots */
    $('table-cards').addEventListener('click', (e) => {
      const cell = e.target.closest('.grid-cell');
      if (cell) { tryDiscardTo(cell.dataset.area); return; }
      const el = e.target.closest('.card');
      /* a scaffold stack's face is the STACK, not a loose card — toggling it
         into the table selection poisoned the capture match and froze the game */
      if (el && !el.closest('.build-box')) toggleTableSel(el.dataset.id);
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
  }

  root.UI = { init, toast };
})(typeof window !== 'undefined' ? window : globalThis);
