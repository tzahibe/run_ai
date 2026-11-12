// A 40-line Chrome DevTools client, so the view tests can drive the real page
// in a real browser without pulling in puppeteer.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const CHROME = process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function launch() {
  const dir = mkdtempSync(join(tmpdir(), 'tfchrome-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0',
    '--user-data-dir=' + dir, '--no-first-run', '--disable-gpu',
    '--window-size=1280,800', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });

  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    const to = setTimeout(() => rej(new Error('chrome did not start')), 20000);
    proc.stderr.on('data', d => {
      buf += d;
      const m = buf.match(/ws:\/\/\S+/);
      if (m) { clearTimeout(to); res(m[0]); }
    });
    proc.on('exit', c => rej(new Error('chrome exited ' + c)));
  });

  const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 64 << 20 });
  await new Promise(r => ws.once('open', r));
  let id = 0; const waiting = new Map(); const events = [];
  ws.on('message', d => {
    const m = JSON.parse(d);
    if (m.id && waiting.has(m.id)) {
      const { res, rej } = waiting.get(m.id); waiting.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    } else if (m.method) events.push(m);
  });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id; waiting.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  return {
    events, send, close: () => { try { ws.close(); } catch {} proc.kill('SIGKILL'); },
    async page(url) {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const S = sessionId;
      await send('Page.enable', {}, S);
      await send('Runtime.enable', {}, S);
      const logs = [];
      ws.on('message', d => {
        const m = JSON.parse(d);
        if (m.method === 'Runtime.consoleAPICalled' && m.sessionId === S)
          logs.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
        if (m.method === 'Runtime.exceptionThrown' && m.sessionId === S)
          logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
      });
      return {
        logs,
        addInit: src => send('Page.addScriptToEvaluateOnNewDocument', { source: src }, S),
        goto: async u => {
          const done = new Promise(r => {
            const h = d => { const m = JSON.parse(d);
              if (m.method === 'Page.loadEventFired' && m.sessionId === S) { ws.off('message', h); r(); } };
            ws.on('message', h);
          });
          await send('Page.navigate', { url: u }, S); await done;
        },
        async eval(expr) {
          const r = await send('Runtime.evaluate',
            { expression: expr, awaitPromise: true, returnByValue: true }, S);
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
          return r.result.value;
        },
        shot: async path => {
          const r = await send('Page.captureScreenshot', { format: 'png' }, S);
          const { writeFileSync } = await import('node:fs');
          writeFileSync(path, Buffer.from(r.data, 'base64'));
        }
      };
    }
  };
}
