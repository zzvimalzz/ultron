export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ENTITIES[c]);

// Delegated listener: survives innerHTML re-renders of `root`'s children.
export function on(root, event, selector, handler) {
  root.addEventListener(event, e => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(target, e);
  });
}

export const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
