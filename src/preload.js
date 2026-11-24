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
  onLive: fn => ipcRenderer.on('live', () => fn()),
});
