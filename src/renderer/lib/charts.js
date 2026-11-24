import { tipRows } from './ui.js';

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

const roundedTop = (x, y, w, h, r) =>
  `<path d="M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z"`;

// Stacked bars. buckets: [{ label, tipTitle, values: number[] }] in `series` order.
export function stackedBars({ width, height = 240, buckets, series, format }) {
  const padL = 48, padR = 4, padT = 10, padB = 26;
  const iw = width - padL - padR, ih = height - padT - padB;
  const totals = buckets.map(b => b.values.reduce((a, v) => a + v, 0));
  const max = niceMax(Math.max(0, ...totals));
  const slot = iw / Math.max(1, buckets.length);
  const bw = Math.max(1, Math.min(28, slot * 0.62));
  const y = v => padT + ih - (v / max) * ih;
  const out = [];

  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    out.push(`<line class="${i ? 'gridline' : 'baseline'}" x1="${padL}" x2="${width - padR}" y1="${y(v)}" y2="${y(v)}"/>`,
      `<text class="axis" x="${padL - 10}" y="${y(v) + 4}" text-anchor="end">${format(v)}</text>`);
  }
  const every = Math.max(1, Math.ceil(buckets.length / Math.max(2, Math.floor(iw / 72))));
  buckets.forEach((b, i) => {
    if (i % every) return;
    out.push(`<text class="axis" x="${padL + slot * i + slot / 2}" y="${height - 6}" text-anchor="middle">${b.label}</text>`);
  });

  buckets.forEach((b, i) => {
    const x = padL + slot * i + (slot - bw) / 2;
    const segs = b.values.map((v, j) => ({ v, color: series[j].color })).filter(s => s.v > 0);
    let acc = 0;
    const bars = segs.map((s, k) => {
      const top = y(acc + s.v);
      const h = Math.max(0, y(acc) - top - (k ? 2 : 0));
      acc += s.v;
      if (h < 0.4) return '';
      const r = k === segs.length - 1 ? Math.min(4, bw / 2, h) : 0;
      return r ? `${roundedTop(x, top, bw, h, r)} fill="${s.color}"/>` : `<rect x="${x}" y="${top}" width="${bw}" height="${h}" fill="${s.color}"/>`;
    }).join('');
    const rows = series.map((s, j) => [s.name, format(b.values[j]), s.color]);
    if (series.length > 1) rows.push(['Total', format(totals[i])]);
    out.push(`<g class="col" data-tip="${tipRows(b.tipTitle, rows)}"><rect class="col-bg" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${ih}" rx="4"/>${bars}</g>`);
  });

  return `<svg viewBox="0 0 ${width} ${height}" height="${height}">${out.join('')}</svg>`;
}

// Cells stretch to fill a fixed box, so switching views never changes the card's size.
// cells[r][c] = { value, tip, text? } or null for days outside the period.
export function heatGrid({ width, height, cells, rowLabels, colLabels, levels, labelWidth = 48 }) {
  const rows = cells.length, cols = cells[0].length;
  const top = 18, gap = 3;
  const cw = (width - labelWidth) / cols - gap;
  const ch = (height - top) / rows - gap;
  const max = Math.max(1, ...cells.flat().map(c => (c ? c.value : 0)));
  const level = v => (v <= 0 ? 0 : Math.min(levels.length - 1, 1 + Math.floor(Math.sqrt(v / max) * (levels.length - 1.001))));
  const out = [];
  colLabels.forEach((label, c) => {
    if (label) out.push(`<text class="axis" x="${labelWidth + c * (cw + gap)}" y="11">${label}</text>`);
  });
  rowLabels.forEach((label, r) => {
    if (label) out.push(`<text class="axis" x="0" y="${top + r * (ch + gap) + ch / 2 + 4}">${label}</text>`);
  });
  cells.forEach((row, r) => row.forEach((c, ci) => {
    if (!c) return;
    const x = labelWidth + ci * (cw + gap), yy = top + r * (ch + gap);
    const l = level(c.value);
    out.push(`<g class="cell" data-tip="${c.tip}"><rect x="${x}" y="${yy}" width="${cw}" height="${ch}" rx="${Math.min(4, cw / 3, ch / 3)}" fill="${levels[l]}"/>`
      + (c.text && ch >= 20 && cw >= 24 ? `<text class="cell-text${l >= levels.length - 2 ? ' strong' : ''}" x="${x + 6}" y="${yy + 14}">${c.text}</text>` : '') + '</g>');
  }));
  return `<svg viewBox="0 0 ${width} ${height}" height="${height}">${out.join('')}</svg>`;
}
