/* cards.js — the deck itself.
   A card is a small string id like "S10" (Suit + rank 1..10).
   Jacks, Queens and Kings are excluded: the SA Cassino deck is 40 cards. */
(function (root) {
  const SUITS = ['S', 'H', 'D', 'C'];
  const SUIT_GLYPH = { S: '\u2660', H: '\u2665', D: '\u2666', C: '\u2663' };
  const SUIT_NAME = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
  const RANK_LABEL = { 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10' };

  function parse(id) { return { suit: id[0], rank: parseInt(id.slice(1), 10) }; }
  function rank(id) { return parse(id).rank; }
  function makeDeck() {
    const d = [];
    for (const s of SUITS) for (let r = 1; r <= 10; r++) d.push(s + r);
    return d;
  }
  function label(id) { const c = parse(id); return RANK_LABEL[c.rank] + SUIT_GLYPH[c.suit]; }
  function longLabel(id) { const c = parse(id); return RANK_LABEL[c.rank] + ' of ' + SUIT_NAME[c.suit]; }
  /* Scoring points a card is worth at the end of a hand (absolute categories). */
  function points(id) {
    const c = parse(id);
    if (c.rank === 1) return 1;   // every Ace
    if (id === 'S2') return 1;    // "spy two"
    if (id === 'D10') return 2;   // "mummy"
    return 0;
  }
  function shuffled(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* Hand order used at the table: highest value on the LEFT.
     Rank first (10 … A). Within a rank: 10♦ ("big 10") beats 10♠;
     every other rank is led by spades, then hearts, diamonds, clubs. */
  function suitWeight(id) {
    const c = parse(id);
    if (c.rank === 10) return { D: 0, S: 1, H: 2, C: 3 }[c.suit];
    return { S: 0, H: 1, D: 2, C: 3 }[c.suit];
  }
  function compare(a, b) {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return rb - ra;
    return suitWeight(a) - suitWeight(b);
  }

  const api = { SUITS, SUIT_GLYPH, SUIT_NAME, RANK_LABEL, parse, rank, makeDeck, label, longLabel, points, shuffled, suitWeight, compare };
  root.Cards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
