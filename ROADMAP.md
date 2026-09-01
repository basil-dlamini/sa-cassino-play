# South African Cassino — Roadmap & Parked Ideas

Living document of decisions, parked ideas and future work. Owner: ZEF Studios.
Nothing here is built until explicitly ordered.

## Where we are

- **Phase 1 (current):** finish two-hands rules + feel through playtesting;
  then three- and four-hands polish. Tutorial mode exists (coach, counters,
  hints); competitive is its stripped twin. Engine v5.3.

## Online & accounts (Phase 3 prep — parked, do not build yet)

- **Auth v1: username + password only.** No email required at sign-up —
  email sign-in is believed to deter some players. Email/socials can be
  LINKED to the account later, optionally.
- Incentives to link: in-game rewards for linking email/socials; bigger
  rewards for publishing in-game achievements to socials.

## Tournament mode (competitive addition — parked)

- Weekly / monthly / quarterly / yearly tournaments + leaderboards.
- Structure undecided (to brainstorm).
- Reward ideas: ad-free time scaled to the tier — a week of no ads for
  winning/topping the weekly, a month for the monthly, etc.

## Social & customization (parked)

- Pre-set dialogue between players + emojis.
- User-uploaded custom emotes/dialogue — requires review & approval before
  use in game.
- Skins and further cosmetic customization (monetization angle — see Themes).

## Previously parked (from earlier sessions)

- Graphics quality setting; game forces a setting based on phone performance.
  Default is already low-graphics (low-end phones, slow data — the market:
- South Africa, Mozambique, Eswatini, Lesotho).
- Theme shop as purchases (Ivory & Gold default; Midnight Casino & Classic
  Print alternatives on file).
- Reward system gifting free tutorial hints (hints otherwise cost an ad).
- Online mode: 45-second turn timer; the End Turn button carries it.
- No score counter in competitive/multiplayer modes.
- "Special cases" design: when an illegal move slips through, the opponent
  may remedy its implications or willingly accept it and play on.
- Multiplayer must be server-authoritative (engine already DOM-free; the
  same rules.js is meant to run on the server unchanged).
- Publishing targets: web + itch.io (free), Google Play ($25 once),
  Apple ($99/yr, deferrable), Electron for PC. Landing page + domain when
  applying anywhere.
- Phase 5 conversations (only with a published game in hand): Z.ai startup
  application; regulated iGaming pivot (GLI certification, provincial
  boards) — legal advice required before any of it.

## Rule decisions still open (test as they surface)

- Augmenting an opponent's build under "special circumstances" (owner to
  explain later).
- Tournament structuring (above).
- Anything the deadlock alert surfaces in play.

## Start-of-match & rematch flow (settled 2026-09-01)
- TWO/THREE hands: first player drawn at random each match (built — the deal is luck).
- FOUR hands (ONLINE phase): the starting PAIR is drawn at random; either partner may
  open — both turns stand open and the FIRST CONFIRMED DISCARD sets the order. Owner's
  note: there is an advantage to NOT starting, depending on the hand you are dealt —
  AI personalities/play styles will make this matter locally too.
- TWO hands rematch: both players choose Home/lobby or Replay; one picks replay → the
  other accepts or declines (online prompt). Reshuffle and redeal; the LOSER of the
  last game always plays first. Built locally: the winner deals on Play Again.
- THREE/FOUR hands: NO rematch — everyone returns to the lobby so waiting players get
  their turn (built locally: Play Again hidden). To be revisited when AI players get
  multiple personalities/play styles, and for 2-humans-vs-AI pairings (two humans
  vs two AIs, or each human partnering an AI).
