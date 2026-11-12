// Bots fill empty slots. They produce INPUT BITS, exactly like a human client,
// and are then fed through the same stepPlayer as everyone else -- so a bot is
// indistinguishable from a player as far as the authority is concerned.

import * as C from '../shared/constants.js';
import { groundAt, lowerBound, edgeAhead, landingAt } from '../shared/track.js';
import { ceilOver as ceilOverBeam } from '../shared/sim.js';

export function createBot(skill) {
  return { skill, blink: 0, stuckT: 0, atkWait: 1.6 + Math.random() * 2, progX: -1e9, progT: 0, useIn: 0, jumpPrev: false, run: false };
}

export function botInput(p, b, w, dt, others) {
  const track = w.track;
  if (b.blink > 0) b.blink -= dt;
  else if (Math.random() < (1 - b.skill) * 1.1 * dt) b.blink = 0.16 + Math.random() * 0.22;
  const blind = b.blink > 0;

  let wantJump = false, wantSlide = false, wantAtk = false, wantUse = false;
  const spd = Math.max(260, p.vx);

  if (!blind) {
    const lead = 0.27 + 0.10 * (1 - b.skill);
    const dJ = spd * lead + 40;
    const oi = Math.max(0, lowerBound(track.obst, p.x - 60));
    for (let i = oi; i < track.obst.length; i++) {
      const o = track.obst[i], dx = o.x - p.x;
      if (dx > dJ + 160) break;
      if (o.dead) continue;
      if (o.type === 'beam') { if (dx < spd * 0.23 + 42 && dx > -50) wantSlide = true; }
      else if (dx > -10 && dx < dJ && p.onGround) wantJump = true;
    }
    for (const m of w.mines) { const dx = m.x - p.x; if (dx > 0 && dx < dJ && p.onGround) wantJump = true; }

    // Pits and dug holes need a LATE jump: landing short is fatal.
    const range = Math.max(160, p.vx * 0.62);
    // Jumping too EARLY drops you into the gap, so aim late -- but keep the
    // window a few ticks wide or the bot cannot hit it at all. The edge is
    // measured against anything landable, platforms included.
    if (p.onGround) {
      const e = edgeAhead(track, p, w.holes);
      if (e) { const d = e.edge - p.x;
        const latest = Math.min(56, Math.max(26, range - e.gap - 10));
        if (d > -12 && d < latest) wantJump = true; }
    }
    // Falling short? Spend the second jump.
    if (!p.onGround && p.jumps > 0 && p.vy < -20) {
      const t2 = (p.vy + Math.sqrt(Math.max(0, p.vy * p.vy + 2 * C.G * Math.max(0, p.y)))) / C.G;
      const land = p.x + p.vx * t2;
      if (landingAt(track, land + 14, w.holes, p.y) == null || landingAt(track, land + 38, w.holes, p.y) == null) wantJump = true;
    }
  }
  // mid-air save when a wall is right ahead and we are too low
  if (!p.onGround && p.jumps > 0) {
    const oi = Math.max(0, lowerBound(track.obst, p.x - 30));
    for (let i = oi; i < track.obst.length; i++) {
      const o = track.obst[i], dx = o.x - p.x;
      if (dx > 76) break;
      if (o.dead || o.type === 'beam') continue;
      const topY = o.type === 'saw' ? o.r * 2 + 10 : (o.type === 'spike' ? 24 : o.h);
      if (dx > 2 && p.y < topY + 8) { wantJump = true; break; }
    }
  }

  // melee, paced so bots do not chain-stun each other
  b.atkWait -= dt;
  if (p.atkCd <= 0 && b.atkWait <= 0 && !blind && !p.sliding && w.time >= C.NO_CONTACT_SEC) {
    for (const o of others) {
      if (o === p || o.done) continue;
      const dx = o.x - p.x;
      if (dx > C.ATK_FWD - 8 || dx < -C.ATK_BACK + 8) continue;
      if (Math.abs(o.y - p.y) > 42) continue;
      wantAtk = true; b.atkWait = (3.4 - b.skill * 1.5) + Math.random() * 2.2;
      break;
    }
  }
  if (p.item >= 0) { if ((b.useIn -= dt) <= 0) wantUse = true; } else b.useIn = 0.3 + Math.random() * 1.1;

  // No state is mutated here: a bot may only produce INPUT, exactly like a
  // human client. Freeing a wedged racer is the authority's job (see Room).
  if (p.x > b.progX + 12) { b.progX = p.x; b.progT = 0; }
  else if ((b.progT += dt) > 0.8) { b.progT = 0; b.progX = p.x;
    if (ceilOverBeam(track, p)) wantSlide = true; else wantJump = true; }

  // Jump is EDGE triggered on the server, so a bot that simply holds the bit
  // would jump exactly once and then never again. Release it for a few ticks
  // after every press so a fresh edge can fire.
  if (wantJump && b.jumpPrev) wantJump = false;   // one tick of release
  b.jumpPrev = wantJump;

  // Sprint the way a player does, or the humans simply walk away from them.
  if (p.stam > 0.55) b.run = true; else if (p.stam < 0.12) b.run = false;

  return (wantJump ? C.IN_JUMP : 0) | (wantSlide ? C.IN_SLIDE : 0) | (wantUse ? C.IN_USE : 0)
       | (wantAtk ? C.IN_ATK : 0) | (b.run ? C.IN_RUN : 0);
}
