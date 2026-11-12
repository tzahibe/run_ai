// Canvas renderer. World space is y-up; the transform flips it so the drawing
// code can think in "height above the ground".

import * as C from '../shared/constants.js';
import { lowerBound } from '../shared/track.js';

let ctx, scale = 1, VW = 925, GYdev = 0;
export const VH = 520;

export function resize(cv) {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(320, Math.round(r.width * dpr)), h = Math.max(180, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  scale = cv.height / VH; VW = cv.width / scale; GYdev = VH * 0.72 * scale;
  return { VW, VH, scale };
}
export const viewWidth = () => VW;

const screenT = cam => ctx.setTransform(scale, 0, 0, scale, 0, 0);
const worldT = cam => ctx.setTransform(scale, 0, 0, -scale, -cam * scale, GYdev);
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

export function render(cv, s) {
  ctx = cv.getContext('2d');
  const t = s.track.def, gy = VH * 0.72, cam = s.cam;
  screenT();
  const g = ctx.createLinearGradient(0, 0, 0, VH); g.addColorStop(0, t.sky[0]); g.addColorStop(1, t.sky[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
  ctx.fillStyle = t.sun; ctx.globalAlpha = .75; ctx.beginPath(); ctx.arc(VW * 0.78, VH * 0.2, 46, 0, 6.284); ctx.fill(); ctx.globalAlpha = 1;

  const span = s.track.len + 2000;
  ctx.save(); ctx.globalAlpha = .42; ctx.fillStyle = t.far;
  for (const b of s.track.bg.far) { const sx = (b.x - cam * 0.25) % span, px = sx < -600 ? sx + span : sx;
    if (px > -400 && px < VW + 400) shape(t.shape, px, gy, b.w, b.h); }
  ctx.restore();
  ctx.save(); ctx.globalAlpha = .8; ctx.fillStyle = t.mid;
  for (const b of s.track.bg.mid) { const sx = (b.x - cam * 0.55) % span, px = sx < -600 ? sx + span : sx;
    if (px > -300 && px < VW + 300) shape(t.shape, px, gy + 10, b.w, b.h); }
  ctx.restore();

  worldT(cam);
  const L = cam - 60, R = cam + VW + 60;
  ctx.fillStyle = t.void; ctx.fillRect(L, 0, R - L, -520);
  for (const run of s.track.runs) {
    if (run.e < L || run.s > R) continue;
    ctx.fillStyle = t.ground; ctx.fillRect(run.s, 0, run.e - run.s, -400);
    ctx.fillStyle = t.top; ctx.fillRect(run.s, 0, run.e - run.s, -11);
  }
  for (const hl of s.entities.holes) {
    if (hl.x + hl.w < L || hl.x > R) continue;
    ctx.fillStyle = '#06040d'; ctx.fillRect(hl.x, 3, hl.w, -520);
    ctx.fillStyle = t.top;
    for (let k = 0; k < 3; k++) { const lx = hl.x + k * 7, rx2 = hl.x + hl.w - k * 7 - 7;
      ctx.beginPath(); ctx.moveTo(lx, 2); ctx.lineTo(lx + 7, 2); ctx.lineTo(lx + 3.5, -6 - k * 4); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(rx2, 2); ctx.lineTo(rx2 + 7, 2); ctx.lineTo(rx2 + 3.5, -6 - k * 4); ctx.closePath(); ctx.fill(); }
  }
  for (const p of s.track.floats) {
    if (p.x + p.w < L || p.x > R) continue;
    ctx.fillStyle = t.ground; rr(p.x, p.y - 16, p.w, 16, 5); ctx.fill();
    ctx.fillStyle = t.top; ctx.fillRect(p.x, p.y - 4, p.w, 4);
  }
  if (s.track.len > L - 200 && s.track.len < R + 200) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(s.track.len - 4, 0, 8, 230);
    for (let i = 0; i < 9; i++) { ctx.fillStyle = i % 2 ? '#1b1130' : '#ffffff'; ctx.fillRect(s.track.len + 4, 150 + i * 9, 9, 9);
      ctx.fillStyle = i % 2 ? '#ffffff' : '#1b1130'; ctx.fillRect(s.track.len + 13, 150 + i * 9, 9, 9); }
  }

  const oi = Math.max(0, lowerBound(s.track.obst, L - 200));
  for (let i = oi; i < s.track.obst.length; i++) {
    const o = s.track.obst[i]; if (o.x > R + 200) break;
    if (s.broken.has(o.idx)) continue;
    if (o.type === 'wall') { ctx.fillStyle = '#2a1f4a'; rr(o.x - o.w / 2, 0, o.w, o.h, 4); ctx.fill(); ctx.fillStyle = t.top; ctx.fillRect(o.x - o.w / 2, o.h - 5, o.w, 5); }
    else if (o.type === 'spike') { ctx.fillStyle = '#d9e2ef'; const n = Math.round(o.w / 18);
      for (let k = 0; k < n; k++) { const sx = o.x - o.w / 2 + k * 18; ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx + 9, 24); ctx.lineTo(sx + 18, 0); ctx.closePath(); ctx.fill(); } }
    else if (o.type === 'beam') { ctx.fillStyle = '#2a1f4a'; rr(o.x - o.w / 2, C.BEAM_BOT, o.w, 120, 5); ctx.fill(); ctx.fillStyle = t.top; ctx.fillRect(o.x - o.w / 2, C.BEAM_BOT, o.w, 5); }
    else if (o.type === 'saw') drawSaw(o.x, o.r + 6, o.r, o.a + s.now * 5.5);
  }
  for (const m of s.entities.mines) drawSaw(m.x, m.y, 15, s.now * 7);

  const ii = Math.max(0, lowerBound(s.track.items, L - 120));
  for (let i = ii; i < s.track.items.length; i++) {
    const it = s.track.items[i]; if (it.x > R + 120) break;
    if (it.type === 'coin') {
      if (s.coins.has(it.idx)) continue;
      const w = Math.abs(Math.cos(s.now * 3 + it.x * 0.01)) * 9 + 3;
      ctx.fillStyle = '#ffc531'; ctx.beginPath(); ctx.ellipse(it.x, it.y, w, 10, 0, 0, 6.284); ctx.fill();
      ctx.fillStyle = '#fff0a8'; ctx.beginPath(); ctx.ellipse(it.x, it.y, w * 0.45, 5, 0, 0, 6.284); ctx.fill();
    } else {
      if (s.crates.has(it.idx)) continue;
      const bob = Math.sin(s.now * 2.4 + it.x * 0.01) * 5;
      if (s.meItem < 0 && it.x > s.me.x - 60 && it.x < s.me.x + 420) {
        ctx.globalAlpha = .22 + 0.14 * Math.sin(s.now * 6); ctx.fillStyle = '#ffc531';
        ctx.beginPath(); ctx.arc(it.x, it.y + bob, 30, 0, 6.284); ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.save(); ctx.translate(it.x, it.y + bob); ctx.rotate(Math.sin(s.now * 1.6) * 0.08);
      ctx.fillStyle = '#5e3a1b'; rr(-19, -19, 38, 38, 5); ctx.fill();
      ctx.fillStyle = '#a8702f'; rr(-15.5, -15.5, 31, 31, 3); ctx.fill();
      ctx.strokeStyle = '#c99354'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-12, -12); ctx.lineTo(12, 12); ctx.moveTo(12, -12); ctx.lineTo(-12, 12); ctx.stroke();
      ctx.fillStyle = '#d6a26a'; ctx.fillRect(-19, 13, 38, 6);
      ctx.fillStyle = '#4a2d14'; ctx.fillRect(-19, -19, 38, 5);
      ctx.restore();
    }
  }

  for (const sh of s.entities.shots) {
    if (sh.k === 0) {
      ctx.save(); ctx.translate(sh.x, sh.y); ctx.rotate(Math.atan2(sh.vy, sh.vx));
      ctx.globalAlpha = .85; ctx.fillStyle = '#ffc531';
      ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-24 - Math.random() * 13, 4.5); ctx.lineTo(-24 - Math.random() * 13, -4.5); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#6b7280'; ctx.strokeStyle = '#2c323d'; ctx.lineWidth = 1.7;
      rr(-11, -5, 18, 10, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff6b35'; ctx.beginPath(); ctx.moveTo(7, -5.2); ctx.lineTo(16, 0); ctx.lineTo(7, 5.2); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    } else {
      ctx.save(); ctx.translate(sh.x, sh.y); ctx.rotate(s.now * 9);
      ctx.fillStyle = '#7a9c3f'; ctx.strokeStyle = '#36471b'; ctx.lineWidth = 1.9;
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, 6.284); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#6b7280'; rr(-3, 6, 6, 5, 1.6); ctx.fill(); ctx.stroke(); ctx.restore();
    }
  }

  for (const b of s.blasts) {
    const k = b.t / b.life, rad = b.r * (0.35 + 0.65 * Math.sqrt(k));
    ctx.globalAlpha = (1 - k) * 0.7; ctx.fillStyle = '#ff9d3d'; ctx.beginPath(); ctx.arc(b.x, b.y, rad, 0, 6.284); ctx.fill();
    ctx.globalAlpha = (1 - k) * 0.9; ctx.fillStyle = '#fff6c9'; ctx.beginPath(); ctx.arc(b.x, b.y, rad * 0.52, 0, 6.284); ctx.fill();
    ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ff6b35'; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.arc(b.x, b.y, rad, 0, 6.284); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  for (const p of s.parts) { ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2.2)); ctx.fillStyle = p.col; ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s); }
  ctx.globalAlpha = 1;

  for (const r of s.racers) drawRunner(r, s);

  // off-screen markers
  screenT();
  for (const r of s.racers) {
    if (r.id === s.me.id || r.done) continue;
    const sx = r.x - cam;
    if (sx < -30) tag(10, gy - 60, r, '<');
    else if (sx > VW + 30) tag(VW - 26, gy - 60, r, '>');
  }
}

function tag(x, y, r, ch) {
  ctx.fillStyle = C.CHARS[r.charIdx].col; ctx.globalAlpha = .9; rr(x - 7, y - 9, 30, 18, 6); ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = '#15102a'; ctx.font = '900 12px Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, x + 8, y);
}
function shape(kind, x, gy, w, h) {
  if (kind === 'blob') { ctx.beginPath(); ctx.ellipse(x, gy - h * 0.75, w * 0.5, h * 0.42, 0, 0, 6.284); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x - w * 0.3, gy - h * 0.6, w * 0.3, h * 0.3, 0, 0, 6.284); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + w * 0.3, gy - h * 0.62, w * 0.28, h * 0.28, 0, 0, 6.284); ctx.fill(); }
  else if (kind === 'arch') { ctx.beginPath(); ctx.moveTo(x - w / 2, gy); ctx.lineTo(x - w / 2, gy - h * 0.6); ctx.arc(x, gy - h * 0.6, w / 2, Math.PI, 0); ctx.lineTo(x + w / 2, gy); ctx.closePath(); ctx.fill(); }
  else { ctx.beginPath(); ctx.moveTo(x - w / 2, gy); ctx.lineTo(x, gy - h); ctx.lineTo(x + w / 2, gy); ctx.closePath(); ctx.fill(); }
}
function drawSaw(x, y, r, a) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = '#c9d4e3'; ctx.beginPath();
  for (let i = 0; i < 10; i++) { const t1 = i / 10 * 6.284, t2 = (i + 0.5) / 10 * 6.284;
    ctx.lineTo(Math.cos(t1) * r, Math.sin(t1) * r); ctx.lineTo(Math.cos(t2) * r * 0.72, Math.sin(t2) * r * 0.72); }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#7c8ba1'; ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, 6.284); ctx.fill(); ctx.restore();
}

// ------------------------------------------------------------------ racers
// ---- sprites -------------------------------------------------------------
// A character with a `sprite` path is drawn from that image instead of from
// code; the run, jump and slide are faked around the still. Characters without
// one keep the drawn art, so a half-finished set still works.
const SPRITE_H = 78;
const _imgs = {};
export function loadSprites(base) {
  for (const c of C.CHARS) {
    if (!c.sprite || _imgs[c.id] !== undefined) continue;
    const im = new Image();
    im.onload = () => { _imgs[c.id] = im; };
    im.onerror = () => { _imgs[c.id] = null; };
    _imgs[c.id] = undefined;
    im.src = (base || '') + c.sprite;
  }
}
function spriteFor(c) { const im = _imgs[c.id]; return im && im.complete ? im : null; }

function drawSprite(c, im, o) {
  const ar = im.width / im.height, ph = o.ph || 0, air = o.air;
  let h = SPRITE_H, w = h * ar, lift = 0, rot = 0, sx = 1, sy = 1;
  if (o.slide) { rot = -1.15; h *= 0.94; w = h * ar; lift = 10; }
  else if (air) { rot = 0.1; }
  else { const b = Math.abs(Math.sin(ph));
    lift = b * 2.6; rot = Math.sin(ph) * 0.05; sy = 1 + b * 0.05; sx = 1 - b * 0.035; }
  if (o.atk > 0 && !o.atkKind) rot += 0.12 * Math.sin(Math.min(1, o.atk) * Math.PI);
  ctx.save();
  ctx.translate(0, lift); ctx.rotate(rot); ctx.scale(sx, sy);
  ctx.scale(1, -1);                       // world space is y-up; images are not
  ctx.drawImage(im, -w * 0.5, -h, w, h);
  ctx.restore();
  if (!air && !o.slide) {
    ctx.globalAlpha = .45; ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 3; i++) { const p = ((ph * 0.16 + i * 0.33) % 1);
      ctx.beginPath(); ctx.arc(-6 - p * 24, 2 + p * 6, 1.8 + p * 4.5, 0, 6.284); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
}

function drawRunner(r, s) {
  const c = C.CHARS[r.charIdx];
  ctx.save();
  ctx.globalAlpha = .22; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(r.x, (r.onGround ? r.y : r.safeY) + 2, 15 * (r.onGround ? 1 : 0.7), 4.6, 0, 0, 6.284); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.save(); ctx.translate(r.x, r.y);
  if (r.inv > 0 && r.shield <= 0) ctx.globalAlpha = (Math.floor(s.now * 15) % 2) ? 0.42 : 1;
  const pose = { ph: r.phase, air: !r.onGround, slide: r.sliding, stunned: r.stun > 0, hit: false,
    eyeShut: false, jet: r.jet > 0, atk: r.atk > 0 ? 1 - r.atk / C.ATK_DUR : 0, atkKind: r.atkKind };
  const im = spriteFor(c);
  if (im) drawSprite(c, im, pose); else paintChar(c, pose);
  ctx.restore();
  if (r.shield > 0) { ctx.globalAlpha = .28 + 0.16 * Math.sin(s.now * 8); ctx.fillStyle = '#3fb6f5';
    ctx.beginPath(); ctx.arc(r.x, r.y + 27, 33, 0, 6.284); ctx.fill(); ctx.globalAlpha = .9;
    ctx.strokeStyle = '#8bdcff'; ctx.lineWidth = 2.4; ctx.stroke(); ctx.globalAlpha = 1; }
  if (r.frozen > 0) { ctx.globalAlpha = .55; ctx.fillStyle = '#8bdcff'; rr(r.x - 19, r.y - 3, 38, 64, 9); ctx.fill(); ctx.globalAlpha = 1; }
  if (r.stun > 0 && r.frozen <= 0) { ctx.fillStyle = '#ffc531';
    for (let i = 0; i < 3; i++) { const a = s.now * 7 + i * 2.1; ctx.beginPath(); ctx.arc(r.x + Math.cos(a) * 15, r.y + 62 + Math.sin(a) * 4.5, 3, 0, 6.284); ctx.fill(); } }
  ctx.restore();
}

// ---- character art -------------------------------------------------------
// Drawn in world space: y is up, the feet sit at 0, and the racer faces right.
// The look is built from five ideas: big joined eyes, a light muzzle with a
// smirk, swept-back quills or ears, chunky sneakers, and white gloves.

function quills(c, R, from, count, len, spread) {
  ctx.fillStyle = c.quill || c.col; ctx.strokeStyle = c.dark; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  for (let i = 0; i < count; i++) {
    const a = from + i * spread;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a - 0.26) * R * 0.92, Math.sin(a - 0.26) * R * 0.92);
    ctx.lineTo(Math.cos(a) * R * len, Math.sin(a) * R * len);
    ctx.lineTo(Math.cos(a + 0.26) * R * 0.92, Math.sin(a + 0.26) * R * 0.92);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
}

function paintTail(c, x, y, wag) {
  const t = c.tail;
  if (t === 'none') return;
  ctx.save(); ctx.translate(x, y); ctx.rotate(wag);
  if (t === 'bush') {                                   // fox / wolf: thick sweep
    ctx.fillStyle = c.col; ctx.strokeStyle = c.dark; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(2, 6);
    ctx.quadraticCurveTo(-16, 10, -22, 24); ctx.quadraticCurveTo(-10, 20, -2, -2);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c.belly; ctx.beginPath();
    ctx.moveTo(-18, 18); ctx.quadraticCurveTo(-23, 21, -22, 24); ctx.quadraticCurveTo(-18, 23, -15, 21);
    ctx.closePath(); ctx.fill();
  } else if (t === 'lion') {
    ctx.strokeStyle = c.col; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 2); ctx.quadraticCurveTo(-16, 10, -19, 22); ctx.stroke();
    ctx.fillStyle = c.mane || c.dark; ctx.strokeStyle = c.dark; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(-19.5, 23.5, 5, 0, 6.284); ctx.fill(); ctx.stroke();
  } else if (t === 'puff') {
    ctx.fillStyle = c.belly; ctx.strokeStyle = c.dark; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(-2, 4, 5.6, 0, 6.284); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(-6, 7, 3.4, 0, 6.284); ctx.fill(); ctx.stroke();
  } else if (t === 'spike') {                           // dragon / shark
    ctx.fillStyle = c.quill || c.col; ctx.strokeStyle = c.dark; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(2, 8); ctx.lineTo(-22, 16); ctx.lineTo(-6, -2); ctx.closePath();
    ctx.fill(); ctx.stroke();
  } else {                                              // thin whip
    ctx.strokeStyle = c.col; ctx.lineWidth = 5.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 2); ctx.quadraticCurveTo(-14, 8, -17, 20); ctx.stroke();
    ctx.strokeStyle = c.belly; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(-15, 13); ctx.quadraticCurveTo(-16.6, 17, -17, 20); ctx.stroke();
  }
  ctx.restore();
}

function paintEars(c, R, flop) {
  const col = c.col, dk = c.dark, inner = c.belly;
  const k = c.ear;
  if (k === 'hedgehog') { quills(c, R, 2.35, 4, 2.15, 0.34); }
  else if (k === 'lion') {
    ctx.fillStyle = c.mane; ctx.beginPath();
    for (let i = 0; i <= 18; i++) { const a = i / 18 * 6.284, rr2 = R * (1.4 + 0.22 * (i % 2)); ctx.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2); }
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-R * 0.5, R * 1.1); ctx.quadraticCurveTo(-R * 0.35, R * 2.2, R * 0.5, R * 1.65);
    ctx.quadraticCurveTo(R * 0.05, R * 1.35, R * 0.1, R * 1.05); ctx.closePath(); ctx.fill();
    for (let g = -1; g <= 1; g += 2) { ctx.fillStyle = col; ctx.strokeStyle = dk; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(g * R * 0.72, R * 0.76, R * 0.28, 0, 6.284); ctx.fill(); ctx.stroke(); }
  }
  else if (k === 'panda') { for (let g = -1; g <= 1; g += 2) { ctx.fillStyle = dk;
      ctx.beginPath(); ctx.arc(g * R * 0.72, R * 0.82, R * 0.4, 0, 6.284); ctx.fill(); } }
  else if (k === 'bunny') {
    for (let g = -1; g <= 1; g += 2) { ctx.save(); ctx.translate(g * 6, R * 0.68); ctx.rotate(g * (0.3 + flop));
      ctx.fillStyle = col; ctx.strokeStyle = dk; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.ellipse(0, 13, 5, 14, 0, 0, 6.284); ctx.fill(); ctx.stroke();
      ctx.fillStyle = inner; ctx.beginPath(); ctx.ellipse(0, 13, 2.5, 9, 0, 0, 6.284); ctx.fill(); ctx.restore(); }
  }
  else if (k === 'rhino') { for (let g = -1; g <= 1; g += 2) { ctx.fillStyle = col; ctx.strokeStyle = dk; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(g * R * 0.8, R * 0.7, R * 0.18, R * 0.3, g * 0.35, 0, 6.284); ctx.fill(); ctx.stroke(); } }
  else if (k === 'dragon') {
    quills(c, R, 2.5, 3, 1.75, 0.38);
    for (let g = -1; g <= 1; g += 2) { ctx.fillStyle = '#ece5d4'; ctx.strokeStyle = '#8d8673'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(g * R * 0.38, R * 0.76); ctx.lineTo(g * R * 0.72, R * 1.72); ctx.lineTo(g * R * 0.78, R * 0.66);
      ctx.closePath(); ctx.fill(); ctx.stroke(); } }
  else if (k === 'fin') {
    ctx.fillStyle = c.quill || col; ctx.strokeStyle = dk; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-R * 0.75, R * 0.6); ctx.lineTo(-R * 0.15, R * 2.0); ctx.lineTo(R * 0.3, R * 0.75);
    ctx.closePath(); ctx.fill(); ctx.stroke(); }
  else if (k === 'round') { for (let g = -1; g <= 1; g += 2) { ctx.fillStyle = col; ctx.strokeStyle = dk; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(g * R * 0.72, R * 0.8, R * 0.34, 0, 6.284); ctx.fill(); ctx.stroke();
      ctx.fillStyle = inner; ctx.beginPath(); ctx.arc(g * R * 0.72, R * 0.8, R * 0.17, 0, 6.284); ctx.fill(); } }
  else {                                                 // pointed: fox, wolf, cat, tiger
    const tall = k === 'wolf' ? 1.62 : 1.45, wide = k === 'cat' ? 11 : 13;
    for (let g = -1; g <= 1; g += 2) {
      ctx.fillStyle = col; ctx.strokeStyle = dk; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(g * 2.5, R * 0.6); ctx.lineTo(g * (wide * 0.6), R * tall); ctx.lineTo(g * wide, R * 0.42);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = k === 'fox' ? '#fdf6ec' : inner;
      ctx.beginPath(); ctx.moveTo(g * 5, R * 0.68); ctx.lineTo(g * (wide * 0.58), R * (tall * 0.84)); ctx.lineTo(g * (wide * 0.8), R * 0.56);
      ctx.closePath(); ctx.fill();
    }
  }
}

function paintFace(c, h, R) {
  const dk = c.dark, ey = R * 0.16;
  if (c.patch === 'panda') { ctx.fillStyle = dk;
    for (let g = -1; g <= 1; g += 2) { ctx.save(); ctx.translate(g * R * 0.34 + R * 0.1, ey); ctx.rotate(g * 0.5);
      ctx.beginPath(); ctx.ellipse(0, 0, R * 0.36, R * 0.5, 0, 0, 6.284); ctx.fill(); ctx.restore(); } }
  if (c.stripes) { ctx.strokeStyle = dk; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) { const yy = R * (0.5 + i * 0.26);
      ctx.beginPath(); ctx.moveTo(-R * 0.72, yy); ctx.lineTo(-R * 0.3, yy + R * 0.1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(R * 0.72, yy - R * 0.05); ctx.lineTo(R * 0.34, yy + R * 0.05); ctx.stroke(); } }

  // muzzle
  ctx.fillStyle = c.muzzle || c.belly; ctx.strokeStyle = dk; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(R * 0.36, -R * 0.38, R * 0.54, R * 0.38, 0, 0, 6.284); ctx.fill(); ctx.stroke();
  if (c.ear === 'fin') {                                  // a mouth full of teeth
    ctx.fillStyle = '#2a1420'; ctx.beginPath(); ctx.ellipse(R * 0.4, -R * 0.5, R * 0.42, R * 0.2, 0, 0, 6.284); ctx.fill();
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++) { const x = R * 0.06 + i * R * 0.22;
      ctx.beginPath(); ctx.moveTo(x, -R * 0.36); ctx.lineTo(x + R * 0.1, -R * 0.58); ctx.lineTo(x + R * 0.2, -R * 0.36); ctx.closePath(); ctx.fill(); }
  } else {
    ctx.strokeStyle = dk; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(R * 0.14, -R * 0.44); ctx.quadraticCurveTo(R * 0.46, -R * 0.68, R * 0.74, -R * 0.38); ctx.stroke();
  }
  ctx.fillStyle = dk; ctx.beginPath(); ctx.ellipse(R * 0.4, -R * 0.12, R * 0.17, R * 0.13, 0, 0, 6.284); ctx.fill();

  // the big joined eyes
  const e1x = -R * 0.14, e2x = R * 0.34, erx = R * 0.34, ery = R * 0.46;
  if (h.stunned) {
    ctx.strokeStyle = dk; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    for (const sx of [e1x, e2x]) { ctx.beginPath();
      ctx.moveTo(sx - 4, ey - 4); ctx.lineTo(sx + 4, ey + 4); ctx.moveTo(sx + 4, ey - 4); ctx.lineTo(sx - 4, ey + 4); ctx.stroke(); }
    return;
  }
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = dk; ctx.lineWidth = 2.1;
  ctx.beginPath();
  ctx.ellipse(e1x, ey + R * 0.03, erx, ery, -0.2, 0, 6.284);
  ctx.ellipse(e2x, ey, erx, ery, 0.16, 0, 6.284);
  ctx.fill(); ctx.stroke();
  if (h.eyeShut) {
    ctx.strokeStyle = dk; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(e1x - 4.5, ey); ctx.quadraticCurveTo(e1x, ey + 3.4, e1x + 4.5, ey); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(e2x - 4.5, ey); ctx.quadraticCurveTo(e2x, ey + 3.4, e2x + 4.5, ey); ctx.stroke();
  } else {
    const look = h.atk ? R * 0.1 : 0;
    for (const [sx, tilt] of [[e1x, -0.2], [e2x, 0.16]]) {
      ctx.save(); ctx.translate(sx + R * 0.08 + look, ey - R * 0.02); ctx.rotate(tilt);
      if (c.eye) { ctx.fillStyle = c.eye; ctx.beginPath(); ctx.ellipse(0, 0, R * 0.17, R * 0.26, 0, 0, 6.284); ctx.fill(); }
      ctx.fillStyle = '#17121f'; ctx.beginPath(); ctx.ellipse(0, -R * 0.02, R * 0.12, R * 0.2, 0, 0, 6.284); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(R * 0.05, R * 0.12, R * 0.06, R * 0.08, 0, 0, 6.284); ctx.fill();
      ctx.restore();
    }
  }
  // brows: the whole attitude lives here
  ctx.strokeStyle = dk; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(e1x - R * 0.34, ey + R * 0.62); ctx.lineTo(e1x + R * 0.26, ey + R * 0.4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(e2x + R * 0.36, ey + R * 0.6); ctx.lineTo(e2x - R * 0.2, ey + R * 0.38); ctx.stroke();
}

function paintAcc(c, R, ph) {
  const col = c.acc2, a = c.acc;
  if (a === 'shades') {
    ctx.fillStyle = '#17121f'; ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-R * 1.0, R * 0.42); ctx.lineTo(R * 1.0, R * 0.34);
    ctx.lineTo(R * 0.92, -R * 0.12); ctx.lineTo(-R * 0.92, -R * 0.04); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.globalAlpha = .45; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(-R * 0.7, R * 0.3); ctx.lineTo(-R * 0.2, R * 0.26); ctx.lineTo(-R * 0.5, -R * 0.02); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  } else if (a === 'headband') {
    ctx.fillStyle = col; ctx.strokeStyle = '#00000055'; ctx.lineWidth = 1.5;
    rr(-R * 1.02, R * 0.34, R * 2.04, R * 0.42, 4); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.rotate(Math.sin(ph * 0.9) * 0.25);
    ctx.beginPath(); ctx.moveTo(-R * 0.9, R * 0.52); ctx.lineTo(-R * 2.0, R * 0.12); ctx.lineTo(-R * 1.72, R * 0.8); ctx.closePath();
    ctx.fill(); ctx.stroke(); ctx.restore();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, R * 0.56, 2.4, 0, 6.284); ctx.fill();
    for (let i = 0; i < 3; i++) { const a2 = 0.6 + i * 0.9; ctx.beginPath(); ctx.arc(Math.cos(a2) * 4.4, R * 0.56 + Math.sin(a2) * 4.4, 1.2, 0, 6.284); ctx.fill(); }
  } else if (a === 'phones') {
    ctx.strokeStyle = '#2f3a46'; ctx.lineWidth = 4.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, R * 0.12, R * 1.04, 0.4, Math.PI - 0.4); ctx.stroke();
    for (let g = -1; g <= 1; g += 2) { ctx.fillStyle = col; ctx.strokeStyle = '#2f3a46'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.ellipse(g * R * 1.04, R * 0.12, R * 0.3, R * 0.42, 0, 0, 6.284); ctx.fill(); ctx.stroke(); }
  } else if (a === 'cap') {
    ctx.fillStyle = col; ctx.strokeStyle = '#00000044'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, R * 0.2, R * 0.98, 0, Math.PI); ctx.fill(); ctx.stroke();
    ctx.fillRect(-R * 0.98, R * 0.14, R * 1.96, R * 0.14);
    ctx.beginPath(); rr(-R * 1.95, R * 0.1, R * 1.0, R * 0.18, 3); ctx.fill(); ctx.stroke();   // worn backwards
  } else if (a === 'goggles') {
    ctx.strokeStyle = '#3b3346'; ctx.lineWidth = 4.4;
    ctx.beginPath(); ctx.moveTo(-R * 1.0, R * 0.56); ctx.lineTo(R * 1.0, R * 0.5); ctx.stroke();
    for (let g = -1; g <= 1; g += 2) { ctx.fillStyle = col; ctx.strokeStyle = '#3b3346'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(g * R * 0.44, R * 0.56, R * 0.34, 0, 6.284); ctx.fill(); ctx.stroke(); }
  } else if (a === 'bandana') {
    ctx.fillStyle = col; ctx.strokeStyle = '#00000055'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-R * 1.0, R * 0.32); ctx.lineTo(R * 1.0, R * 0.32); ctx.lineTo(R * 0.84, R * 0.92); ctx.lineTo(-R * 0.84, R * 0.92);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.rotate(Math.sin(ph * 0.8) * 0.22);
    ctx.beginPath(); ctx.moveTo(-R * 0.88, R * 0.52); ctx.lineTo(-R * 1.8, R * 0.2); ctx.lineTo(-R * 1.54, R * 0.8); ctx.closePath();
    ctx.fill(); ctx.stroke(); ctx.restore();
  } else if (a === 'crown') {
    ctx.fillStyle = col; ctx.strokeStyle = '#6b4f10'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.beginPath();
    ctx.moveTo(-R * 0.72, R * 0.78); ctx.lineTo(-R * 0.72, R * 1.28); ctx.lineTo(-R * 0.36, R * 1.0); ctx.lineTo(0, R * 1.44);
    ctx.lineTo(R * 0.36, R * 1.0); ctx.lineTo(R * 0.68, R * 1.08); ctx.lineTo(R * 0.72, R * 0.78); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
}

function paintHead(c, h) {
  ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(h.tilt || 0);
  const R = h.r, col = h.hit ? '#ffffff' : c.col, dk = c.dark, flop = Math.sin((h.ph || 0) * 0.5) * 0.16;
  paintEars(c, R, flop);
  ctx.fillStyle = col; ctx.strokeStyle = dk; ctx.lineWidth = 2.8;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.284); ctx.fill(); ctx.stroke();
  shade(0, 0, R, R);
  if (c.horn) { ctx.fillStyle = '#ece5d4'; ctx.strokeStyle = '#8d8673'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(R * 0.46, -R * 0.5); ctx.lineTo(R * 1.34, R * 0.3); ctx.lineTo(R * 0.84, -R * 0.64); ctx.closePath();
    ctx.fill(); ctx.stroke(); }
  if (c.hair) { ctx.fillStyle = c.hair; ctx.strokeStyle = dk; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(-R * 0.6, R * 0.74); ctx.quadraticCurveTo(-R * 1.0, R * 1.8, R * 0.1, R * 1.32);
    ctx.quadraticCurveTo(-R * 0.2, R * 1.02, -R * 0.3, R * 0.82); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  paintFace(c, h, R);
  if (c.scarf) { ctx.fillStyle = c.scarf; ctx.strokeStyle = '#00000055'; ctx.lineWidth = 1.3;
    ctx.beginPath(); rr(-R * 0.94, -R * 1.46, R * 1.88, R * 0.42, 4); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-R * 0.3, -R * 1.4); ctx.lineTo(R * 0.44, -R * 1.4); ctx.lineTo(R * 0.06, -R * 2.16); ctx.closePath();
    ctx.fill(); ctx.stroke(); }
  if (c.acc) paintAcc(c, R, h.ph || 0);
  ctx.restore();
}

// One cheap pass that reads as volume: light off the top, shadow underneath.
function shade(x, y, rx, ry) {
  const g = ctx.createLinearGradient(0, y + ry, 0, y - ry);
  g.addColorStop(0, 'rgba(255,255,255,0.22)');
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.26)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 6.284); ctx.fill();
}

function shoe(c, x, y, rot) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0);
  ctx.fillStyle = c.shoe || '#e8402f'; ctx.strokeStyle = c.dark; ctx.lineWidth = 2;
  ctx.beginPath(); rr(-6, 0, 15, 9, 4.2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); rr(-6.5, 0, 16, 3.2, 2); ctx.fill();
  ctx.fillStyle = c.strap || '#ffffff'; ctx.beginPath(); rr(0, 2.6, 3.4, 6.4, 1.4); ctx.fill();
  ctx.restore();
}
function glove(x, y) {
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#b9b3c4'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(x, y, 4.8, 0, 6.284); ctx.fill(); ctx.stroke();
}

function paintChar(c, o) {
  const ph = o.ph || 0, col = o.hit ? '#ffffff' : c.col, dk = c.dark;
  if (o.jet) { ctx.fillStyle = '#ffc531'; ctx.beginPath();
    ctx.moveTo(-6, 2); ctx.lineTo(0, -10 - Math.random() * 9); ctx.lineTo(6, 2); ctx.closePath(); ctx.fill(); }

  if (o.slide) {
    paintTail(c, -16, 10, 0.7);
    ctx.strokeStyle = dk; ctx.lineWidth = 5.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-5, 10); ctx.lineTo(-17, 5); ctx.moveTo(-4, 8); ctx.lineTo(-15, 13); ctx.stroke();
    shoe(c, -22, 2, 0.5); shoe(c, -19, 10, 0.9);
    ctx.fillStyle = col; ctx.strokeStyle = dk; ctx.lineWidth = 2.8;
    ctx.beginPath(); ctx.ellipse(-2, 12, 15, 9, 0, 0, 6.284); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c.belly; ctx.beginPath(); ctx.ellipse(-3, 9, 9, 5, 0, 0, 6.284); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(6, 14); ctx.lineTo(16, 19); ctx.stroke();
    glove(18, 20);
    paintHead(c, { x: 12, y: 17, r: 11.5, ph, stunned: o.stunned, hit: o.hit, tilt: -0.3 });
    return;
  }

  const air = o.air, bob = air ? 0 : Math.abs(Math.sin(ph)) * 1.8;
  const sw = Math.sin(ph), cw = Math.cos(ph);
  paintTail(c, -12, 20 + bob, air ? 0.45 : Math.sin(ph * 0.5) * 0.3);
  if (c.pack) { ctx.fillStyle = c.pack; ctx.strokeStyle = dk; ctx.lineWidth = 2;
    rr(-21, 15 + bob, 13, 20, 5); ctx.fill(); ctx.stroke(); }

  // legs and the big sneakers
  ctx.strokeStyle = dk; ctx.lineWidth = 5.6; ctx.lineCap = 'round';
  if (air) {
    ctx.beginPath(); ctx.moveTo(-3, 15); ctx.lineTo(-10, 9); ctx.moveTo(4, 15); ctx.lineTo(12, 11); ctx.stroke();
    shoe(c, -16, 5, 0.5); shoe(c, 7, 7, -0.3);
  } else {
    ctx.beginPath(); ctx.moveTo(-2, 15); ctx.lineTo(sw * 9, 8); ctx.moveTo(3, 15); ctx.lineTo(-sw * 9, 8); ctx.stroke();
    shoe(c, sw * 9 - 4, Math.max(0, 6 - Math.abs(sw) * 6), sw * 0.3);
    shoe(c, -sw * 9 - 4, Math.max(0, 6 - Math.abs(sw) * 6), -sw * 0.3);
  }

  // body
  ctx.fillStyle = col; ctx.strokeStyle = dk; ctx.lineWidth = 2.8;
  ctx.beginPath(); ctx.ellipse(0, 24 + bob, 12, 13.5, 0, 0, 6.284); ctx.fill(); ctx.stroke();
  shade(0, 24 + bob, 12, 13.5);
  ctx.fillStyle = c.belly; ctx.beginPath(); ctx.ellipse(1, 21 + bob, 7.4, 8.4, 0, 0, 6.284); ctx.fill();
  if (c.stripes) { ctx.strokeStyle = dk; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-10, 28 + bob); ctx.lineTo(-6, 26 + bob); ctx.moveTo(-10.5, 23 + bob); ctx.lineTo(-6.5, 21.5 + bob); ctx.stroke(); }

  // arms and gloves
  const ext = o.atk > 0 ? Math.sin(Math.min(1, o.atk) * Math.PI) : 0;
  ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.lineCap = 'round';
  if (ext > 0 && !o.atkKind) {
    ctx.beginPath(); ctx.moveTo(8, 26 + bob); ctx.lineTo(13 + 17 * ext, 25 + bob); ctx.stroke();
    glove(15 + 17 * ext, 25 + bob);
    ctx.beginPath(); ctx.moveTo(-10, 26 + bob); ctx.lineTo(-15, 21 + bob); ctx.stroke(); glove(-16, 20 + bob);
  } else if (air) {
    ctx.beginPath(); ctx.moveTo(-10, 27 + bob); ctx.lineTo(-15, 34 + bob); ctx.moveTo(10, 27 + bob); ctx.lineTo(15, 34 + bob); ctx.stroke();
    glove(-16, 35 + bob); glove(16, 35 + bob);
  } else {
    ctx.beginPath(); ctx.moveTo(-10, 26 + bob); ctx.lineTo(-10 - cw * 7, 20 + bob); ctx.moveTo(10, 26 + bob); ctx.lineTo(10 + cw * 7, 20 + bob); ctx.stroke();
    glove(-11 - cw * 7, 19 + bob); glove(11 + cw * 7, 19 + bob);
  }
  if (ext > 0 && o.atkKind) {
    ctx.strokeStyle = dk; ctx.lineWidth = 5.6;
    ctx.beginPath(); ctx.moveTo(2, 15); ctx.lineTo(10 + 18 * ext, 11 + 3 * ext); ctx.stroke();
    shoe(c, 12 + 18 * ext, 8 + 3 * ext, -0.2);
  }
  if (ext > 0) { ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 0.45 * ext; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(4, o.atkKind ? 13 : 25 + bob, 21 + 9 * ext, -0.65, 0.65); ctx.stroke(); ctx.globalAlpha = 1; }

  paintHead(c, { x: 0, y: 45 + bob, r: 13.5, ph, stunned: o.stunned, hit: o.hit, eyeShut: o.eyeShut,
    atk: ext > 0, tilt: air ? 0.12 : sw * 0.04 });
}

function paintMedal(place,t){
  const pal = place===1?['#fff6cf','#ffc531','#8a5a06','#ff3d7f']
            : place===2?['#ffffff','#ccd3df','#6d7784','#3fb6f5']
                       :['#f7d2ad','#cf8a4c','#70401a','#2ee6a8'];
  const cx=1, cy=24, r=8.6;
  ctx.strokeStyle=pal[3]; ctx.lineWidth=3.4; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(-8,37); ctx.lineTo(cx-2,cy+6); ctx.moveTo(9,37); ctx.lineTo(cx+2,cy+6); ctx.stroke();
  const g=ctx.createRadialGradient(cx-3,cy+3,1,cx,cy,r);
  g.addColorStop(0,pal[0]); g.addColorStop(.55,pal[1]); g.addColorStop(1,pal[2]);
  ctx.fillStyle=g; ctx.strokeStyle=pal[2]; ctx.lineWidth=1.4;
  ctx.beginPath(); ctx.arc(cx,cy,r,0,6.284); ctx.fill(); ctx.stroke();
  ctx.strokeStyle=pal[2]; ctx.globalAlpha=.5; ctx.lineWidth=.9;
  ctx.beginPath(); ctx.arc(cx,cy,r*0.64,0,6.284); ctx.stroke(); ctx.globalAlpha=1;
  ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,r-0.8,0,6.284); ctx.clip();
  const sweep=(((t*0.75)%1.6)-0.3)*r*2.6;
  ctx.globalAlpha=.8; ctx.fillStyle='#ffffff';
  ctx.beginPath(); ctx.moveTo(cx+sweep-2.6,cy-r); ctx.lineTo(cx+sweep+2.2,cy-r);
  ctx.lineTo(cx+sweep+7,cy+r); ctx.lineTo(cx+sweep+2.2,cy+r); ctx.closePath(); ctx.fill();
  ctx.restore(); ctx.globalAlpha=1;
  ctx.save(); ctx.scale(1,-1);
  ctx.fillStyle=pal[2]; ctx.font='700 9px Nunito, sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(String(place),cx,-cy+0.5); ctx.restore();
  for(let i=0;i<5;i++){
    const k=Math.sin(t*3.6+i*1.7);
    if(k<=0.05) continue;
    const a=i*1.256+t*0.5, d=r+4.5+Math.sin(t*2+i)*1.6;
    const sx=cx+Math.cos(a)*d, sy=cy+Math.sin(a)*d, sz=1.8+k*2.6;
    ctx.globalAlpha=k; ctx.fillStyle=i%2?'#ffffff':pal[0];
    ctx.beginPath();
    ctx.moveTo(sx,sy+sz); ctx.quadraticCurveTo(sx,sy,sx+sz,sy);
    ctx.quadraticCurveTo(sx,sy,sx,sy-sz); ctx.quadraticCurveTo(sx,sy,sx-sz,sy);
    ctx.quadraticCurveTo(sx,sy,sx,sy+sz); ctx.fill();
  }
  ctx.globalAlpha=1;
}

/** Draws one character, idling, into a small canvas. Used by the entry screen. */
export function drawAvatar(cv, charIdx, t, medal) {
  const c2 = cv.getContext('2d'), W = cv.width, H = cv.height, sc = W / 78;
  const prev = ctx;
  ctx = c2;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.setTransform(sc, 0, 0, -sc, W / 2, H - 7);
  const c0 = C.CHARS[charIdx], im0 = spriteFor(c0);
  if (im0) drawSprite(c0, im0, { ph: t * 6.5 + charIdx * 1.9, air: false, slide: false });
  else paintChar(c0, { ph: t * 6.5 + charIdx * 1.9, air: false, slide: false, stunned: false, atk: 0 });
  if (medal) paintMedal(medal, t);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx = prev;
}
