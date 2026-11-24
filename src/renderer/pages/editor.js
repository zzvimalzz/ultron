import { $, esc, on } from '../lib/dom.js';
import { ACCESSORIES, COLORS, EYES, colorHex, mascotSVG } from '../lib/mascots.js';
import { ICONS, button, closeDrawer, onSelect, openDrawer, openModal, segmented, select, toast, updateDrawer } from '../lib/ui.js';
import { api, state, accountById, saveConfig } from '../lib/state.js';

let onSaved = () => {};
export const setEditorListener = fn => { onSaved = fn; };

const PROVIDER_LABELS = { claude: 'Claude', chatgpt: 'ChatGPT' };
const ownProfile = draft => /--user-data-dir=/.test(draft.args || '');

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

async function pickInto(root, name) {
  const folder = await api.pickFolder();
  if (folder) $(`[data-field="${name}"]`, root).value = folder;
  return folder;
}

// ---- Edit: the account drawer saves each change as it is made ----

let editingId = null;

function drawerBody(account) {
  const look = appearance(account);
  const targets = (state.targets[account.provider] || []).map(t => ({ value: t.id, label: t.label }));
  return `<div class="dsec"><span class="cap">Appearance</span>${look.look}${look.fields}</div>`
    + `<div class="dsec"><span class="cap">Open with</span>${select('openWith', targets, account.openWith)}</div>`
    + `<div class="dsec">${advanced(account)}</div>`
    + (state.config.accounts.length > 1 ? `<div class="dsec">${button('Remove account', { kind: 'ghost danger', attrs: 'data-remove' })}</div>` : '');
}

const drawerLead = account => `<span class="mini" style="--account:${colorHex(account.color)}">${mascotSVG(account, 24)}</span>`;

async function commit(patch) {
  const account = withProfileFolder({ ...accountById(editingId), ...patch });
  await saveConfig({ accounts: state.config.accounts.map(a => (a.id === account.id ? account : a)) });
  updateDrawer(drawerBody(account), { title: account.name, lead: drawerLead(account) });
  onSaved();
}

async function editAccount(id) {
  const account = accountById(id);
  state.targets[account.provider] = await api.targets(account.provider);
  editingId = id;
  openDrawer(drawerBody(account), { title: account.name, lead: drawerLead(account), onClose: () => { editingId = null; } });
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
    const folder = await pickInto(drawer, btn.dataset.pick);
    if (folder) commit({ [btn.dataset.pick]: folder });
  });
  onSelect(drawer, 'openWith', value => commit({ openWith: value }));
  on(drawer, 'click', '[data-remove]', async btn => {
    if (btn.dataset.confirm !== '1') { btn.dataset.confirm = '1'; btn.textContent = 'Click again to remove'; return; }
    const { id, name } = accountById(editingId);
    closeDrawer();
    await saveConfig({ accounts: state.config.accounts.filter(a => a.id !== id) });
    toast(`${name} removed`);
    onSaved();
  });
}

// ---- Add: a modal until the sign-in stepper replaces it ----

function addView(draft, download) {
  const look = appearance(draft);
  const mine = ownProfile(draft);
  const providers = Object.entries(PROVIDER_LABELS).map(([value, label]) => ({ value, label }));
  const missing = download ? `<a class="btn" href="${esc(download)}" target="_blank">Download ${PROVIDER_LABELS[draft.provider]} Desktop</a>` : '';
  return `
    <div class="modal" role="dialog" aria-modal="true" aria-label="Add account">
      <div class="modal-head">
        <h2>Add account</h2>
        <button class="icon-btn" data-close aria-label="Close">${ICONS.close}</button>
      </div>
      <div class="modal-body stack">
        <div class="field"><label>Service</label>${segmented('provider', providers, draft.provider)}</div>
        ${draft.provider === 'claude' ? `<div class="field"><label>Sign-in</label>${segmented('profile', [{ value: 'own', label: 'New login' }, { value: 'shared', label: 'Current login' }], mine ? 'own' : 'shared')}</div>` : ''}
        ${missing}
        <div class="add-look"><div class="stack">${look.look}</div><div class="stack">${look.fields}</div></div>
        ${advanced(draft)}
      </div>
      <div class="modal-foot">
        <span class="spacer"></span>
        ${button('Cancel', { attrs: 'data-close' })}
        ${button('Add account', { kind: 'primary', attrs: 'data-save' })}
      </div>
    </div>`;
}

async function addAccount() {
  let draft = await api.blankAccount('claude');
  let download = await api.downloadUrl('claude');
  const modal = $('#modal');
  const draw = () => { modal.innerHTML = addView(draft, download); };

  const readFields = () => {
    for (const input of modal.querySelectorAll('[data-field]')) {
      const value = input.value.trim();
      if (value || input.dataset.field !== 'name') draft[input.dataset.field] = value;
    }
    draft = withProfileFolder(draft);
  };
  const redraw = () => { readFields(); draw(); };
  const replaceDraft = async (provider, own) => {
    readFields();
    const { name, subtitle, color, mascot } = draft;
    const fresh = await api.blankAccount(provider, own);
    draft = provider === draft.provider ? { ...fresh, name, subtitle, color, mascot } : fresh;
    download = await api.downloadUrl(provider);
    draw();
  };

  const close = openModal(addView(draft, download));
  modal.onclick = async e => {
    const t = e.target.closest('button') || e.target;
    if (e.target === modal || t.closest('[data-close]')) return close();
    const seg = t.closest('[data-seg]');
    if (seg?.dataset.seg === 'provider') return replaceDraft(t.dataset.value);
    if (seg?.dataset.seg === 'profile') return replaceDraft('claude', t.dataset.value === 'own');
    if (t.dataset.color) { draft.color = Number(t.dataset.color); return redraw(); }
    if (t.dataset.accessory) { draft.mascot.accessory = t.dataset.accessory; return redraw(); }
    if (t.dataset.eyes) { draft.mascot.eyes = t.dataset.eyes; return redraw(); }
    if (t.dataset.pick) { await pickInto(modal, t.dataset.pick); return; }
    if (t.matches('[data-save]')) {
      readFields();
      await saveConfig({ accounts: [...state.config.accounts, draft] });
      close();
      toast(`${draft.name} added`, { icon: mascotSVG(draft, 22) });
      onSaved(ownProfile(draft) ? draft.id : null);
    }
  };
  setTimeout(() => $('[data-field="name"]', modal)?.focus(), 30);
}

export const openEditor = id => (id ? editAccount(id) : addAccount());
