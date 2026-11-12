import * as C from '../shared/constants.js';
import { Net } from '../client/net.js';
import { createBot, botInput } from '../server/bot.js';
import { nextGap } from '../shared/track.js';
const url=`ws://localhost:${process.argv[2]||8099}`;
const bot=createBot(0.9); let rows=0, falls=0, lastX=0;
const n=new Net({
  onOpen(){ n.send({t:'hello',name:'DBG',charIdx:0}); n.send({t:'queue',trackIdx:0}); },
  onMatch(){ const g=nextGap(n.track,760); console.log('first gap:', JSON.stringify(n.track.gaps.slice(0,3))); },
  onEnd(m){ console.log('END falls='+falls, m.results.map(r=>`${r.place}.${r.name} ${r.done?r.time.toFixed(1):'DNF'}`).join(' ')); process.exit(0); }
});
n.connect(url);
setInterval(()=>{ if(n.state!=='racing'||!n.me) return;
  const bits=n.time>=0?botInput(n.me,bot,n.world,C.DT,[...n.players.values()]):0;
  const p=n.me, g=nextGap(n.track,p.x);
  if(n.time>0 && p.x<lastX-100){ falls++; }
  lastX=p.x;
  if(n.time>0 && g && g.s-p.x<260 && g.s-p.x>-300 && rows<70){
    rows++;
    console.log(`x=${p.x.toFixed(0)} d=${(g.s-p.x).toFixed(0)} W=${(g.e-g.s).toFixed(0)} y=${p.y.toFixed(0)} vy=${p.vy.toFixed(0)} vx=${p.vx.toFixed(0)} g=${p.onGround?1:0} jm=${p.jumps} bits=${bits}`);
  }
  n.tick(bits,C.DT);
},1000/C.TICK_HZ);
setTimeout(()=>{console.log('TIMEOUT falls='+falls);process.exit(1);},40000);
