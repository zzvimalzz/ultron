'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = channel => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('ultron', {
  getConfig: invoke('config:get'),
  updateConfig: invoke('config:update'),
  overview: invoke('accounts:overview'),
  targets: invoke('accounts:targets'),
  blankAccount: invoke('accounts:blank'),
  downloadUrl: invoke('accounts:downloadUrl'),
  open: invoke('accounts:open'),
  usage: invoke('usage:query'),
  pickFolder: invoke('dialog:pickFolder'),
  info: invoke('app:info'),
  openPath: invoke('app:openPath'),
  onLive: fn => ipcRenderer.on('live', () => fn()),
});
