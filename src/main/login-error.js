/**
 * Apply provider login failure to the usage store (skipped when user cancels).
 * @param {{ providerId: string, error: unknown, store: { setError(id: string, message: string): void }, onUsageBroadcast?: () => void }} deps
 * @returns {{ applied: boolean, message: string }}
 */
function applyProviderLoginFailure({ providerId, error, store, onUsageBroadcast }) {
  const message = error?.message || String(error);
  if (/cancel/i.test(message)) {
    return { applied: false, message };
  }
  store.setError(providerId, message);
  onUsageBroadcast?.();
  return { applied: true, message };
}

module.exports = { applyProviderLoginFailure };