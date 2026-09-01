/* ai.js — the seasoned-player opponent, v2 (builds, ownership, Shiya, dig).
   The AI only ever sees what a real player sees: its hand, the discard area,
   the builds (and their owners), everyone's piles and their top cards. It
   never peeks into other hands or the stock — when a partner's build relies
   on virtual ownership, the AI assumes exactly what a human may assume.

   Decision making follows table instinct:
     1. Assess — who's ahead, what's on the table, whose builds are live.
     2. Prioritise — steals/digs, big captures, safe builds, lethal pregs,
        careful discards.
     3. Risk — how much opportunity does each move hand the next player?
     4. Execute — highest-scoring legal action wins (tiny randomness for
        variety). Shiya windows get their own judgement call. */
(function (root) {
  const C = root.Cards;
  const R = root.Rules;

  const PERSONALITIES = {
    thandi:  { label: 'Patient',     points: 1.0,  threat: 1.35, build: 1.2,  steal: 1.25 },
    sipho:   { label: 'Aggressive',  points: 1.35, threat: 0.55, build: 0.65, steal: 1.5 },
    naledi:  { label: 'Calculating', points: 1.1,  threat: 1.05, build: 1.0,  steal: 1.15 }
  };

  function expectedOpponentCopies(g, me, value) {
    let seen = 0;
    for (const h of g.players[me].hand) if (C.rank(h) === value) seen++;
    for (const t of g.table) if (C.rank(t) === value) seen++;
    for (const b of g.builds) for (const t of b.cards) if (C.rank(t) === value) seen++;
    const unseenCopies = Math.max(0, 4 - seen);
    const unseenCards = 40
      - g.players[me].hand.length
      - g.table.length
      - g.builds.reduce((n, b) => n + b.cards.length, 0)
      - g.players.reduce((n, p) => n + p.pile.length, 0);
    if (unseenCards <= 0) return 0;
    const oppHandCount = g.players.reduce((n, p) =>
      n + (R.sameSide(g, p.id, me) ? 0 : p.hand.length), 0);
    return unseenCopies * (oppHandCount / unseenCards);
  }

  function threatAfter(g, me, action) {
    let table = g.table.slice();
    const builds = g.builds.map((b) => ({ value: b.value, owner: b.owner, augmented: b.augmented }));
    if (action.type === 'capture') {
      const set = new Set(action.loose);
      table = table.filter((id) => !set.has(id));
      for (const idx of (action.buildIds || []).slice().sort((a, b) => b - a)) builds.splice(idx, 1);
    } else if (action.type === 'discard') {
      table.push(action.card);
    } else if (action.type === 'build') {
      const set = new Set(action.loose);
      table = table.filter((id) => !set.has(id));
      builds.push({ value: action.value, owner: action.owner });
    } else if (action.type === 'augment' || action.type === 'dig') {
      const set = new Set(action.loose);
      table = table.filter((id) => !set.has(id));
    } else if (action.type === 'preg') {
      const set = new Set(action.loose);
      table = table.filter((id) => !set.has(id));
      const b = builds[action.buildIdx];
      if (b) { b.value = action.value; b.owner = me; }
    }
    const ranks = table.map((id) => C.rank(id));
    let n = 0;
    for (let s = 2; s <= 10; s++) {
      if (builds.some((b) => b.value === s)) { n++; continue; }
      let ok = R.canSum(ranks, s);
      if (!ok) {
        for (const b of builds) {
          if (b.value < s && R.canSum(ranks, s - b.value)) { ok = true; break; }
        }
      }
      if (ok) n++;
    }
    return n;
  }

  function pilePointsOf(ids) { return ids.reduce((n, id) => n + C.points(id), 0); }

  function assess(g, me) {
    const info = { me, myStats: R.pileStats(g.players[me].pile), tops: [], foes: [] };
    for (const p of g.players) {
      if (R.sameSide(g, me, p.id)) continue;
      info.foes.push(p.id);
      const top = p.pile[p.pile.length - 1];
      if (top) info.tops.push({ player: p.id, card: top });
    }
    const foePts = Math.max(0, ...info.foes.map((id) => R.pileStats(g.players[id].pile).points));
    info.ahead = info.myStats.points - foePts;
    return info;
  }

  function scoreActions(g, info, actions, w, rng) {
    const me = info.me;
    return actions.map((a) => {
      let s = 0, why = '';

      if (a.type === 'capture') {
        const taken = a.loose.slice();
        for (const idx of (a.buildIds || [])) taken.push(...g.builds[idx].cards);
        const pts = pilePointsOf(taken) + C.points(a.card);
        s += w.points * (pts * 1.6 + 0.55 * taken.length);
        const clears = g.table.length === a.loose.length && g.builds.length === (a.buildIds || []).length;
        if (clears) s += 0.8;
        s -= w.threat * 0.14 * threatAfter(g, me, a);
        why = taken.length >= 2 ? 'multi-card capture' : (pts > 0 ? 'takes point cards' : 'capture');
      }

      if (a.type === 'augment' || a.type === 'dig') {
        const b = g.builds[a.buildIdx];
        const folding = (a.loose || []).slice();  // dig actions fold no loose cards
        const pts = pilePointsOf(folding) + C.points(a.card);
        const ownSideBuild = R.sameSide(g, b.owner, me);
        s += w.build * (0.5 + 0.3 * pts + 0.45 * folding.length);
        if (a.type === 'dig') {
          const dugTop = g.players[a.victim].pile[g.players[a.victim].pile.length - 1];
          s += w.steal * (C.points(dugTop) * 1.3 + 0.5);  // dig robs the opponent's pile
          why = 'digs into their pile';
        }
        if (ownSideBuild && b.owner === me) s += w.build * 0.3;
        s -= w.threat * 0.2;
        if (!why) why = a.method === 'top' ? 'tops the build' : 'augments the build';
      }

      if (a.type === 'preg') {
        const b = g.builds[a.buildIdx];
        const enemy = !R.sameSide(g, b.owner, me);
        const absorbed = pilePointsOf(b.cards);
        if (enemy) {
          s += w.points * (1.0 + 0.35 * absorbed + 0.4 * b.cards.length); // hijack!
          why = 'pregs the enemy build to steal it';
        } else {
          s += w.build * 0.4;
          why = 'raises own build';
        }
        const risk = expectedOpponentCopies(g, me, a.value);
        s -= w.threat * 1.1 * risk;
      }

      if (a.type === 'build') {
        const folding = a.loose.slice();
        const pts = pilePointsOf(folding);
        s += w.build * (0.5 + 0.3 * pts + 0.45 * folding.length);
        const holder = a.owner;
        const backups = g.players[holder].hand.filter(
          (h) => h !== a.card && C.rank(h) === a.value).length;
        if (backups >= 2) s += w.build * 1.0;  // two capture cards = much safer
        else s -= w.build * 0.45;
        const risk = expectedOpponentCopies(g, me, a.value);
        s -= w.threat * 1.15 * risk;
        if (holder !== me) s += w.build * 0.35; // partner-virtual builds are gifts
        why = 'builds ' + a.value;
      }

      if (a.type === 'scaffold') {
        s += w.build * 0.55;                      // free build — resolves this turn
        why = 'builds from the table';
      }

      if (a.type === 'basetop') {
        s += w.build * 0.6;                       // founds a live build from a loose base
        why = 'tops the loose base';
      }

      if (a.type === 'edig' || a.type === 'efold') {
        const set = (a.loose || []).concat(
          (a.victims || []).map((s2) => g.players[s2].pile[g.players[s2].pile.length - 1]).filter(Boolean));
        s += w.build * (0.25 + 0.3 * pilePointsOf(set));   // fattens a capture I must make
        why = 'fattens the capture';
      }

      if (a.type === 'digfold') {
        const dug = g.players[a.victim].pile[g.players[a.victim].pile.length - 1];
        const set = (a.loose || []).concat([dug]);
        s += w.build * (0.3 + 0.3 * pilePointsOf(set)) + w.steal * (C.points(dug) * 1.1 + 0.4);
        why = 'digs a card into the build';
      }

      if (a.type === 'discard') {
        const c = C.parse(a.card);
        s -= 2.6 * C.points(a.card);
        if (a.card === 'D10') s -= 1.2;
        if (c.rank >= 9) s -= 0.7;
        if (c.suit === 'S') s -= 0.35;
        if (c.rank >= 4 && c.rank <= 7) s += 0.35;
        s -= w.threat * 0.18 * (threatAfter(g, me, a) - threatAfter(g, me, { type: 'capture', loose: [], buildIds: [] }));
        why = 'safest discard';
      }

      s += rng() * 0.05;
      return { action: a, score: s, why };
    }).sort((x, y) => y.score - x.score);
  }

  function chooseAction(g) {
    const acts = R.legalActions(g);
    if (!acts.length) return null;

    if (g.phase === 'shiya') {
      // Shiya converts the partner's capture into a build I own and must
      // capture later. Call it when the cards are worth the commitment.
      const sp = g.shiyaPending;
      const cards = sp.cards.length + 1;
      const pts = pilePointsOf(sp.cards) + C.points(sp.playedCard);
      const alreadyTwo = R.buildsOwned(g, sp.caller) >= 1; // would trigger the force
      const worth = pts * 1.2 + cards * 0.45 >= 2.2;
      if (worth && (!alreadyTwo || pts >= 3)) return { type: 'shiya' };
      return { type: 'skip' };
    }

    const me = g.turn;
    let w = PERSONALITIES[g.players[me].personality] || PERSONALITIES.naledi;
    const info = assess(g, me);
    if (info.ahead < 0) w = { ...w, threat: w.threat * 0.8, points: w.points * 1.1 };

    /* multi-move turns: once the hand card is spent, only free cardless moves
       and the turn's end remain — rob worthwhile digs, then end */
    const free = ['topdig', 'caugment', 'digfold', 'edig', 'efold', 'endturn'];
    const playActs = acts.filter((a) => !free.includes(a.type));
    if (!playActs.length) {
      const worth = acts.filter((a) => (a.type === 'topdig' || a.type === 'edig' || a.type === 'digfold') && (() => {
        const tops = (a.victims || [a.victim]).map((v) => g.players[v].pile[g.players[v].pile.length - 1]).filter(Boolean);
        return tops.some((top) => C.points(top) > 0 || C.rank(top) >= 8);   // rob points or a big card
      })());
      return worth.length ? worth[0] : { type: 'endturn' };
    }

    const ranked = scoreActions(g, info, playActs, w, g.rng);
    return ranked[0].action;
  }

  function explain(g, a) {
    if (!a) return 'No action available.';
    const who = g.players[g.phase === 'shiya' ? g.shiyaPending.caller : g.turn];
    const n = who.name === 'You' ? 'You' : who.name;
    switch (a.type) {
      case 'capture': {
        const parts = [];
        for (const idx of (a.buildIds || [])) parts.push('the ' + g.builds[idx].value + '-build');
        if (a.loose.length) parts.push(a.loose.map((id) => C.label(id)).join(' + '));
        return n + ': play ' + C.label(a.card) + ' to capture ' + (parts.join(' + ') || '…');
      }
      case 'build': return n + ': build ' + a.value + ' with ' + C.label(a.card) +
        (a.loose.length ? ' + ' + a.loose.map((id) => C.label(id)).join(' + ') : '') + '.';
      case 'augment': return n + ': ' + (a.method === 'top'
        ? 'top the ' + g.builds[a.buildIdx].value + '-build with ' + C.label(a.card)
        : 'augment the ' + g.builds[a.buildIdx].value + '-build with ' + C.label(a.card) +
          (a.loose.length ? ' + ' + a.loose.map((id) => C.label(id)).join(' + ') : '')) + '.';
      case 'dig': return n + ': dig with ' + C.label(a.card) +
        ' from ' + g.players[a.victim].name + "'s pile into the " + g.builds[a.buildIdx].value + '-build.';
      case 'topdig': return n + ': dig ' + C.label(g.players[a.victim].pile[g.players[a.victim].pile.length - 1]) +
        ' from ' + g.players[a.victim].name + "'s pile into the " + g.builds[a.buildIdx].value + '-build.';
      case 'scaffold': return n + ': build ' + a.value + ' from the table alone — it must be captured or topped this turn.';
      case 'caugment': return n + ': fold table cards into the ' + g.builds[a.buildIdx].value + '-build.';
      case 'efold': return n + ': fold table cards into the enemy ' + g.builds[a.buildIdx].value + '-build — for capture.';
      case 'digfold': {
        const dug = g.players[a.victim].pile[g.players[a.victim].pile.length - 1];
        return n + ': dig ' + C.label(dug) + ' + table cards into the ' + g.builds[a.buildIdx].value + '-build.';
      }
      case 'edig': {
        const from = (a.victims || []).map((v) => g.players[v].name).join(' and ');
        return n + ': dig from ' + from + '\u2019s pile into the enemy ' + g.builds[a.buildIdx].value + '-build — for capture.';
      }
      case 'basetop': return n + ': top the loose ' + C.rank(a.base) + ' — a live build.';
      case 'endturn': return '';
      case 'preg': {
        const b = g.builds[a.buildIdx];
        return a.mergeInto != null
          ? n + ': preg the ' + b.value + '-build into the ' + a.value + '-build — absorbed and locked.'
          : n + ': preg the ' + b.value + '-build up to ' + a.value + '.';
      }
      case 'discard': return n + ': discard ' + C.label(a.card) + ' — it gives the opponents the least.';
      case 'shiya': return n + ': call SHIYA — take the build!';
      case 'skip': return n + ': pass.';
    }
    return '';
  }

  function hint(g) {
    const a = chooseAction(g);
    return { action: a, text: explain(g, a) };
  }

  const AI = { PERSONALITIES, chooseAction, explain, hint, assess };
  root.AI = AI;
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
})(typeof window !== 'undefined' ? window : globalThis);
