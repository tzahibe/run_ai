// Server-side race tests: drive a real Room with real bots, no sockets, and
// assert the race is winnable and the hazards behave.
//   node tools/roomtest.js
import * as C from '../shared/constants.js';
import { Room } from '../server/room.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++;
  console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${n}${c || !d ? '' : `\n          ${d}`}`); };

// Runs a full race of bots and reports what happened.
function race(trackIdx, maxSec = 400) {
  const room = new Room('t' + trackIdx, trackIdx, C.TRACKS[trackIdx].seed, () => {});
  for (let i = 0; i < 4; i++) room.addBot(i, 0.85);
  room.start();
  const seen = { bolt: 0, boltwarn: 0, unstick: 0, finish: 0, charred: 0 };
  const steps = Math.round(maxSec / C.DT);
  for (let i = 0; i < steps; i++) {
    room.step();                                   // bots drive themselves inside
    for (const ev of room.events) if (seen[ev.k] !== undefined) seen[ev.k]++;
    for (const e of room.players) if (e.p.charred > 0) seen.charred++;
    room.events.length = 0;
    if (room.finishOrder.length === room.players.length) break;
  }
  return { room, seen, finished: room.finishOrder.length, time: room.time };
}

console.log('\nserver races');
for (let i = 0; i < C.TRACKS.length; i++) {
  const t = C.TRACKS[i];
  const r = race(i);
  ok(`${t.name}: every bot reaches the line`, r.finished === r.room.players.length,
     `${r.finished}/${r.room.players.length} after ${r.time.toFixed(0)}s`);
  ok(`${t.name}: nobody needed more than a handful of unsticks`, r.seen.unstick <= 8,
     `${r.seen.unstick} unstick nudges`);
  if (t.storm) {
    ok(`${t.name}: lightning strikes during the race`, r.seen.bolt > 3, `${r.seen.bolt} bolts`);
    ok(`${t.name}: every bolt is announced first`, r.seen.boltwarn >= r.seen.bolt,
       `${r.seen.boltwarn} warnings for ${r.seen.bolt} bolts`);
    ok(`${t.name}: bolts actually char somebody`, r.seen.charred > 0,
       `${r.seen.charred} charred frames`);
  } else {
    ok(`${t.name}: no lightning on a calm track`, r.seen.bolt === 0);
  }
}
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
