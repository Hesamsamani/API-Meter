import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyProviderLoginFailure } from '../../src/main/login-error.js';

test('applyProviderLoginFailure calls setError with error message', () => {
  const calls = [];
  const store = {
    setError(id, message) {
      calls.push({ id, message });
    },
  };
  let broadcasted = false;

  const result = applyProviderLoginFailure({
    providerId: 'claude-ai',
    error: new Error('Setting cookie failed (sessionKey): net::ERR_FAILED'),
    store,
    onUsageBroadcast: () => {
      broadcasted = true;
    },
  });

  assert.equal(result.applied, true);
  assert.equal(result.message, 'Setting cookie failed (sessionKey): net::ERR_FAILED');
  assert.deepEqual(calls, [{
    id: 'claude-ai',
    message: 'Setting cookie failed (sessionKey): net::ERR_FAILED',
  }]);
  assert.equal(broadcasted, true);
});

test('applyProviderLoginFailure skips store update when login is cancelled', () => {
  const calls = [];
  const store = {
    setError(id, message) {
      calls.push({ id, message });
    },
  };
  let broadcasted = false;

  const result = applyProviderLoginFailure({
    providerId: 'claude-ai',
    error: new Error('Login cancelled by user'),
    store,
    onUsageBroadcast: () => {
      broadcasted = true;
    },
  });

  assert.equal(result.applied, false);
  assert.equal(result.message, 'Login cancelled by user');
  assert.deepEqual(calls, []);
  assert.equal(broadcasted, false);
});

test('applyProviderLoginFailure stringifies non-Error failures', () => {
  const calls = [];
  const store = {
    setError(id, message) {
      calls.push({ id, message });
    },
  };

  const result = applyProviderLoginFailure({
    providerId: 'gemini',
    error: 'provider unavailable',
    store,
  });

  assert.equal(result.applied, true);
  assert.equal(result.message, 'provider unavailable');
  assert.deepEqual(calls, [{ id: 'gemini', message: 'provider unavailable' }]);
});