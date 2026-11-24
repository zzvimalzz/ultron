// Pixel mascots on a 16 x 13 grid. The body sits on rows 3-11 so hats have room above it.
// Rects are [x, y, width, height].

export const COLORS = [
  { name: 'Blue', hex: '#3987e5' }, { name: 'Clay', hex: '#d97757' }, { name: 'Aqua', hex: '#1baf7a' },
  { name: 'Amber', hex: '#eda100' }, { name: 'Pink', hex: '#e87ba4' }, { name: 'Green', hex: '#2fa84f' },
  { name: 'Violet', hex: '#7c6ce6' }, { name: 'Red', hex: '#e34948' },
];
export const colorHex = slot => (COLORS[(slot || 1) - 1] || COLORS[0]).hex;

export const ACCESSORIES = [
  { id: 'none', label: 'None' }, { id: 'shades', label: 'Shades' }, { id: 'crown', label: 'Crown' },
  { id: 'party', label: 'Party hat' }, { id: 'headphones', label: 'Headphones' }, { id: 'beanie', label: 'Beanie' },
  { id: 'halo', label: 'Halo' }, { id: 'visor', label: 'Visor' },
];
export const EYES = [
  { id: 'normal', label: 'Classic' }, { id: 'happy', label: 'Happy' }, { id: 'wink', label: 'Wink' }, { id: 'sleepy', label: 'Sleepy' },
];

const INK = '#1b1a18';
const GOLD = '#f2c14e';
const GOLD_DARK = '#c9962a';

const BODIES = {
  claude: {
    body: [[3, 4, 10, 6], [1, 6, 2, 2], [13, 6, 2, 2]],
    shade: [[3, 9, 10, 1]],
    feet: [[4, 10, 1, 2], [6, 10, 1, 2], [9, 10, 1, 2], [11, 10, 1, 2]],
  },
  chatgpt: {
    body: [[6, 3, 4, 1], [4, 4, 8, 1], [3, 5, 10, 4], [4, 9, 8, 1], [6, 10, 4, 1], [2, 6, 1, 2], [13, 6, 1, 2]],
    shade: [[4, 4, 1, 1], [11, 4, 1, 1], [4, 9, 1, 1], [11, 9, 1, 1], [7, 8, 2, 1]],
    feet: [[5, 11, 2, 1], [9, 11, 2, 1]],
    spark: [[13, 0, 1, 3], [12, 1, 3, 1]],
  },
};

const EYE_SHAPES = {
  normal: x => [[x, 5, 1, 2]],
  happy: x => [[x - 1, 6, 1, 1], [x, 5, 1, 1], [x + 1, 6, 1, 1]],
  line: x => [[x - 1, 6, 3, 1]],
};
const EYE_STYLES = { normal: ['normal', 'normal'], happy: ['happy', 'happy'], wink: ['normal', 'line'], sleepy: ['line', 'line'] };

const ACCESSORY_RECTS = {
  shades: [[4, 5, 3, 2, INK], [9, 5, 3, 2, INK], [7, 5, 2, 1, INK], [4, 5, 1, 1, '#6d6c66'], [9, 5, 1, 1, '#6d6c66']],
  visor: [[3, 5, 10, 2, INK], [4, 5, 8, 1, '#ff4d4d'], [5, 6, 6, 1, '#b3261e']],
  crown: [[4, 3, 8, 1, GOLD_DARK], [4, 2, 8, 1, GOLD], [4, 1, 1, 1, GOLD], [7, 1, 2, 1, GOLD], [11, 1, 1, 1, GOLD], [7, 2, 2, 1, '#e5484d']],
  party: [[6, 3, 4, 1, '#6250d6'], [7, 2, 2, 1, '#e87ba4'], [7, 1, 2, 1, '#6250d6'], [7, 0, 2, 1, GOLD]],
  headphones: [[4, 2, 8, 1, '#3a3936'], [3, 3, 1, 1, '#3a3936'], [12, 3, 1, 1, '#3a3936'], [2, 4, 2, 2, '#2a2927'], [12, 4, 2, 2, '#2a2927'], [2, 4, 1, 2, '#e5484d'], [13, 4, 1, 2, '#e5484d']],
  beanie: [[3, 3, 10, 1, '#1f5aa8'], [4, 2, 8, 1, '#2a78d6'], [5, 1, 6, 1, '#2a78d6'], [7, 0, 2, 1, '#f0efec']],
  halo: [[5, 1, 6, 1, GOLD], [4, 2, 1, 1, GOLD_DARK], [11, 2, 1, 1, GOLD_DARK]],
};

function darken(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = shift => Math.round(((n >> shift) & 255) * (1 - amount));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

const rects = (list, fill) => list.map(([x, y, w, h, f]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f || fill}"/>`).join('');

export function mascotSVG({ provider = 'claude', color = 1, hex = colorHex(color), mascot = {} }, size = 64) {
  const shape = BODIES[provider] || BODIES.claude;
  const { accessory = 'none', eyes = 'normal' } = mascot;
  const hidesEyes = accessory === 'shades' || accessory === 'visor';
  const eyeRects = hidesEyes ? '' : EYE_STYLES[eyes].map((style, i) => rects(EYE_SHAPES[style](i ? 10 : 5), INK)).join('');
  const spark = shape.spark ? `<g class="m-spark">${rects(shape.spark, GOLD)}</g>` : '';
  return `<svg class="mascot mascot-${provider}" viewBox="0 0 16 13" width="${size}" height="${Math.round(size * 13 / 16)}" shape-rendering="crispEdges" aria-hidden="true">`
    + `<g class="m-body">${rects(shape.body, hex)}${rects(shape.shade, darken(hex, 0.22))}${rects(shape.feet, darken(hex, 0.22))}`
    + `<g class="m-eyes">${eyeRects}</g>${rects(ACCESSORY_RECTS[accessory] || [], '')}</g>${spark}</svg>`;
}

export const brandSVG = size => mascotSVG({ hex: '#c7c6c0', mascot: { accessory: 'visor' } }, size);
