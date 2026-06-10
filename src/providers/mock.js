/** @type {import('../shared/types').UsageSnapshot} */
function buildMock(id, name) {
  return {
    providerId: id,
    source: 'live',
    plan: 'Mock',
    windows: [
      { key: 'session', label: 'SES', utilization: 14, resetsAt: new Date(Date.now() + 3.8 * 3600000).toISOString() },
      { key: 'weekly', label: 'WK', utilization: 88, resetsAt: new Date(Date.now() + 3.2 * 86400000).toISOString() },
    ],
    fetchedAt: new Date().toISOString(),
  };
}

function createMockAdapter(id, name) {
  return {
    id,
    name,
    authMethod: 'local-db',
    async isAvailable() { return true; },
    async isAuthenticated() { return true; },
    async login() {},
    async logout() {},
    async fetchUsage() { return buildMock(id, name); },
    detectPlan() { return 'Mock'; },
  };
}

module.exports = { createMockAdapter, buildMock };