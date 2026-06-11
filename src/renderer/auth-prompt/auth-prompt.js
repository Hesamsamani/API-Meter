const titleEl = document.getElementById('auth-title');
const descEl = document.getElementById('auth-desc');
const statusEl = document.getElementById('auth-status');
const pasteEl = document.getElementById('auth-cookie-paste');
const cookieNameEl = document.getElementById('auth-cookie-name');
const cookieHintEl = document.getElementById('auth-cookie-hint');
const importBtn = document.getElementById('auth-import');

let activeTab = 'browser';

function setStatus(text, mode = 'waiting') {
  statusEl.textContent = text;
  statusEl.className = `auth-status ${mode}`;
}

function setTab(tab) {
  activeTab = tab === 'paste' ? 'paste' : 'browser';
  document.querySelectorAll('.auth-tab').forEach((btn) => {
    const on = btn.dataset.tab === activeTab;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('.auth-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `panel-${activeTab}`);
  });
  window.apiMeter.setAuthTab?.(activeTab);
}

document.querySelectorAll('.auth-tab').forEach((btn) => {
  btn.addEventListener('click', () => setTab(btn.dataset.tab));
});

window.apiMeter.onAuthPromptInit?.((payload) => {
  titleEl.textContent = payload.title || 'Browser Login';
  descEl.textContent = payload.description || descEl.textContent;
  setStatus(payload.status || 'Waiting for in-app sign-in…', payload.mode || 'waiting');
  if (payload.cookieNameHint && cookieHintEl) {
    cookieHintEl.textContent = `Looking for: ${payload.cookieNameHint}`;
    if (cookieNameEl && !cookieNameEl.placeholder.includes(payload.cookieNameHint)) {
      cookieNameEl.placeholder = `e.g. ${payload.cookieNameHint.split(',')[0].trim()}`;
    }
  }
});

window.apiMeter.onAuthPromptStatus?.((payload) => {
  setStatus(payload.status, payload.mode || 'waiting');
  if (importBtn) importBtn.disabled = false;
});

function submitPaste() {
  const value = pasteEl?.value?.trim() || '';
  const fallback = document.getElementById('auth-manual-value');
  const singleName = cookieNameEl?.value?.trim() || '';

  if (!value && !fallback?.value?.trim()) {
    setStatus('Paste the site cookie string first.', 'error');
    return;
  }

  if (importBtn) importBtn.disabled = true;
  setStatus('Importing cookies…', 'waiting');

  window.apiMeter.submitAuthPrompt({
    value: value || fallback?.value?.trim(),
    cookieName: singleName,
    mode: value ? 'paste' : 'token',
  });
}

document.getElementById('auth-cancel')?.addEventListener('click', () => {
  window.apiMeter.cancelAuthPrompt();
});

document.getElementById('auth-cancel-paste')?.addEventListener('click', () => {
  window.apiMeter.cancelAuthPrompt();
});

document.getElementById('auth-retry')?.addEventListener('click', () => {
  window.apiMeter.retryAuthPrompt();
});

document.getElementById('auth-import')?.addEventListener('click', submitPaste);

pasteEl?.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    submitPaste();
  }
});