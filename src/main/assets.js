const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app } = require('electron');

function resolveProviderLogoPath(providerId) {
  const fileName = `${providerId}.png`;
  const candidates = [
    path.join(app.getAppPath(), 'src', 'renderer', 'assets', 'providers', fileName),
    path.join(app.getAppPath(), 'assets', 'providers', fileName),
    path.join(process.resourcesPath, 'assets', 'providers', fileName),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

function providerLogoUrl(providerId) {
  try {
    return pathToFileURL(resolveProviderLogoPath(providerId)).href;
  } catch {
    return '';
  }
}

function getPreloadPath() {
  return path.join(app.getAppPath(), 'preload.js');
}

module.exports = { resolveProviderLogoPath, providerLogoUrl, getPreloadPath };