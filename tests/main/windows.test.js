import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const windowsSrc = readFileSync(path.join(root, 'src/main/windows.js'), 'utf8');

test('workAreaForBounds uses Electron screen.getDisplayMatching', () => {
  assert.match(windowsSrc, /screen\.getDisplayMatching\(bounds\)/);
  assert.doesNotMatch(windowsSrc, /getDisplayMatchingRect/);
});