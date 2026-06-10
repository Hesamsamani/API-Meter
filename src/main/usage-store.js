const { isAuthErrorMessage } = require('../shared/auth-errors');

class UsageStore {
  constructor() {
    /** @type {Map<string, import('../shared/types').UsageSnapshot>} */
    this.cache = new Map();
  }

  setSnapshot(providerId, snapshot) {
    const normalized = {
      ...snapshot,
      providerId: snapshot.providerId || providerId,
      fetchedAt: snapshot.fetchedAt || new Date().toISOString(),
    };
    if (normalized.error && isAuthErrorMessage(normalized.error)) {
      normalized.authRequired = true;
    }
    this.cache.set(providerId, normalized);
  }

  /** @deprecated Use setSnapshot — kept for compatibility */
  setLive(providerId, snapshot) {
    this.setSnapshot(providerId, snapshot);
  }

  setError(providerId, message) {
    const authRequired = isAuthErrorMessage(message);
    const prev = this.cache.get(providerId);
    if (prev) {
      this.cache.set(providerId, {
        ...prev,
        source: 'stale',
        error: message,
        authRequired,
        windows: authRequired ? [] : prev.windows,
      });
      return;
    }
    this.cache.set(providerId, {
      providerId,
      source: 'stale',
      plan: null,
      windows: [],
      fetchedAt: new Date().toISOString(),
      error: message,
      authRequired,
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