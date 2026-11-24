const GAP_X = 18;
const GAP_Y = 44;
const PAD = 28;
const PULSE_S = 1.8;
const MIN_SCALE = 0.85;

// Tidy top-down tree: leaves take the next free slot, parents centre over their children.
function layout(nodes) {
  const kids = new Map();
  for (const n of nodes) kids.set(n.parent, [...(kids.get(n.parent) || []), n]);
  const rowHeight = [];
  let cursor = 0;
  const shift = (n, dx) => { n.x += dx; (kids.get(n.id) || []).forEach(c => shift(c, dx)); };
  const place = (n, depth) => {
    n.depth = depth;
    rowHeight[depth] = Math.max(rowHeight[depth] || 0, n.h);
    const start = cursor;
    const children = kids.get(n.id) || [];
    if (!children.length) {
      n.x = cursor + n.w / 2;
    } else {
      children.forEach(c => place(c, depth + 1));
      n.x = (children[0].x + children[children.length - 1].x) / 2;
      if (n.x - n.w / 2 < start) shift(n, start - (n.x - n.w / 2));
    }
    cursor = Math.max(cursor, n.x + n.w / 2 + GAP_X);
  };
  (kids.get(null) || []).forEach(n => place(n, 0));
  const tops = [];
  rowHeight.forEach((h, i) => tops.push(i ? tops[i - 1] + rowHeight[i - 1] + GAP_Y : 0));
  for (const n of nodes) n.y = tops[n.depth] + (rowHeight[n.depth] - n.h) / 2;
  return { width: cursor - GAP_X, height: tops[tops.length - 1] + rowHeight[rowHeight.length - 1] };
}

const curve = (x1, y1, x2, y2) => `M${x1} ${y1} C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;

// nodes: { id, parent, w, h, cls, body, attrs, live } with `body` drawn in the node's own 0..w, 0..h box.
// links: { from, to, kind } drawn as arcs with a travelling pulse. The chart shrinks to fit, never
// below MIN_SCALE (the container scrolls instead) and never above 1.
export function flowchart({ nodes, links, minWidth, minHeight, style = '' }) {
  const placed = nodes.filter(n => n.parent === null || nodes.some(p => p.id === n.parent));
  const { width, height } = layout(placed);
  const vbW = Math.max(width + PAD * 2, minWidth);
  const vbH = Math.max(height + PAD * 2, minHeight);
  const scale = Math.max(MIN_SCALE, Math.min(1, minWidth / vbW, minHeight / vbH));
  const byId = new Map(placed.map(n => [n.id, n]));
  const edges = placed.filter(n => n.parent !== null).map(n => {
    const p = byId.get(n.parent);
    return `<path class="edge ${n.live ? 'live' : ''}" d="${curve(p.x, p.y + p.h, n.x, n.y)}"/>`;
  }).join('');
  const begin = -((performance.now() / 1000) % PULSE_S).toFixed(2);
  const arcs = links.filter(l => byId.has(l.from) && byId.has(l.to) && l.from !== l.to).map(l => {
    const a = byId.get(l.from);
    const b = byId.get(l.to);
    const d = `M${a.x} ${a.y} Q${(a.x + b.x) / 2} ${Math.min(a.y, b.y) - 46} ${b.x} ${b.y}`;
    return `<path class="link ${l.kind}" d="${d}"/><circle class="pulse ${l.kind}" r="3.5"><animateMotion dur="${PULSE_S}s" begin="${begin}s" repeatCount="indefinite" path="${d}"/></circle>`;
  }).join('');
  const boxes = placed.map(n => `<g transform="translate(${n.x - n.w / 2} ${n.y})" ${n.attrs || ''}><g class="node ${n.cls || ''}">${n.body}</g></g>`).join('');
  return `<svg class="flowchart" width="${vbW * scale}" height="${vbH * scale}" viewBox="0 0 ${vbW} ${vbH}" style="${style}">`
    + `<g transform="translate(${(vbW - width) / 2} ${(vbH - height) / 2})">${edges}${arcs}${boxes}</g></svg>`;
}
