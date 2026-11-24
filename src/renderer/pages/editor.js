import { $, esc, on } from '../lib/dom.js';
import { ACCESSORIES, COLORS, EYES, colorHex, mascotSVG } from '../lib/mascots.js';
import { ICONS, button, chip, closeDrawer, errorText, onSegment, onSelect, onToggle, openDrawer, openModal, segmented, select, skeleton, tip, toast, toggle, updateDrawer } from '../lib/ui.js';
import { planBadge, planChoices } from '../lib/plan.js';
import { ago } from '../lib/format.js';
import { api, state, accountById, loadModels, loadTargets, saveConfig } from '../lib/state.js';

let onSaved = () => {};
export const setEditorListener = fn => { onSaved = fn; };

const field = (name, label, value, extra = '') =>
  `<div class="field"><label>${label}</label><input class="input" data-field="${name}" value="${esc(value)}" spellcheck="false" aria-label="${label}" ${extra}></div>`;

const folderField = (name, label, value) =>
  `<div class="field"><label>${label}</label><div class="input-row"><input class="input" data-field="${name}" value="${esc(value)}" spellcheck="false" aria-label="${label}">`
  + `${button('Browse', { icon: ICONS.folder, attrs: `data-pick="${name}"` })}</div></div>`;

// The look is the preview and colours; the fields are the text and mascot choices.
function appearance(draft) {
  const picks = (list, key, preview) => `<div class="picks">${list.map(x => `<button class="pick ${draft.mascot[key] === x.id ? 'on' : ''}" data-${key}="${x.id}">`
    + `${mascotSVG(preview(x.id), 30)}${x.label}</button>`).join('')}</div>`;
  return {
    look: `<div class="preview" style="--account:${colorHex(draft.color)}">${mascotSVG(draft, 104)}</div>`
      + `<div class="swatches">${COLORS.map((c, i) => `<button class="swatch ${draft.color === i + 1 ? 'on' : ''}" data-color="${i + 1}" aria-label="${c.name}" style="background:${c.hex}"></button>`).join('')}</div>`,
    fields: `${field('name', 'Name', draft.name, 'maxlength="32"')}${field('subtitle', 'Label', draft.subtitle, 'maxlength="40" placeholder="Optional"')}`
      + `<div class="field"><label>Accessory</label>${picks(ACCESSORIES, 'accessory', id => ({ ...draft, mascot: { ...draft.mascot, accessory: id } }))}</div>`
      + `<div class="field"><label>Eyes</label>${picks(EYES, 'eyes', id => ({ ...draft, mascot: { accessory: 'none', eyes: id } }))}</div>`,
  };
}

const advanced = draft => `<details class="adv"><summary class="cap">Advanced</summary>`
  + `${draft.provider === 'claude' ? field('args', 'Desktop app arguments', draft.args, 'placeholder="--user-data-dir=&quot;…&quot;"') : ''}`
  + `${folderField('dataDir', 'Profile folder', draft.dataDir)}`
  + `${folderField('cliHome', draft.provider === 'claude' ? 'CLI config folder' : 'Codex home folder', draft.cliHome)}</details>`;

const withProfileFolder = account => {
  const custom = /--user-data-dir=("?)([^"]+)\1/.exec(account.args || '');
  return custom && !account.dataDir ? { ...account, dataDir: custom[2] } : account;
};

let editingId = null;

function planSection(account) {
  const live = state.overview[account.id] || {};
  if (live.signedIn === false) return '';
  const asking = live.tier === 'unknown' || live.answered;
  return `<div class="dsec"><span class="cap">Plan</span><div class="plan-row">${planBadge(live)}`
    + `<span class="when">${live.checkedAt ? `Checked ${ago(live.checkedAt)}` : ''}</span>`
    + `${button('Check again', { kind: 'sm', attrs: `data-detect ${live.detecting ? 'disabled' : ''}` })}</div>`
    + `${asking ? `<div class="picks plans">${planChoices.map(([tier, label]) => `<button class="pick ${account.planAnswer === tier ? 'on' : ''}" data-plan-answer="${tier}">${label}</button>`).join('')}</div>` : ''}</div>`;
}

const section = (title, html) => `<div class="dsec"><span class="cap">${title}</span>${html}</div>`;

// Model and effort come from the account's own CLI; until the list arrives a skeleton stands in.
function modelSections(account) {
  if (state.overview[account.id]?.signedIn === false) return section('Model', button('Sign in', { kind: 'primary', attrs: 'data-sign-in' }));
  const models = state.models[account.id];
  if (!models) return section('Model', skeleton('100%', '34px'));
  if (!models.length) return '';
  const efforts = models.find(m => m.id === account.model)?.efforts || [];
  return section('Model', select('model', models.map(m => ({ value: m.id, label: m.label, hint: m.description })), account.model))
    + (efforts.length ? section('Effort', segmented('effort', [{ value: '', label: 'Default' }, ...efforts.map(e => ({ value: e, label: e }))], account.effort)) : '');
}

function ultronSection(account) {
  const tier = state.overview[account.id]?.tier;
  const locked = tier === 'free' ? 'Free plan' : tier === 'unknown' ? 'Plan unknown' : '';
  return section('Ultron', `<div class="row"><span class="grow">In crew</span>${toggle('inCrew', account.inCrew && !locked, 'In crew', locked)}</div>`
    + `<div class="row"><span class="grow">Parallel runs</span><span class="stepper">`
    + `<button class="icon-btn" data-runs="-1" aria-label="Fewer parallel runs" ${account.maxRuns <= 1 ? 'disabled' : ''}>−</button><b>${account.maxRuns}</b>`
    + `<button class="icon-btn" data-runs="1" aria-label="More parallel runs" ${account.maxRuns >= 4 ? 'disabled' : ''}>+</button></span></div>`);
}

const openWithSection = account => section('Open with', `<div class="radios" role="radiogroup">${(state.targets[account.id] || []).map(t =>
  `<button class="radio" role="radio" aria-checked="${t.id === account.openWith}" data-target="${t.id}"${t.locked ? ` disabled data-tip="${tip(t.locked)}"` : ''}><i></i>${esc(t.label)}</button>`).join('')}</div>`);

const crewSections = account => planSection(account)
  + modelSections(account)
  + section('Roles', `<div class="chips">${state.info.roles.map(r => chip(r.label, { on: account.roles.includes(r.id), attrs: `data-role="${r.id}"` })).join('')}</div>`)
  + ultronSection(account);

function drawerBody(account) {
  const look = appearance(account);
  const launchOnly = state.overview[account.id]?.launchOnly;
  return (launchOnly ? '' : crewSections(account))
    + openWithSection(account)
    + `<div class="dsec"><span class="cap">Appearance</span>${look.look}${look.fields}</div>`
    + (launchOnly ? '' : `<div class="dsec">${advanced(account)}</div>`)
    + (state.config.accounts.length > 1 ? `<div class="dsec">${button('Remove account', { kind: 'ghost danger', attrs: 'data-remove' })}</div>` : '');
}

const drawerLead = account => `<span class="mini" style="--account:${colorHex(account.color)}">${mascotSVG(account, 24)}</span>`;

let savedShown = false;
const saved = () => { if (!savedShown) { savedShown = true; toast('Saved'); } };

async function commit(patch) {
  const account = withProfileFolder({ ...accountById(editingId), ...patch });
  await saveConfig({ accounts: state.config.accounts.map(a => (a.id === account.id ? account : a)) });
  updateDrawer(drawerBody(account), { title: account.name, lead: drawerLead(account) });
  saved();
  onSaved();
}

async function editAccount(id) {
  const account = accountById(id);
  await loadTargets([account]);
  editingId = id;
  savedShown = false;
  openDrawer(drawerBody(account), { title: account.name, lead: drawerLead(account), onClose: () => { editingId = null; } });
  if (!state.models[id] && state.overview[id]?.signedIn !== false) {
    await loadModels(id);
    if (editingId === id) updateDrawer(drawerBody(accountById(id)));
  }
}

export function mount() {
  const drawer = $('#drawer');
  on(drawer, 'change', '[data-field]', input => {
    const value = input.value.trim();
    if (input.dataset.field === 'name' && !value) { input.value = accountById(editingId).name; return; }
    commit({ [input.dataset.field]: value });
  });
  on(drawer, 'click', '[data-color]', btn => commit({ color: Number(btn.dataset.color) }));
  on(drawer, 'click', '[data-accessory]', btn => commit({ mascot: { ...accountById(editingId).mascot, accessory: btn.dataset.accessory } }));
  on(drawer, 'click', '[data-eyes]', btn => commit({ mascot: { ...accountById(editingId).mascot, eyes: btn.dataset.eyes } }));
  on(drawer, 'click', '[data-pick]', async btn => {
    const folder = await api.pickFolder();
    if (folder) commit({ [btn.dataset.pick]: folder });
  });
  on(drawer, 'click', '[data-detect]', async () => {
    state.overview = await api.detect(editingId);
    await loadModels(editingId);
    state.config = await api.getConfig();
    updateDrawer(drawerBody(accountById(editingId)));
    onSaved();
  });
  on(drawer, 'click', '[data-plan-answer]', async btn => {
    await commit({ planAnswer: btn.dataset.planAnswer });
    state.overview = await api.overview();
    updateDrawer(drawerBody(accountById(editingId)));
  });
  on(drawer, 'click', '[data-sign-in]', async () => {
    try { await api.signIn(editingId, 'cli'); } catch (err) { toast(errorText(err), { kind: 'error' }); }
  });
  onSelect(drawer, 'model', model => {
    const efforts = state.models[editingId].find(m => m.id === model).efforts;
    commit({ model, effort: efforts.includes(accountById(editingId).effort) ? accountById(editingId).effort : '' });
  });
  onSegment(drawer, 'effort', effort => commit({ effort }));
  on(drawer, 'click', '[data-role]', btn => {
    const { roles } = accountById(editingId);
    const id = btn.dataset.role;
    commit({ roles: roles.includes(id) ? roles.filter(r => r !== id) : [...roles, id] });
  });
  onToggle(drawer, 'inCrew', inCrew => commit({ inCrew }));
  on(drawer, 'click', '[data-runs]', btn => commit({ maxRuns: Math.min(4, Math.max(1, accountById(editingId).maxRuns + Number(btn.dataset.runs))) }));
  on(drawer, 'click', '[data-target]', btn => commit({ openWith: btn.dataset.target }));
  on(drawer, 'click', '[data-remove]', async btn => {
    if (btn.dataset.confirm !== '1') { btn.dataset.confirm = '1'; btn.textContent = 'Click again to remove'; return; }
    const { id, name } = accountById(editingId);
    closeDrawer();
    await saveConfig({ accounts: state.config.accounts.filter(a => a.id !== id) });
    toast(`${name} removed`);
    onSaved();
  });
}

const STEPS = ['Add account', 'Sign in', 'Make it yours'];
const POLL_MS = 3000;
const frame = html => `<div class="modal" role="dialog" aria-modal="true" aria-label="Add account">${html}</div>`;

function stepView(s) {
  const head = `<div class="modal-head"><h2>${STEPS[s.step]}</h2><span class="steps">${STEPS.map((_, i) => `<i class="${i <= s.step ? 'on' : ''}"></i>`).join('')}</span>`
    + `<button class="icon-btn" data-close aria-label="Close">${ICONS.close}</button></div>`;
  const nav = (back, next) => `<div class="modal-foot">${back ? button('Back', { kind: 'ghost', attrs: 'data-back' }) : ''}<span class="spacer"></span>`
    + `${button('Cancel', { attrs: 'data-close' })}${button(next, { kind: 'primary', attrs: 'data-next' })}</div>`;
  if (s.step === 0) {
    const tiles = Object.entries(s.installs).map(([provider, info]) => `<div class="tile-wrap"><button class="tile ${s.provider === provider ? 'on' : ''}" data-provider="${provider}">`
      + `${mascotSVG({ provider, color: info.color || 2 }, 56)}<span>${esc(info.label)}</span></button>`
      + `${info.launchOnly || info.desktop || info.cli ? '' : `<a class="tile-link" href="${esc(info.download)}" target="_blank">Download</a>`}</div>`).join('');
    return frame(`${head}<div class="modal-body"><div class="tiles">${tiles}</div></div>${nav(false, 'Next')}`);
  }
  if (s.step === 1) {
    const info = s.installs[s.draft.provider];
    if (info.launchOnly) {
      return frame(`${head}<div class="modal-body"><div class="lrow"><span class="logo">${ICONS.desktop}</span><span class="t">Web</span>`
        + `${button('Open', { kind: 'primary sm', attrs: 'data-sign-in="desktop"' })}</div></div>${nav(true, 'Next')}`);
    }
    const locked = !info.multiDesktop && state.config.accounts.some(a => a.provider === s.draft.provider && a.id !== s.draft.id);
    const row = (part, icon, label, { installed, signed, lockedReason }) => `<div class="lrow ${lockedReason ? 'locked' : ''}"${lockedReason ? ` data-tip="${tip(lockedReason)}"` : ''}>`
      + `<span class="logo">${icon}</span><span class="t">${label}</span>`
      + `${signed ? `<span class="check">${ICONS.check}</span>` : installed ? button('Sign in', { kind: 'primary sm', attrs: `data-sign-in="${part}" ${lockedReason ? 'disabled' : ''}` })
        : `<a class="btn sm" href="${esc(info.download)}" target="_blank">Install</a>`}</div>`;
    return frame(`${head}<div class="modal-body">`
      + `${row('desktop', ICONS.desktop, 'Desktop app', { installed: info.desktop, signed: s.status.desktop && !locked, lockedReason: locked ? `${info.label} Desktop holds one account` : null })}`
      + `${row('cli', ICONS.terminal, 'Terminal & VS Code', { installed: info.cli, signed: s.status.cli })}</div>${nav(true, 'Next')}`);
  }
  const look = appearance(s.draft);
  return frame(`${head}<div class="modal-body"><div class="add-look"><div class="stack">${look.look}</div><div class="stack">${look.fields}</div></div></div>${nav(true, 'Done')}`);
}

async function addAccount() {
  const s = { step: 0, provider: 'claude', draft: null, installs: await api.installs(), status: { cli: false, desktop: false } };
  const modal = $('#modal');
  let poll = null;
  const draw = () => { modal.innerHTML = stepView(s); };
  const readFields = () => {
    for (const input of modal.querySelectorAll('[data-field]')) {
      const value = input.value.trim();
      if (value || input.dataset.field !== 'name') s.draft[input.dataset.field] = value;
    }
  };
  const refreshStatus = async () => {
    const status = await api.accountStatus(s.draft.id);
    if (s.step === 1 && (status.cli !== s.status.cli || status.desktop !== s.status.desktop)) { s.status = status; draw(); }
  };
  const goTo = step => {
    clearInterval(poll);
    s.step = step;
    draw();
    if (step === 1) { refreshStatus(); poll = setInterval(refreshStatus, POLL_MS); }
  };
  // The account is saved when the sign-in step opens, so its CLI home exists for the login.
  const saveDraft = async () => {
    const old = s.draft;
    if (!old || old.provider !== s.provider) {
      s.draft = await api.blankAccount(s.provider);
      s.status = { cli: false, desktop: false };
    }
    await saveConfig({ accounts: [...state.config.accounts.filter(a => a.id !== old?.id), s.draft] });
    onSaved();
  };

  const closeModal = openModal(stepView(s));
  const close = () => { clearInterval(poll); closeModal(); };
  modal.onclick = async e => {
    const t = e.target.closest('button, a') || e.target;
    if (e.target === modal || t.closest('[data-close]')) return close();
    if (t.dataset.provider) { s.provider = t.dataset.provider; return draw(); }
    if (t.matches('[data-back]')) { if (s.step === 2) readFields(); return goTo(s.step - 1); }
    if (t.dataset.signIn) {
      try { await api.signIn(s.draft.id, t.dataset.signIn); } catch (err) { toast(errorText(err), { kind: 'error' }); }
      return;
    }
    if (t.dataset.color) { readFields(); s.draft.color = Number(t.dataset.color); return draw(); }
    if (t.dataset.accessory) { readFields(); s.draft.mascot = { ...s.draft.mascot, accessory: t.dataset.accessory }; return draw(); }
    if (t.dataset.eyes) { readFields(); s.draft.mascot = { ...s.draft.mascot, eyes: t.dataset.eyes }; return draw(); }
    if (!t.matches('[data-next]')) return;
    if (s.step === 0) { await saveDraft(); return goTo(1); }
    if (s.step === 1) return goTo(2);
    readFields();
    await saveConfig({ accounts: state.config.accounts.map(a => (a.id === s.draft.id ? s.draft : a)) });
    close();
    toast(`${s.draft.name} added`, { icon: mascotSVG(s.draft, 22) });
    onSaved();
  };
}

export const openEditor = id => (id ? editAccount(id) : addAccount());
