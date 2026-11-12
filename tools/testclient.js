// Headless client that runs the REAL client netcode (client/net.js) plus the
// bot brain as its "human". Used to prove prediction and reconciliation hold
// up under latency, jitter and loss without opening a browser.

import * as C from '../shared/constants.js';
import { Net } from '../client/net.js';
import { createBot, botInput } from '../server/bot.js';

export function runClient({ url, name, charIdx, trackIdx, net: cond, skill = 0.85, onDone }) {
  const stats = { name, corrSum: 0, corrN: 0, corrMax: 0, snaps: 0, drops: 0, finished: false, place: null, time: 0, starved: 0 };
  const bot = createBot(skill);
  const n = new Net({
    onOpen() {
      n.send({ t: 'hello', name, charIdx });
      if (cond) n.send({ t: 'net', ...cond });
      n.send({ t: 'queue', trackIdx });
    },
    onEnd(m) {
      const mine = m.results.find(r => r.id === n.id);
      stats.finished = !!(mine && mine.done); stats.place = mine && mine.place; stats.time = mine ? mine.time : 0;
      stats.results = m.results;
      clearInterval(timer); try { n.ws.close(); } catch {}
      onDone(stats);
    }
  });
  n.connect(url);
  if (globalThis.__soakTrack) globalThis.__soakTrack(n, name);

  let timer = setInterval(() => {
    if (n.state !== 'racing' || !n.me) return;
    const bits = n.time >= 0 ? botInput(n.me, bot, n.world, C.DT, [...n.players.values()]) : 0;
    n.tick(bits, C.DT);
    if (n.stats.corrClean > 0) { stats.corrSum += n.stats.corrClean; stats.corrN++; stats.corrMax = Math.max(stats.corrMax, n.stats.corrClean); }
    stats.snaps = n.stats.snapHz; stats.drops = n.stats.drops;
    stats.rtt = n.stats.rtt; stats.buf = n.stats.buf; stats.pend = n.pending.length;
  }, 1000 / C.TICK_HZ);
  return stats;
}
