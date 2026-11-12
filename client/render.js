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
function drawRunner(r, s) {
  const c = C.CHARS[r.charIdx];
  ctx.save();
  ctx.globalAlpha = .22; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(r.x, (r.onGround ? r.y : r.safeY) + 2, 15 * (r.onGround ? 1 : 0.7), 4.6, 0, 0, 6.284); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.save(); ctx.translate(r.x, r.y);
  if (r.inv > 0 && r.shield <= 0) ctx.globalAlpha = (Math.floor(s.now * 15) % 2) ? 0.42 : 1;
  paintChar(c, { ph: r.phase, air: !r.onGround, slide: r.sliding, stunned: r.stun > 0, hit: false,
    eyeShut: false, jet: r.jet > 0, atk: r.atk > 0 ? 1 - r.atk / C.ATK_DUR : 0, atkKind: r.atkKind });
  ctx.restore();
  if (r.shield > 0) { ctx.globalAlpha = .28 + 0.16 * Math.sin(s.now * 8); ctx.fillStyle = '#3fb6f5';
    ctx.beginPath(); ctx.arc(r.x, r.y + 27, 33, 0, 6.284); ctx.fill(); ctx.globalAlpha = .9;
    ctx.strokeStyle = '#8bdcff'; ctx.lineWidth = 2.4; ctx.stroke(); ctx.globalAlpha = 1; }
  if (r.frozen > 0) { ctx.globalAlpha = .55; ctx.fillStyle = '#8bdcff'; rr(r.x - 19, r.y - 3, 38, 64, 9); ctx.fill(); ctx.globalAlpha = 1; }
  if (r.stun > 0 && r.frozen <= 0) { ctx.fillStyle = '#ffc531';
    for (let i = 0; i < 3; i++) { const a = s.now * 7 + i * 2.1; ctx.beginPath(); ctx.arc(r.x + Math.cos(a) * 15, r.y + 62 + Math.sin(a) * 4.5, 3, 0, 6.284); ctx.fill(); } }
  ctx.restore();
}

function paintTail(c, x, y, wag) {
  if (c.tail === 'puff') { ctx.fillStyle = c.belly; ctx.strokeStyle = c.dark; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(x, y, 5.4, 0, 6.284); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x - 3.6, y + 2.6, 3.2, 0, 6.284); ctx.fill(); ctx.stroke(); }
  else if (c.tail === 'long') { ctx.save(); ctx.translate(x, y); ctx.rotate(wag);
    ctx.strokeStyle = c.col; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-11, 3, -14, 14); ctx.stroke();
    ctx.strokeStyle = c.belly; ctx.lineWidth = 4.4;
    ctx.beginPath(); ctx.moveTo(-12, 8); ctx.quadraticCurveTo(-13.5, 11, -14, 14); ctx.stroke(); ctx.restore(); }
}
function paintAcc(c, R, ph) {
  const col = c.acc2, a = c.acc;
  if (a === 'cap') {
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, R * 0.12, R * 0.95, 0, Math.PI); ctx.fill();
    ctx.fillRect(-R * 0.95, R * 0.05, R * 1.9, R * 0.16);
    rr(R * 0.5, R * 0.02, R * 1.05, R * 0.17, 2.5); ctx.fill();
  } else if (a === 'beanie' || a === 'helmet') {
    ctx.fillStyle = col; ctx.strokeStyle = '#363b45'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(0, R * 0.1, R * 0.98, 0, Math.PI); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#363b45'; rr(-R * 1.04, R * 0.02, R * 2.08, R * 0.2, 2); ctx.fill();
    ctx.strokeStyle = '#272b33'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-R * 0.1, R * 0.22); ctx.lineTo(-R * 0.1, R * 1.02); ctx.stroke();
    ctx.fillStyle = '#ffc531'; ctx.beginPath(); ctx.arc(R * 0.5, R * 0.6, 2.8, 0, 6.284); ctx.fill();
  } else if (a === 'bandana') {
    ctx.fillStyle = col; ctx.strokeStyle = '#541515'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-R * 0.99, R * 0.3); ctx.lineTo(R * 0.99, R * 0.3); ctx.lineTo(R * 0.84, R * 0.9); ctx.lineTo(-R * 0.84, R * 0.9); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.rotate(Math.sin(ph * 0.8) * 0.22);
    ctx.beginPath(); ctx.moveTo(-R * 0.88, R * 0.5); ctx.lineTo(-R * 1.78, R * 0.18); ctx.lineTo(-R * 1.52, R * 0.78); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  } else if (a === 'crown') {
    ctx.fillStyle = col; ctx.strokeStyle = '#6b4f10'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.beginPath();
    ctx.moveTo(-R * 0.72, R * 0.72); ctx.lineTo(-R * 0.72, R * 1.22); ctx.lineTo(-R * 0.36, R * 0.95); ctx.lineTo(0, R * 1.38);
    ctx.lineTo(R * 0.36, R * 0.95); ctx.lineTo(R * 0.66, R * 1.02); ctx.lineTo(R * 0.72, R * 0.72); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (a === 'goggles') {
    ctx.strokeStyle = '#4a3a6b'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-R * 0.98, R * 0.5); ctx.lineTo(R * 0.98, R * 0.5); ctx.stroke();
    for (let g = -1; g <= 1; g += 2) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(g * R * 0.42, R * 0.52, R * 0.33, 0, 6.284); ctx.fill();
      ctx.strokeStyle = '#4a3a6b'; ctx.lineWidth = 2.2; ctx.stroke(); }
  }
}
function paintHead(c, h) {
  ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(h.tilt || 0);
  const R = h.r, col = c.col, dk = c.dark, flop = Math.sin((h.ph || 0) * 0.5) * 0.16;
  if (c.ear === 'bunny') {
    for (let g = -1; g <= 1; g += 2) { ctx.save(); ctx.translate(g * 6.5, R * 0.68); ctx.rotate(g * (0.36 + flop));
      ctx.fillStyle = col; ctx.strokeStyle = dk; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.ellipse(0, 11, 4.8, 11.5, 0, 0, 6.284); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c.belly; ctx.beginPath(); ctx.ellipse(0, 11, 2.4, 7.4, 0, 0, 6.284); ctx.fill(); ctx.restore(); }
  } else if (c.ear === 'cat') {
    for (let g = -1; g <= 1; g += 2) { ctx.fillStyle = col; ctx.beginPath();
      ctx.moveTo(g * 3, R * 0.66); ctx.lineTo(g * 9.5, R * 1.42); ctx.lineTo(g * 12.5, R * 0.42); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = dk; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.fillStyle = c.belly; ctx.beginPath(); ctx.moveTo(g * 5.6, R * 0.72); ctx.lineTo(g * 9.2, R * 1.18); ctx.lineTo(g * 10.6, R * 0.56); ctx.closePath(); ctx.fill(); }
  } else if (c.ear === 'bear') {
    for (let g = -1; g <= 1; g += 2) { ctx.fillStyle = col; ctx.strokeStyle = dk; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(g * 9.5, R * 0.82, 5.6, 0, 6.284); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c.belly; ctx.beginPath(); ctx.arc(g * 9.5, R * 0.82, 2.9, 0, 6.284); ctx.fill(); }
  } else if (c.ear === 'fox') {
    for (let g = -1; g <= 1; g += 2) { ctx.fillStyle = col; ctx.beginPath();
      ctx.moveTo(g * 2, R * 0.6); ctx.lineTo(g * 11, R * 1.5); ctx.lineTo(g * 13, R * 0.3); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = dk; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.fillStyle = '#fdf6ec'; ctx.beginPath(); ctx.arc(g * 10.6, R * 1.33, 2.5, 0, 6.284); ctx.fill(); }
  } else if (c.ear === 'uni') {
    ctx.fillStyle = '#cfc6ad'; ctx.strokeStyle = '#6d6350'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-3.6, R * 0.8); ctx.lineTo(-0.6, R * 1.52); ctx.lineTo(2.4, R * 1.3); ctx.lineTo(3.6, R * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = dk; ctx.beginPath(); ctx.ellipse(-R * 0.74, R * 0.6, 4.4, 6.6, 0.5, 0, 6.284); ctx.fill();
  }
  ctx.fillStyle = col; ctx.strokeStyle = dk; ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.284); ctx.fill(); ctx.stroke();
  if (c.ear === 'penguin') {
    ctx.fillStyle = c.belly; ctx.beginPath(); ctx.ellipse(R * 0.12, -R * 0.1, R * 0.76, R * 0.8, 0, 0, 6.284); ctx.fill();
    ctx.fillStyle = '#ffa726'; ctx.beginPath(); ctx.moveTo(R * 0.3, -R * 0.08); ctx.lineTo(R * 1.02, -R * 0.26); ctx.lineTo(R * 0.3, -R * 0.44); ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = c.belly; ctx.beginPath(); ctx.ellipse(R * 0.3, -R * 0.34, R * 0.46, R * 0.34, 0, 0, 6.284); ctx.fill();
    ctx.fillStyle = dk; ctx.beginPath(); ctx.ellipse(R * 0.4, -R * 0.16, 2.3, 1.8, 0, 0, 6.284); ctx.fill();
    ctx.fillStyle = '#2a1420'; rr(R * 0.08, -R * 0.58, R * 0.7, R * 0.2, 2); ctx.fill();
    ctx.strokeStyle = c.belly; ctx.lineWidth = 1.1;
    for (let m = 1; m < 4; m++) { const mx = R * 0.08 + m * R * 0.175; ctx.beginPath(); ctx.moveTo(mx, -R * 0.58); ctx.lineTo(mx, -R * 0.38); ctx.stroke(); }
  }
  const ey = R * 0.14;
  for (let i = 0; i < 2; i++) {
    const sx = (i ? 1 : -1) * R * 0.36 + R * 0.1;
    if (h.stunned) { ctx.strokeStyle = dk; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx - 3, ey - 3); ctx.lineTo(sx + 3, ey + 3); ctx.moveTo(sx + 3, ey - 3); ctx.lineTo(sx - 3, ey + 3); ctx.stroke(); continue; }
    ctx.fillStyle = '#e6e0d2'; ctx.beginPath(); ctx.ellipse(sx, ey, 3.2, 3.3, 0, 0, 6.284); ctx.fill();
    ctx.fillStyle = '#140f1e'; ctx.beginPath(); ctx.arc(sx + 1, ey - 0.2, 2, 0, 6.284); ctx.fill();
  }
  if (!h.stunned) { ctx.strokeStyle = dk; ctx.lineWidth = 2.9; ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) { const g = i ? 1 : -1, bx = g * R * 0.36 + R * 0.1;
      ctx.beginPath(); ctx.moveTo(bx + g * 4.4, ey + 7.8); ctx.lineTo(bx - g * 3.6, ey + 3.6); ctx.stroke(); } }
  ctx.strokeStyle = dk; ctx.globalAlpha = .78; ctx.lineWidth = 1.5;
  if (c.scar === 'eye') { ctx.beginPath(); ctx.moveTo(-R * 0.58, ey + 9); ctx.lineTo(-R * 0.2, ey - 7); ctx.stroke(); }
  else if (c.scar === 'brow') { ctx.beginPath(); ctx.moveTo(R * 0.22, ey + 10.5); ctx.lineTo(R * 0.8, ey + 12.5); ctx.stroke(); }
  else { for (let i = 0; i < 3; i++) { const x1 = -R * 0.78 + i * 4; ctx.beginPath(); ctx.moveTo(x1, -R * 0.02); ctx.lineTo(x1 + 3.6, -R * 0.42); ctx.stroke(); } }
  ctx.globalAlpha = 1;
  if (c.acc === 'collar') {
    ctx.fillStyle = '#2b2230'; ctx.strokeStyle = '#14101b'; ctx.lineWidth = 1.6;
    rr(-R * 1.02, -R * 1.4, R * 2.04, R * 0.42, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c.acc2;
    for (let i = 0; i < 5; i++) { const x1 = -R * 0.8 + i * R * 0.4;
      ctx.beginPath(); ctx.moveTo(x1 - 2.6, -R * 1.4); ctx.lineTo(x1, -R * 1.76); ctx.lineTo(x1 + 2.6, -R * 1.4); ctx.closePath(); ctx.fill(); }
  } else paintAcc(c, R, h.ph || 0);
  ctx.restore();
}
function paintChar(c, o) {
  const ph = o.ph || 0, col = c.col, dk = c.dark;
  if (o.jet) { ctx.fillStyle = '#ffc531'; ctx.beginPath();
    ctx.moveTo(-6, 2); ctx.lineTo(0, -10 - Math.random() * 9); ctx.lineTo(6, 2); ctx.closePath(); ctx.fill(); }
  if (o.slide) {
    paintTail(c, -17, 11, 0.6);
    ctx.strokeStyle = dk; ctx.lineWidth = 6.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-6, 9); ctx.lineTo(-19, 4); ctx.moveTo(-5, 7); ctx.lineTo(-17, 12); ctx.stroke();
    ctx.fillStyle = col; ctx.strokeStyle = dk; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.ellipse(-2, 11, 16, 9.5, 0, 0, 6.284); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c.belly; ctx.beginPath(); ctx.ellipse(-3, 7.5, 10, 5.6, 0, 0, 6.284); ctx.fill();
    paintHead(c, { x: 12, y: 15, r: 11, ph, stunned: o.stunned, tilt: -0.3 });
    return;
  }
  const air = o.air, bob = air ? 0 : Math.abs(Math.sin(ph)) * 1.8;
  const sw = Math.sin(ph), cw = Math.cos(ph);
  paintTail(c, -13, 21 + bob, air ? 0.5 : Math.sin(ph * 0.5) * 0.32);
  ctx.strokeStyle = dk; ctx.lineWidth = 7; ctx.lineCap = 'round';
  if (air) { ctx.beginPath(); ctx.moveTo(-4, 14); ctx.lineTo(-11, 6); ctx.moveTo(4, 14); ctx.lineTo(11, 8); ctx.stroke();
    ctx.fillStyle = dk; ctx.beginPath(); ctx.arc(-11.5, 5, 3.6, 0, 6.284); ctx.fill(); ctx.beginPath(); ctx.arc(11.5, 7, 3.6, 0, 6.284); ctx.fill(); }
  else { ctx.beginPath(); ctx.moveTo(-3, 14); ctx.lineTo(sw * 10, 3); ctx.moveTo(3, 14); ctx.lineTo(-sw * 10, 3); ctx.stroke();
    ctx.fillStyle = dk; ctx.beginPath(); ctx.arc(sw * 10, 2.6, 3.6, 0, 6.284); ctx.fill(); ctx.beginPath(); ctx.arc(-sw * 10, 2.6, 3.6, 0, 6.284); ctx.fill(); }
  ctx.fillStyle = col; ctx.strokeStyle = dk; ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.ellipse(0, 23 + bob, 14, 13, 0, 0, 6.284); ctx.fill(); ctx.stroke();
  ctx.fillStyle = c.belly; ctx.beginPath(); ctx.ellipse(0.5, 20 + bob, 8.6, 8.6, 0, 0, 6.284); ctx.fill();
  ctx.strokeStyle = dk; ctx.globalAlpha = .45; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-9.5, 28 + bob); ctx.lineTo(-5.5, 25 + bob); ctx.stroke(); ctx.globalAlpha = 1;
  ctx.strokeStyle = col; ctx.lineWidth = 6.4;
  if (air) { ctx.beginPath(); ctx.moveTo(-11, 26 + bob); ctx.lineTo(-16, 34 + bob); ctx.moveTo(11, 26 + bob); ctx.lineTo(16, 34 + bob); ctx.stroke(); }
  else { ctx.beginPath(); ctx.moveTo(-11, 26 + bob); ctx.lineTo(-11 - cw * 7, 20 + bob); ctx.moveTo(11, 26 + bob); ctx.lineTo(11 + cw * 7, 20 + bob); ctx.stroke(); }
  const ext = o.atk > 0 ? Math.sin(Math.min(1, o.atk) * Math.PI) : 0;
  if (ext > 0) {
    if (o.atkKind) { ctx.strokeStyle = dk; ctx.lineWidth = 7.4;
      ctx.beginPath(); ctx.moveTo(2, 15); ctx.lineTo(10 + 20 * ext, 10 + 3 * ext); ctx.stroke();
      ctx.fillStyle = dk; ctx.beginPath(); ctx.arc(11 + 20 * ext, 10 + 3 * ext, 4.8, 0, 6.284); ctx.fill(); }
    else { ctx.strokeStyle = col; ctx.lineWidth = 6.6;
      ctx.beginPath(); ctx.moveTo(9, 26 + bob); ctx.lineTo(13 + 18 * ext, 25 + bob); ctx.stroke();
      ctx.fillStyle = col; ctx.strokeStyle = dk; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(14 + 18 * ext, 25 + bob, 5.8, 0, 6.284); ctx.fill(); ctx.stroke(); }
    ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 0.45 * ext; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.arc(4, o.atkKind ? 12 : 25 + bob, 20 + 9 * ext, -0.65, 0.65); ctx.stroke(); ctx.globalAlpha = 1;
  }
  paintHead(c, { x: 0, y: 44 + bob, r: 13, ph, stunned: o.stunned, tilt: air ? 0.14 : sw * 0.045 });
}
