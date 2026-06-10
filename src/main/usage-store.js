class UsageStore {
  constructor() {
    /** @type {Map<string, import('../shared/types').UsageSnapshot>} */
    this.cache = new Map();
  }

  setLive(providerId, snapshot) {
    const { error: _error, ...rest } = snapshot;
    this.cache.set(providerId, { ...rest, source: 'live' });
  }

  setError(providerId, message) {
    const prev = this.cache.get(providerId);
    if (prev) {
      this.cache.set(providerId, { ...prev, source: 'stale', error: message });
      return;
    }
    this.cache.set(providerId, {
      providerId,
      source: 'stale',
      plan: null,
      windows: [],
      fetchedAt: new Date().toISOString(),
      error: message,
    });
  }

  get(providerId) {
    return this.cache.get(providerId) || null;
  }

  getAll() {
    return Object.fromEntries(this.cache.entries());
  }
}

module.exports = { UsageStore };