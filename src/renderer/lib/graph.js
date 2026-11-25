// A force-directed graph in SVG. Nodes keep their place between updates; new ones spawn beside their anchor and old ones fade out.
const SVG = 'http://www.w3.org/2000/svg';
const REPULSION = 11000;
const SPRING = 0.045;
const GRAVITY = 0.008;
const DAMPING = 0.82;
const MAX_SPEED = 30;
const GAP = 34;
const COOLING = 0.985;
const SETTLED = 0.01;
const LEAVE_MS = 400;
const FIT_PAD = 70;
const LABEL_ROOM = 44;
const ZOOM = [0.3, 2.5];
const DRAG_PX = 4;

const make = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  return el;
};

// update({ nodes, links }) takes nodes { id, r, near, pull, cls, style, tip, body } (`body` is SVG markup around the node's centre,
// `near` is the id it spawns beside, `tip` is HTML for the tooltip) and links { a, b, cls, style, len }. `onOpen(id)` runs when a node is clicked.
export function createGraph(host, onOpen) {
  const svg = make('svg', { class: 'graph' });
  const view = make('g');
  const linkLayer = make('g');
  const nodeLayer = make('g');
  view.append(linkLayer, nodeLayer);
  svg.append(view);
  host.append(svg);

  const nodes = new Map();
  const links = new Map();
  const cam = { x: 0, y: 0, k: 1 };
  let width = 1;
  let height = 1;
  let alpha = 0;
  let manual = false;
  let frame = 0;
  let drag = null;

  const retire = el => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), LEAVE_MS);
  };

  function sync(map, next, keyOf, build) {
    const keep = new Set(next.map(keyOf));
    for (const [key, item] of map) {
      if (!keep.has(key)) { retire(item.el); map.delete(key); }
    }
    for (const spec of next) build(map.get(keyOf(spec)), spec);
  }

  function setNode(known, spec) {
    let node = known;
    if (!node) {
      const anchor = nodes.get(spec.near);
      const angle = Math.random() * Math.PI * 2;
      const body = make('g', { class: 'gbody' });
      const el = make('g', { class: 'gnode', 'data-id': spec.id });
      el.append(body);
      nodeLayer.append(el);
      node = { x: (anchor?.x ?? 0) + Math.cos(angle) * 50, y: (anchor?.y ?? 0) + Math.sin(angle) * 50, vx: 0, vy: 0, el, body, html: '' };
      nodes.set(spec.id, node);
    }
    node.r = spec.r;
    node.pull = spec.pull ?? 1;
    node.el.setAttribute('class', `gnode ${spec.cls || ''}`);
    node.el.setAttribute('style', spec.style || '');
    if (spec.tip) node.el.setAttribute('data-tip', spec.tip); else node.el.removeAttribute('data-tip');
    if (node.html === spec.body) return;
    node.html = spec.body;
    node.body.innerHTML = spec.body;
  }

  function setLink(known, spec) {
    let link = known;
    if (!link) {
      link = { el: make('line') };
      linkLayer.append(link.el);
      links.set(`${spec.a}|${spec.b}`, link);
    }
    link.a = spec.a;
    link.b = spec.b;
    link.len = spec.len || 110;
    link.el.setAttribute('class', `glink ${spec.cls || ''}`);
    link.el.setAttribute('style', spec.style || '');
  }

  function forces() {
    const list = [...nodes.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.1;
        const room = a.r + b.r + GAP;
        const push = (REPULSION / (d * d) + (d < room ? (room - d) * 0.5 : 0)) * alpha;
        dx = (dx / d) * push;
        dy = (dy / d) * push;
        a.vx -= dx; a.vy -= dy; b.vx += dx; b.vy += dy;
      }
    }
    for (const link of links.values()) {
      const a = nodes.get(link.a);
      const b = nodes.get(link.b);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.1;
      const pull = ((d - link.len) * SPRING * alpha) / d;
      a.vx += dx * pull; a.vy += dy * pull; b.vx -= dx * pull; b.vy -= dy * pull;
    }
    for (const n of list) {
      n.vx -= n.x * GRAVITY * n.pull * alpha;
      n.vy -= n.y * GRAVITY * n.pull * alpha;
      n.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, n.vx * DAMPING));
      n.vy = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, n.vy * DAMPING));
      if (n.fixed) { n.vx = 0; n.vy = 0; } else { n.x += n.vx; n.y += n.vy; }
    }
  }

  // The camera eases towards a view of every node until the user pans or zooms.
  function follow() {
    if (manual || !nodes.size) return false;
    const list = [...nodes.values()];
    const reach = n => n.r + LABEL_ROOM;
    const left = Math.min(...list.map(n => n.x - reach(n)));
    const right = Math.max(...list.map(n => n.x + reach(n)));
    const top = Math.min(...list.map(n => n.y - reach(n)));
    const bottom = Math.max(...list.map(n => n.y + reach(n)));
    const k = Math.max(ZOOM[0], Math.min(1.1, (width - FIT_PAD * 2) / (right - left), (height - FIT_PAD * 2) / (bottom - top)));
    const goal = { k, x: -((left + right) / 2) * k, y: -((top + bottom) / 2) * k };
    const off = Math.abs(goal.k - cam.k) + Math.abs(goal.x - cam.x) / 200 + Math.abs(goal.y - cam.y) / 200;
    for (const key of ['k', 'x', 'y']) cam[key] += (goal[key] - cam[key]) * 0.1;
    return off > 0.002;
  }

  function draw() {
    for (const n of nodes.values()) n.el.setAttribute('transform', `translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`);
    for (const l of links.values()) {
      const a = nodes.get(l.a);
      const b = nodes.get(l.b);
      if (!a || !b) continue;
      for (const [name, value] of [['x1', a.x], ['y1', a.y], ['x2', b.x], ['y2', b.y]]) l.el.setAttribute(name, value.toFixed(1));
    }
    view.setAttribute('transform', `translate(${width / 2 + cam.x} ${height / 2 + cam.y}) scale(${cam.k})`);
  }

  function tick() {
    frame = 0;
    if (width <= 1) return;
    if (alpha > SETTLED) { forces(); alpha *= COOLING; }
    const moving = follow();
    draw();
    if (alpha > SETTLED || moving) frame = requestAnimationFrame(tick);
  }

  const wake = (to = 1) => {
    alpha = Math.max(alpha, to);
    if (!frame) frame = requestAnimationFrame(tick);
  };

  const toWorld = e => {
    const box = svg.getBoundingClientRect();
    return { x: (e.clientX - box.left - width / 2 - cam.x) / cam.k, y: (e.clientY - box.top - height / 2 - cam.y) / cam.k };
  };

  svg.addEventListener('pointerdown', e => {
    const id = e.target.closest('.gnode')?.dataset.id;
    drag = { id, node: nodes.get(id), x: e.clientX, y: e.clientY, camX: cam.x, camY: cam.y, moved: false };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_PX) return;
    drag.moved = true;
    if (drag.node) {
      Object.assign(drag.node, toWorld(e), { fixed: true });
      wake(0.3);
    } else {
      manual = true;
      cam.x = drag.camX + dx;
      cam.y = drag.camY + dy;
      wake(0);
    }
  });
  svg.addEventListener('pointerup', () => {
    if (!drag) return;
    if (drag.node) drag.node.fixed = false;
    if (drag.id && !drag.moved) onOpen(drag.id);
    drag = null;
  });
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    manual = true;
    const before = toWorld(e);
    cam.k = Math.max(ZOOM[0], Math.min(ZOOM[1], cam.k * Math.exp(-e.deltaY * 0.0015)));
    const box = svg.getBoundingClientRect();
    cam.x = e.clientX - box.left - width / 2 - before.x * cam.k;
    cam.y = e.clientY - box.top - height / 2 - before.y * cam.k;
    wake(0);
  }, { passive: false });
  svg.addEventListener('dblclick', e => {
    if (e.target.closest('.gnode')) return;
    manual = false;
    wake(0);
  });

  const observer = new ResizeObserver(([entry]) => {
    width = entry.contentRect.width;
    height = entry.contentRect.height;
    wake(0);
  });
  observer.observe(host);

  return {
    update({ nodes: nextNodes, links: nextLinks }) {
      sync(nodes, nextNodes, n => n.id, setNode);
      sync(links, nextLinks.filter(l => nextNodes.some(n => n.id === l.a) && nextNodes.some(n => n.id === l.b)), l => `${l.a}|${l.b}`, setLink);
      wake(0.5);
    },
    destroy() {
      observer.disconnect();
      cancelAnimationFrame(frame);
      svg.remove();
    },
  };
}
