'use strict';
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_MS = 6 * 3600 * 1000;

// While the repository is private the check fails; that is logged in one line and otherwise ignored.
function createUpdater({ onReady }) {
  let ready = false;
  autoUpdater.logger = null;
  autoUpdater.on('update-downloaded', () => { ready = true; onReady(); });
  autoUpdater.on('error', err => console.error('Update check failed:', err.message.split(/\r?\n/)[0]));

  async function check() {
    if (!app.isPackaged) return 'dev';
    if (ready) return 'ready';
    try {
      const result = await autoUpdater.checkForUpdatesAndNotify();
      return result?.isUpdateAvailable ? 'available' : 'current';
    } catch {
      return 'error';
    }
  }

  return {
    start() { check(); setInterval(check, CHECK_MS); },
    check,
    ready: () => ready,
    install: () => autoUpdater.quitAndInstall(),
  };
}

module.exports = { createUpdater };
