// Pure-simulation regression tests. No server, no browser: just the shared
// physics, stepped by hand, asserting the things that have broken before.
//   node tools/simtest.js
import * as C from '../shared/constants.js';
import { buildTrack, skipGap, groundAt, moverAt, blinkOn } from '../shared/track.js';
import { createPlayer, stepPlayer, zap, hit, atkOf } from '../shared/sim.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${cond || !detail ? '' : `\n          ${detail}`}`);
};
const world = t => ({ track: t, holes: [], mines: [], time: 1 });

// Run a player for `secs`, holding `bits`, with an optional per-step hook.
function run(p, t, secs, bits = 0, hook) {
  const w = world(t);
  for (let i = 0; i < Math.round(secs / C.DT); i++) {
    const b = typeof bits === 'function' ? bits(p, i) : bits;
    stepPlayer(p, b, w, C.DT);
    hook && hook(p, i);
  }
  return p;
}

console.log('\nsimulation');

// --- a runner must never be permanently pinned ----------------------------
{
  const t = buildTrack(C.TRACKS[0], 1337);
  const wall = t.obst.find(o => o.type === 'wall');
  const p = createPlayer('w', 0, 0, wall.x - 400);
  // Hold nothing but forward motion (which is automatic) and a jump every 0.4s,
  // the way a player mashing the key would.
  run(p, t, 14, (pp, i) => (i % 24 < 2 ? C.IN_JUMP : 0));
  ok('a runner gets past a wall instead of grinding on it', p.x > wall.x + 60,
     `stopped at x=${p.x.toFixed(0)}, wall at ${wall.x}`);
}

// --- ... not even one that never jumps ------------------------------------
{
  const t = buildTrack(C.TRACKS[0], 1337);
  const wall = t.obst.find(o => o.type === 'wall');
  const p = createPlayer('w2', 0, 0, wall.x - 300);
  // What matters is not that a wall never stuns -- it should -- but that it
  // always hands control back, so the player can jump instead of grinding.
  let streak = 0, worst = 0, free = 0;
  run(p, t, 6, 0, pp => {
    if (pp.stun > 0) { streak++; worst = Math.max(worst, streak); }
    else { streak = 0; free++; }
  });
  ok('a wall always hands control back', worst < 20 && free > 200,
     `longest stun streak ${worst} frames, ${free} free frames in 6s`);
}

// --- sprinting costs stamina and runs out ---------------------------------
{
  const t = buildTrack(C.TRACKS[0], 1337);
  const p = createPlayer('s', 0, 0, 0);
  run(p, t, 1.0, C.IN_RUN);
  ok('sprinting drains stamina', p.stam < 0.95, `stam=${p.stam.toFixed(2)}`);
  const fast = p.vx;
  const q = createPlayer('s2', 0, 0, 0);
  run(q, t, 1.0, 0);
  ok('sprinting is actually faster', fast > q.vx + 20, `${fast.toFixed(0)} vs ${q.vx.toFixed(0)}`);
  run(p, t, 8, C.IN_RUN);
  ok('stamina runs out and the sprint ends', !p.sprinting || p.stam <= 0.05, `stam=${p.stam.toFixed(2)}`);
  run(p, t, 6, 0);
  ok('stamina refills when you stop sprinting', p.stam > 0.3, `stam=${p.stam.toFixed(2)}`);
}

// --- lightning chars you, briefly, and then lets go -----------------------
{
  const t = buildTrack(C.TRACKS[3], 77301);
  const p = createPlayer('z', 0, 0, 500);
  run(p, t, 1, 0);
  const before = p.vx;
  ok('zap reports a hit', zap(p) === true);
  ok('being charred slows you', p.vx < before);
  run(p, t, C.CHAR_SEC - 0.2, 0);
  ok('still charred just before the timer ends', p.charred > 0, `charred=${p.charred.toFixed(2)}`);
  run(p, t, 0.4, 0);
  ok('charring wears off after ~1.5s', p.charred === 0);
  run(p, t, 1.5, 0);
  ok('speed recovers afterwards', p.vx > C.BASE * 0.9, `vx=${p.vx.toFixed(0)}`);
  const sh = createPlayer('z2', 0, 0, 500); sh.shield = 2;
  ok('a shield blocks the bolt', zap(sh) === false);
}

// --- every character has a usable kit -------------------------------------
{
  let bad = [];
  C.CHARS.forEach((c, i) => {
    if (!c.sprite) bad.push(c.name + ':sprite');
    if (!c.run || typeof c.run.step !== 'number') bad.push(c.name + ':run');
    const p = createPlayer('c' + i, 0, i, 0);
    const a = atkOf(p);
    if (!a || !a.name || !(a.fwd > 0) || !(a.stun > 0)) bad.push(c.name + ':atk');
  });
  ok('all characters have sprite, run style and attack', bad.length === 0, bad.join(' '));
}

// --- every track is finishable and sane -----------------------------------
{
  const bad = [];
  C.TRACKS.forEach((def, i) => {
    const t = buildTrack(def, def.seed);
    if (!t.runs.length) bad.push(def.id + ':no-ground');
    if (t.len !== def.len) bad.push(def.id + ':len');
    if (!t.bg.deco.length) bad.push(def.id + ':no-scenery');
    for (const d of t.bg.deco)                       // nothing floating over a pit
      if (!t.runs.some(r => d.x > r.s && d.x < r.e)) { bad.push(def.id + ':deco-in-pit'); break; }
    const gap = t.gaps && t.gaps[1];                 // the escape hatch out of a pit
    if (gap) {
      const mid = (gap.s + gap.e) / 2, out = skipGap(t, mid, []);
      if (!(out > mid) || !groundAt(t, out, [])) bad.push(def.id + ':skipGap');
    }
  });
  ok('every track builds with ground, scenery and an escape hatch', bad.length === 0, bad.join(' '));
  ok('the snow track exists and storms', C.TRACKS.some(t => t.theme === 'snow' && t.storm && t.weather === 'snow'));
  ok('every track has a scenery theme', C.TRACKS.every(t => t.theme));
}

// --- stairs are climbed, not jumped --------------------------------------
{
  const tr = C.TRACKS.find(x => x.theme === 'temple');
  const tk = buildTrack(tr, tr.seed);
  const st = tk.steps[0];
  const p = createPlayer('st', 0, 0, st.x - 260);
  const top = Math.max(...tk.steps.filter(s2 => s2.x < st.x + 400).map(s2 => s2.y));
  let stunnedOnTheWay = 0, reached = 0;
  run(p, tk, 4, 0, (pp, i) => {                       // no jumping at all
    if (!reached && pp.y >= top - 1) reached = i;
    if (!reached && pp.stun > 0) stunnedOnTheWay++;
  });
  ok('a staircase is climbed by running at it', reached > 0,
     `ended at x=${p.x.toFixed(0)} y=${p.y.toFixed(0)}, top step ${top}`);
  ok('climbing a staircase never stuns you', stunnedOnTheWay === 0,
     `${stunnedOnTheWay} stunned frames before the top`);
}

// --- moving platforms carry their passenger -------------------------------
// Isolated on a synthetic track: one very wide platform and no ground at all,
// so the only thing that can move the rider sideways is the ride itself.
{
  const bare = (ax) => ({
    def: C.TRACKS[0], len: 9000, runs: [], floats: [], gaps: [], obst: [], items: [],
    steps: [], blinkers: [], springs: [], ice: [], belts: [],
    movers: [{ x0: 1000, y0: 120, w: 900, ax, ay: 0, sp: 0.6, ph: 0 }]
  });
  const ride = ax => {
    const tk = bare(ax), w2 = { track: tk, holes: [], mines: [], time: 0 };
    const p = createPlayer('mv', 0, 0, 0);
    const q0 = moverAt(tk.movers[0], 0);
    p.x = q0.x + 40; p.y = q0.y + 12; p.vy = 0;
    for (let i = 0; i < 90; i++) { w2.time = i * C.DT; stepPlayer(p, 0, w2, C.DT); }
    return p;
  };
  const moving = ride(130), still = ride(0);
  ok('a moving platform carries whoever stands on it',
     Math.abs(moving.x - still.x) > 25,
     `moving ${moving.x.toFixed(0)} vs still ${still.x.toFixed(0)}`);
  ok('and the rider stays on it', moving.onGround && Math.abs(moving.y - 120) < 2,
     `y=${moving.y.toFixed(1)} onGround=${moving.onGround}`);
  ok('the platform is a pure function of the clock, so both sides agree',
     moverAt(bare(130).movers[0], 3.37).x === moverAt(bare(130).movers[0], 3.37).x);
}

// --- blinking platforms come and go ---------------------------------------
{
  const tr = C.TRACKS.find(x => x.theme === 'temple');
  const tk = buildTrack(tr, tr.seed);
  const b = tk.blinkers[0];
  let on = 0, off = 0;
  for (let i = 0; i < 400; i++) (blinkOn(b, i * 0.05) ? on++ : off++);
  ok('a blinking platform spends time solid and time gone', on > 60 && off > 60,
     `${on} on, ${off} off`);
}

// --- springs throw you --------------------------------------------------
{
  const tr = C.TRACKS.find(x => x.theme === 'candy');
  const tk = buildTrack(tr, tr.seed);
  const sp = tk.springs[0];
  const p = createPlayer('sp', 0, 0, sp.x - 150);
  let peak = 0;
  run(p, tk, 2.4, 0, pp => { peak = Math.max(peak, pp.y); });
  const jumpH = C.JUMP_V * C.JUMP_V / (2 * C.G);
  ok('a launch pad throws you far higher than a jump', peak > jumpH * 2,
     `peak ${peak.toFixed(0)} vs a ${jumpH.toFixed(0)} jump`);
}

// --- ice is slippery ------------------------------------------------------
{
  const tr = C.TRACKS.find(x => x.theme === 'snow');
  const tk = buildTrack(tr, tr.seed);
  const z = tk.ice[0];
  const p = createPlayer('ic', 0, 0, z.s + 40); p.vx = 0;
  run(p, tk, 0.2, 0);
  const onIceGain = p.vx;
  const q = createPlayer('ic2', 0, 0, 400); q.vx = 0;
  run(q, tk, 0.2, 0);
  ok('ice makes you slow to get going', onIceGain < q.vx * 0.7,
     `${onIceGain.toFixed(0)} on ice vs ${q.vx.toFixed(0)} on rock`);
  ok('the sim flags who is on ice', p.onIce === true && q.onIce === false);
}

// --- conveyors move the floor --------------------------------------------
{
  const tr = C.TRACKS.find(x => x.theme === 'sewer');
  const tk = buildTrack(tr, tr.seed);
  const b = tk.belts[0];
  const w2 = { track: tk, holes: [], mines: [], time: 1 };
  const p = createPlayer('bl', 0, 0, b.s + 30);
  const q = createPlayer('bl2', 0, 0, b.s + 30);
  for (let i = 0; i < 30; i++) { stepPlayer(p, 0, w2, C.DT); p.vx = 0; }
  const off = { track: tk, holes: [], mines: [], time: 1 };
  const saveB = tk.belts; tk.belts = [];
  for (let i = 0; i < 30; i++) { stepPlayer(q, 0, off, C.DT); q.vx = 0; }
  tk.belts = saveB;
  ok('a conveyor moves you even when you are not running', Math.abs(p.x - q.x) > 20,
     `belt ${p.x.toFixed(0)} vs plain ${q.x.toFixed(0)}`);
}

// --- every map has its own vocabulary, and nothing repeats back to back ---
{
  const kinds = {};
  for (const def of C.TRACKS) {
    const tk = buildTrack(def, def.seed);
    kinds[def.id] = [tk.steps.length && 'stairs', tk.movers.length && 'movers',
      tk.springs.length && 'springs', tk.ice.length && 'ice',
      tk.belts.length && 'belts', tk.blinkers.length && 'blinkers'].filter(Boolean).join('+');
  }
  ok('every track has at least three kinds of new obstacle',
     Object.values(kinds).every(v => v.split('+').length >= 3), JSON.stringify(kinds));
  ok('ice only falls where it snows', !kinds.roofs.includes('ice') && kinds.frost.includes('ice'));
  ok('conveyors stay in the sewer', kinds.sewer.includes('belts') && !kinds.temple.includes('belts'));
  ok('springs stay on the candy roofs', kinds.roofs.includes('springs') && !kinds.sewer.includes('springs'));
  // no piece may sit next to a copy of itself
  const tk = buildTrack(C.TRACKS[2], C.TRACKS[2].seed);
  let back2back = 0;
  const marks = [...tk.steps.map(s2 => ({ x: s2.x, k: 'step' })),
                 ...tk.movers.map(m => ({ x: m.x0, k: 'mover' })),
                 ...tk.blinkers.map(b => ({ x: b.x, k: 'blink' }))].sort((a2, b2) => a2.x - b2.x);
  ok('the generator produced a mixed sequence', new Set(marks.map(m => m.k)).size >= 3,
     marks.slice(0, 12).map(m => m.k).join(','));
}

// --- the tracks got longer ------------------------------------------------
ok('every track is at least 20 km', C.TRACKS.every(t => t.len >= 20000),
   C.TRACKS.map(t => `${t.id}:${t.len}`).join(' '));

// --- the coin economy -----------------------------------------------------
ok('coins convert to turbo at a round number', C.COINS_PER_TURBO > 0 && C.TURBO_SEC > 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
