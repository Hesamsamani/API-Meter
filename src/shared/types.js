/**
 * @typedef {'claude-ai'|'claude-code'|'gemini'|'perplexity'|'grok'|'cursor'} ProviderId
 * @typedef {'live'|'local'|'stale'} UsageSource
 * @typedef {{ key: string, label: string, utilization: number, resetsAt?: string }} UsageWindow
 * @typedef {{ providerId: ProviderId, source: UsageSource, plan: string|null, windows: UsageWindow[], fetchedAt: string, error?: string }} UsageSnapshot
 */
module.exports = {};