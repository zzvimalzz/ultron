'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = channel => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('ultron', {
  mica: process.argv.includes('--mica'),
  getConfig: invoke('config:get'),
  updateConfig: invoke('config:update'),
  overview: invoke('accounts:overview'),
  targets: invoke('accounts:targets'),
  blankAccount: invoke('accounts:blank'),
  updateAccount: invoke('accounts:update'),
  reorderAccounts: invoke('accounts:reorder'),
  detect: invoke('accounts:detect'),
  models: invoke('accounts:models'),
  installs: invoke('accounts:installs'),
  signIn: invoke('accounts:signIn'),
  accountStatus: invoke('accounts:status'),
  open: invoke('accounts:open'),
  usage: invoke('usage:query'),
  liveMap: invoke('live:map'),
  openSession: invoke('sessions:open'),
  setFullscreen: invoke('window:fullscreen'),
  connectAgents: invoke('crew:connect'),
  pickFolder: invoke('dialog:pickFolder'),
  info: invoke('app:info'),
  openPath: invoke('app:openPath'),
  setupApps: invoke('setup:apps'),
  runSetup: invoke('setup:run'),
  checkForUpdates: invoke('update:check'),
  installUpdate: invoke('update:install'),
  sync: Object.fromEntries(['status', 'save', 'now', 'remove'].map(name => [name, invoke(`sync:${name}`)])),
  memory: Object.fromEntries(['setDir', 'search', 'pending', 'confirm', 'reject', 'keep', 'drop', 'recent'].map(name => [name, invoke(`memory:${name}`)])),
  onToast: fn => ipcRenderer.on('toast', (_e, text) => fn(text)),
  onUpdateReady: fn => ipcRenderer.on('update-ready', () => fn()),
  onLive: fn => ipcRenderer.on('live', () => fn()),
});
