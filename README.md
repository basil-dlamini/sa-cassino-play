# South African Cassino — how to run and play

## The one-step way to play
Double-click **`Play South African Cassino.bat`** in this folder.
It starts a tiny local server and opens the game in your browser.

Even simpler: double-click **`index.html`** — the game runs straight from the file.

## What's in this folder
| File | What it is (plain English) |
|------|----------------------------|
| `index.html` | The game itself — open this to play |
| `tests.html` | The automated rule tests — open and read the green/red summary |
| `js/cards.js` | The 40-card deck (A–10, no face cards) |
| `js/rules.js` | The referee: every rule of the game lives here |
| `js/ai.js` | The opponents' brains (Sipho, Thandi, Naledi) |
| `js/ads.js` | The advertising system (mock ads now, real network later) |
| `js/audio.js` | Sound effects (generated, no audio files) |
| `js/ui.js` | Everything you see and click |
| `css/style.css` | The look — green felt, cards, animations |
| `js/tests.js` | The 31 automated tests, incl. 260 simulated games |
| `serve.ps1`, `.bat` | The tiny local server + launcher |

## The house rulings built into this version (v2)
Terminology: **discard** (to the discard area), **top/augment** (equal-value
card onto a build), **preg** (raise a build's value — only before it is
augmented), **dig** (take an opponent's matching pile-top into a build),
**Shiya** (a partner's "leave it to me" call).
1. Builds have owners. In pairs, only the owner (or an opponent) captures a
   build — never the owner's partner. Opponents may not top or augment it.
2. While any build is live, no player may discard a card of its value.
3. A build's owner may only spend a matching card to capture that build,
   augment it, or while holding a second card of that value.
4. Topping keeps a build's value; any augment (top, combine, dig) locks the
   value forever — no preg afterwards.
5. Digging takes only from opponents' piles: play x, take their matching
   top x, both fold into a build of value 2x.
6. Virtual ownership: creating (or Shiya-receiving) a value marks you as its
   owner until you play that value; a partner may then build it for you.
7. Shiya (pairs): when your partner captures, you may convert the capture
   into a build in your area (tick box when they build, or the 3-second
   window after any capture). Two builds in one area forces the capture of
   one on your next turn — a second self-owned build can only arrive via
   Shiya.
8. Two-hand game: first round, a player with a live build cannot discard at
   all; the second round lifts that lock. The stock re-deals once (two rounds).
9. 4 hands are ALWAYS pairs (opposite seats partner). No duplicate build
   values are ever live. Last capturer sweeps leftovers at game end.
10. Scoring universe: 11 points (2 players and 4-hand pairs: Most cards 2,
    Most spades 2, 2♠ 1, 10♦ 2, four Aces 4); 7 points for 3 singles.

## The AI opponents
- **Sipho (Aggressive)** — grabs points and steals quickly, builds less.
- **Thandi (Patient)** — protects the table, builds when safe, waits.
- **Naledi (Calculating)** — balanced risk/reward play.
They only see what a human sees: their hand, the table, everyone's piles.
When losing, they take more risks. They always steal a valuable top card.

## Money (currently MOCK)
- **Banner** at the bottom during play.
- **Interstitials** between games / returning to menu — at most every 2nd
  game and at least 3 minutes apart (deliberately gentle).
- **Rewarded video** only when you ask: the 💡 Hint button.
- **Remove ads $2.99** in Settings — a mock purchase (nothing is charged).
When the game is later packaged for the app stores, `js/ads.js` gets a real
network adapter (AdMob / Unity Ads) with the same three functions and the
rest of the game doesn't change.

## Tests
Open `tests.html` — all 32 must pass. The fuzz test plays 240 full games
(2/3/4 players, 4 hands always as pairs) and checks after EVERY move:
all 40 cards always accounted for, builds never stranded, captures truly
forced, games always finish, scores always sane.

## Changing things
This is version 1. Play it, note what feels wrong (AI too weak/strong,
confusing buttons, wrong rule interpretation), and bring the list back.
That's the loop we agreed on: build, test, improve, repeat.
