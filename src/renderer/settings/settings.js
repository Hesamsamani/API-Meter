import { ORDER, PROVIDER_META } from '../shared/provider-card.js';

const form = document.getElementById('settings-form');
const providerToggles = document.getElementById('provider-toggles');
const widgetPinGrid = document.getElementById('widget-pin-grid');
const providerAuthList = document.getElementById('provider-auth-list');
const saveHint = document.getElementById('settings-save-hint');
const btnClose = document.getElementById('btn-close');
const navItems = [...document.querySelectorAll('.settings-nav-item')];
const panels = [...document.querySelectorAll('.settings-panel')];

const AUTH_HINTS = {
  'claude-ai': 'Browser sign-in or cookie paste',
  'claude-code': 'Local OAuth token from CLI',
  gemini: 'Browser sign-in or cookie paste',
  perplexity: 'Browser sign-in',
  grok: 'Local OAuth token',
  cursor: 'Local session from Cursor app',
};

let current = {};
let formDirty = false;
let activePanel = 'general';

function setActivePanel(panelId) {
  activePanel = panelId;
  navItems.forEach((btn) => {
    const active = btn.dataset.panel === panelId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  });
  panels.forEach((panel) => {
    const show = panel.dataset.panel === panelId;
    panel.classList.toggle('active', show);
    panel.hidden = !show;
  });
}

function bindSidebarNav() {
  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      setActivePanel(btn.dataset.panel);
    });
  });
}

function syncDirtyUi() {
  if (saveHint) saveHint.hidden = !formDirty;
}

function renderProviderToggles(providers) {
  providerToggles.replaceChildren();
  ORDER.forEach((id) => {
    const meta = PROVIDER_META[id];
    const label = document.createElement('label');
    label.className = 'field-check provider-toggle';
    label.innerHTML = `
      <input type="checkbox" data-provider="${id}" ${providers[id]?.enabled !== false ? 'checked' : ''}>
      <span class="provider-toggle-label">
        <span class="provider-toggle-dot" style="--accent:${meta.accent}"></span>
        ${meta.label}
      </span>
    `;
    providerToggles.appendChild(label);
  });
}

function renderWidgetPins(pinned = []) {
  if (!widgetPinGrid) return;
  widgetPinGrid.replaceChildren();
  ORDER.forEach((id) => {
    const meta = PROVIDER_META[id];
    const label = document.createElement('label');
    label.className = 'field-check widget-pin';
    label.innerHTML = `
      <input type="checkbox" data-widget-pin="${id}" ${pinned.includes(id) ? 'checked' : ''}>
      <span>${meta.label}</span>
    `;
    widgetPinGrid.appendChild(label);
  });
}

function runProviderAction(providerId, action, button) {
  const actions = {
    login: () => window.apiMeter.loginProvider(providerId),
    logout: () => window.apiMeter.logoutProvider(providerId),
    reset: () => window.apiMeter.resetProvider(providerId),
  };
  const fn = actions[action];
  if (!fn) return;

  const card = button.closest('.provider-auth-card');
  card?.classList.add('provider-auth-card--busy');
  button.disabled = true;

  fn()
    .catch((err) => {
      console.error(`${action} failed for ${providerId}:`, err);
    })
    .finally(() => {
      card?.classList.remove('provider-auth-card--busy');
      button.disabled = false;
    });
}

function renderProviderAuthList() {
  if (!providerAuthList) return;
  providerAuthList.replaceChildren();

  ORDER.forEach((id) => {
    const meta = PROVIDER_META[id];
    const card = document.createElement('article');
    card.className = 'provider-auth-card';
    card.dataset.providerId = id;
    card.style.setProperty('--accent', meta.accent);

    const resetBtn = id === 'gemini'
      ? '<button type="button" class="btn-chip warning" data-action="reset">Reset & sign in</button>'
      : '';

    card.innerHTML = `
      <div class="provider-auth-head">
        <span class="provider-auth-avatar" aria-hidden="true">${meta.initials}</span>
        <div class="provider-auth-meta">
          <h3>${meta.label}</h3>
          <p class="field-hint">${AUTH_HINTS[id] || 'Sign in required'}</p>
        </div>
      </div>
      <div class="provider-auth-actions">
        <button type="button" class="btn-chip" data-action="login">Re-login</button>
        <button type="button" class="btn-chip danger" data-action="logout">Disconnect</button>
        ${resetBtn}
      </div>
    `;

    card.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        runProviderAction(id, btn.dataset.action, btn);
      });
    });

    providerAuthList.appendChild(card);
  });
}

function updateLayerOrderUi(fw = {}) {
  const select = document.getElementById('widget-layer-order');
  const hint = document.getElementById('widget-layer-order-hint');
  const desktopOption = select?.querySelector('option[value="desktop"]');
  const unavailable = fw.desktopPinAvailable === false;

  if (desktopOption) {
    desktopOption.disabled = unavailable;
    desktopOption.hidden = unavailable;
  }
  if (select && unavailable && select.value === 'desktop') {
    select.value = 'always-on-top';
  }
  if (hint) {
    hint.textContent = unavailable
      ? 'Desktop layer is not supported on this PC (Electron cannot pin to the Windows desktop here). Always on top is used instead.'
      : 'Always on top keeps the widget visible above apps. Desktop layer pins behind windows and survives Show Desktop — use if the widget disappears.';
  }
}

function populateForm(settings) {
  current = settings;
  const fw = settings.floatingWidget || {};
  document.getElementById('launch-at-startup').checked = settings.launchAtStartup === true;
  document.getElementById('usage-display-mode').value = settings.usageDisplayMode === 'remaining' ? 'remaining' : 'used';
  document.getElementById('refresh-interval').value = settings.refreshIntervalMinutes ?? 5;
  document.getElementById('auto-refresh').checked = settings.autoRefreshEnabled !== false;
  document.getElementById('alerts-enabled').checked = settings.alerts?.enabled !== false;
  document.getElementById('warn-threshold').value = settings.alerts?.warnThreshold ?? 75;
  document.getElementById('danger-threshold').value = settings.alerts?.dangerThreshold ?? 90;
  document.getElementById('widget-auto-rotate').checked = fw.autoRotate === true;
  document.getElementById('widget-layer-order').value = fw.layerOrder || 'always-on-top';
  updateLayerOrderUi(fw);
  document.getElementById('widget-click-through').checked = fw.clickThrough === true;
  document.getElementById('widget-display-mode').value = fw.displayMode || 'single';
  document.getElementById('widget-size').value = fw.size || 'medium';
  document.getElementById('widget-theme').value = fw.theme || 'dark';
  document.getElementById('widget-opacity').value = Math.round((fw.opacity ?? 0.92) * 100);
  renderProviderToggles(settings.providers || {});
  renderWidgetPins(fw.pinnedProviders || []);
}

function collectPatch() {
  const providers = { ...(current.providers || {}) };
  providerToggles.querySelectorAll('[data-provider]').forEach((input) => {
    const id = input.dataset.provider;
    providers[id] = { ...(providers[id] || {}), enabled: input.checked };
  });

  const pinnedProviders = [];
  widgetPinGrid?.querySelectorAll('[data-widget-pin]').forEach((input) => {
    if (input.checked) pinnedProviders.push(input.dataset.widgetPin);
  });

  return {
    launchAtStartup: document.getElementById('launch-at-startup').checked,
    usageDisplayMode: document.getElementById('usage-display-mode').value === 'remaining' ? 'remaining' : 'used',
    refreshIntervalMinutes: Number(document.getElementById('refresh-interval').value) || 5,
    autoRefreshEnabled: document.getElementById('auto-refresh').checked,
    alerts: {
      ...(current.alerts || {}),
      enabled: document.getElementById('alerts-enabled').checked,
      warnThreshold: Number(document.getElementById('warn-threshold').value) || 75,
      dangerThreshold: Number(document.getElementById('danger-threshold').value) || 90,
    },
    floatingWidget: {
      ...(current.floatingWidget || {}),
      autoRotate: document.getElementById('widget-auto-rotate').checked,
      layerOrder: document.getElementById('widget-layer-order').value,
      clickThrough: document.getElementById('widget-click-through').checked,
      displayMode: document.getElementById('widget-display-mode').value,
      size: document.getElementById('widget-size').value,
      theme: document.getElementById('widget-theme').value,
      opacity: Number(document.getElementById('widget-opacity').value) / 100,
      pinnedProviders,
    },
    providers,
  };
}

async function init() {
  bindSidebarNav();
  renderProviderAuthList();
  setActivePanel(activePanel);

  btnClose?.addEventListener('click', () => window.apiMeter.closeWindow());

  try {
    const settings = await window.apiMeter.getSettings();
    populateForm(settings);
  } catch (err) {
    console.error('Failed to load settings:', err);
  }

  window.apiMeter.onSettingsUpdated((incoming) => {
    if (formDirty) {
      const fw = incoming.floatingWidget || {};
      const sizeEl = document.getElementById('widget-size');
      const themeEl = document.getElementById('widget-theme');
      const modeEl = document.getElementById('widget-display-mode');
      if (sizeEl && fw.size) sizeEl.value = fw.size;
      if (themeEl && fw.theme) themeEl.value = fw.theme;
      if (modeEl && fw.displayMode) modeEl.value = fw.displayMode;
      const pinnedProviders = [];
      widgetPinGrid?.querySelectorAll('[data-widget-pin]').forEach((input) => {
        if (input.checked) pinnedProviders.push(input.dataset.widgetPin);
      });
      current = {
        ...current,
        floatingWidget: {
          ...(fw),
          autoRotate: document.getElementById('widget-auto-rotate').checked,
          layerOrder: document.getElementById('widget-layer-order').value,
          clickThrough: document.getElementById('widget-click-through').checked,
          displayMode: document.getElementById('widget-display-mode').value,
          size: sizeEl?.value || fw.size || 'medium',
          theme: themeEl?.value || fw.theme || 'dark',
          opacity: Number(document.getElementById('widget-opacity').value) / 100,
          pinnedProviders,
        },
      };
      return;
    }
    populateForm(incoming);
  });

  const markDirty = () => {
    formDirty = true;
    syncDirtyUi();
  };

  form?.addEventListener('input', markDirty);
  form?.addEventListener('change', markDirty);

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const live = await window.apiMeter.getSettings();
      const patch = collectPatch();
      patch.floatingWidget = {
        ...patch.floatingWidget,
        enabled: live.floatingWidget?.enabled ?? false,
      };
      if (live.floatingWidget?.position) {
        patch.floatingWidget.position = live.floatingWidget.position;
      }
      current = await window.apiMeter.updateSettings(patch);
      formDirty = false;
      syncDirtyUi();
      populateForm(current);
    } catch (err) {
      console.error('Save failed:', err);
    }
  });
}

init();