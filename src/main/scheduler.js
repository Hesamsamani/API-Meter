const { appendHistory } = require('./store');

class CollectorScheduler {
  /**
   * @param {{ registry: { list(): any[] }, store: import('./usage-store').UsageStore, onUpdate?: () => void }} deps
   */
  constructor({ registry, store, onUpdate }) {
    this.registry = registry;
    this.store = store;
    this.onUpdate = onUpdate || (() => {});
    this.timers = new Map();
    this.backoff = new Map();
  }

  async refreshProvider(adapter) {
    try {
      const snap = await adapter.fetchUsage();
      snap.plan = adapter.detectPlan(snap) || snap.plan;
      this.store.setLive(adapter.id, snap);
      appendHistory(adapter.id, {
        timestamp: Date.now(),
        windows: Object.fromEntries(snap.windows.map((w) => [w.key, w.utilization])),
      });
      this.backoff.set(adapter.id, 120000);
    } catch (err) {
      this.store.setError(adapter.id, err.message || String(err));
      this.backoff.set(adapter.id, 25000);
    }
    this.onUpdate();
  }

  async refreshAll() {
    await Promise.all(this.registry.list().map((a) => this.refreshProvider(a)));
  }

  start(intervalMs = 300000) {
    this.stop();
    this.refreshAll();
    const tick = () => {
      this.refreshAll();
      this.timer = setTimeout(tick, intervalMs);
    };
    this.timer = setTimeout(tick, intervalMs);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }
}

module.exports = { CollectorScheduler };