const { appendHistory } = require('./store');

const FAILURE_BACKOFF_MS = 25000;

class CollectorScheduler {
  /**
   * @param {{ registry: { list(): any[] }, store: import('./usage-store').UsageStore, onUpdate?: () => void, settings: import('electron-store') }} deps
   */
  constructor({ registry, store, onUpdate, settings }) {
    this.registry = registry;
    this.store = store;
    this.onUpdate = onUpdate || (() => {});
    this.settings = settings;
    this.timers = new Map();
    this.backoff = new Map();
    this.running = false;
  }

  getSuccessIntervalMs() {
    const mins = this.settings.get('refreshIntervalMinutes') ?? 5;
    return Math.max(60000, mins * 60 * 1000);
  }

  getEnabledAdapters() {
    const cfg = this.settings.get('providers') || {};
    return this.registry.list().filter((a) => cfg[a.id]?.enabled !== false);
  }

  nextDelay(adapterId, success) {
    if (!success) return FAILURE_BACKOFF_MS;
    return this.backoff.get(adapterId) ?? this.getSuccessIntervalMs();
  }

  async refreshProvider(adapter) {
    const cfg = this.settings.get('providers') || {};
    if (cfg[adapter.id]?.enabled === false) return true;

    try {
      const snap = await adapter.fetchUsage();
      snap.plan = adapter.detectPlan(snap) || snap.plan;
      this.store.setLive(adapter.id, snap);
      appendHistory(adapter.id, {
        timestamp: Date.now(),
        windows: Object.fromEntries(snap.windows.map((w) => [w.key, w.utilization])),
      });
      this.backoff.set(adapter.id, this.getSuccessIntervalMs());
      this.onUpdate();
      return true;
    } catch (err) {
      this.store.setError(adapter.id, err.message || String(err));
      this.backoff.set(adapter.id, FAILURE_BACKOFF_MS);
      this.onUpdate();
      return false;
    }
  }

  scheduleProvider(adapter, delayMs) {
    const existing = this.timers.get(adapter.id);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      if (!this.running || !this.settings.get('autoRefreshEnabled', true)) return;
      const success = await this.refreshProvider(adapter);
      if (this.running && this.settings.get('autoRefreshEnabled', true)) {
        this.scheduleProvider(adapter, this.nextDelay(adapter.id, success));
      }
    }, delayMs);

    this.timers.set(adapter.id, timer);
  }

  async refreshAll() {
    await Promise.all(this.getEnabledAdapters().map((a) => this.refreshProvider(a)));
  }

  async refreshProviderAndReschedule(adapter) {
    const success = await this.refreshProvider(adapter);
    if (!this.running) return;
    this.scheduleProvider(adapter, this.nextDelay(adapter.id, success));
  }

  start() {
    this.stop();
    this.running = true;
    if (!this.settings.get('autoRefreshEnabled', true)) return;

    for (const adapter of this.getEnabledAdapters()) {
      this.refreshProvider(adapter).then((success) => {
        if (this.running) {
          this.scheduleProvider(adapter, this.nextDelay(adapter.id, success));
        }
      });
    }
  }

  restart() {
    this.start();
  }

  stop() {
    this.running = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

module.exports = { CollectorScheduler, FAILURE_BACKOFF_MS };