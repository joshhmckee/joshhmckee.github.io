import * as THREE from '../vendor/three.module.min.js';
import { std, box, boxB, cyl, put, dynamic, mergeGroup, rng, TAU } from './util.js';
import * as T from './textures.js';
import { pothos } from './plants.js';

const CASE_H = 2.88;
const CASE_D = 0.4;
const COUNTER_Y = 0.885;
const ROWS = 5;
const ROW_H = (CASE_H - COUNTER_Y - 0.11) / ROWS;
const SHELF_T = 0.024;

/** Accumulates book boxes into one big vertex-coloured geometry (one draw call). */
class BookBuilder {
  constructor(atlas) {
    this.atlas = atlas;
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.v = new THREE.Vector3();
    this.n = new THREE.Vector3();
    this.nm = new THREE.Matrix3();
    this.count = 0;
  }

  quad(m, corners, normal, uvRect, color, rot = false) {
    this.nm.getNormalMatrix(m);
    const base = this.pos.length / 3;
    const { u0, u1, v0, v1 } = uvRect;
    const uvs = rot ? [[u0, v1], [u0, v0], [u1, v0], [u1, v1]] : [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    for (let i = 0; i < 4; i++) {
      this.v.fromArray(corners[i]).applyMatrix4(m);
      this.pos.push(this.v.x, this.v.y, this.v.z);
      this.n.fromArray(normal).applyMatrix3(this.nm).normalize();
      this.nor.push(this.n.x, this.n.y, this.n.z);
      this.uv.push(uvs[i][0], uvs[i][1]);
      this.col.push(color.r, color.g, color.b);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Book in local space: x across the thickness, y up from the tail, spine facing +z. */
  add({ w, h, d, cell }, m) {
    const { pages, plain } = this.atlas;
    const hw = w / 2, hd = d / 2;
    const white = BookBuilder.WHITE, cream = BookBuilder.CREAM;
    const cover = cell.color;
    this.quad(m, [[-hw, 0, hd], [hw, 0, hd], [hw, h, hd], [-hw, h, hd]], [0, 0, 1], cell, white);
    this.quad(m, [[-hw, h, hd], [hw, h, hd], [hw, h, -hd], [-hw, h, -hd]], [0, 1, 0], pages, cream);
    this.quad(m, [[-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd]], [0, -1, 0], pages, cream);
    this.quad(m, [[hw, 0, hd], [hw, 0, -hd], [hw, h, -hd], [hw, h, hd]], [1, 0, 0], plain, cover);
    this.quad(m, [[-hw, 0, -hd], [-hw, 0, hd], [-hw, h, hd], [-hw, h, -hd]], [-1, 0, 0], plain, cover);
    this.count++;
  }

  build(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'books';
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}
BookBuilder.WHITE = new THREE.Color(1, 1, 1);
BookBuilder.CREAM = new THREE.Color().setRGB(0.93, 0.88, 0.76, THREE.SRGBColorSpace);

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

function bookMatrix(caseMatrix, x, y, z, rz = 0, ry = 0) {
  tmpE.set(0, ry, rz, 'YXZ');
  tmpQ.setFromEuler(tmpE);
  tmpP.set(x, y, z);
  tmpM.compose(tmpP, tmpQ, ONE);
  return new THREE.Matrix4().multiplyMatrices(caseMatrix, tmpM);
}

/* ------------------------------------------------------------------ */

export function buildShelves(ctx) {
  const { scene, mats } = ctx;
  const atlas = T.bookAtlas(12);
  mats.books = std({ map: atlas.tex, vertexColors: true, roughness: 0.72 });
  const builder = new BookBuilder(atlas);

  const caseWood = T.woodTex({ light: '#5e321d', dark: '#22100a', seed: 30, rings: 5 });
  mats.case = std({ map: caseWood, roughness: 0.55 });
  mats.caseBack = std({ color: '#25130b', roughness: 0.9 });
  mats.casePanel = std({ map: T.panelTex({ light: '#5e321d', dark: '#22100a', seed: 31, frame: 12 }), roughness: 0.55 });
  mats.brass = mats.brass || std({ color: '#b48a3c', roughness: 0.32, metalness: 0.75 });
  const decor = makeDecorMaterials(mats);

  const cases = [
    { name: 'backLeft', origin: [-3.0, 0, -3.4], rotY: 0, length: 1.38, bays: 2, seed: 101, hero: { bay: 1, row: 1 } },
    { name: 'backRight', origin: [1.62, 0, -3.4], rotY: 0, length: 1.38, bays: 2, seed: 202 },
    { name: 'left', origin: [-3.0, 0, 1.7], rotY: Math.PI / 2, length: 4.7, bays: 6, seed: 303, ladder: 2.25 },
  ];

  const heroSlots = [];
  for (const c of cases) {
    const g = new THREE.Group();
    g.name = `case-${c.name}`;
    g.position.set(c.origin[0], c.origin[1], c.origin[2]);
    g.rotation.y = c.rotY;
    scene.add(g);
    g.updateMatrixWorld(true);
    buildCase(g, c, mats);
    const r = rng(c.seed);
    const bayW = c.length / c.bays;
    for (let b = 0; b < c.bays; b++) {
      for (let row = 0; row < ROWS; row++) {
        const x0 = b * bayW + (b === 0 ? 0.035 : 0.016);
        const x1 = (b + 1) * bayW - (b === c.bays - 1 ? 0.035 : 0.016);
        const y = COUNTER_Y + 0.0175 + row * ROW_H + (row === 0 ? 0 : SHELF_T / 2);
        const clearance = ROW_H - SHELF_T - 0.012;
        if (c.hero && c.hero.bay === b && c.hero.row === row) {
          heroSlots.push({ group: g, x0, x1, y, clearance });
          continue;
        }
        fillShelf({ builder, atlas, r, g, x0, x1, y, clearance, decor });
      }
    }
    if (c.ladder) {
      ctx.ladder = buildLadder(g, c, mats);
      pictureLights(g, c, mats);
    }
  }

  const booksMesh = builder.build(mats.books);
  scene.add(booksMesh);
  ctx.bookCount = builder.count;

  // hero shelf: the clickable resource books
  const hero = heroSlots[0];
  ctx.heroShelf = hero;
  ctx.shelfFill = (from) => fillShelf({ builder: null, atlas, r: rng(9), g: hero.group, x0: from, x1: hero.x1, y: hero.y, clearance: hero.clearance, decor, direct: true, mats });
  ctx.caseGroups = cases.map((c) => scene.getObjectByName(`case-${c.name}`));
}

function makeDecorMaterials(mats) {
  return {
    brass: mats.brass,
    ceramic: [
      std({ color: '#2f5a6f', roughness: 0.25 }),
      std({ color: '#d9cdb0', roughness: 0.3 }),
      std({ color: '#7a2a20', roughness: 0.28 }),
      std({ color: '#3b5a3a', roughness: 0.3 }),
    ],
    frame: std({ color: '#2a1a10', roughness: 0.5 }),
    photo: [std({ color: '#8a7a62', roughness: 0.6 }), std({ color: '#5a6a7a', roughness: 0.6 }), std({ color: '#7a5a4a', roughness: 0.6 })],
    leaf: std({ color: '#2f5a2a', roughness: 0.6 }),
    pot: std({ color: '#9a4f2f', roughness: 0.8 }),
    marble: std({ color: '#d6d0c4', roughness: 0.25 }),
  };
}

function buildCase(g, c, mats) {
  const L = c.length, D = CASE_D, H = CASE_H;
  const bayW = L / c.bays;
  boxB(g, L - 0.02, 0.1, D - 0.04, mats.caseBack, [L / 2, 0, (D - 0.04) / 2]);
  boxB(g, L, 0.75, D - 0.03, mats.case, [L / 2, 0.1, (D - 0.03) / 2]);
  for (let b = 0; b < c.bays; b++) {
    const cx = (b + 0.5) * bayW;
    const half = (bayW - 0.014) / 2;
    for (const s of [-1, 1]) {
      box(g, half - 0.006, 0.71, 0.022, mats.casePanel, [cx + s * (half / 2 + 0.003), 0.475, D - 0.02]);
      put(g, new THREE.SphereGeometry(0.012, 8, 6), mats.brass, [cx + s * 0.03, 0.72, D - 0.003]);
    }
  }
  box(g, L + 0.03, 0.035, D + 0.035, mats.case, [L / 2, COUNTER_Y, D / 2 + 0.005]);

  const upperH = H - COUNTER_Y - 0.08;
  const upperY = COUNTER_Y + 0.0175 + upperH / 2;
  box(g, L, upperH, 0.012, mats.caseBack, [L / 2, upperY, 0.006], { cast: false });
  box(g, 0.03, upperH, D - 0.025, mats.case, [0.015, upperY, (D - 0.025) / 2]);
  box(g, 0.03, upperH, D - 0.025, mats.case, [L - 0.015, upperY, (D - 0.025) / 2]);
  for (let b = 1; b < c.bays; b++) box(g, 0.022, upperH, D - 0.03, mats.case, [b * bayW, upperY, (D - 0.03) / 2]);
  for (let k = 1; k < ROWS; k++) {
    const y = COUNTER_Y + 0.0175 + k * ROW_H;
    box(g, L - 0.04, SHELF_T, D - 0.03, mats.case, [L / 2, y, (D - 0.03) / 2]);
    box(g, L - 0.04, 0.034, 0.016, mats.case, [L / 2, y - 0.004, D - 0.03], { cast: false });
  }
  // face frame stiles
  for (let b = 0; b <= c.bays; b++) {
    const sx = b === 0 ? 0.022 : b === c.bays ? L - 0.022 : b * bayW;
    box(g, 0.045, upperH, 0.02, mats.case, [sx, upperY, D - 0.012]);
  }
  box(g, L, 0.03, D, mats.case, [L / 2, H - 0.095, D / 2]);
  box(g, L + 0.05, 0.075, D + 0.035, mats.case, [L / 2, H - 0.045, D / 2 + 0.01]);
  box(g, L + 0.09, 0.03, D + 0.065, mats.case, [L / 2, H - 0.002, D / 2 + 0.02]);
}

/** Brass picture lights along the top of the long bookcase. */
function pictureLights(g, c, mats) {
  const bayW = c.length / c.bays;
  const glow = new THREE.MeshBasicMaterial({ color: '#ffe2b0' });
  glow.color.multiplyScalar(2.6);
  const y = CASE_H - 0.15;
  for (let b = 0; b < c.bays; b++) {
    const x = (b + 0.5) * bayW;
    cyl(g, 0.016, 0.016, bayW * 0.55, 10, mats.brass, [x, y, CASE_D + 0.09], { r: [0, 0, Math.PI / 2], cast: false });
    cyl(g, 0.008, 0.008, bayW * 0.5, 6, glow, [x, y - 0.014, CASE_D + 0.085], { r: [0, 0, Math.PI / 2], cast: false });
    box(g, 0.02, 0.02, 0.1, mats.brass, [x, y + 0.01, CASE_D + 0.04], { cast: false });
  }
}

/** A library ladder hooked over a brass rail; it rolls along the rail (local x) when dragged. */
function buildLadder(g, c, mats) {
  const lx = c.ladder;
  const rail = cyl(g, 0.012, 0.012, c.length - 0.1, 8, mats.brass, [c.length / 2, 2.62, CASE_D + 0.05], { r: [0, 0, Math.PI / 2] });
  void rail;
  const lad = dynamic(new THREE.Group());
  lad.name = 'ladder';
  lad.position.set(lx, 0, CASE_D + 0.5);
  lad.rotation.x = -Math.atan2(0.45, 2.62);
  g.add(lad);
  const len = Math.hypot(2.62, 0.45);
  for (const s of [-1, 1]) boxB(lad, 0.04, len, 0.03, mats.case, [s * 0.22, 0, 0]);
  for (let y = 0.28; y < len - 0.1; y += 0.3) cyl(lad, 0.014, 0.014, 0.44, 8, mats.case, [0, y, 0], { r: [0, 0, Math.PI / 2] });
  for (const s of [-1, 1]) {
    put(lad, new THREE.TorusGeometry(0.03, 0.007, 6, 10, Math.PI), mats.brass, [s * 0.22, len - 0.02, -0.02], { r: [0, Math.PI / 2, 0] });
    cyl(lad, 0.025, 0.025, 0.02, 10, mats.brass, [s * 0.22, 0.02, 0.02], { r: [0, 0, Math.PI / 2] });
  }
  // rails and rungs are thin: an invisible panel over the whole ladder makes it easy to grab
  const grab = new THREE.Mesh(new THREE.PlaneGeometry(0.56, len), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
  grab.position.y = len / 2;
  mergeGroup(lad);
  lad.add(grab);
  return { group: lad, track: g, min: 0.3, max: c.length - 0.3 };
}

/* ------------------------------------------------------------------ */
/* Shelf filling                                                       */
/* ------------------------------------------------------------------ */

function fillShelf({ builder, atlas, r, g, x0, x1, y, clearance, decor, direct = false, mats = null }) {
  const cells = atlas.cells;
  const M = g.matrixWorld;
  const front = CASE_D - 0.035;
  const directBuilder = direct ? new BookBuilder(atlas) : null;
  const B = builder || directBuilder;
  let x = x0;
  let decorUsed = 0;
  while (x < x1 - 0.025) {
    const room = x1 - x;
    const roll = r();
    if (roll < 0.04) {
      x += r.range(0.03, 0.1);
      continue;
    }
    if (roll < 0.1 && room > 0.3) {
      // horizontal stack of books
      const n = r.int(3, 6);
      const len = r.range(0.2, Math.min(0.29, clearance));
      let sy = y;
      for (let i = 0; i < n; i++) {
        const t = r.range(0.022, 0.05);
        if (sy + t - y > clearance - 0.02) break;
        const bl = len * r.range(0.86, 1);
        const bd = r.range(0.15, 0.24);
        const cell = r.pick(cells);
        const m = bookMatrix(M, x + bl, sy + t / 2, front - bd / 2 - r.range(0, 0.02), Math.PI / 2, r.range(-0.06, 0.06));
        B.add({ w: t, h: bl, d: bd, cell }, m);
        sy += t;
      }
      x += len + r.range(0.012, 0.03);
      continue;
    }
    if (roll < 0.14 && decorUsed < 1 && room > 0.2 && !direct) {
      x += placeDecor(g, r, x, y, clearance, decor) + 0.02;
      decorUsed++;
      continue;
    }
    // a run: series volumes share a design, otherwise mixed books
    const series = r.chance(0.22);
    const n = series ? r.int(4, 9) : r.int(4, 14);
    const sCell = r.pick(cells);
    const sH = Math.min(clearance - 0.015, r.range(0.2, 0.32));
    const sW = r.range(0.026, 0.05);
    const sD = r.range(0.16, 0.24);
    for (let i = 0; i < n && x < x1 - 0.02; i++) {
      const cell = series ? sCell : r.pick(cells);
      const binder = cell.style === 'binder';
      let bh = series ? sH : Math.min(clearance - 0.012, binder ? r.range(0.28, 0.31) : r.range(0.17, 0.33));
      let bw = series ? sW : binder ? r.range(0.05, 0.075) : r.range(0.016, 0.058);
      const bd = series ? sD : binder ? 0.26 : r.range(0.13, 0.25);
      if (x + bw > x1) bw = x1 - x;
      if (bw < 0.012) break;
      bh = Math.max(0.12, bh);
      const lean = !series && i === n - 1 && r.chance(0.35) ? r.range(0.12, 0.32) : 0;
      const inset = r.range(0, 0.025);
      const m = bookMatrix(M, x + bw / 2 + Math.sin(lean) * bh, y + (lean ? Math.sin(lean) * bw * 0.5 : 0), front - bd / 2 - inset, lean, r.range(-0.015, 0.015));
      B.add({ w: bw, h: bh, d: bd, cell }, m);
      x += bw + (lean ? Math.sin(lean) * bh + 0.01 : r.chance(0.08) ? r.range(0.003, 0.01) : 0.0005);
    }
  }
  if (directBuilder && directBuilder.count) {
    const mesh = directBuilder.build(mats.books);
    mesh.matrixAutoUpdate = false;
    g.parent.add(mesh);
  }
}

function placeDecor(g, r, x, y, clearance, decor) {
  const kind = r.pick(['vase', 'frame', 'bookends', 'globe', 'trophy', 'plant', 'box']);
  const z = CASE_D * 0.5;
  const dyn = (m) => m;
  if (kind === 'vase') {
    const pts = [];
    const h = r.range(0.14, Math.min(0.26, clearance - 0.02));
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push(new THREE.Vector2(0.02 + Math.sin(t * Math.PI) * r.range(0.035, 0.05) + (t > 0.8 ? 0.01 : 0), t * h));
    }
    dyn(put(g, new THREE.LatheGeometry(pts, 12), r.pick(decor.ceramic), [x + 0.06, y, z]));
    return 0.12;
  }
  if (kind === 'frame') {
    const fw = r.range(0.12, 0.18), fh = r.range(0.15, Math.min(0.22, clearance - 0.03));
    box(g, fw, fh, 0.015, decor.frame, [x + fw / 2, y + fh / 2, z - 0.05], { r: [-0.12, 0, 0] });
    box(g, fw - 0.03, fh - 0.03, 0.004, r.pick(decor.photo), [x + fw / 2, y + fh / 2 + 0.002, z - 0.04], { r: [-0.12, 0, 0] });
    return fw;
  }
  if (kind === 'bookends') {
    boxB(g, 0.012, 0.15, 0.1, decor.brass, [x + 0.006, y, z + 0.05]);
    boxB(g, 0.08, 0.008, 0.1, decor.brass, [x + 0.04, y, z + 0.05]);
    return 0.09;
  }
  if (kind === 'globe') {
    cyl(g, 0.035, 0.045, 0.015, 10, decor.brass, [x + 0.06, y + 0.0075, z]);
    cyl(g, 0.005, 0.005, 0.05, 6, decor.brass, [x + 0.06, y + 0.04, z]);
    put(g, new THREE.SphereGeometry(0.055, 12, 8), decor.ceramic[0], [x + 0.06, y + 0.115, z]);
    return 0.12;
  }
  if (kind === 'trophy') {
    boxB(g, 0.07, 0.03, 0.07, decor.marble, [x + 0.05, y, z]);
    cyl(g, 0.008, 0.008, 0.06, 6, decor.brass, [x + 0.05, y + 0.06, z]);
    put(g, new THREE.LatheGeometry([0, 0.3, 0.6, 1].map((t) => new THREE.Vector2(0.01 + t * 0.035, t * 0.06)), 12), decor.brass, [x + 0.05, y + 0.09, z]);
    return 0.1;
  }
  if (kind === 'plant') {
    pothos(g, [x + 0.06, y, z + 0.04], 8 + Math.floor(r() * 50));
    return 0.13;
  }
  boxB(g, 0.16, 0.07, 0.11, r.pick(decor.ceramic), [x + 0.08, y, z]);
  return 0.16;
}

/* ------------------------------------------------------------------ */
/* Hero books: the clickable reading list                              */
/* ------------------------------------------------------------------ */

const HERO_COLORS = ['#5e1a16', '#1d3a2a', '#1c2a4a', '#3a2412', '#4a1630', '#24302a', '#5a3a14', '#2a2a2a', '#40201a', '#183040'];

export function buildHeroBooks(ctx, items) {
  const { mats } = ctx;
  const hero = ctx.heroShelf;
  const g = hero.group;
  const front = CASE_D - 0.03;
  const pagesMat = std({ color: '#e6dcc2', roughness: 0.9 });
  let x = hero.x0 + 0.004;
  // brass bookend on the left
  boxB(g, 0.01, 0.17, 0.12, mats.brass, [x + 0.005, hero.y, front - 0.07]);
  boxB(g, 0.09, 0.006, 0.12, mats.brass, [x + 0.045, hero.y, front - 0.07]);
  x += 0.014;
  const books = [];
  items.forEach((item, i) => {
    const r = rng(500 + i);
    const w = r.range(0.048, 0.06);
    const h = Math.min(hero.clearance - 0.02, r.range(0.27, 0.3));
    const d = 0.2;
    const color = item.color || HERO_COLORS[i % HERO_COLORS.length];
    const cover = std({ color, roughness: 0.55 });
    const spine = std({ map: T.heroSpineTex({ title: item.spine, author: item.mark || '', color, seed: 40 + i }), roughness: 0.5 });
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(0, h / 2, 0);
    const mesh = new THREE.Mesh(geo, [cover, cover, pagesMat, pagesMat, spine, cover]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(x + w / 2, hero.y, front - d / 2 - 0.004);
    mesh.rotation.z = r.range(-0.006, 0.006);
    mesh.name = `book:${item.id}`;
    dynamic(mesh);
    g.add(mesh);
    books.push({ item, mesh, home: mesh.position.clone(), out: 0, target: 0 });
    x += w + 0.0015;
  });
  // second bookend, a little space, then ordinary books to the end of the bay
  x += 0.004;
  boxB(g, 0.01, 0.17, 0.12, mats.brass, [x + 0.005, hero.y, front - 0.07]);
  boxB(g, 0.09, 0.006, 0.12, mats.brass, [x - 0.035, hero.y, front - 0.07]);
  x += 0.05;
  if (x < hero.x1 - 0.05) ctx.shelfFill(x);
  // little engraved plate on the shelf lip
  const plate = std({ map: T.brassPlateTex('THE LIBRARY'), roughness: 0.3, metalness: 0.6 });
  box(g, 0.2, 0.034, 0.004, plate, [hero.x0 + 0.26, hero.y - 0.024, CASE_D - 0.02], { cast: false });

  // brass shelf light mounted on the face frame, washing the reading list
  const lx = (hero.x0 + hero.x1) / 2;
  const ly = hero.y + hero.clearance + 0.035;
  cyl(g, 0.014, 0.014, 0.42, 10, mats.brass, [lx, ly - 0.03, CASE_D + 0.07], { r: [0, 0, Math.PI / 2], cast: false });
  box(g, 0.02, 0.02, 0.08, mats.brass, [lx, ly - 0.02, CASE_D + 0.03], { cast: false });
  const glowMat = new THREE.MeshBasicMaterial({ color: '#fff0c8' });
  glowMat.color.setScalar(3);
  box(g, 0.38, 0.005, 0.01, glowMat, [lx, ly - 0.045, CASE_D + 0.07], { cast: false });
  const shelfLight = new THREE.SpotLight('#ffd9a0', 1.5, 1.4, 1.15, 0.95, 1.3);
  shelfLight.position.set(lx, ly - 0.05, CASE_D + 0.09);
  shelfLight.target.position.set(lx, hero.y + 0.05, CASE_D - 0.12);
  g.add(shelfLight, shelfLight.target);

  const centre = new THREE.Vector3((hero.x0 + hero.x1) / 2 - 0.08, hero.y + 0.16, front);
  g.localToWorld(centre);
  return { books, centre, group: g };
}
