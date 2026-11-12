// Deterministic track generation. The server sends only a seed + track index;
// every client rebuilds the identical geometry locally. Nothing about the
// static world ever travels over the wire.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildTrack(def, seedOverride) {
  const rnd = mulberry32(seedOverride ?? def.seed);
  const plats = [], obst = [], items = [];
  const d = def.diff;
  const slab = (x, w) => plats.push({ x, y: 0, w });
  const coinArc = (x, n, h) => { for (let i = 0; i < n; i++) { const p = n > 1 ? i / (n - 1) : 0; items.push({ type:'coin', x: x + i * 34, y: 26 + (h || 80) * Math.sin(Math.PI * p) }); } };
  const coinLine = (x, n, y) => { for (let i = 0; i < n; i++) items.push({ type:'coin', x: x + i * 34, y }); };
  const box = (x, y) => items.push({ type:'box', x, y: y + 32 });

  slab(-800, 1560);
  let x = 760, guard = 0;
  while (x < def.len - 760 && guard++ < 600) {
    const r = rnd();
    if (r < 0.15)      { slab(x,420); obst.push({type:'beam',x:x+180,w:84}); coinLine(x+150,5,16); x += 420; }
    else if (r < 0.31) { slab(x,400); obst.push({type:'wall',x:x+180,w:28,h:54+26*d}); coinArc(x+120,5,92); x += 400; }
    else if (r < 0.43) { slab(x,540); obst.push({type:'wall',x:x+160,w:26,h:50}); obst.push({type:'wall',x:x+330,w:26,h:50}); coinArc(x+150,9,96); x += 540; }
    else if (r < 0.57) { const g = 140 + rnd()*(60+46*d); slab(x,300); coinArc(x+300,Math.max(3,Math.round(g/34)),88); x += 300 + g; }
    else if (r < 0.69) { slab(x,440); obst.push({type:'saw',x:x+210,r:30,a:rnd()*6.28}); coinArc(x+150,6,100); x += 440; }
    else if (r < 0.79) { slab(x,440); obst.push({type:'spike',x:x+180,w:84+38*d}); coinArc(x+140,7,94); x += 440; }
    else if (r < 0.90) { slab(x,540); plats.push({x:x+140,y:96,w:250}); coinLine(x+160,6,124); box(x+340,96); x += 540; }
    else               { slab(x,280); const g1 = 120 + rnd()*40, fx = x + 280 + g1;
                         plats.push({x:fx,y:72,w:150}); coinLine(fx+22,3,100); x = fx + 150 + 130 + rnd()*40; }
    const pad = 100 + rnd() * 90; slab(x, pad);
    if (rnd() < 0.42) box(x + pad * 0.5, 0);
    x += pad;
  }
  slab(x, def.len - x + 1100);

  obst.sort((a, b) => a.x - b.x);
  items.sort((a, b) => a.x - b.x);
  plats.sort((a, b) => a.x - b.x);
  items.forEach((it, i) => { it.idx = i; });
  obst.forEach((o, i) => { o.idx = i; });

  const runs = [];
  for (const p of plats) {
    if (p.y !== 0) continue;
    const last = runs[runs.length - 1];
    if (last && p.x <= last.e + 0.5) last.e = Math.max(last.e, p.x + p.w);
    else runs.push({ s: p.x, e: p.x + p.w });
  }
  const gaps = [];
  for (let i = 1; i < runs.length; i++) gaps.push({ s: runs[i - 1].e, e: runs[i].s });

  const bg = { far: [], mid: [] }, br = mulberry32((seedOverride ?? def.seed) ^ 0x9e37);
  for (let bx = -600; bx < def.len + 1400; bx += 300 + br() * 200) bg.far.push({ x: bx, w: 150 + br() * 230, h: 120 + br() * 170 });
  for (let bx = -600; bx < def.len + 1400; bx += 190 + br() * 160) bg.mid.push({ x: bx, w: 70 + br() * 120, h: 70 + br() * 150 });

  return { def, len: def.len, plats, floats: plats.filter(p => p.y > 0), obst, items, runs, gaps, bg };
}

export function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].x < x) lo = m + 1; else hi = m; }
  return lo;
}

// Ground lookup, honouring pits dug during the race.
export function groundAt(track, x, holes) {
  if (holes) for (let i = 0; i < holes.length; i++) { const h = holes[i]; if (x > h.x + 4 && x < h.x + h.w - 4) return false; }
  let lo = 0, hi = track.runs.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1, r = track.runs[m];
    if (x < r.s) hi = m - 1; else if (x > r.e) lo = m + 1; else return true; }
  return false;
}

export function respawnX(track, x, holes) {
  const ok = px => groundAt(track, px - 24, holes) && groundAt(track, px, holes) && groundAt(track, px + 24, holes);
  for (let d = 190; d <= 2400; d += 24) if (ok(x - d)) return x - d;
  for (let d = 0; d <= 2400; d += 24) if (ok(x + d)) return x + d;
  return x - 190;
}

export function nextGap(track, x) {
  for (let i = 0; i < track.gaps.length; i++) if (track.gaps[i].e > x) return track.gaps[i];
  return null;
}

// --- what can I actually land on? ----------------------------------------
// Ground runs are not the whole story: floating platforms are landing spots
// too, and dug holes remove ground that the static map still shows. These two
// helpers answer both questions, and are what the bots steer by.

export function landingAt(track, x, holes, fromY) {
  for (const f of track.floats) if (x > f.x + 4 && x < f.x + f.w - 4 && f.y <= fromY + 4) return f.y;
  if (groundAt(track, x, holes)) return 0;
  return null;
}

/**
 * Where the surface under `p` ends, and how far it is from there to the next
 * thing it could land on. Works for pits, dug holes and platform hops alike.
 */
export function edgeAhead(track, p, holes, step = 10, scan = 460) {
  const onFloat = p.y > 1.5;
  const supports = x => {
    if (!onFloat) return groundAt(track, x, holes);
    for (const f of track.floats) if (x > f.x && x < f.x + f.w && Math.abs(f.y - p.y) < 2) return true;
    return false;
  };
  if (!supports(p.x)) return null;
  let edge = null;
  for (let x = p.x + step; x < p.x + scan; x += step) if (!supports(x)) { edge = x; break; }
  if (edge == null) return null;
  let land = null;
  for (let q = edge + step; q < edge + 700; q += step) if (landingAt(track, q, holes, p.y + 130) != null) { land = q; break; }
  return { edge, gap: (land ?? edge + 700) - edge };
}
