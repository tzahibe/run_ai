import * as C from '../shared/constants.js';
import { Net } from '../client/net.js';
import { createBot, botInput } from '../server/bot.js';
const url = `ws://localhost:${process.argv[2]||8099}`;
const PROF=[{n:'LAN',net:{rtt:0,jitter:0,loss:0}},{n:'Awful',net:{rtt:280,jitter:90,loss:8}}];
const cs=[];
PROF.forEach((p,i)=>{
  const bot=createBot(0.85);
  const n=new Net({
    onOpen(){ n.send({t:'hello',name:p.n,charIdx:i}); n.send({t:'net',...p.net}); n.send({t:'queue',trackIdx:0}); },
    onEnd(m){ console.log('END',m.results.map(r=>`${r.place}.${r.name} ${r.done?r.time.toFixed(1):'DNF@'+r.x}`).join(' ')); process.exit(0); }
  });
  n.connect(url); cs.push({p,n,bot});
  setInterval(()=>{ if(n.state!=='racing'||!n.me) return;
    const bits=n.time>=0?botInput(n.me,bot,n.world,C.DT,[...n.players.values()]):0; n.tick(bits,C.DT); },1000/C.TICK_HZ);
});
setInterval(()=>{
  const line=cs.map(({p,n})=>{ if(!n.me) return p.n+':-';
    const snap=n.snaps[n.snaps.length-1], a=snap&&snap.snap.ps.find(x=>x.i===n.id);
    return `${p.n} x=${(a?a.x:0).toFixed(0)} v=${n.me.vx.toFixed(0)} st=${n.me.stun.toFixed(1)} corr=${n.stats.corr} buf=${n.stats.buf} pend=${n.pending.length} rtt=${n.stats.rtt}`;
  }).join(' | ');
  console.log(`t=${(cs[0].n.time||0).toFixed(1)} ${line}`);
},2000);
setTimeout(()=>{console.log('TIMEOUT');process.exit(1);},60000);
