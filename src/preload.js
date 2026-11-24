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
  detect: invoke('accounts:detect'),
  models: invoke('accounts:models'),
  installs: invoke('accounts:installs'),
  signIn: invoke('accounts:signIn'),
  accountStatus: invoke('accounts:status'),
  open: invoke('accounts:open'),
  usage: invoke('usage:query'),
  crewMap: invoke('crew:map'),
  connectAgents: invoke('crew:connect'),
  pickFolder: invoke('dialog:pickFolder'),
  info: invoke('app:info'),
  openPath: invoke('app:openPath'),
  tasks: Object.fromEntries(['start', 'stop', 'list', 'get', 'answer', 'undo', 'terminal'].map(name => [name, invoke(`tasks:${name}`)])),
  memory: Object.fromEntries(['setDir', 'search', 'pending', 'confirm', 'reject', 'keep', 'drop', 'recent'].map(name => [name, invoke(`memory:${name}`)])),
  onToast: fn => ipcRenderer.on('toast', (_e, text) => fn(text)),
  onGoto: fn => ipcRenderer.on('goto', (_e, page) => fn(page)),
  onLive: fn => ipcRenderer.on('live', () => fn()),
});
