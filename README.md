# Turbo Dash — authoritative multiplayer prototype

A working server-authoritative netcode slice for the Fun Run–style racer: real
WebSocket transport, client-side prediction, server reconciliation, entity
interpolation, lag-compensated melee, and a built-in network condition
simulator so a single laptop can reproduce what a player on mobile data feels.

```bash
npm install
npm start                 # http://localhost:8080
npm run dev               # everyone starts on an 80 ms / 25 ms / 1.5% link
npm run bad               # 220 ms / 70 ms / 6% — worst case
```

Open the page in two or more browser tabs. Each one starts at an **entry
screen**: pick a racer, type a name, and enter — or sign in with Google if the
server is configured for it. Then either press **Find match** (quick queue:
waits 5 s for other humans, fills the rest with bots) or **Create room**.

Controls: `Space`/`↑` jump (twice = double jump), `↓` slide, `E` use item,
`F` punch on the ground or kick in the air.

### Rooms

A room is a private grid with a 4-character code you can share.

- The **host** owns the room: only they pick the track, add or remove bots, and
  press Start. If the host leaves, the next player inherits the room.
- **Start stays locked until every other player has pressed Ready.** Bots count
  as ready. The hint under the button names whoever is still missing.
- A room can carry an optional **password**. Protected rooms show as `locked`
  in the browser; the password itself never leaves the server, and a wrong one
  is refused without revealing anything.
- The **lobby** is a browser: a narrow column lists everyone online and where
  they are, and the main area shows every open room as a card — code, track,
  how many of the four seats are taken, who is in it, and a padlock when the
  room is protected.
- **Chat belongs to the room**, not to the server: only the people in it see
  it. Joining and leaving are announced there (`Dana joined`), along with the
  host changing hands and each race's result. The last 60 lines load when you
  join; the server rate-limits to 8 messages per 10 s.
- **Once a race starts the game takes the whole window** and the page stops
  scrolling. Press `T` for a corner readout of RTT, loss and correction.
- After a race the room stays together so you can run it again, with everyone's
  Ready cleared. A player who then goes **silent for a minute is returned to the
  lobby**, so an empty chair cannot hold the room hostage. Rooms that have not
  raced yet never time anyone out, so you can open one and wait for a friend.

### Google sign-in (optional)

Guests can play without an account; signing in only fixes your display name
across visits and marks you as verified in the player lists. To turn it on:

1. In the Google Cloud console create an **OAuth 2.0 Client ID** of type *Web
   application*.
2. Add your origin to **Authorized JavaScript origins** — `http://localhost:8080`
   for local play, plus your real domain later.
3. Start the server with the ID (it is public by design, not a secret):

```bash
node server/index.js --google-client-id 1234567890-abc.apps.googleusercontent.com
# or: GOOGLE_CLIENT_ID=... npm start
```

The browser receives an ID token from Google and sends it to the server, which
verifies the RS256 signature against Google's published keys and checks the
audience, issuer and expiry before believing a single field in it. An
unverified token is never trusted, and signing in on a second tab disconnects
the first so one account cannot race twice.

## How it is put together

```
shared/     constants.js   tuning numbers, input bits, tracks, characters, items
            track.js       deterministic track generation + surface queries
            sim.js         THE simulation — one fixed step for one racer
server/     index.js       static host, WebSocket, lobby/rooms/chat, 60 Hz loop
            google.js      Google ID token verification (signature, audience, expiry)
            room.js        one race: authority over pickups, items, hits, entities
            bot.js         bots, which only ever produce input bits
            netsim.js      per-connection latency / jitter / loss
client/     net.js         prediction, reconciliation, interpolation
            render.js      canvas renderer
            main.js        UI, input, HUD, telemetry panel
tools/      testclient.js  headless client running the REAL client netcode
            soak.js        four clients, four network profiles, one report
```

`shared/sim.js` is imported unchanged by both sides. That is the whole trick:
the client can only predict correctly because it runs the server's own code.
Nothing in it reads the clock, `Math.random` or any global — given the same
state and the same input it produces the same result on both machines.

### The loop

1. **Input.** Every client tick packs the held controls into one byte and gives
   it a sequence number. The last 14 inputs ride in every packet, so a dropped
   packet costs nothing as long as a later one lands.
2. **Prediction.** The local racer is stepped immediately. Controls never wait
   for the round trip.
3. **Authority.** The server steps all four racers at a fixed 60 Hz from the
   inputs it has consumed, resolves everything a client may not decide for
   itself, and publishes a snapshot every third tick (20 Hz).
4. **Reconciliation.** Each snapshot carries our racer's authoritative state and
   the last input the server consumed. The client rewinds to that state and
   replays every input the server has not seen yet. The leftover difference is
   eased out over ~80 ms rather than snapped, unless it exceeds 140 px.
5. **Interpolation.** Other racers are drawn 110 ms in the past, between the two
   snapshots bracketing that moment, which is what absorbs jitter and loss.

### What the server decides, and why

Movement is predicted, but **pickups, item effects, melee hits, projectiles,
explosions and dug holes are server-only**. A client that lies about its
position gains nothing: it is corrected on the next snapshot. A client that
claims a hit is simply not believed — it only sends "I swung".

Melee is **lag compensated**: when a swing arrives, the server rewinds the other
racers by half the attacker's measured RTT (capped at 260 ms) and tests the hit
against where that player actually saw them. Without it, hitting anyone on a
200 ms link would be impossible.

### Network conditions

`server/netsim.js` delays or drops every message in **both** directions, per
connection, so the full round trip is simulated rather than half of it. Jitter
reorders packets, which the protocol tolerates by design (snapshots carry a
tick number, inputs carry sequence numbers). Each tab sets its own conditions
live from the Network panel; `--rtt/--jitter/--loss` set the default.

## Measured

`node tools/soak.js 8080` runs four headless clients — each using the real
`client/net.js` with a bot brain standing in for a human — on four different
links, over the 11,000 m track:

| profile | link              | finished   | avg correction | worst correction | snapshots lost |
|---------|-------------------|------------|----------------|------------------|----------------|
| LAN     | 0 ms              | 24.9–28.2s | 1.9–4.2 px     | 20.5 px          | 0              |
| Good 4G | 60 ms / 15 / 0.5% | 26.9–30.1s | 11.2–13.4 px   | 67.4 px          | 2–6            |
| Mobile  | 140 ms / 40 / 2%  | 26.6–31.7s | 9.5–11.1 px    | 89.6 px          | 11–17          |
| Awful   | 280 ms / 90 / 8%  | 27.3–29.7s | 13.9–16.6 px   | 125.2 px         | 152–164        |

Four consecutive runs; every racer finished every time, and the finishing order
changed from run to run rather than tracking latency.

Corrections are measured only when nothing happened to the racer — a shove from
another player is not a netcode error, since no client can predict it. Every
figure stays under the 140 px hard-snap threshold, so corrections are smoothed
and never visible as a teleport. The 280 ms / 8 % loss client won that race.

## What the harness caught

Every one of these only appears with jitter or loss, and none of them would
have surfaced by playing on localhost:

- **The input deadlock.** A lost packet left the server waiting for input *N*
  while the client retransmitted only its newest inputs, so *N* was never sent
  again. The race froze for that player, permanently. Fixed on both sides:
  clients resend from the oldest unacknowledged input, and the server skips a
  sequence hole rather than blocking on it.
- **Reordered control messages.** Jitter delivered a lobby "queued" update
  *after* the "match started" message, which put the client back in the lobby
  while its racer stood on the track for the whole race. Control messages are
  now ignored when they are stale.
- **Loss applied to control traffic.** The simulator was dropping one-shot
  messages like the match start. Real builds put control on a reliable channel;
  only snapshots are lossy now.
- **An unstable input pacer.** Steering input production by the queue depth the
  server reported meant reacting to information one round trip old, which
  oscillated until the input buffer overflowed. The client now estimates the
  queue locally from its own unacknowledged count minus the flight time.
- **Bots that held the jump key.** Jump is edge triggered, so a bot that wanted
  to jump continuously jumped exactly once and then never again.

## Known gaps before this is a product

- **Wire format.** JSON at 20 Hz is about 25 kbps down per client. Binary
  packing plus delta encoding against the last acknowledged snapshot is the
  standard next step, worth roughly 5–10x.
- **No cheat validation beyond authority.** The server trusts input timing. A
  client that floods inputs gets throttled by the per-tick consumption, but
  input-rate and plausibility checks belong here.
- **No skill rating or regions**, and no reconnect into a running race: a
  dropped player is handed to a bot and cannot return.
- **Accounts are display names only.** Signing in does not yet carry progress,
  coins or unlocks, because nothing is persisted.
- **One process, in-memory rooms.** No horizontal scaling, no persistence, no
  accounts, no anti-abuse. Rooms are lost on restart.
- **No tick-rate adaptation** for clients whose device cannot hold 60 Hz.
