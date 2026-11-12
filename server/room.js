// One race. The room owns the authoritative world: it steps the simulation at
// a fixed 60 Hz, resolves everything a client is not allowed to decide for
// itself (pickups, items, hits, projectiles, terrain damage), and publishes a
// snapshot every third tick.

import * as C from '../shared/constants.js';
import { buildTrack, groundAt, lowerBound } from '../shared/track.js';
import { createPlayer, stepPlayer, encodePlayer, hit, atkOf, zap } from '../shared/sim.js';
import { createBot, botInput } from './bot.js';

let nextEnt = 1;

// Racers pass through one another, so a tight grid is fair: eight of them
// spread over 46px each would hand the back row a 320px handicap.
const startX = slot => -210 + slot * 22;

export class Room {
  constructor(id, trackIdx, seed, onFinished) {
    this.id = id;
    this.trackIdx = trackIdx;
    this.seed = seed;
    this.track = buildTrack(C.TRACKS[trackIdx], seed);
    this.onFinished = onFinished;
    this.players = [];           // { p, conn|null, bot|null, name, inputs, nextSeq, lastBits, hist }
    this.mines = []; this.holes = []; this.shots = [];
    this.events = [];
    this.tick = 0;
    this.time = -C.COUNTDOWN_SEC;  // negative while the countdown runs
    this.state = 'lobby';
    this.finishOrder = [];
    this.acc = 0;
    // Storm tracks: the next bolt, and the one currently flickering before it
    // lands. Both live on the server -- clients only ever see the events.
    this.storm = !!C.TRACKS[trackIdx].storm;
    this.nextBolt = this.storm ? 2.5 : Infinity;
    this.pendingBolt = null;
    this.lastHr = process.hrtime.bigint();
  }

  get world() { return { track: this.track, holes: this.holes, mines: this.mines, time: this.time }; }

  addHuman(conn, name, charIdx) {
    const slot = this.players.length;
    const p = createPlayer(conn.id, slot, charIdx, startX(slot));
    const e = { p, conn, bot: null, name, inputs: new Map(), nextSeq: 0, lastBits: 0, hist: [] };
    this.players.push(e);
    conn.room = this; conn.entry = e;
    return e;
  }
  addBot(charIdx, skill) {
    const slot = this.players.length;
    const id = 'bot' + slot + '_' + this.id;
    const p = createPlayer(id, slot, charIdx, startX(slot));
    const e = { p, conn: null, bot: createBot(skill), name: C.CHARS[charIdx].name + ' (bot)', inputs: new Map(), nextSeq: 0, lastBits: 0, hist: [] };
    this.players.push(e);
    return e;
  }

  matchMessage() {
    return { t: 'match', room: this.id, seed: this.seed, trackIdx: this.trackIdx,
      players: this.players.map(e => ({ id: e.p.id, slot: e.p.slot, charIdx: e.p.charIdx, name: e.name, bot: !!e.bot })) };
  }

  start() { this.state = 'running'; this.tick = 0; this.time = -C.COUNTDOWN_SEC; this.lastHr = process.hrtime.bigint(); }

  // --- input intake ------------------------------------------------------
  onInput(entry, msg) {
    if (!Array.isArray(msg.b)) return;
    // msg = { t:'in', s:<seq of first>, b:[bits...] }  (redundant resend window)
    for (let i = 0; i < msg.b.length; i++) {
      const seq = msg.s + i;
      if (seq >= entry.nextSeq) entry.inputs.set(seq, msg.b[i] | 0);
    }
    if (entry.inputs.size > 400) {           // never let a stalled client grow memory
      const keys = [...entry.inputs.keys()].sort((a, b) => a - b);
      for (let i = 0; i < keys.length - 200; i++) entry.inputs.delete(keys[i]);
    }
  }

  takeInput(e) {
    if (e.bot) return botInput(e.p, e.bot, this.world, C.DT, this.players.map(x => x.p));
    if (e.inputs.has(e.nextSeq)) { const b = e.inputs.get(e.nextSeq); e.inputs.delete(e.nextSeq); e.nextSeq++; e.lastBits = b; return b; }
    // A hole in the sequence must never block the race. If newer inputs are
    // already queued, the missing one is gone for good: skip to what we have
    // rather than waiting for a packet that will never be retransmitted.
    if (e.inputs.size) {
      let lowest = Infinity;
      for (const k of e.inputs.keys()) if (k < lowest) lowest = k;
      if (lowest > e.nextSeq) {
        e.skipped = (e.skipped || 0) + (lowest - e.nextSeq);
        const b = e.inputs.get(lowest); e.inputs.delete(lowest);
        e.nextSeq = lowest + 1; e.lastBits = b; return b;
      }
    }
    // Genuinely nothing queued: hold the last state. Edge bits cannot re-fire,
    // because stepPlayer compares against lastBits.
    e.starved = (e.starved || 0) + 1;
    return e.lastBits;
  }

  // --- the authoritative step -------------------------------------------
  step() {
    const dt = C.DT;
    this.time += dt; this.tick++;
    const racing = this.time >= 0;

    for (const e of this.players) {
      const bits = racing ? this.takeInput(e) : 0;
      const before = { atk: e.p.atk, item: e.p.item };
      if (racing) {
        stepPlayer(e.p, bits, this.world, dt);
        // A swing that just started is resolved here, with lag compensation.
        if (e.p.atk > 0 && before.atk <= 0) this.resolveMelee(e);
        if ((bits & C.IN_USE) && !(e.p.lastUse) && e.p.item >= 0) this.useItem(e);
        e.p.lastUse = !!(bits & C.IN_USE);
      }
      if (racing) this.antiWedge(e, dt);
      e.hist.push({ k: this.tick, x: e.p.x, y: e.p.y });
      if (e.hist.length > 40) e.hist.shift();
    }

    if (racing) { this.pickups(); this.stepEntities(dt); this.lightning(dt); this.checkFinish(); }
    return racing;
  }

  // Nobody may be stuck forever in a race other people are waiting on. A racer
  // that makes no forward progress while able to act gets one nudge, with a
  // short mercy window so the hazard that pinned them cannot re-pin instantly.
  antiWedge(e, dt) {
    const p = e.p;
    if (p.done) { e.wedgeT = 0; return; }
    if (p.x > (e.wedgeX ?? -1e9) + 12) { e.wedgeX = p.x; e.wedgeT = 0; return; }
    e.wedgeT = (e.wedgeT || 0) + dt;
    const limit = e.bot ? 1.2 : 2.0;
    if (e.wedgeT < limit) return;
    e.wedgeT = 0; e.wedgeX = p.x;
    p.stun = 0; p.frozen = 0;
    p.inv = Math.max(p.inv, 0.6);
    p.vx = Math.max(p.vx, 180);
    p.x += 8;
    this.events.push({ k: 'unstick', x: p.x, y: p.y, to: p.id });
  }

  posAt(e, ticksBack) {
    if (ticksBack <= 0 || e.hist.length === 0) return { x: e.p.x, y: e.p.y };
    const want = this.tick - ticksBack;
    for (let i = e.hist.length - 1; i >= 0; i--) if (e.hist[i].k <= want) return e.hist[i];
    return e.hist[0];
  }

  resolveMelee(att) {
    // Rewind everyone else to where the attacker SAW them, bounded.
    const backMs = Math.min(C.MAX_REWIND_MS, (att.conn ? att.conn.rttMs : 0) / 2);
    const backTicks = Math.round(backMs / 1000 * C.TICK_HZ);
    const A = atkOf(att.p);
    let target = null, bd = 1e9;
    for (const e of this.players) {
      if (e === att || e.p.done) continue;
      const q = this.posAt(e, backTicks);
      const dx = q.x - att.p.x;
      if (dx > A.fwd || dx < -A.back) continue;
      if (Math.abs(q.y - att.p.y) > 48) continue;
      const ad = Math.abs(dx); if (ad < bd) { bd = ad; target = e; }
    }
    const fx = att.p.x + (att.p.atkKind ? 30 : 28), fy = att.p.y + (att.p.atkKind ? 12 : 26);
    if (!target) { this.events.push({ k: 'miss', x: fx, y: fy, by: att.p.id }); return; }
    const away = target.p.x >= att.p.x ? 1 : -1;
    const landed = hit(target.p, A.stun, A.slow);
    if (landed) {
      target.p.x += away * A.kb; target.p.vx *= 0.34;
      target.p.vy = Math.max(target.p.vy, A.pop * (att.p.atkKind ? 1 : 0.6));
    }
    this.events.push({ k: 'melee', x: fx, y: fy, by: att.p.id, to: target.p.id, landed, name: A.name, rewind: backTicks });
  }

  placeOf(p) { let n = 1; for (const e of this.players) { const o = e.p; if (o !== p && (o.done ? o.x + 1e6 : o.x) > (p.done ? p.x + 1e6 : p.x)) n++; } return n; }

  giveItem(e) {
    const pos = this.placeOf(e.p);
    // Tiers are relative so the table works for two racers or eight: the front
    // of the field gets area denial, the back gets the things that hurt.
    const n = this.players.length, f = (pos - 1) / Math.max(1, n - 1);
    const pool = f > 0.6 ? ['rocket','boost','freeze','jet','nade','punch','rocket','boost']
               : f > 0.3 ? ['nade','boost','punch','rocket','trap','freeze','jet','shield']
                         : ['shield','hole','trap','nade','shield','hole','boost','punch'];
    const id = pool[Math.floor(Math.random() * pool.length)];
    e.p.item = C.ITEMS.findIndex(i => i.id === id);
  }

  useItem(e) {
    const p = e.p, it = C.ITEMS[p.item];
    if (!it || p.stun > 0 || p.frozen > 0 || p.done) return;
    p.item = -1;
    const push = ev => this.events.push(ev);
    if (it.id === 'boost') { p.boost = Math.max(p.boost, 2.6); }
    else if (it.id === 'shield') { p.shield = 7; }
    else if (it.id === 'jet') { p.jet = 2.0; p.onGround = false; p.vy = Math.max(p.vy, 260); }
    else if (it.id === 'trap') { this.mines.push({ id: nextEnt++, x: p.x - 70, y: 16, by: p.id, t: 0 }); }
    else if (it.id === 'hole') { const hx = p.x - 130; this.holes.push({ id: nextEnt++, x: hx, w: 124, t: 0, by: p.id }); push({ k: 'dig', x: hx + 62, y: 12 }); }
    else if (it.id === 'freeze') {
      for (const o of this.players) { const q = o.p;
        if (q === p || q.done || q.x <= p.x || q.inv > 0 || q.jet > 0) continue;
        if (q.shield > 0) { q.shield = 0; q.inv = 0.6; continue; }
        q.frozen = Math.max(q.frozen, 0.85); q.inv = 1.0; q.sliding = false; push({ k: 'freeze', x: q.x, y: q.y, to: q.id }); }
    }
    else if (it.id === 'punch') {
      let best = null;
      for (const o of this.players) { const q = o.p; if (q !== p && q.x > p.x && !q.done && (!best || q.x < best.x)) best = q; }
      if (best && hit(best, 0.68, 0.3)) { best.x -= 20; best.vy = Math.max(best.vy, 230); push({ k: 'hit', x: best.x, y: best.y, to: best.id }); }
    }
    else if (it.id === 'rocket') { this.shots.push({ id: nextEnt++, kind: 0, x: p.x + 28, y: p.y + 28, vx: p.vx + 640, vy: 150, by: p.id, t: 0 }); p.vx *= 0.9; }
    else if (it.id === 'nade')   { this.shots.push({ id: nextEnt++, kind: 1, x: p.x + 20, y: p.y + 36, vx: p.vx + 330, vy: 430, by: p.id, t: 0, fuse: 1.35 }); }
    push({ k: 'use', x: p.x, y: p.y + 30, to: p.id, item: it.id });
  }

  // --- lightning ----------------------------------------------------------
  // A bolt is announced before it lands, so everyone gets a flicker's warning
  // and can try to run out from under it. It aims near the middle of the pack
  // rather than at a person: being in front should not be a punishment.
  lightning(dt) {
    if (!this.storm) return;
    const live = this.players.filter(e => !e.p.done);
    if (!live.length) return;

    if (this.pendingBolt) {
      this.pendingBolt.t -= dt;
      if (this.pendingBolt.t <= 0) {
        const bx = this.pendingBolt.x;
        const struck = [];
        for (const e of live) if (Math.abs(e.p.x - bx) <= C.BOLT_R && zap(e.p)) struck.push(e.p.id);
        this.events.push({ k: 'bolt', x: bx, hit: struck });
        this.pendingBolt = null;
      }
      return;
    }

    this.nextBolt -= dt;
    if (this.nextBolt > 0) return;
    const xs = live.map(e => e.p.x);
    const mid = xs.reduce((a, b) => a + b, 0) / xs.length;
    const bx = mid + (Math.random() * 2 - 1) * 240;
    this.pendingBolt = { x: bx, t: C.BOLT_WARN };
    this.events.push({ k: 'boltwarn', x: bx, inMs: Math.round(C.BOLT_WARN * 1000) });
    const [lo, hi] = C.BOLT_EVERY;
    this.nextBolt = lo + Math.random() * (hi - lo);
  }

  pickups() {
    for (const e of this.players) {
      const p = e.p;
      if (p.done) continue;
      const h = p.sliding ? C.H_SLIDE : C.H_STAND;
      const ii = Math.max(0, lowerBound(this.track.items, p.x - 120));
      for (let i = ii; i < this.track.items.length; i++) {
        const itm = this.track.items[i];
        if (itm.x > p.x + 90) break;
        if (itm.type === 'coin') {
          const dy = Math.abs(itm.y - (p.y + h * 0.5));
          if (Math.abs(itm.x - p.x) < 28 && dy < 44) {
            itm.got = itm.got || new Set();
            if (!itm.got.has(p.id)) {
              itm.got.add(p.id); p.coins++; p.meter++;
              let turbo = false;
              if (p.meter >= C.COINS_PER_TURBO) { p.meter -= C.COINS_PER_TURBO; p.boost = Math.max(p.boost, C.TURBO_SEC); turbo = true; }
              this.events.push({ k: 'coin', x: itm.x, y: itm.y, to: p.id, idx: itm.idx,
                left: C.COINS_PER_TURBO - p.meter, turbo });
            }
          }
        } else if (Math.abs(itm.x - p.x) < C.HW + 23 && itm.y > p.y - 32 && itm.y < p.y + h + 30) {
          itm.taken = itm.taken || new Set();
          if (!itm.taken.has(p.id) && p.item < 0) {
            itm.taken.add(p.id); this.giveItem(e);
            this.events.push({ k: 'crate', x: itm.x, y: itm.y, to: p.id, idx: itm.idx, item: C.ITEMS[p.item].id });
          }
        }
      }
    }
  }

  explode(x, y, rad, by) {
    this.events.push({ k: 'blast', x, y, r: rad });
    for (const e of this.players) {
      const o = e.p;
      if (o.done) continue;
      const dx = o.x - x, dy = (o.y + 26) - y, d = Math.hypot(dx, dy);
      if (d > rad) continue;
      const own = o.id === by, f = 1 - d / rad;
      if (!hit(o, own ? 0.7 : 1.0, 0.3)) continue;
      o.vy = Math.max(o.vy, 240 + f * 140);
      o.x += (dx >= 0 ? 1 : -1) * f * 24;
    }
    const i0 = Math.max(0, lowerBound(this.track.obst, x - rad));
    for (let i = i0; i < this.track.obst.length; i++) {
      const ob = this.track.obst[i];
      if (ob.x > x + rad) break;
      if (ob.type === 'wall' && !ob.dead) { ob.dead = true; this.events.push({ k: 'break', x: ob.x, y: ob.h * 0.5, idx: ob.idx }); }
    }
  }

  stepEntities(dt) {
    for (const m of this.mines) m.t += dt;
    this.mines = this.mines.filter(m => !m.dead);
    for (const h of this.holes) h.t += dt;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.t += dt;
      s.vy -= (s.kind === 0 ? C.G * 0.26 : C.G * 0.82) * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.kind === 1) s.vx *= (1 - 0.35 * dt);
      let boom = false;
      if (s.y <= 7) {
        if (groundAt(this.track, s.x, this.holes)) {
          if (s.kind === 0) boom = true;
          else { s.y = 7; s.vy = Math.abs(s.vy) * 0.42; s.vx *= 0.66; if (Math.abs(s.vy) < 60) s.vy = 0; }
        } else if (s.y < -200) { this.shots.splice(i, 1); continue; }
      }
      if (!boom) for (const e of this.players) { const o = e.p;
        if (o.done || (o.id === s.by && s.t < 0.22)) continue;
        if (Math.abs(o.x - s.x) < 20 && s.y > o.y - 8 && s.y < o.y + 58) { boom = true; break; } }
      if (s.kind === 1) { s.fuse -= dt; if (s.fuse <= 0) boom = true; }
      else if (s.t > 2.6) boom = true;
      if (boom) { this.explode(s.x, Math.max(8, s.y), s.kind === 0 ? 152 : 116, s.by); this.shots.splice(i, 1); }
    }
  }

  checkFinish() {
    for (const e of this.players) {
      if (e.p.done && !this.finishOrder.includes(e.p.id)) {
        this.finishOrder.push(e.p.id);
        this.events.push({ k: 'finish', to: e.p.id, place: this.finishOrder.length, time: e.p.time });
      }
    }
    // Once every human is home, bots get a short grace to come in and then the
    // race is called. Nobody should sit on a results screen waiting for a bot
    // that is having trouble with a gap.
    const humansLeft = this.players.some(e => e.conn && !e.p.done);
    if (!humansLeft && this.botGrace === undefined) this.botGrace = this.time + 8;
    const graceUp = this.botGrace !== undefined && this.time > this.botGrace;
    if (this.finishOrder.length >= this.players.length || graceUp || this.time > 240) {
      this.state = 'over';
      this.onFinished(this);
    }
  }

  snapshot() {
    const snap = {
      t: 'snap', k: this.tick, tm: Math.round(this.time * 1000) / 1000,
      ps: this.players.map(e => encodePlayer(e.p)),
      m: this.mines.map(m => ({ i: m.id, x: Math.round(m.x), y: Math.round(m.y) })),
      h: this.holes.map(h => ({ i: h.id, x: Math.round(h.x), w: h.w })),
      s: this.shots.map(s => ({ i: s.id, k: s.kind, x: Math.round(s.x), y: Math.round(s.y), vx: Math.round(s.vx), vy: Math.round(s.vy) })),
      ev: this.events
    };
    this.events = [];
    return snap;
  }

  results() {
    const order = this.players.slice().sort((a, b) => (a.p.done ? a.p.time : 1e6 - a.p.x) - (b.p.done ? b.p.time : 1e6 - b.p.x));
    return order.map((e, i) => ({ place: i + 1, id: e.p.id, name: e.name, bot: !!e.bot, done: e.p.done, time: e.p.time, coins: e.p.coins, x: Math.round(e.p.x) }));
  }
}
