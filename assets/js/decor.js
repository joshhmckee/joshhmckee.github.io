import * as THREE from '../vendor/three.module.min.js';
import { ROOM } from './layout.js';
import { std, basic, box, boxB, cyl, put, dynamic, rng, TAU, DEG } from './util.js';
import * as T from './textures.js';
import { rubberPlant, snakePlant } from './plants.js';

/** Objects on a wall group: local +z points into the room, local x runs along the wall. */
function wallGroup(scene, { x, z, rotY }) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  scene.add(g);
  return g;
}

export function buildDecor(ctx) {
  const { scene, mats } = ctx;
  const X1 = ROOM.x1;

  /* ---------------- rug ---------------- */
  const rug = std({ map: T.rugTex(), roughness: 1 });
  put(scene, new THREE.BoxGeometry(3.3, 0.008, 2.4), [rug, rug, rug, rug, rug, rug], [0, 0.004, -0.62], { cast: false });

  /* ---------------- right wall: credenza with hi-fi, tapes, globe ---------------- */
  // local x runs from z = -2.62 toward +z; local +z faces into the room (-x)
  const cred = wallGroup(scene, { x: X1, z: -2.62, rotY: -Math.PI / 2 });
  cred.name = 'credenza';
  const L = 1.6, Dp = 0.5, H = 0.78;
  boxB(cred, L - 0.02, 0.08, Dp - 0.05, mats.caseBack, [L / 2, 0, Dp / 2 - 0.02]);
  boxB(cred, L, H - 0.12, Dp - 0.03, mats.case, [L / 2, 0.08, Dp / 2 - 0.01]);
  for (let i = 0; i < 4; i++) {
    box(cred, L / 4 - 0.014, H - 0.16, 0.022, mats.casePanel, [(i + 0.5) * (L / 4), 0.08 + (H - 0.16) / 2 + 0.01, Dp - 0.02]);
    put(cred, new THREE.SphereGeometry(0.012, 8, 6), mats.brass, [(i + 0.5) * (L / 4) + (i % 2 ? -0.15 : 0.15), 0.5, Dp - 0.004]);
  }
  box(cred, L + 0.03, 0.04, Dp + 0.03, mats.case, [L / 2, H - 0.02, Dp / 2]);
  const topY = H;

  // speakers
  const grille = std({ map: T.grilleTex(), roughness: 1 });
  grille.map.repeat.set(4, 6);
  const spkWood = std({ map: T.woodTex({ light: '#6a4428', dark: '#3a2010', seed: 71 }), roughness: 0.5 });
  for (const sx of [0.53, 1.48]) {
    put(cred, new THREE.BoxGeometry(0.2, 0.3, 0.22), [spkWood, spkWood, spkWood, spkWood, grille, spkWood], [sx, topY + 0.15, 0.24]);
  }
  // receiver
  const hifi = T.hifiTex();
  const hifiFront = std({ map: hifi.map, emissive: '#ffffff', emissiveMap: hifi.emissive, emissiveIntensity: 1.2, roughness: 0.35, metalness: 0.5 });
  const silver = std({ color: '#b9b5aa', roughness: 0.35, metalness: 0.6 });
  const walnut = std({ map: T.woodTex({ light: '#4a2a18', dark: '#1e0f07', seed: 72 }), roughness: 0.45 });
  const recv = dynamic(new THREE.Group());
  recv.position.set(0.95, topY, 0.22);
  cred.add(recv);
  const vents = std({ map: ventTex(), roughness: 0.4, metalness: 0.5 });
  put(recv, new THREE.BoxGeometry(0.46, 0.13, 0.3), [walnut, walnut, vents, silver, hifiFront, silver], [0, 0.065, 0]);
  ctx.hifi = { group: recv, front: hifiFront, playing: 0 };

  // tapes lie in a loose row on the front strip, in front of the receiver
  const rack = new THREE.Group();
  rack.position.set(0.95, topY, 0.44);
  cred.add(rack);
  ctx.tapeRack = { group: rack, cred };

  // small brass lamp with a pleated shade at the end of the credenza
  const tl = new THREE.Group();
  tl.position.set(1.28, topY, 0.13);
  cred.add(tl);
  cyl(tl, 0.06, 0.07, 0.025, 14, mats.brass, [0, 0.0125, 0]);
  cyl(tl, 0.012, 0.012, 0.32, 8, mats.brass, [0, 0.18, 0]);
  const tlShade = std({ color: '#efdcae', emissive: '#ffbf6a', emissiveIntensity: 0.9, roughness: 0.8, side: THREE.DoubleSide });
  cyl(tl, 0.07, 0.13, 0.15, 16, tlShade, [0, 0.39, 0], { open: true, cast: false });
  const tlLight = new THREE.PointLight('#ffc27a', 1.4, 2.6, 1.5);
  tlLight.position.set(0, 0.36, 0);
  tl.add(tlLight);

  // desktop globe
  const globeG = dynamic(new THREE.Group());
  globeG.position.set(0.19, topY, 0.24);
  globeG.name = 'globe';
  cred.add(globeG);
  cyl(globeG, 0.07, 0.085, 0.03, 16, walnut, [0, 0.015, 0]);
  cyl(globeG, 0.01, 0.012, 0.12, 8, mats.brass, [0, 0.09, 0]);
  const tiltG = new THREE.Group();
  tiltG.position.set(0, 0.29, 0);
  tiltG.rotation.z = 23.4 * DEG;
  globeG.add(tiltG);
  put(tiltG, new THREE.TorusGeometry(0.155, 0.006, 6, 24, Math.PI * 1.25), mats.brass, [0, 0, 0], { r: [0, 0, -Math.PI * 0.62] });
  const sphere = put(tiltG, new THREE.SphereGeometry(0.14, 24, 16), std({ map: T.globeTex(), roughness: 0.35 }), [0, 0, 0]);
  ctx.globe = { group: globeG, sphere, spin: 0.25 };
  ctx.anchors.globe = cred.localToWorld(new THREE.Vector3(0.19, topY + 0.3, 0.24));
  ctx.anchors.hifi = cred.localToWorld(new THREE.Vector3(0.95, topY + 0.1, 0.34));

  /* ---------------- right wall decor ---------------- */
  const wall = wallGroup(scene, { x: X1 - 0.005, z: 0, rotY: -Math.PI / 2 });
  // wall local x = world z (since rotY = -90deg maps local x to +z)
  const frameGold = std({ color: '#a8823a', roughness: 0.35, metalness: 0.7 });
  const frameDark = std({ color: '#2a1a10', roughness: 0.5 });
  const framed = (parent, cz, cy, w, h, map, { frame = frameGold, depth = 0.04, border = 0.06, emissive = 0 } = {}) => {
    const pic = std({ map, roughness: 0.75, emissive: emissive ? '#ffffff' : '#000000', emissiveMap: emissive ? map : null, emissiveIntensity: emissive });
    box(parent, w, h, 0.01, pic, [cz, cy, 0.012], { cast: false });
    box(parent, w + border * 2, border, depth, frame, [cz, cy + h / 2 + border / 2, depth / 2]);
    box(parent, w + border * 2, border, depth, frame, [cz, cy - h / 2 - border / 2, depth / 2]);
    box(parent, border, h, depth, frame, [cz - w / 2 - border / 2, cy, depth / 2]);
    box(parent, border, h, depth, frame, [cz + w / 2 + border / 2, cy, depth / 2]);
  };
  framed(wall, -1.82, 1.66, 0.86, 0.58, T.paintingTex(), { border: 0.075, depth: 0.05 });
  // brass picture light washing the painting
  cyl(wall, 0.018, 0.018, 0.5, 10, mats.brass, [-1.82, 2.08, 0.16], { r: [0, 0, Math.PI / 2], cast: false });
  box(wall, 0.02, 0.02, 0.14, mats.brass, [-1.82, 2.04, 0.08], { cast: false });
  const pl = basic({ color: '#fff0c8' });
  pl.color.setScalar(3);
  box(wall, 0.44, 0.006, 0.012, pl, [-1.82, 2.065, 0.17], { cast: false });
  const picLight = new THREE.SpotLight('#ffd9a0', 2.2, 1.6, 0.9, 0.8, 1.5);
  picLight.position.set(X1 - 0.17, 2.05, -1.82);
  picLight.target.position.set(X1 - 0.02, 1.55, -1.82);
  scene.add(picLight, picLight.target);
  framed(wall, 0.02, 1.86, 0.44, 0.3, T.certificateTex(), { frame: frameDark, border: 0.035, depth: 0.03 });
  framed(wall, 2.15, 1.55, 0.36, 0.24, T.samplerTex(), { frame: frameDark, border: 0.03, depth: 0.025 });
  // brass wall sconce above the sampler, lighting the door wall
  box(wall, 0.07, 0.13, 0.015, mats.brass, [2.15, 2.02, 0.008]);
  cyl(wall, 0.008, 0.008, 0.12, 6, mats.brass, [2.15, 2.0, 0.07], { r: [Math.PI / 2, 0, 0], cast: false });
  const sconceShade = std({ color: '#efdcae', emissive: '#ffc070', emissiveIntensity: 1.1, roughness: 0.8, side: THREE.DoubleSide });
  cyl(wall, 0.05, 0.085, 0.12, 14, sconceShade, [2.15, 2.07, 0.13], { open: true, cast: false });
  const sconce = new THREE.PointLight('#ffc98a', 1.4, 3.4, 1.5);
  sconce.position.set(X1 - 0.15, 2.0, 2.15);
  scene.add(sconce);
  // calendar
  box(wall, 0.24, 0.32, 0.004, std({ map: T.calendarTex(new Date()), roughness: 0.9 }), [0.3, 1.4, 0.004], { cast: false });
  put(wall, new THREE.SphereGeometry(0.006, 6, 4), mats.brass, [0.3, 1.57, 0.006], { cast: false });
  // light switch
  box(wall, 0.075, 0.12, 0.008, std({ color: '#b48a3c', roughness: 0.3, metalness: 0.7 }), [0.5, 1.15, 0.004]);
  box(wall, 0.012, 0.03, 0.02, std({ color: '#e9e2cf', roughness: 0.4 }), [0.5, 1.16, 0.014], { r: [0.3, 0, 0] });

  // clock with real hands
  const clock = dynamic(new THREE.Group());
  clock.name = 'clock';
  clock.position.set(-0.59, 2.2, 0);
  wall.add(clock);
  cyl(clock, 0.19, 0.19, 0.05, 28, walnut, [0, 0, 0.025], { r: [Math.PI / 2, 0, 0] });
  const face = std({ map: T.clockFaceTex(), roughness: 0.6 });
  put(clock, new THREE.CircleGeometry(0.165, 28), face, [0, 0, 0.051], { cast: false });
  const handMat = std({ color: '#1b1612', roughness: 0.5 });
  const hand = (len, wdt, zOff) => {
    const pivot = new THREE.Group();
    pivot.position.z = 0.055 + zOff;
    clock.add(pivot);
    box(pivot, wdt, len, 0.003, handMat, [0, len / 2 - 0.015, 0], { cast: false });
    return pivot;
  };
  const hourHand = hand(0.09, 0.012, 0), minHand = hand(0.13, 0.008, 0.003);
  const secHand = hand(0.14, 0.003, 0.006);
  secHand.children[0].material = std({ color: '#9b2b1f' });
  put(clock, new THREE.SphereGeometry(0.008, 8, 6), mats.brass, [0, 0, 0.065], { cast: false });
  ctx.clock = { hourHand, minHand, secHand };
  ctx.anchors.clock = wall.localToWorld(new THREE.Vector3(-0.59, 2.2, 0.05));

  /* ---------------- filing cabinet ---------------- */
  const fc = wallGroup(scene, { x: X1, z: -0.82, rotY: -Math.PI / 2 });
  const olive = std({ map: T.metalTex('#626a52'), roughness: 0.45, metalness: 0.4 });
  const chrome = std({ color: '#cfcac0', roughness: 0.2, metalness: 0.9 });
  const fcW = 0.46, fcD = 0.5, fcH = 1.32;
  boxB(fc, fcW, fcH, fcD - 0.02, olive, [fcW / 2, 0, fcD / 2 - 0.01]);
  ['10-K', '10-Q', 'MODELS', 'IDEAS'].forEach((label, i) => {
    const y0 = 0.04 + i * 0.32;
    box(fc, fcW - 0.03, 0.3, 0.018, olive, [fcW / 2, y0 + 0.15, fcD]);
    box(fc, 0.15, 0.022, 0.03, chrome, [fcW / 2, y0 + 0.2, fcD + 0.018]);
    box(fc, 0.085, 0.032, 0.004, std({ map: T.filingLabelTex(label), roughness: 0.6 }), [fcW / 2, y0 + 0.25, fcD + 0.01], { cast: false });
    box(fc, 0.095, 0.004, 0.006, chrome, [fcW / 2, y0 + 0.268, fcD + 0.011], { cast: false });
  });
  // snake plant on top
  snakePlant(fc, [fcW / 2, fcH, fcD / 2]);

  /* ---------------- floor plant between cabinet and door ---------------- */
  rubberPlant(scene, [2.56, 0, 0.1]);

  /* ---------------- coat rack with fedora ---------------- */
  const coat = new THREE.Group();
  coat.position.set(2.62, 0, 2.8);
  scene.add(coat);
  const rackWood = std({ map: T.woodTex({ light: '#5a321c', dark: '#2a140a', seed: 81 }), roughness: 0.5 });
  cyl(coat, 0.022, 0.028, 1.82, 10, rackWood, [0, 0.91, 0]);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    box(coat, 0.035, 0.03, 0.4, rackWood, [Math.sin(a) * 0.17, 0.04, Math.cos(a) * 0.17], { r: [0.15, a, 0] });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.4;
    cyl(coat, 0.008, 0.008, 0.16, 6, mats.brass, [Math.sin(a) * 0.06, 1.72, Math.cos(a) * 0.06], { r: [Math.cos(a) * 0.9, 0, -Math.sin(a) * 0.9] });
  }
  const felt = std({ color: '#5a4a38', roughness: 0.95 });
  const band = std({ color: '#1e1610', roughness: 0.8 });
  const hat = new THREE.Group();
  hat.position.set(0.0, 1.84, 0.02);
  hat.rotation.set(0.1, 0.3, -0.12);
  coat.add(hat);
  cyl(hat, 0.155, 0.16, 0.012, 20, felt, [0, 0, 0]);
  cyl(hat, 0.085, 0.098, 0.11, 16, felt, [0, 0.06, 0]);
  cyl(hat, 0.1, 0.1, 0.025, 16, band, [0, 0.022, 0]);
  const scarf = std({ color: '#7a2a20', roughness: 0.95, side: THREE.DoubleSide });
  const sg = new THREE.PlaneGeometry(0.16, 0.9, 1, 10);
  const sp = sg.attributes.position;
  for (let i = 0; i < sp.count; i++) sp.setZ(i, Math.sin(sp.getY(i) * 6) * 0.02 + 0.04);
  sg.computeVertexNormals();
  put(coat, sg, scarf, [0.07, 1.3, 0.04], { r: [0, -0.6, 0.05] });

  /* ---------------- floor clutter ---------------- */
  floorClutter(ctx);

  /* ---------------- reading nook (front left, seen when looking around) ---------------- */
  readingNook(ctx);

  void basic;
}


function floorClutter(ctx) {
  const { scene, mats } = ctx;
  const r = rng(91);
  // banker's box with lid askew
  const kraft = std({ color: '#b89a6a', roughness: 0.95 });
  const kraftDark = std({ color: '#8f7448', roughness: 0.95 });
  const bb = new THREE.Group();
  bb.position.set(-1.42, 0, -1.25);
  bb.rotation.y = 0.35;
  scene.add(bb);
  boxB(bb, 0.32, 0.26, 0.4, kraft, [0, 0, 0]);
  box(bb, 0.2, 0.06, 0.004, kraftDark, [0, 0.19, 0.201], { cast: false });
  boxB(bb, 0.34, 0.06, 0.42, kraft, [0.04, 0.27, 0.06], { r: [0.08, 0.2, 0.05] });
  for (let i = 0; i < 4; i++) put(bb, ctx.sheetGeo, r.pick(mats.paper.memo), [r.range(-0.05, 0.05), 0.24 + i * 0.006, -0.12], { r: [0.9 + r.range(-0.2, 0.2), r.range(-0.2, 0.2), 0], s: [1.2, 1, 0.5] });

  // stack of binders and papers by the desk
  const binderCols = ['#1e2c4f', '#141414', '#e6e2d6', '#6e1f1a'].map((c) => std({ color: c, roughness: 0.6 }));
  let y = 0;
  for (let i = 0; i < 4; i++) {
    const t = r.range(0.05, 0.07);
    box(scene, 0.3, t, 0.27, r.pick(binderCols), [-1.42 + r.range(-0.02, 0.02), y + t / 2, -0.42], { r: [0, r.range(-0.2, 0.2), 0] });
    y += t;
  }
  ctx.pile(scene, { pos: [-1.42, y, -0.42], ry: 0.3, block: 0.03, sheets: 5, seed: 92 });
  ctx.pile(scene, { pos: [1.45, 0, -1.38], ry: -0.4, block: 0.12, sheets: 8, seed: 93, spread: 0.03 });
  ctx.pile(scene, { pos: [1.3, 0, -1.6], ry: 0.3, block: 0.06, sheets: 3, seed: 94 });

  // waste basket with crumpled paper
  const wicker = std({ color: '#3a2a1a', roughness: 0.8, side: THREE.DoubleSide });
  cyl(scene, 0.15, 0.12, 0.32, 14, wicker, [1.42, 0.16, -0.72], { open: true });
  cyl(scene, 0.12, 0.12, 0.01, 14, wicker, [1.42, 0.005, -0.72]);
  const crumple = std({ color: '#ece4cf', roughness: 0.95, flatShading: true });
  const ball = new THREE.IcosahedronGeometry(0.045, 0);
  [[1.42, 0.3, -0.72], [1.36, 0.29, -0.68], [1.47, 0.31, -0.75], [1.2, 0.04, -0.5], [1.6, 0.04, -0.45], [1.05, 0.04, -0.22]].forEach((p, i) => {
    put(scene, ball, crumple, p, { r: [i, i * 2, i * 3], s: [1, 0.85 + (i % 3) * 0.1, 1] });
  });
}

function readingNook(ctx) {
  const { scene, mats } = ctx;
  const g = new THREE.Group();
  g.position.set(-2.25, 0, 2.35);
  g.rotation.y = 2.4;
  scene.add(g);
  const leather = std({ map: T.tuftedTex('#4a2416'), roughness: 0.5 });
  const plain = std({ color: '#43200f', roughness: 0.5 });
  boxB(g, 0.85, 0.42, 0.8, plain, [0, 0.08, 0]);
  boxB(g, 0.62, 0.12, 0.62, leather, [0, 0.5, 0.06]);
  boxB(g, 0.85, 0.5, 0.18, leather, [0, 0.5, -0.32], { r: [-0.1, 0, 0] });
  for (const s of [-1, 1]) {
    boxB(g, 0.14, 0.62, 0.78, plain, [s * 0.36, 0.08, 0.01]);
    cyl(g, 0.075, 0.075, 0.78, 10, leather, [s * 0.36, 0.7, 0.01], { r: [Math.PI / 2, 0, 0] });
  }
  for (const sx of [-0.35, 0.35]) for (const sz of [-0.32, 0.32]) cyl(g, 0.025, 0.02, 0.08, 6, mats.caseBack, [sx, 0.04, sz]);
  // side table with a stack of books and a decanter
  const st = new THREE.Group();
  st.position.set(-2.7, 0, 1.85);
  scene.add(st);
  cyl(st, 0.22, 0.22, 0.03, 16, mats.case, [0, 0.6, 0]);
  cyl(st, 0.025, 0.03, 0.58, 8, mats.case, [0, 0.3, 0]);
  cyl(st, 0.16, 0.18, 0.03, 12, mats.case, [0, 0.015, 0]);
  const cols = ['#6e1f1a', '#1e2c4f', '#1f3b2b'].map((c) => std({ color: c, roughness: 0.6 }));
  let y = 0.615;
  cols.forEach((m, i) => {
    box(st, 0.2 - i * 0.02, 0.035, 0.15, m, [0.02, y + 0.0175, 0], { r: [0, i * 0.3, 0] });
    y += 0.035;
  });
  const glass = new THREE.MeshStandardMaterial({ color: '#d9a35a', roughness: 0.05, transparent: true, opacity: 0.55 });
  cyl(st, 0.05, 0.06, 0.16, 12, glass, [-0.1, 0.695, 0.08]);
  put(st, new THREE.SphereGeometry(0.025, 8, 6), glass, [-0.1, 0.8, 0.08]);
  // floor lamp, gently lit
  const fl = new THREE.Group();
  fl.position.set(-2.72, 0, 2.85);
  scene.add(fl);
  cyl(fl, 0.15, 0.17, 0.03, 16, mats.brass, [0, 0.015, 0]);
  cyl(fl, 0.012, 0.012, 1.55, 8, mats.brass, [0, 0.8, 0]);
  const shadeMat = std({ color: '#e8d6aa', emissive: '#ffc070', emissiveIntensity: 0.65, roughness: 0.8, side: THREE.DoubleSide });
  cyl(fl, 0.16, 0.24, 0.26, 18, shadeMat, [0, 1.62, 0], { open: true, cast: false });
  const fill = new THREE.PointLight('#ffc27a', 1.6, 3.2, 1.6);
  fill.position.set(-2.7, 1.5, 2.8);
  scene.add(fill);
}

/* ------------------------------------------------------------------ */
/* Podcasts as cassette tapes                                          */
/* ------------------------------------------------------------------ */

const TAPE_COLORS = ['#c0392b', '#2f6f8f', '#d9a43a', '#3e6b4b', '#8e44ad', '#d35400'];

export function buildTapes(ctx, podcasts) {
  const { group: rack } = ctx.tapeRack;
  const shell = std({ color: '#2a2826', roughness: 0.35 });
  const tapes = [];
  const n = Math.min(podcasts.length, 6);
  const span = 0.44;
  podcasts.slice(0, n).forEach((p, i) => {
    const r = rng(70 + i);
    const label = std({ map: T.cassetteTex({ label: p.short || p.title, color: TAPE_COLORS[i % TAPE_COLORS.length], seed: i }), roughness: 0.4 });
    // a bare cassette lying label-up; +y face carries the label, top of the label points away from the viewer
    const geo = new THREE.BoxGeometry(0.1, 0.012, 0.064);
    geo.translate(0, 0.006, 0);
    const mesh = new THREE.Mesh(geo, [shell, shell, label, shell, shell, shell]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const t = n === 1 ? 0.5 : i / (n - 1);
    mesh.position.set((t - 0.5) * span, 0.0005 + (i % 2) * 0.004, r.range(-0.006, 0.006));
    mesh.rotation.y = r.range(-0.18, 0.18);
    mesh.name = `tape:${p.id}`;
    dynamic(mesh);
    rack.add(mesh);
    tapes.push({ item: p, mesh, home: mesh.position.clone(), homeRot: mesh.rotation.clone(), out: 0, target: 0 });
  });
  return tapes;
}

function ventTex() {
  const [c, g] = T.makeCanvas(64, 48);
  g.fillStyle = '#b9b5aa';
  g.fillRect(0, 0, 64, 48);
  g.fillStyle = '#4a4740';
  for (let y = 10; y < 40; y += 4) for (let x = 6; x < 58; x += 9) g.fillRect(x, y, 6, 1);
  g.fillStyle = '#d9d5ca';
  g.fillRect(0, 0, 64, 2);
  return T.toTexture(c);
}
