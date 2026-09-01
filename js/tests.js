/* tests.js — automated rules tests for engine v3 (runs in the browser).
   Every settled house rule gets a dedicated test; the fuzz harness plays
   hundreds of full games with random LEGAL moves, checking after every
   action:
     - card conservation (all 40 cards always accounted for)
     - every live build's owner holds a card of its value (never stranded,
       and the owner can always answer the two-build force)
     - no two live builds share a value
     - cards matching a live build value are never discarded
     - a partner's build is never captured by their own partner (4 hands)
     - at most ONE hand-card move per turn; End Turn only after it
     - pile-top digs: own-side builds, opponents' piles, matching value
     - owning two builds forces a capture of at least one before End Turn
     - games always terminate and score sanely */
(function (root) {
  const C = root.Cards, R = root.Rules;

  const results = [];
  let current = null;
  function test(name, fn) {
    current = { name, pass: true, error: null };
    try { fn(); } catch (e) {
      current.pass = false;
      current.error = e.message + '  [[' + ((e.stack || '').split('\n')[1] || '').trim() + ']]';
    }
    results.push(current);
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  function eq(a, b, msg) {
    if (a !== b) throw new Error((msg || 'eq') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
  }

  function mkState(n, opts) {
    opts = opts || {};
    const players = [];
    for (let i = 0; i < n; i++) {
      players.push({ id: i, name: 'P' + i, isHuman: false, personality: 'naledi', hand: [], pile: [], virtual: {} });
    }
    return {
      numPlayers: n,
      partnership: n === 2 || n === 4,
      players, dealer: 0, turn: opts.turn || 0,
      turnUsed: false, openedCardless: false, resolved: false, capturedThisTurn: false,
      stock: [], table: opts.table || [],
      builds: opts.builds || [],
      lastCapturer: null,
      phase: 'play', pending: null, shiyaPending: null,
      wave: opts.wave || 1,
      log: [], rng: R.mulberry32(opts.seed || 42), actionCount: 0
    };
  }
  const has = (acts, pred) => acts.some(pred);
  const ofType = (acts, t) => acts.filter((a) => a.type === t);

  /* ================= deck & dealing ================= */
  test('deck has exactly 40 cards (no J/Q/K)', () => {
    const d = C.makeDeck();
    eq(d.length, 40);
    for (const id of d) assert(C.rank(id) >= 1 && C.rank(id) <= 10, 'rank out of range');
  });
  test('dealing: 2p 10/10+20 stock · 3p 13×3+1 table · 4p 10×4', () => {
    const g2 = R.createGame({ numPlayers: 2, players: [{ name: 'A' }, { name: 'B' }], seed: 1, dealer: 0 });
    eq(g2.players[0].hand.length, 10); eq(g2.stock.length, 20);
    const g3 = R.createGame({ numPlayers: 3, players: [{}, {}, {}], seed: 1, dealer: 0 });
    g3.players.forEach((p) => eq(p.hand.length, 13)); eq(g3.table.length, 1); eq(g3.stock.length, 0);
    const g4 = R.createGame({ numPlayers: 4, players: [{}, {}, {}, {}], seed: 1, dealer: 0 });
    g4.players.forEach((p) => eq(p.hand.length, 10));
  });

  /* ================= discarding & the build-value ban ================= */
  test('a discard is refused while its twin lies on the table — the capture is the way out', () => {
    const g = mkState(2, { table: ['C4'] });
    g.players[0].hand = ['S4', 'H7'];
    const acts = R.legalActions(g);
    assert(has(acts, (a) => a.type === 'capture' && a.card === 'S4'), 'capture of the twin offered');
    assert(!has(acts, (a) => a.type === 'discard' && a.card === 'S4'), 'discarding the twin refused');
    assert(has(acts, (a) => a.type === 'discard' && a.card === 'H7'), 'other discards fine');
  });

  /* ================= the base rule ================= */
  test('BASE: building 9 from 7+2 swallows the loose table 9 as the foundation', () => {
    const g = mkState(2, { table: ['H2', 'C9'] });
    g.players[0].hand = ['D7', 'D9'];
    g.players[1].hand = ['C2'];
    const b = R.legalActions(g).find((a) => a.type === 'build' && a.value === 9 && a.card === 'D7');
    assert(b, 'build 9 from 7+2 offered');
    R.applyAction(g, b);
    eq(g.builds[0].cards.join(), 'C9,D7,H2', 'the 9 sits at the bottom as the base');
    eq(g.table.length, 0, 'nothing loose remains');
  });

  test('BASE: a scaffold absorbs the loose base too, and preg pulls one under', () => {
    // scaffold [7,2] with a loose 9 present
    const g = mkState(2, { table: ['H7', 'S2', 'C9'] });
    g.players[0].hand = ['D9'];
    g.players[1].hand = ['C2'];
    const sc = R.legalActions(g).find((a) => a.type === 'scaffold' && a.cards.length === 2);
    assert(sc, 'scaffold 7+2 offered');
    R.applyAction(g, sc);
    eq(g.builds[0].cards.join(), 'C9,H7,S2', 'base 9 beneath the founding set');
    // preg: a HAND CARD ALONE raises the ENEMY 6-build to 8 (6+2), an 8 lies loose
    const g2 = mkState(2, { table: ['C8'] });
    g2.builds = [{ value: 6, cards: ['H4', 'S2'], owner: 1, augmented: false }];
    g2.players[0].hand = ['D2', 'D8'];
    g2.players[1].hand = ['C3'];
    const pg = R.legalActions(g2).find((a) => a.type === 'preg' && a.value === 8);
    assert(pg, 'preg 6→8 offered (enemy build, hand card alone)');
    R.applyAction(g2, pg);
    eq(g2.builds[0].value, 8, 'raised');
    eq(g2.builds[0].owner, 0, 'now the pregger\u2019s');
    assert(g2.builds[0].cards.includes('C8'), 'the loose 8 joined');
    eq(g2.builds[0].cards[0], 'C8', 'at the very bottom, as the base');
    // own-side preg is NEVER offered — the law binds every player equally
    const g3 = mkState(2, { table: ['C8'] });
    g3.builds = [{ value: 6, cards: ['H4', 'S2'], owner: 0, augmented: false }];
    g3.players[0].hand = ['D2', 'D8'];
    assert(!has(R.legalActions(g3), (a) => a.type === 'preg'), 'you cannot preg your own build');
  });

  test('BASE (Shiya exception): a Shiya build does NOT absorb a loose base', () => {
    const g = mkState(4, { table: ['C9', 'C3', 'H6'] });
    g.players[0].hand = ['D9'];       // I hold a 9 → I can call Shiya
    g.players[2].hand = ['S9'];
    g.players[1].hand = ['C2'];
    g.players[3].hand = ['H2'];
    g.turn = 2;                        // my partner plays
    R.applyAction(g, R.legalActions(g).find((a) => a.type === 'capture' && a.card === 'S9' && a.loose.length === 2));
    eq(g.phase, 'shiya', 'shiya window opens');
    R.applyAction(g, { type: 'shiya' });
    eq(g.builds[0].value, 9, 'the Shiya build exists');
    assert(g.table.includes('C9'), 'the loose 9 REMAINS on the table — Shiya takes no base');
  });
  test('while a build is live, NOBODY may discard a card of its value', () => {
    const g = mkState(2, { table: ['C3'] });
    g.builds = [{ value: 4, cards: ['H2', 'S2'], owner: 0, augmented: false }];
    g.players[0].hand = ['C4', 'H7'];   // owner
    g.players[1].hand = ['D4', 'H9'];   // opponent
    const a0 = R.legalActions(g);
    assert(!has(a0, (a) => a.type === 'discard' && a.card === 'C4'), 'owner discarded the value');
    g.turn = 1;
    const a1 = R.legalActions(g);
    assert(!has(a1, (a) => a.type === 'discard' && a.card === 'D4'), 'opponent discarded the value');
    assert(has(a1, (a) => a.type === 'discard' && a.card === 'H9'), 'other discards fine');
    // once the build is gone, the 4 is discardable again
    g.builds = [];
    assert(has(R.legalActions(g), (a) => a.type === 'discard' && a.card === 'D4'), 'freed after build gone');
  });
  test('two-hand round one: a player with a live build cannot discard ANYTHING', () => {
    const g = mkState(2, { table: ['C5'] });
    g.builds = [{ value: 6, cards: ['H3', 'S3'], owner: 0, augmented: false }];
    g.players[0].hand = ['H7', 'H9'];
    const acts = R.legalActions(g);
    eq(ofType(acts, 'discard').length, 0, 'round-1 builder must not discard');
    g.wave = 2; // second round lifts the lock
    assert(R.legalActions(g).some((a) => a.type === 'discard'), 'round-2 discards allowed');
  });

  /* ================= owner / opponent card-use restrictions ================= */
  test('opponent holding the build value may ONLY capture the build with it', () => {
    const g = mkState(2, { table: ['C3', 'H5'] });
    g.builds = [{ value: 8, cards: ['H3', 'S5'], owner: 0, augmented: false }];
    g.players[1].hand = ['D8', 'H9'];
    g.turn = 1;
    const acts = R.legalActions(g).filter((a) => a.card === 'D8');
    assert(acts.length > 0, 'some use of the 8 must exist');
    assert(acts.every((a) => a.type === 'capture' && a.buildIds.length === 1), 'only capturing the build');
    assert(!has(R.legalActions(g), (a) => a.type === 'discard' && a.card === 'D8'), 'no discard');
  });
  test("owner's LAST matching card is reserved: it may only capture that build", () => {
    const g = mkState(2, { table: ['C3', 'H5'] });
    g.builds = [{ value: 8, cards: ['H3', 'S5'], owner: 0, augmented: false }];
    g.players[0].hand = ['D8'];              // single matching card
    const acts = R.legalActions(g);
    const uses8 = acts.filter((a) => a.card === 'D8');
    eq(uses8.length, 1, 'exactly one use of the lone 8');
    eq(uses8[0].type, 'capture');
    eq(uses8[0].buildIds.length, 1, 'and it captures the build');
    // with a second 8 held, other uses open up (capturing 3+5)
    g.players[0].hand = ['D8', 'C8'];
    const acts2 = R.legalActions(g);
    assert(has(acts2, (a) => a.type === 'capture' && a.card === 'D8' && !a.buildIds.length && a.loose.length === 2),
      'loose capture allowed while holding another 8');
  });

  /* ================= augment: top / combine / dig ================= */
  test("topping: partner may top without another matching card; owner needs one; opponent can't top", () => {
    const g = mkState(4, { table: ['C2'] });
    g.builds = [{ value: 6, cards: ['H4', 'S2'], owner: 0, augmented: false }];
    // partner (seat 2) with a lone 6 tops freely
    g.players[2].hand = ['D6'];
    g.turn = 2;
    assert(has(R.legalActions(g), (a) => a.type === 'augment' && a.method === 'top' && a.card === 'D6'),
      'partner top allowed');
    // owner (seat 0) with a lone 6 may NOT top (needs another 6 to capture later)
    g.players[0].hand = ['D6'];
    g.turn = 0;
    assert(!has(R.legalActions(g), (a) => a.type === 'augment' && a.card === 'D6'),
      'owner top without backup blocked');
    g.players[0].hand = ['D6', 'C6'];
    assert(has(R.legalActions(g), (a) => a.type === 'augment' && a.card === 'D6'), 'owner top with backup ok');
    // opponent (seat 1) can never top
    g.players[1].hand = ['D6', 'C6'];
    g.turn = 1;
    assert(!has(R.legalActions(g), (a) => a.type === 'augment'), 'opponent cannot augment');
  });
  test("combine augment: hand 5 + table Ace joins the 6-build (owner's example)", () => {
    const g = mkState(4, { table: ['D1', 'C9'] });
    g.builds = [{ value: 6, cards: ['H4', 'S2'], owner: 0, augmented: false }];
    g.players[2].hand = ['H5'];   // partner augments with 5 + Ace = 6
    g.players[1].hand = ['H9'];   // someone still holds a card so the game continues
    g.turn = 2;
    const acts = R.legalActions(g);
    const aug = acts.find((a) => a.type === 'augment' && a.method === 'combine' && a.card === 'H5');
    assert(aug, 'combine augment offered');
    eq(aug.loose.join(), 'D1');
    R.applyAction(g, aug);
    const b = g.builds[0];
    eq(b.value, 6, 'value unchanged');
    assert(b.cards.includes('H5') && b.cards.includes('D1'), 'cards joined the build');
    eq(b.augmented, true, 'build locked after augment');
  });
  test('dig: hand 3 + opponent pile-top 3 = 6 into the 6-build; never from a partner', () => {
    const g = mkState(4, { table: [] });
    g.builds = [{ value: 6, cards: ['H4', 'S2'], owner: 0, augmented: false }];
    g.players[3].pile = ['D9', 'C3'];  // opponent team (seat 3), top = 3
    g.players[2].pile = ['H3'];        // partner pile top also 3 — must be ignored
    g.players[2].hand = ['S3'];        // partner digs with a 3
    g.players[1].hand = ['H9'];        // keep the game alive after the action
    g.turn = 2;
    const digs = R.legalActions(g).filter((a) => a.type === 'dig');
    eq(digs.length, 1, 'exactly one dig target');
    eq(digs[0].victim, 3, 'digs the opponent, never the partner');
    R.applyAction(g, digs[0]);
    const b = g.builds[0];
    assert(b.cards.includes('S3') && b.cards.includes('C3'), 'both cards in the build');
    eq(g.players[3].pile.length, 1, 'opponent pile lost its top card');
  });

  /* ================= preg ================= */
  test('preg raises value, requires holding it, and is refused after augment', () => {
    const g = mkState(2, { table: [] });
    g.builds = [{ value: 6, cards: ['H4', 'S2'], owner: 0, augmented: false }];
    g.players[1].hand = ['D8', 'S2', 'H9'];
    g.turn = 1;
    const preg = R.legalActions(g).find((a) => a.type === 'preg' && a.value === 8 && a.card === 'S2');
    assert(preg, 'preg 6→8 offered (plays the 2, holds the 8)');
    R.applyAction(g, preg);
    eq(g.builds[0].value, 8, 'value raised');
    eq(g.builds[0].owner, 1, 'enemy preg takes ownership');
    // now top it (owner needs a second 8 in hand to top), then preg must be impossible
    g.players[1].hand = ['C8', 'D8'];
    g.turn = 1; g.turnUsed = false;
    const top = R.legalActions(g).find((a) => a.type === 'augment' && a.method === 'top' && a.card === 'C8');
    assert(top, 'owner can top own build while holding a backup 8');
    R.applyAction(g, top);
    g.players[1].hand = ['H10'];
    g.turn = 1; g.turnUsed = false;
    assert(!has(R.legalActions(g), (a) => a.type === 'preg'), 'no preg after augment');
  });
  test('enemy preg is refused while you already own a build (2 own builds only via Shiya)', () => {
    const g = mkState(4, { table: ['C2'] });
    g.builds = [
      { value: 5, cards: ['H2', 'S3'], owner: 0, augmented: false },
      { value: 6, cards: ['H4', 'S2'], owner: 1, augmented: false }
    ];
    g.players[0].hand = ['D8', 'C8'];  // could preg the enemy 6 to 8… but owns the 5
    g.turn = 0;
    assert(!has(R.legalActions(g), (a) => a.type === 'preg'), 'own-build owner cannot preg an enemy build');
  });

  /* ================= the v6 table law (as taught by the owner) ================= */
  test('v6 CAPTURE: a build NEVER joins a sum — only its exact value takes it', () => {
    // the owner's original report, now law: topped 7-build + loose 3 vs a 10
    const g = mkState(2, { table: ['H3'] });
    g.builds = [{ value: 7, cards: ['S7', 'H4', 'C3'], owner: 0, augmented: true }];
    g.players[0].hand = ['D2'];
    g.players[1].hand = ['D10', 'C2'];
    g.turn = 1;
    assert(!has(R.legalActions(g), (a) => a.type === 'capture' && a.card === 'D10'),
      'the 10 may not take the 7-build + 3 — builds never enter a sum');
    // a held 7 takes the build alone — never the loose 3 with it
    g.players[1].hand = ['D7', 'C2'];
    const cap = R.legalActions(g).find((a) => a.type === 'capture' && a.card === 'D7');
    assert(cap, 'the exact 7 captures the build');
    eq(cap.buildIds.length, 1, 'the build alone');
    eq(cap.loose.length, 0, 'no floor cards swept along');
    R.applyAction(g, cap);
    assert(g.table.includes('H3'), 'the loose 3 stays on the table');
  });

  test('v6 CAPTURE: floor cards fall ONE SET per capture — never two sets at once', () => {
    const g = mkState(2, { table: ['H2', 'H5', 'C3', 'C4'] });
    g.players[0].hand = ['D7'];
    g.players[1].hand = ['C9'];
    const caps = R.legalActions(g).filter((a) => a.type === 'capture' && a.card === 'D7');
    assert(caps.some((a) => a.loose.length === 2 && a.loose.includes('H2') && a.loose.includes('H5')), '2+5 offered');
    assert(caps.some((a) => a.loose.length === 2 && a.loose.includes('C3') && a.loose.includes('C4')), '3+4 offered');
    assert(!caps.some((a) => a.loose.length === 4), 'all four in ONE capture — never two sets at once');
    caps.forEach((a) => eq(a.loose.reduce((n, id) => n + C.rank(id), 0), 7, 'set sums to the card'));
  });

  test('v6 PREG: a HAND CARD ALONE — floor and pile cards never join', () => {
    const g = mkState(2, { table: ['C2'] });
    g.builds = [{ value: 6, cards: ['H4', 'S2'], owner: 1, augmented: false }];
    g.players[0].hand = ['D2', 'D8', 'H9'];
    const pregs = R.legalActions(g).filter((a) => a.type === 'preg');
    assert(pregs.length > 0, 'preg offered (the held 2 raises 6 to 8)');
    pregs.forEach((a) => eq((a.loose || []).length, 0, 'no floor cards in a preg'));
    assert(pregs.every((a) => a.value === 8), 'landing = target + hand card only');
  });

  test('v6 PREG landings: merge into own side, partner merge, virtual restart, silence on enemy-live', () => {
    // B: landing on MY OWN live 7 folds the enemy 6 into it and locks it
    const g = mkState(2);
    g.builds = [
      { value: 6, cards: ['H4', 'S2'], owner: 1, augmented: false },
      { value: 7, cards: ['H3', 'S4'], owner: 0, augmented: false }
    ];
    g.players[0].hand = ['S1', 'H9'];           // the ace raises 6 to 7 — my own live value
    g.players[1].hand = ['C9'];
    const m = R.legalActions(g).find((a) => a.type === 'preg' && a.value === 7);
    assert(m && m.mergeInto != null, 'the merge is offered');
    R.applyAction(g, m);
    eq(g.builds.length, 1, 'the 6 is gone — one build stands');
    eq(g.builds[0].value, 7, 'the 7 survived');
    eq(g.builds[0].owner, 0, 'still mine');
    eq(g.builds[0].augmented, true, 'the merge locked it');
    assert(g.builds[0].cards.includes('H4') && g.builds[0].cards.includes('S1'),
      'absorbed the enemy cards and the ace');

    // E: the landing value live on the ENEMY side — the game offers NOTHING
    const g2 = mkState(4);
    g2.builds = [
      { value: 6, cards: ['H4', 'S2'], owner: 1, augmented: false },   // enemy target
      { value: 7, cards: ['H3', 'S4'], owner: 3, augmented: false }    // enemy-live 7
    ];
    g2.players[0].hand = ['S1', 'H9'];
    g2.turn = 0;
    assert(!has(R.legalActions(g2), (a) => a.type === 'preg' && a.value === 7),
      'silence: no preg onto an enemy-live value');

    // C: landing on the PARTNER's live 7 folds into his build
    const g3 = mkState(4);
    g3.builds = [
      { value: 6, cards: ['H4', 'S2'], owner: 1, augmented: false },
      { value: 7, cards: ['H3', 'S4'], owner: 2, augmented: false }
    ];
    g3.players[0].hand = ['S1', 'H9'];
    g3.turn = 0;
    const c = R.legalActions(g3).find((a) => a.type === 'preg' && a.value === 7);
    assert(c && c.mergeInto != null, 'partner merge offered');
    R.applyAction(g3, c);
    eq(g3.builds.length, 1, 'merged into the partner\u2019s 7');
    eq(g3.builds[0].owner, 2, 'the partner\u2019s build');

    // D: partner VIRTUAL restart — his earlier 7 returns as HIS virgin build
    const g4 = mkState(4);
    g4.builds = [{ value: 6, cards: ['H4', 'S2'], owner: 1, augmented: false }];
    g4.players[2].virtual[7] = true;            // partner virtually owns 7
    g4.players[0].hand = ['S1', 'H9'];
    g4.turn = 0;
    const d = R.legalActions(g4).find((a) => a.type === 'preg' && a.value === 7);
    assert(d && d.owner === 2, 'restart registered to the partner');
    R.applyAction(g4, d);
    eq(g4.builds[0].owner, 2, 'his build');
    eq(g4.builds[0].value, 7, 'his value');
    eq(g4.builds[0].augmented, false, 'virgin — preggable again');
  });

  test('v6 REGISTRATION: one build per player in 2 hands — no scaffold, no second build', () => {
    const g = mkState(2, { table: ['C3', 'H4'] });
    g.builds = [{ value: 8, cards: ['H3', 'S5'], owner: 0, augmented: false }];
    g.players[0].hand = ['D7', 'C7'];
    assert(!has(R.legalActions(g), (a) => a.type === 'scaffold'), 'no scaffolding while owning a build');
    assert(!has(R.legalActions(g), (a) => a.type === 'build'), 'no second self-made build');
  });

  test('v6 SHIYA: a caller holding two builds gets no window — three is impossible', () => {
    const g = mkState(4, { table: ['H6'] });
    g.builds = [
      { value: 5, cards: ['H2', 'S3'], owner: 0, augmented: false },
      { value: 9, cards: ['C3', 'S6'], owner: 0, augmented: false }
    ];
    g.players[0].hand = ['D6'];        // the would-be caller holds the 6
    g.players[2].hand = ['S6', 'H9'];  // partner captures with the 6
    g.turn = 2;
    R.applyAction(g, R.legalActions(g).find((a) => a.type === 'capture' && a.card === 'S6'));
    assert(g.phase === 'play', 'no Shiya window for a caller already holding two');
  });

  /* ================= captures incl. builds & partner rule ================= */
  test('in 4 hands you cannot capture your own partner\'s build', () => {
    const g = mkState(4, { table: [] });
    g.builds = [{ value: 7, cards: ['H3', 'S4'], owner: 2, augmented: false }]; // partner of seat 0
    g.players[0].hand = ['D7'];
    g.turn = 0;
    const caps = R.legalActions(g).filter((a) => a.type === 'capture' && a.card === 'D7');
    eq(caps.length, 0, 'partner build not capturable');
    // but the enemy (seat 1) can capture it
    g.players[1].hand = ['D7'];
    g.turn = 1;
    assert(has(R.legalActions(g), (a) => a.type === 'capture' && a.card === 'D7' && a.buildIds.length === 1),
      'enemy capture allowed');
  });
  test('two-build force: owning two builds, your only actions capture at least one of them', () => {
    const g = mkState(4, { table: ['C2'] });
    g.builds = [
      { value: 5, cards: ['H2', 'S3'], owner: 0, augmented: false },
      { value: 7, cards: ['H3', 'S4'], owner: 0, augmented: false }
    ];
    g.players[0].hand = ['D5', 'C7', 'H9'];
    g.turn = 0;
    const acts = R.legalActions(g);
    assert(acts.length > 0, 'forced capture available');
    assert(acts.every((a) => a.type === 'capture' &&
      a.buildIds.some((i) => g.builds[i].owner === 0)), 'all actions capture an own build');
    assert(acts.some((a) => a.card === 'D5'), 'can take the 5-build');
    assert(acts.some((a) => a.card === 'C7'), 'can take the 7-build');
    R.applyAction(g, acts.find((a) => a.card === 'D5'));
    eq(g.builds.length, 1, 'one build remains');
  });

  /* ================= Shiya ================= */
  test('SHIYA: partner converts a capture into an augmented build they own', () => {
    const g = mkState(4, { table: ['C3', 'H5'] });
    g.players[0].hand = ['S8'];      // I capture 3+5 with the 8
    g.players[2].hand = ['D8'];      // partner holds an 8 → can call Shiya
    g.turn = 0;
    R.applyAction(g, R.legalActions(g).find((a) => a.type === 'capture' && a.card === 'S8'));
    eq(g.phase, 'shiya', 'shiya window opens');
    eq(g.shiyaPending.caller, 2);
    R.applyAction(g, { type: 'shiya' });
    eq(g.phase, 'play');
    eq(g.players[0].pile.length, 0, 'capture undone');
    eq(g.builds.length, 1, 'build created');
    const b = g.builds[0];
    eq(b.value, 8); eq(b.owner, 2); eq(b.augmented, true);
    assert(b.cards.includes('S8') && b.cards.includes('C3') && b.cards.includes('H5'), 'all cards in the build');
  });
  test('no Shiya window when the partner lacks the value or has two builds', () => {
    const g = mkState(4, { table: ['C3'] });
    g.players[0].hand = ['S3'];
    g.players[2].hand = ['D5'];      // partner has no 3
    g.turn = 0;
    R.applyAction(g, R.legalActions(g).find((a) => a.type === 'capture' && a.card === 'S3'));
    assert(g.phase !== 'shiya', 'window must not open');
    // partner with two builds
    const g2 = mkState(4, { table: ['C3'] });
    g2.builds = [
      { value: 5, cards: ['H2', 'S3'], owner: 2, augmented: false },
      { value: 9, cards: ['H4', 'S5'], owner: 2, augmented: false }
    ];
    g2.players[0].hand = ['S3'];
    g2.players[2].hand = ['D3'];
    g2.turn = 0;
    R.applyAction(g2, R.legalActions(g2).find((a) => a.type === 'capture' && a.card === 'S3'));
    assert(g2.phase !== 'shiya', 'caller with two builds cannot Shiya');
  });

  /* ================= virtual ownership ================= */
  test('partner can build FOR the virtual owner without holding the value', () => {
    const g = mkState(4, { table: ['C5'] });
    g.players[0].virtual[8] = true;    // I virtually own 8 (from an earlier 8-build)
    g.players[0].hand = ['H8', 'D8'];  // …and of course I still hold 8s
    g.players[2].hand = ['S3'];        // partner holds no 8 at all
    g.players[1].hand = ['H9'];
    g.turn = 2;
    const b = R.legalActions(g).find((a) => a.type === 'build' && a.value === 8 && a.card === 'S3');
    assert(b, 'build 8 for me offered without partner holding an 8');
    eq(b.owner, 0, 'attributed to the virtual owner');
    R.applyAction(g, b);
    eq(g.builds[0].owner, 0);
    // spending one 8 (while holding another) is legal and ends virtual 8
    g.turn = 0; g.turnUsed = false;
    const acts = R.legalActions(g);
    R.applyAction(g, acts.find((a) => a.type === 'discard' && a.card === 'H8') || acts[0]);
    eq(g.players[0].virtual[8], undefined, 'playing an 8 ends virtual ownership of 8');
  });
  test('different-valued builds can coexist; equal-valued cannot', () => {
    const g = mkState(4, { table: ['C4'] });
    g.builds = [{ value: 5, cards: ['H2', 'S3'], owner: 0, augmented: false }];
    g.players[1].hand = ['H2', 'D6'];
    g.turn = 1;
    const acts = R.legalActions(g);
    assert(!has(acts, (a) => a.type === 'build' && a.value === 5), 'duplicate value blocked');
    assert(has(acts, (a) => a.type === 'build' && a.value === 6 && a.card === 'H2'), 'new value fine');
  });

  /* ================= multi-move turns (v3) ================= */
  test('multi-move turn: one hand card + free pile-top digs + End Turn gate', () => {
    const g = mkState(2, { table: [] });
    g.builds = [{ value: 10, cards: ['H7', 'S3'], owner: 0, augmented: false }];
    g.players[0].hand = ['D10', 'H5'];    // owner holds the 10 (capture card)
    g.players[1].hand = ['C9'];
    g.players[1].pile = ['H8', 'C10'];    // Sipho's pile top is a 10 — diggable
    // fresh turn: no End Turn yet
    assert(!has(R.legalActions(g), (a) => a.type === 'endturn'), 'endturn before the hand card');
    // the pile-top dig is offered without any hand card
    const td = R.legalActions(g).find((a) => a.type === 'topdig');
    assert(td, 'pile-top dig offered');
    eq(td.victim, 1); eq(td.buildIdx, 0);
    R.applyAction(g, td);
    eq(g.players[1].pile.length, 1, 'pile top taken');
    assert(g.builds[0].cards.includes('C10'), 'dug card joined the build');
    eq(g.builds[0].augmented, true, 'build locked');
    eq(g.turn, 0, 'turn continues after the dig');
    eq(g.turnUsed, false, 'dig spends no hand card');
    // a dig alone still cannot end the turn
    assert(!has(R.legalActions(g), (a) => a.type === 'endturn'), 'still no endturn');
    // now spend the hand card — round one with a live build forbids discard,
    // so capture the 10-build with the 10 from hand
    const cap = R.legalActions(g).find((a) => a.type === 'capture' && a.card === 'D10' && a.buildIds.length === 1);
    assert(cap, 'capture of the own build offered');
    R.applyAction(g, cap);
    eq(g.turnUsed, true, 'hand card spent');
    eq(g.turn, 0, 'turn still mine after the move');
    eq(g.builds.length, 0, 'build captured');
    assert(!has(R.legalActions(g), (a) => a.card), 'no second hand-card move');
    assert(has(R.legalActions(g), (a) => a.type === 'endturn'), 'endturn now offered');
    R.applyAction(g, { type: 'endturn' });
    eq(g.turn, 1, 'turn passes on End Turn');
    eq(g.turnUsed, false, 'fresh turn for the next player');
  });

  /* ================= scaffolds & the resolution law (v4) ================= */
  test('SCENARIO A (v6 law): scaffold 7+A — the stack takes NO additions; capture ends it', () => {
    const g = mkState(2, { table: ['H7', 'S1'] });
    g.players[0].hand = ['D8', 'H5'];
    g.players[1].hand = ['C9'];
    g.players[1].pile = ['H9', 'C8'];       // Sipho's top: 8♣
    // fresh turn: the cardless scaffold is offered (8 held)
    const sc = R.legalActions(g).find((a) => a.type === 'scaffold' && a.value === 8);
    assert(sc, 'scaffold 8 from 7+A offered');
    eq(sc.cards.slice().sort().join(), ['H7', 'S1'].join(), 'combines the 7 and the Ace');
    R.applyAction(g, sc);
    eq(g.builds.length, 1);
    eq(g.builds[0].scaffold, true, 'marked as a scaffold');
    eq(g.openedCardless, true, 'opened cardless');
    eq(g.turnUsed, false, 'no hand card spent');
    assert(!has(R.legalActions(g), (a) => a.type === 'endturn'), 'no end turn with scaffold live');
    // hand is LOCKED: only capture/graduation of the scaffold — not the 5
    const acts = R.legalActions(g);
    assert(!acts.some((a) => a.card === 'H5'), 'other hand cards locked');
    // the stack is unregistered: it takes NO additions — not even Sipho's 8♣
    assert(!acts.some((a) => a.type === 'topdig'), 'no dig into a scaffold');
    assert(!acts.some((a) => a.type === 'caugment' || a.type === 'efold'), 'no folds into a scaffold');
    // capture the scaffold with the held 8 — the whole stack, one set
    const cap = acts.find((a) => a.type === 'capture' && a.card === 'D8');
    assert(cap && cap.scaffoldCap, 'capture of the scaffold offered');
    R.applyAction(g, cap);
    eq(g.builds.length, 0, 'scaffold captured (gone)');
    eq(g.players[0].pile.length, 3, '7, A — and the played 8 on top');
    eq(g.resolved, true, 'capture settled the cardless debt');
    eq(g.players[1].pile.length, 2, 'Sipho\u2019s pile untouched — the dig is gone from the law');
    assert(has(R.legalActions(g), (a) => a.type === 'endturn'), 'end turn now offered');
    R.applyAction(g, { type: 'endturn' });
    eq(g.turn, 1, 'turn passes');
  });

  test('SCENARIO A-variant: two 8s in hand — the scaffold may be TOPPED into a live build', () => {
    const g = mkState(2, { table: ['H7', 'S1'] });
    g.players[0].hand = ['D8', 'C8'];
    g.players[1].hand = ['H9'];
    const sc = R.legalActions(g).find((a) => a.type === 'scaffold' && a.value === 8);
    R.applyAction(g, sc);
    const top = R.legalActions(g).find((a) => a.type === 'augment' && a.method === 'top');
    assert(top, 'top offered with a spare 8 held');
    R.applyAction(g, top);
    eq(g.builds[0].scaffold, false, 'no longer a scaffold');
    eq(g.builds[0].augmented, true, 'live and locked');
    eq(g.resolved, true, 'the top settled the debt');
    assert(has(R.legalActions(g), (a) => a.type === 'endturn'), 'end turn offered after topping');
    eq(g.builds[0].owner, 0, 'mine to capture later');
  });

  test('SCENARIO B (revised): his pile-top 8 lands on the loose base 8 — a two-card build', () => {
    const g = mkState(2, { table: ['S8', 'H4'] });
    g.players[0].hand = ['D8'];
    g.players[1].hand = ['H9'];
    g.players[1].pile = ['H6', 'C8'];      // Sipho's top: 8♣
    // the lone base is NOT a build by itself
    assert(!has(R.legalActions(g), (a) => a.type === 'scaffold' && a.victim == null),
      'no single-card scaffold from the lone 8');
    const sc = R.legalActions(g).find((a) => a.type === 'scaffold' && a.victim === 1);
    assert(sc, 'dig-founding onto the base offered');
    R.applyAction(g, sc);
    eq(g.builds[0].cards.join(), 'S8,C8', 'base 8 beneath his dug 8');
    assert(!has(R.legalActions(g), (a) => a.type === 'endturn'), 'still owes the capture');
    R.applyAction(g, R.legalActions(g).find((a) => a.type === 'capture'));
    assert(has(R.legalActions(g), (a) => a.type === 'endturn'), 'resolved by capture');
  });

  test('no build EVER consists of one card — and topping the base founds a live build', () => {
    const g = mkState(2, { table: ['C10', 'H3'] });
    g.players[0].hand = ['D10', 'S10'];
    g.players[1].hand = ['C2'];
    eq(R.legalActions(g).filter((a) => a.type === 'scaffold').length, 0, 'a lone 10 founds nothing');
    const bt = R.legalActions(g).find((a) => a.type === 'basetop');
    assert(bt, 'top-the-base offered with a spare 10 held');
    R.applyAction(g, bt);
    eq(g.builds[0].cards.join(), 'C10,D10', '[base, top]');
    eq(g.builds[0].augmented, true, 'founded by topping — locked');
    eq(g.turnUsed, true, 'a hand-card move');
    // without a spare 10 the top-the-base is refused (the build would strand)
    const g2 = mkState(2, { table: ['C10'] });
    g2.players[0].hand = ['D10'];
    g2.players[1].hand = ['C2'];
    assert(!has(R.legalActions(g2), (a) => a.type === 'basetop'), 'no spare — no top-the-base');
  });

  test('DIG-FOUNDING needs a loose base — his 8 + the table 2 founds 10 only onto a base 10', () => {
    const withBase = mkState(2, { table: ['C10', 'H2', 'C5'] });
    withBase.players[0].hand = ['D10'];
    withBase.players[1].hand = ['H9'];
    withBase.players[1].pile = ['H6', 'S8'];
    const sc = R.legalActions(withBase).find((a) => a.type === 'scaffold' && a.victim === 1);
    assert(sc, 'founding offered with the base present');
    R.applyAction(withBase, sc);
    eq(withBase.builds[0].cards.join(), 'C10,S8,H2', 'base + his 8 + the 2');
    // without the base: the dig-founding is refused, the pure scaffold remains
    const noBase = mkState(2, { table: ['H2', 'C8'] });
    noBase.players[0].hand = ['D10'];
    noBase.players[1].hand = ['H9'];
    noBase.players[1].pile = ['H6', 'S8'];
    assert(!has(R.legalActions(noBase), (a) => a.type === 'scaffold' && a.victim === 1), 'no base — no dig-founding');
    assert(has(R.legalActions(noBase), (a) => a.type === 'scaffold' && a.cards.length === 2 && a.victim == null),
      'the pure table scaffold (8+2) is still offered');
  });

  test('SCENARIO C: compound founding — base 8 + hand 5 + Sipho\u2019s pile 3 = live build, no obligation', () => {
    const g = mkState(2, { table: ['S8', 'H4'] });
    g.players[0].hand = ['H5', 'D8'];
    g.players[1].hand = ['H9'];
    g.players[1].pile = ['H6', 'C3'];      // Sipho top: 3♣
    const acts = R.legalActions(g);
    const cpd = acts.find((a) => a.type === 'build' && a.value === 8 && a.victim === 1 && a.card === 'H5');
    assert(cpd, 'compound founding offered');
    R.applyAction(g, cpd);
    eq(g.builds.length, 1, 'build founded');
    const b = g.builds[0];
    assert(b.cards.includes('H5') && b.cards.includes('S8') && b.cards.includes('C3'), 'hand card, base and pile card all in');
    eq(b.augmented, true, 'dug founding locks it');
    eq(b.owner, 0, 'mine');
    eq(g.players[1].pile.length, 1, 'Sipho lost his 3');
    eq(g.turnUsed, true, 'hand card spent');
    eq(g.openedCardless, false, 'NO cardless debt — it is a live build');
    assert(has(R.legalActions(g), (a) => a.type === 'endturn'), 'may end the turn (after a topdig or directly)');
  });

  test('scaffold REQUIRES holding the value — no 8 in hand, no 8-scaffold', () => {
    const g = mkState(2, { table: ['H7', 'S1', 'C8'] });
    g.players[0].hand = ['H5', 'D9'];
    g.players[1].hand = ['H2'];
    assert(!has(R.legalActions(g), (a) => a.type === 'scaffold' && a.value === 8),
      'no 8 held — no 8-scaffold (even though 7+A sums to 8)');
    // but the 9 in hand allows the 9-scaffold from A+8
    assert(has(R.legalActions(g), (a) => a.type === 'scaffold' && a.value === 9),
      'the 9-scaffold from A+8 is legal (a 9 is held)');
  });

  test('END TURN GATE: a cardless opening owes a CAPTURE — a discard does not settle it', () => {
    const g = mkState(2, { wave: 2, table: ['C4'] });
    g.builds = [{ value: 6, cards: ['H4', 'S2'], owner: 0, augmented: false }];
    g.players[0].hand = ['D6', 'H9'];       // 6 captures own build; 9 for discards
    g.players[1].hand = ['C2'];
    g.players[1].pile = ['H7', 'C6'];       // Sipho top 6 — diggable into my 6-build
    // open cardless: dig Sipho's 6
    const dig = R.legalActions(g).find((a) => a.type === 'topdig');
    assert(dig, 'cardless dig opening offered');
    R.applyAction(g, dig);
    eq(g.openedCardless, true, 'opened cardless');
    const acts = R.legalActions(g);
    assert(!acts.some((a) => a.type === 'discard'), 'discards stripped while the debt is owed');
    assert(!has(acts, (a) => a.type === 'endturn'), 'cannot end yet');
    const cap = acts.find((a) => a.type === 'capture' && a.card === 'D6');
    assert(cap, 'capture available to settle');
    R.applyAction(g, cap);
    assert(has(R.legalActions(g), (a) => a.type === 'endturn'), 'capture settles the debt');
    // contrast: a hand-card FIRST move may end on a plain discard
    const g2 = mkState(2, { wave: 2, table: ['C4'] });
    g2.players[0].hand = ['H9', 'D5'];
    g2.players[1].hand = ['C2'];
    R.applyAction(g2, R.legalActions(g2).find((a) => a.type === 'discard' && a.card === 'H9'));
    assert(has(R.legalActions(g2), (a) => a.type === 'endturn'), 'hand-first turn may end after discard');
  });

  test('PARTNER GATE (4 hands): cardless table-fold into partner\u2019s build needs an escape route', () => {
    // partner (seat 2) owns a 9-build; I hold no 9
    const mk = (myHand, table) => {
      const g = mkState(4, { table });
      g.builds = [{ value: 9, cards: ['H4', 'S5'], owner: 2, augmented: false }];
      g.players[0].hand = myHand;
      g.players[1].hand = ['H2'];
      g.players[3].hand = ['H3'];
      g.players[2].hand = ['D9'];           // partner holds their capture card
      return g;
    };
    // route 1: I hold a 9 → top the partner build as resolution
    let g = mk(['C9', 'H5'], ['C4', 'H5x'.replace('x', '')]);
    g.players[0].hand = ['C9', 'H5'];
    g.table = ['C4', 'D5'];                 // 4+5 folds into the 9
    assert(has(R.legalActions(g), (a) => a.type === 'caugment'), 'route 1 (hold the 9) — fold offered');
    // route 2: enemy 6-build exists and I hold a 6
    g = mk(['C6', 'H5'], ['C4', 'D5']);
    g.builds.push({ value: 6, cards: ['H2', 'S4'], owner: 1, augmented: false });
    assert(has(R.legalActions(g), (a) => a.type === 'caugment'), 'route 2 (capture the enemy build) — fold offered');
    // route 3: a table card matches my hand
    g = mk(['C6', 'H5'], ['C4', 'D5', 'S6']);
    assert(has(R.legalActions(g), (a) => a.type === 'caugment'), 'route 3 (capture the table 6) — fold offered');
    // RESERVATION: the ONLY fold is 3+6 — but folding the table 6 destroys
    // the escape route, so the fold is refused entirely
    g = mk(['C6', 'H5'], ['C3', 'S6']);
    assert(!has(R.legalActions(g), (a) => a.type === 'caugment'), 'the escape card is reserved — the only fold is refused');
    // no route at all → no fold offered
    g = mk(['H5', 'H7'], ['C4', 'D5']);
    assert(!has(R.legalActions(g), (a) => a.type === 'caugment'), 'no escape — no fold offered');
  });

  /* ================= v4.1 fixes: fold-after-build, dig-fold, set ordering, log ================= */
  test('fold AFTER the hand card: table-fold into your build is always offered (no debt possible)', () => {
    const g = mkState(2, { table: ['H5', 'C4', 'D6'] });
    g.builds = [{ value: 9, cards: ['S9', 'H8', 'S1'], owner: 0, augmented: true }];  // locked 9-build
    g.players[0].hand = ['D9'];       // capture card reserved for the build
    g.players[1].hand = ['H7'];
    g.turnUsed = true;                // the hand card was already spent this turn
    const fold = R.legalActions(g).find((a) => a.type === 'caugment');
    assert(fold, '5+4 folds into the 9-build even with no other escape (hand already spent)');
    eq([fold.loose[0], fold.loose[1]].join(), 'H5,C4', 'the folding set is 5+4');
    R.applyAction(g, fold);
    eq(g.builds[0].cards.join(), 'S9,H8,S1,H5,C4', 'the set is sorted and placed ON TOP, history untouched');
  });

  test('DIG-FOLD: hand Ace + opponent pile-top 8 complete the 9-build (a hand move, no debt)', () => {
    const g = mkState(2, { table: ['D6'] });
    g.builds = [{ value: 9, cards: ['S9', 'H8', 'S1'], owner: 0, augmented: true }];
    g.players[0].hand = ['C1', 'D9'];
    g.players[1].hand = ['H7'];
    g.players[1].pile = ['H3', 'C8'];       // Sipho top: 8♣
    const df = R.legalActions(g).find((a) => a.type === 'augment' && a.victim === 1 && a.card === 'C1');
    assert(df, 'dig-fold offered as a first move');
    R.applyAction(g, df);
    eq(g.builds[0].cards.join(), 'S9,H8,S1,C8,C1', '8 then Ace appended (set sorted, highest first)');
    eq(g.turnUsed, true, 'a hand-card move');
    eq(g.openedCardless, false, 'no cardless debt');
    eq(g.players[1].pile.length, 1, 'Sipho lost his 8');
  });

  test('SET ORDER: compound founding keeps the base at the bottom, sets stack chronologically', () => {
    const g = mkState(2, { table: ['S9', 'H4', 'C5'] });
    g.players[0].hand = ['C1', 'D9'];
    g.players[1].hand = ['H7'];
    g.players[1].pile = ['H3', 'C8'];       // Sipho top: 8♣
    // compound founding: base 9 + hand A + Sipho's 8
    const cpd = R.legalActions(g).find((a) => a.type === 'build' && a.value === 9 && a.victim === 1);
    assert(cpd, 'compound founding offered');
    R.applyAction(g, cpd);
    eq(g.builds[0].cards.join(), 'S9,C8,C1', 'base 9 at the bottom, then 8, then the Ace');
    const lastLog = g.log[g.log.length - 1].text;
    assert(lastLog.indexOf('from') >= 0 && lastLog.indexOf('base') >= 0,
      'the log names the dug card and the base');
    // then fold 5+4 on top
    const fold = R.legalActions(g).find((a) => a.type === 'caugment');
    R.applyAction(g, fold);
    eq(g.builds[0].cards.join(), 'S9,C8,C1,C5,H4', 'each new set sorted and stacked on top');
  });

  test('CAPTURE PILE ORDER: each capture is a sorted set, the played card lands on top', () => {
    const g = mkState(2, { table: ['H6', 'C2'] });
    g.players[0].hand = ['S8', 'D6'];
    g.players[1].hand = ['H9'];
    const cap = R.legalActions(g).find((a) => a.type === 'capture' && a.card === 'D6');
    R.applyAction(g, cap);
    eq(g.players[0].pile.join(), 'H6,D6', 'the capture set sorted (6♥), played 6♦ on top');
    // a second capture stacks on top of the first
    g.players[0].hand = ['S2'];
    g.table = ['C2'];
    g.turn = 0; g.turnUsed = false; g.openedCardless = false; g.resolved = false; g.capturedThisTurn = false;
    const cap2 = R.legalActions(g).find((a) => a.type === 'capture' && a.card === 'S2');
    assert(cap2, 'the 2 captures the 2');
    R.applyAction(g, cap2);
    eq(g.players[0].pile.join(), 'H6,D6,C2,S2', 'second capture set on top of the first');
  });

  test('captures exist for EVERY copy of a rank — the second 10 works like the first', () => {
    const g = mkState(2, { table: [] });
    g.builds = [{ value: 10, cards: ['H6', 'S4'], owner: 1, augmented: false }];   // Sipho's 10-build
    g.players[0].hand = ['D10', 'S10', 'H7'];
    g.players[1].hand = ['C9'];
    const acts = R.legalActions(g);
    assert(has(acts, (a) => a.type === 'capture' && a.card === 'D10' && a.buildIds.length === 1),
      'the 10♦ captures the build');
    assert(has(acts, (a) => a.type === 'capture' && a.card === 'S10' && a.buildIds.length === 1),
      'the 10♠ captures the build too');
  });

  /* ================= a capture closes the turn (the steal is gone) ================= */
  test('after ANY capture no further move exists — only End Turn (dig is the only taking)', () => {
    const g = mkState(2, { table: ['C3', 'D6'] });
    g.builds = [{ value: 9, cards: ['H5', 'S4'], owner: 0, augmented: false }];  // my live 9-build
    g.players[0].hand = ['S3', 'D9'];
    g.players[1].hand = ['C2'];
    g.players[1].pile = ['H7', 'C3'];   // in the old game this opened a steal window — no longer
    R.applyAction(g, R.legalActions(g).find((a) => a.type === 'capture' && a.card === 'S3'));
    eq(g.phase, 'play', 'no steal window opens');
    const acts = R.legalActions(g);
    eq(acts.length, 1, 'exactly one action remains');
    eq(acts[0].type, 'endturn', 'and it is End Turn');
    // no digs, no folds, no discards — the taking is closed
    R.applyAction(g, { type: 'endturn' });
    eq(g.turn, 1, 'turn passes');
    eq(g.capturedThisTurn, false, 'flag reset for the next player');
  });

  /* ================= digs into an OPPONENT's build — for capture ================= */
  test('ENEMY DIG: his pile-top 8 into his 8-build, then capture with the held 8', () => {
    const g = mkState(2, { table: ['C4'] });
    g.builds = [{ value: 8, cards: ['H5', 'S3'], owner: 1, augmented: false }];   // Sipho's 8-build
    g.players[0].hand = ['D8', 'H9'];
    g.players[1].hand = ['C2'];
    g.players[1].pile = ['H7', 'C8'];       // his top: 8♣
    const edig = R.legalActions(g).find((a) => a.type === 'edig' && a.victims[0] === 1);
    assert(edig, 'the dig into his build is offered (an 8 is held)');
    R.applyAction(g, edig);
    eq(g.builds[0].cards.length, 3, 'his 8♣ joined his build');
    eq(g.players[1].pile.length, 1, 'his pile lost its top');
    eq(g.builds[0].captLock, true, 'the capture is locked');
    eq(g.openedCardless, true, 'cardless opening');
    // the lock: ONLY the capturing card survives
    const acts = R.legalActions(g).filter((a) => a.card);
    assert(acts.length > 0 && acts.every((a) => a.type === 'capture' && a.card === 'D8' && a.buildIds.length === 1),
      'only the 8 capturing his build remains');
    assert(!has(R.legalActions(g), (a) => a.type === 'endturn'), 'End Turn closed');
    R.applyAction(g, acts[0]);
    eq(g.builds.length, 0, 'his build taken');
    eq(g.players[0].pile.length, 4, 'the build (3 cards) + my played 8');
    assert(has(R.legalActions(g), (a) => a.type === 'endturn'), 'End Turn after the capture');
  });

  test('ENEMY DIG combined: his 3 + a table 5 into his 8-build', () => {
    const g = mkState(2, { table: ['C5', 'H2'] });
    g.builds = [{ value: 8, cards: ['H4', 'S4'], owner: 1, augmented: false }];
    g.players[0].hand = ['D8', 'H9'];
    g.players[1].hand = ['C2'];
    g.players[1].pile = ['H7', 'C3'];       // his top: 3♣
    const edig = R.legalActions(g).find((a) => a.type === 'edig' && a.loose.join() === 'C5');
    assert(edig, 'the combined dig (3 + table 5) is offered');
    R.applyAction(g, edig);
    eq(g.builds[0].cards.length, 4, '3♣ and 5♣ both joined');
    eq(g.builds[0].captLock, true, 'locked for capture');
  });

  test('ENEMY FOLD: pure table cards into his build — same lock', () => {
    const g = mkState(2, { table: ['C5', 'H3'] });
    g.builds = [{ value: 8, cards: ['H4', 'S4'], owner: 1, augmented: false }];
    g.players[0].hand = ['D8', 'H9'];
    g.players[1].hand = ['C2'];
    const efold = R.legalActions(g).find((a) => a.type === 'efold' && a.loose.length === 2);
    assert(efold, 'folding 5+3 into his 8-build offered');
    R.applyAction(g, efold);
    eq(g.builds[0].captLock, true, 'locked for capture');
  });

  test('ENEMY folds REFUSED without the value held, and after the hand card is spent', () => {
    const g = mkState(2, { table: ['C5', 'H3'] });
    g.builds = [{ value: 8, cards: ['H4', 'S4'], owner: 1, augmented: false }];
    g.players[0].hand = ['H9', 'D6'];       // no 8 held
    g.players[1].hand = ['C2'];
    g.players[1].pile = ['H7', 'C8'];
    assert(!has(R.legalActions(g), (a) => a.type === 'edig' || a.type === 'efold'),
      'no 8 in hand — the fold would be charity');
    // hand card spent → no capture possible → also refused
    g.players[0].hand = ['D8'];
    g.turnUsed = true;
    assert(!has(R.legalActions(g), (a) => a.type === 'edig' || a.type === 'efold'),
      'hand card spent — the capture could not follow');
  });

  test('INTERCHANGE: dig my own build, fold into his, then capture his', () => {
    const g = mkState(2, { table: ['C5'] });
    g.builds = [
      { value: 5, cards: ['H2', 'S3'], owner: 0, augmented: false },   // my 5-build
      { value: 8, cards: ['H3', 'S5'], owner: 1, augmented: false }    // his 8-build
    ];
    g.players[0].hand = ['D8', 'D5'];
    g.players[1].hand = ['C2'];
    g.players[1].pile = ['H7', 'C8'];       // his top: 8♣
    // first: cardless fold into MY build
    const own = R.legalActions(g).find((a) => a.type === 'caugment' && a.buildIdx === 0 && a.loose.join() === 'C5');
    assert(own, 'fold 5 into my own 5-build');
    R.applyAction(g, own);
    eq(g.openedCardless, true, 'cardless opening');
    // then: dig into HIS build (still allowed, interchangeably)
    const edig = R.legalActions(g).find((a) => a.type === 'edig');
    assert(edig, 'the enemy dig is still offered after my own fold');
    R.applyAction(g, edig);
    // hand narrows to capturing HIS build only (the lock is stricter than the gate)
    const hand = R.legalActions(g).filter((a) => a.card);
    assert(hand.length > 0 && hand.every((a) => a.type === 'capture' && a.buildIds.includes(1)),
      'only the capture of his build remains');
    R.applyAction(g, hand[0]);
    eq(g.builds.length, 1, 'his build taken, mine remains');
    assert(has(R.legalActions(g), (a) => a.type === 'endturn'), 'End Turn after the capture');
  });

  /* ================= Shiya still works ================= */

  /* ================= fuzz ================= */
  test('fuzz: hundreds of full games honour every invariant on every move', () => {
    const configs = [
      { numPlayers: 2, games: 90 },
      { numPlayers: 3, games: 60 },
      { numPlayers: 4, games: 110 }
    ];
    let totalGames = 0, totalMoves = 0, buildsSeen = 0, topsSeen = 0, digsSeen = 0, topdigsSeen = 0, scaffoldsSeen = 0, foldsSeen = 0, pregsSeen = 0, shiyasSeen = 0, forcesSeen = 0;
    for (const cfg of configs) {
      for (let seed = 1; seed <= cfg.games; seed++) {
        const players = [];
        for (let i = 0; i < cfg.numPlayers; i++) {
          players.push({ name: 'P' + i, isHuman: false, personality: ['thandi', 'sipho', 'naledi', 'naledi'][i] });
        }
        const g = R.createGame({ numPlayers: cfg.numPlayers, players, seed: seed * 7919 + cfg.numPlayers });
        let steps = 0;
        while (g.phase !== 'gameover') {
          const acts = R.legalActions(g);
          assert(acts.length > 0, 'no legal actions mid-game');

          // conservation
          let total = g.stock.length + g.table.length +
            g.players.reduce((n, p) => n + p.hand.length + p.pile.length, 0) +
            g.builds.reduce((n, b) => n + b.cards.length, 0);
          eq(total, 40, 'card conservation broken');
          // the loose table never holds two cards of the same value
          const looseRanks = g.table.map((id) => C.rank(id));
          assert(new Set(looseRanks).size === looseRanks.length, 'two loose cards of one value on the table');

          // live builds: unique values, owner holds the value, never one card
          const vals = g.builds.map((b) => b.value);
          eq(new Set(vals).size, vals.length, 'duplicate build values live');
          for (const b of g.builds) {
            buildsSeen++;
            assert(b.cards.length >= 2, 'a build consisting of one card');
            const owner = g.players[b.owner];
            assert(owner.hand.some((h) => C.rank(h) === b.value),
              'stranded build: owner holds no ' + b.value);
          }
          if (g.phase === 'play') {
            for (const a of acts) {
              if (a.type === 'discard') {
                assert(!vals.includes(C.rank(a.card)), 'discard of a live build value offered');
              }
              if (a.type === 'capture' && a.buildIds) {
                for (const idx of a.buildIds) {
                  assert(g.builds[idx].owner === g.turn || !R.sameSide(g, g.builds[idx].owner, g.turn),
                    'partner tried to capture partner build');
                }
              }
              // multi-move turn: hand-card moves only while the card is unspent;
              // end turn only through the v4 gate
              const handMove = ['capture', 'discard', 'build', 'augment', 'dig', 'preg'].includes(a.type);
              if (handMove) assert(!g.turnUsed, 'second hand-card move offered in one turn');
              if (a.type === 'endturn') {
                assert(g.turnUsed, 'endturn before the hand card');
                assert(!g.builds.some((b) => b.scaffold), 'endturn with a scaffold live');
                assert(!g.builds.some((b) => b.captLock), 'endturn with a capture lock owed');
                assert(!g.openedCardless || g.resolved, 'endturn with a cardless debt owed');
              }
              if (a.type === 'scaffold') {
                assert(!g.turnUsed, 'scaffold founded after the hand card');
                assert(g.players[g.turn].hand.some((h) => C.rank(h) === a.value), 'scaffold without the value held');
                assert(!vals.includes(a.value), 'scaffold duplicating a live value');
                const setSum = a.cards.reduce((n, id) => n + C.rank(id), 0) +
                  (a.victim != null ? C.rank(g.players[a.victim].pile[g.players[a.victim].pile.length - 1]) : 0);
                eq(setSum, a.value, 'scaffold cards must sum to the value');
                if (a.victim != null) {
                  assert(g.table.some((t) => C.rank(t) === a.value), 'dig-founding without a loose base');
                  assert(!R.sameSide(g, a.victim, g.turn), 'dig-founding from a partner');
                } else {
                  assert(a.cards.length >= 2, 'a single-card scaffold offered');
                }
              }
              if (a.type === 'topdig') {
                const b = g.builds[a.buildIdx];
                const top = g.players[a.victim].pile[g.players[a.victim].pile.length - 1];
                assert(R.sameSide(g, b.owner, g.turn), 'pile-top dig into an enemy build');
                assert(!R.sameSide(g, a.victim, g.turn), 'pile-top dig from a partner');
                assert(C.rank(top) === b.value, 'pile top does not match the build value');
                assert(!b.scaffold, 'pile-top dig into a scaffold');
              }
              if (a.type === 'capture') {
                /* the v6 capture law: a build falls ONLY to its exact value,
                   floor cards fall ONE SET per capture — never mixed */
                if (a.scaffoldCap) {
                  assert(g.builds[a.buildIds[0]].scaffold, 'scaffoldCap on a non-scaffold');
                  eq(a.loose.length, 0, 'scaffold capture with loose cards');
                } else if (a.buildIds.length) {
                  eq(a.buildIds.length, 1, 'a capture takes at most one build');
                  eq(a.loose.length, 0, 'a build capture never sweeps floor cards');
                  eq(g.builds[a.buildIds[0]].value, C.rank(a.card), 'build taken by a NON-matching card');
                } else {
                  assert(a.loose.length >= 1, 'empty capture offered');
                  eq(a.loose.reduce((n, id) => n + C.rank(id), 0), C.rank(a.card),
                    'floor set does not sum to the card');
                }
              }
              if (a.type === 'preg') {
                /* a hand card alone, an enemy virgin target, the landing decides */
                eq((a.loose || []).length, 0, 'preg using floor cards');
                const t = g.builds[a.buildIdx];
                assert(!R.sameSide(g, t.owner, g.turn), 'own-side preg offered');
                assert(!t.augmented && !t.scaffold, 'preg on a non-virgin target');
                if (a.mergeInto != null) {
                  const live = g.builds[a.mergeInto];
                  assert(R.sameSide(g, live.owner, g.turn), 'merge into an enemy build');
                  eq(live.value, a.value, 'merge landing value mismatch');
                } else {
                  eq(t.value + C.rank(a.card), a.value, 'preg arithmetic broken');
                }
              }
              if (a.type === 'caugment' || a.type === 'efold') {
                assert(!g.builds[a.buildIdx].scaffold, 'fold into a scaffold');
              }
            }
            // scaffolds never coexist with a spent hand card (they resolve first)
            assert(!(g.builds.some((b) => b.scaffold) && g.turnUsed), 'scaffold outlived the hand card');
            // an enemy-fold lock: the capture is owed, the hand is narrowed to it
            const lockB = g.builds.find((b) => b.captLock);
            if (lockB) {
              assert(!R.sameSide(g, lockB.owner, g.turn), 'captLock on an own-side build');
              assert(!g.turnUsed, 'captLock outlived the hand card');
              const li = g.builds.indexOf(lockB);
              for (const a of acts) {
                if (['capture', 'discard', 'build', 'augment', 'dig', 'preg'].includes(a.type)) {
                  assert(a.type === 'capture' && a.buildIds.includes(li), 'captLock not narrowing the hand');
                }
              }
            }
            // a capture closes the turn: only End Turn may follow
            if (g.capturedThisTurn) {
              eq(acts.length, 1, 'more than End Turn offered after a capture');
              eq(acts[0].type, 'endturn', 'not End Turn after a capture');
            }
            // a cardless debt narrows the hand to captures and tops
            if (g.openedCardless && !g.resolved) {
              for (const a of acts) {
                if (['capture', 'discard', 'build', 'augment', 'dig', 'preg'].includes(a.type)) {
                  assert(a.type === 'capture' || (a.type === 'augment' && a.method === 'top'),
                    'cardless debt not narrowing the hand');
                }
              }
            }
            /* the registration law: no two builds ever share a value, and the
               per-player caps hold (one build; two in 4 hands, Shiya-given) */
            const valSeen = {};
            for (const b of g.builds) {
              assert(!valSeen[b.value], 'two builds share a value');
              valSeen[b.value] = true;
            }
            for (const p of g.players) {
              const reg = g.builds.filter((b) => b.owner === p.id && !b.scaffold).length;
              assert(reg <= (g.numPlayers === 4 ? 2 : 1), 'build cap broken');
            }
            const owned = g.builds.filter((b) => b.owner === g.turn && !b.scaffold).length;
            if (owned >= 2) {
              forcesSeen++;
              const handActs = acts.filter((a) => !['topdig', 'caugment', 'scaffold', 'endturn'].includes(a.type));
              assert(handActs.every((a) => a.type === 'capture' && a.buildIds.some((i) => g.builds[i].owner === g.turn)),
                'two-build force violated');
              assert(!has(acts, (a) => a.type === 'endturn'), 'endturn while the force is unsatisfied');
            }
          }

          // play a random legal action (captures preferred for pace)
          let pick;
          const caps = acts.filter((a) => a.type === 'capture');
          const r = g.rng();
          if (caps.length && r < 0.55) pick = caps[Math.floor(g.rng() * caps.length)];
          else pick = acts[Math.floor(g.rng() * acts.length)];
          if (pick.type === 'shiya') shiyasSeen++;
          if (pick.type === 'augment') (pick.method === 'top' ? topsSeen++ : topsSeen++);
          if (pick.type === 'dig') digsSeen++;
          if (pick.type === 'topdig') topdigsSeen++;
          if (pick.type === 'scaffold') scaffoldsSeen++;
          if (pick.type === 'caugment') foldsSeen++;
          if (pick.type === 'preg') pregsSeen++;
          R.applyAction(g, pick);

          totalMoves++; steps++;
          assert(steps < 800, 'game did not terminate');
        }
        eq(g.builds.length, 0, 'build survived past game end');
        eq(g.table.length, 0, 'table not swept');
        const pileTotal = g.players.reduce((n, p) => n + p.pile.length, 0);
        eq(pileTotal, 40, 'not all cards ended in piles');
        const res = R.scoreGame(g);
        assert(res.winners.length >= 1, 'no winner');
        for (const t of res.stats) assert(t.total <= res.totalInPlay, 'score exceeds universe');
        totalGames++;
      }
    }
    window.__FUZZ_STATS__ = { totalGames, totalMoves, buildsSeen, topsSeen, digsSeen, topdigsSeen, pregsSeen, shiyasSeen, forcesSeen };
    assert(buildsSeen > 200, 'fuzz barely touched builds');
    assert(digsSeen >= 1, 'dig never exercised');
    assert(pregsSeen >= 1, 'preg never exercised');
    assert(shiyasSeen >= 1, 'shiya never exercised');
    assert(forcesSeen >= 1, 'two-build force never exercised');
  });

  /* ================= render ================= */
  function render() {
    const box = document.getElementById('test-results');
    const passed = results.filter((r) => r.pass).length;
    const failed = results.length - passed;
    box.innerHTML =
      '<div class="summary ' + (failed ? 'fail' : 'pass') + '">' +
      passed + ' passed, ' + failed + ' failed' +
      (window.__FUZZ_STATS__
        ? ' — fuzz: ' + window.__FUZZ_STATS__.totalGames + ' games, ' + window.__FUZZ_STATS__.totalMoves + ' moves, ' +
          window.__FUZZ_STATS__.buildsSeen + ' build-checks, ' + window.__FUZZ_STATS__.digsSeen + ' digs, ' +
          window.__FUZZ_STATS__.topdigsSeen + ' pile-top digs, ' +
          window.__FUZZ_STATS__.pregsSeen + ' pregs, ' + window.__FUZZ_STATS__.shiyasSeen + ' shiyas, ' +
          window.__FUZZ_STATS__.forcesSeen + ' two-build forces'
        : '') +
      '</div>' +
      results.map((r) =>
        '<div class="case ' + (r.pass ? 'pass' : 'fail') + '">' +
        (r.pass ? '✔' : '✘') + ' ' + r.name +
        (r.error ? '<div class="err">' + r.error + '</div>' : '') +
        '</div>').join('');
    window.__TEST_SUMMARY__ = { passed, failed, total: results.length, results };
    document.title = failed ? ('✘ ' + failed + ' test(s) failed') : ('✔ all ' + results.length + ' tests passed');
  }
  render();
})(window);
