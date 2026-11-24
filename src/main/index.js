'use strict';
const path = require('path');
const { app, BrowserWindow, ipcMain, nativeTheme, shell, dialog } = require('electron');
const { createStore, blankAccount } = require('./config');
const { resolveDataDir, isRunning, lastActivityAt } = require('./profiles');
const { PROVIDERS, isInstalled, availableTargets, openAccount } = require('./targets');
const { createUsage } = require('./usage');

const LIVE_INTERVAL_MS = 4000;
const WORKING_MS = 60000;
const THEME = { dark: { bg: '#111110', fg: '#c9c8c2' }, light: { bg: '#f6f5f2', fg: '#3b3a37' } };

app.setAppUserModelId('app.ultron.launcher');
if (!app.requestSingleInstanceLock()) app.exit(0);

let win;
let store;
let usage;

const usageAccounts = () => store.get().accounts.map(a => ({ ...a, realDataDir: resolveDataDir(a.dataDir) }));

function themeColors() {
  const { theme } = store.get();
  const dark = theme === 'dark' || (theme !== 'light' && nativeTheme.shouldUseDarkColors);
  return THEME[dark ? 'dark' : 'light'];
}

function applyTheme() {
  nativeTheme.themeSource = store.get().theme || 'system';
  if (!win) return;
  const c = themeColors();
  win.setBackgroundColor(c.bg);
  win.setTitleBarOverlay({ color: c.bg, symbolColor: c.fg, height: 44 });
}

function createWindow() {
  const c = themeColors();
  win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 940, minHeight: 640,
    title: 'Ultron',
    backgroundColor: c.bg,
    show: false,
    icon: path.join(__dirname, '..', '..', 'build', 'ultron.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: c.bg, symbolColor: c.fg, height: 44 },
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

async function overview() {
  const accounts = usageAccounts();
  const day = usage.ready() ? await usage.query(accounts, { range: '24h' }) : null;
  return Object.fromEntries(accounts.map(a => {
    const running = isRunning(a.dataDir);
    const used = day && (day.perAccount[a.id] || { total: 0, activeMs: 0 });
    const lastWork = day ? day.lastActivity[a.id] || 0 : 0;
    const working = Date.now() - lastWork < WORKING_MS;
    const lastOpened = running ? Date.now() : Math.max(a.lastOpened || 0, lastActivityAt(a.dataDir), lastWork);
    return [a.id, { running, working, lastOpened, tokens: used?.total, activeMs: used?.activeMs }];
  }));
}

// Short polling: lockfile checks are cheap and transcript reads are incremental, so a fixed tick
// is simpler and more dependable than recursive file watchers on Windows.
function startLiveUpdates() {
  let lastStatus = '';
  const tick = async () => {
    const changed = await usage.refresh(usageAccounts());
    const status = Object.values(await overview()).map(o => `${o.running}${o.working}`).join();
    if ((changed || status !== lastStatus) && win && !win.isDestroyed()) win.webContents.send('live');
    lastStatus = status;
    setTimeout(tick, LIVE_INTERVAL_MS);
  };
  tick();
}

function registerIpc() {
  ipcMain.handle('config:get', () => store.get());
  ipcMain.handle('config:update', (_e, patch) => {
    const config = store.update(patch);
    applyTheme();
    return config;
  });
  ipcMain.handle('accounts:overview', overview);
  ipcMain.handle('accounts:targets', (_e, provider) => availableTargets(provider));
  ipcMain.handle('accounts:blank', (_e, provider, ownProfile) => blankAccount(provider, store.get().accounts, ownProfile));
  ipcMain.handle('accounts:downloadUrl', (_e, provider) => (isInstalled(provider) ? null : PROVIDERS[provider].download));
  ipcMain.handle('accounts:open', async (_e, id, targetId) => {
    const account = store.get().accounts.find(a => a.id === id);
    const used = await openAccount(account, targetId || account.openWith);
    store.updateAccount(id, { openWith: used, lastOpened: Date.now() });
    if (store.get().closeOnLaunch) setTimeout(() => win.minimize(), 400);
    return used;
  });
  ipcMain.handle('usage:query', (_e, options) => usage.query(usageAccounts(), options));
  ipcMain.handle('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), userData: app.getPath('userData') }));
  ipcMain.handle('app:openPath', (_e, p) => shell.openPath(p));
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  store = createStore(path.join(app.getPath('userData'), 'config.json'));
  await store.load();
  usage = createUsage(path.join(app.getPath('userData'), 'usage-cache.json'));
  nativeTheme.themeSource = store.get().theme || 'system';
  nativeTheme.on('updated', applyTheme);
  registerIpc();
  createWindow();
  startLiveUpdates();
});

app.on('window-all-closed', () => app.quit());
