'use strict';
const os = require('os');
const path = require('path');
const { app, BrowserWindow, Notification, ipcMain, nativeTheme, shell, dialog } = require('electron');
const { createStore, blankAccount } = require('./config');
const { resolveDataDir, isRunning, profileReady, lastActivityAt } = require('./profiles');
const { installs, availableTargets, openAccount, signIn } = require('./targets');
const { signedIn } = require('../hub/cli');
const { createUsage } = require('./usage');
const { connectAgents } = require('./agents');
const crew = require('./crew');
const { createDetection } = require('./detect');
const { ROLES } = require('../hub/roles');
const memory = require('../hub/memory');
const { MEMORY_DIR, recentEvents } = require('../hub/files');
const { createCurator } = require('./curator');
const { createTasks } = require('./tasks');
const checkpoint = require('../hub/checkpoint');
const hubTasks = require('../hub/tasks');

const LIVE_INTERVAL_MS = 4000;
const MICA = process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22000;
const CLEAR = '#00000000';
const windowBg = c => (MICA ? CLEAR : c.bg);
const THEME = { dark: { bg: '#111110', fg: '#c9c8c2' }, light: { bg: '#f6f5f2', fg: '#3b3a37' } };

app.setAppUserModelId('app.ultron.launcher');
if (!app.requestSingleInstanceLock()) app.exit(0);

let win;
let store;
let usage;
let detection;
let curator;
let tasks;

const vaultDir = () => store.get().memory.dir || MEMORY_DIR;
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
  win.setBackgroundColor(windowBg(c));
  win.setTitleBarOverlay({ color: windowBg(c), symbolColor: c.fg, height: 44 });
}

function createWindow() {
  const c = themeColors();
  win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 940, minHeight: 640,
    title: 'Ultron',
    backgroundColor: windowBg(c),
    ...(MICA ? { backgroundMaterial: 'mica' } : {}),
    show: false,
    icon: path.join(__dirname, '..', '..', 'build', 'ultron.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: windowBg(c), symbolColor: c.fg, height: 44 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true,
      additionalArguments: MICA ? ['--mica'] : [],
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

async function overview() {
  const accounts = usageAccounts();
  const day = usage.ready() ? await usage.query(accounts, { range: '24h' }) : null;
  const sessions = usage.sessions(accounts);
  return Object.fromEntries(accounts.map(a => {
    const running = isRunning(a.dataDir);
    const used = day && (day.perAccount[a.id] || { total: 0, activeMs: 0 });
    const working = sessions.some(s => s.account === a.id && s.working);
    const lastOpened = running ? Date.now() : Math.max(a.lastOpened || 0, lastActivityAt(a.dataDir), day ? day.lastActivity[a.id] || 0 : 0);
    const detected = detection.tierOf(a);
    return [a.id, {
      running, working, lastOpened, signedIn: signedIn(a), tokens: used?.total, activeMs: used?.activeMs,
      plan: detection.planOf(a), tier: crew.effectiveTier(a, detected), eligible: crew.eligible(a, detected),
      answered: detected === 'unknown' && Boolean(a.planAnswer), detecting: detection.detecting(a.id), checkedAt: detection.checkedAt(a),
    }];
  }));
}

// Short polling: lockfile checks are cheap and transcript reads are incremental, so a fixed tick
// is simpler and more dependable than recursive file watchers on Windows.
function startLiveUpdates() {
  let lastStatus = '';
  const tick = async () => {
    const accounts = usageAccounts();
    detection.watchSignIn(accounts);
    const changed = await usage.refresh(accounts);
    const view = await overview();
    if (store.get().crew.connected || tasks.active()) crew.publish(store.get(), view, usage.sessions(accounts));
    const status = `${Object.values(view).map(o => `${o.running}${o.working}${o.tier}${o.detecting}`).join()}|${crew.eventsSize()}|${tasks.poll()}`;
    if ((changed || status !== lastStatus) && win && !win.isDestroyed()) win.webContents.send('live');
    lastStatus = status;
    setTimeout(tick, LIVE_INTERVAL_MS);
  };
  tick();
}

function askedByTask(question, task) {
  const note = new Notification({ title: 'Ultron needs you', body: `${task.title}: ${question.text}`.slice(0, 200) });
  note.on('click', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    win.webContents.send('goto', 'ultron');
  });
  note.show();
}

function registerIpc() {
  ipcMain.handle('config:get', () => store.get());
  ipcMain.handle('config:update', (_e, patch) => {
    const config = store.update(patch);
    applyTheme();
    return config;
  });
  ipcMain.handle('accounts:overview', overview);
  const accountOf = id => store.get().accounts.find(a => a.id === id);
  ipcMain.handle('accounts:targets', (_e, id) => availableTargets(accountOf(id), store.get().accounts));
  ipcMain.handle('accounts:blank', (_e, provider, ownProfile) => blankAccount(provider, store.get().accounts, ownProfile));
  ipcMain.handle('accounts:update', (_e, id, patch) => store.updateAccount(id, patch));
  ipcMain.handle('accounts:detect', async id => { await detection.refreshOne(id); return overview(); });
  ipcMain.handle('accounts:models', (_e, id) => detection.models(id));
  ipcMain.handle('accounts:installs', installs);
  ipcMain.handle('accounts:signIn', (_e, id, part) => signIn(accountOf(id), part, store.get().accounts));
  ipcMain.handle('accounts:status', (_e, id) => {
    const account = accountOf(id);
    return { cli: signedIn(account), desktop: profileReady(account.dataDir) };
  });
  ipcMain.handle('accounts:open', async (_e, id, targetId) => {
    const account = accountOf(id);
    const used = await openAccount(account, targetId || account.openWith, store.get().accounts);
    store.updateAccount(id, { openWith: used, lastOpened: Date.now() });
    if (store.get().closeOnLaunch) setTimeout(() => win.minimize(), 400);
    return used;
  });
  ipcMain.handle('crew:map', async () => ({ ...crew.crewMap(store.get(), await overview(), usage.sessions(usageAccounts())), runs: hubTasks.runningRunsByAccount() }));
  ipcMain.handle('crew:connect', (_e, connected) => {
    connectAgents(store.get().accounts, connected, vaultDir());
    return store.update({ crew: { ...store.get().crew, connected } });
  });
  ipcMain.handle('memory:setDir', (_e, dir) => {
    const config = store.update({ memory: { ...store.get().memory, dir } });
    const created = memory.ensureVault(vaultDir());
    if (config.crew.connected) connectAgents(config.accounts, true, vaultDir());
    return created;
  });
  ipcMain.handle('memory:search', (_e, query) => memory.recall(vaultDir(), query, ''));
  ipcMain.handle('memory:pending', () => ({ ...memory.pending(vaultDir()), reviewed: memory.lastReviewed(vaultDir()) }));
  ipcMain.handle('memory:confirm', (_e, item) => memory.confirm(vaultDir(), item));
  ipcMain.handle('memory:reject', (_e, item) => memory.reject(vaultDir(), item));
  ipcMain.handle('memory:keep', (_e, item, section) => memory.keep(vaultDir(), item, section));
  ipcMain.handle('memory:drop', (_e, item) => memory.drop(vaultDir(), item));
  ipcMain.handle('memory:recent', () => recentEvents(Date.now() - 7 * 24 * 3600 * 1000).filter(e => e.type === 'memory').slice(-40).reverse());
  for (const name of ['start', 'stop', 'list', 'get', 'undo', 'terminal']) ipcMain.handle(`tasks:${name}`, (_e, ...args) => tasks[name](...args));
  ipcMain.handle('tasks:answer', (_e, ...args) => tasks.answerUser(...args));
  ipcMain.handle('usage:query', (_e, options) => usage.query(usageAccounts(), options));
  ipcMain.handle('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), userData: app.getPath('userData'), roles: ROLES, sections: memory.MEMORY_SECTIONS, git: checkpoint.available() }));
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
  detection = createDetection({ store, version: app.getVersion(), onReset: account => win?.webContents.send('toast', `${account.name}: model reset to default`), onChange: () => { if (win && !win.isDestroyed()) win.webContents.send('live'); } });
  nativeTheme.themeSource = store.get().theme || 'system';
  nativeTheme.on('updated', applyTheme);
  // Re-registering keeps the hub's path right after Ultron moves or updates.
  if (store.get().crew.connected) {
    try { connectAgents(store.get().accounts, true, vaultDir()); } catch (err) { console.error('Connecting agents failed:', err.message); }
  }
  memory.ensureVault(vaultDir());
  curator = createCurator({
    store, usage, vault: vaultDir, accounts: usageAccounts, eligible: id => { const a = store.get().accounts.find(x => x.id === id); return crew.eligible(a, detection.tierOf(a)); },
    onChange: () => { if (win && !win.isDestroyed()) win.webContents.send('live'); },
  });
  curator.start();
  tasks = createTasks({
    store, isEligible: a => crew.eligible(a, detection.tierOf(a)),
    publishCrew: async () => crew.publish(store.get(), await overview(), usage.sessions(usageAccounts())),
    onQuestion: askedByTask,
  });
  tasks.sweep();
  registerIpc();
  createWindow();
  win.once('ready-to-show', detection.start);
  startLiveUpdates();
});

app.on('window-all-closed', () => app.quit());
