import { ORDER, PROVIDER_META } from '../shared/provider-card.js';

const form = document.getElementById('settings-form');
const providerToggles = document.getElementById('provider-toggles');
const widgetPinGrid = document.getElementById('widget-pin-grid');
const btnClose = document.getElementById('btn-close');

let current = {};
let formDirty = false;

function renderProviderToggles(providers) {
  providerToggles.replaceChildren();
  ORDER.forEach((id) => {
    const meta = PROVIDER_META[id];
    const label = document.createElement('label');
    label.className = 'field-check provider-toggle';
    label.innerHTML = `
      <input type="checkbox" data-provider="${id}" ${providers[id]?.enabled !== false ? 'checked' : ''}>
      <span>${meta.label}</span>
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

  form?.addEventListener('input', () => { formDirty = true; });
  form?.addEventListener('change', () => { formDirty = true; });

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
      populateForm(current);
    } catch (err) {
      console.error('Save failed:', err);
    }
  });
}

init();