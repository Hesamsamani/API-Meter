const os = require('os');
const path = require('path');

function claudeCredentialsPath() {
  return path.join(os.homedir(), '.claude', '.credentials.json');
}

function grokAuthPath() {
  return path.join(os.homedir(), '.grok', 'auth.json');
}

function geminiTmpPath() {
  return path.join(os.homedir(), '.gemini', 'tmp');
}

function cursorStateDbPath() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  return path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

module.exports = { claudeCredentialsPath, grokAuthPath, geminiTmpPath, cursorStateDbPath };