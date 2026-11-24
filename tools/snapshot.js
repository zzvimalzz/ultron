'use strict';
// Drives the real app and saves screenshots plus DOM probes for visual checks.
// Usage: npm run snapshot -- <out-dir> <steps.json> [user-data-dir]
// steps.json: [{ "name": "accounts", "js": "...", "wait": 1500 }] - `js` runs in the page; its result is saved.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const [outDir, stepsFile, userData] = process.argv.slice(2).filter(a => !a.startsWith('--') && !a.endsWith('snapshot.js'));
if (userData) app.setPath('userData', path.resolve(userData));
const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
const wait = ms => new Promise(r => setTimeout(r, ms));

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', e => { if (e.level === 'error' || e.level === 'warning') console.log(`[renderer ${e.level}]`, e.message); });
  win.webContents.once('did-finish-load', async () => {
    const results = {};
    await wait(2500);
    for (const step of steps) {
      try { results[step.name] = step.js ? await win.webContents.executeJavaScript(step.js) : null; } catch (err) { results[step.name] = `ERROR ${err.message}`; }
      await wait(step.wait ?? 1200);
      if (step.shot !== false) fs.writeFileSync(path.join(outDir, `${step.name}.png`), (await win.webContents.capturePage()).toPNG());
    }
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
    app.quit();
  });
});

fs.mkdirSync(outDir, { recursive: true });
require('../src/main/index.js');
