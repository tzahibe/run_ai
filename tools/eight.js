// Eight racers in one room, on mixed links: does everyone still finish, and
// what does the snapshot stream cost per client?
import { runClient } from './testclient.js';
const port = process.argv[2] || 8099;
const url = `ws://localhost:${port}`;
const PROF = [
  { name: 'LAN-1',  net: { rtt: 0,   jitter: 0,  loss: 0 } },
  { name: 'LAN-2',  net: { rtt: 10,  jitter: 4,  loss: 0 } },
  { name: '4G-1',   net: { rtt: 60,  jitter: 15, loss: 0.5 } },
  { name: '4G-2',   net: { rtt: 75,  jitter: 20, loss: 1 } },
  { name: 'Mob-1',  net: { rtt: 140, jitter: 40, loss: 2 } },
  { name: 'Mob-2',  net: { rtt: 160, jitter: 50, loss: 3 } },
  { name: 'Bad-1',  net: { rtt: 240, jitter: 80, loss: 6 } },
  { name: 'Bad-2',  net: { rtt: 290, jitter: 95, loss: 8 } }
];
let left = PROF.length; const out = [];
PROF.forEach((p, i) => runClient({ url, name: p.name, charIdx: i % 8, trackIdx: 0, net: p.net, skill: 0.8,
  onDone: s => { out.push(s);
    if (--left === 0) {
      console.log('\n  racer    place  time      avg corr   rtt     drops');
      console.log('  ' + '-'.repeat(56));
      for (const p2 of PROF) { const s2 = out.find(o => o.name === p2.name); if (!s2) continue;
        const avg = s2.corrN ? s2.corrSum / s2.corrN : 0;
        console.log(`  ${s2.name.padEnd(8)} ${String(s2.place).padEnd(6)} ${s2.time.toFixed(2).padStart(6)}s ${avg.toFixed(1).padStart(9)}px ${String(s2.rtt).padStart(5)}ms ${String(s2.drops).padStart(6)}`); }
      console.log('');
      process.exit(0);
    } } }));
setTimeout(() => { console.log('timeout'); process.exit(1); }, 150000);
