// Per-IP limits. A public WebSocket server with no caps is an invitation: one
// script can open thousands of sockets, spawn endless rooms, or flood the
// message loop. None of these are clever attacks — they are what happens by
// accident when a link gets shared.

const MINUTE = 60000;

export class Limits {
  constructor(opts = {}) {
    this.maxConnsPerIp = opts.maxConnsPerIp ?? 8;
    this.maxNewPerMin = opts.maxNewPerMin ?? 40;
    this.maxRoomsPerIp = opts.maxRoomsPerIp ?? 3;
    this.maxMsgPerSec = opts.maxMsgPerSec ?? 140;   // 60 input packets/s + room traffic
    this.ips = new Map();                            // ip -> { live, recent[], rooms }
    this.sweeper = setInterval(() => this.sweep(), 30000);
    this.sweeper.unref?.();
  }
  rec(ip) {
    let r = this.ips.get(ip);
    if (!r) { r = { live: 0, recent: [], rooms: 0 }; this.ips.set(ip, r); }
    return r;
  }
  sweep() {
    const cut = Date.now() - MINUTE;
    for (const [ip, r] of this.ips) {
      r.recent = r.recent.filter(t => t > cut);
      if (!r.live && !r.rooms && !r.recent.length) this.ips.delete(ip);
    }
  }
  /** @returns {string|null} a refusal reason, or null to allow the connection */
  admit(ip) {
    const r = this.rec(ip), now = Date.now();
    r.recent = r.recent.filter(t => t > now - MINUTE);
    if (r.live >= this.maxConnsPerIp) return 'too many connections from this address';
    if (r.recent.length >= this.maxNewPerMin) return 'connecting too often, wait a minute';
    r.live++; r.recent.push(now);
    return null;
  }
  release(ip) { const r = this.ips.get(ip); if (r) r.live = Math.max(0, r.live - 1); }
  openRoom(ip) { const r = this.rec(ip); if (r.rooms >= this.maxRoomsPerIp) return false; r.rooms++; return true; }
  closeRoom(ip) { const r = this.ips.get(ip); if (r) r.rooms = Math.max(0, r.rooms - 1); }
  /** Token-bucket-ish per connection; returns false when the message is dropped. */
  message(conn) {
    const now = Date.now();
    if (now - (conn.msgWindow || 0) >= 1000) { conn.msgWindow = now; conn.msgCount = 0; }
    return ++conn.msgCount <= this.maxMsgPerSec;
  }
  stats() { return { addresses: this.ips.size, connections: [...this.ips.values()].reduce((a, r) => a + r.live, 0) }; }
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
