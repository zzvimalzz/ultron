const GAP_X = 36;
const GAP_Y = 44;
const PAD = 28;
const PULSE_S = 1.8;
const MIN_SCALE = 0.85;
const CLUSTER_PAD = 12;
const CLUSTER_TOP = 22;
const BULGE = 44;
const SLOTS = 8; // --s1 … --s8

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

// Where a link leaves `a` and enters `b`: vertical neighbours meet top to bottom, same-row nodes side to side.
function anchors(a, b) {
  if (b.y + b.h <= a.y) return [[a.x, a.y], [b.x, b.y + b.h]];
  if (a.y + a.h <= b.y) return [[a.x, a.y + a.h], [b.x, b.y]];
  return a.x < b.x ? [[a.x + a.w / 2, a.y + a.h / 2], [b.x - b.w / 2, b.y + b.h / 2]] : [[a.x - a.w / 2, a.y + a.h / 2], [b.x + b.w / 2, b.y + b.h / 2]];
}

const arc = ([x1, y1], [x2, y2]) => (y1 === y2 ? `M${x1} ${y1} Q${(x1 + x2) / 2} ${y1 - BULGE} ${x2} ${y2}` : `M${x1} ${y1} Q${(x1 + x2) / 2 + BULGE} ${(y1 + y2) / 2} ${x2} ${y2}`);

function clusterBoxes(placed, clusters) {
  return clusters.map(c => {
    const members = placed.filter(n => n.cluster === c.id);
    if (!members.length) return '';
    const x = Math.min(...members.map(n => n.x - n.w / 2)) - CLUSTER_PAD;
    const y = Math.min(...members.map(n => n.y)) - CLUSTER_TOP;
    const w = Math.max(...members.map(n => n.x + n.w / 2)) + CLUSTER_PAD - x;
    const h = Math.max(...members.map(n => n.y + n.h)) + CLUSTER_PAD - y;
    const caption = c.name.length > 22 ? `${c.name.slice(0, 21)}…` : c.name;
    return `<g class="cluster ${c.cls || ''}" style="--c:var(--s${(c.index % SLOTS) + 1})" ${c.attrs || ''}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="20"/>`
      + `<g transform="translate(${x + 14} ${y - 10})"><rect class="cap" width="${caption.length * 6.4 + 20}" height="20" rx="10"/><text x="10" y="14">${caption.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></g></g>`;
  }).join('');
}

// nodes: { id, parent, w, h, cls, body, attrs, live, edgeCls, cluster, beside } (`beside` places a node right of another, outside the tree) with `body` drawn in the node's own 0..w, 0..h box.
// clusters: { id, name, index, attrs } are tinted rectangles behind the nodes that name them.
// links: { from, to, kind, once } are drawn between nodes with a travelling pulse; `ask` and `report` follow the tree upwards.
// The chart shrinks to fit, never below MIN_SCALE (the container scrolls instead) and never above 1.
export function flowchart({ nodes, links = [], clusters = [], minWidth, minHeight, style = '' }) {
  const placed = nodes.filter(n => n.parent === null || nodes.some(p => p.id === n.parent));
  const { width: treeWidth, height } = layout(placed.filter(n => !n.beside));
  let width = treeWidth;
  for (const n of placed.filter(x => x.beside)) {
    const anchor = placed.find(p => p.id === n.beside);
    n.x = anchor.x + anchor.w / 2 + GAP_X + n.w / 2;
    n.y = anchor.y + (anchor.h - n.h) / 2;
    width = Math.max(width, n.x + n.w / 2);
  }
  const vbW = Math.max(width + PAD * 2, minWidth);
  const vbH = Math.max(height + PAD * 2, minHeight);
  const scale = Math.max(MIN_SCALE, Math.min(1, minWidth / vbW, minHeight / vbH));
  const byId = new Map(placed.map(n => [n.id, n]));
  const edges = placed.filter(n => n.parent !== null).map(n => {
    const p = byId.get(n.parent);
    return `<path class="edge ${n.live ? 'live' : ''} ${n.edgeCls || ''}" d="${curve(p.x, p.y + p.h, n.x, n.y)}"/>`;
  }).join('');
  const begin = -((performance.now() / 1000) % PULSE_S).toFixed(2);
  const wires = links.filter(l => byId.has(l.from) && byId.has(l.to) && l.from !== l.to).map(l => {
    const [start, end] = anchors(byId.get(l.from), byId.get(l.to));
    const climbs = l.kind === 'ask' || l.kind === 'report';
    const d = climbs ? curve(start[0], start[1], end[0], end[1]) : arc(start, end);
    const repeat = l.once ? '1' : 'indefinite';
    const line = l.kind === 'report' ? '' : `<path class="link ${l.kind}" d="${d}"/>`;
    return `${line}<circle class="pulse ${l.kind}" r="3.5"><animateMotion dur="${PULSE_S}s" begin="${l.once ? 0 : begin}s" repeatCount="${repeat}" fill="freeze" path="${d}"/></circle>`;
  }).join('');
  const boxes = placed.map(n => `<g transform="translate(${n.x - n.w / 2} ${n.y})" data-fid="${n.id}" data-x="${n.x - n.w / 2}" data-y="${n.y}" ${n.attrs || ''}><g class="node ${n.cls || ''}">${n.body}</g></g>`).join('');
  return `<svg class="flowchart" width="${vbW * scale}" height="${vbH * scale}" viewBox="0 0 ${vbW} ${vbH}" style="${style}">`
    + `<g transform="translate(${(vbW - width) / 2} ${(vbH - height) / 2})">${clusterBoxes(placed, clusters)}${edges}${wires}${boxes}</g></svg>`;
}
