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

Open the page in two or more browser tabs and press **Find match** in each.
The queue waits 5 s for other humans, then fills the grid with bots. Controls:
`Space`/`↑` jump (twice = double jump), `↓` slide, `E` use item, `F` punch on
the ground or kick in the air.

## How it is put together

```
shared/     constants.js   tuning numbers, input bits, tracks, characters, items
            track.js       deterministic track generation + surface queries
            sim.js         THE simulation — one fixed step for one racer
server/     index.js       static host, WebSocket, matchmaking, 60 Hz loop
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
- **Matchmaking is a single queue.** No skill rating, no regions, no reconnect
  into a running race (a dropped player is handed to a bot and cannot return).
- **One process, in-memory rooms.** No horizontal scaling, no persistence, no
  accounts, no anti-abuse. Rooms are lost on restart.
- **No tick-rate adaptation** for clients whose device cannot hold 60 Hz.
