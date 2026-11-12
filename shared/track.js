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

export const STEP_W = 54, STEP_H = 34;     // a step you can run straight up
export const CLIMB = 38;                   // the tallest ledge you mount without jumping

export function buildTrack(def, seedOverride) {
  const rnd = mulberry32(seedOverride ?? def.seed);
  const plats = [], obst = [], items = [];
  const d = def.diff;
  const slab = (x, w) => plats.push({ x, y: 0, w });
  const coinArc = (x, n, h) => { for (let i = 0; i < n; i++) { const p = n > 1 ? i / (n - 1) : 0; items.push({ type:'coin', x: x + i * 34, y: 26 + (h || 80) * Math.sin(Math.PI * p) }); } };
  const coinLine = (x, n, y) => { for (let i = 0; i < n; i++) items.push({ type:'coin', x: x + i * 34, y }); };
  const box = (x, y) => items.push({ type:'box', x, y: y + 32 });

  // --- the piece library --------------------------------------------------
  // A track is a sequence of pieces drawn from its own palette. Each piece
  // returns how much ground it consumed. Nothing repeats twice in a row, and
  // no piece may appear a third time until four others have been used.
  const steps = [], movers = [], springs = [], ice = [], belts = [], blinkers = [];
  const stair = (x, n, dir) => {                 // a flight you climb by running at it
    for (let i = 0; i < n; i++) {
      const k = dir > 0 ? i : n - 1 - i;
      steps.push({ x: x + i * STEP_W, y: (k + 1) * STEP_H, w: STEP_W, h: (k + 1) * STEP_H });
    }
    return n * STEP_W;
  };

  const PIECES = {
    // --- shared ---------------------------------------------------------
    beam:  () => { slab(x, 420); obst.push({ type:'beam', x:x+180, w:84 }); coinLine(x+150,5,16); return 420; },
    wall:  () => { slab(x, 400); obst.push({ type:'wall', x:x+180, w:28, h:54+26*d }); coinArc(x+120,5,92); return 400; },
    walls: () => { slab(x, 540); obst.push({ type:'wall', x:x+160, w:26, h:50 });
                   obst.push({ type:'wall', x:x+330, w:26, h:50 }); coinArc(x+150,9,96); return 540; },
    pit:   () => { const g = 140 + rnd()*(60+46*d); slab(x, 300); coinArc(x+300, Math.max(3,Math.round(g/34)), 88);
                   return 300 + g; },
    saw:   () => { slab(x, 440); obst.push({ type:'saw', x:x+210, r:30, a:rnd()*6.28 }); coinArc(x+150,6,100); return 440; },
    spike: () => { slab(x, 440); obst.push({ type:'spike', x:x+180, w:84+38*d }); coinArc(x+140,7,94); return 440; },
    ledge: () => { slab(x, 540); plats.push({ x:x+140, y:96, w:250 }); coinLine(x+160,6,124); box(x+340,96); return 540; },
    island:() => { slab(x, 280); const g1 = 120 + rnd()*40, fx = x + 280 + g1;
                   plats.push({ x:fx, y:72, w:150 }); coinLine(fx+22,3,100); return (fx + 150 + 130 + rnd()*40) - x; },

    // --- climbing -------------------------------------------------------
    // Up a flight, along the top past a crate, and back down the other side.
    stairs: () => {
      const n = 3 + Math.floor(rnd()*2), top = 190;
      slab(x, n*STEP_W*2 + top + 120);
      const up = stair(x + 60, n, 1);
      const ty = n * STEP_H;
      plats.push({ x: x + 60 + up, y: ty, w: top });
      coinLine(x + 90 + up, Math.round(top/34) - 1, ty + 30);
      if (rnd() < 0.5) box(x + 60 + up + top*0.5, ty);
      stair(x + 60 + up + top, n, -1);
      return n*STEP_W*2 + top + 120;
    },
    // A short flight straight into a beam: climb, then duck.
    stairbeam: () => {
      const n = 3, up = n*STEP_W, ty = n*STEP_H;
      slab(x, up + 420);
      stair(x + 50, n, 1);
      plats.push({ x: x + 50 + up, y: ty, w: 300 });
      obst.push({ type:'beam', x: x + 50 + up + 150, w: 84, base: ty });
      coinLine(x + 60 + up, 6, ty + 16);
      stair(x + 50 + up + 300, n, -1);
      return up*2 + 420;
    },

    // --- moving platforms ------------------------------------------------
    // Slides sideways above the ground, carrying coins. Optional: you can run
    // underneath it, which is why bots never strand themselves on one.
    moverH: () => {
      slab(x, 640);
      movers.push({ x0: x + 150, y0: 96, w: 160, ax: 130, ay: 0, sp: 0.5 + rnd()*0.25, ph: rnd()*6.28 });
      coinLine(x + 180, 7, 150); box(x + 480, 0);
      return 640;
    },
    // A lift: ride it up to a high coin line.
    moverV: () => {
      slab(x, 620);
      movers.push({ x0: x + 230, y0: 70, w: 140, ax: 0, ay: 78, sp: 0.55 + rnd()*0.3, ph: rnd()*6.28 });
      coinLine(x + 250, 5, 215); plats.push({ x: x + 420, y: 180, w: 150 }); box(x + 480, 180);
      return 620;
    },

    // --- blinking platforms ----------------------------------------------
    // Here, then gone, on a fixed cycle. Over solid ground, so a mistimed run
    // costs you the coins and nothing else.
    blink: () => {
      slab(x, 700);
      for (let i = 0; i < 3; i++)
        blinkers.push({ x: x + 150 + i*170, y: 104, w: 120, sp: 0.42 + rnd()*0.18, ph: i*0.33 + rnd()*0.3 });
      coinLine(x + 175, 3, 136); coinLine(x + 345, 3, 136); coinLine(x + 515, 3, 136);
      return 700;
    },

    // --- launchers --------------------------------------------------------
    spring: () => {
      slab(x, 560);
      springs.push({ x: x + 200, w: 76 });
      coinArc(x + 190, 7, 190);
      plats.push({ x: x + 360, y: 150, w: 150 }); box(x + 420, 150);
      return 560;
    },

    // --- surfaces ---------------------------------------------------------
    ice:  () => { slab(x, 620); ice.push({ s: x + 90, e: x + 530 });
                  obst.push({ type:'spike', x: x + 420, w: 70 }); coinLine(x + 120, 8, 20); return 620; },
    belt: () => { const back = rnd() < 0.5;
                  slab(x, 600); belts.push({ s: x + 110, e: x + 500, v: back ? -140 : 150 });
                  coinLine(x + 140, 9, 20); if (back) box(x + 520, 0); return 600; }
  };

  // Each map gets its own vocabulary, so the obstacles belong where they are.
  const PALETTE = {
    candy:  ['wall','pit','ledge','spring','stairs','saw','island','moverH','walls','beam','spring','stairs'],
    sewer:  ['beam','pit','belt','saw','moverH','spike','blink','walls','ledge','belt','island','moverV'],
    temple: ['stairs','pit','blink','spike','moverV','beam','stairbeam','saw','ledge','walls','island','moverH'],
    snow:   ['ice','pit','stairs','saw','moverH','spike','island','ice','walls','blink','ledge','moverV']
  };
  const bag = PALETTE[def.theme] || PALETTE.candy;

  slab(-800, 1560);
  let x = 760, guard = 0;
  const recent = [];                              // nothing repeats while it is in here
  while (x < def.len - 760 && guard++ < 1400) {
    let name = bag[Math.floor(rnd() * bag.length)], tries = 0;
    while (recent.includes(name) && tries++ < 12) name = bag[Math.floor(rnd() * bag.length)];
    recent.push(name); if (recent.length > 4) recent.shift();
    x += PIECES[name]();
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

  // Scenery. Deterministic from the seed like everything else, so two clients
  // looking at the same race see the same tree in the same place.
  bg.deco = [];
  // Scenery is background, not gameplay. It stays well clear of anything the
  // player is meant to reach for, or it reads as another crate to grab.
  // Coins are everywhere, so only crates earn a clearance: they are the thing
  // a player must spot, and a lollipop standing next to one hides it.
  const crateXs = items.filter(i => i.type !== 'coin').map(i => i.x);
  const nearCrate = x => crateXs.some(cx => Math.abs(cx - x) < 150);
  for (let dx = -200; dx < def.len + 600; dx += 115 + br() * 170) {
    const run = runs.find(r => dx > r.s + 40 && dx < r.e - 40);
    const k = Math.floor(br() * 6), sc = 0.7 + br() * 0.6, f = br() < 0.5 ? -1 : 1, ph = br() * 6.28;
    if (!run) continue;                                   // nothing grows over a pit
    if (nearCrate(dx)) continue;                          // nor crowding a crate
    bg.deco.push({ x: dx, k, s: sc, f, p: ph });
  }
  bg.near = [];                                           // the blurry stuff in front
  for (let dx = -400; dx < def.len + 800; dx += 520 + br() * 620)
    bg.near.push({ x: dx, k: Math.floor(br() * 2), s: 1.4 + br() * 1.1 });

  steps.sort((a, b) => a.x - b.x);
  movers.sort((a, b) => a.x0 - b.x0);
  blinkers.sort((a, b) => a.x - b.x);
  springs.sort((a, b) => a.x - b.x);

  return { def, len: def.len, plats, floats: plats.filter(p => p.y > 0), obst, items, runs, gaps, bg,
           steps, movers, springs, ice, belts, blinkers };
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

/** The far side of whatever you just fell into — used to stop fall loops. */
export function skipGap(track, x, holes) {
  for (let d = 0; d <= 1400; d += 16) {
    const px = x + d;
    if (groundAt(track, px - 22, holes) && groundAt(track, px, holes) && groundAt(track, px + 22, holes)) return px;
  }
  return x + 220;
}

// --- the moving parts -----------------------------------------------------
// Both of these are pure functions of the race clock, so the server and every
// client agree on where a platform is without a byte crossing the wire.
export function moverAt(m, t) {
  const s = Math.sin(t * m.sp + m.ph);
  return { x: m.x0 + m.ax * s, y: m.y0 + m.ay * s, w: m.w };
}
export function blinkOn(b, t) {
  return ((t * b.sp + b.ph) % 1 + 1) % 1 < 0.62;
}
// Every surface a racer could land on at x, including the moving ones.
export function surfacesAt(track, x, t, out) {
  const a = out || [];
  a.length = 0;
  for (const s of track.steps) if (x > s.x && x < s.x + s.w) a.push(s.y);
  for (const m of track.movers) { const p = moverAt(m, t); if (x > p.x && x < p.x + p.w) a.push(p.y); }
  for (const b of track.blinkers) if (blinkOn(b, t) && x > b.x && x < b.x + b.w) a.push(b.y);
  return a;
}
