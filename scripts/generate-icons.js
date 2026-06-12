#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createTrayIconPng, createAppIconPng } = require('../src/main/tray-icon-buffer');

const assetsDir = path.join(__dirname, '..', 'assets');

fs.mkdirSync(assetsDir, { recursive: true });

fs.writeFileSync(path.join(assetsDir, 'icon.png'), createAppIconPng(512, 38));

const trayLevels = ['green', 'amber', 'red'];
const trayUtils = [18, 52, 88];

for (const level of trayLevels) {
  const util = trayUtils[trayLevels.indexOf(level)];
  fs.writeFileSync(path.join(assetsDir, `tray-icon-${level}.png`), createTrayIconPng(level, 16, util));
  fs.writeFileSync(path.join(assetsDir, `tray-icon-${level}@2x.png`), createTrayIconPng(level, 32, util));
}

fs.writeFileSync(path.join(assetsDir, 'tray-icon.png'), createTrayIconPng('green', 16, 24));
fs.writeFileSync(path.join(assetsDir, 'tray-icon@2x.png'), createTrayIconPng('green', 32, 24));

console.log('Generated icon.png and tray icons in assets/');