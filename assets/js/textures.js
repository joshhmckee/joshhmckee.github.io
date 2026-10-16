import * as THREE from '../vendor/three.module.min.js';
import { rng, TAU, clamp } from './util.js';

/* ------------------------------------------------------------------ */
/* Low-level helpers                                                   */
/* ------------------------------------------------------------------ */

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  return [c, g];
}

export function toTexture(canvas, { repeat = null, srgb = true, mip = true, wrap = false } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = mip ? THREE.NearestMipmapLinearFilter : THREE.NearestFilter;
  t.generateMipmaps = mip;
  t.anisotropy = 1;
  if (wrap || repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (repeat) t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const wrapi = (v, p) => ((v % p) + p) % p;

/** Periodic value noise: tiles every (px, py) lattice units. */
function vnoise(x, y, px, py, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = wrapi(xi, px), x1 = wrapi(xi + 1, px), y0 = wrapi(yi, py), y1 = wrapi(yi + 1, py);
  const a = hash2(x0, y0, s), b = hash2(x1, y0, s), c = hash2(x0, y1, s), d = hash2(x1, y1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, px, py, s, oct = 4) {
  let v = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    v += a * vnoise(x * f, y * f, px * f, py * f, s + i * 31);
    n += a;
    f *= 2;
    a *= 0.5;
  }
  return v / n;
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const css = (c) => `rgb(${clamp(c[0] | 0, 0, 255)},${clamp(c[1] | 0, 0, 255)},${clamp(c[2] | 0, 0, 255)})`;

/** Fill a canvas pixel by pixel. fn(x, y) -> [r, g, b] or [r, g, b, a]. */
function paint(w, h, fn) {
  const [c, g] = makeCanvas(w, h);
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = fn(x, y);
      const i = (y * w + x) * 4;
      d[i] = clamp(p[0], 0, 255);
      d[i + 1] = clamp(p[1], 0, 255);
      d[i + 2] = clamp(p[2], 0, 255);
      d[i + 3] = p.length > 3 ? clamp(p[3], 0, 255) : 255;
    }
  }
  g.putImageData(img, 0, 0);
  return [c, g];
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function woodCanvas({ w = 128, h = 128, light = '#7a4128', dark = '#3a1a10', rings = 7, seed = 1, contrast = 0.75 } = {}) {
  const L = hexToRgb(light), D = hexToRgb(dark);
  return paint(w, h, (x, y) => {
    const n = fbm((x / w) * 3, (y / h) * 12, 3, 12, seed, 4);
    const t = (y / h) * rings + n * 2.2 + Math.sin((x / w) * TAU + seed) * 0.35;
    const ring = t - Math.floor(t);
    const line = Math.pow(Math.abs(Math.sin(ring * Math.PI)), 6);
    const streak = fbm((x / w) * 24, (y / h) * 96, 24, 96, seed + 7, 2);
    let k = 0.35 + (n - 0.5) * 0.9 + line * contrast * 0.6 + (streak - 0.5) * 0.35;
    if (hash2(x, y, seed + 3) > 0.992) k += 0.25;
    return mixc(L, D, clamp(k, 0, 1));
  });
}

export function woodTex(opts = {}) {
  const [c] = woodCanvas(opts);
  return toTexture(c, { wrap: true, repeat: opts.repeat });
}

/** Finger-block (basket-weave) parquet, tileable. */
export function parquetTex() {
  const W = 256, cell = 64, slats = 4, sw = cell / slats;
  const tones = ['#8a5a36', '#7a4c2c', '#94643e', '#6e4426', '#83542f'].map(hexToRgb);
  const [c] = paint(W, W, (x, y) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    const horiz = (cx + cy) % 2 === 0;
    const lx = x % cell, ly = y % cell;
    const along = horiz ? lx : ly;
    const across = horiz ? ly : lx;
    const s = Math.floor(across / sw);
    const base = tones[Math.floor(hash2(cx * 7 + s, cy * 13 + s, 5) * tones.length)];
    const grain = fbm((horiz ? x : y) / 40, (horiz ? y : x) / 3, 64, 256, 11 + s, 3);
    let col = shade(base, 0.82 + grain * 0.36);
    const edgeA = across % sw;
    if (edgeA === 0) col = shade(col, 0.55);
    else if (edgeA === 1) col = shade(col, 1.08);
    if (lx === 0 || ly === 0) col = shade(col, 0.45);
    void along;
    return col;
  });
  return toTexture(c, { wrap: true });
}

export function wallpaperTex() {
  const base = hexToRgb('#203a2c'), stripe = hexToRgb('#28473a'), pin = hexToRgb('#4f5a35'), motif = hexToRgb('#2f5141');
  const [c] = paint(64, 64, (x, y) => {
    const sx = x % 32;
    let col = sx >= 10 && sx < 22 ? stripe : base;
    if (sx === 9 || sx === 22) col = pin;
    // small damask lozenges in the dark band
    const mx = (x + 16) % 32 - 16, my = (y % 32) - 16;
    if (sx < 10 || sx >= 22) {
      const d = Math.abs(mx) * 1.6 + Math.abs(my);
      if (d < 7 && d > 4) col = motif;
      if (d <= 1.5) col = motif;
    }
    const n = hash2(x, y, 3) * 0.08 - 0.04;
    return shade(col, 1 + n);
  });
  return toTexture(c, { wrap: true });
}

/** Raised wood panel, used for wainscoting, cabinet doors and desk panels. */
export function panelTex({ light = '#6a3420', dark = '#2e140b', seed = 4, frame = 14, bevel = 4 } = {}) {
  const [wc] = woodCanvas({ w: 128, h: 128, light, dark, seed, rings: 6 });
  const wood = wc.getContext('2d').getImageData(0, 0, 128, 128).data;
  const [c] = paint(128, 128, (x, y) => {
    const i = (y * 128 + x) * 4;
    let col = [wood[i], wood[i + 1], wood[i + 2]];
    const ix = x - frame, iy = y - frame, iw = 128 - frame * 2;
    const inPanel = ix >= 0 && iy >= 0 && ix < iw && iy < iw;
    if (!inPanel) {
      if (x === 0 || y === 0) col = shade(col, 1.25);
      if (x === 127 || y === 127) col = shade(col, 0.6);
      return col;
    }
    const e = Math.min(ix, iy, iw - 1 - ix, iw - 1 - iy);
    if (e < bevel) {
      // light falls from the top-left: those bevels are bright, the others dark
      col = shade(col, Math.min(ix, iy) === e ? 1.22 : 0.62);
      if (e === 0) col = shade(col, 0.55);
    } else {
      col = shade(col, 1.05);
    }
    return col;
  });
  return toTexture(c, { wrap: true });
}

export function leatherInlayTex() {
  const W = 256, H = 112;
  const base = hexToRgb('#1d4a33'), gold = hexToRgb('#c8a24a');
  const [c] = paint(W, H, (x, y) => {
    const n = fbm(x / 9, y / 9, 1e3, 1e3, 21, 3);
    let col = shade(base, 0.75 + n * 0.5);
    const e = Math.min(x, y, W - 1 - x, H - 1 - y);
    if (e === 5 || e === 6) col = gold;
    if (e === 9) col = shade(gold, 0.8);
    if (e < 3) col = shade(col, 0.6);
    // tooled corner fleurons
    const cx = Math.min(x, W - 1 - x), cy = Math.min(y, H - 1 - y);
    if (cx > 10 && cy > 10 && cx < 20 && cy < 20 && (cx + cy) % 4 === 0) col = shade(gold, 0.9);
    return col;
  });
  return toTexture(c);
}

export function tuftedTex(color = '#5c1c14') {
  const base = hexToRgb(color);
  const [c] = paint(64, 64, (x, y) => {
    const u = (x + y) % 32, v = (x - y + 64) % 32;
    const du = Math.min(u, 32 - u), dv = Math.min(v, 32 - v);
    let k = 0.82 + Math.min(du, dv) / 16 * 0.38;
    if (du < 1 || dv < 1) k = 0.55;
    const bx = x % 32, by = y % 32;
    const button = (Math.abs(bx - 0) < 2 || Math.abs(bx - 32) < 2) && (Math.abs(by - 0) < 2 || Math.abs(by - 32) < 2);
    const button2 = Math.abs(bx - 16) < 2 && Math.abs(by - 16) < 2;
    if (button || button2) k = 0.45;
    k += hash2(x, y, 9) * 0.06;
    return shade(base, k);
  });
  return toTexture(c, { wrap: true });
}

export function plasterTex(color = '#d9ccb2') {
  const base = hexToRgb(color);
  const [c] = paint(64, 64, (x, y) => shade(base, 0.92 + fbm(x / 8, y / 8, 8, 8, 2, 3) * 0.14));
  return toTexture(c, { wrap: true });
}

export function metalTex(color = '#6b705c', brushed = true) {
  const base = hexToRgb(color);
  const [c] = paint(64, 64, (x, y) => {
    const n = brushed ? fbm(x / 64, y / 1.5, 1, 43, 6, 2) : fbm(x / 6, y / 6, 11, 11, 6, 2);
    return shade(base, 0.88 + n * 0.24);
  });
  return toTexture(c, { wrap: true });
}

export function grilleTex() {
  const [c] = paint(32, 32, (x, y) => {
    const k = (x % 2 === 0) !== (y % 2 === 0) ? 0.3 : 0.2;
    return [70 * k * 3, 56 * k * 3, 44 * k * 3];
  });
  return toTexture(c, { wrap: true });
}

/** Persian rug: border bands, field motifs and a central medallion. */
export function rugTex() {
  const W = 256, H = 184;
  const navy = hexToRgb('#1d2a4a'), red = hexToRgb('#7d1f1c'), deep = hexToRgb('#5a1414'), gold = hexToRgb('#c99a45'),
    cream = hexToRgb('#d9c49a'), teal = hexToRgb('#2b5a57');
  const [c] = paint(W, H, (x, y) => {
    const e = Math.min(x, y, W - 1 - x, H - 1 - y);
    let col;
    if (e < 3) col = cream;
    else if (e < 12) {
      col = navy;
      const t = (x + y) % 12;
      if (e > 5 && e < 10 && (t === 0 || t === 6)) col = gold;
    } else if (e < 14) col = gold;
    else if (e < 26) {
      col = deep;
      const along = e === Math.min(x, W - 1 - x) ? y : x;
      const m = along % 14;
      const dm = Math.abs(m - 7) + Math.abs(e - 20);
      if (dm < 4) col = teal;
      if (dm < 2) col = gold;
    } else if (e < 28) col = gold;
    else {
      const nx = (x - W / 2) / (W / 2 - 28), ny = (y - H / 2) / (H / 2 - 28);
      const d = Math.abs(nx) * 1.0 + Math.abs(ny) * 1.25;
      col = red;
      if (((x >> 3) + (y >> 3)) % 2 === 0 && x % 8 === 4 && y % 8 === 4) col = deep;
      if (d < 0.62) col = navy;
      if (d < 0.56 && d > 0.53) col = gold;
      if (d < 0.42) col = deep;
      if (d < 0.36) col = teal;
      if (d < 0.2) col = gold;
      if (d < 0.12) col = red;
      const cd = Math.min(Math.abs(nx - 1) + Math.abs(ny - 1), Math.abs(nx + 1) + Math.abs(ny - 1), Math.abs(nx - 1) + Math.abs(ny + 1), Math.abs(nx + 1) + Math.abs(ny + 1));
      if (cd < 0.5) col = navy;
      if (cd < 0.47 && cd > 0.43) col = gold;
    }
    const wear = fbm(x / 20, y / 20, 1e3, 1e3, 77, 3);
    return shade(col, 0.82 + wear * 0.3 + hash2(x, y, 2) * 0.08);
  });
  return toTexture(c);
}

/* ------------------------------------------------------------------ */
/* Books                                                               */
/* ------------------------------------------------------------------ */

const BOOK_COLORS = [
  '#6e1f1a', '#7d2a20', '#4a1512', '#1f3b2b', '#28473a', '#1e2c4f', '#24365e', '#3a2a1a', '#5a3a22', '#8a6a2a',
  '#a8823a', '#2b2b2b', '#151515', '#d9ccaa', '#c9b48a', '#6b2c3e', '#3d4a2a', '#56622f', '#7a5a3c', '#904a24',
  '#2f4f5f', '#5e4b8b', '#b0582f', '#e0d6bc', '#8c1c13', '#33302b',
];

/**
 * Atlas of procedurally drawn book spines. Every cell is a unique design; the
 * base colour of each cell is reported so side faces can match it.
 */
export function bookAtlas(seed = 12) {
  const CW = 16, CH = 64, COLS = 64, ROWS = 8;
  const W = CW * COLS, H = CH * ROWS + 32;
  const [c, g] = makeCanvas(W, H);
  const r = rng(seed);
  const cells = [];
  const gold = '#d7b25a';
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x0 = col * CW, y0 = row * CH;
      const style = r.pick(['leather', 'leather', 'cloth', 'cloth', 'paper', 'binder', 'report']);
      let base = style === 'binder' ? r.pick(['#1a1a1a', '#e6e2d6', '#1e2c4f', '#6e1f1a', '#2f4f5f'])
        : style === 'report' ? r.pick(['#eae3d0', '#f0ece0', '#d9ccaa'])
          : style === 'paper' ? r.pick(['#b0582f', '#d9a43a', '#2f6f8f', '#e0d6bc', '#8c1c13', '#3e6b4b', '#c94f3a'])
            : r.pick(BOOK_COLORS);
      const rgb = hexToRgb(base);
      const jit = 0.85 + r() * 0.3;
      const baseRgb = shade(rgb, jit);
      g.fillStyle = css(baseRgb);
      g.fillRect(x0, y0, CW, CH);
      // subtle vertical shading toward the spine's rounded edges
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(x0, y0, 1, CH);
      g.fillRect(x0 + CW - 1, y0, 1, CH);
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.fillRect(x0 + 4, y0, 3, CH);
      const accent = style === 'binder' || style === 'report' ? '#1b1b1b' : r.chance(0.7) ? gold : '#e9dfc4';
      if (style === 'leather') {
        const bands = r.int(2, 4);
        for (let b = 0; b < bands; b++) {
          const by = y0 + 6 + b * Math.floor((CH - 14) / Math.max(1, bands - 1));
          g.fillStyle = css(shade(baseRgb, 0.55));
          g.fillRect(x0, by, CW, 2);
          g.fillStyle = css(shade(baseRgb, 1.35));
          g.fillRect(x0, by + 2, CW, 1);
        }
        g.fillStyle = r.chance(0.5) ? css(shade(baseRgb, 0.5)) : 'rgba(0,0,0,0)';
        g.fillRect(x0 + 2, y0 + 12, CW - 4, 12);
        g.fillStyle = accent;
        for (let t = 0; t < r.int(2, 4); t++) g.fillRect(x0 + 4 + r.int(0, 2), y0 + 14 + t * 3, r.int(4, 8), 1);
        g.fillRect(x0 + 5, y0 + CH - 10, 6, 1);
      } else if (style === 'cloth') {
        g.fillStyle = r.pick(['#e9dfc4', '#1b1b1b', gold, '#c9b48a']);
        const ly = y0 + r.int(6, 16);
        g.fillRect(x0 + 2, ly, CW - 4, r.int(14, 26));
        g.fillStyle = css(shade(baseRgb, 0.6));
        for (let t = 0; t < r.int(3, 6); t++) g.fillRect(x0 + 5 + r.int(0, 1), ly + 3 + t * 3, r.int(3, 6), 1);
        g.fillStyle = accent;
        g.fillRect(x0 + 6, y0 + CH - 7, 4, 3);
      } else if (style === 'paper') {
        g.fillStyle = r.pick(['#f2ead2', '#1b1b1b', '#ffffff']);
        for (let t = 0; t < r.int(5, 9); t++) g.fillRect(x0 + 6, y0 + 8 + t * 4, 3 + r.int(0, 2), 2);
        g.fillStyle = r.pick(['#1b1b1b', '#f2ead2']);
        g.fillRect(x0, y0 + CH - 9, CW, 2);
      } else if (style === 'binder') {
        g.fillStyle = '#f4f0e2';
        g.fillRect(x0 + 2, y0 + 6, CW - 4, 22);
        g.fillStyle = '#333';
        for (let t = 0; t < 4; t++) g.fillRect(x0 + 4, y0 + 9 + t * 4, r.int(5, 8), 1);
        g.fillStyle = 'rgba(0,0,0,0.55)';
        g.fillRect(x0 + 5, y0 + CH - 16, 6, 6);
      } else {
        g.fillStyle = r.pick(['#1e2c4f', '#7d2a20', '#1f3b2b', '#a8823a']);
        g.fillRect(x0, y0 + 4, CW, 6);
        g.fillStyle = '#333';
        for (let t = 0; t < 6; t++) g.fillRect(x0 + 6, y0 + 16 + t * 4, 2 + r.int(0, 3), 1);
      }
      // wear at the head and tail
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x0, y0, CW, 1);
      g.fillRect(x0, y0 + CH - 1, CW, 1);
      const cr = baseRgb.map((v) => clamp(v, 0, 255) / 255);
      cells.push({
        u0: x0 / W, u1: (x0 + CW) / W, v0: 1 - (y0 + CH) / H, v1: 1 - y0 / H,
        color: new THREE.Color().setRGB(cr[0], cr[1], cr[2], THREE.SRGBColorSpace),
        style,
      });
    }
  }
  // utility strip: pages (with page lines) and a plain white cell
  const py = CH * ROWS;
  for (let x = 0; x < 64; x++) {
    for (let y = 0; y < 32; y++) {
      const k = 0.86 + (x % 3 === 0 ? -0.08 : 0) + hash2(x, y, 4) * 0.06;
      g.fillStyle = css(shade([235, 224, 196], k));
      g.fillRect(x, py + y, 1, 1);
    }
  }
  g.fillStyle = '#ffffff';
  g.fillRect(64, py, 32, 32);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = 'rgba(0,0,0,0.05)';
    g.fillRect(64 + r.int(0, 31), py + r.int(0, 31), 1, 1);
  }
  const pages = { u0: 0, u1: 64 / W, v0: 1 - (py + 32) / H, v1: 1 - py / H };
  const plain = { u0: 66 / W, u1: 94 / W, v0: 1 - (py + 30) / H, v1: 1 - (py + 2) / H };
  const tex = toTexture(c);
  return { tex, cells, pages, plain };
}

/** A single hero spine with readable title, for the clickable resource books. */
export function heroSpineTex({ title, author = '', color = '#6e1f1a', foil = '#e3c26a', seed = 1 }) {
  const W = 48, H = 224;
  const [c, g] = makeCanvas(W, H);
  const base = hexToRgb(color);
  const r = rng(seed);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = fbm(x / 6, y / 6, 1e3, 1e3, seed, 2);
      const edge = Math.min(x, W - 1 - x);
      const k = 0.78 + n * 0.3 + (edge < 3 ? -0.18 : 0) + (x > 8 && x < 16 ? 0.08 : 0);
      g.fillStyle = css(shade(base, k));
      g.fillRect(x, y, 1, 1);
    }
  }
  const foilC = hexToRgb(foil);
  const band = (y) => {
    g.fillStyle = css(shade(base, 0.5));
    g.fillRect(0, y, W, 4);
    g.fillStyle = css(shade(base, 1.4));
    g.fillRect(0, y + 4, W, 1);
    g.fillStyle = css(foilC);
    g.fillRect(3, y - 3, W - 6, 1);
    g.fillRect(3, y + 8, W - 6, 1);
  };
  band(14);
  band(H - 26);
  // title: rotated, reading top to bottom
  g.save();
  g.translate(W / 2 + 1, 34);
  g.rotate(Math.PI / 2);
  g.fillStyle = css(foilC);
  g.textBaseline = 'middle';
  let size = 26;
  g.font = `${size}px VT323, monospace`;
  const maxLen = H - 80;
  while (g.measureText(title).width > maxLen && size > 14) {
    size -= 1;
    g.font = `${size}px VT323, monospace`;
  }
  g.fillText(title, 0, 0);
  g.restore();
  if (author) {
    g.fillStyle = css(shade(foilC, 0.85));
    g.font = '14px VT323, monospace';
    g.textAlign = 'center';
    g.fillText(author, W / 2, H - 9);
  }
  void r;
  return toTexture(c);
}

/* ------------------------------------------------------------------ */
/* Paper                                                               */
/* ------------------------------------------------------------------ */

function paperBase(g, w, h, tint = '#f1ead8') {
  const t = hexToRgb(tint);
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      g.fillStyle = css(shade(t, 0.95 + hash2(x, y, 8) * 0.06));
      g.fillRect(x, y, 2, 2);
    }
  }
}

function textLines(g, r, x, y, w, rows, lh = 4, color = '#7d7a72', ragged = true) {
  g.fillStyle = color;
  for (let i = 0; i < rows; i++) {
    if (r.chance(0.12)) continue;
    const lw = ragged && (i % 6 === 5 || r.chance(0.15)) ? w * r.range(0.3, 0.8) : w * r.range(0.9, 1);
    let cx = x;
    while (cx < x + lw) {
      const word = r.int(3, 9);
      g.fillRect(cx, y + i * lh, Math.min(word, x + lw - cx), 1);
      cx += word + 2;
    }
  }
}

export const PAPER = { w: 128, h: 166 };

export function paperTex(kind, seed = 1, extra = {}) {
  const { w, h } = PAPER;
  const [c, g] = makeCanvas(w, h);
  const r = rng(seed);
  if (kind === 'greenbar') {
    paperBase(g, w, h, '#eef0e2');
    for (let y = 0; y < h; y += 16) {
      g.fillStyle = '#cfe3c8';
      g.fillRect(10, y, w - 20, 8);
    }
    g.fillStyle = '#b9b8a8';
    for (let y = 4; y < h; y += 10) {
      g.fillRect(3, y, 3, 3);
      g.fillRect(w - 6, y, 3, 3);
    }
    g.fillStyle = '#4a4a46';
    for (let y = 2; y < h - 4; y += 4) {
      let x = 14;
      while (x < w - 18) {
        const ww = r.int(2, 7);
        if (r.chance(0.8)) g.fillRect(x, y, ww, 1);
        x += ww + r.int(2, 6);
      }
    }
    return toTexture(c);
  }
  if (kind === 'legal') {
    paperBase(g, w, h, '#f3e27a');
    g.fillStyle = '#8fb3c9';
    for (let y = 22; y < h; y += 7) g.fillRect(0, y, w, 1);
    g.fillStyle = '#d9605a';
    g.fillRect(18, 0, 1, h);
    g.fillRect(20, 0, 1, h);
    g.strokeStyle = '#26324f';
    g.lineWidth = 1;
    for (let line = 0; line < 13; line++) {
      if (r.chance(0.25)) continue;
      const y = 20 + line * 7;
      let x = 24;
      g.beginPath();
      g.moveTo(x, y);
      const end = r.range(50, w - 8);
      while (x < end) {
        x += r.range(1.5, 3);
        g.lineTo(x, y - r.range(0, 3.5));
      }
      g.stroke();
    }
    g.strokeStyle = '#c0392b';
    g.beginPath();
    g.ellipse(r.range(50, 90), r.range(40, 110), 18, 7, r.range(-0.3, 0.3), 0, TAU);
    g.stroke();
    return toTexture(c);
  }
  paperBase(g, w, h, kind === 'tenk' ? '#f4f1e8' : '#f1ead8');
  if (kind === 'tenk') {
    g.fillStyle = '#222';
    g.font = 'bold 13px "Courier Prime", monospace';
    g.textAlign = 'center';
    g.fillText('UNITED STATES', w / 2, 24);
    g.font = '9px "Courier Prime", monospace';
    g.fillText('SECURITIES AND EXCHANGE COMMISSION', w / 2, 36);
    g.font = 'bold 22px "Courier Prime", monospace';
    g.fillText('FORM 10-K', w / 2, 66);
    g.fillRect(16, 74, w - 32, 1);
    textLines(g, r, 16, 86, w - 32, 18, 4, '#6d6a62');
  } else if (kind === 'memo') {
    g.fillStyle = '#222';
    g.font = 'bold 14px "Courier Prime", monospace';
    g.fillText('MEMO', 12, 22);
    textLines(g, r, 12, 32, 60, 3, 5, '#5c5a54', false);
    g.fillRect(12, 50, w - 24, 1);
    textLines(g, r, 12, 60, w - 24, 24, 4);
  } else if (kind === 'table') {
    g.fillStyle = '#333';
    g.fillRect(10, 14, w - 20, 6);
    g.fillStyle = '#9a978d';
    for (let i = 0; i < 26; i++) {
      const y = 26 + i * 5;
      g.fillRect(10, y + 4, w - 20, 1);
      for (let col = 0; col < 5; col++) {
        g.fillStyle = '#5c5a54';
        g.fillRect(14 + col * 22 + r.int(0, 6), y + 1, r.int(6, 12), 1);
        g.fillStyle = '#9a978d';
      }
    }
  } else if (kind === 'chart') {
    g.fillStyle = '#222';
    g.fillRect(12, 14, 60, 3);
    g.strokeStyle = '#9a978d';
    g.strokeRect(12.5, 26.5, w - 25, 60);
    g.strokeStyle = r.pick(['#1f5f9f', '#2f7f3f', '#a0302a']);
    g.lineWidth = 1.5;
    g.beginPath();
    let yv = 76;
    for (let x = 14; x < w - 14; x += 3) {
      yv = clamp(yv + r.range(-4, 3), 32, 82);
      x === 14 ? g.moveTo(x, yv) : g.lineTo(x, yv);
    }
    g.stroke();
    textLines(g, r, 12, 96, w - 24, 16, 4);
  } else if (kind === 'transcript') {
    g.fillStyle = '#222';
    g.font = 'bold 9px "Courier Prime", monospace';
    g.fillText('EARNINGS CALL TRANSCRIPT', 10, 18);
    g.fillRect(10, 22, w - 20, 1);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = '#333';
      g.fillRect(10, 30 + i * 17, 18, 2);
      textLines(g, r, 32, 30 + i * 17, w - 44, 3, 4);
    }
  } else if (kind === 'report') {
    // Research report cover: letterhead, title, embedded chart, body text.
    g.fillStyle = '#1b2a3a';
    g.fillRect(0, 0, w, 16);
    g.fillStyle = '#efe6cf';
    g.font = '11px VT323, monospace';
    g.fillText('THE DEEP VIEW  /  EQUITY RESEARCH', 6, 11);
    g.fillStyle = '#1b1b1b';
    g.font = 'bold 14px "Courier Prime", monospace';
    g.fillText(extra.company || 'COMPANY', 8, 32);
    g.font = '10px "Courier Prime", monospace';
    g.fillStyle = '#9b2b1f';
    g.fillText(extra.ticker || '', w - 8 - g.measureText(extra.ticker || '').width, 32);
    g.fillStyle = '#444';
    const sub = (extra.subtitle || '').toUpperCase();
    g.font = '9px VT323, monospace';
    g.fillText(sub.slice(0, 30), 8, 43);
    if (extra.image) {
      const ih = 56, iw = w - 16;
      g.fillStyle = '#ffffff';
      g.fillRect(8, 50, iw, ih);
      try {
        g.imageSmoothingEnabled = true;
        g.drawImage(extra.image, 8, 50, iw, ih);
        g.imageSmoothingEnabled = false;
      } catch (e) { /* tainted or missing image: leave the box blank */ }
      g.strokeStyle = '#b5b0a2';
      g.strokeRect(8.5, 50.5, iw - 1, ih - 1);
    }
    textLines(g, r, 8, 116, w - 16, 12, 4);
  } else {
    textLines(g, r, 12, 16, w - 24, 34, 4);
  }
  if (r.chance(0.18) && kind !== 'report') {
    // coffee ring
    g.strokeStyle = 'rgba(120,80,40,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(r.range(30, 100), r.range(40, 130), r.range(10, 13), 0, TAU * r.range(0.6, 0.95));
    g.stroke();
  }
  return toTexture(c);
}

/** Side of a ream of paper: stacked page edges. */
export function paperEdgeTex() {
  const [c] = paint(32, 32, (x, y) => {
    const k = y % 2 === 0 ? 0.95 : 0.82;
    return shade([238, 230, 210], k + hash2(x >> 2, y, 3) * 0.06);
  });
  return toTexture(c, { wrap: true });
}

export function newspaperTex() {
  const w = 128, h = 166;
  const [c, g] = makeCanvas(w, h);
  paperBase(g, w, h, '#ddd6c3');
  const r = rng(77);
  g.fillStyle = '#1b1b1b';
  g.font = 'bold 15px Georgia, "Times New Roman", serif';
  g.textAlign = 'center';
  g.fillText('The Daily Ledger', w / 2, 20);
  g.fillRect(6, 25, w - 12, 1);
  g.fillRect(6, 27, w - 12, 1);
  g.font = 'bold 13px Georgia, serif';
  g.fillText('MARKETS', w / 2, 44);
  g.fillStyle = '#8a8476';
  g.fillRect(8, 52, 54, 40);
  for (let col = 0; col < 3; col++) textLines(g, r, 8 + col * 39, col === 0 ? 98 : 54, 34, col === 0 ? 15 : 26, 4, '#5a564d');
  return toTexture(c);
}

/* ------------------------------------------------------------------ */
/* Objects                                                             */
/* ------------------------------------------------------------------ */

export function keyboardTex() {
  const [c, g] = makeCanvas(128, 44);
  g.fillStyle = '#b7ab8c';
  g.fillRect(0, 0, 128, 44);
  const key = (x, y, w, h, col = '#ddd3b8') => {
    g.fillStyle = '#8f8468';
    g.fillRect(x, y, w, h);
    g.fillStyle = col;
    g.fillRect(x, y, w - 1, h - 1);
  };
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k < 13; k++) key(4 + k * 7, 6 + row * 7, 6, 6, k === 0 || k === 12 ? '#c4b898' : '#ddd3b8');
  }
  key(18, 41 - 6, 50, 6);
  for (let row = 0; row < 5; row++) for (let k = 0; k < 4; k++) key(98 + k * 7, 6 + row * 7, 6, 6, '#c4b898');
  return toTexture(c);
}

export function pcFrontTex() {
  const [c, g] = makeCanvas(128, 36);
  g.fillStyle = '#d6cbad';
  g.fillRect(0, 0, 128, 36);
  g.fillStyle = '#b9ad8c';
  for (let x = 6; x < 40; x += 3) g.fillRect(x, 6, 1, 24);
  g.fillStyle = '#4a463c';
  g.fillRect(56, 8, 46, 4);
  g.fillRect(64, 22, 30, 3);
  g.fillStyle = '#8f8468';
  g.fillRect(56, 13, 46, 1);
  g.fillRect(64, 26, 30, 1);
  g.fillStyle = '#c4b898';
  g.fillRect(108, 10, 10, 8);
  g.fillStyle = '#3a372f';
  g.font = '7px VT323, monospace';
  g.fillText('486DX2', 106, 30);
  return toTexture(c);
}

export function pcFrontEmissive() {
  const [c, g] = makeCanvas(128, 36);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 36);
  g.fillStyle = '#39ff6a';
  g.fillRect(110, 22, 2, 2);
  g.fillStyle = '#ffb000';
  g.fillRect(114, 22, 2, 2);
  return toTexture(c);
}

export function brassPlateTex(text, sub = '') {
  const W = 256, H = 56;
  const [c, g] = makeCanvas(W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#f3d98a');
  grad.addColorStop(0.45, '#b8913f');
  grad.addColorStop(0.55, '#a07a2c');
  grad.addColorStop(1, '#e8c66e');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#6f531c';
  g.lineWidth = 2;
  g.strokeRect(4, 4, W - 8, H - 8);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${sub ? 26 : 30}px Georgia, "Times New Roman", serif`;
  g.fillStyle = '#fbe6a6';
  g.fillText(text, W / 2 + 1, (sub ? 23 : H / 2) + 1);
  g.fillStyle = '#3d2c0c';
  g.fillText(text, W / 2, sub ? 23 : H / 2);
  if (sub) {
    g.font = '16px VT323, monospace';
    g.fillText(sub.split('').join(' '), W / 2, 44);
  }
  return toTexture(c);
}

export function skyTex() {
  const W = 256, H = 160;
  const stops = [
    [0.0, '#1d1840'], [0.22, '#3a2660'], [0.4, '#8a3f72'], [0.54, '#e0685a'], [0.64, '#ffa060'], [0.72, '#ffd08a'], [1.0, '#ffe0a0'],
  ].map(([t, col]) => [t, hexToRgb(col)]);
  const sample = (t) => {
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const a = stops[i - 1], b = stops[i];
        return mixc(a[1], b[1], (t - a[0]) / (b[0] - a[0]));
      }
    }
    return stops[stops.length - 1][1];
  };
  const sunX = W * 0.47, sunY = H * 0.6;
  const [c] = paint(W, H, (x, y) => {
    const t = y / H;
    let col = sample(t);
    const cl = fbm(x / 60, y / 5, 1e3, 1e3, 5, 4);
    const band = Math.max(0, cl - 0.55) * 2.6 * (t > 0.2 && t < 0.58 ? 1 : 0);
    col = mixc(col, t < 0.42 ? hexToRgb('#6a2f5e') : hexToRgb('#ff8f6a'), clamp(band, 0, 0.8));
    const d = Math.hypot((x - sunX) / 1.0, (y - sunY) / 1.0);
    if (d < 9) col = [255, 245, 214];
    else col = mixc(col, [255, 210, 150], clamp(1 - d / 60, 0, 1) * 0.6);
    if (t < 0.32 && hash2(x, y, 41) > 0.996) col = [255, 240, 220];
    return col;
  });
  return toTexture(c, { mip: false });
}

export function skylineTex(seed = 3, { color = '#2a1636', lit = 0.3, far = false } = {}) {
  const W = 512, H = 128;
  const [c, g] = makeCanvas(W, H);
  const r = rng(seed);
  g.clearRect(0, 0, W, H);
  let x = 0;
  const windows = [];
  while (x < W) {
    const bw = r.int(14, 46);
    const bh = far ? r.int(20, 70) : r.int(30, 118);
    g.fillStyle = color;
    g.fillRect(x, H - bh, bw, bh);
    if (r.chance(0.3)) g.fillRect(x + bw / 2 - 1, H - bh - r.int(6, 18), 2, 18);
    if (r.chance(0.18) && !far) {
      g.fillRect(x + 4, H - bh - 8, 10, 8);
      g.fillRect(x + 6, H - bh - 11, 6, 3);
    }
    if (r.chance(0.2)) {
      g.fillRect(x + 3, H - bh - 4, bw - 6, 4);
    }
    for (let wy = H - bh + 5; wy < H - 4; wy += 5) {
      for (let wx = x + 3; wx < x + bw - 3; wx += 4) {
        if (r() < lit) windows.push([wx, wy, r.pick(['#ffd27a', '#ffbe5c', '#ffe7a8', '#a9c7ff'])]);
      }
    }
    x += bw + r.int(0, 6);
  }
  for (const [wx, wy, col] of windows) {
    g.fillStyle = col;
    g.fillRect(wx, wy, 2, 2);
  }
  return toTexture(c, { mip: false });
}

export function clockFaceTex() {
  const S = 128;
  const [c, g] = makeCanvas(S, S);
  g.fillStyle = '#efe4c8';
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 1, 0, TAU);
  g.fill();
  g.strokeStyle = '#2a2116';
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = '#2a2116';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * TAU;
    const big = i % 5 === 0;
    const r0 = S / 2 - (big ? 13 : 8), r1 = S / 2 - 5;
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate(a);
    g.fillRect(-(big ? 1.5 : 0.5), -r1, big ? 3 : 1, r1 - r0);
    g.restore();
  }
  g.font = 'bold 15px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  ['XII', 'III', 'VI', 'IX'].forEach((t, i) => {
    const a = (i / 4) * TAU;
    g.fillText(t, S / 2 + Math.sin(a) * 38, S / 2 - Math.cos(a) * 38);
  });
  g.font = '10px VT323, monospace';
  g.fillText('McKEE & CO.', S / 2, S / 2 + 20);
  return toTexture(c);
}

export function calendarTex(date = new Date()) {
  const W = 96, H = 128;
  const [c, g] = makeCanvas(W, H);
  paperBase(g, W, H, '#f3eee0');
  g.fillStyle = '#9b2b1f';
  g.fillRect(0, 0, W, 26);
  g.fillStyle = '#fff3dc';
  g.textAlign = 'center';
  g.font = '16px VT323, monospace';
  const month = date.toLocaleString('en-US', { month: 'long' }).toUpperCase();
  g.fillText(month, W / 2, 13);
  g.font = '12px VT323, monospace';
  g.fillText(String(date.getFullYear()), W / 2, 23);
  const first = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  g.font = '9px VT323, monospace';
  g.fillStyle = '#555';
  'SMTWTFS'.split('').forEach((d, i) => g.fillText(d, 8 + i * 13, 36));
  for (let d = 1; d <= days; d++) {
    const idx = first + d - 1;
    const cx = 8 + (idx % 7) * 13, cy = 48 + Math.floor(idx / 7) * 14;
    g.fillStyle = idx % 7 === 0 ? '#9b2b1f' : '#2b2b2b';
    g.font = '11px VT323, monospace';
    g.fillText(String(d), cx, cy);
    if (d === date.getDate()) {
      g.strokeStyle = '#c0392b';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(cx, cy - 3, 6, 0, TAU);
      g.stroke();
    }
  }
  return toTexture(c);
}

export function certificateTex() {
  const W = 192, H = 132;
  const [c, g] = makeCanvas(W, H);
  paperBase(g, W, H, '#efe7cf');
  g.strokeStyle = '#2f6b4f';
  for (let i = 0; i < 3; i++) {
    g.lineWidth = i === 1 ? 3 : 1;
    g.strokeRect(5 + i * 4, 5 + i * 4, W - 10 - i * 8, H - 10 - i * 8);
  }
  g.lineWidth = 1;
  g.beginPath();
  for (let x = 20; x < W - 20; x++) {
    const y = 22 + Math.sin(x * 0.4) * 2;
    x === 20 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
  g.fillStyle = '#1f3b2b';
  g.textAlign = 'center';
  g.font = 'bold 13px Georgia, serif';
  g.fillText('THE COMPOUNDING COMPANY', W / 2, 40);
  g.font = '11px VT323, monospace';
  g.fillText('STOCK CERTIFICATE', W / 2, 52);
  g.strokeStyle = '#2f6b4f';
  g.beginPath();
  g.ellipse(W / 2, 80, 30, 18, 0, 0, TAU);
  g.stroke();
  for (let i = 0; i < 9; i++) {
    g.beginPath();
    g.ellipse(W / 2, 80, 26 - i * 2.6, 15 - i * 1.5, 0, 0, TAU);
    g.stroke();
  }
  g.font = 'bold 11px Georgia, serif';
  g.fillText('ONE HUNDRED SHARES', W / 2, 112);
  g.fillText('100', 26, 34);
  g.fillText('100', W - 26, 34);
  return toTexture(c);
}

export function samplerTex() {
  const W = 120, H = 80;
  const [c, g] = makeCanvas(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    g.fillStyle = (x + y) % 2 ? '#e8dcc0' : '#ded1b2';
    g.fillRect(x, y, 1, 1);
  }
  // Rasterise text, then re-draw as cross-stitch pixels.
  const [tc, tg] = makeCanvas(W, H);
  tg.fillStyle = '#000';
  tg.textAlign = 'center';
  tg.font = '13px VT323, monospace';
  tg.fillText('PRICE IS WHAT', W / 2, 24);
  tg.fillText('YOU PAY.', W / 2, 35);
  tg.fillText('VALUE IS WHAT', W / 2, 52);
  tg.fillText('YOU GET.', W / 2, 63);
  const d = tg.getImageData(0, 0, W, H).data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (d[(y * W + x) * 4 + 3] > 110) {
      g.fillStyle = y < 40 ? '#8c1c13' : '#1f3b2b';
      g.fillRect(x, y, 1, 1);
    }
  }
  g.fillStyle = '#b8913f';
  for (let x = 4; x < W - 4; x += 4) {
    g.fillRect(x, 4, 2, 2);
    g.fillRect(x, H - 6, 2, 2);
  }
  for (let y = 4; y < H - 4; y += 4) {
    g.fillRect(4, y, 2, 2);
    g.fillRect(W - 6, y, 2, 2);
  }
  return toTexture(c);
}

export function paintingTex() {
  const W = 160, H = 108;
  const sky = [[0, '#2d2850'], [0.55, '#c0607a'], [1, '#ffbf73']].map(([t, col]) => [t, hexToRgb(col)]);
  const [c] = paint(W, H, (x, y) => {
    const t = y / (H * 0.62);
    let col = t < 0.55 ? mixc(sky[0][1], sky[1][1], t / 0.55) : mixc(sky[1][1], sky[2][1], clamp((t - 0.55) / 0.45, 0, 1));
    const m1 = H * 0.5 + Math.sin(x * 0.05) * 9 + Math.sin(x * 0.13 + 1) * 4;
    const m2 = H * 0.6 + Math.sin(x * 0.08 + 2) * 6 + Math.sin(x * 0.21) * 3;
    if (y > m1) col = hexToRgb('#5b3a5e');
    if (y > m2) col = hexToRgb('#3a2846');
    if (y > H * 0.72) {
      const ref = H * 0.72 - (y - H * 0.72);
      col = mixc(hexToRgb('#3d3a5a'), hexToRgb('#e08a6a'), clamp(1 - (y - H * 0.72) / 20, 0, 1) * 0.6);
      if (Math.abs(x - W * 0.62) < 6 - (y - H * 0.72) * 0.15 && (y % 3 === 0)) col = hexToRgb('#ffd29a');
      void ref;
    }
    if (y > H * 0.86) col = hexToRgb('#2a2234');
    const n = hash2(x >> 1, y >> 1, 6) * 0.12 - 0.06;
    return shade(col, 1 + n);
  });
  return toTexture(c);
}

export function doorGlassTex() {
  const W = 128, H = 128;
  const [c, g] = makeCanvas(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = 0.86 + hash2(x >> 1, y >> 1, 12) * 0.14;
    g.fillStyle = css(shade([236, 226, 200], k));
    g.fillRect(x, y, 1, 1);
  }
  g.save();
  g.translate(W, 0);
  g.scale(-1, 1); // lettering reads correctly from the hallway, mirrored from inside
  g.fillStyle = '#b8913f';
  g.textAlign = 'center';
  g.font = 'bold 15px Georgia, serif';
  g.fillText('JOSH McKEE', W / 2, 52);
  g.fillRect(W / 2 - 36, 58, 72, 1);
  g.font = '12px VT323, monospace';
  g.fillText('INVESTMENT RESEARCH', W / 2, 72);
  g.restore();
  return toTexture(c);
}

export function cassetteTex({ label, color = '#c0392b', seed = 1 }) {
  const W = 96, H = 60;
  const [c, g] = makeCanvas(W, H);
  g.fillStyle = '#2a2826';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#383532';
  g.fillRect(2, 2, W - 4, H - 4);
  g.fillStyle = '#f2ead6';
  g.fillRect(6, 5, W - 12, 36);
  g.fillStyle = color;
  g.fillRect(6, 5, W - 12, 8);
  g.fillStyle = '#1b1b1b';
  g.textAlign = 'center';
  const words = label.split(' ');
  const half = Math.ceil(words.length / 2);
  const lines = words.length > 1 ? [words.slice(0, half).join(' '), words.slice(half).join(' ')] : [label];
  let size = 16;
  g.font = `${size}px VT323, monospace`;
  while (Math.max(...lines.map((l) => g.measureText(l).width)) > W - 14 && size > 10) {
    size--;
    g.font = `${size}px VT323, monospace`;
  }
  lines.forEach((l, i) => g.fillText(l, W / 2, lines.length > 1 ? 20 + i * 11 : 25));
  g.fillStyle = '#20201e';
  g.fillRect(30, 33, 36, 8);
  g.fillStyle = '#d9d3c4';
  g.beginPath();
  g.arc(38, 37, 3, 0, TAU);
  g.arc(58, 37, 3, 0, TAU);
  g.fill();
  g.fillStyle = '#4a4744';
  g.fillRect(16, 46, W - 32, 10);
  g.fillStyle = '#6a6762';
  [[6, 46], [W - 10, 46], [6, 4], [W - 10, 4]].forEach(([x, y]) => g.fillRect(x, y, 3, 3));
  void seed;
  return toTexture(c);
}

export function hifiTex() {
  const W = 256, H = 64;
  const [c, g] = makeCanvas(W, H);
  const [e, eg] = makeCanvas(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = 0.78 + fbm(x / 128, y / 1.2, 2, 53, 4, 2) * 0.22;
    g.fillStyle = css(shade([196, 192, 182], k));
    g.fillRect(x, y, 1, 1);
  }
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, W, H);
  // tuning dial
  g.fillStyle = '#141210';
  g.fillRect(8, 8, 120, 22);
  eg.fillStyle = '#ffae3a';
  eg.fillRect(9, 9, 118, 20);
  eg.fillStyle = '#5a2a00';
  for (let x = 12; x < 124; x += 6) eg.fillRect(x, 12, 1, x % 18 === 0 ? 6 : 3);
  eg.font = '8px VT323, monospace';
  eg.fillStyle = '#6a3000';
  ['88', '92', '96', '100', '104', '108'].forEach((t, i) => eg.fillText(t, 12 + i * 20, 26));
  eg.fillStyle = '#ff3a1a';
  eg.fillRect(78, 9, 2, 20);
  // VU meters
  for (let m = 0; m < 2; m++) {
    const x0 = 136 + m * 30;
    g.fillStyle = '#141210';
    g.fillRect(x0, 8, 26, 22);
    eg.fillStyle = '#ffd890';
    eg.fillRect(x0 + 1, 9, 24, 20);
    eg.fillStyle = '#2a1a00';
    eg.fillRect(x0 + 12, 12, 1, 15);
  }
  // knobs and buttons
  g.fillStyle = '#2a2826';
  [[24, 46], [56, 46], [210, 20]].forEach(([x, y]) => {
    g.beginPath();
    g.arc(x, y, x === 210 ? 12 : 8, 0, TAU);
    g.fill();
  });
  g.fillStyle = '#8f8b80';
  [[24, 46], [56, 46], [210, 20]].forEach(([x, y]) => g.fillRect(x - 1, y - (x === 210 ? 10 : 6), 2, 4));
  g.fillStyle = '#3a3836';
  for (let b = 0; b < 6; b++) g.fillRect(80 + b * 14, 42, 10, 8);
  // cassette door
  g.fillStyle = '#1e1c1a';
  g.fillRect(196, 36, 52, 24);
  g.fillStyle = '#3a3532';
  g.fillRect(200, 40, 44, 16);
  g.fillStyle = '#c94f3a';
  g.font = '8px VT323, monospace';
  g.fillText('STEREO CASSETTE', 136, 40);
  eg.fillStyle = '#39ff6a';
  eg.fillRect(70, 48, 3, 3);
  return { map: toTexture(c), emissive: toTexture(e) };
}

export function globeTex() {
  const W = 256, H = 128;
  const [c, g] = makeCanvas(W, H);
  g.fillStyle = '#86a49c';
  g.fillRect(0, 0, W, H);
  const P = (lon, lat) => [((lon + 180) / 360) * W, ((90 - lat) / 180) * H];
  const land = [
    // North America
    ['#d9b77a', [[-168, 66], [-155, 71], [-130, 70], [-95, 72], [-78, 70], [-62, 60], [-55, 52], [-66, 45], [-75, 38], [-81, 31], [-80, 25], [-90, 29], [-97, 26], [-97, 20], [-87, 21], [-83, 10], [-79, 8], [-92, 15], [-105, 20], [-112, 30], [-118, 34], [-124, 41], [-125, 49], [-135, 58], [-152, 59], [-165, 60]]],
    // Greenland
    ['#e8e0c8', [[-73, 78], [-40, 83], [-20, 80], [-20, 70], [-42, 60], [-52, 65], [-58, 74]]],
    // South America
    ['#c98f6b', [[-80, 10], [-62, 11], [-50, 0], [-35, -6], [-39, -15], [-48, -26], [-58, -35], [-65, -42], [-68, -54], [-74, -50], [-72, -36], [-70, -18], [-80, -6], [-77, 2]]],
    // Europe
    ['#a9b06b', [[-10, 36], [-9, 43], [-2, 48], [-5, 50], [2, 51], [8, 54], [5, 60], [15, 69], [28, 71], [40, 66], [40, 48], [30, 45], [26, 40], [18, 40], [15, 45], [8, 44], [3, 43], [-2, 37]]],
    // Africa
    ['#d9a36a', [[-17, 21], [-8, 34], [10, 37], [32, 31], [35, 28], [43, 12], [51, 12], [40, -3], [40, -15], [35, -25], [20, -35], [15, -28], [12, -15], [9, -2], [9, 4], [-8, 5], [-16, 12]]],
    // Asia
    ['#c9a15f', [[26, 41], [36, 36], [35, 30], [43, 13], [55, 22], [60, 25], [67, 25], [73, 20], [78, 8], [82, 16], [91, 22], [98, 16], [100, 3], [105, 10], [108, 22], [121, 30], [122, 40], [130, 43], [140, 50], [142, 60], [160, 62], [180, 66], [180, 72], [140, 73], [100, 78], [70, 73], [50, 68], [40, 66], [40, 48], [30, 45]]],
    // Arabia
    ['#d9b77a', [[35, 30], [48, 30], [57, 24], [59, 22], [52, 16], [44, 12], [38, 20]]],
    // Australia
    ['#d98f5a', [[114, -22], [122, -18], [131, -12], [137, -12], [142, -11], [146, -19], [153, -26], [151, -34], [145, -38], [138, -35], [130, -32], [116, -35], [114, -28]]],
    // Japan, UK, Madagascar, Indonesia, NZ, Antarctica
    ['#a9b06b', [[130, 31], [136, 34], [141, 37], [142, 43], [140, 41], [134, 34]]],
    ['#a9b06b', [[-5, 50], [1, 51], [-1, 54], [-3, 58], [-6, 57]]],
    ['#d9a36a', [[44, -25], [47, -25], [50, -15], [49, -12], [44, -17]]],
    ['#c9a15f', [[95, 5], [105, -6], [115, -8], [120, -9], [110, -3], [104, 1]]],
    ['#c9a15f', [[131, -1], [141, -3], [150, -10], [141, -9]]],
    ['#a9b06b', [[167, -46], [174, -41], [178, -38], [173, -35], [172, -41]]],
    ['#e8e0c8', [[-180, -72], [180, -72], [180, -90], [-180, -90]]],
  ];
  for (const [col, pts] of land) {
    g.fillStyle = col;
    g.strokeStyle = '#5a4630';
    g.beginPath();
    pts.forEach(([lon, lat], i) => {
      const [x, y] = P(lon, lat);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.closePath();
    g.fill();
    g.stroke();
  }
  g.strokeStyle = 'rgba(60,40,20,0.25)';
  for (let lon = -180; lon <= 180; lon += 30) {
    const [x] = P(lon, 0);
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const [, y] = P(0, lat);
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  // antique varnish
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const k = 0.9 + hash2(i, 7, 3) * 0.1;
    img.data[i] = img.data[i] * k * 1.02;
    img.data[i + 1] = img.data[i + 1] * k * 0.98;
    img.data[i + 2] = img.data[i + 2] * k * 0.86;
  }
  g.putImageData(img, 0, 0);
  return toTexture(c);
}

export function labelTex(text, { w = 64, h = 20, bg = '#efe8d4', fg = '#2b2b2b', font = 'VT323', size = 14 } = {}) {
  const [c, g] = makeCanvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${size}px ${font}, monospace`;
  g.fillText(text, w / 2, h / 2 + 1);
  return toTexture(c);
}

export function calculatorTex() {
  const W = 96, H = 52;
  const [c, g] = makeCanvas(W, H);
  g.fillStyle = '#3a2f24';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#b8913f';
  g.fillRect(0, 0, W, 3);
  g.fillStyle = '#9aa48a';
  g.fillRect(6, 6, 40, 9);
  g.fillStyle = '#222';
  g.font = '9px VT323, monospace';
  g.fillText('12C', 70, 12);
  for (let row = 0; row < 4; row++) for (let k = 0; k < 10; k++) {
    g.fillStyle = '#1b1a18';
    g.fillRect(4 + k * 9, 20 + row * 8, 7, 6);
    g.fillStyle = k > 6 && row < 2 ? '#c9a15f' : '#4a4540';
    g.fillRect(4 + k * 9, 20 + row * 8, 7, 1);
  }
  return toTexture(c);
}

export function filingLabelTex(text) {
  return labelTex(text, { w: 64, h: 22, bg: '#f2ecd8', fg: '#1b1b1b', size: 16 });
}
