// The simulation. The server runs it as the authority; every client runs the
// SAME functions ahead of time for its own racer (prediction) and again over
// unacknowledged inputs after each snapshot (reconciliation). Any behaviour
// that differs between the two sides shows up as rubber-banding, so nothing
// here may read wall-clock time, Math.random or anything outside its arguments.

import * as C from './constants.js';
import { moverAt, blinkOn } from './track.js';

// Tops of everything that moves, at x, right now.
const _tops = [];
function movingTops(track, x, t) {
  _tops.length = 0;
  for (const m of track.movers) { const q = moverAt(m, t); if (x > q.x - 2 && x < q.x + q.w + 2) _tops.push(q.y); }
  for (const b of track.blinkers) if (x > b.x && x < b.x + b.w && blinkOn(b, t)) _tops.push(b.y);
  return _tops;
}
import { groundAt, lowerBound, respawnX, skipGap } from './track.js';

export function createPlayer(id, slot, charIdx, startX) {
  return {
    id, slot, charIdx,
    x: startX, y: 0, vx: 0, vy: 0,
    onGround: true, jumps: 2, sliding: false, slideT: 0,
    stun: 0, frozen: 0, boost: 0, shield: 0, jet: 0, inv: 0, charred: 0,
    atk: 0, atkCd: 0, atkKind: 0,          // 0 = punch, 1 = kick
    stam: 1, sprinting: false, meter: 0, fallN: 0, fallX: -1e9,
    item: -1, coins: 0,
    done: false, time: 0, phase: 0,
    safeX: startX, safeY: 0,
    lastBits: 0
  };
}

export const bit = (bits, b) => (bits & b) !== 0;

export function ceilOver(track, p) {
  const i0 = Math.max(0, lowerBound(track.obst, p.x - 200));
  for (let i = i0; i < track.obst.length; i++) {
    const o = track.obst[i];
    if (o.x - o.w / 2 > p.x + C.HW) break;
    if (o.type === 'beam' && !o.dead && p.x + C.HW > o.x - o.w / 2 && p.x - C.HW < o.x + o.w / 2) return true;
  }
  return false;
}

function clearOf(p, left, right) {
  p.x = (p.x <= (left + right) * 0.5) ? left - C.HW - 1.5 : right + C.HW + 1.5;
}

// Returns true when the hit landed (false = shielded, invulnerable or flying).
// A bolt lands. Charring is its own thing, not a stun: you keep running, just
// badly, and you look like a piece of coal while you do it.
export function zap(p) {
  if (p.done || p.shield > 0) return false;
  p.charred = C.CHAR_SEC;
  p.vx = Math.min(p.vx, C.BASE * C.CHAR_SLOW);
  if (p.onGround) p.vy = 220;                     // a little jolt off the ground
  return true;
}

export function hit(p, stun, slowTo) {
  if (p.jet > 0 || p.inv > 0) return false;
  if (p.shield > 0) { p.shield = 0; p.inv = 0.6; p.vx *= 0.9; return false; }
  p.stun = Math.max(p.stun, stun);
  p.vx = Math.min(p.vx, p.vx * slowTo);
  p.inv = Math.max(1.0, stun + 0.6);
  p.sliding = false;
  return true;
}

export function jump(p) {
  if (p.stun > 0 || p.frozen > 0 || p.done) return;
  if (p.jet > 0) { p.vy = Math.min(p.vy + 180, 320); return; }
  if (p.jumps <= 0) return;
  p.jumps--; p.sliding = false; p.slideT = 0;
  p.vy = p.jumps === 1 ? C.JUMP_V : C.JUMP2_V;
  p.onGround = false;
}

export function setSlide(p, on, track) {
  if (p.done) return;
  if (on) {
    if (p.onGround && !p.sliding && p.stun <= 0 && p.frozen <= 0) { p.sliding = true; p.slideT = 0.62; p.vx += 70; }
  } else if (p.sliding && p.slideT < 0.42 && !ceilOver(track, p)) { p.sliding = false; p.slideT = 0; }
}

export const atkOf = p => (C.CHARS[p.charIdx] && C.CHARS[p.charIdx].atk) ||
  { name: 'Hit', fwd: C.ATK_FWD, back: C.ATK_BACK, stun: .42, slow: .32, kb: 14, pop: 250, cost: .62 };

// Starts the swing. Whether it CONNECTS is decided by the server only.
export function meleeStart(p, raceTime) {
  if (p.done || p.sliding || p.stun > 0 || p.frozen > 0 || p.atkCd > 0) return false;
  if (raceTime < C.NO_CONTACT_SEC) return false;
  const A = atkOf(p);
  p.atk = C.ATK_DUR; p.atkCd = C.ATK_CD;
  p.atkKind = p.onGround ? 0 : 1;
  p.vx *= A.cost;                       // the rhino's charge speeds him up
  if (A.hop && p.onGround) { p.vy = Math.max(p.vy, 210); p.onGround = false; p.jumps = 1; }
  return true;
}

/**
 * One fixed step for one racer. `w` carries the replicated world:
 * { track, holes, mines, time }. Pure: same inputs -> same outputs.
 */
export function stepPlayer(p, bits, w, dt) {
  if (p.done) return;
  const track = w.track;

  // --- input edges (held state is compared against the previous tick) ---
  const jumpNow = bit(bits, C.IN_JUMP) && !bit(p.lastBits, C.IN_JUMP);
  const slideHeld = bit(bits, C.IN_SLIDE);
  const atkNow = bit(bits, C.IN_ATK) && !bit(p.lastBits, C.IN_ATK);
  if (jumpNow) jump(p);
  setSlide(p, slideHeld, track);
  if (atkNow) meleeStart(p, w.time);
  p.lastBits = bits;

  // --- timers ---
  p.stun = Math.max(0, p.stun - dt);
  p.charred = Math.max(0, p.charred - dt);
  p.frozen = Math.max(0, p.frozen - dt);
  p.boost = Math.max(0, p.boost - dt);
  p.shield = Math.max(0, p.shield - dt);
  p.jet = Math.max(0, p.jet - dt);
  p.inv = Math.max(0, p.inv - dt);
  p.atk = Math.max(0, p.atk - dt);
  p.atkCd = Math.max(0, p.atkCd - dt);
  if (p.sliding) { p.slideT -= dt; if ((p.slideT <= 0 || !p.onGround) && !ceilOver(track, p)) p.sliding = false; }

  // --- sprint ---
  const wantRun = bit(bits, C.IN_RUN);
  if (wantRun && p.stam > 0.04 && p.stun <= 0 && p.frozen <= 0 && !p.sliding) {
    p.sprinting = true; p.stam = Math.max(0, p.stam - C.SPRINT_DRAIN * dt);
  } else { p.sprinting = false; p.stam = Math.min(1, p.stam + C.SPRINT_REFILL * dt); }

  // --- horizontal ---
  let target = C.BASE;
  if (p.sprinting) target *= C.SPRINT_MUL;
  if (p.atk > 0) target *= 0.55;
  if (p.boost > 0) target *= 1.62;
  if (p.sliding) target *= 1.08;
  if (p.jet > 0) target *= 1.22;
  if (p.charred > 0) target *= C.CHAR_SLOW;       // burnt runners stagger
  if (p.stun > 0 || p.frozen > 0) target = 0;
  let a = (p.stun > 0 || p.frozen > 0) ? C.ACC * 2.4 : (p.vx < C.BASE * 0.55 ? C.ACC * 2.3 : C.ACC);
  // Ice: you keep what you had and change it slowly. Hitting a patch at speed
  // is a gift; being hit on one is not.
  let onIce = false;
  if (p.onGround && p.y < 1.5 && w.track.ice.length)
    for (const z of w.track.ice) if (p.x > z.s && p.x < z.e) { onIce = true; break; }
  if (onIce) a *= C.ICE_GRIP;
  p.onIce = onIce;
  const dv = target - p.vx;
  p.vx += dv < -a * dt ? -a * dt : (dv > a * dt ? a * dt : dv);
  if (p.vx < 0) p.vx = 0;
  p.x += p.vx * dt;
  // Conveyors: the floor itself moves.
  if (p.onGround && p.y < 1.5 && w.track.belts.length)
    for (const b of w.track.belts) if (p.x > b.s && p.x < b.e) { p.x += b.v * dt; break; }

  // --- vertical ---
  if (p.jet > 0) { p.vy += (180 - p.y) * 5.0 * dt - 40 * dt; p.vy = Math.max(-320, Math.min(420, p.vy)); p.onGround = false; }
  else p.vy -= C.G * dt;
  const prevY = p.y;
  p.y += p.vy * dt;

  // --- stairs: a step you can run straight up, or a ledge you must jump ----
  // Steps are the only solid-sided geometry in the game. Low ones lift you as
  // you touch them (that is what makes a staircase feel like a staircase);
  // anything taller simply stops you until you jump.
  if (p.jet <= 0) {
    const si = Math.max(0, lowerBound(track.steps, p.x - 200));
    for (let i = si; i < track.steps.length; i++) {
      const st = track.steps[i];
      if (st.x > p.x + 120) break;
      if (p.x + C.HW <= st.x || p.x - C.HW >= st.x + st.w) continue;
      if (p.y >= st.y - 0.5) continue;                    // already on top of it
      if (p.y + (p.sliding ? C.H_SLIDE : C.H_STAND) <= st.y - st.h) continue;   // passing underneath
      // A low step lifts you; it never pins you. Hard-blocking on a step the
      // player could have walked up is both unfair and, under packet loss, a
      // reliable way to make the client and server disagree by a long way.
      if (st.y - p.y <= C.CLIMB) { if (p.vy <= 10) { p.y = st.y; p.vy = 0; p.onGround = true; p.jumps = 2; } }
      else { p.x = st.x - C.HW - 1; if (p.vx > 0) p.vx = 0; }
    }
  }

  // --- landing ---
  if (p.vy <= 0) {
    // `landed` has to be a fresh flag, not p.onGround: a racer already standing
    // on a moving platform would otherwise never be re-caught by it, and would
    // sink a fraction of a pixel per frame until they dropped off.
    let landed = false;
    if (prevY >= -0.5 && p.y <= 0 && groundAt(track, p.x, w.holes)) {
      p.y = 0; p.vy = 0; p.onGround = true; p.jumps = 2; landed = true;
    }
    if (!landed) {
      const i0 = Math.max(0, lowerBound(track.floats, p.x - 420));
      for (let i = i0; i < track.floats.length; i++) {
        const pf = track.floats[i];
        if (pf.x > p.x + 40) break;
        if (p.x + C.HW < pf.x || p.x - C.HW > pf.x + pf.w) continue;
        if (prevY >= pf.y - 0.5 && p.y <= pf.y) { p.y = pf.y; p.vy = 0; p.onGround = true; p.jumps = 2; landed = true; break; }
      }
    }
    if (!landed) {
      for (const ps of movingTops(track, p.x, w.time)) {
        if (prevY >= ps - 0.5 && p.y <= ps) { p.y = ps; p.vy = 0; p.onGround = true; p.jumps = 2; landed = true; break; }
      }
    }
  }

  // --- springs: a pad that throws you at the high coins -------------------
  if (p.onGround && p.y < 1.5 && p.jet <= 0) {
    for (const sp of track.springs) {
      if (p.x > sp.x && p.x < sp.x + sp.w) {
        p.vy = C.SPRING_V; p.onGround = false; p.jumps = 1; p.sliding = false; p.sprung = 1;
        break;
      }
    }
  }
  // --- support ---
  if (p.onGround) {
    let sup = false;
    if (p.y > -1.5 && p.y < 1.5) sup = groundAt(track, p.x, w.holes);
    else {
      const i0 = Math.max(0, lowerBound(track.floats, p.x - 420));
      for (let i = i0; i < track.floats.length; i++) {
        const pf = track.floats[i];
        if (pf.x > p.x + 40) break;
        if (Math.abs(pf.y - p.y) < 1.5 && p.x + C.HW > pf.x && p.x - C.HW < pf.x + pf.w) { sup = true; break; }
      }
    }
    if (!sup && p.y > 1.5) {
      for (const ps of movingTops(track, p.x, w.time)) if (Math.abs(ps - p.y) < 2.5) { sup = true; break; }
      if (sup) {
        // Ride it. The platform's own drift is added to the player so they do
        // not slide off the back of a moving surface.
        for (const m of track.movers) {
          const now = moverAt(m, w.time), was = moverAt(m, w.time - dt);
          if (p.x > now.x - 2 && p.x < now.x + now.w + 2 && Math.abs(now.y - p.y) < 2.5) {
            p.x += now.x - was.x; p.y += now.y - was.y; break;
          }
        }
      }
    }
    if (!sup) { p.onGround = false; p.sliding = false; }
    else { p.safeX = p.x; p.safeY = p.y; }
  }

  // --- static hazards ---
  const h = p.sliding ? C.H_SLIDE : C.H_STAND;
  const oi = Math.max(0, lowerBound(track.obst, p.x - 240));
  for (let i = oi; i < track.obst.length; i++) {
    const o = track.obst[i];
    if (o.x > p.x + 120) break;
    if (p.jet > 0 || o.dead) continue;
    if (o.type === 'wall') {
      // A wall is solid, but it may only stagger you once. Without this guard a
      // runner pressed against it is re-stunned every single frame, and since a
      // stunned racer cannot jump, they grind there until the race ends.
      if (p.x + C.HW > o.x - o.w / 2 && p.x - C.HW < o.x + o.w / 2 && p.y < o.h - 6 && p.y > -40) {
        p.x = o.x - o.w / 2 - C.HW - 1;
        if (p.inv > 0) { if (p.vx > 0) p.vx = 0; }   // blocked, but free to jump out
        else hit(p, 0.16, 0.42);
      }
      continue;
    }
    if (p.inv > 0) continue;
    if (o.type === 'spike') {
      if (p.x + C.HW * 0.7 > o.x - o.w / 2 && p.x - C.HW * 0.7 < o.x + o.w / 2 && p.y < 18) { clearOf(p, o.x - o.w / 2, o.x + o.w / 2); hit(p, 0.36, 0.35); }
    } else if (o.type === 'beam') {
      const bb = (o.base || 0) + C.BEAM_BOT;
      if (p.x + C.HW > o.x - o.w / 2 && p.x - C.HW < o.x + o.w / 2 && p.y + h > bb && p.y < (o.base || 0) + 150) { clearOf(p, o.x - o.w / 2, o.x + o.w / 2); hit(p, 0.28, 0.38); }
    } else if (o.type === 'saw') {
      const cx = Math.max(p.x - C.HW, Math.min(o.x, p.x + C.HW));
      const cy = Math.max(p.y, Math.min(o.r + 6, p.y + h));
      const dx = cx - o.x, dy = cy - (o.r + 6);
      if (dx * dx + dy * dy < o.r * o.r) { clearOf(p, o.x - o.r, o.x + o.r); hit(p, 0.42, 0.32); }
    }
  }

  // --- dropped sawtraps ---
  if (p.jet <= 0 && p.inv <= 0) {
    for (let i = 0; i < w.mines.length; i++) {
      const m = w.mines[i];
      if (Math.abs(m.x - p.x) < C.HW + 16 && p.y < 34) { m.dead = true; hit(p, 0.5, 0.3); break; }
    }
  }

  // --- fell out of the world ---
  // Two tries at the same gap is a setback; a third is a broken game, so the
  // second failure puts them down on the far side instead.
  if (p.y < -170) {
    const again = Math.abs(p.x - p.fallX) < 220;
    p.fallN = again ? p.fallN + 1 : 1;
    p.fallX = p.x;
    let rx;
    if (p.fallN >= 2) { rx = skipGap(track, p.x, w.holes); p.fallN = 0; }
    else {
      rx = respawnX(track, p.safeX, w.holes) - 110;
      if (!groundAt(track, rx, w.holes)) rx = respawnX(track, p.safeX, w.holes);
    }
    p.x = rx; p.y = 0; p.vy = 0; p.vx = C.BASE * 0.45;
    p.onGround = true; p.jumps = 2; p.sliding = false;
    p.stun = Math.max(p.stun, 0.4); p.inv = Math.max(p.inv, 1.1);
    p.safeX = p.x; p.safeY = 0;
  }

  if (!p.done && p.x >= track.len) { p.done = true; p.time = w.time; }
  p.phase += p.vx * dt * 0.052;
}

// --- state transfer -------------------------------------------------------
// Compact wire form. Keys are short because this goes out 20x a second.
const F = ['x','y','vx','vy','stun','frozen','boost','shield','jet','inv','atk','atkCd','phase','slideT','safeX','safeY','time','stam','charred'];

export function encodePlayer(p) {
  const o = { i: p.id, s: p.slot, c: p.charIdx, it: p.item, cn: p.coins,
    f: (p.onGround ? 1 : 0) | (p.sliding ? 2 : 0) | (p.done ? 4 : 0) | (p.atkKind ? 8 : 0) | (p.sprinting ? 16 : 0),
    mt: p.meter,
    jm: p.jumps, lb: p.lastBits };
  for (const k of F) o[k] = Math.round(p[k] * 100) / 100;
  return o;
}

export function applyPlayer(p, o) {
  p.id = o.i; p.slot = o.s; p.charIdx = o.c; p.item = o.it; p.coins = o.cn;
  p.onGround = !!(o.f & 1); p.sliding = !!(o.f & 2); p.done = !!(o.f & 4); p.atkKind = (o.f & 8) ? 1 : 0;
  p.sprinting = !!(o.f & 16); p.meter = o.mt;
  p.jumps = o.jm; p.lastBits = o.lb;
  for (const k of F) p[k] = o[k];
  return p;
}

export function clonePlayer(p) { return Object.assign({}, p); }
