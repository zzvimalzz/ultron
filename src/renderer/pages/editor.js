import { $, esc } from '../lib/dom.js';
import { ACCESSORIES, COLORS, EYES, colorHex, mascotSVG } from '../lib/mascots.js';
import { ICONS, openModal, toast } from '../lib/ui.js';
import { api, state, accountById, saveConfig } from '../lib/state.js';

let onSaved = () => {};
export const setEditorListener = fn => { onSaved = fn; };

const field = (id, label, value, extra = '') =>
  `<div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" value="${esc(value)}" spellcheck="false" ${extra}></div>`;

const folderField = (id, label, value) =>
  `<div class="field"><label for="${id}">${label}</label><div class="input-row"><input class="input" id="${id}" value="${esc(value)}" spellcheck="false">`
  + `<button class="btn" data-pick="${id}">${ICONS.folder}Browse</button></div></div>`;

function view(draft, isNew) {
  const choice = (list, key, preview) => `<div class="chips">${list.map(x => `<button class="chip ${draft.mascot[key] === x.id ? 'on' : ''}" data-${key}="${x.id}">`
    + `${mascotSVG(preview(x.id), 30)}${x.label}</button>`).join('')}</div>`;
  const hex = colorHex(draft.color);
  return `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${isNew ? 'Add account' : 'Customize account'}">
      <div class="modal-head">
        <h2>${isNew ? 'Add account' : 'Customize account'}</h2>
        <button class="icon-btn" data-close aria-label="Close">${ICONS.close}</button>
      </div>
      <div class="modal-body">
        <div>
          <div class="preview" style="--account:${hex}">
            ${mascotSVG(draft, 132)}<div class="pname">${esc(draft.name)}</div>
          </div>
          <div class="field" style="margin-top:14px"><label>Colour</label>
            <div class="swatches">${COLORS.map((c, i) => `<button class="swatch ${draft.color === i + 1 ? 'on' : ''}" data-color="${i + 1}" aria-label="${c.name}" style="background:${c.hex}"></button>`).join('')}</div>
          </div>
        </div>
        <div>
          ${isNew ? `<div class="field"><label>Service</label><div class="seg" data-provider>${['claude', 'chatgpt'].map(p => `<button class="${draft.provider === p ? 'on' : ''}" data-provider-value="${p}">${p === 'claude' ? 'Claude' : 'ChatGPT'}</button>`).join('')}</div></div>` : ''}
          ${field('fName', 'Name', draft.name, 'maxlength="32"')}
          ${field('fSub', 'Label', draft.subtitle, 'maxlength="40" placeholder="Optional"')}
          <div class="field"><label>Accessory</label>${choice(ACCESSORIES, 'accessory', id => ({ ...draft, mascot: { ...draft.mascot, accessory: id } }))}</div>
          <div class="field"><label>Eyes</label>${choice(EYES, 'eyes', id => ({ ...draft, mascot: { accessory: 'none', eyes: id } }))}</div>
          <details class="adv" ${isNew ? 'open' : ''}>
            <summary>Advanced</summary>
            ${draft.provider === 'claude' ? field('fArgs', 'Desktop app arguments', draft.args, 'placeholder="--user-data-dir=&quot;…&quot;"') : ''}
            ${folderField('fData', 'Profile folder', draft.dataDir)}
            ${folderField('fHome', draft.provider === 'claude' ? 'CLI config folder' : 'Codex home folder', draft.cliHome)}
          </details>
        </div>
      </div>
      <div class="modal-foot">
        ${!isNew && state.config.accounts.length > 1 ? '<button class="btn ghost danger" data-remove>Remove</button>' : ''}
        <span class="spacer"></span>
        <button class="btn" data-close>Cancel</button>
        <button class="btn primary" data-save>${isNew ? 'Add account' : 'Save'}</button>
      </div>
    </div>`;
}

export async function openEditor(id) {
  const isNew = !id;
  let draft = isNew ? await api.blankAccount('claude') : structuredClone(accountById(id));
  const modal = $('#modal');

  const readFields = () => {
    const val = sel => ($(sel, modal) ? $(sel, modal).value.trim() : undefined);
    draft.name = val('#fName') || draft.name;
    draft.subtitle = val('#fSub') ?? draft.subtitle;
    draft.args = val('#fArgs') ?? draft.args;
    draft.dataDir = val('#fData') ?? draft.dataDir;
    draft.cliHome = val('#fHome') ?? draft.cliHome;
    const custom = /--user-data-dir=("?)([^"]+)\1/.exec(draft.args || '');
    if (custom && !draft.dataDir) draft.dataDir = custom[2];
  };
  const redraw = () => { readFields(); modal.innerHTML = view(draft, isNew); };

  const close = openModal(view(draft, isNew));
  modal.onclick = async e => {
    const t = e.target.closest('button') || e.target;
    if (e.target === modal || t.closest('[data-close]')) return close();
    if (t.dataset.color) { draft.color = Number(t.dataset.color); return redraw(); }
    if (t.dataset.accessory) { draft.mascot.accessory = t.dataset.accessory; return redraw(); }
    if (t.dataset.eyes) { draft.mascot.eyes = t.dataset.eyes; return redraw(); }
    if (t.dataset.providerValue) {
      draft = await api.blankAccount(t.dataset.providerValue);
      modal.innerHTML = view(draft, isNew);
      return;
    }
    if (t.dataset.pick) {
      const folder = await api.pickFolder();
      if (folder) $(`#${t.dataset.pick}`, modal).value = folder;
      return;
    }
    if (t.matches('[data-save]')) {
      readFields();
      const accounts = isNew ? [...state.config.accounts, draft] : state.config.accounts.map(a => (a.id === draft.id ? draft : a));
      await saveConfig({ accounts });
      close();
      toast(isNew ? `${draft.name} added` : 'Saved', { icon: mascotSVG(draft, 22) });
      onSaved();
      return;
    }
    if (t.matches('[data-remove]')) {
      if (t.dataset.confirm !== '1') { t.dataset.confirm = '1'; t.textContent = 'Click again to remove'; return; }
      await saveConfig({ accounts: state.config.accounts.filter(a => a.id !== draft.id) });
      close();
      toast(`${draft.name} removed`);
      onSaved();
    }
  };
  modal.oninput = e => { if (e.target.id === 'fName') $('.pname', modal).textContent = e.target.value || draft.name; };
  setTimeout(() => $('#fName', modal)?.focus(), 30);
}
