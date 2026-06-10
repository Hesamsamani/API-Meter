const titleEl = document.getElementById('auth-title');
const descEl = document.getElementById('auth-desc');
const statusEl = document.getElementById('auth-status');
const manualEl = document.getElementById('auth-manual-value');

function setStatus(text, mode = 'waiting') {
  statusEl.textContent = text;
  statusEl.className = `auth-status ${mode}`;
}

window.apiMeter.onAuthPromptInit?.((payload) => {
  titleEl.textContent = payload.title || 'Browser Login';
  descEl.textContent = payload.description || descEl.textContent;
  setStatus(payload.status || 'Waiting for browser sign-in…', payload.mode || 'waiting');
});

window.apiMeter.onAuthPromptStatus?.((payload) => {
  setStatus(payload.status, payload.mode || 'waiting');
});

document.getElementById('auth-cancel')?.addEventListener('click', () => {
  window.apiMeter.cancelAuthPrompt();
});

document.getElementById('auth-retry')?.addEventListener('click', () => {
  window.apiMeter.retryAuthPrompt();
});

document.getElementById('auth-save')?.addEventListener('click', () => {
  const value = manualEl.value.trim();
  if (!value) {
    setStatus('Paste a session token first.', 'error');
    return;
  }
  window.apiMeter.submitAuthPrompt(value);
});