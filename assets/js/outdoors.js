import * as THREE from '../vendor/three.module.min.js';
import { SUN_DIR, ROOM, WIN } from './layout.js';
import { rng, clamp, lerp, TAU, dynamic, mergeStatic } from './util.js';
import * as T from './textures.js';

/* ==================================================================
   The view out of the window. The office is a chalet on a cliff edge
   high above an alpine valley at golden hour: a glass-fronted balcony
   over the drop, the neighbours' chalets out along the cliff tops, a
   village on the valley floor and, across the valley, the ski mountain.
   Rendered in its own pass (true scale, own near/far planes) and seen
   only through the window opening. Units are metres; the window wall is
   at z = ROOM.z0, "d" is the distance out from it and y = 0 is the
   office floor. The sun is low behind the far mountains, so the slopes
   facing us sit in blue skylight while our side of the valley is warm.
   ================================================================== */

const VALLEY_Y = -450; // the valley floor, 450 m below the office
const TREELINE_Y = 0; // where the forest gives out
const { smoothstep } = THREE.MathUtils;

/* ---------------- noise ---------------- */

/** Integer lattice hash to 0..1 (much quicker than the usual sine trick, and this runs millions of times). */
const hash = (x, y) => {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function ridged(x, y, oct = 5) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1);
    s += n * n * a;
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

const ND = [0, 0, 0];
/** Value noise in -1..1 and its two partial derivatives (written into a shared array). */
function noised(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const du = 6 * xf * (1 - xf), dv = 6 * yf * (1 - yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  const k = a - b - c + d;
  ND[0] = 2 * (a + (b - a) * u + (c - a) * v + k * u * v) - 1;
  ND[1] = 2 * du * (b - a + k * v);
  ND[2] = 2 * dv * (c - a + k * u);
  return ND;
}

/**
 * Fractal noise that adds less fine detail where it's already steep, so it reads as eroded rock:
 * sharp ridges and spurs, smooth gullies (after Inigo Quilez). Roughly -1..1. Octaves past the
 * third are scaled by `tail`, which is how groomed runs lose their bumps.
 */
function eroded(x, y, oct, tail = 1) {
  let a = 0, b = 1, gx = 0, gy = 0;
  for (let i = 0; i < oct; i++) {
    const n = noised(x, y);
    gx += n[1];
    gy += n[2];
    a += ((i < 3 ? b : b * tail) * n[0]) / (1 + gx * gx + gy * gy);
    b *= 0.5;
    const t = 1.6 * x - 1.2 * y;
    y = 1.2 * x + 1.6 * y;
    x = t;
  }
  return a;
}

/* ---------------- layout ---------------- */

/** The far side of the valley rises from FAR.foot over FAR.span to a ridge; the ski mountain's summit is mid-ridge. */
const FAR = { foot: 1000, span: 1900 };
/** Mountains standing out at either end of the valley: [x, d, height, radius]. */
const PEAKS = [
  [-2050, 2120, 800, 750],
  [2250, 2270, 900, 850],
];

/** Ski runs on the far mountain as plan-view polylines [x, d] from the top down to the base, with widths. */
const RUNS = [
  { w: 46, pts: [[150, 2600], [90, 2320], [170, 2040], [80, 1770], [150, 1520], [70, 1270], [60, 1060]] },
  { w: 40, pts: [[-60, 2570], [-170, 2300], [-90, 2040], [-220, 1780], [-140, 1520], [-230, 1280], [-120, 1070]] },
  { w: 42, pts: [[380, 2610], [460, 2340], [360, 2070], [460, 1810], [340, 1550], [260, 1300], [130, 1070]] },
  { w: 38, pts: [[700, 2620], [760, 2320], [640, 2040], [740, 1770], [600, 1500], [420, 1240], [200, 1080]] },
  { w: 36, pts: [[-480, 2520], [-600, 2240], [-500, 1970], [-620, 1700], [-480, 1440], [-330, 1200], [-180, 1080]] },
];
/** Chairlifts, bottom station to top. */
const LIFTS = [
  { from: [20, 1040], to: [120, 2580] },
  { from: [-270, 1060], to: [-530, 2480] },
];

/** The ski area's base at the foot of the runs, and the village on the valley floor in front of it. */
const BASE = { x: -40, d: 1015 };
/**
 * The village sits on a sunny shelf partway up the far side, like the terrace villages above an
 * alpine valley floor: high enough to be seen over the balcony rail from inside the office.
 */
const VILLAGE = { x: -250, d: 1950, rx: 390, rd: 62, y: -45 };

/** The neighbours' chalets, out along the cliff top on either side: [x, d, width, depth, turn]. */
const CHALETS = [
  [-100, 128, 15, 11, 0.15],
  [96, 118, 16, 12, -0.2],
  [-150, 182, 14, 10, 0.3],
  [140, 170, 15, 11, -0.35],
];

/** The balcony outside the window, cantilevered out to the cliff edge: boards at y = -0.25, snow on top, a glass balustrade. */
const TERRACE = { x0: -12, x1: 12, d0: 0.2, d1: 3.0, snow: -0.1, rail: 1.05 };
/**
 * The chalet itself, round the office: its outside walls stand just beyond the room's, the roof's
 * ridge runs across, and its eave overhangs the window by `eave` metres at height `eaveY`.
 */
export const CHALET = { x0: ROOM.x0 - 0.3, x1: ROOM.x1 + 0.3, z0: ROOM.z0 - 0.3, z1: ROOM.z1 + 0.3, wallTop: 4.1, eave: 1.25, eaveY: 3.62, pitch: 0.44, overX: 1.2 };
/**
 * Outside, the office is drawn into the same picture through its door and window. Everything solid
 * close to the chalet (its walls, the balcony, the yard and its trees) is also put in this layer,
 * so it can go into the depth buffer first and keep the office from showing through it.
 */
export const NEAR_LAYER = 1;
/** The door in the office's side wall (x = ROOM.x1), as the room builds it. */
const DOOR = { z0: 0.65, z1: 1.6, h: 2.1 };
const STEP_Y = -0.2; // top of the step outside it, halfway down to the yard

/** Big spruces on the cliff tops either side: [x, d, height]. */
const NEAR_TREES = [[-60, 80, 18], [65, 90, 17], [-75, 100, 19], [80, 110, 20], [-45, 40, 16], [48, 45, 17], [-30, 14, 15], [32, 16, 16],
  [-13, -15, 15], [11, -21, 17], [-21, -31, 19], [21, -9, 14], [-8, -38, 18], [17, -37, 16], [-30, -8, 17], [29, -26, 18]];

/* ---------------- runs and lift lines ---------------- */

const runCurves = RUNS.map((r) => {
  const c = new THREE.CatmullRomCurve3(r.pts.map(([x, d]) => new THREE.Vector3(x, 0, d)), false, 'centripetal');
  const length = c.getLength();
  return { ...r, curve: c, samples: c.getSpacedPoints(Math.ceil(length / 6)), length };
});

/**
 * Clearance grid over the ski area, 8 m cells: [distance from the nearest run edge (negative
 * inside a run), distance from the nearest lift line]. Runs are splatted into the cells around
 * them with a wandering width so their edges aren't ruled lines. The shader samples it too.
 */
const RG = { x0: -900, d0: 960, cell: 8, nx: 250, nd: 220, cap: 60 };
const clearGrid = (() => {
  const g = new Float32Array(RG.nx * RG.nd * 2).fill(RG.cap);
  const splat = (px, pd, w, ch) => {
    const reach = w + RG.cap;
    const i0 = Math.max(0, Math.floor((px - reach - RG.x0) / RG.cell)), i1 = Math.min(RG.nx - 1, Math.ceil((px + reach - RG.x0) / RG.cell));
    const j0 = Math.max(0, Math.floor((pd - reach - RG.d0) / RG.cell)), j1 = Math.min(RG.nd - 1, Math.ceil((pd + reach - RG.d0) / RG.cell));
    for (let j = j0; j <= j1; j++) {
      const dz = RG.d0 + j * RG.cell - pd;
      for (let i = i0; i <= i1; i++) {
        const dd = Math.hypot(RG.x0 + i * RG.cell - px, dz) - w;
        const k = (j * RG.nx + i) * 2 + ch;
        if (dd < g[k]) g[k] = dd;
      }
    }
  };
  runCurves.forEach((r, ri) => r.samples.forEach((p, k) => splat(p.x, p.z, r.w * (0.82 + 0.36 * vnoise(k * 0.06, ri * 7.3)), 0)));
  for (const { from: [ax, ad], to: [bx, bd] } of LIFTS) {
    const n = Math.ceil(Math.hypot(bx - ax, bd - ad) / 5);
    for (let k = 0; k <= n; k++) splat(lerp(ax, bx, k / n), lerp(ad, bd, k / n), 0, 1);
  }
  return g;
})();
function clearAt(x, d, ch) {
  const fx = (x - RG.x0) / RG.cell, fd = (d - RG.d0) / RG.cell;
  if (fx < 0 || fd < 0 || fx >= RG.nx - 1 || fd >= RG.nd - 1) return RG.cap;
  const i = Math.floor(fx), j = Math.floor(fd), a = fx - i, b = fd - j;
  const k = (j * RG.nx + i) * 2 + ch, k2 = k + RG.nx * 2, g = clearGrid;
  return (g[k] * (1 - a) + g[k + 2] * a) * (1 - b) + (g[k2] * (1 - a) + g[k2 + 2] * a) * b;
}
export const runClearance = (x, d) => clearAt(x, d, 0);
const groomAt = (x, d) => smoothstep(-runClearance(x, d), -10, 4);

/* ---------------- the ground ---------------- */

/** Where our cliff top ends, as a distance out: just past the balcony in front, the rim swinging out on either side. */
function rimAt(x) {
  const a = Math.abs(x);
  return a < 35 ? 3.4 + 0.05 * a * a : Math.min(64.65 + 1.2 * (a - 35), 220);
}
/** How far past the rim (x, d) is; negative on the cliff top. Buttresses and gullies along it, but straight under the balcony. */
const pastRim = (x, d) => d - rimAt(x) - ((vnoise(x / 7, 3.3) - 0.5) * 2.5 + (vnoise(x / 19 + 5, 1.7) - 0.5) * 9) * smoothstep(Math.abs(x), 6, 16);

/** The cliff top is a spur: level by the chalet, falling away beyond the neighbours on either side. */
function cliffTop(x) {
  const k = Math.max(0, Math.abs(x) - 90);
  return Math.max(VALLEY_Y + 5, -0.4 - (0.3 * k * k) / (k + 60));
}

/** Our side of the valley: the cliff top the chalet stands on, a sheer drop, then scree and forest down to the valley floor. */
/**
 * Behind the chalet the mountainside carries on up: a gentle rise over the yard, a long wooded
 * slope, then steep rock to a ridge some 400-550 m above, its foot and height wandering along it.
 */
function behindRise(x, d) {
  if (d >= -10) return 0;
  const b = -d;
  let h = smoothstep(b, 10, 45) * 5 + clamp(b - 45, 0, 260) * 0.3;
  const foot = 300 + (vnoise(x / 380 + 4, 0.7) - 0.5) * 180;
  const k = smoothstep(b, foot, foot + 600);
  // spurs and gullies running down the face, and a ragged crest of separate summits
  const spurs = ridged(x / 170 + 2.3, b / 420 + 0.6, 4);
  h += k * (260 + 230 * vnoise(x / 520 + 1.3, 2.2) + 160 * (spurs - 0.45)) * (1 + 0.3 * eroded(x / 260 + 5.1, b / 260 + 2.7, 5));
  return h;
}

/** How thickly the slope behind the chalet is wooded: none round the yard, thinning out up toward the rock. */
function backForest(x, d, y, normalY) {
  if (d > -70) return 0;
  const patches = 0.65 * vnoise(x / 110 + 3, d / 110 + 1) + 0.35 * vnoise(x / 35 + 8, d / 35 + 5);
  return smoothstep(-d, 70, 150) * (1 - smoothstep(y, 260, 360)) * smoothstep(patches, 0.25, 0.5) * smoothstep(normalY, 0.6, 0.78);
}

function cliffside(x, d) {
  const top = cliffTop(x), s = pastRim(x, d);
  const behind = behindRise(x, d);
  if (s <= 0) return top + behind + (vnoise(x / 23, d / 23) - 0.5) * 0.8 * smoothstep(Math.hypot(x, d), 10, 30);
  // the wall wavers as it drops, so it isn't a clean extrusion of the rim
  const sw = s + (vnoise(x / 5 + 2, d / 5) - 0.5) * 3 * smoothstep(s, 0, 3);
  return top - (top - VALLEY_Y) * (0.55 * (1 - Math.exp(-Math.max(0, sw) / 26)) + 0.45 * smoothstep(s, 30, 480));
}

/**
 * Across the valley, height above the valley floor: a mountainside easing up from the floor to a
 * ridge (slopes of 25-30 degrees, good for skiing), ribs and gullies running down the fall line.
 */
function farside(x, d, groom) {
  const foot = FAR.foot + (vnoise(x / 700 + 7, 0.3) - 0.5) * 200;
  const crest = 430 + 330 * Math.exp(-(((x - 120) / 700) ** 2)) + (vnoise(x / 450 + 3, 1.5) - 0.5) * 260;
  const t = clamp((d - foot) / FAR.span, 0, 1);
  let h = crest * t * t * (3 - 2 * t);
  for (const [px, pd, A, R] of PEAKS) h += A * Math.exp(-Math.pow(Math.hypot(x - px, d - pd) / R, 1.3)) * smoothstep(d, FAR.foot - 80, FAR.foot + 520);
  return h * (1 + 0.3 * eroded(x / 260 + 11.3, d / 600 + 4.1, 5, 1 - groom * 0.85));
}

/** Ground height (world y) at (x, d). Runs keep the mountain's broad shape but lose its bumps. */
function ground(x, d, groom = groomAt(x, d)) {
  const far = farside(x, d, groom), s = pastRim(x, d);
  let y = cliffside(x, d) + far;
  // folds and gullies down the scree below our cliff
  y += eroded(x / 300 + 5.3, d / 300 + 1.1, 4) * 30 * smoothstep(s, 20, 80) * (1 - smoothstep(s, 300, 480));
  // the village's shelf: the slope eases out nearly flat for a few hundred metres
  const shelf = 1 - smoothstep(Math.hypot((x - VILLAGE.x) / (VILLAGE.rx * 1.3), (d - VILLAGE.d) / (VILLAGE.rd * 3)), 0.35, 1.25);
  if (shelf > 0) y = lerp(y, VILLAGE.y, shelf * 0.85);
  // crags and hummocks; the cliff top stays smooth snow
  const fine = (ridged(x / 80, d / 80, 3) - 0.42) * (2 + far * 0.015) + (vnoise(x / 26, d / 26) - 0.5) * 1.6 + (vnoise(x / 300 + 2, d / 300) - 0.5) * 6;
  return y + fine * (1 - groom * 0.92) * (1 - shelf * 0.8) * (s < 0 ? 0.1 * smoothstep(Math.hypot(x, d), 20, 40) : smoothstep(s, 0, 6));
}

export function heightAt(x, d) {
  return ground(x, d);
}

/**
 * Where trees grow (0..1), given the ground height and how level it is (normal.y). `cuts` adds the
 * runs and lift lines; the terrain shader does those per pixel instead, so they stay crisp.
 */
function forestDensity(x, d, y, ny, cuts = true) {
  const tl = TREELINE_Y + (vnoise(x / 240 + 9, d / 240) - 0.5) * 110; // a ragged treeline
  let f = 1 - smoothstep(y, tl - 60, tl + 10);
  if (f <= 0) return 0;
  if (cuts) f *= smoothstep(runClearance(x, d), 0.5, 6) * smoothstep(clearAt(x, d, 1), 7, 12);
  f *= smoothstep(ny, 0.68, 0.8); // nothing grows on cliffs
  f *= smoothstep(vnoise(x / 190 + 2, d / 190 + 5), 0.14, 0.34); // glades
  // our cliff top: stands of spruce, kept clear around the chalet
  if (d < 400 && pastRim(x, d) < 0) f *= smoothstep(vnoise(x / 40 + 3, d / 40), 0.35, 0.55) * smoothstep(Math.hypot(x, d), 25, 45);
  // the valley floor is fields, with copses; the village and the base area are open
  const floor = smoothstep(d, 470, 560) * (1 - smoothstep(d, FAR.foot, FAR.foot + 140));
  if (floor > 0) f *= lerp(1, smoothstep(vnoise(x / 220 + 8, d / 220), 0.55, 0.7), floor);
  f *= smoothstep(Math.hypot((x - VILLAGE.x) / VILLAGE.rx, (d - VILLAGE.d) / VILLAGE.rd), 1, 1.3);
  f *= smoothstep(Math.hypot(x - BASE.x, d - BASE.d), 110, 150);
  for (const [cx, cd, w] of CHALETS) {
    const r = Math.hypot(x - cx, d - cd);
    if (r < 60) f *= smoothstep(r, w * 0.7 + 5, w * 0.7 + 18);
  }
  return f;
}

/* ---------------- a coarse height field, for shadows and placing trees ---------------- */

const HF = { x0: -2600, d0: 0, cell: 12, nx: 0, nd: 0, h: null, max: -Infinity };
function buildHeightField(low) {
  HF.cell = low ? 18 : 12;
  HF.nx = Math.floor(5200 / HF.cell) + 1;
  HF.nd = Math.floor(3600 / HF.cell) + 1;
  HF.h = new Float32Array(HF.nx * HF.nd);
  for (let j = 0; j < HF.nd; j++) {
    for (let i = 0; i < HF.nx; i++) {
      const h = ground(HF.x0 + i * HF.cell, HF.d0 + j * HF.cell);
      HF.h[j * HF.nx + i] = h;
      if (h > HF.max) HF.max = h;
    }
  }
}
/** Height field lookup; NaN outside it. */
function hfAt(x, d) {
  const fx = (x - HF.x0) / HF.cell, fd = (d - HF.d0) / HF.cell;
  if (fx < 0 || fd < 0 || fx >= HF.nx - 1 || fd >= HF.nd - 1) return NaN;
  const i = Math.floor(fx), j = Math.floor(fd), a = fx - i, b = fd - j;
  const k = j * HF.nx + i, H = HF.h;
  return (H[k] * (1 - a) + H[k + 1] * a) * (1 - b) + (H[k + HF.nx] * (1 - a) + H[k + HF.nx + 1] * a) * b;
}
function hfNormalY(x, d) {
  const e = HF.cell;
  const sx = (hfAt(x + e, d) - hfAt(x - e, d)) / (2 * e), sd = (hfAt(x, d + e) - hfAt(x, d - e)) / (2 * e);
  return 1 / Math.sqrt(1 + sx * sx + sd * sd);
}

const SUN_PLAN = new THREE.Vector2(SUN_DIR.x, -SUN_DIR.z).normalize(); // a step toward the sun, in (x, d)
const SUN_RISE = SUN_DIR.y / Math.hypot(SUN_DIR.x, SUN_DIR.z); // how fast the sun's ray climbs per metre

/** How much of the sun reaches (x, d) at height y past the terrain in front of it; soft-edged. */
function sunVisibility(x, d, y) {
  let res = 1, s = 10;
  for (let k = 0; k < 90; k++) {
    const ray = y + 1.5 + SUN_RISE * s;
    if (ray > HF.max + 2) break;
    const g = hfAt(x + SUN_PLAN.x * s, d + SUN_PLAN.y * s);
    if (Number.isNaN(g)) break;
    res = Math.min(res, (ray - g) / (s * 0.06));
    if (res <= -0.25) return 0;
    s += 5 + s * 0.05;
  }
  return smoothstep(res, -0.25, 1);
}

/* ---------------- baked shadows of nearby things ---------------- */

/**
 * The sun's shadows of the railing, the near trees and the neighbours' chalets, baked into a
 * texture over (x, d). Each occluder knows the plan box its shadow can reach and whether the ray
 * from a ground point toward the sun hits it.
 */
function bakeShadows(box, groundY, occluders, soften = 1) {
  const nx = Math.ceil((box.x1 - box.x0) / box.cell), nd = Math.ceil((box.d1 - box.d0) / box.cell);
  let data = new Uint8Array(nx * nd).fill(255);
  for (const o of occluders) {
    const [ax, bx, ad, bd] = o.reach;
    const i0 = Math.max(0, Math.floor((ax - box.x0) / box.cell)), i1 = Math.min(nx - 1, Math.ceil((bx - box.x0) / box.cell));
    const j0 = Math.max(0, Math.floor((ad - box.d0) / box.cell)), j1 = Math.min(nd - 1, Math.ceil((bd - box.d0) / box.cell));
    for (let j = j0; j <= j1; j++) {
      const d = box.d0 + (j + 0.5) * box.cell;
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        if (data[k] === 0) continue;
        const x = box.x0 + (i + 0.5) * box.cell;
        const a = o.hit(x, d, groundY(x, d));
        if (a > 0) data[k] = Math.min(data[k], 255 * (1 - a));
      }
    }
  }
  // the sun is a disc, not a point: soften the edges a little (a separable box blur, `soften` texels each way)
  for (const [step, n, len] of [[1, nd, nx], [nx, nx, nd]]) {
    const out = new Uint8Array(data.length);
    for (let line = 0; line < n; line++) {
      const base = step === 1 ? line * nx : line;
      for (let i = 0; i < len; i++) {
        let sum = 0, cnt = 0;
        for (let o = -soften; o <= soften; o++) {
          const j = i + o;
          if (j < 0 || j >= len) continue;
          sum += data[base + j * step];
          cnt++;
        }
        out[base + i * step] = sum / cnt;
      }
    }
    data = out;
  }
  const tex = new THREE.DataTexture(data, nx, nd, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return { tex, box: new THREE.Vector4(box.x0, box.d0, nx * box.cell, nd * box.cell) };
}

/** Plan box a shadow can reach from something standing at (x, d), r wide and `tall` above the ground. */
const shadowReach = (x, d, r, tall) => {
  const L = tall / SUN_RISE;
  return [x - r - Math.max(0, -SUN_PLAN.x * L), x + r + Math.max(0, -SUN_PLAN.x * L), d - r - SUN_PLAN.y * L, d + r];
};
/** A vertical post or baluster, radius r, from y0 to y1. */
const postOccluder = (cx, cd, r, y0, y1, ground) => ({
  reach: shadowReach(cx, cd, r, y1 - ground),
  hit(x, d, g) {
    const s = (cx - x) * SUN_PLAN.x + (cd - d) * SUN_PLAN.y;
    if (s < 0) return 0;
    const y = g + SUN_RISE * s;
    return y > y0 && y < y1 && Math.abs((cx - x) * SUN_PLAN.y - (cd - d) * SUN_PLAN.x) < r ? 1 : 0;
  },
});
/** A rail running along x at distance cd, between heights y0 and y1. */
const railOccluder = (xa, xb, cd, y0, y1, ground) => ({
  reach: [xa - 1, xb + (y1 - ground) / SUN_RISE * Math.abs(SUN_PLAN.x) + 1, cd - (y1 - ground) / SUN_RISE * SUN_PLAN.y - 0.2, cd + 0.1],
  hit(x, d, g) {
    const s = (cd - d) / SUN_PLAN.y;
    if (s < 0) return 0;
    const y = g + SUN_RISE * s, xx = x + SUN_PLAN.x * s;
    return y > y0 && y < y1 && xx > xa && xx < xb ? 1 : 0;
  },
});
/** A spruce: a cone of radius R at the foot, height H; its shadow is dappled. */
const treeOccluder = (cx, cd, y0, H, R) => ({
  reach: shadowReach(cx, cd, R, H + 2),
  hit(x, d, g) {
    const s = (cx - x) * SUN_PLAN.x + (cd - d) * SUN_PLAN.y;
    if (s < 0) return 0;
    const y = g + SUN_RISE * s;
    if (y < y0 + 0.1 * H || y > y0 + H) return 0;
    const r = R * (1 - (y - y0) / H), e = Math.abs((cx - x) * SUN_PLAN.y - (cd - d) * SUN_PLAN.x);
    if (e > r * 1.25) return 0;
    return e < r * (0.75 + 0.5 * vnoise(x * 1.7, d * 1.7)) ? 0.85 : 0;
  },
});
/** A chalet as a box, w x dep, turned by `turn`, from y0 up to y1. */
const boxOccluder = (cx, cd, w, dep, turn, y0, y1) => {
  const c = Math.cos(turn), sn = Math.sin(turn);
  // into the chalet's own frame (x across, d along); a group turned by `turn` about y
  const local = (x, d) => [c * x + sn * d, c * d - sn * x];
  const [ux, ud] = local(SUN_PLAN.x, SUN_PLAN.y);
  return {
    reach: shadowReach(cx, cd, Math.hypot(w, dep) / 2, y1 - y0 + 8),
    hit(x, d, g) {
      const [lx, ld] = local(x - cx, d - cd);
      let s0 = 0, s1 = Infinity;
      for (const [p, u, h] of [[lx, ux, w / 2], [ld, ud, dep / 2]]) {
        if (Math.abs(u) < 1e-6) {
          if (Math.abs(p) > h) return 0;
          continue;
        }
        const ta = (-h - p) / u, tb = (h - p) / u;
        s0 = Math.max(s0, Math.min(ta, tb));
        s1 = Math.min(s1, Math.max(ta, tb));
      }
      return s1 > s0 && g + SUN_RISE * s0 < y1 ? 1 : 0;
    },
  };
};

/* ---------------- light and haze ---------------- */

/** The view is exposed for the warm room it's seen from, so outdoors is scaled down to sit in the window rather than blow out. */
const EXPOSURE = 0.62;
const SUN = { color: new THREE.Color('#ffc994'), intensity: 3.1 * EXPOSURE };
const SKY = { sky: new THREE.Color('#90aee6'), ground: new THREE.Color('#d8d1d6'), intensity: 1.2 * EXPOSURE };

/** Aerial perspective, shared by every outdoor material. */
const HZ = {
  uHzSun: { value: SUN_DIR.clone() },
  uHzFar: { value: new THREE.Color('#9fb2d6').multiplyScalar(EXPOSURE) },
  uHzGlow: { value: new THREE.Color('#ffc58e').multiplyScalar(1.7 * EXPOSURE) },
  uHzDensity: { value: 0.00024 },
  uHzFalloff: { value: 1 / 400 },
  uHzBase: { value: VALLEY_Y },
};
const HAZE_GLSL = /* glsl */ `
uniform vec3 uHzSun, uHzFar, uHzGlow;
uniform float uHzDensity, uHzFalloff, uHzBase;
vec3 hazeColor(vec3 dir) {
  float mu = max(dot(dir, uHzSun), 0.0);
  return mix(uHzFar, uHzGlow, 0.4 * pow(mu, 10.0) + 0.6 * pow(mu, 48.0));
}
// thicker low in the valley; warm toward the sun and blue away from it
vec3 haze(vec3 col, vec3 wpos) {
  vec3 v = wpos - cameraPosition;
  float dist = length(v);
  float k = uHzFalloff, ky = k * v.y;
  float avg = exp(-k * (cameraPosition.y - uHzBase)) * (abs(ky) > 1e-3 ? (1.0 - exp(-ky)) / ky : 1.0);
  return mix(col, hazeColor(v / dist), 1.0 - exp(-uHzDensity * avg * dist));
}
`;

/**
 * Swap a built-in material's fog for the shared haze (works for instanced meshes and lines too).
 * `amount` below 1 lets something tiny keep its colour through the haze.
 */
function hazed(mat, amount = 1) {
  mat.fog = false;
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, HZ, { uHzAmount: { value: amount } });
    s.vertexShader = 'varying vec3 vHzWorld;\n' + s.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 hzW = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        hzW = instanceMatrix * hzW;
      #endif
      vHzWorld = (modelMatrix * hzW).xyz;`);
    s.fragmentShader = 'varying vec3 vHzWorld;\nuniform float uHzAmount;\n' + HAZE_GLSL + s.fragmentShader.replace('#include <fog_fragment>', 'gl_FragColor.rgb = mix(gl_FragColor.rgb, haze(gl_FragColor.rgb, vHzWorld), uHzAmount);');
  };
  return mat;
}
/** Hazed Lambert materials, shared by colour so the static pieces can be merged into a few draws at the end. */
const lambertCache = new Map();
const lambert = (params) => {
  if (params.map || params.vertexColors || params.transparent) return hazed(new THREE.MeshLambertMaterial(params));
  const key = JSON.stringify(params);
  if (!lambertCache.has(key)) lambertCache.set(key, hazed(new THREE.MeshLambertMaterial(params)));
  return lambertCache.get(key);
};

/* ---------------- sky ---------------- */

function skyDome() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      ...HZ,
      uSun: { value: SUN_DIR.clone() },
      uHorizon: { value: new THREE.Color('#f0c9a6') },
      uMid: { value: new THREE.Color('#8fb0e6') },
      uZenith: { value: new THREE.Color('#2f57a8') },
      uTime: { value: 0 },
      uGain: { value: 0.62 * EXPOSURE },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w; // at infinity
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun, uHorizon, uMid, uZenith;
      uniform float uTime, uGain;
      varying vec3 vDir;
      ${HAZE_GLSL}
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += vn(p) * a; p *= 2.1; a *= 0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        float e = d.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.18, e));
        col = mix(col, uZenith, smoothstep(0.15, 0.7, e));
        float mu = max(dot(d, normalize(uSun)), 0.0);
        col += vec3(1.0, 0.72, 0.45) * (pow(mu, 6.0) * 0.55 + pow(mu, 60.0) * 0.9);
        // wispy high clouds, lit warm on the sun side
        vec2 cp = d.xz / max(e + 0.12, 0.05) * 1.6 + vec2(uTime * 0.004, 0.0);
        float c = smoothstep(0.55, 0.85, fbm(cp * vec2(0.8, 2.6))) * smoothstep(0.02, 0.15, e) * (1.0 - smoothstep(0.5, 0.9, e));
        col = mix(col, mix(vec3(1.05, 0.95, 0.92), vec3(1.6, 1.15, 0.85), pow(mu, 3.0)), c * 0.55);
        col *= uGain;
        // low down, the sky turns into the same haze the far ridges fade into
        col = mix(col, hazeColor(d), 1.0 - smoothstep(-0.01, 0.1, e));
        // the sun disc
        col += vec3(12.0, 9.5, 7.0) * uGain * smoothstep(0.99955, 0.99975, mu);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(6000, 48, 24), mat);
  m.frustumCulled = false;
  m.renderOrder = -1;
  return m;
}

/* ---------------- terrain ---------------- */

const blankShadow = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
  t.needsUpdate = true;
  return t;
})();

/** The clearance grid as a texture: run edge distance in r, lift line distance in g. */
function clearTexture() {
  const half = new Uint16Array(clearGrid.length);
  for (let i = 0; i < clearGrid.length; i++) half[i] = THREE.DataUtils.toHalfFloat(clearGrid[i]);
  const t = new THREE.DataTexture(half, RG.nx, RG.nd, THREE.RGFormat, THREE.HalfFloatType);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * Snow, rock and forest in one shader. Per vertex: aMask = (forest cover, unused, sun visibility).
 * Runs, lift lines and the baked near shadows are looked up per pixel. Lit the same way three.js
 * lights its Lambert materials (sun + hemisphere, over pi) so the instanced trees sit on it.
 */
function terrainMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...HZ,
      uSunDir: { value: SUN_DIR.clone() },
      uSunCol: { value: SUN.color.clone().multiplyScalar(SUN.intensity) },
      uSky: { value: SKY.sky.clone().multiplyScalar(SKY.intensity) },
      uGround: { value: SKY.ground.clone().multiplyScalar(SKY.intensity) },
      uZ0: { value: ROOM.z0 },
      uClear: { value: clearTexture() },
      uClearBox: { value: new THREE.Vector4(RG.x0, RG.d0, RG.cell * RG.nx, RG.cell * RG.nd) },
      uClearCell: { value: new THREE.Vector2(RG.cell, RG.cap) },
      uShadeA: { value: blankShadow },
      uShadeABox: { value: new THREE.Vector4(0, 0, 1, 1) },
      uShadeB: { value: blankShadow },
      uShadeBBox: { value: new THREE.Vector4(0, 0, 1, 1) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aMask;
      varying vec3 vWorld, vNormal, vMask;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vMask = aMask;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir, uSunCol, uSky, uGround;
      uniform float uZ0;
      uniform sampler2D uClear, uShadeA, uShadeB;
      uniform vec4 uClearBox, uShadeABox, uShadeBBox;
      uniform vec2 uClearCell;
      varying vec3 vWorld, vNormal, vMask;
      ${HAZE_GLSL}
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
      }
      // noise that settles to its mean once it's finer than a pixel or so, so far slopes don't shimmer
      float vnf(vec2 p, float freq, float px) { return mix(0.5, vn(p * freq), 1.0 - smoothstep(0.15, 0.5, px * freq)); }
      float inBox(vec2 uv) { return step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0); }
      // a baked shadow layer, fading out toward its sides and far edge so the boundary never shows
      float shade(sampler2D t, vec4 box, vec2 q) {
        vec2 uv = (q - box.xy) / box.zw;
        float edge = smoothstep(0.0, 0.08, min(min(uv.x, 1.0 - uv.x), 1.0 - uv.y));
        return mix(1.0, texture2D(t, uv).r, inBox(uv) * edge);
      }
      void main() {
        vec3 N = normalize(vNormal);
        vec2 p = vWorld.xz;
        vec2 q = vec2(vWorld.x, uZ0 - vWorld.z); // (x, d)
        float px = max(length(dFdx(p)), length(dFdy(p))); // metres per pixel here
        float forest = vMask.x, vis = vMask.z;
        // runs and lift lines, per pixel
        vec2 cuv = (q - uClearBox.xy) / uClearBox.zw;
        vec2 clr = inBox(cuv) > 0.5 ? texture2D(uClear, cuv + 0.5 * uClearCell.x / uClearBox.zw).rg : vec2(uClearCell.y);
        float groom = smoothstep(-10.0, 4.0, -clr.r);
        forest *= smoothstep(0.5, 5.0, clr.r) * smoothstep(7.0, 12.0, clr.g);
        float n1 = vnf(p, 0.012, px), n2 = vnf(p + 17.0, 0.05, px), n3 = vnf(p + 41.0, 0.2, px), n4 = vnf(p + 73.0, 0.7, px);
        // ragged edges at every distance: the coarse noise carries on where the fine noise fades out
        float cover = smoothstep(0.2, 0.8, forest + (n1 - 0.5) * 0.5 + (n2 - 0.5) * 0.55 + (n3 - 0.5) * 0.35 + (n4 - 0.5) * 0.25);
        // the railing, and nearby trees and chalets on open snow (under the forest the canopy stands in for them)
        vis *= shade(uShadeA, uShadeABox, q) * mix(shade(uShadeB, uShadeBBox, q), 1.0, cover);
        // snow: wind-rippled off-piste, smooth and a touch brighter where it's groomed
        vec3 snow = vec3(0.86, 0.9, 0.96) * (0.93 + 0.07 * n1 + 0.07 * (n2 - 0.5) * (1.0 - groom));
        snow = mix(snow, vec3(0.93, 0.94, 0.97), groom * 0.8);
        // rock wherever it's too steep to hold snow, ragged at the edges
        float rock = smoothstep(0.3, 0.4, 1.0 - N.y + (n1 - 0.5) * 0.3 + (n2 - 0.5) * 0.28 + (n3 - 0.5) * 0.12) * (1.0 - groom);
        // on a wall, texture across and up it rather than over the ground plan, which would stretch down the face
        vec2 pr = vec2(vWorld.x - vWorld.z, vWorld.y);
        float px3 = max(length(dFdx(vWorld)), length(dFdy(vWorld)));
        float r1 = vnf(pr, 0.07, px3);
        float streaks = vnf(vec2(pr.x, pr.y * 0.12) + 9.0, 0.6, px3); // weathering running down the face
        float bands = vnf(vec2(pr.x * 0.1, pr.y) + 31.0, 0.45, px3); // bedding across it
        vec3 stone = vec3(0.15, 0.142, 0.138) * (0.6 + 0.5 * r1) * (0.75 + 0.5 * streaks) * (0.85 + 0.3 * bands);
        // close up (the cliffs either side of the balcony): blocks between joints, vertical fractures a
        // metre or two apart and bedding planes across, each block weathered a little differently, and
        // grain; all of it fades out long before the far mountains
        if (rock > 0.01 && px3 < 0.4) {
          float near = 1.0 - smoothstep(0.08, 0.35, px3);
          float cx = pr.x * 0.6 + (vn(pr * vec2(0.35, 0.9) + 2.0) - 0.5) * 0.5;
          float cy = pr.y * 1.1 + (vn(pr * vec2(0.6, 0.25) + 7.0) - 0.5) * 0.45;
          vec2 cell = floor(vec2(cx, cy));
          float jv = (1.0 - smoothstep(0.0, 0.05, min(fract(cx), 1.0 - fract(cx)))) * step(0.3, h21(cell + 0.5));
          float jh = (1.0 - smoothstep(0.0, 0.04, min(fract(cy), 1.0 - fract(cy)))) * step(0.45, h21(cell.yx + 3.1));
          float grain = vn(pr * 2.4 + 5.0) + 0.5 * (vn(pr * vec2(7.0, 3.0) + 3.0) - 0.5);
          float face = h21(cell + 9.7);
          stone *= mix(1.0, (0.8 + 0.4 * grain) * (0.8 + 0.4 * face) * (1.0 - 0.55 * max(jv, jh)), near);
        }
        // snow lying along the ledges, broken up
        stone = mix(stone, snow, smoothstep(0.68, 0.8, bands) * smoothstep(0.35, 0.6, r1) * 0.85);
        // forest from afar: dark boughs with snow caught on them, patchy where single trees can't be told apart
        vec3 boughs = mix(vec3(0.03, 0.055, 0.045), vec3(0.5, 0.55, 0.62), smoothstep(0.6, 0.95, n4) * 0.5 + (n2 - 0.5) * 0.18 + (n1 - 0.5) * 0.12);
        vec3 alb = mix(mix(snow, stone, rock), boughs, cover);
        // a low warm sun the mountain shades itself from, and blue skylight
        float ndl = max(dot(N, uSunDir), 0.0) * vis;
        vec3 col = alb * (uSunCol * ndl + mix(uGround, uSky, 0.5 + 0.5 * N.y)) * 0.31831;
        // backlit snow glistens toward the sun
        vec3 V = normalize(vWorld - cameraPosition);
        col += uSunCol * 0.05 * pow(max(dot(reflect(V, N), uSunDir), 0.0), 10.0) * vis * (1.0 - cover) * (1.0 - rock);
        gl_FragColor = vec4(haze(col, vWorld), 1.0);
      }`,
  });
}

/** The valley and the mountains in front of the far ranges; finest close to the chalet and in the middle. */
function terrainMesh(low, mat) {
  const nx = low ? 220 : 400, nd = low ? 190 : 340;
  const xs = [], ds = [];
  for (let i = 0; i <= nx; i++) {
    const u = (i / nx) * 2 - 1;
    xs.push(3000 * (0.2 * u + 0.8 * u * u * u));
  }
  for (let j = 0; j <= nd; j++) {
    const v = j / nd;
    ds.push(2 + 3500 * (0.1 * v + 0.5 * v * v + 0.4 * v * v * v));
  }
  const n = (nx + 1) * (nd + 1);
  const pos = new Float32Array(n * 3), mask = new Float32Array(n * 3);
  let k = 0;
  for (let j = 0; j <= nd; j++) {
    for (let i = 0; i <= nx; i++, k++) pos.set([xs[i], ground(xs[i], ds[j]), ROOM.z0 - ds[j]], k * 3);
  }
  const idx = new Uint32Array(nx * nd * 6);
  let o = 0;
  for (let j = 0; j < nd; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, e = c + 1;
      idx.set([a, b, c, b, e, c], o);
      o += 6;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  const N = new THREE.Vector3();
  for (k = 0; k < n; k++) {
    const x = pos[k * 3], y = pos[k * 3 + 1], d = ROOM.z0 - pos[k * 3 + 2];
    N.fromBufferAttribute(nrm, k);
    mask[k * 3] = forestDensity(x, d, y, N.y, false);
    mask[k * 3 + 2] = N.dot(SUN_DIR) > 0 ? sunVisibility(x, d, y) : 0;
  }
  g.setAttribute('aMask', new THREE.BufferAttribute(mask, 3));
  const m = dynamic(new THREE.Mesh(g, mat)); // keeps its own per-vertex masks, so it's never merged
  m.frustumCulled = false;
  return m;
}

/** The far ranges: a wide strip of jagged ridges, with a notch where the sun is setting. */
function rangeMesh(low, mat) {
  const W = 16000, D = 2700, D0 = 3300;
  const g = new THREE.PlaneGeometry(W, D, low ? 220 : 420, low ? 24 : 48);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const sunBearing = SUN_DIR.x / -SUN_DIR.z; // x per unit distance along the sun's bearing
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const d = -p.getZ(i) + D / 2 + D0;
    const t = (d - D0) / D;
    const crest = Math.sin(t * Math.PI) * (0.65 + 0.35 * Math.sin(t * 7 + x / 900));
    let h = (600 + (0.5 + 0.5 * eroded(x / 1100, d / 800, 6)) * 1300) * crest;
    const notch = Math.exp(-Math.pow((x - sunBearing * d) / (d * 0.12), 2));
    h *= 1 - notch * 0.62;
    p.setXYZ(i, x, VALLEY_Y - 40 + h, ROOM.z0 - d);
  }
  g.computeVertexNormals();
  const mask = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) mask[i * 3 + 2] = 1;
  g.setAttribute('aMask', new THREE.BufferAttribute(mask, 3));
  const m = dynamic(new THREE.Mesh(g, mat)); // keeps its own per-vertex masks, so it's never merged
  m.frustumCulled = false;
  return m;
}

/* ---------------- forest ---------------- */

/**
 * A snow-laden spruce, 1 unit tall: tiers of uneven, drooping boughs narrowing to a spire. Each
 * tier has a shelf of snow on top and dark needles hanging below its edge. Normals point out from
 * the trunk rather than off each facet, so it shades like a soft mass instead of a cone.
 * `tiers`/`segs` set the detail (near trees get more).
 */
function spruceGeometry(tiers, segs, trunk, seed, snowiness = 1) {
  const r = rng(seed);
  const needle = new THREE.Color('#13281a'), snow = new THREE.Color('#f0f3f8'), bark = new THREE.Color('#3b2a1e');
  const pos = [], nor = [], col = [];
  const c = new THREE.Color(), n = new THREE.Vector3();
  const vert = (x, y, z, out, snowy) => {
    pos.push(x, y, z);
    n.set(x, 0, z).normalize().multiplyScalar(out).setY(1 - out * 0.75).normalize();
    nor.push(n.x, n.y, n.z);
    col.push(...c.copy(needle).lerp(snow, snowy).toArray());
  };
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const rad = 0.24 * Math.pow(1 - f, 1.05) + 0.03;
    const h = 0.26 - f * 0.1;
    const y0 = 0.1 + f * 0.8;
    const jag = Array.from({ length: segs }, () => r.range(0.55, 1.45)); // uneven bough lengths
    const shelf = Array.from({ length: segs }, () => r.range(0.55, 0.95) * snowiness); // how much snow each bough holds
    const turn = r() * TAU;
    const ring = (s, k, y) => {
      const a = turn + ((s % segs) / segs) * TAU, j = k === 1 ? jag[s % segs] : lerp(1, jag[s % segs], 0.5);
      return [Math.cos(a) * rad * k * j, y - (k === 1 ? (j - 1) * 0.06 : 0), Math.sin(a) * rad * k * j];
    };
    for (let s = 0; s < segs; s++) {
      // snow shelf from the trunk out to mid-bough, then the bare drooping ends
      const m0 = ring(s, 0.55, y0 + h * 0.45), m1 = ring(s + 1, 0.55, y0 + h * 0.45);
      const e0 = ring(s, 1, y0), e1 = ring(s + 1, 1, y0);
      const s0 = shelf[s], s1 = shelf[(s + 1) % segs];
      vert(0, y0 + h, 0, 0, 0.9 * snowiness);
      vert(...m1, 0.5, s1);
      vert(...m0, 0.5, s0);
      vert(...m0, 0.5, s0 * 0.7);
      vert(...m1, 0.5, s1 * 0.7);
      vert(...e1, 1, r.range(0, 0.08));
      vert(...m0, 0.5, s0 * 0.7);
      vert(...e1, 1, r.range(0, 0.08));
      vert(...e0, 1, r.range(0, 0.08));
    }
  }
  if (trunk) {
    const tr = new THREE.CylinderGeometry(0.018, 0.03, 0.2, 5, 1, true).toNonIndexed();
    tr.translate(0, 0.1, 0);
    const P = tr.attributes.position;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      n.set(P.getX(i), 0, P.getZ(i)).normalize();
      nor.push(n.x, n.y, n.z);
      col.push(bark.r, bark.g, bark.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Trees everywhere they grow; returns the meshes and the near ones (for baking their shadows). */
function forest(low) {
  const r = rng(77);
  const NEAR = 350; // closer than this, trees get the detailed model
  const maxNear = low ? 700 : 1200, maxFar = low ? 5000 : 12000;
  const mat = lambert({ vertexColors: true, side: THREE.DoubleSide });
  const near = new THREE.InstancedMesh(low ? spruceGeometry(5, 6, true, 5) : spruceGeometry(8, 8, true, 5), mat, maxNear);
  // the handful round the chalet are kept apart, so they can stand in front of the office (see NEAR_LAYER)
  const yard = new THREE.InstancedMesh(near.geometry, mat, NEAR_TREES.length);
  // and the wood up the slope behind it, only ever seen from outside: gathered into tiles, so the
  // ones out of view (all of them, from the office) are culled
  const maxBack = low ? 350 : 800, backTiles = new Map();
  // far off, a fully snow-laden tree shrinks to a white speck, so these carry less
  const far = new THREE.InstancedMesh(spruceGeometry(3, 5, false, 9, 0.45), mat, maxFar);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();
  const shadowed = []; // [x, d, y, height, radius] of trees close enough to bake shadows for
  let nn = 0, nf = 0, ny = 0, nb = 0;
  const backTile = (x, d) => {
    const key = `${Math.floor(x / 160)},${Math.floor(d / 160)}`;
    if (!backTiles.has(key)) backTiles.set(key, []);
    return backTiles.get(key);
  };
  const place = (x, d, y, size, density = 0, inYard = false) => {
    const isNear = d < NEAR, isBack = d < -60;
    if (!inYard && !isBack && (isNear ? nn >= maxNear : nf >= maxFar)) return;
    const sx = size * r.range(0.8, 1.15), sz = size * r.range(0.8, 1.15);
    v.set(x, y - 0.5, ROOM.z0 - d);
    q.setFromAxisAngle(up, r() * TAU);
    s.set(sx, size, sz);
    m.compose(v, q, s);
    // trees standing in a mountain's shadow lose their warm side
    const l = r.range(0.75, 1.08) * (0.55 + 0.45 * sunVisibility(x, d, y + size * 0.6));
    tint.setRGB(l * r.range(0.92, 1.05), l, l * r.range(0.95, 1.08));
    if (isBack) {
      backTile(x, d).push([m.clone(), tint.clone()]);
      nb++;
      return;
    }
    const mesh = inYard ? yard : isNear ? near : far, i = inYard ? ny++ : isNear ? nn++ : nf++;
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, tint);
    // shadows only matter on open snow; inside the forest the canopy shading stands in for them
    if (d < 480 && Math.abs(x) < 0.9 * d + 60 && density < 0.6) shadowed.push([x, d, y - 0.5, size, 0.3 * Math.max(sx, sz)]);
  };
  for (const [x, d, h] of NEAR_TREES) place(x, d, ground(x, d), h, 0, true);
  // two passes: our cliff tops in detail, then everything out to the far mountains
  // the height field is too coarse for the cliff, so close in the ground is worked out exactly
  const exactNormalY = (x, d) => {
    const sx = (ground(x + 1.5, d) - ground(x - 1.5, d)) / 3, sd = (ground(x, d + 1.5) - ground(x, d - 1.5)) / 3;
    return 1 / Math.sqrt(1 + sx * sx + sd * sd);
  };
  for (const [d0, d1, count, spread] of [[20, NEAR, maxNear, 1.1], [NEAR, 3000, maxFar, 0.8]]) {
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 12) {
      tries++;
      // the far pass leans toward the mountainside in front of the window
      const d = d1 > 600 && r.chance(0.5) ? r.range(950, 2400) : r.range(d0, d1);
      const half = spread * d + 120;
      const x = r.range(-half, half);
      const exact = d < 400;
      const y = exact ? ground(x, d) : hfAt(x, d);
      if (Number.isNaN(y)) continue;
      // the forest down below our cliff is out of sight from the window, so most of it is left to the canopy shading
      if (d < 500 && y < -60 && r.chance(0.75)) continue;
      const f = forestDensity(x, d, y, exact ? exactNormalY(x, d) : hfNormalY(x, d));
      if (r() > f) continue;
      const tl = smoothstep(y, TREELINE_Y - 140, TREELINE_Y + 20); // stunted toward the treeline
      place(x, d, y, r.range(13, 24) * (1 - tl * 0.55), f);
      placed++;
    }
  }
  // up the slope behind the chalet, thickest toward the yard's edge
  for (let tries = 0; nb < maxBack && tries < maxBack * 10; tries++) {
    const d = -85 - 520 * Math.pow(r(), 1.6);
    const x = r.range(-1, 1) * (160 - d * 0.9);
    const y = ground(x, d);
    const sx = (ground(x + 1.5, d) - ground(x - 1.5, d)) / 3, sd = (ground(x, d + 1.5) - ground(x, d - 1.5)) / 3;
    if (r() > backForest(x, d, y, 1 / Math.sqrt(1 + sx * sx + sd * sd))) continue;
    place(x, d, y, r.range(13, 24) * (1 - smoothstep(y, 200, 330) * 0.5));
  }
  for (const [mesh, count] of [[yard, ny], [near, nn], [far, nf]]) {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
  }
  const back = [...backTiles.values()].map((list) => {
    const mesh = new THREE.InstancedMesh(near.geometry, mat, list.length);
    list.forEach(([mm, c], i) => {
      mesh.setMatrixAt(i, mm);
      mesh.setColorAt(i, c);
    });
    mesh.computeBoundingSphere();
    return mesh;
  });
  return { meshes: [yard, ...back, near, far], yard, shadowed };
}

/* ---------------- the terrace, eaves and icicles ---------------- */

function terrace(scene, snowMat) {
  const { x0, x1, d0, d1, snow, rail } = TERRACE;
  const W = x1 - x0;
  const wood = lambert({ color: '#6a442a' }), dark = lambert({ color: '#3b2719' }), snowy = lambert({ color: '#eef2f8' });
  // snow on the boards, drifted up against the railing and thinner under the eaves
  const g = new THREE.PlaneGeometry(W, d1 - d0, 120, 24);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), d = d0 + (d1 - d0) * (0.5 - p.getZ(i) / (d1 - d0));
    const y = snow - 0.06 * (1 - smoothstep(d, d0, d0 + 1.2)) + 0.1 * smoothstep(d, d1 - 0.7, d1 - 0.05) + (vnoise(x * 0.8, d * 0.8) - 0.5) * 0.05;
    p.setXYZ(i, x, y, ROOM.z0 - d);
  }
  g.computeVertexNormals();
  const mask = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) mask[i * 3 + 2] = 1;
  g.setAttribute('aMask', new THREE.BufferAttribute(mask, 3));
  scene.add(dynamic(new THREE.Mesh(g, snowMat)));
  const add = (geo, mat, x, y, d) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, ROOM.z0 - d);
    scene.add(mesh);
    return mesh;
  };
  // the edge of the deck, then a frameless glass balustrade between larch posts, a broad handrail on top
  const dr = d1 - 0.08;
  add(new THREE.BoxGeometry(W, 0.34, 0.1), dark, 0, -0.4, d1 + 0.05);
  add(new THREE.BoxGeometry(W, 0.09, 0.2), wood, 0, rail, dr);
  add(new THREE.BoxGeometry(W, 0.1, 0.24), snowy, 0, rail + 0.09, dr);
  const posts = [];
  for (let x = x0; x <= x1 + 0.01; x += 2.4) {
    add(new THREE.BoxGeometry(0.12, rail + 0.25, 0.12), wood, x, (rail - 0.25) / 2, dr);
    add(new THREE.BoxGeometry(0.16, 0.1, 0.16), snowy, x, rail + 0.06, dr);
    posts.push(x);
  }
  const glass = hazed(new THREE.MeshLambertMaterial({ color: '#b9cad6', transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }));
  for (let i = 0; i + 1 < posts.length; i++) {
    const pane = add(new THREE.PlaneGeometry(2.4 - 0.16, rail - 0.12), glass, (posts[i] + posts[i + 1]) / 2, (rail - 0.12) / 2 + 0.02, dr);
    pane.renderOrder = 2;
  }
  const gear = skisAndPoles(scene, dr - 0.12);
  // what casts shadows on the terrace snow: the posts, the handrail (the glass lets the sun through), the skis
  const yb = snow;
  return [
    ...posts.map((x) => postOccluder(x, dr, 0.07, yb, rail + 0.1, yb)),
    railOccluder(x0, x1, dr, rail - 0.05, rail + 0.14, yb),
    ...gear.map(([x, d, r, top]) => postOccluder(x, d, r, yb, top, yb)),
  ];
}

/** A ski, 1 unit tall from tail (y = 0) to tip: sidecut, a rounded shovel curling toward the top sheet (+z). */
function skiGeometry(L = 1.72) {
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 48, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) + 0.5;
    const w = 0.068 + 0.04 * (2 * t - 1) ** 2;
    const round = t > 0.94 ? Math.sqrt(Math.max(0, 1 - ((t - 0.94) / 0.06) ** 2)) : 1;
    const rise = 0.075 * smoothstep(t, 0.84, 1) ** 2 + 0.018 * (1 - smoothstep(t, 0, 0.07));
    p.setXYZ(i, p.getX(i) * w * (0.35 + 0.65 * round), t * L, p.getZ(i) * 0.016 + rise);
  }
  g.computeVertexNormals();
  return g;
}

function skiTopTex() {
  const [c, g] = T.makeCanvas(32, 320);
  g.fillStyle = '#e8622a';
  g.fillRect(0, 0, 32, 320);
  g.fillStyle = '#16181c';
  g.fillRect(0, 150, 32, 170);
  g.fillStyle = '#f4f1ea';
  for (let k = 0; k < 6; k++) g.fillRect(0, 70 + k * 12, 32, 4);
  g.save();
  g.translate(16, 240);
  g.rotate(-Math.PI / 2);
  g.font = '700 15px Cinzel, Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('SUMMIT', 0, 1);
  g.restore();
  return T.toTexture(c);
}

/** A pair of skis and poles leaning on the balcony rail. Returns [x, d, radius, top] for their shadows. */
function skisAndPoles(scene, railFront) {
  const top = lambert({ map: skiTopTex() }), base = lambert({ color: '#1b1d22' }), edge = lambert({ color: '#9aa0a8' });
  const geo = skiGeometry();
  const out = [];
  // leaning back so each rests on the front of the handrail about 1.1 m up
  [[-1.43, 0.03, 0.06], [-1.3, -0.04, -0.05]].forEach(([x, roll, yaw]) => {
    const foot = railFront - 0.18;
    const ski = new THREE.Mesh(geo, [edge, edge, edge, edge, top, base]);
    ski.position.set(x, TERRACE.snow - 0.03, ROOM.z0 - foot);
    ski.rotation.set(-0.15, yaw, roll, 'YXZ');
    scene.add(ski);
    out.push([x, foot + 0.12, 0.05, 1.55]);
  });
  const shaft = lambert({ color: '#c9ccd2' }), grip = lambert({ color: '#18191c' });
  [[-1.12, 0.05], [-1.06, -0.03]].forEach(([x, roll]) => {
    const pole = new THREE.Group();
    pole.position.set(x, TERRACE.snow - 0.02, ROOM.z0 - (railFront - 0.22));
    pole.rotation.set(-0.19, 0, roll, 'YXZ');
    scene.add(pole);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.006, 1.22, 6), shaft);
    tube.position.y = 0.61;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.014, 0.15, 8), grip);
    handle.position.y = 1.2;
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.008, 12), grip);
    basket.position.y = 0.09;
    pole.add(tube, handle, basket);
    out.push([x, railFront - 0.12, 0.012, 1.25]);
  });
  return out;
}

/* ---------------- the neighbours' chalets ---------------- */

/** A unit triangular prism: base 1 wide at y = 0, apex at y = 1, 1 long along z. For gables and roofs. */
function prismGeometry() {
  const g = new THREE.CylinderGeometry(1, 1, 1, 3, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.5, 0);
  g.scale(1 / Math.sqrt(3), 1 / 1.5, 1);
  return g;
}

function chalets(scene) {
  const stone = lambert({ color: '#8d857d' }), larch = lambert({ color: '#5c3a24' }), timber = lambert({ color: '#3a2619' });
  const snow = lambert({ color: '#f2f5fa' });
  const glow = hazed(new THREE.MeshBasicMaterial({ color: '#ffc477' }));
  glow.color.multiplyScalar(1.5 * EXPOSURE);
  const glass = lambert({ color: '#28303a' });
  const prism = prismGeometry();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const pane = new THREE.PlaneGeometry(1, 1);
  const r = rng(12);
  const lit = [], dim = [];
  const occ = [];
  const m = new THREE.Matrix4();
  for (const [x, d, w, dep, turn] of CHALETS) {
    const floor = ground(x, d - dep / 2) + 0.3; // set into the slope on its uphill side
    const g = new THREE.Group();
    g.position.set(x, floor, ROOM.z0 - d);
    g.rotation.y = turn;
    scene.add(g);
    const part = (mat, sx, sy, sz, px, py, pz, geo = box) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(px, py, pz);
      g.add(mesh);
      return mesh;
    };
    const H = 6.2; // two storeys of larch on a stone plinth
    part(stone, w + 0.6, 10, dep + 0.6, 0, -4.4, 0);
    part(larch, w, H, dep, 0, H / 2 + 0.6, 0);
    const eave = H + 0.6, pitch = 0.42, rise = (w / 2) * Math.tan(pitch), over = 1.5, half = w / 2 + over;
    part(larch, w, rise, dep, 0, eave, 0, prism);
    // the roof: timber slabs with a thick blanket of snow, the ridge running out toward the valley
    for (const s of [-1, 1]) {
      const len = half / Math.cos(pitch);
      const cx = (s * half) / 2, cy = eave + rise - (half / 2) * Math.tan(pitch);
      const slab = part(timber, len, 0.3, dep + 2 * over, cx, cy, 0);
      slab.rotation.z = -s * pitch;
      const cap = part(snow, len + 0.15, 0.6, dep + 2 * over + 0.1, cx + s * Math.sin(pitch) * 0.45, cy + Math.cos(pitch) * 0.45, 0);
      cap.rotation.z = -s * pitch;
    }
    // a stone chimney, capped with snow
    part(stone, 1, 2.6, 1, w * 0.22, eave + rise * 0.55 + 1, -dep * 0.2);
    part(snow, 1.25, 0.3, 1.25, w * 0.22, eave + rise * 0.55 + 2.4, -dep * 0.2);
    // windows on the uphill side and the ends, most of them lit
    g.updateMatrixWorld(true);
    const win = (px, py, pz, ry, ww, hh) => {
      const local = new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(ww, hh, 1));
      (r.chance(0.7) ? lit : dim).push(m.multiplyMatrices(g.matrixWorld, local).clone());
    };
    for (const [fy, hh] of [[2.0, 1.6], [4.9, 1.5]]) {
      for (let i = 0; i < Math.floor(w / 3.4); i++) win(-w / 2 + 1.9 + i * 3.4, fy, dep / 2 + 0.03, 0, 1.4, hh);
      for (let i = 0; i < Math.floor(dep / 3.6); i++) {
        win(w / 2 + 0.03, fy, -dep / 2 + 2 + i * 3.6, Math.PI / 2, 1.3, hh);
        win(-w / 2 - 0.03, fy, -dep / 2 + 2 + i * 3.6, -Math.PI / 2, 1.3, hh);
      }
    }
    occ.push(boxOccluder(x, d, w + 2 * over, dep + 2 * over, turn, floor - 1, eave + rise * 0.6 + floor));
  }
  for (const [list, mat] of [[lit, glow], [dim, glass]]) {
    const inst = new THREE.InstancedMesh(pane, mat, list.length);
    list.forEach((mm, i) => inst.setMatrixAt(i, mm));
    inst.frustumCulled = false;
    scene.add(inst);
  }
  return occ;
}

/* ---------------- the village and the ski area's base ---------------- */

/**
 * The village on its shelf: chalets and lodges facing the valley with their windows lit, a church,
 * all kept off the runs and lift lines (the runs go right through it). Plus the lodge at the base.
 */
function village(scene) {
  const r = rng(44);
  const houses = [{ x: BASE.x, d: BASE.d, w: 34, dep: 14, h: 9, turn: 0.05 }];
  for (const [dx, dd] of [[-50, 25], [55, 18], [90, -10], [-80, -15]]) houses.push({ x: BASE.x + dx, d: BASE.d + dd, w: r.range(12, 18), dep: r.range(9, 12), h: r.range(6, 8), turn: r.range(-0.2, 0.2) });
  const clear = (x, d, k) => runClearance(x, d) > 10 * k && clearAt(x, d, 1) > 16 * k && Math.hypot(x - HELIPADS.base[0], d - HELIPADS.base[1]) > 45 * k;
  for (let tries = 0; houses.length < 44 && tries < 1200; tries++) {
    const a = r() * TAU, rr = Math.sqrt(r());
    const x = VILLAGE.x + Math.cos(a) * rr * VILLAGE.rx, d = VILLAGE.d + Math.sin(a) * rr * VILLAGE.rd;
    if (!clear(x, d, 1) || houses.some((h) => Math.hypot(h.x - x, h.d - d) < 30)) continue;
    // a few big old hotels among the chalets, every window lit
    const grand = houses.length < 9;
    houses.push({ x, d, w: grand ? r.range(36, 48) : r.range(16, 26), dep: grand ? 16 : r.range(11, 15), h: grand ? r.range(16, 20) : r.range(9, 13), turn: r.range(-0.2, 0.2), grand });
  }
  // the church, its steeple catching the light, on the first clear spot out from the middle
  let cx = VILLAGE.x, cd = VILLAGE.d;
  for (let k = 0; k < 40 && !(clear(cx, cd, 2.2) && !houses.some((h) => Math.hypot(h.x - cx, h.d - cd) < 30)); k++) {
    cx = VILLAGE.x + Math.cos(k * 2.4) * k * 9;
    cd = VILLAGE.d + Math.sin(k * 2.4) * k * 2;
  }
  const cy = ground(cx, cd);
  const church = new THREE.Group();
  church.position.set(cx, cy, ROOM.z0 - cd);
  church.rotation.y = 0.1;
  const white = lambert({ color: '#efe9de' });
  const block = new THREE.BoxGeometry(1, 1, 1);
  block.translate(0, 0.5, 0);
  const nave = new THREE.Mesh(block, white);
  nave.scale.set(11, 11, 24);
  const naveRoof = new THREE.Mesh(prismGeometry(), lambert({ color: '#f1f4f9' }));
  naveRoof.scale.set(13, 6, 26);
  naveRoof.position.y = 11;
  const tower = new THREE.Mesh(block, white);
  tower.scale.set(5, 26, 5);
  tower.position.z = 13;
  const spire = new THREE.Mesh(new THREE.ConeGeometry(3.4, 11, 4), lambert({ color: '#3d4a52' }));
  spire.position.set(0, 31.5, 13);
  spire.rotation.y = Math.PI / 4;
  church.add(nave, naveRoof, tower, spire);
  scene.add(church);
  const n = houses.length;
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const walls = new THREE.InstancedMesh(box, lambert({ color: '#ffffff' }), n);
  const roofs = new THREE.InstancedMesh(prismGeometry(), lambert({ color: '#f1f4f9' }), n);
  const glow = hazed(new THREE.MeshBasicMaterial({ color: '#ffc477' }));
  glow.color.multiplyScalar(2.4 * EXPOSURE);
  const lights = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.2, 2.2), glow, n * 18);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  let nl = 0;
  houses.forEach((h, i) => {
    const y = ground(h.x, h.d);
    q.setFromEuler(e.set(0, h.turn, 0));
    walls.setMatrixAt(i, m.compose(v.set(h.x, y - 1, ROOM.z0 - h.d), q, s.set(h.w, h.h + 1, h.dep)));
    walls.setColorAt(i, r.chance(0.5) ? c.set('#e6dccb') : c.set('#6b4630'));
    roofs.setMatrixAt(i, m.compose(v.set(h.x, y + h.h, ROOM.z0 - h.d), q, s.set(h.w + 2, h.w * 0.32, h.dep + 2)));
    const rows = h.grand ? 3 : 2, cols = h.grand ? 6 : 3;
    for (let k = 0; k < rows * cols; k++) {
      if (!h.grand && r.chance(0.3)) continue;
      const lx = ((k % cols) / (cols - 1) - 0.5) * (h.w - 4);
      const local = new THREE.Matrix4().makeTranslation(lx, 2.2 + Math.floor(k / cols) * 4.4, h.dep / 2 + 0.05);
      lights.setMatrixAt(nl++, m.compose(v.set(h.x, y, ROOM.z0 - h.d), q, s.set(1, 1, 1)).multiply(local));
    }
  });
  lights.count = nl;
  for (const mesh of [walls, roofs, lights]) {
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
}

/* ---------------- chairlifts ---------------- */

function chairlift(scene, lift) {
  const steel = lambert({ color: '#4b4f55' });
  const [ax, ad] = lift.from, [bx, bd] = lift.to;
  const len = Math.hypot(bx - ax, bd - ad);
  const dirX = (bx - ax) / len, dirD = (bd - ad) / len;
  const towers = Math.round(len / 75);
  const tops = [];
  const pole = new THREE.CylinderGeometry(0.35, 0.45, 1, 6);
  pole.translate(0, 0.5, 0);
  const arm = new THREE.BoxGeometry(6, 0.4, 0.4);
  for (let i = 0; i <= towers; i++) {
    const t = i / towers;
    const x = ax + (bx - ax) * t, d = ad + (bd - ad) * t;
    const y0 = heightAt(x, d);
    const h = i === 0 || i === towers ? 7 : 12;
    const p = new THREE.Mesh(pole, steel);
    p.position.set(x, y0, ROOM.z0 - d);
    p.scale.y = h;
    scene.add(p);
    const a = new THREE.Mesh(arm, steel);
    a.position.set(x, y0 + h, ROOM.z0 - d);
    a.rotation.y = Math.atan2(-dirX, dirD);
    scene.add(a);
    tops.push(new THREE.Vector3(x, y0 + h - 0.3, ROOM.z0 - d));
  }
  // stations
  const shed = lambert({ color: '#7a3b2a' });
  const roof = lambert({ color: '#e7ebf2' });
  for (const [t, w] of [[0, 1], [1, 0.8]]) {
    const v = tops[t === 0 ? 0 : tops.length - 1];
    const b = new THREE.Mesh(new THREE.BoxGeometry(12 * w, 6, 9 * w), shed);
    b.position.set(v.x, v.y - 3.7, v.z);
    b.rotation.y = Math.atan2(-dirX, dirD);
    scene.add(b);
    const rf = new THREE.Mesh(new THREE.BoxGeometry(14 * w, 1, 11 * w), roof);
    rf.position.set(v.x, v.y - 0.2, v.z);
    rf.rotation.y = b.rotation.y;
    scene.add(rf);
  }
  // two cables (up and down), offset to either side of the towers
  const side = new THREE.Vector3(dirD, 0, dirX).multiplyScalar(2.6); // perpendicular in world space (x, z)
  const lines = [-1, 1].map((s) => tops.map((v) => v.clone().addScaledVector(side, s)));
  // a cable is far thinner than the one-pixel line drawing it, so it's drawn faint
  const cableMat = hazed(new THREE.LineBasicMaterial({ color: '#2a2c30', transparent: true, opacity: 0.3 }));
  for (const pts of lines) scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), cableMat));
  const paths = lines.map((pts) => new THREE.CatmullRomCurve3(pts, false, 'chordal', 0));
  // chairs
  const chairGeo = new THREE.BoxGeometry(1.6, 0.9, 0.8);
  chairGeo.translate(0, -2.2, 0);
  const hanger = new THREE.BoxGeometry(0.08, 2.2, 0.08);
  hanger.translate(0, -1.1, 0);
  const parts = [chairGeo.toNonIndexed(), hanger.toNonIndexed()];
  const merged = new THREE.BufferGeometry();
  const P = parts.map((g) => g.attributes.position.array);
  merged.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...P[0], ...P[1]]), 3));
  merged.computeVertexNormals();
  const perLine = Math.round(len / 28);
  const chairs = new THREE.InstancedMesh(merged, lambert({ color: '#2f3c58' }), perLine * 2);
  chairs.frustumCulled = false;
  scene.add(chairs);
  const m = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-dirX, dirD));
  const one = new THREE.Vector3(1, 1, 1);
  return (t) => {
    let k = 0;
    for (let line = 0; line < 2; line++) {
      for (let i = 0; i < perLine; i++) {
        let u = (i / perLine + t * (2.2 / len)) % 1; // 2.2 m/s
        if (line === 1) u = 1 - u; // the down side runs the other way
        paths[line].getPointAt(u, v);
        m.compose(v, q, one);
        chairs.setMatrixAt(k++, m);
      }
    }
    chairs.instanceMatrix.needsUpdate = true;
  };
}

/* ---------------- skiers ---------------- */

function skierParts() {
  const legs = new THREE.BoxGeometry(0.3, 0.8, 0.24);
  legs.translate(0, 0.5, 0);
  const skis = [-0.13, 0.13].map((x) => {
    const s = new THREE.BoxGeometry(0.09, 0.03, 1.7);
    s.translate(x, 0.04, 0.1);
    return s;
  });
  const poles = [-0.32, 0.32].map((x) => {
    const p = new THREE.BoxGeometry(0.025, 1.1, 0.025);
    p.rotateX(0.5);
    p.translate(x, 0.6, -0.25);
    return p;
  });
  const low = mergeGeos([legs, ...skis, ...poles]);
  const jacket = new THREE.BoxGeometry(0.46, 0.62, 0.3);
  jacket.translate(0, 1.18, 0);
  const head = new THREE.SphereGeometry(0.14, 8, 6);
  head.translate(0, 1.62, 0.02);
  return { low, jacket, head };
}

function mergeGeos(list) {
  const arrs = list.map((g) => g.toNonIndexed());
  const n = arrs.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of arrs) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

// skiers are specks a kilometre or two away, so they're drawn larger than life to read as people
const SKIER_SCALE = new THREE.Vector3(4, 4, 4);
/** Busiest on the main run under the lift. */
const pickRun = (r) => r.pick([0, 0, 0, 1, 1, 2, 2, 3, 4]);
const JACKETS = ['#d7263d', '#f49d37', '#1b98e0', '#2ec4b6', '#ffd23f', '#9b5de5', '#f15bb5', '#e63946', '#06d6a0', '#ffffff', '#ff7f11'];

/** Skiers on the runs and in the lift line, plus a party of four the helicopter drops at the top. */
function skiers(scene, low) {
  const r = rng(31);
  const parts = skierParts();
  const HELI = 4;
  const N = (low ? 50 : 90) + HELI;
  // half the haze, so a speck a kilometre off still shows its jacket
  const clear = (color) => hazed(new THREE.MeshLambertMaterial({ color }), 0.5);
  const lowMesh = new THREE.InstancedMesh(parts.low, clear('#2a2a30'), N);
  const jacket = new THREE.InstancedMesh(parts.jacket, clear('#ffffff'), N);
  const head = new THREE.InstancedMesh(parts.head, clear('#ffffff'), N);
  for (const m of [lowMesh, jacket, head]) {
    m.frustumCulled = false;
    scene.add(m);
  }
  const people = [];
  const [lx, ld] = LIFTS[0].from;
  for (let i = 0; i < N; i++) {
    const waiting = i < 10; // a lift line at the bottom station
    const heli = i >= N - HELI; // hidden until the helicopter sets them down
    const run = heli ? 0 : pickRun(r);
    people.push({
      waiting, run, heli, hidden: heli, walk: 0, delay: 0,
      u: r(), speed: r.range(8, 15), phase: r() * TAU, turn: r.range(16, 30), amp: r.range(0.2, 0.38),
      x: lx + r.range(-16, 4), d: ld + r.range(-22, -6), heading: r.range(-1, 1),
    });
    jacket.setColorAt(i, new THREE.Color(r.pick(JACKETS)));
    head.setColorAt(i, new THREE.Color(r.pick(['#111111', '#f5f5f5', '#c1121f', '#1d3557', '#ffb703'])));
  }
  jacket.instanceColor.needsUpdate = true;
  head.instanceColor.needsUpdate = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3();
  const tan = new THREE.Vector3(), pt = new THREE.Vector3();
  const gone = new THREE.Matrix4().makeScale(0, 0, 0);
  const start = runCurves[0].curve.getPointAt(0, new THREE.Vector3());
  /** The helicopter has landed at (x, d): its four step out one after another and head for the top of the main run. */
  const drop = (x, d) => {
    people.filter((p) => p.heli).forEach((p, k) => {
      Object.assign(p, { hidden: false, walk: 0, delay: k * 1.6, u: 0, run: 0, x, d, from: [x + (k - 1.5) * 3, d], speed: r.range(9, 13) });
    });
  };
  const update = (dt, t) => {
    people.forEach((p, i) => {
      let lean = 0, crouch = 0.2;
      if (p.hidden || (p.heli && p.delay > 0)) {
        p.delay -= dt;
        lowMesh.setMatrixAt(i, gone);
        jacket.setMatrixAt(i, gone);
        head.setMatrixAt(i, gone);
        return;
      }
      if (p.heli && p.walk < 1) {
        // across from the pad to the start of the run
        p.walk = Math.min(1, p.walk + dt / 6);
        p.x = lerp(p.from[0], start.x, p.walk);
        p.d = lerp(p.from[1], start.z, p.walk);
        p.heading = Math.atan2(start.x - p.from[0], -(start.z - p.from[1]));
        crouch = 0.05;
      } else if (p.waiting) {
        p.heading += Math.sin(t * 0.3 + i) * 0.002;
        crouch = 0.05;
      } else {
        const run = runCurves[p.run];
        const slow = p.u > 0.94 ? clamp((1 - p.u) / 0.06, 0.15, 1) : 1;
        p.u += (p.speed * slow * dt) / run.length;
        p.phase += ((p.speed * slow) / p.turn) * Math.PI * dt;
        if (p.u >= 1) {
          p.u = 0;
          if (p.heli) p.hidden = true; // down at the base; they'll be back on the next flight
          p.run = p.heli ? 0 : pickRun(r);
          p.speed = r.range(8, 15);
        }
        run.curve.getPointAt(p.u, pt);
        run.curve.getTangentAt(p.u, tan);
        const nx = -tan.z, nd = tan.x; // across the run
        const off = Math.sin(p.phase) * run.w * p.amp;
        p.x = pt.x + nx * off;
        p.d = pt.z + nd * off;
        const lat = Math.cos(p.phase) * run.w * p.amp * ((p.speed * slow) / p.turn) * Math.PI;
        const vx = tan.x * p.speed * slow + nx * lat, vd = tan.z * p.speed * slow + nd * lat;
        p.heading = Math.atan2(vx, -vd); // model faces +z; world z = z0 - d
        lean = -Math.sin(p.phase) * 0.45 * slow;
      }
      v.set(p.x, heightAt(p.x, p.d) + 0.35, ROOM.z0 - p.d);
      e.set(crouch, p.heading, lean, 'YXZ');
      q.setFromEuler(e);
      m.compose(v, q, SKIER_SCALE);
      lowMesh.setMatrixAt(i, m);
      jacket.setMatrixAt(i, m);
      head.setMatrixAt(i, m);
    });
    for (const mm of [lowMesh, jacket, head]) mm.instanceMatrix.needsUpdate = true;
  };
  return { update, drop };
}

/* ---------------- the heli-ski helicopter ---------------- */

/** Landing pads [x, d]: at the edge of the village, and up beside the top of the main run. */
const HELIPADS = { base: [-600, 1960], top: [195, 2618] };
// a helicopter is only a few pixels two kilometres off, so like the skiers it's drawn larger than life
const HELI_SCALE = 5;

/** A small red utility helicopter, nose toward +z, skids at y = 0; about 11 m long before scaling. */
function helicopterModel() {
  const g = new THREE.Group();
  // little haze, so the red still reads from across the valley
  const clear = (color) => hazed(new THREE.MeshLambertMaterial({ color }), 0.3);
  const red = clear('#e0102a'), white = clear('#f1f1ee'), dark = clear('#23272d'), glass = clear('#2f4256');
  const add = (geo, mat, [x, y, z], rot = [0, 0, 0], scl = [1, 1, 1], parent = g) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(...rot);
    mesh.scale.set(...scl);
    parent.add(mesh);
    return mesh;
  };
  add(new THREE.SphereGeometry(1.2, 18, 12), red, [0, 1.55, 0.5], [0, 0, 0], [1, 1, 1.75]); // cabin
  add(new THREE.SphereGeometry(1.0, 16, 10), glass, [0, 1.75, 1.55], [0, 0, 0], [1.02, 0.72, 0.9]); // windscreen
  add(new THREE.SphereGeometry(1.21, 18, 6, 0, TAU, Math.PI * 0.55, Math.PI * 0.08), white, [0, 1.55, 0.5], [0, 0, 0], [1, 1, 1.75]); // stripe
  add(new THREE.CylinderGeometry(0.2, 0.42, 5.6, 10), red, [0, 1.95, -3.4], [Math.PI / 2, 0, 0]); // tail boom
  add(new THREE.BoxGeometry(0.1, 1.5, 0.95), red, [0, 2.55, -6.05], [-0.35, 0, 0]); // fin
  add(new THREE.BoxGeometry(1.5, 0.08, 0.45), white, [0, 2.0, -5.6]); // tailplane
  add(new THREE.CylinderGeometry(0.16, 0.22, 0.6, 10), dark, [0, 2.95, 0.4]); // mast
  for (const sx of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6), dark, [sx * 0.95, 0.07, 0.5], [Math.PI / 2, 0, 0]); // skid
    for (const sz of [-0.5, 1.3]) add(new THREE.CylinderGeometry(0.05, 0.05, 0.85, 6), dark, [sx * 0.8, 0.45, sz], [0, 0, sx * 0.35]); // struts
  }
  // the main rotor: three blades and a faint disc for the blur
  const rotor = new THREE.Group();
  rotor.position.set(0, 3.25, 0.4);
  g.add(rotor);
  for (let k = 0; k < 3; k++) add(new THREE.BoxGeometry(0.3, 0.04, 5.3), dark, [0, 0, 0], [0, (k / 3) * TAU, 0], [1, 1, 1], rotor).geometry.translate(0, 0, 2.65);
  const disc = hazed(new THREE.MeshBasicMaterial({ color: '#2a2e33', transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
  add(new THREE.CircleGeometry(5.3, 32), disc, [0, 3.22, 0.4], [-Math.PI / 2, 0, 0]);
  const tail = new THREE.Group();
  tail.position.set(0.18, 2.5, -6.15);
  g.add(tail);
  for (let k = 0; k < 2; k++) add(new THREE.BoxGeometry(0.04, 1.3, 0.12), dark, [0, 0, 0], [(k / 2) * Math.PI, 0, 0], [1, 1, 1], tail);
  g.scale.setScalar(HELI_SCALE);
  return { group: g, rotor, tail };
}

/**
 * Flies a loop: waits on the pad at the edge of the village, climbs out and follows the mountain up
 * at a safe height, settles on the top pad, lets its four skiers out, and flies back down another way.
 */
function helicopter(scene, onDrop) {
  const { group, rotor, tail } = helicopterModel();
  dynamic(group);
  scene.add(group);
  const pad = ([x, d]) => new THREE.Vector3(x, heightAt(x, d), ROOM.z0 - d);
  const A = pad(HELIPADS.base), B = pad(HELIPADS.top);
  // through waypoints [x, d], at a safe height over the ground below, settling onto each pad
  const route = (from, to, via) => {
    const pts = [from.clone(), from.clone().setY(from.y + 45)];
    via.forEach(([x, d], k) => pts.push(new THREE.Vector3(x, Math.max(heightAt(x, d) + 140, lerp(from.y, to.y, (k + 1) / (via.length + 1)) + 60), ROOM.z0 - d)));
    pts.push(to.clone().setY(to.y + 35), to.clone());
    return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  };
  const SPEED = 42; // metres a second in the cruise
  // up the left and a climbing traverse across the face, so it's seen side-on; back round the right
  const up = route(A, B, [[-700, 2150], [-450, 2350], [-100, 2470]]);
  const down = route(B, A, [[550, 2470], [450, 2170], [-150, 1900]]);
  const legs = [
    { at: A, T: 10 },
    { path: up, T: up.getLength() / SPEED },
    { at: B, T: 9, drop: 2.5 },
    { path: down, T: down.getLength() / SPEED },
  ];
  const total = legs.reduce((a, l) => a + l.T, 0);
  const p = new THREE.Vector3(), tv = new THREE.Vector3();
  let heading = Math.atan2(B.x - A.x, B.z - A.z), dropped = -1;
  return (dt, t) => {
    rotor.rotation.y += dt * 26;
    tail.rotation.x += dt * 70;
    const clock = t + 6; // start just before take-off
    const cycle = Math.floor(clock / total);
    let tt = clock - cycle * total, i = 0;
    while (tt > legs[i].T) tt -= legs[i++].T;
    const leg = legs[i];
    let pitch = 0;
    if (leg.path) {
      const f = tt / leg.T, u = f * f * (3 - 2 * f); // ease off the pad and onto the next
      leg.path.getPointAt(u, p);
      leg.path.getTangentAt(u, tv);
      if (Math.hypot(tv.x, tv.z) > 0.25) {
        const want = Math.atan2(tv.x, tv.z);
        heading += Math.atan2(Math.sin(want - heading), Math.cos(want - heading)) * Math.min(1, dt * 1.5);
      }
      pitch = 0.16 * 6 * f * (1 - f) / 1.5; // nose down while it's moving fast
    } else {
      p.copy(leg.at);
      if (leg.drop && tt > leg.drop && dropped !== cycle) {
        dropped = cycle;
        onDrop(p.x, ROOM.z0 - p.z);
      }
    }
    group.position.copy(p);
    group.rotation.set(pitch, heading, 0, 'YXZ');
  };
}

/* ---------------- the chalet from outside ---------------- */

/** Dark larch cladding: vertical boards with shadowed joints. */
function claddingTex() {
  const [c, g] = T.makeCanvas(128, 128);
  const r = rng(61);
  for (let x = 0; x < 128; x += 16) {
    g.fillStyle = `rgb(${102 + r.range(-9, 9)},${68 + r.range(-7, 7)},${46 + r.range(-5, 5)})`;
    g.fillRect(x, 0, 16, 128);
    for (let k = 0; k < 14; k++) {
      g.fillStyle = `rgba(30,16,8,${r.range(0.05, 0.16)})`;
      g.fillRect(x + r.range(1, 15), 0, 1, 128);
    }
    g.fillStyle = 'rgba(20,10,4,0.75)';
    g.fillRect(x, 0, 1.5, 128);
  }
  return T.toTexture(c, { wrap: true });
}

/** A closed wooden shutter: painted boards, a Z-brace, and a heart cut out near the top. */
function shutterTex() {
  const [c, g] = T.makeCanvas(64, 128);
  const r = rng(17);
  g.fillStyle = '#3f5c46';
  g.fillRect(0, 0, 64, 128);
  for (let x = 0; x < 64; x += 16) {
    g.fillStyle = `rgba(255,255,255,${r.range(0.02, 0.08)})`;
    g.fillRect(x + 2, 0, 12, 128);
    g.fillStyle = 'rgba(10,20,12,0.7)';
    g.fillRect(x, 0, 1.5, 128);
  }
  g.strokeStyle = 'rgba(18,30,22,0.5)';
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(3, 30);
  g.lineTo(61, 30);
  g.lineTo(3, 106);
  g.lineTo(61, 106);
  g.stroke();
  const hx = 32, hy = 14;
  g.fillStyle = '#1a120c';
  g.beginPath();
  g.moveTo(hx, hy + 7);
  g.bezierCurveTo(hx - 10, hy - 1, hx - 4, hy - 8, hx, hy - 2);
  g.bezierCurveTo(hx + 4, hy - 8, hx + 10, hy - 1, hx, hy + 7);
  g.fill();
  return T.toTexture(c);
}

/** A soft warm glow, for the lantern by the door. */
function glowTex() {
  const [c, g] = T.makeCanvas(64, 64, 1);
  const grad = g.createRadialGradient(32, 32, 1, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,200,130,0.8)');
  grad.addColorStop(0.2, 'rgba(255,170,90,0.28)');
  grad.addColorStop(0.55, 'rgba(255,150,70,0.07)');
  grad.addColorStop(1, 'rgba(255,150,70,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return T.toTexture(c, { mip: false });
}

/** A soft round puff, for chimney smoke. */
function puffTex() {
  const [c, g] = T.makeCanvas(64, 64, 1);
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(235,232,228,0.55)');
  grad.addColorStop(1, 'rgba(235,232,228,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return T.toTexture(c, { mip: false });
}

/**
 * The outside of the chalet the office is in: stone plinth, larch walls, the picture window, the
 * side door with a lantern, shuttered windows, a woodpile, a snow-laden roof with icicles along the
 * eaves, and a chimney. The office itself isn't part of this scene: from outside it's drawn through
 * the window and the doorway (see NEAR_LAYER).
 */
function chaletExterior(scene) {
  const C = CHALET, W = WIN;
  const board = claddingTex();
  const wood = lambert({ map: board });
  const stone = lambert({ color: '#8f877e' }), timber = lambert({ color: '#3a2619' }), snow = lambert({ color: '#f2f5fa' });
  const cream = lambert({ color: '#d8ccb0' }), floor = lambert({ color: '#6a3f22' });
  const add = (mat, [x0, x1], [y0, y1], [z0, z1], parent = scene) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    // cladding keeps its boards a sensible size whatever the wall
    if (mat === wood) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(x1 - x0, z1 - z0) / 1.6, uv.getY(i) * (y1 - y0) / 1.6);
    }
    const m = new THREE.Mesh(g, mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    parent.add(m);
    return m;
  };
  const t = 0.1, top = C.wallTop, base = 0.02; // the plinth comes up level with the office floor
  const wz0 = ROOM.z0 - ROOM.wall, wz1 = ROOM.z1 + ROOM.wall, wx0 = ROOM.x0 - ROOM.wall, wx1 = ROOM.x1 + ROOM.wall;
  add(stone, [C.x0 - 0.06, C.x1 + 0.06], [-0.7, base], [C.z0 - 0.06, C.z1 + 0.06]);
  // the window wall, around the opening
  add(wood, [C.x0, W.x0], [base, top], [wz0 - t, wz0]);
  add(wood, [W.x1, C.x1], [base, top], [wz0 - t, wz0]);
  add(wood, [W.x0, W.x1], [base, W.y0], [wz0 - t, wz0]);
  add(wood, [W.x0, W.x1], [W.y1, top], [wz0 - t, wz0]);
  // the window's reveal and a painted frame round the glass
  add(cream, [W.x0, W.x0 + 0.05], [W.y0, W.y1], [wz0 - t, ROOM.z0]);
  add(cream, [W.x1 - 0.05, W.x1], [W.y0, W.y1], [wz0 - t, ROOM.z0]);
  add(cream, [W.x0, W.x1], [W.y1 - 0.05, W.y1], [wz0 - t, ROOM.z0]);
  add(snow, [W.x0 - 0.08, W.x1 + 0.08], [W.y0 - 0.05, W.y0 + 0.03], [wz0 - t - 0.12, ROOM.z0]); // snow on the sill
  // the back and the far side
  add(wood, [C.x0, C.x1], [base, top], [wz1, wz1 + t]);
  add(wood, [C.x0, wx0], [base, top], [C.z0, C.z1]);
  // the door side, around the doorway
  const dz0 = DOOR.z0, dz1 = DOOR.z1, dh = DOOR.h;
  add(wood, [wx1, C.x1], [base, top], [C.z0, dz0]);
  add(wood, [wx1, C.x1], [base, top], [dz1, C.z1]);
  add(wood, [wx1, C.x1], [dh, top], [dz0, dz1]);
  add(timber, [ROOM.x1, C.x1], [dh - 0.02, dh], [dz0, dz1]);
  add(timber, [ROOM.x1, C.x1], [0, dh], [dz0 - 0.02, dz0]);
  add(timber, [ROOM.x1, C.x1], [0, dh], [dz1, dz1 + 0.02]);
  add(floor, [ROOM.x1, C.x1], [-0.02, 0.025], [dz0, dz1]); // the threshold
  add(stone, [C.x1, C.x1 + 0.5], [-0.5, STEP_Y], [dz0 - 0.1, dz1 + 0.1]); // a stone step down to the yard
  // the door: hung like the one inside, so they open together
  const leaf = new THREE.Group();
  leaf.position.set(ROOM.x1 - 0.04, 0, dz1);
  scene.add(leaf);
  const dw = dz1 - dz0;
  const doorWood = lambert({ color: '#4a2614' }), pane = hazed(new THREE.MeshBasicMaterial({ color: '#ffd9a0' }));
  pane.color.multiplyScalar(0.9);
  add(doorWood, [0, 0.032], [0, dh], [-dw, 0], leaf);
  add(pane, [0.033, 0.037], [1.3, 1.95], [-dw + 0.14, -0.14], leaf);
  add(lambert({ color: '#b48a3c' }), [0.032, 0.07], [0.96, 1.04], [-dw + 0.08, -dw + 0.14], leaf);
  // gable ends and roof: the ridge runs across, eaves overhang the window and the back
  const zr = (C.z0 + C.z1) / 2;
  const run = zr - (ROOM.z0 - C.eave), rise = run * Math.tan(C.pitch);
  const ridgeY = C.eaveY + rise;
  const gable = new THREE.Mesh(prismGeometry().rotateY(Math.PI / 2), wood);
  const wallRoofY = C.eaveY + (C.z0 - (ROOM.z0 - C.eave)) * Math.tan(C.pitch) - 0.15;
  gable.scale.set(C.x1 - C.x0, ridgeY - wallRoofY, C.z1 - C.z0); // turned, so its length runs across
  gable.position.set(0, wallRoofY, zr);
  scene.add(gable);
  const len = run / Math.cos(C.pitch) + 0.1, wide = C.x1 - C.x0 + 2 * C.overX;
  for (const sgn of [-1, 1]) {
    const cz = zr + (sgn * run) / 2, cy = (C.eaveY + ridgeY) / 2;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(wide, 0.24, len), timber);
    slab.position.set(0, cy, cz);
    slab.rotation.x = sgn * C.pitch;
    scene.add(slab);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(wide + 0.2, 0.45, len + 0.15), snow);
    cap.position.set(0, cy + Math.cos(C.pitch) * 0.33, cz + sgn * Math.sin(C.pitch) * 0.33);
    cap.rotation.x = sgn * C.pitch;
    scene.add(cap);
    // fascia board along the eave
    const ez = zr + sgn * (run + 0.02);
    add(timber, [-wide / 2, wide / 2], [C.eaveY - 0.32, C.eaveY - 0.02], [ez - 0.04, ez + 0.04]);
  }
  // icicles along both eaves
  const r = rng(91);
  const ice = new THREE.ConeGeometry(0.03, 1, 5);
  ice.rotateX(Math.PI);
  ice.translate(0, -0.5, 0);
  const icicles = new THREE.InstancedMesh(ice, lambert({ color: '#d6e4f2', emissive: '#6d84a0' }), 70);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 70; i++) {
    const front = i < 46, len2 = r.chance(0.3) ? r.range(0.35, 0.8) : r.range(0.06, 0.3);
    const ez = zr + (front ? -1 : 1) * (run + 0.02);
    icicles.setMatrixAt(i, m.compose(new THREE.Vector3(r.range(-wide / 2 + 0.2, wide / 2 - 0.2), C.eaveY - 0.32, ez), new THREE.Quaternion(), new THREE.Vector3(r.range(0.7, 1.4), len2, r.range(0.7, 1.4))));
  }
  icicles.frustumCulled = false;
  scene.add(icicles);
  // stone chimney through the back slope, snow on top, smoke drifting off
  const chX = 1.7, chZ = zr + 1.4, chTop = ridgeY + 0.9;
  add(stone, [chX - 0.4, chX + 0.4], [ridgeY - 1.2, chTop], [chZ - 0.4, chZ + 0.4]);
  add(snow, [chX - 0.48, chX + 0.48], [chTop, chTop + 0.16], [chZ - 0.48, chZ + 0.48]);
  const puffMat = new THREE.SpriteMaterial({ map: puffTex(), transparent: true, depthWrite: false, fog: false });
  const puffs = Array.from({ length: 10 }, (_, k) => {
    const sp = new THREE.Sprite(puffMat.clone());
    scene.add(sp);
    return { sp, t: k / 10 };
  });
  const moveSmoke = (dt) => {
    for (const p of puffs) {
      p.t = (p.t + dt / 9) % 1;
      const k = p.t;
      p.sp.position.set(chX + k * 2.2 + Math.sin(k * 7 + p.t) * 0.2, chTop + 0.3 + k * 4.5, chZ + k * 1.2);
      p.sp.scale.setScalar(0.5 + k * 2.4);
      p.sp.material.opacity = Math.sin(Math.PI * k) * 0.8;
    }
  };
  // shuttered windows on the walls the office has none in; each is built facing +z, then turned to its wall
  const shutter = lambert({ map: shutterTex() });
  const shuttered = (x, z, turn) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = turn;
    scene.add(g);
    const w = 0.9, y0 = 1.05, y1 = 2.25;
    add(cream, [-w / 2 - 0.07, w / 2 + 0.07], [y1, y1 + 0.08], [0, 0.07], g);
    add(cream, [-w / 2 - 0.07, -w / 2], [y0, y1], [0, 0.07], g);
    add(cream, [w / 2, w / 2 + 0.07], [y0, y1], [0, 0.07], g);
    add(snow, [-w / 2 - 0.12, w / 2 + 0.12], [y0 - 0.06, y0 + 0.03], [0, 0.17], g);
    add(snow, [-w / 2 - 0.1, w / 2 + 0.1], [y1 + 0.08, y1 + 0.13], [0, 0.1], g);
    add(shutter, [-w / 2, -0.004], [y0 + 0.03, y1], [0.05, 0.085], g);
    add(shutter, [0.004, w / 2], [y0 + 0.03, y1], [0.05, 0.085], g);
  };
  for (const x of [-1.65, 1.65]) shuttered(x, C.z1, 0);
  for (const z of [-1.1, 1.8]) shuttered(C.x0, z, -Math.PI / 2);
  for (const z of [-1.7, 2.75]) shuttered(C.x1, z, Math.PI / 2);
  // a lantern by the door, lit
  const lz = dz0 - 0.32;
  add(timber, [C.x1, C.x1 + 0.2], [1.95, 1.98], [lz - 0.015, lz + 0.015]);
  add(timber, [C.x1 + 0.1, C.x1 + 0.26], [1.89, 1.93], [lz - 0.08, lz + 0.08]);
  add(timber, [C.x1 + 0.11, C.x1 + 0.25], [1.64, 1.67], [lz - 0.07, lz + 0.07]);
  add(hazed(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.5, 0.7) })), [C.x1 + 0.125, C.x1 + 0.235], [1.67, 1.89], [lz - 0.055, lz + 0.055]);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#a8683a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
  halo.position.set(C.x1 + 0.18, 1.78, lz);
  halo.scale.setScalar(0.75);
  scene.add(halo);
  // firewood stacked against the back wall, between its windows, ends out
  const logs = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 9).rotateX(Math.PI / 2), lambert({ color: '#ffffff' }), 66);
  const lr = rng(23), mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), tint = new THREE.Color();
  let li = 0;
  for (let row = 0; row < 6; row++) {
    for (let k = 0; k < 11 && li < 66; k++) {
      const rad = lr.range(0.065, 0.09), xk = -0.85 + k * 0.17 + (row % 2) * 0.08 + lr.range(-0.015, 0.015);
      if (xk > 0.9) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), lr() * TAU);
      logs.setMatrixAt(li, mtx.compose(new THREE.Vector3(xk, -0.32 + row * 0.155, C.z1 + 0.25 + lr.range(-0.03, 0.03)), q, new THREE.Vector3(rad, rad, 0.42)));
      logs.setColorAt(li++, tint.setRGB(0.42, 0.3, 0.19).multiplyScalar(lr.range(0.8, 1.15)));
    }
  }
  logs.count = li;
  scene.add(logs);
  add(timber, [-1.0, 1.0], [0.62, 0.66], [C.z1, C.z1 + 0.55]);
  add(snow, [-1.04, 1.04], [0.66, 0.76], [C.z1, C.z1 + 0.58]);
  dynamic(leaf);
  return {
    leaf, moveSmoke,
    // for the baked shadows on the snow round it
    occluder: boxOccluder(0, ROOM.z0 - zr, C.x1 - C.x0 + 1, C.z1 - C.z0 + 2 * C.eave, 0, -0.4, ridgeY - 0.6),
  };
}

/**
 * The ground round and behind the chalet (the main terrain starts at its front wall), finest close
 * in, reaching back up the mountainside to the ridge.
 */
function yardMesh(mat, low) {
  const nx = low ? 110 : 160, nd = low ? 80 : 110, xs = [], ds = [];
  for (let i = 0; i <= nx; i++) {
    const u = (i / nx) * 2 - 1;
    xs.push(1600 * (0.06 * u + 0.94 * u * u * u));
  }
  for (let j = 0; j <= nd; j++) {
    const v = 1 - j / nd;
    ds.push(2 - 1602 * (0.05 * v + 0.95 * v * v * v));
  }
  const g = new THREE.PlaneGeometry(1, 1, nx, nd);
  const p = g.attributes.position;
  for (let j = 0; j <= nd; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i, x = xs[i], d = ds[nd - j];
      p.setXYZ(k, x, ground(x, d), ROOM.z0 - d);
    }
  }
  g.computeVertexNormals();
  const mask = new Float32Array(p.count * 3);
  const N = new THREE.Vector3();
  for (let k = 0; k < p.count; k++) {
    N.fromBufferAttribute(g.attributes.normal, k);
    const x = p.getX(k), d = ROOM.z0 - p.getZ(k), y = p.getY(k);
    mask[k * 3] = backForest(x, d, y, N.y);
    mask[k * 3 + 2] = N.dot(SUN_DIR) > 0 ? sunVisibility(x, d, y) : 0;
  }
  g.setAttribute('aMask', new THREE.BufferAttribute(mask, 3));
  const m = dynamic(new THREE.Mesh(g, mat));
  m.frustumCulled = false;
  return m;
}

/**
 * Someone walking about outside: on the balcony up to its glass rail, round the chalet (in and out
 * by the door, while it's open), over the yard behind it; never over the cliff edge, through a wall
 * or into a tree. Moves p (a world position) and returns the height of the floor, deck or ground
 * underfoot.
 */
export function walkOutside(p, doorOpen = true) {
  let x = clamp(p.x, -60, 60), d = Math.max(ROOM.z0 - p.z, -70);
  const R = 0.35; // a person's reach, roughly
  if (Math.abs(x) < TERRACE.x1 - R) d = Math.min(d, TERRACE.d1 - 0.3);
  else d = Math.min(d, rimAt(x) - 1.5);
  // the chalet, except through its doorway; in the doorway, stay between the jambs
  const C = CHALET;
  const dLo = ROOM.z0 - C.z1 - R, dHi = ROOM.z0 - C.z0 + R, xLo = C.x0 - R, xHi = C.x1 + R;
  const jamb0 = ROOM.z0 - DOOR.z1 + 0.2, jamb1 = ROOM.z0 - DOOR.z0 - 0.2;
  const inWall = x > ROOM.x1 - 0.4 && x < xHi;
  if (doorOpen && inWall && d > jamb0 - 0.3 && d < jamb1 + 0.3) d = clamp(d, jamb0, jamb1);
  const doorway = doorOpen && inWall && d >= jamb0 && d <= jamb1;
  if (x > xLo && x < xHi && d > dLo && d < dHi && !doorway) {
    const m = Math.min(x - xLo, xHi - x, d - dLo, dHi - d);
    if (m === x - xLo) x = xLo;
    else if (m === xHi - x) x = xHi;
    else if (m === d - dLo) d = dLo;
    else d = dHi;
  }
  // keep out from under the spruces' boughs, which spread to about 0.4 of their height
  for (const [tx, td, th] of NEAR_TREES) {
    const r = Math.hypot(x - tx, d - td), keep = 0.4 * th;
    if (r < keep && r > 1e-3) {
      x = tx + ((x - tx) / r) * keep;
      d = td + ((d - td) / r) * keep;
    }
  }
  p.x = x;
  p.z = ROOM.z0 - d;
  if (doorway && x < C.x1) return 0; // still on the office floor
  if (x < C.x1 + 0.5 && d > jamb0 - 0.1 && d < jamb1 + 0.1) return STEP_Y; // the stone step
  const onDeck = Math.abs(x) < TERRACE.x1 && d > TERRACE.d0 - 0.4 && d < TERRACE.d1;
  return onDeck ? TERRACE.snow : ground(x, d);
}

/** Height of whatever you'd stand on at world (x, z) outside: the balcony, the door step, the yard or the mountainside. */
export function standHeight(x, z) {
  const d = ROOM.z0 - z;
  if (x > CHALET.x1 && x < CHALET.x1 + 0.5 && z > DOOR.z0 - 0.1 && z < DOOR.z1 + 0.1) return STEP_Y;
  const onDeck = Math.abs(x) < TERRACE.x1 && d > TERRACE.d0 - 0.4 && d < TERRACE.d1;
  return onDeck ? TERRACE.snow : ground(x, d);
}

/** Where a ray from `o` along unit `dir` first meets the ground outside, within `max` metres; null if it doesn't. */
export function groundHit(o, dir, max = 80) {
  const gap = (t) => o.y + dir.y * t - standHeight(o.x + dir.x * t, o.z + dir.z * t);
  let a = 0, t = 0.05;
  while (t < max) {
    if (gap(t) <= 0) {
      let b = t;
      for (let i = 0; i < 10; i++) {
        const m = (a + b) / 2;
        if (gap(m) > 0) a = m;
        else b = m;
      }
      return new THREE.Vector3().copy(o).addScaledVector(dir, b);
    }
    a = t;
    t += 0.12 + t * 0.03;
  }
  return null;
}

/* ---------------- assemble ---------------- */

export function buildOutdoors({ quality }) {
  const low = quality.name === 'low';
  buildHeightField(low);
  const scene = new THREE.Scene();
  const sky = skyDome();
  scene.add(sky);
  const sun = new THREE.DirectionalLight(SUN.color, SUN.intensity);
  sun.position.copy(SUN_DIR).multiplyScalar(1000);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(SKY.sky, SKY.ground, SKY.intensity));
  const groundMat = terrainMaterial();
  scene.add(terrainMesh(low, groundMat));
  scene.add(rangeMesh(low, groundMat));
  const trees = forest(low);
  scene.add(...trees.meshes);
  const n0 = scene.children.length;
  const railing = terrace(scene, groundMat);
  scene.add(yardMesh(groundMat, low));
  const home = chaletExterior(scene);
  for (const o of [...scene.children.slice(n0), trees.yard]) {
    o.traverse((m) => m.isMesh && !m.material.transparent && m.layers.enable(NEAR_LAYER));
  }
  const houses = chalets(scene);
  village(scene);
  const lifts = LIFTS.map((l) => chairlift(scene, l));
  const people = skiers(scene, low);
  const flyHeli = helicopter(scene, people.drop);
  // shadows: the railing striped across the balcony snow, and the trees and chalets on the cliff tops
  const deck = bakeShadows({ x0: TERRACE.x0 - 1, x1: TERRACE.x1 + 3, d0: 0, d1: TERRACE.d1 + 0.1, cell: 0.03 }, () => TERRACE.snow, railing, 2);
  const meadow = bakeShadows({ x0: -220, x1: 220, d0: -60, d1: 240, cell: low ? 0.7 : 0.5 }, cliffside, [
    home.occluder,
    ...trees.shadowed.map(([x, d, y, h, rad]) => treeOccluder(x, d, y, h, rad)),
    ...houses,
  ]);
  const u = groundMat.uniforms;
  u.uShadeA.value = deck.tex;
  u.uShadeABox.value = deck.box;
  u.uShadeB.value = meadow.tex;
  u.uShadeBBox.value = meadow.box;
  // everything that never moves and shares a material goes out in one draw
  mergeStatic(scene);
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 9000);
  camera.matrixAutoUpdate = false;
  camera.matrixWorldAutoUpdate = false;
  return {
    scene, camera,
    /** The chalet's door, which opens with the one inside. */
    setDoor: (a) => (home.leaf.rotation.y = a),
    update(dt, t) {
      sky.material.uniforms.uTime.value = t;
      for (const move of lifts) move(t);
      people.update(dt, t);
      flyHeli(dt, t);
      home.moveSmoke(dt);
    },
  };
}

/** A painted stand-in for the view, used once when baking the room's reflections. */
export function envCard() {
  const [c, g] = T.makeCanvas(256, 160, 1);
  const sky = g.createLinearGradient(0, 0, 0, 160);
  sky.addColorStop(0, '#5a7cb8');
  sky.addColorStop(0.55, '#c9d3e8');
  sky.addColorStop(0.75, '#f4d2b4');
  g.fillStyle = sky;
  g.fillRect(0, 0, 256, 160);
  g.fillStyle = '#eef1f6';
  g.beginPath();
  g.moveTo(0, 120);
  for (let x = 0; x <= 256; x += 8) g.lineTo(x, 95 + Math.sin(x * 0.07) * 18 + Math.sin(x * 0.19) * 6);
  g.lineTo(256, 160);
  g.lineTo(0, 160);
  g.fill();
  g.fillStyle = '#2b4032';
  g.fillRect(0, 140, 256, 20);
  const mat = new THREE.MeshBasicMaterial({ map: T.toTexture(c), fog: false });
  mat.color.setScalar(1.6);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 8), mat);
  m.position.set(0.5, 2.0, ROOM.z0 - 9.5);
  return m;
}
