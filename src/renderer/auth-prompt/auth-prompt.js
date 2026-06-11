const titleEl = document.getElementById('auth-title');
const descEl = document.getElementById('auth-desc');
const statusEl = document.getElementById('auth-status');
const pasteEl = document.getElementById('auth-cookie-paste');
const cookieNameEl = document.getElementById('auth-cookie-name');
const cookieHintEl = document.getElementById('auth-cookie-hint');
const importBtn = document.getElementById('auth-import');
const readClipBtn = document.getElementById('auth-read-clipboard');
const scanMetaEl = document.getElementById('auth-scan-meta');

let activeTab = 'browser';

function setStatus(text, mode = 'waiting') {
  statusEl.textContent = text;
  statusEl.className = `auth-status ${mode}`;
}

function setScanMeta(text) {
  if (scanMetaEl) scanMetaEl.textContent = text || '';
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

function applyClipboardPayload(payload) {
  if (!payload?.text || !pasteEl) return;
  pasteEl.value = payload.text;
  if (payload.detected) {
    setScanMeta('Clipboard scan: cookie export detected');
    setStatus('EditThisCookie export loaded — click Import & connect.', 'waiting');
  } else {
    setScanMeta('Clipboard loaded — no cookie export pattern detected');
  }
}

document.querySelectorAll('.auth-tab').forEach((btn) => {
  btn.addEventListener('click', () => setTab(btn.dataset.tab));
});

window.apiMeter.onAuthPromptInit?.((payload) => {
  titleEl.textContent = payload.title || 'Browser Login';
  descEl.textContent = payload.description || descEl.textContent;
  setStatus(payload.status || 'Waiting for in-app sign-in…', payload.mode || 'waiting');
  if (payload.cookieNameHint && cookieHintEl) {
    cookieHintEl.textContent = `Session cookies: ${payload.cookieNameHint}`;
    if (cookieNameEl && !cookieNameEl.placeholder.includes(payload.cookieNameHint)) {
      cookieNameEl.placeholder = `Only if pasting a single value — e.g. ${payload.cookieNameHint.split(',')[0].trim()}`;
    }
  }
});

window.apiMeter.onAuthPromptStatus?.((payload) => {
  setStatus(payload.status, payload.mode || 'waiting');
  if (importBtn) importBtn.disabled = false;
});

window.apiMeter.onAuthPromptClipboard?.((payload) => {
  applyClipboardPayload(payload);
});

async function readClipboard() {
  try {
    const payload = await window.apiMeter.readClipboardCookies?.();
    if (!payload?.text) {
      setStatus('Clipboard is empty.', 'error');
      return;
    }
    applyClipboardPayload(payload);
  } catch (err) {
    setStatus(`Clipboard read failed: ${err.message || err}`, 'error');
  }
}

function submitPaste() {
  const value = pasteEl?.value?.trim() || '';
  const singleName = cookieNameEl?.value?.trim() || '';

  if (!value) {
    setStatus('Paste EditThisCookie export or click Read clipboard.', 'error');
    return;
  }

  if (importBtn) importBtn.disabled = true;
  setScanMeta('');
  setStatus('Scanning export and importing cookies…', 'waiting');

  window.apiMeter.submitAuthPrompt({
    value,
    cookieName: singleName,
    mode: 'paste',
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
readClipBtn?.addEventListener('click', readClipboard);

pasteEl?.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    submitPaste();
  }
});