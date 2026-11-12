// Client netcode.
//
//  * INPUT  : every local tick produces one input (seq, bits). Inputs are kept
//             until the server acknowledges them and are RESENT in every packet,
//             so a lost packet costs nothing as long as a later one arrives.
//  * PREDICT: the local racer is stepped immediately with the shared sim, so the
//             controls never wait for the round trip.
//  * RECONCILE: each snapshot carries the authoritative state of our racer plus
//             the last input it consumed. We rewind to that state and replay
//             every input the server has not seen yet. The leftover difference
//             is eased away visually instead of snapping.
//  * INTERPOLATE: other racers are drawn INTERP_DELAY ms in the past, between
//             the two snapshots that bracket that moment. Packet loss and jitter
//             are absorbed by that buffer.

import * as C from '../shared/constants.js';
import { buildTrack } from '../shared/track.js';
import { createPlayer, stepPlayer, applyPlayer } from '../shared/sim.js';

export class Net {
  constructor(handlers) {
    this.h = handlers;
    this.ws = null;
    this.id = null;
    this.track = null;
    this.players = new Map();     // id -> { local, remote-ish state }
    this.me = null;
    this.seq = 0;
    this.pending = [];            // [{seq,bits}] not yet acknowledged
    this.snaps = [];              // [{recvAt, snap}] for interpolation
    this.entities = { mines: [], holes: [], shots: [] };
    this.time = -C.COUNTDOWN_SEC;
    this.state = 'idle';
    this.stats = { rtt: 0, jitter: 0, loss: 0, snapHz: 0, corr: 0, corrClean: 0, buf: 0, inKbps: 0, lastSnapAt: 0, drops: 0, replay: 0 };
    this._snapTimes = [];
    this._bytes = 0; this._bytesAt = performance.now();
    this._pings = new Map();
    this._rttSamples = [];
    this.visualDX = 0; this.visualDY = 0;   // smoothed correction offset
    this._bufAvg = null;
    this._lastSnapK = -1;
  }

  connect(url) {
    if (!url) { const proto = location.protocol === 'https:' ? 'wss' : 'ws'; url = `${proto}://${location.host}`; }
    this.ws = new WebSocket(url);
    this.ws.onopen = () => { this.state = 'lobby'; this.h.onOpen?.(); this._pingLoop(); };
    this.ws.onclose = () => { this.state = 'closed'; this.h.onClose?.(); };
    this.ws.onmessage = ev => {
      this._bytes += (ev.data.length || ev.data.byteLength || 0);
      const m = JSON.parse(ev.data);
      this._onMessage(m);
    };
  }

  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }

  _pingLoop() {
    const beat = () => {
      if (!this.ws || this.ws.readyState !== 1) return;
      const c = performance.now();
      this._pings.set(c, c);
      this.send({ t: 'ping', c });
      setTimeout(beat, 1000);
    };
    beat();
  }

  _onMessage(m) {
    switch (m.t) {
      case 'welcome':
        this.id = m.id; this.meta = m; this.stats.loss = m.net.loss;
        this.h.onWelcome?.(m); break;
      case 'pong': {
        const sent = this._pings.get(m.c);
        if (sent != null) {
          this._pings.delete(m.c);
          const rtt = performance.now() - sent;
          this._rttSamples.push(rtt);
          if (this._rttSamples.length > 8) this._rttSamples.shift();
          const avg = this._rttSamples.reduce((a, b) => a + b, 0) / this._rttSamples.length;
          this.stats.rtt = Math.round(avg);
          this.stats.jitter = Math.round(Math.max(...this._rttSamples) - Math.min(...this._rttSamples));
          this.send({ t: 'rtt', ms: this.stats.rtt });
        }
        break;
      }
      case 'queued':
        // Jitter reorders packets, so a lobby update can land AFTER the match
        // has started. Letting it set the state would quietly drop this player
        // out of a race that is already running.
        if (this.state !== 'racing') { this.state = 'queued'; this.h.onQueued?.(m); }
        break;
      case 'net': this.stats.loss = m.loss; this.h.onNet?.(m); break;
      case 'room': if (this.state !== 'racing') this.state = 'room'; this.h.onRoom?.(m); break;
      case 'rooms': if (this.state !== 'racing') this.state = 'lobby'; this.h.onRooms?.(m); break;
      case 'who': this.h.onWho?.(m); break;
      case 'chat': this.h.onChat?.(m); break;
      case 'chatlog': this.h.onChatLog?.(m); break;
      case 'err': this.h.onErr?.(m); break;
      case 'kicked': this.state = 'lobby'; this.h.onKicked?.(m); break;
      case 'go': this.state = 'racing'; this.h.onGo?.(m); break;
      case 'leftroom': this.h.onLeftRoom?.(m); break;
      case 'botoffer': this.h.onBotOffer?.(m); break;
      case 'authed': this.h.onAuthed?.(m); break;
      case 'match': if (this.state !== 'racing' || m.room !== this.roomId) this._onMatch(m); break;
      case 'snap': this._onSnap(m); break;
      case 'end': this.state = 'over'; this.h.onEnd?.(m); break;
    }
  }

  _onMatch(m) {
    this.track = buildTrack(C.TRACKS[m.trackIdx], m.seed);
    this.roster = m.players;
    this.players.clear();
    for (const pl of m.players) {
      const p = createPlayer(pl.id, pl.slot, pl.charIdx, -200 + pl.slot * 46);
      p.name = pl.name; p.bot = pl.bot;
      this.players.set(pl.id, p);
      if (pl.id === this.id) this.me = p;
    }
    // A new race restarts the server's tick counter, so every leftover from the
    // last one has to go. Keeping _lastSnapK meant the stale-snapshot filter
    // rejected every snapshot of the new race, and the player saw nobody else.
    this.seq = 0; this.pending = []; this.snaps = []; this.time = -C.COUNTDOWN_SEC;
    this._lastSnapK = -1; this._bufAvg = null;
    this.visualDX = 0; this.visualDY = 0;
    this.stats.drops = 0; this.stats.corr = 0; this.stats.corrClean = 0;
    this.entities = { mines: [], holes: [], shots: [] };
    this.roomId = m.room;
    this.state = m.loading ? 'loading' : 'racing';
    this.h.onMatch?.(m);
  }

  get world() { return { track: this.track, holes: this.entities.holes, mines: this.entities.mines, time: this.time }; }

  _onSnap(snap) {
    const recvAt = performance.now();
    if (snap.k <= this._lastSnapK) { this.stats.drops++; return; }   // reordered: ignore the stale one
    if (this._lastSnapK >= 0 && snap.k > this._lastSnapK + C.SNAP_EVERY) this.stats.drops++;
    this._lastSnapK = snap.k;

    this.snaps.push({ recvAt, snap });
    if (this.snaps.length > 40) this.snaps.shift();
    this._snapTimes.push(recvAt);
    while (this._snapTimes.length && recvAt - this._snapTimes[0] > 1000) this._snapTimes.shift();
    this.stats.snapHz = this._snapTimes.length;
    this.stats.lastSnapAt = recvAt;
    this.stats.buf = snap.buf ?? 0;

    this.time = snap.tm;
    this.entities.mines = snap.m;
    this.entities.holes = snap.h;
    this.entities.shots = snap.s;
    if (snap.ev && snap.ev.length) this.h.onEvents?.(snap.ev);

    // non-local racers: authoritative state goes straight in (drawn interpolated)
    for (const ps of snap.ps) {
      const p = this.players.get(ps.i);
      if (!p || p === this.me) continue;
      applyPlayer(p, ps);
    }
    this._reconcile(snap);
  }

  _reconcile(snap) {
    if (!this.me) return;
    const auth = snap.ps.find(x => x.i === this.id);
    if (!auth) return;
    const beforeX = this.me.x, beforeY = this.me.y;

    applyPlayer(this.me, auth);
    const ack = snap.ack ?? -1;
    while (this.pending.length && this.pending[0].seq <= ack) this.pending.shift();

    // replay everything the server has not consumed yet
    let n = 0;
    for (const inp of this.pending) { stepPlayer(this.me, inp.bits, this.world, C.DT); n++; }
    this.stats.replay = n;

    const dx = beforeX - this.me.x, dy = beforeY - this.me.y;
    const err = Math.hypot(dx, dy);
    this.stats.corr = Math.round(err * 10) / 10;
    // A correction that follows a hit is not a netcode error: no client can
    // predict another player's punch. Track the quiet case separately.
    this.stats.corrClean = (this.me.inv > 0 || this.me.stun > 0) ? 0 : this.stats.corr;
    if (err > C.CORRECTION_SNAP) { this.visualDX = 0; this.visualDY = 0; }  // too far gone: show the truth
    else { this.visualDX = dx; this.visualDY = dy; }                        // keep the old look, decay to truth
  }

  /** One local tick: make an input, predict, ship it. */
  tick(bits, dt) {
    if (this.state !== 'racing' || !this.me) return;
    this.time += C.DT;              // snapshots correct this 20x a second
    if (this.time < 0) return;      // countdown: produce no inputs, so seq 0 lines up with the server
    // Pace input production so the server's queue never runs dry and never
    // runs long. Asking the server how deep its queue is would mean steering by
    // information one round trip old, which oscillates badly on a slow link --
    // so estimate it locally instead: everything unacknowledged is either still
    // in flight or already queued, and the flight time is half the round trip.
    const inFlight = (this.stats.rtt / 2 / 1000) * C.TICK_HZ;
    const estBuf = this.pending.length - inFlight;
    const target = 2.5;
    this.stats.estBuf = Math.round(estBuf * 10) / 10;
    let produce = 1;
    if (estBuf < target - 1) produce = 2;
    else if (estBuf > target + 3) produce = 0;
    for (let i = 0; i < produce; i++) {
      const inp = { seq: this.seq++, bits };
      this.pending.push(inp);
      if (this.time >= 0) stepPlayer(this.me, bits, this.world, C.DT);
    }
    if (this.pending.length > 400) this.pending.splice(0, this.pending.length - 400);  // runaway guard only

    // Resend from the OLDEST unacknowledged input, never the newest: the server
    // consumes in order, so the one it is waiting for is always at the front.
    // Sending the tail instead is how a single lost packet becomes a deadlock.
    const win = this.pending.slice(0, C.INPUT_REDUNDANCY);
    if (win.length) this.send({ t: 'in', s: win[0].seq, b: win.map(w => w.bits) });

    // visual correction eases out instead of snapping
    const k = Math.exp(-dt * C.CORRECTION_RATE);
    this.visualDX *= k; this.visualDY *= k;

    const nowMs = performance.now();
    if (nowMs - this._bytesAt > 1000) {
      this.stats.inKbps = Math.round(this._bytes * 8 / 1024 / ((nowMs - this._bytesAt) / 1000));
      this._bytes = 0; this._bytesAt = nowMs;
    }
  }

  /** Throw away stale local state and take the server's word for it. */
  resync() {
    this.pending.length = 0;
    this.snaps.length = 0;
    this._lastSnapK = -1;
    this.visualDX = 0; this.visualDY = 0;
    this._bufAvg = null;
    this.stats.corr = 0; this.stats.corrClean = 0;
  }

  /** Remote racers, rendered INTERP_DELAY ms in the past. */
  interpolated() {
    const out = [];
    const target = performance.now() - C.INTERP_DELAY_MS;
    let a = null, b = null;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].recvAt <= target) { a = this.snaps[i]; b = this.snaps[i + 1] || null; break; }
    }
    if (!a) a = this.snaps[0];
    if (!a) return out;
    const span = b ? (b.recvAt - a.recvAt) : 0;
    const f = span > 0 ? Math.max(0, Math.min(1, (target - a.recvAt) / span)) : 0;

    for (const ps of a.snap.ps) {
      if (ps.i === this.id) continue;
      const p = this.players.get(ps.i);
      if (!p) continue;
      const nb = b ? b.snap.ps.find(x => x.i === ps.i) : null;
      const view = Object.assign({}, p);
      view.x = nb ? ps.x + (nb.x - ps.x) * f : ps.x;
      view.y = nb ? ps.y + (nb.y - ps.y) * f : ps.y;
      view.phase = nb ? ps.phase + (nb.phase - ps.phase) * f : ps.phase;
      out.push(view);
    }
    return out;
  }
}
