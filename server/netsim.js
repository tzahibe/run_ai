// Artificial network conditions, applied per connection in BOTH directions so
// a single machine can reproduce a real player's experience: one-way latency,
// jitter (which also reorders packets), and loss.

export class NetSim {
  constructor(cfg = {}) { this.set(cfg); }
  set(cfg) {
    this.rtt = Math.max(0, +cfg.rtt || 0);
    this.jitter = Math.max(0, +cfg.jitter || 0);
    this.loss = Math.max(0, Math.min(100, +cfg.loss || 0));
  }
  get summary() { return { rtt: this.rtt, jitter: this.jitter, loss: this.loss }; }
  /**
   * Deliver `fn` after one-way delay, or never (packet lost).
   * `reliable` messages are delayed but never dropped: a real build puts
   * control traffic (match start, results) on a reliable channel and only
   * state updates on an unreliable one. Dropping a one-shot control message
   * does not simulate a bad network, it simulates a broken protocol.
   */
  deliver(fn, reliable = false) {
    if (!reliable && this.loss > 0 && Math.random() * 100 < this.loss) return false;
    const d = Math.max(0, this.rtt / 2 + (Math.random() * 2 - 1) * this.jitter / 2);
    if (d < 0.5) fn(); else setTimeout(fn, d);
    return true;
  }
}
