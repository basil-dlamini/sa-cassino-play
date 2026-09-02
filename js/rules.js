/* rules.js — South African Cassino rules engine (v6: the owner's table law).
   Pure logic, no DOM — everything legal or illegal is decided here.

   THE TABLE LAW (as taught by the owner):
   - CAPTURE: a registered build falls ONLY to a card of its exact value —
     never as part of a sum. Floor cards fall ONE SET per capture, the set
     summing exactly to the played card. Never a build mixed into a sum,
     never two sets in one capture, and the game never takes anything the
     player did not highlight.
   - PREG: a HAND CARD ALONE raises an ENEMY's virgin build (never your own,
     never a partner's). The landing decides: free value → new virgin build
     owned by the pregger (who must hold the value); own side's live value →
     the enemy build folds into it and it locks; partner's virtual value →
     restarted as the partner's virgin build; enemy-live value → not offered.
   - SCAFFOLD: an UNREGISTERED construct standing in the discard area. Founded
     cardless from floor cards (a loose base of the value joins beneath;
     dig-founding an opponent's pile top REQUIRES that base), it owes same-
     turn resolution: capture with the held value, or graduate by topping
     (only while owning no registered build) into a real, registered build.
   - REGISTRATION: no two registered builds share a value, table-wide. A
     player owns at most ONE registered build (TWO in four hands, and the
     second is temporary — the force demands capturing one before the turn
     may end; the loop makes a third impossible).
   - SHIYA (4 hands): the caller's held value converts a partner's capture
     into a REGISTERED live build standing in the CALLER's area.

   THE TURN: a turn is a SEQUENCE of moves, ended by explicit END TURN.
   Exactly ONE move per turn may use a hand card; no-hand-card moves (digs,
   folds, scaffold foundings) may come before or after. A capture closes the
   taking — only End Turn follows. The turn may not end before the hand card
   is spent and every debt (scaffold, cardless opening, enemy-fold lock,
   two-build force) is settled.

   HOUSE RULES ENCODED (as settled with the owner):
   1. While a registered build is live, NO player may discard a card of its
      value.
   2. A build's owner may only spend a matching card to capture that build,
      augment it, or while still holding another card of that value.
   3. Opponents may use a matching card ONLY to capture the build. Partners
      may top and augment freely; only the owner (or opponents) may capture.
   4. A hand card NEVER enters an opponent's build — only cardless folds of
      floor cards, folded in for capture.
   5. Two-hand game: in round one, a player with a live build cannot discard
      anything — they must capture, top, or dig.
   6. Digging only ever takes from OPPONENTS' piles, never a partner's. */
(function (root) {
  const C = root.Cards;

  const DEAL = { 2: { per: 10, table: 0 }, 3: { per: 13, table: 1 }, 4: { per: 10, table: 0 } };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- subset helpers ---------- */
  function canSum(ranks, target) {
    if (target === 0) return true;
    if (target < 0) return false;
    const dp = new Set([0]);
    for (const r of ranks) {
      const add = [];
      for (const s of dp) {
        const ns = s + r;
        if (ns === target) return true;
        if (ns < target) add.push(ns);
      }
      for (const a of add) dp.add(a);
    }
    return false;
  }
  function allSubsets(cards, target, cap) {
    cap = cap || 40;
    const out = [];
    const n = cards.length;
    const rs = cards.map((id) => C.rank(id));
    const suffix = new Array(n + 1).fill(0);
    for (let i = n - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + rs[i];
    let nodes = 0;
    function rec(i, need, acc) {
      if (out.length >= cap || ++nodes > 20000) return;
      if (need === 0) { out.push(acc.slice()); return; }
      if (i >= n || suffix[i] < need) return;
      rec(i + 1, need, acc);
      if (rs[i] <= need) { acc.push(cards[i]); rec(i + 1, need - rs[i], acc); acc.pop(); }
    }
    rec(0, target, []);
    return out;
  }

  /* ---------- creation ---------- */
  function createGame(opts) {
    const n = opts.numPlayers;
    if (!DEAL[n]) throw new Error('numPlayers must be 2, 3 or 4');
    const partnership = n === 2 || n === 4; // 4 hands are ALWAYS pairs
    const rng = mulberry32(opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9));
    const dealer = opts.dealer != null ? opts.dealer : Math.floor(rng() * n);

    const players = opts.players.map((p, i) => ({
      id: i, name: p.name, isHuman: !!p.isHuman,
      personality: p.personality || null,
      hand: [],
      pile: [],
      virtual: {}          // value -> true (virtual ownership)
    }));

    const g = {
      numPlayers: n,
      partnership,
      players, dealer,
      turn: (dealer + 1) % n,
      turnUsed: false,       // the one hand-card move of this turn is spent
      openedCardless: false, // the turn opened with a no-hand-card move
      resolved: false,       // the capture-or-top owed for a cardless opening
      capturedThisTurn: false, // a capture closes the taking — End Turn only
      stock: [],
      table: [],
      builds: [],            // live builds: {value, cards, owner, augmented}
      lastCapturer: null,
      phase: 'play',         // 'play' | 'steal' | 'shiya' | 'gameover'
      pending: null,         // steal: {player, victims, playedCard}
      shiyaPending: null,    // shiya: {capturer, caller, playedCard, cards, value}
      wave: 1,
      log: [],
      rng,
      actionCount: 0
    };

    const deck = C.shuffled(C.makeDeck(), rng);
    const d = DEAL[n];
    for (let i = 0; i < d.per; i++) for (const p of players) p.hand.push(deck.pop());
    for (let i = 0; i < d.table; i++) g.table.push(deck.pop());
    g.stock = deck;
    addLog(g, 'info', 'Cards dealt. ' + g.players[g.turn].name + ' plays first.');
    return g;
  }

  function addLog(g, kind, text) { g.log.push({ kind, text }); }
  function act(p, third, plain) { return p.name === 'You' ? 'You ' + plain : p.name + ' ' + third; }
  function names(g, i) { return g.players[i].name; }
  function fmt(ids) { return ids.map((id) => C.label(id)).join(' + '); }
  /* Pile order: every addition is a SET, sorted internally (highest at the
     set's bottom) and placed on top of what is already there — nothing
     already placed is ever re-sorted. */
  function sortDesc(ids) { return ids.slice().sort((x, y) => C.rank(y) - C.rank(x)); }

  /* A loose table card of the build's value becomes the build's BASE (the
     very bottom of the pile) the moment the build appears — it must never
     be left loose on the table. */
  function absorbBases(g, value) {
    const bases = g.table.filter((t) => C.rank(t) === value);
    for (const b of bases) g.table.splice(g.table.indexOf(b), 1);
    return bases;
  }

  /* ---------- sides / ownership ---------- */
  function sameSide(g, a, b) {
    if (a === b) return true;
    return g.numPlayers === 4 && ((a % 2) === (b % 2)); // 0+2 and 1+3
  }
  function teammate(g, seat) {
    return g.numPlayers === 4 ? (seat + 2) % 4 : null;
  }
  function teamsOf(g) {
    if (g.numPlayers === 2) return [[0], [1]];
    if (g.numPlayers === 4) return [[0, 2], [1, 3]];
    return null;
  }
  function isTeammate(g, a, b) { return sameSide(g, a, b); }
  function maxSlots(g) { return g.numPlayers === 4 ? 2 : 1; }
  /* Registration: only registered builds count toward a player's holdings —
     a scaffold is registered to nobody */
  function buildsOwned(g, seat) { return g.builds.filter((b) => b.owner === seat && !b.scaffold).length; }

  /* Master card-use rule (header points 1–3 + the loose-twin ban). Scaffolds
     are unregistered — they restrict nobody's card use. */
  function cardUseLegal(g, seat, card, use) {
    const v = C.rank(card);
    const holdsAnother = g.players[seat].hand.some((h) => h !== card && C.rank(h) === v);
    const ownVB = g.builds.find((b) => b.value === v && b.owner === seat && !b.scaffold);
    if (use.type === 'discard') {
      return !g.builds.some((b) => b.value === v && !b.scaffold) &&  // never a live build's value
        !g.table.some((t) => C.rank(t) === v);                        // never a loose twin
    }
    if (ownVB) {
      if (use.type === 'capture' && use.buildIds && use.buildIds.includes(g.builds.indexOf(ownVB))) return true;
      const augOwn = (use.type === 'augment' || use.type === 'dig') &&
        use.buildIdx === g.builds.indexOf(ownVB) && v !== C.rank(card);
      if (augOwn) return true;
      return holdsAnother;
    }
    const enemyV = g.builds.find((b) => b.value === v && !sameSide(g, seat, b.owner) && !b.scaffold);
    if (enemyV && !(use.type === 'capture' && use.buildIds && use.buildIds.includes(g.builds.indexOf(enemyV)))) return false;
    return true;
  }

  /* ---------- legal actions ---------- */
  function legalActions(g) {
    if (g.phase === 'gameover') return [];
    if (g.phase === 'shiya') {
      return [{ type: 'shiya' }, { type: 'skip' }]; // offered to the caller only
    }

    /* a capture closes the turn's taking: only End Turn remains */
    if (g.capturedThisTurn) {
      return [{ type: 'endturn' }];
    }

    const me = g.turn;
    const P = g.players[me];
    const idxOf = (b) => g.builds.indexOf(b);

    const acts = [];

    /* live obligations: an unresolved scaffold locks the hand to itself; a
       cardless opening owes a capture-or-top before the turn may end; an
       enemy fold locks the hand to capturing that build */
    const scaffold = g.builds.find((b) => b.scaffold) || null;
    const lock = g.builds.find((b) => b.captLock) || null;
    const gate = g.openedCardless && !g.resolved;

    /* scaffold lock: the stack stands in the discard area owing resolution.
       Capture it with the held value, or graduate it by topping — a top
       founds a registered build, so only while owning none */
    if (!g.turnUsed && scaffold) {
      const si = idxOf(scaffold);
      const heldV = P.hand.filter((h) => C.rank(h) === scaffold.value);
      for (const card of heldV) {
        const cap = { type: 'capture', card, loose: [], buildIds: [si], scaffoldCap: true };
        if (cardUseLegal(g, me, card, cap)) acts.push(cap);
      }
      if (heldV.length >= 2 && buildsOwned(g, me) === 0) {
        const top = { type: 'augment', buildIdx: si, card: heldV[0], loose: [], method: 'top' };
        if (cardUseLegal(g, me, heldV[0], top)) acts.push(top);
      }
    }

    /* enemy-fold lock: ONLY the capturing cards stay unlocked */
    if (!g.turnUsed && lock) {
      const li = idxOf(lock);
      for (const card of P.hand) {
        if (C.rank(card) !== lock.value) continue;
        const cap = { type: 'capture', card, loose: [], buildIds: [li] };
        if (cardUseLegal(g, me, card, cap)) acts.push(cap);
      }
    }

    /* hand-card moves exist only until the turn's one card is spent */
    if (!g.turnUsed && !scaffold && !lock) {

      /* ---- captures: a registered build falls ONLY to its exact value;
             floor cards fall ONE SET per capture, the set summing exactly to
             the played card. Never a build mixed into a sum, never two sets
             in one capture — the game takes exactly what was highlighted ---- */
      const byRank = {};
      for (const card of P.hand) (byRank[C.rank(card)] = byRank[C.rank(card)] || []).push(card);
      for (const r in byRank) {
        /* EVERY copy of the rank gets its actions — the player selects the
           actual card, so a second 10 must work exactly like the first */
        for (const card of byRank[r]) {
          for (const set of allSubsets(g.table, Number(r), 12)) {
            if (!set.length) continue;
            const use = { type: 'capture', card, loose: set, buildIds: [] };
            if (cardUseLegal(g, me, card, use)) acts.push(use);
          }
          for (const b of g.builds) {
            if (b.scaffold || b.value !== Number(r)) continue;
            if (!(b.owner === me || !sameSide(g, me, b.owner))) continue;
            const use = { type: 'capture', card, loose: [], buildIds: [idxOf(b)] };
            if (cardUseLegal(g, me, card, use)) acts.push(use);
          }
        }
      }

      /* ---- two-build force: only captures taking at least one own build ---- */
      if (buildsOwned(g, me) >= 2) {
        return acts.filter((a) => a.buildIds.some((idx) => g.builds[idx].owner === me))
          .concat(cardlessMoves(g, me, idxOf).filter((m) => m.type === 'topdig'));
      }

      /* ---- discard ---- */
      const round1Lock = g.numPlayers === 2 && g.wave === 1 && buildsOwned(g, me) > 0;
      if (!round1Lock) {
        for (const card of P.hand) {
          if (cardUseLegal(g, me, card, { type: 'discard' })) {
            acts.push({ type: 'discard', card });
          }
        }
      }

      /* ---- create a build ---- */
      {
        const bySum = {};
        for (let s = 1; s <= 9; s++) bySum[s] = allSubsets(g.table, s, 12);
        for (const card of P.hand) {
          const rp = C.rank(card);
          for (let V = rp + 1; V <= 10; V++) {
            if (g.builds.some((b) => b.value === V)) continue;   // no duplicate build values
            let owner = me;
            const tm = teammate(g, me);
            const partnerVirtual = tm != null && g.players[tm].virtual[V];
            if (partnerVirtual) owner = tm;
            if (buildsOwned(g, owner) >= 1) continue;  /* a SECOND registered build
               arrives only via Shiya — a self-made second spends the hand card
               and leaves the capture force unsatisfiable (a deadlock trap) */
            const ownerHoldsV = g.players[owner].hand.some((h) => h !== card && C.rank(h) === V);
            if (!ownerHoldsV) continue;                          // the owner must be able to capture it
            if (!cardUseLegal(g, me, card, { type: 'build', card })) continue;
            for (const sub of bySum[V - rp] || []) {
              acts.push({ type: 'build', card, loose: sub, value: V, owner });
            }
            /* compound founding: a table BASE of value V + this hand card +
               an opponent's pile top (hand + pile = V) founds the build at
               once — no same-turn obligation, the build is live (owner holds V) */
            const base = g.table.find((t) => C.rank(t) === V);
            if (base && owner === me) {
              for (let seat = 0; seat < g.numPlayers; seat++) {
                if (sameSide(g, seat, me)) continue;
                const top = g.players[seat].pile[g.players[seat].pile.length - 1];
                if (top && C.rank(top) + rp === V) {
                  acts.push({ type: 'build', card, loose: [base], value: V, owner: me, victim: seat });
                }
              }
            }
          }
        }
      }

      /* ---- top the base: a hand card onto a loose base founds a live build
             (needs a spare capture card in hand, no live build of the value) ---- */
      for (const card of P.hand) {
        const V = C.rank(card);
        if (!P.hand.some((h) => h !== card && C.rank(h) === V)) continue;   // spare capture card
        if (g.builds.some((b) => b.value === V)) continue;                  // no duplicate values
        if (buildsOwned(g, me) >= 1) continue;                              // one self-made build
        const base = g.table.find((t) => C.rank(t) === V);
        if (!base) continue;
        acts.push({ type: 'basetop', card, base });
      }

      /* ---- augment own-side REGISTERED builds (top / combine / double dig);
             a scaffold takes no additions — only its resolution ---- */
      for (const b of g.builds) {
        if (b.scaffold) continue;                     // never fold onto a scaffold
        if (!sameSide(g, b.owner, me)) continue;      // never augment an enemy build
        const bi = idxOf(b);
        for (const card of P.hand) {
          const r = C.rank(card);
          if (r === b.value) {
            const use = { type: 'augment', buildIdx: bi, card, loose: [], method: 'top' };
            if (cardUseLegal(g, me, card, use)) acts.push(use);
        } else if (r < b.value) {
          for (const sub of allSubsets(g.table, b.value - r, 8)) {
            const use = { type: 'augment', buildIdx: bi, card, loose: sub, method: 'combine' };
            if (cardUseLegal(g, me, card, use)) acts.push(use);
          }
          /* dig-fold: an opponent's pile top completes the value alongside
             the hand card (e.g. A in hand + 8 on their pile into a 9-build) */
          for (let seat = 0; seat < g.numPlayers; seat++) {
            if (sameSide(g, seat, me)) continue;   // never a partner's pile
            const pt = g.players[seat].pile[g.players[seat].pile.length - 1];
            if (pt && C.rank(pt) + r === b.value) {
              const use = { type: 'augment', buildIdx: bi, card, loose: [], victim: seat, method: 'combine' };
              if (cardUseLegal(g, me, card, use)) acts.push(use);
            }
          }
          /* THREE-SOURCE COMBINE: a hand card + an opponent's pile top +
             table cards TOGETHER complete the value (3 + his Ace + the 6 into
             a live 10). Folds into a live own-side build ONLY — a captured
             card never helps FOUND a build (founding needs the loose base) */
          for (let seat = 0; seat < g.numPlayers; seat++) {
            if (sameSide(g, seat, me)) continue;
            const pt = g.players[seat].pile[g.players[seat].pile.length - 1];
            if (!pt) continue;
            const need = b.value - r - C.rank(pt);
            if (need <= 0) continue;
            for (const sub of allSubsets(g.table, need, 8)) {
              const use = { type: 'augment', buildIdx: bi, card, loose: sub, victim: seat, method: 'combine' };
              if (cardUseLegal(g, me, card, use)) acts.push(use);
            }
          }
          if (2 * r === b.value) {
              for (let seat = 0; seat < g.numPlayers; seat++) {
                if (sameSide(g, seat, me)) continue;  // never dig a partner's pile
                const pile = g.players[seat].pile;
                const top = pile[pile.length - 1];
                if (top && C.rank(top) === r) {
                  const use = { type: 'dig', buildIdx: bi, card, victim: seat, method: 'dig' };
                  if (cardUseLegal(g, me, card, use)) acts.push(use);
                }
              }
            }
          }
        }
      }

      /* ---- preg: a HAND CARD ALONE raises an ENEMY's virgin build. Never
             your own, never a partner's — the rules bind every player
             equally. The landing value (target + card) decides everything ---- */
      for (const b of g.builds) {
        if (b.scaffold) continue;
        if (b.augmented) continue;                       // virgin targets only
        if (sameSide(g, b.owner, me)) continue;          // enemy builds only
        const bi = idxOf(b);
        for (const card of P.hand) {
          const V = b.value + C.rank(card);
          if (V > 10) continue;                          // a preg always raises, 10 is the ceiling
          const liveV = g.builds.find((x) => x.value === V && !x.scaffold);
          if (liveV && !sameSide(g, liveV.owner, me)) continue;   // E: enemy-live value — silence
          if (liveV) {
            /* B/C: the enemy build folds into the own-side live build of V,
               which locks — a merge, not a second build */
            const use = { type: 'preg', buildIdx: bi, card, value: V, mergeInto: idxOf(liveV) };
            if (cardUseLegal(g, me, card, use)) acts.push(use);
          } else {
            const tm = teammate(g, me);
            const partnerVirtual = tm != null && g.players[tm].virtual[V];
            const owner = partnerVirtual ? tm : me;              // D: partner's restart / A: mine
            if (owner === me && !P.hand.some((h) => h !== card && C.rank(h) === V)) continue; // must hold V
            if (buildsOwned(g, owner) >= 1) continue;             // second builds arrive only via Shiya
            const use = { type: 'preg', buildIdx: bi, card, value: V, owner };
            if (cardUseLegal(g, me, card, use)) acts.push(use);
          }
        }
      }
    }

    /* a cardless opening is owed: hand moves narrow to captures and tops */
    if (gate) {
      return acts.filter((a) => a.type === 'capture' ||
        (a.type === 'augment' && a.method === 'top')).concat(cardlessMoves(g, me, idxOf));
    }

    /* ---- cardless moves (before or after the hand card) — while the
       two-build force is live, only digs are free, never new folds ---- */
    {
      const cm = cardlessMoves(g, me, idxOf);
      acts.push(...(buildsOwned(g, me) >= 2 ? cm.filter((m) => m.type === 'topdig') : cm));
    }

    /* ---- end turn gate: hand card spent, no scaffold live, no enemy-fold
       lock owed, any cardless debt settled, and the two-build force (4 hands,
       second via Shiya) satisfied. NO safety valve — an empty action list is
       a detectable special case ---- */
    if (g.turnUsed && !scaffold && !lock && (!g.openedCardless || g.resolved) && buildsOwned(g, me) < 2) {
      acts.push({ type: 'endturn' });
    }
    return acts;
  }

  /* Pile-top digs: fold an opponent's pile top into an own-side build OR
     SCAFFOLD whose value it matches — the debt stands, nothing resolves.
     These are the no-hand-card moves of a turn. */
  function pileTopDigs(g, me, idxOf) {
    const out = [];
    for (const b of g.builds) {
      if (!sameSide(g, b.owner, me)) continue;
      const bi = idxOf(b);
      for (let seat = 0; seat < g.numPlayers; seat++) {
        if (sameSide(g, seat, me)) continue;   // never a partner's pile
        const top = g.players[seat].pile[g.players[seat].pile.length - 1];
        if (top && C.rank(top) === b.value) {
          out.push({ type: 'topdig', buildIdx: bi, victim: seat });
        }
      }
    }
    return out;
  }

  /* ---------- cardless moves & the resolution law (v4) ---------- */
  /* All cardless moves in one place: scaffolds, table-folds and pile-top
     digs. Every one must leave the player a capture-or-top escape for the
     rest of the turn — this single law produces the scaffold rule, the
     partner-build conditions and the reserved-card rule. */
  function cardlessMoves(g, me, idxOf) {
    const out = [];
    const P = g.players[me];
    const scaffoldLive = g.builds.some((b) => b.scaffold);

    /* scaffold: combine table cards summing to V — or a single base card of
       value V — into an UNREGISTERED stack in the discard area, of a value
       you hold; it must be captured or graduated before the turn ends, so it
       can only be FOUNDED before the hand card is spent. One scaffold at a
       time, no founding over a fold debt, and the founder must hold a free
       build slot (none at all in 2/3 hands — the graduation top requires
       owning nothing anyway) */
    if (!scaffoldLive && !g.builds.some((b) => b.captLock) && !g.turnUsed) {
      const slotFree = g.numPlayers === 4 ? buildsOwned(g, me) <= 1 : buildsOwned(g, me) === 0;
      if (slotFree) {
        const heldVals = [...new Set(P.hand.map((id) => C.rank(id)))];
        for (const V of heldVals) {
          if (g.builds.some((b) => b.value === V)) continue;   // no duplicate values
          /* pure table scaffolds: 2+ cards summing to V — a lone card is
             NEVER a build */
          for (const sub of allSubsets(g.table, V, 12)) {
            if (sub.length < 2) continue;
            out.push({ type: 'scaffold', cards: sub, value: V });
          }
          /* dig-foundings: an opponent's pile top (+ table cards) summing to V —
             ONLY onto a loose BASE of V (the owner's law: no base, no prompt).
             A lone pile top on its base is a legal two-card founding */
          const base = g.table.find((t) => C.rank(t) === V);
          if (base) {
            for (let seat = 0; seat < g.numPlayers; seat++) {
              if (sameSide(g, seat, me)) continue;
              const top = g.players[seat].pile[g.players[seat].pile.length - 1];
              if (!top) continue;
              const rest = V - C.rank(top);
              if (rest < 0) continue;
              const subs = rest === 0 ? [[]] : allSubsets(g.table, rest, 8);
              for (const sub of subs) {
                out.push({ type: 'scaffold', cards: sub, value: V, victim: seat });
              }
            }
          }
        }
      }
    }

    /* table-fold: fold table cards summing to a build's value into an
       own-side build OR SCAFFOLD (value unchanged; for a scaffold the
       capture-or-top debt stays exactly as it was — a fold never resolves it) */
    for (const b of g.builds) {
      if (!sameSide(g, b.owner, me)) continue;
      for (const sub of allSubsets(g.table, b.value, 8)) {
        out.push({ type: 'caugment', buildIdx: idxOf(b), loose: sub });
      }
    }

    /* MIXED cardless fold: an opponent's pile top + table cards together
       summing to an own-side build's value — his dug 2 + the table 8 into
       the 10-scaffold. Own side only; never a partner's pile */
    for (const b of g.builds) {
      if (!sameSide(g, b.owner, me)) continue;
      const bi2 = idxOf(b);
      for (let seat = 0; seat < g.numPlayers; seat++) {
        if (sameSide(g, seat, me)) continue;
        const top = g.players[seat].pile[g.players[seat].pile.length - 1];
        if (!top) continue;
        const rest = b.value - C.rank(top);
        if (rest <= 0) continue;               // the pure equal pile top is a topdig
        for (const sub of allSubsets(g.table, rest, 8)) {
          out.push({ type: 'digfold', buildIdx: bi2, victim: seat, loose: sub });
        }
      }
    }

    /* pile-top digs */
    out.push(...pileTopDigs(g, me, idxOf));

    /* digs and folds into an OPPONENT's build — fattening a capture you must
       then make. Only cardless, only while your hand card is unspent, and
       only if you hold the build's value (without it the move is charity).
       Once confirmed, the capture of that build is locked. */
    const lockLive = g.builds.some((b) => b.captLock);
    if (!scaffoldLive) {
      for (const b of g.builds) {
        if (b.scaffold) continue;                       // a scaffold takes no additions
        if (sameSide(g, b.owner, me)) continue;         // enemy builds only
        if (!b.captLock && lockLive) continue;             // one enemy lock at a time
        if (g.turnUsed) continue;                          // the capture needs the hand card
        if (!P.hand.some((h) => C.rank(h) === b.value)) continue;
        const bi = idxOf(b);
        for (const sub of allSubsets(g.table, b.value, 8)) {
          out.push({ type: 'efold', buildIdx: bi, loose: sub });
        }
        const tops = [];
        for (let s = 0; s < g.numPlayers; s++) {
          if (sameSide(g, s, me)) continue;
          const t = g.players[s].pile[g.players[s].pile.length - 1];
          if (t) tops.push({ seat: s, card: t });
        }
        for (const t of tops) {
          const rest = b.value - C.rank(t.card);
          const subs = rest === 0 ? [[]] : allSubsets(g.table, rest, 8);
          for (const sub of subs) out.push({ type: 'edig', buildIdx: bi, victims: [t.seat], loose: sub });
        }
        if (tops.length === 2) {
          const rest = b.value - C.rank(tops[0].card) - C.rank(tops[1].card);
          if (rest >= 0) {
            const subs = rest === 0 ? [[]] : allSubsets(g.table, rest, 8);
            for (const sub of subs) {
              out.push({ type: 'edig', buildIdx: bi, victims: [tops[0].seat, tops[1].seat], loose: sub });
            }
          }
        }
      }
    }

    /* after the hand card is spent a cardless move can create no debt, so
       the resolution law (and the reservation) no longer applies */
    return g.turnUsed ? out : out.filter((m) => cardlessLeavesResolution(g, me, m));
  }

  /* Simulate the cardless move on a lightweight view and require a capture
     or qualifying top to still exist afterwards. */
  function cardlessLeavesResolution(g, me, move) {
    const table = g.table.slice();
    const builds = g.builds.map((b) => ({
      value: b.value, cards: b.cards.slice(), owner: b.owner,
      augmented: b.augmented, scaffold: b.scaffold
    }));
    if (move.type === 'scaffold') {
      for (const id of move.cards) table.splice(table.indexOf(id), 1);
      builds.push({ value: move.value, cards: move.cards.slice(), owner: me, augmented: false, scaffold: true });
    } else if (move.type === 'caugment') {
      for (const id of move.loose) table.splice(table.indexOf(id), 1);
      builds[move.buildIdx].cards.push(...move.loose);
      builds[move.buildIdx].augmented = true;
    } else if (move.type === 'digfold') {
      for (const id of move.loose) table.splice(table.indexOf(id), 1);
      builds[move.buildIdx].cards.push(...move.loose);
      builds[move.buildIdx].augmented = true;
    }
    /* topdig only changes piles — resolutions read hand/table/builds */
    return resolutionExists(Object.assign({}, g, { table, builds }), me);
  }

  /* A capture or a qualifying top exists for this hand on the given view. */
  function resolutionExists(view, me) {
    const P = view.players[me];
    for (const card of P.hand) {
      const r = C.rank(card);
      for (const t of view.table) {
        if (C.rank(t) === r &&
          cardUseLegal(view, me, card, { type: 'capture', card, loose: [t], buildIds: [] })) return true;
      }
      for (let i = 0; i < view.builds.length; i++) {
        const b = view.builds[i];
        if (b.value !== r) continue;
        if (b.owner === me || !sameSide(view, b.owner, me)) {
          if (cardUseLegal(view, me, card, { type: 'capture', card, loose: [], buildIds: [i] })) return true;
        }
      }
    }
    for (const b of view.builds) {
      if (!sameSide(view, b.owner, me)) continue;
      const held = P.hand.filter((h) => C.rank(h) === b.value).length;
      if (held >= 1 && (b.owner !== me || held >= 2)) return true;
    }
    return false;
  }

  /* ---------- applying actions ---------- */
  function takeFromHand(p, card) {
    const i = p.hand.indexOf(card);
    if (i < 0) throw new Error('card not in hand: ' + card);
    p.hand.splice(i, 1);
  }
  function removeFromTable(g, ids) {
    for (const id of ids) {
      const i = g.table.indexOf(id);
      if (i < 0) throw new Error('card not on table: ' + id);
      g.table.splice(i, 1);
    }
  }
  function playedVirtual(g, seat, card) { delete g.players[seat].virtual[C.rank(card)]; }

  function applyAction(g, a) {
    const legal = legalActions(g).some((x) => sameAction(x, a));
    if (!legal) throw new Error('illegal action: ' + JSON.stringify(a));
    g.actionCount++;
    const me = g.players[g.turn];

    if (a.type === 'skip') {
      const sp = g.shiyaPending;
      addLog(g, 'build', names(g, sp.caller) + ' let the capture stand (no Shiya).');
      g.shiyaPending = null; g.phase = 'play';
      return;                       // the capturer's turn continues (End Turn only)
    }

    if (a.type === 'shiya') { applyShiya(g); return; }

    if (a.type === 'endturn') {
      advance(g);
      return;
    }

    if (a.type === 'topdig') {
      const b = g.builds[a.buildIdx];
      const victim = g.players[a.victim];
      const dug = victim.pile.pop();
      b.cards.push(dug);
      b.augmented = true;           // folding in a pile top locks the build
      if (!g.turnUsed) g.openedCardless = true;
      addLog(g, 'steal', act(me, 'digs', 'dig') + ' ' + C.label(dug) + ' from ' + victim.name +
        "'s pile into the " + b.value + '-build.');
      return;                       // no hand card spent — the turn continues
    }

    if (a.type === 'scaffold') {
      removeFromTable(g, a.cards);
      const founding = a.cards.slice();
      let dugFrom = null;
      if (a.victim != null) {
        founding.push(g.players[a.victim].pile.pop());
        dugFrom = names(g, a.victim);
      }
      const bases = absorbBases(g, a.value);            // a loose V joins as the base
      g.builds.push({ value: a.value, cards: [...bases, ...sortDesc(founding)], owner: me.id, augmented: false, scaffold: true });
      if (!g.turnUsed) g.openedCardless = true;
      addLog(g, 'build', act(me, 'builds', 'build') + ' ' + a.value + ' from the table' +
        (dugFrom ? ' and ' + dugFrom + '\u2019s pile' : '') + ' (' + fmt(sortDesc(founding)) +
        (bases.length ? ' + ' + fmt(bases) + ' base' : '') + ') — capture or top it this turn.');
      return;                       // no hand card spent — the obligation is live
    }

    if (a.type === 'caugment') {
      const b = g.builds[a.buildIdx];
      removeFromTable(g, a.loose);
      b.cards.push(...sortDesc(a.loose));   // the folded set, sorted, on top
      b.augmented = true;           // folding table cards locks the build
      if (!g.turnUsed) g.openedCardless = true;
      addLog(g, 'build', act(me, 'folds', 'fold') + ' ' + fmt(sortDesc(a.loose)) + ' into the ' + b.value + '-build.');
      return;                       // no hand card spent — the turn continues
    }

    if (a.type === 'digfold') {
      const b = g.builds[a.buildIdx];
      const dug = g.players[a.victim].pile.pop();
      removeFromTable(g, a.loose);
      b.cards.push(...sortDesc([dug, ...a.loose]));
      b.augmented = true;               // a fold locks a registered build; on a
                                        // scaffold it is honest state, nothing more
      if (!g.turnUsed) g.openedCardless = true;
      addLog(g, 'steal', act(me, 'digs', 'dig') + ' ' + C.label(dug) + ' from ' + names(g, a.victim) +
        '\u2019s pile with ' + fmt(a.loose) + ' into the ' + b.value + '-build.');
      return;                           // no hand card spent — the debt stands
    }

    if (a.type === 'efold') {
      const b = g.builds[a.buildIdx];
      removeFromTable(g, a.loose);
      b.cards.push(...sortDesc(a.loose));
      b.captLock = true;            // the capture of this build is now owed
      if (!g.turnUsed) g.openedCardless = true;
      addLog(g, 'build', act(me, 'folds', 'fold') + ' ' + fmt(sortDesc(a.loose)) + ' into ' +
        names(g, b.owner) + '\u2019s ' + b.value + '-build — for capture.');
      return;
    }

    if (a.type === 'edig') {
      const b = g.builds[a.buildIdx];
      const dug = [];
      for (const seat of a.victims) dug.push(g.players[seat].pile.pop());
      removeFromTable(g, a.loose || []);
      b.cards.push(...sortDesc(dug.concat(a.loose || [])));
      b.captLock = true;            // the capture of this build is now owed
      if (!g.turnUsed) g.openedCardless = true;
      addLog(g, 'steal', act(me, 'digs', 'dig') + ' ' + fmt(sortDesc(dug)) + ' from ' +
        a.victims.map((s) => names(g, s)).join(' and ') + '\u2019s pile into the ' + b.value + '-build — for capture.');
      return;
    }

    /* every remaining action spends the turn's one hand card */
    g.turnUsed = true;

    if (a.type === 'capture') {
      takeFromHand(me, a.card);
      playedVirtual(g, me.id, a.card);
      let taken, desc;
      if (a.scaffoldCap) {
        /* the scaffold stack leaves the discard area as one captured set */
        const sc = g.builds[a.buildIds[0]];
        taken = sc.cards.slice();
        desc = fmt(taken) + ' (the ' + sc.value + '-scaffold)';
        g.builds.splice(a.buildIds[0], 1);
      } else {
        taken = a.loose.slice();
        removeFromTable(g, a.loose);
        const buildCards = [];
        for (const idx of a.buildIds.slice().sort((x, y) => y - x)) {
          buildCards.push(...g.builds[idx].cards);
          g.builds.splice(idx, 1);
        }
        taken.push(...buildCards);
        desc = a.buildIds.length
          ? (buildCards.length + a.loose.length ? fmt(buildCards.concat(a.loose)) : '') + ' (build' + (a.buildIds.length > 1 ? 's' : '') + ')'
          : fmt(a.loose);
      }
      me.pile.push(...sortDesc(taken));   // this capture's set, sorted — played card on top
      me.pile.push(a.card);
      g.lastCapturer = me.id;
      if (g.openedCardless) g.resolved = true;   // a capture settles a cardless debt
      g.capturedThisTurn = true;                 // …and closes the taking for the turn
      addLog(g, 'capture', act(me, 'played', 'played') + ' ' + C.label(a.card) + ' and captured ' + (desc || '—') + '.');
      if (g.table.length === 0 && g.builds.length === 0) addLog(g, 'sweep', act(me, 'sweeps', 'sweep') + ' the table!');

      /* 4 hands: the partner gets a Shiya window (their call, not a move by
         the capturer); otherwise the turn is finished — End Turn only */
      const tm = teammate(g, me.id);
      if (tm != null) {
        const v = C.rank(a.card);
        const caller = g.players[tm];
        const canCall = caller.hand.some((h) => C.rank(h) === v) &&
          buildsOwned(g, tm) < maxSlots(g) &&
          !g.builds.some((b) => b.value === v); // no duplicate build values, ever
        if (canCall) {
          g.phase = 'shiya';
          g.shiyaPending = { capturer: me.id, caller: tm, playedCard: a.card, cards: taken.slice(), value: v };
          return;
        }
      }
      return;   // no steal — the dig is the only way cards leave an opponent's pile
    }

    if (a.type === 'discard') {
      takeFromHand(me, a.card);
      playedVirtual(g, me.id, a.card);
      g.table.push(a.card);
      addLog(g, 'drift', act(me, 'discards', 'discard') + ' ' + C.label(a.card) + ' into the discard area.');
      return;
    }

    if (a.type === 'basetop') {
      /* topping a loose base founds a live build: [base, your card] */
      const base = g.table.splice(g.table.indexOf(a.base), 1)[0];
      takeFromHand(me, a.card);
      playedVirtual(g, me.id, a.card);
      g.builds.push({ value: C.rank(a.card), cards: [base, a.card], owner: me.id, augmented: true });
      g.players[me.id].virtual[C.rank(a.card)] = true;
      addLog(g, 'build', act(me, 'tops', 'top') + ' the table ' + C.label(base) + ' with ' +
        C.label(a.card) + ' — a ' + C.rank(a.card) + '-build.');
      return;
    }

    if (a.type === 'build') {
      takeFromHand(me, a.card);
      playedVirtual(g, me.id, a.card);
      removeFromTable(g, a.loose);
      /* founding set: a compound founding keeps its BASE at the very bottom,
         every other card sorted on top of it */
      let bCards, logLine;
      if (a.victim != null) {
        const dug = g.players[a.victim].pile.pop();
        bCards = [...a.loose, ...sortDesc([a.card, dug])];
        logLine = act(me, 'builds', 'build') + ' ' + a.value + ' (' + C.label(a.card) + ' + ' +
          C.label(dug) + ' from ' + names(g, a.victim) + '\u2019s pile + ' + fmt(a.loose) + ' base)';
      } else {
        const set = sortDesc([a.card, ...a.loose]);
        const bases = absorbBases(g, a.value);          // a loose V joins as the base
        bCards = [...bases, ...set];
        logLine = act(me, 'builds', 'build') + ' ' + a.value + ' (' + fmt(set) +
          (bases.length ? ' + ' + fmt(bases) + ' base' : '') + ')';
      }
      g.builds.push({ value: a.value, cards: bCards, owner: a.owner, augmented: a.victim != null });
      g.players[a.owner].virtual[a.value] = true;
      if (a.owner !== me.id) logLine += ' (for ' + names(g, a.owner) + ')';
      addLog(g, 'build', logLine + '.');
      return;
    }

    if (a.type === 'augment') {
      const b = g.builds[a.buildIdx];
      takeFromHand(me, a.card);
      playedVirtual(g, me.id, a.card);
      removeFromTable(g, a.loose);
      /* the added set: sorted internally, placed on top of the build */
      let set = [a.card, ...a.loose];
      if (a.victim != null) set.push(g.players[a.victim].pile.pop());   // dig-fold
      b.cards.push(...sortDesc(set));
      b.augmented = true;               // the value is now locked
      if (a.method === 'top') {
        if (g.openedCardless) g.resolved = true;   // a top settles a cardless debt
        if (b.scaffold) {                          // topped scaffold becomes a live build
          b.scaffold = false;
          g.players[b.owner].virtual[b.value] = true;
        }
      }
      const setDesc = a.victim != null
        ? C.label(a.card) + ' + ' + C.label(set.find((id) => id !== a.card)) + ' from ' + names(g, a.victim) + '\u2019s pile'
        : fmt(sortDesc(set));
      addLog(g, 'build', (a.method === 'top' ? act(me, 'tops', 'top') : act(me, 'augments', 'augment')) +
        ' the ' + b.value + '-build with ' + setDesc + '.');
      return;
    }

    if (a.type === 'dig') {
      const b = g.builds[a.buildIdx];
      const victim = g.players[a.victim];
      const dug = victim.pile.pop();
      takeFromHand(me, a.card);
      playedVirtual(g, me.id, a.card);
      b.cards.push(...sortDesc([a.card, dug]));
      b.augmented = true;
      addLog(g, 'steal', act(me, 'digs', 'dig') + ' ' + C.label(dug) + ' from ' + victim.name +
        "'s pile with " + C.label(a.card) + ' into the ' + b.value + '-build.');
      return;
    }

    if (a.type === 'preg') {
      const b = g.builds[a.buildIdx];
      takeFromHand(me, a.card);
      playedVirtual(g, me.id, a.card);
      if (a.mergeInto != null) {
        /* B/C: the enemy build's cards plus the hand card fold into the
           own-side live build of V — a merge that locks the survivor */
        const live = g.builds[a.mergeInto];
        live.cards.push(...sortDesc([a.card, ...b.cards]));
        live.augmented = true;
        g.builds.splice(a.buildIdx, 1);
        addLog(g, 'build', act(me, 'pregs', 'preg') + ' the ' + b.value + '-build into ' +
          names(g, live.owner) + '\u2019s ' + a.value + '-build — absorbed and locked.');
      } else {
        /* A/D: the build rises to V — the pregger's, or restarted as the
           partner's when he virtually owns the value */
        b.cards.push(...sortDesc([a.card]));
        b.value = a.value;
        b.owner = a.owner;
        const pregBases = absorbBases(g, a.value);       // a loose V joins as the base
        if (pregBases.length) b.cards.unshift(...pregBases);
        g.players[a.owner].virtual[a.value] = true;
        addLog(g, 'build', act(me, 'pregs', 'preg') + ' the build up to ' + a.value +
          (a.owner !== me.id ? ' — it stands with ' + names(g, a.owner) + '.' : ' — now theirs!'));
      }
      return;
    }

    throw new Error('unknown action');
  }

  /* Convert the pending capture into a Shiya build owned by the caller. */
  function applyShiya(g) {
    const sp = g.shiyaPending;
    const capturer = g.players[sp.capturer];
    const caller = g.players[sp.caller];
    const n = sp.cards.length + 1;              // captured cards + played card
    capturer.pile.splice(capturer.pile.length - n, n);  // undo the capture
    if (capturer.pile.length === 0 && g.lastCapturer === sp.capturer) g.lastCapturer = null;
    g.builds.push({ value: sp.value, cards: [...sp.cards, sp.playedCard], owner: sp.caller, augmented: true });
    caller.virtual[sp.value] = true;
    addLog(g, 'build', caller.name + ' calls SHIYA — ' + capturer.name + ' leaves ' +
      C.label(sp.playedCard) + ' on the build; it moves to ' + caller.name + "'s area!");
    g.shiyaPending = null;
    g.phase = 'play';
    /* the capturer's turn continues — End Turn only (the taking is closed) */
  }

  function sameAction(x, y) {
    if (x.type !== y.type) return false;
    if (x.card !== y.card) return false;
    if ((!!x.scaffoldCap) !== (!!y.scaffoldCap)) return false;
    if ((x.mergeInto != null) !== (y.mergeInto != null)) return false;
    if (x.mergeInto != null && y.mergeInto != null && x.mergeInto !== y.mergeInto) return false;
    if ((x.victim != null) !== (y.victim != null)) return false;
    if (x.victim != null && y.victim != null && x.victim !== y.victim) return false;
    if (x.base !== y.base) return false;
    const ca = (x.cards || []).slice().sort();
    const cb = (y.cards || []).slice().sort();
    if (ca.length !== cb.length || !ca.every((v, i) => v === cb[i])) return false;
    const va = (x.victims || []).slice().sort();
    const vb = (y.victims || []).slice().sort();
    if (va.length !== vb.length || !va.every((v, i) => v === vb[i])) return false;
    if ((x.value || 0) !== (y.value || 0)) return false;
    if (x.victim !== y.victim) return false;
    if ((x.buildIdx != null) !== (y.buildIdx != null)) return false;
    if (x.buildIdx != null && y.buildIdx != null && x.buildIdx !== y.buildIdx) return false;
    if ((x.owner != null) !== (y.owner != null)) return false;
    if (x.owner != null && y.owner != null && x.owner !== y.owner) return false;
    const a = (x.loose || []).slice().sort();
    const b = (y.loose || []).slice().sort();
    if (a.length !== b.length || !a.every((v, i) => v === b[i])) return false;
    const ba = (x.buildIds || []).slice().sort();
    const bb = (y.buildIds || []).slice().sort();
    return ba.length === bb.length && ba.every((v, i) => v === bb[i]);
  }

  /* ---------- waves, end, scoring ---------- */
  function dealWave(g) {
    const d = DEAL[g.numPlayers];
    const per = Math.min(d.per, Math.floor(g.stock.length / g.numPlayers));
    if (per > 0) {
      for (let i = 0; i < per; i++) for (const p of g.players) p.hand.push(g.stock.pop());
      g.wave++;
      addLog(g, 'info', 'Round ' + g.wave + ' — new cards dealt from the stock.');
    }
    while (g.stock.length) g.players[g.stock.length % g.numPlayers].hand.push(g.stock.pop());
  }

  function advance(g) {
    if (!g.players.some((p) => p.hand.length > 0)) {
      if (g.stock.length > 0) dealWave(g);
      else { endGame(g); return; }
    }
    g.turn = (g.turn + 1) % g.numPlayers;
    g.turnUsed = false;          // fresh turn: the one hand card is unspent
    g.openedCardless = false;    // and no cardless debt carries over
    g.resolved = false;
    g.capturedThisTurn = false;
  }

  function endGame(g) {
    const leftovers = g.table.length + g.builds.reduce((n, b) => n + b.cards.length, 0);
    if (leftovers > 0) {
      if (g.lastCapturer != null) {
        const p = g.players[g.lastCapturer];
        const cards = g.table.splice(0);
        for (const b of g.builds) cards.push(...b.cards);
        g.builds = [];
        p.pile.push(...cards);
        addLog(g, 'capture', act(p, 'sweeps up', 'sweep up') + ' the ' + leftovers + ' leftover cards.');
      } else {
        addLog(g, 'info', 'Nobody ever captured; leftover cards score nothing.');
        g.table = []; g.builds = [];
      }
    }
    g.phase = 'gameover';
    addLog(g, 'score', 'Game over — scoring…');
  }

  function pileStats(pile) {
    let cards = pile.length, spades = 0, s2 = 0, d10 = 0, aces = 0, points = 0;
    for (const id of pile) {
      const c = C.parse(id);
      if (c.suit === 'S') spades++;
      if (id === 'S2') s2++;
      if (id === 'D10') d10++;
      if (c.rank === 1) aces++;
      points += C.points(id);
    }
    return { cards, spades, s2, d10, aces, points };
  }

  function scoreGame(g) {
    const teamMode = g.numPlayers === 2 || g.numPlayers === 4;
    const teams = teamMode ? teamsOf(g) : g.players.map((p) => [p.id]);
    const stats = teams.map((team) => {
      const agg = { cards: 0, spades: 0, s2: 0, d10: 0, aces: 0, points: 0 };
      for (const id of team) {
        const s = pileStats(g.players[id].pile);
        for (const k in agg) agg[k] += s[k];
      }
      return {
        members: team,
        name: team.length === 1 ? g.players[team[0]].name
          : g.players[team[0]].name + ' & ' + g.players[team[1]].name,
        ...agg, mostCards: 0, mostSpades: 0
      };
    });
    if (teamMode) {
      awardMost(stats, 'cards', 'mostCards');
      awardMost(stats, 'spades', 'mostSpades');
    }
    for (const t of stats) t.total = t.points + t.mostCards + t.mostSpades;
    const max = Math.max(...stats.map((t) => t.total));
    const winners = stats.filter((t) => t.total === max).map((t) => t.name);
    return { teamMode, totalInPlay: teamMode ? 11 : 7, stats, winners, tie: winners.length > 1 };
  }
  function awardMost(stats, key, field) {
    const max = Math.max(...stats.map((t) => t[key]));
    if (max === 0) return;
    const best = stats.filter((t) => t[key] === max);
    if (best.length === 1) best[0][field] = 2;
  }

  const Rules = {
    DEAL, createGame, legalActions, applyAction, scoreGame, isTeammate, sameSide, teammate,
    teamsOf, pileStats, canSum, allSubsets, sameAction, mulberry32,
    maxSlots, buildsOwned, resolutionExists
  };
  root.Rules = Rules;
  if (typeof module !== 'undefined' && module.exports) module.exports = Rules;
})(typeof window !== 'undefined' ? window : globalThis);
