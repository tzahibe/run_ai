# Development log

Every feature this game grew, every bug it hit, and what fixed each one. Kept in
the order things happened. Where a bug now has a test guarding it, the test is
named — that is the whole point of writing this down.

Run them all:

```bash
node tools/simtest.js && node tools/roomtest.js && node tools/viewtest.js
```

---

## 1 · The single-player prototype

Started as one HTML file: canvas, fixed-timestep physics, a seeded track, and
bots to race. Decisions that stuck:

- **y-up world space.** The canvas transform is flipped (`setTransform(s,0,0,-s,…)`)
  so gameplay code reads "height above the ground" instead of "pixels from the top".
  Text has to be un-flipped (`ctx.scale(1,-1)`) before it is drawn — every piece of
  on-screen text in the renderer does this.
- **Fixed timestep with an accumulator.** Physics never sees a variable `dt`.
- **The track is a seed, not a file.** `buildTrack(def, seed)` is deterministic
  (mulberry32), so the server sends one number and both sides build the same
  19,000 metres.

Added along the way: double jump, slide, melee, pickups (rocket, grenade, freeze,
shield, jetpack, sawtrap, digger), a crate that pops its contents out, a HUD, and
a results screen.

## 2 · Characters and art

The first characters were hand-drawn vectors, and they were rejected — twice.
The honest conclusion, after the second attempt: this approach had a ceiling, and
drawing them in code was not going to clear it.

**What worked instead:** generated sprite art, dropped into `tools/sprite.py`,
which trims, scales to 360 px, quantizes to a 128-colour palette (PIL FASTOCTREE)
and writes `client/sprites/<id>.png`. That cut each sprite ~86% (215 KB → 27 KB).

Ten racers, each a still image. Motion is faked from that one frame — bob, lean,
squash, sway, hover, spin, dust — driven by a per-character `run: {…}` block. Each
also has an `atk: {…}`: reach, knockback, stun, pop, cost. Tank charges, Pixel jabs.

## 3 · Coins had to mean something

Finishing first is what matters, so a coin that only adds to a score is noise.
**Twelve coins buy two seconds of turbo**, spent the instant the twelfth lands.
A coin line through a jump arc is now a real decision: the detour costs metres now
and returns them later.

## 4 · Multiplayer

Chosen deliberately: **an authoritative server**, not a peer-to-peer room.

- Server simulates at 60 Hz, sends a snapshot every 3rd tick.
- Client predicts locally, and when a snapshot disagrees it **replays** its
  unacknowledged inputs from the server's state.
- Other players are **interpolated** 110 ms in the past, which is what makes them
  look smooth instead of teleporting.
- Melee is **lag-compensated**: the server rewinds everyone by the attacker's
  RTT/2 (capped at 260 ms) before testing the swing.
- Input is a packed bit field (`IN_JUMP|IN_SLIDE|IN_USE|IN_ATK|IN_RUN`) with edge
  detection against `lastBits`, so a held key fires once.

Each tab can impose its own latency, jitter and loss, which is how most of the
bugs below were found. Only snapshots are droppable — control messages are not.

## 5 · Lobby, rooms and the entry gate

Named rooms with optional passwords, a list of everyone online, shared chat with
join/leave notices, host-only track selection, Ready gating (the host is exempt),
idle kick after a minute, and a character/name gate on entry with optional Google
sign-in (RS256 verification against Google's JWKS).

"Find match" was kept as it was, with one change: the queue window is 10 seconds,
**extending when someone joins** (max 15), because two friends clicking at nearly
the same moment were landing in different races.

## 6 · Tracks, scenery and weather

Each track now carries its own kit: `theme` (props along the ground), `weather`
(what falls from the sky), `wind`, `storm`, and its own obstacle colours.

**Frostpeak** is the newest: snow-laden pines, drifts, a snowman, blowing snow
driven by a gust that comes and goes — and lightning. A bolt is announced with a
flicker (`boltwarn`), lands 0.55 s later (`bolt`), and anyone within 70 px is
**charred**: black as coal for 1.5 s, and slowed to 55% while they burn. A shield
blocks it. The strike is aimed near the middle of the pack, not at a person, so
leading is never punished.

The scenery is deliberately held back — sparser, softer, and never within 150 px
of a crate — because the first version was pretty and unreadable: players stopped
noticing the crates. Crates now hop in place, glow, and show an arrow when your
hands are empty.

## 7 · Terrain, and tracks twice as long

Every track doubled (22-38 km) and gained real ground to deal with, drawn from a
per-map palette so the obstacles belong to their setting and no piece appears
twice in a row:

- **Stairs** - the only solid-sided geometry in the game. A step within `CLIMB`
  (38 px) of your feet lifts you as you touch it; anything taller stops you.
- **Sliding platforms** - horizontal drifts and vertical lifts, `moverAt(m, t)`,
  a pure function of the race clock. They carry their passenger.
- **Blinking platforms** - `blinkOn(b, t)`, solid for 62% of a cycle, always over
  solid ground.
- **Launch pads**, **ice** (`ICE_GRIP` cuts acceleration, so you keep momentum
  and cannot steer) and **conveyors** (the floor adds its own velocity).

Nothing new travels over the wire: all of it comes from the seed and the race
clock, which is also why the client can predict it.

---

# Bugs, and what fixed them

### Beam trap: everyone stuck under a hazard
Racers stood in a beam's hit zone and were re-stunned every frame.
**Fix:** `clearOf()` pushes them clear of the hazard's span, a "you cannot stand up
under a ceiling" rule, and narrower beams (110 → 84).

### Bots fell in the same pit forever
The jump trigger fired far too early.
**Fix:** a late-jump window computed from `range = vx * 0.62` and the gap width;
later replaced by `edgeAhead()`, which counts floating platforms as landing spots.
**Guarded by:** `roomtest.js` — every bot must finish every track.

### Bots chain-stunned each other at the start
**Fix:** two seconds of no contact at the start, 2–5 s pacing between bot attacks,
and freeze now respects the mercy window.

### Input deadlock under packet loss
The client resent its *newest* unacknowledged inputs; the server waited for a
sequence number that was never coming and blocked that player forever.
**Fix, both ends:** the client sends `pending.slice(0, INPUT_REDUNDANCY)` — oldest
first — and the server skips sequence holes instead of waiting.
**Guarded by:** `soak.js` at 280 ms / 8% loss.

### A late lobby message threw a racing player back to the lobby
Jitter reorders packets, so a `queued` message could arrive *after* the race had
started. **Fix:** state guards in `net.js` — a message that would change state is
ignored while racing.

### Loss was being applied to control traffic
The network simulator dropped one-shot `match` messages, so a player never got
into the race. **Fix:** only `snap` is unreliable.

### The input pacer oscillated
It steered by the server-reported buffer depth, which is one RTT stale.
**Fix:** a local estimate, `estBuf = pending.length - inFlight`.

### Bots held the jump key
Jump is edge-triggered, so they jumped once and never again.
**Fix:** a one-tick release before re-pressing.

### The second race showed only yourself
`_lastSnapK` was not reset on a new match, so every snapshot of the new race was
discarded as stale. **Fix:** `_onMatch` resets `_lastSnapK`, `_bufAvg` and the
visual offsets.
**Guarded by:** `viewtest.js` — "a new match overrides the results screen".

### Keyboard input never reached the game
`e.preventDefault()` on the canvas `pointerdown` blocked focus, so `E`, `F` and
`Shift` were swallowed. **Fix:** removed it, call `window.focus()`, and show a hint.

### The results screen kept vanishing — four separate causes
1. The room-list broadcast after a race yanked the view. *Room list is data, not
   navigation.*
2. `Space` on the results screen restarted the race instantly (single-player).
   *The results screen now ignores keys entirely.*
3. The table overflowed its panel (424 px of content in 254 px). *Two-column
   layout plus automatic `zoom` scaling.*
4. The room re-formed after the race and `showRoom()` called `setView('room')`.

The fourth one is why `setView` now has a lock: **nothing leaves the results screen
without an explicit reason** — a button the player pressed, or a new race actually
starting. Everything else (room updates, room lists, chat, presence, idle kicks,
stray queue messages) updates its data and leaves the screen alone.
**Guarded by:** `viewtest.js`, seven separate assertions. Reintroducing the bug
fails six of them.

### The bot offer never started the race
The `botOffer` flag was cleared before it was checked, so the offer re-fired
forever. **Fix:** leave the flag set; the countdown owns it.

### Quick match split friends into separate races
**Fix:** a 10-second window that extends when someone joins (max 15), plus a
"Start now" button.

### Characters vibrated
The sprite's bob was running at ~9 bounces per second — the stride phase was being
used directly. **Fix:** `ph * step * 0.4`, which ties the bob to the actual stride.

### Falling in the same pit, over and over
**Fix:** after two falls at the same spot, `skipGap()` places the racer on the far
side and tells them so. Capped at two, as asked.

### A runner could grind against a wall forever
Walls did not respect invulnerability, so the one-frame anti-wedge nudge was
cancelled instantly and the player was re-stunned every frame — and a stunned
racer cannot jump, which is the only way past a wall.
**Fix:** a wall staggers you on impact, then merely blocks while `inv` runs, so you
always get control back in time to jump.
**Guarded by:** `simtest.js` — "a runner gets past a wall instead of grinding on it"
and "a wall always hands control back".

### The lobby crashed on a malformed room row
`C.TRACKS[r.track].name` threw when `track` was missing.
**Fix:** fall back to track 0 and an empty player list.

### Scenery drowned the crates
The first pass at props was dense, full-contrast and placed anywhere — including
right next to a crate. **Fix:** sparser, dimmer, 150 px clear of every crate; and
the crates themselves now hop, glow and point at themselves.

### A rider sank through a moving platform
Landing used `p.onGround` as its "already landed this frame" flag. A racer
*already* standing on a mover was therefore never re-caught by it, sank a
fraction of a pixel per frame, and dropped off after about five frames.
**Fix:** a fresh local `landed` flag per frame.
**Guarded by:** `simtest.js` - "a moving platform carries whoever stands on it".

### Stairs made the netcode disagree
A step hard-blocked anyone touching its side while rising, which pins `x` and
zeroes `vx` - a divergence amplifier. On a 280 ms / 8% loss link the worst
correction hit **186 px**, past the 140 px snap threshold.
**Fix:** a step within `CLIMB` never blocks; it lifts you or lets you pass.
The worst correction on the same link fell to **95 px**.

### Replay asked where the platforms are *now*
Reconciliation replays unacknowledged inputs, but `this.world.time` was the
current clock, so every replayed step placed moving platforms where they are now
rather than where they were. **Fix:** the replay walks the race clock forward
from the snapshot's time.

---

## Tooling built along the way

| Tool | What it does |
|---|---|
| `tools/cdp.js` | A 40-line Chrome DevTools client — drives the real page, no puppeteer |
| `tools/viewtest.js` | The client's view state machine, in a real browser, with a stubbed socket |
| `tools/simtest.js` | Pure physics: walls, stamina, lightning, every character, every track |
| `tools/roomtest.js` | Full bot races on every track, server-side, no sockets |
| `tools/soak.js` | Four real clients on simulated links, LAN → 280 ms / 8% loss |
| `tools/shots.js` | Regenerates every screenshot in the README |
| `tools/sprite.py` | Trim → scale → quantize → embed, one command per sprite |

## Known limits

- State is in memory, so the server wants a single instance. Races do not survive
  a restart.
- No reconnect into a running race yet.
- The wire format is JSON. Binary would cut bandwidth, but JSON has not been the
  bottleneck at eight players.
- No audio.
