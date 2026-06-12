import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const authSrc = readFileSync(path.join(root, 'src/main/auth-window.js'), 'utf8');
const promptJs = readFileSync(path.join(root, 'src/renderer/auth-prompt/auth-prompt.js'), 'utf8');
const promptHtml = readFileSync(path.join(root, 'src/renderer/auth-prompt/index.html'), 'utf8');

test('gemini auth uses external Chrome flow instead of embedded Google OAuth', () => {
  assert.match(authSrc, /externalBrowser/);
  assert.match(authSrc, /openChromiumUrl/);
  assert.match(authSrc, /readBrowserCookie/);
  assert.match(authSrc, /auth-prompt:import-browser/);
  assert.match(authSrc, /Google blocked in-app sign-in/);
  assert.match(authSrc, /alwaysOnTop:\s*!external/);
  assert.match(authSrc, /minimizeAuthPrompt/);
  assert.doesNotMatch(authSrc, /external \? 3000 : 1500/);
});

test('auth prompt supports external browser tab', () => {
  assert.match(promptJs, /configureAuthMode/);
  assert.match(promptHtml, /panel-external/);
  assert.match(promptJs, /importBrowserCookies/);
});