import { ORDER, PROVIDER_META } from '../shared/provider-card.js';

const form = document.getElementById('settings-form');
const providerToggles = document.getElementById('provider-toggles');
const btnClose = document.getElementById('btn-close');

let current = {};

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

function populateForm(settings) {
  current = settings;
  document.getElementById('refresh-interval').value = settings.refreshIntervalMinutes ?? 5;
  document.getElementById('auto-refresh').checked = settings.autoRefreshEnabled !== false;
  document.getElementById('alerts-enabled').checked = settings.alerts?.enabled !== false;
  document.getElementById('warn-threshold').value = settings.alerts?.warnThreshold ?? 75;
  document.getElementById('danger-threshold').value = settings.alerts?.dangerThreshold ?? 90;
  document.getElementById('widget-auto-rotate').checked = settings.floatingWidget?.autoRotate === true;
  renderProviderToggles(settings.providers || {});
}

function collectPatch() {
  const providers = { ...(current.providers || {}) };
  providerToggles.querySelectorAll('[data-provider]').forEach((input) => {
    const id = input.dataset.provider;
    providers[id] = { ...(providers[id] || {}), enabled: input.checked };
  });

  return {
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

  window.apiMeter.onSettingsUpdated((settings) => populateForm(settings));

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      current = await window.apiMeter.updateSettings(collectPatch());
      populateForm(current);
    } catch (err) {
      console.error('Save failed:', err);
    }
  });
}

init();