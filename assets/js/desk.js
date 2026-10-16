import * as THREE from '../vendor/three.module.min.js';
import { DESK } from './layout.js';
import { std, basic, box, boxB, cyl, put, tiledBox, dynamic, rng, TAU } from './util.js';
import * as T from './textures.js';

export const Y = DESK.top + 0.003; // resting height on the leather inlay

export function buildDesk(ctx) {
  const { scene, mats } = ctx;
  const { x, z, w, d, top } = DESK;
  const front = z + d / 2, back = z - d / 2;

  /* ---------------- the desk ---------------- */
  const mahog = T.woodTex({ light: '#7a3420', dark: '#3a120a', seed: 51, rings: 8 });
  mats.desk = std({ map: mahog, roughness: 0.38, metalness: 0.0 });
  mats.deskPanel = std({ map: T.panelTex({ light: '#7a3420', dark: '#33100a', seed: 52, frame: 12, bevel: 3 }), roughness: 0.42 });
  const deskTop = put(scene, tiledBox(w, 0.045, d, 1.2), mats.desk, [x, top - 0.0225, z]);
  deskTop.name = 'deskTop';
  box(scene, w + 0.03, 0.03, d + 0.03, mats.desk, [x, top - 0.06, z]);
  const inlay = std({ map: T.leatherInlayTex(), roughness: 0.62 });
  box(scene, 1.7, 0.003, 0.66, inlay, [x, top + 0.0015, z], { cast: false });

  for (const s of [-1, 1]) {
    const px = x + s * 0.7;
    boxB(scene, 0.52, 0.64, d - 0.06, mats.desk, [px, 0.055, z]);
    boxB(scene, 0.54, 0.055, d - 0.04, mats.caseBack || mats.desk, [px, 0, z]);
    // three drawers on the owner side
    [0.555, 0.355, 0.155].forEach((dy, i) => {
      const dh = i === 0 ? 0.17 : 0.19;
      box(scene, 0.47, dh, 0.02, mats.deskPanel, [px, dy + 0.02, front - 0.02]);
      box(scene, 0.1, 0.012, 0.012, mats.brass, [px, dy + 0.03, front - 0.003]);
      for (const k of [-1, 1]) cyl(scene, 0.008, 0.008, 0.016, 8, mats.brass, [px + k * 0.05, dy + 0.035, front - 0.005], { r: [Math.PI / 2, 0, 0] });
    });
    // paneled back (window side)
    box(scene, 0.48, 0.56, 0.02, mats.deskPanel, [px, 0.36, back + 0.02]);
  }
  box(scene, 0.86, 0.075, 0.02, mats.deskPanel, [x, top - 0.11, front - 0.02]);
  box(scene, 0.1, 0.012, 0.012, mats.brass, [x, top - 0.11, front - 0.003]);
  box(scene, 0.88, 0.5, 0.022, mats.deskPanel, [x, 0.45, back + 0.02]);

  /* ---------------- chair (pushed back, swivelled) ---------------- */
  buildChair(ctx);

  /* ---------------- banker's lamp ---------------- */
  buildLamp(ctx, [-0.74, Y, -1.08]);

  /* ---------------- computer ---------------- */
  buildComputer(ctx, [0.3, Y, -0.99], -0.16);

  /* ---------------- phone & rolodex ---------------- */
  buildPhone(ctx, [0.84, Y, -0.62], -0.55);
  buildRolodex(ctx, [0.79, Y, -1.09], -0.35);

  /* ---------------- nameplate & photo ---------------- */
  buildNameplate(ctx, [-0.25, Y, -0.385], 0.04);
  buildPhoto(ctx, [-0.47, Y, -1.13], 0.32);

  /* ---------------- papers ---------------- */
  buildPapers(ctx);

  /* ---------------- small things ---------------- */
  buildSmallThings(ctx);
}

/* ------------------------------------------------------------------ */

function buildChair(ctx) {
  const { scene, mats } = ctx;
  const g = new THREE.Group();
  g.position.set(1.34, 0, -0.42);
  g.rotation.y = -2.05;
  scene.add(g);
  mats.leather = std({ map: T.tuftedTex('#5c1c14'), roughness: 0.42 });
  mats.leatherPlain = std({ color: '#4e1710', roughness: 0.45 });
  mats.chrome = std({ color: '#2b2622', roughness: 0.3, metalness: 0.6 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const leg = new THREE.Group();
    leg.rotation.y = a;
    g.add(leg);
    box(leg, 0.04, 0.035, 0.32, mats.chrome, [0, 0.07, 0.16], { r: [0.12, 0, 0] });
    put(leg, new THREE.SphereGeometry(0.025, 8, 6), mats.chrome, [0, 0.025, 0.3]);
  }
  cyl(g, 0.03, 0.035, 0.34, 10, mats.chrome, [0, 0.26, 0]);
  boxB(g, 0.58, 0.11, 0.54, mats.leather, [0, 0.42, 0.02]);
  cyl(g, 0.055, 0.055, 0.58, 12, mats.leatherPlain, [0, 0.49, 0.29], { r: [0, 0, Math.PI / 2] });
  const back = new THREE.Group();
  back.position.set(0, 0.5, -0.24);
  back.rotation.x = -0.14;
  g.add(back);
  boxB(back, 0.58, 0.74, 0.13, mats.leather, [0, 0, 0]);
  cyl(back, 0.07, 0.07, 0.6, 12, mats.leatherPlain, [0, 0.76, 0], { r: [0, 0, Math.PI / 2] });
  for (const s of [-1, 1]) {
    boxB(back, 0.08, 0.66, 0.16, mats.leatherPlain, [s * 0.31, 0.04, 0.03]);
    boxB(g, 0.085, 0.06, 0.46, mats.leatherPlain, [s * 0.33, 0.66, 0.03]);
    boxB(g, 0.05, 0.14, 0.05, mats.chrome, [s * 0.33, 0.52, 0.12]);
  }
}

function buildLamp(ctx, [lx, ly, lz]) {
  const { scene, mats } = ctx;
  const g = dynamic(new THREE.Group());
  g.position.set(lx, ly, lz);
  g.rotation.y = 0.18;
  g.name = 'lamp';
  scene.add(g);
  cyl(g, 0.085, 0.09, 0.022, 20, mats.brass, [0, 0.011, 0]);
  cyl(g, 0.055, 0.07, 0.03, 16, mats.brass, [0, 0.035, 0]);
  cyl(g, 0.011, 0.011, 0.29, 8, mats.brass, [0, 0.19, 0]);
  cyl(g, 0.007, 0.007, 0.2, 6, mats.brass, [0, 0.335, 0.03], { r: [0, 0, Math.PI / 2] });
  const glass = std({ color: '#145a33', roughness: 0.18, metalness: 0.1, emissive: '#0f6a36', emissiveIntensity: 0.0, side: THREE.DoubleSide });
  const shadeGeo = new THREE.CylinderGeometry(0.078, 0.078, 0.33, 22, 1, true, 0, Math.PI);
  const shade = put(g, shadeGeo, glass, [0, 0.355, 0.06], { r: [0, 0, Math.PI / 2], cast: false });
  shade.name = 'lampShade';
  const inner = std({ color: '#f6e6b0', emissive: '#ffe2a0', emissiveIntensity: 1.6, side: THREE.BackSide, roughness: 0.6 });
  put(g, new THREE.CylinderGeometry(0.074, 0.074, 0.32, 22, 1, true, 0, Math.PI), inner, [0, 0.353, 0.06], { r: [0, 0, Math.PI / 2], cast: false });
  for (const s of [-1, 1]) cyl(g, 0.079, 0.079, 0.006, 22, mats.brass, [s * 0.166, 0.355, 0.06], { r: [0, 0, Math.PI / 2], cast: false, thetaLength: Math.PI });
  const bulb = basic({ color: '#fff3cf' });
  bulb.color.setScalar(4);
  cyl(g, 0.012, 0.012, 0.24, 8, bulb, [0, 0.33, 0.06], { r: [0, 0, Math.PI / 2], cast: false });
  cyl(g, 0.0015, 0.0015, 0.1, 4, mats.brass, [0.09, 0.27, 0.11], { cast: false });
  put(g, new THREE.SphereGeometry(0.008, 6, 4), mats.brass, [0.09, 0.215, 0.11], { cast: false });

  const spot = new THREE.SpotLight('#ffd49a', 2.6, 3.2, 1.05, 0.7, 1.6);
  spot.position.set(0, 0.32, 0.07);
  g.add(spot);
  const tgt = new THREE.Object3D();
  tgt.position.set(0.05, -0.1, 0.45);
  g.add(tgt);
  spot.target = tgt;
  spot.castShadow = ctx.quality.lampShadow > 0;
  if (spot.castShadow) {
    spot.shadow.mapSize.set(ctx.quality.lampShadow, ctx.quality.lampShadow);
    spot.shadow.camera.near = 0.05;
    spot.shadow.camera.far = 3.5;
    spot.shadow.bias = -0.0008;
    spot.shadow.normalBias = 0.01;
  }
  const glow = new THREE.PointLight('#ffcf8a', 0.4, 1.4, 1.5);
  glow.position.set(0, 0.36, 0.1);
  g.add(glow);
  ctx.lamp = { group: g, spot, glow, glass, inner, bulb, on: true, base: { spot: 2.6, glow: 0.4 } };
  ctx.anchors.lamp = g.localToWorld(new THREE.Vector3(0, 0.4, 0.06));
}

function buildComputer(ctx, [cx, cy, cz], ry) {
  const { scene, mats } = ctx;
  const g = dynamic(new THREE.Group());
  g.position.set(cx, cy, cz);
  g.rotation.y = ry;
  g.name = 'computer';
  scene.add(g);
  mats.beige = std({ color: '#d4c9aa', roughness: 0.55 });
  mats.beigeDark = std({ color: '#b3a78a', roughness: 0.6 });
  const front = std({ map: T.pcFrontTex(), emissive: '#ffffff', emissiveMap: T.pcFrontEmissive(), emissiveIntensity: 1.5, roughness: 0.55 });
  const pc = put(g, new THREE.BoxGeometry(0.42, 0.11, 0.4), [mats.beige, mats.beige, mats.beige, mats.beige, front, mats.beige], [0, 0.055, 0]);
  box(g, 0.2, 0.018, 0.18, mats.beigeDark, [0, 0.119, -0.03]);
  cyl(g, 0.07, 0.08, 0.02, 14, mats.beige, [0, 0.135, -0.03]);

  // CRT body: square frustum tapering toward the back
  const tube = new THREE.CylinderGeometry(0.13, 0.235, 0.3, 4, 1, false, Math.PI / 4);
  const body = put(g, tube, mats.beige, [0, 0.28, -0.12], { r: [-Math.PI / 2, 0, 0], s: [1.05, 1, 0.9] });
  void body;
  box(g, 0.372, 0.312, 0.046, mats.beige, [0, 0.29, 0.05]);
  // recessed inner bezel
  const bz = 0.074;
  box(g, 0.33, 0.022, 0.006, mats.beigeDark, [0, 0.29 + 0.124, bz]);
  box(g, 0.33, 0.034, 0.006, mats.beigeDark, [0, 0.29 - 0.13, bz]);
  box(g, 0.022, 0.26, 0.006, mats.beigeDark, [-0.157, 0.29, bz]);
  box(g, 0.022, 0.26, 0.006, mats.beigeDark, [0.157, 0.29, bz]);
  const ledMat = basic({ color: '#39ff6a' });
  ledMat.color.setScalar(3);
  box(g, 0.006, 0.006, 0.004, ledMat, [0.15, 0.156, bz + 0.004], { cast: false });
  box(g, 0.02, 0.01, 0.006, mats.beigeDark, [0.125, 0.156, bz + 0.002], { cast: false });

  // the screen: a slightly bulged plane carrying the live canvas
  const sg = new THREE.PlaneGeometry(0.29, 0.215, 12, 9);
  const sp = sg.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const px = sp.getX(i) / 0.145, py = sp.getY(i) / 0.1075;
    sp.setZ(i, 0.009 * (1 - px * px) * (1 - py * py));
  }
  sg.computeVertexNormals();
  const screenMat = std({ color: '#050806', emissive: '#ffffff', emissiveMap: ctx.screen.texture, emissiveIntensity: 1.35, roughness: 0.42, metalness: 0.0 });
  const screen = put(g, sg, screenMat, [0, 0.292, 0.0745], { cast: false });
  screen.name = 'screen';

  // sticky notes on the bezel
  const sticky = std({ map: stickyTex(1), roughness: 0.9 });
  const sticky2 = std({ map: stickyTex(2), roughness: 0.9 });
  put(g, new THREE.PlaneGeometry(0.055, 0.055), sticky, [-0.158, 0.43, 0.075], { r: [0, 0, 0.12], cast: false });
  put(g, new THREE.PlaneGeometry(0.05, 0.05), sticky2, [0.172, 0.2, 0.075], { r: [0, 0, -0.2], cast: false });

  // keyboard, mouse, cables
  const kb = std({ map: T.keyboardTex(), roughness: 0.6 });
  put(g, new THREE.BoxGeometry(0.46, 0.026, 0.165), [mats.beige, mats.beige, kb, mats.beige, mats.beige, mats.beige], [-0.02, 0.016, 0.43], { r: [0.07, 0, 0] });
  const pad = std({ color: '#1f2a44', roughness: 0.9 });
  box(g, 0.22, 0.004, 0.19, pad, [0.33, 0.002, 0.42], { r: [0, 0.2, 0], cast: false });
  const mouse = new THREE.Group();
  mouse.position.set(0.33, 0.004, 0.43);
  mouse.rotation.y = 0.15;
  g.add(mouse);
  boxB(mouse, 0.06, 0.028, 0.1, mats.beige, [0, 0, 0]);
  box(mouse, 0.001, 0.004, 0.035, mats.beigeDark, [0, 0.028, -0.03], { cast: false });
  const cableMat = std({ color: '#3a372f', roughness: 0.7 });
  const cable = (pts) => put(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 24, 0.004, 4), cableMat, [0, 0, 0], { cast: false });
  cable([[0.33, 0.012, 0.38], [0.36, 0.006, 0.3], [0.3, 0.006, 0.24], [0.22, 0.02, 0.2]]);
  cable([[-0.02, 0.02, 0.35], [0.0, 0.006, 0.28], [-0.1, 0.006, 0.23], [-0.15, 0.03, 0.2]]);

  ctx.computer = { group: g, screen, screenMat, pc };
  ctx.anchors.terminal = g.localToWorld(new THREE.Vector3(0, 0.29, 0.08));
  ctx.terminalFrame = { group: g, center: [0, 0.292, 0.081], width: 0.29, height: 0.215 };
}

function stickyTex(seed) {
  const [c, g] = T.makeCanvas(32, 32);
  g.fillStyle = seed === 1 ? '#f7e46b' : '#f6a7c0';
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 0, 32, 4);
  const r = rng(seed * 7);
  g.strokeStyle = '#2a3a6a';
  for (let l = 0; l < 3; l++) {
    g.beginPath();
    let px = 4;
    const py = 11 + l * 7;
    g.moveTo(px, py);
    while (px < r.range(16, 28)) {
      px += 2;
      g.lineTo(px, py - r.range(0, 3));
    }
    g.stroke();
  }
  return T.toTexture(c);
}

function buildPhone(ctx, [px, py, pz], ry) {
  const { scene } = ctx;
  const g = dynamic(new THREE.Group());
  g.position.set(px, py, pz);
  g.rotation.y = ry;
  g.name = 'phone';
  scene.add(g);
  const ivory = std({ color: '#e5d9bb', roughness: 0.3 });
  const ivoryDark = std({ color: '#c7b994', roughness: 0.35 });
  const body = new THREE.CylinderGeometry(0.092, 0.125, 0.085, 4, 1, false, Math.PI / 4);
  put(g, body, ivory, [0, 0.0425, 0], { s: [1, 1, 1.12] });
  boxB(g, 0.15, 0.012, 0.11, ivoryDark, [0, 0.085, -0.035]);
  for (const s of [-1, 1]) boxB(g, 0.026, 0.03, 0.03, ivory, [s * 0.062, 0.093, -0.04]);
  const handset = new THREE.Group();
  handset.position.set(0, 0.128, -0.04);
  g.add(handset);
  box(handset, 0.17, 0.024, 0.036, ivory, [0, 0, 0]);
  for (const s of [-1, 1]) box(handset, 0.055, 0.036, 0.066, ivory, [s * 0.088, -0.006, 0]);
  const dialMat = std({ map: dialTex(), roughness: 0.3 });
  const dial = put(g, new THREE.CylinderGeometry(0.05, 0.05, 0.008, 20), [ivory, dialMat, ivory], [0, 0.062, 0.078], { r: [1.05, 0, 0] });
  void dial;
  const cord = new THREE.CatmullRomCurve3(Array.from({ length: 40 }, (_, i) => {
    const t = i / 39;
    return new THREE.Vector3(-0.115 - t * 0.04 + Math.cos(t * 50) * 0.01, 0.12 - t * 0.1 + Math.sin(t * 50) * 0.01, -0.04 + t * 0.06);
  }));
  put(g, new THREE.TubeGeometry(cord, 80, 0.003, 4), ivoryDark, [0, 0, 0], { cast: false });
  ctx.phone = { group: g, handset, handsetHome: handset.position.y };
  ctx.anchors.phone = g.localToWorld(new THREE.Vector3(0, 0.12, 0));
}

function dialTex() {
  const [c, g] = T.makeCanvas(64, 64);
  g.fillStyle = '#e8ddc2';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#f4efe2';
  g.beginPath();
  g.arc(32, 32, 31, 0, TAU);
  g.fill();
  g.fillStyle = '#2a2622';
  for (let i = 0; i < 10; i++) {
    const a = -0.6 + (i / 10) * TAU * 0.82;
    g.beginPath();
    g.arc(32 + Math.cos(a) * 22, 32 + Math.sin(a) * 22, 5, 0, TAU);
    g.fill();
  }
  g.fillStyle = '#c0392b';
  g.beginPath();
  g.arc(32, 32, 9, 0, TAU);
  g.fill();
  return T.toTexture(c);
}

function buildRolodex(ctx, [px, py, pz], ry) {
  const { scene, mats } = ctx;
  const g = dynamic(new THREE.Group());
  g.position.set(px, py, pz);
  g.rotation.y = ry;
  g.name = 'rolodex';
  scene.add(g);
  const black = std({ color: '#1c1a18', roughness: 0.4, metalness: 0.3 });
  boxB(g, 0.19, 0.018, 0.12, black, [0, 0, 0]);
  for (const s of [-1, 1]) {
    box(g, 0.008, 0.1, 0.09, black, [s * 0.08, 0.06, 0]);
    cyl(g, 0.016, 0.016, 0.014, 10, black, [s * 0.092, 0.075, 0], { r: [0, 0, Math.PI / 2] });
  }
  cyl(g, 0.004, 0.004, 0.16, 6, mats.brass, [0, 0.075, 0], { r: [0, 0, Math.PI / 2] });
  const card = std({ color: '#f1ebdb', roughness: 0.85 });
  const tabs = [std({ color: '#c0392b' }), std({ color: '#2f6f8f' }), std({ color: '#d9a43a' })];
  const r = rng(31);
  for (let i = 0; i < 26; i++) {
    const a = -1.0 + (i / 25) * 2.0 + r.range(-0.03, 0.03);
    const cg = new THREE.Group();
    cg.position.set(0, 0.075, 0);
    cg.rotation.x = a;
    g.add(cg);
    box(cg, 0.135, 0.07, 0.0012, card, [0, 0.038, 0], { cast: i % 4 === 0 });
    if (r.chance(0.3)) box(cg, 0.02, 0.008, 0.0014, r.pick(tabs), [r.range(-0.05, 0.05), 0.076, 0], { cast: false });
  }
  ctx.rolodex = { group: g };
}

function buildNameplate(ctx, [px, py, pz], ry) {
  const { scene, mats } = ctx;
  const g = dynamic(new THREE.Group());
  g.position.set(px, py, pz);
  g.rotation.y = ry;
  g.name = 'nameplate';
  scene.add(g);
  const walnut = std({ map: T.woodTex({ light: '#4a2a18', dark: '#1e0f07', seed: 61 }), roughness: 0.4 });
  boxB(g, 0.34, 0.026, 0.075, walnut, [0, 0, 0]);
  const plateTex = std({ map: T.brassPlateTex('JOSH McKEE', 'RESEARCH'), roughness: 0.28, metalness: 0.55 });
  const plate = put(g, new THREE.BoxGeometry(0.31, 0.066, 0.005), [mats.brass, mats.brass, mats.brass, mats.brass, plateTex, mats.brass], [0, 0.058, 0.004], { r: [-0.32, 0, 0] });
  plate.name = 'nameplatePlate';
  ctx.nameplate = { group: g };
  ctx.anchors.nameplate = g.localToWorld(new THREE.Vector3(0, 0.06, 0));
}

function buildPhoto(ctx, [px, py, pz], ry) {
  const { scene, mats } = ctx;
  const g = dynamic(new THREE.Group());
  g.position.set(px, py, pz);
  g.rotation.y = ry;
  g.name = 'photo';
  scene.add(g);
  const frame = std({ color: '#c9c2b0', roughness: 0.25, metalness: 0.8 });
  const tilt = new THREE.Group();
  tilt.rotation.x = -0.16;
  g.add(tilt);
  boxB(tilt, 0.15, 0.19, 0.016, frame, [0, 0, 0]);
  let photoMat;
  if (ctx.images.profile) {
    const t = new THREE.Texture(ctx.images.profile);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapLinearFilter;
    t.needsUpdate = true;
    photoMat = std({ map: t, roughness: 0.35 });
  } else {
    photoMat = std({ color: '#7a6a5a' });
  }
  put(tilt, new THREE.PlaneGeometry(0.118, 0.148), photoMat, [0, 0.095, 0.0085], { cast: false });
  box(g, 0.012, 0.15, 0.008, frame, [0, 0.07, -0.045], { r: [0.4, 0, 0] });
  void mats;
  ctx.photo = { group: g };
  ctx.anchors.photo = g.localToWorld(new THREE.Vector3(0, 0.1, 0));
}

/* ------------------------------------------------------------------ */
/* Papers                                                              */
/* ------------------------------------------------------------------ */

const SHEET = { w: 0.216, d: 0.279 };

function buildPapers(ctx) {
  const { scene, mats } = ctx;
  const kinds = ['memo', 'table', 'chart', 'transcript', 'tenk', 'plain', 'greenbar'];
  mats.paper = {};
  kinds.forEach((k, i) => {
    mats.paper[k] = [0, 1, 2].map((v) => std({ map: T.paperTex(k, 100 + i * 10 + v), color: '#e0dccf', roughness: 0.9 }));
  });
  mats.paperPlain = std({ color: '#d6cdb6', roughness: 0.95 });
  const edge = T.paperEdgeTex();
  edge.repeat.set(4, 2);
  mats.paperEdge = std({ map: edge, roughness: 0.95 });
  const sheetGeo = new THREE.PlaneGeometry(SHEET.w, SHEET.d);
  sheetGeo.rotateX(-Math.PI / 2);
  ctx.sheetGeo = sheetGeo;

  const randomSheet = (r) => r.pick(mats.paper[r.pick(kinds.slice(0, 6))]);

  /** A pile: an optional solid ream plus loose, jittered sheets. Returns the group and the top height. */
  const pile = (parent, { pos, ry = 0, block = 0, sheets = 6, seed = 1, spread = 0.02, top = null }) => {
    const r = rng(seed);
    const g = new THREE.Group();
    g.position.set(pos[0], pos[1], pos[2]);
    g.rotation.y = ry;
    parent.add(g);
    let y = 0;
    if (block > 0) {
      put(g, new THREE.BoxGeometry(SHEET.w - 0.002, block, SHEET.d - 0.002), [mats.paperEdge, mats.paperEdge, mats.paperPlain, mats.paperPlain, mats.paperEdge, mats.paperEdge], [0, block / 2, 0]);
      y = block;
    }
    for (let i = 0; i < sheets; i++) {
      y += 0.0012;
      const m = put(g, sheetGeo, randomSheet(r), [r.range(-spread, spread), y, r.range(-spread, spread)], { r: [0, r.range(-0.12, 0.12), 0] });
      m.castShadow = i === sheets - 1;
    }
    let topMesh = null;
    if (top) {
      y += 0.0015;
      topMesh = put(g, sheetGeo, top, [0, y, 0], { r: [0, r.range(-0.04, 0.04), 0] });
      dynamic(topMesh);
    }
    return { group: g, top: y, topMesh };
  };
  ctx.pile = pile;

  // decorative piles around the desk
  pile(scene, { pos: [-0.9, Y, -0.47], ry: 0.25, block: 0.06, sheets: 14, seed: 3, spread: 0.03 });
  pile(scene, { pos: [-0.9, Y + 0.002, -0.47], ry: -0.15, sheets: 6, seed: 4, spread: 0.04 });
  pile(scene, { pos: [0.6, Y, -0.86], ry: 0.62, sheets: 5, seed: 7, spread: 0.03 });

  // bound annual reports, stacked
  const coverCols = ['#1e2c4f', '#7d2a20', '#e9e4d6', '#1f3b2b', '#a8823a'];
  const r = rng(77);
  let ay = Y;
  for (let i = 0; i < 5; i++) {
    const t = r.range(0.012, 0.02);
    const mat = std({ color: coverCols[i % coverCols.length], roughness: 0.7 });
    box(scene, 0.215, t, 0.28, mat, [-0.02 + r.range(-0.01, 0.01), ay + t / 2, -1.11], { r: [0, r.range(-0.1, 0.1), 0] });
    ay += t;
  }
  put(scene, sheetGeo, mats.paper.tenk[0], [-0.02, ay + 0.001, -1.11], { r: [0, 0.04, 0] });

  // legal pad + calculator
  const legal = std({ map: T.paperTex('legal', 5), roughness: 0.9 });
  const card = std({ color: '#8a6a4a', roughness: 0.9 });
  put(scene, new THREE.BoxGeometry(0.216, 0.008, 0.33), [card, card, legal, card, card, card], [-0.37, Y + 0.004, -0.58], { r: [0, 0.22, 0] });
  const calc = std({ map: T.calculatorTex(), roughness: 0.5 });
  const calcBody = std({ color: '#3a2f24', roughness: 0.5 });
  put(scene, new THREE.BoxGeometry(0.128, 0.013, 0.079), [calcBody, calcBody, calc, calcBody, calcBody, calcBody], [-0.34, Y + 0.0145, -0.53], { r: [0, 0.3, 0] });

  // newspaper, folded
  const news = std({ map: T.newspaperTex(), roughness: 0.95 });
  put(scene, new THREE.BoxGeometry(0.29, 0.006, 0.2), [mats.paperPlain, mats.paperPlain, news, mats.paperPlain, mats.paperPlain, mats.paperPlain], [0.74, Y + 0.003, -0.93], { r: [0, 0.5, 0] });

  // green-bar printout running off the front edge
  const gb = std({ map: T.paperTex('greenbar', 9), color: '#d6d1bb', roughness: 0.95, side: THREE.DoubleSide });
  const gbw = 0.26, fz = DESK.z + DESK.d / 2;
  const flat = new THREE.PlaneGeometry(gbw, 0.22);
  flat.rotateX(-Math.PI / 2);
  put(scene, flat, gb, [0.02, Y + 0.002, fz - 0.11], { r: [0, 0.05, 0], cast: false });
  put(scene, new THREE.CylinderGeometry(0.018, 0.018, gbw, 8, 1, true, 0, Math.PI / 2), gb, [0.02, Y - 0.016, fz], { r: [0, 0.05, Math.PI / 2], cast: false });
  put(scene, new THREE.PlaneGeometry(gbw, 0.14), gb, [0.02, Y - 0.09, fz + 0.019], { r: [0.08, 0.05, 0], cast: false });
}

/* ------------------------------------------------------------------ */

function buildSmallThings(ctx) {
  const { scene, mats } = ctx;
  // coffee mug
  const mugMat = std({ color: '#1f3a5f', roughness: 0.25 });
  const mugIn = std({ color: '#e9e3d4', roughness: 0.3, side: THREE.BackSide });
  const mug = new THREE.Group();
  mug.position.set(0.6, Y, -0.37);
  scene.add(mug);
  cyl(mug, 0.04, 0.037, 0.095, 16, mugMat, [0, 0.0475, 0], { open: true });
  cyl(mug, 0.038, 0.035, 0.093, 16, mugIn, [0, 0.0475, 0], { open: true, cast: false });
  cyl(mug, 0.037, 0.037, 0.004, 16, mugMat, [0, 0.002, 0]);
  const coffee = std({ color: '#2a160c', roughness: 0.1 });
  put(mug, new THREE.CircleGeometry(0.037, 16), coffee, [0, 0.078, 0], { r: [-Math.PI / 2, 0, 0], cast: false });
  put(mug, new THREE.TorusGeometry(0.026, 0.007, 6, 12, Math.PI), mugMat, [0.04, 0.05, 0], { r: [0, 0, -Math.PI / 2] });
  ctx.anchors.mug = mug.localToWorld(new THREE.Vector3(0, 0.1, 0));

  // pen cup
  const cup = std({ color: '#1e3a2a', roughness: 0.5 });
  cyl(scene, 0.034, 0.032, 0.1, 14, cup, [-0.93, Y + 0.05, -0.83]);
  const penCols = ['#141414', '#8c1c13', '#b48a3c', '#1e2c4f'];
  penCols.forEach((col, i) => {
    const a = (i / penCols.length) * TAU;
    cyl(scene, 0.0045, 0.0045, 0.15, 6, std({ color: col, roughness: 0.3, metalness: 0.4 }), [-0.93 + Math.cos(a) * 0.012, Y + 0.1, -0.83 + Math.sin(a) * 0.012], { r: [Math.sin(a) * 0.25, 0, Math.cos(a) * 0.25], cast: false });
  });

  // stapler
  const red = std({ color: '#7a1c16', roughness: 0.35 });
  const stp = new THREE.Group();
  stp.position.set(0.36, Y, -0.37);
  stp.rotation.y = 0.5;
  scene.add(stp);
  boxB(stp, 0.15, 0.014, 0.038, mats.chrome || red, [0, 0, 0]);
  boxB(stp, 0.14, 0.028, 0.032, red, [0.004, 0.016, 0], { r: [0, 0, 0.03] });

  // magnifier on the research
  ctx.magnifier = () => {
    const g = new THREE.Group();
    const ring = std({ color: '#b48a3c', roughness: 0.3, metalness: 0.8 });
    put(g, new THREE.TorusGeometry(0.042, 0.005, 6, 20), ring, [0, 0, 0], { r: [Math.PI / 2, 0, 0] });
    const lens = new THREE.MeshStandardMaterial({ color: '#cfe3ff', roughness: 0.05, transparent: true, opacity: 0.25 });
    put(g, new THREE.CircleGeometry(0.04, 20), lens, [0, 0.0, 0], { r: [-Math.PI / 2, 0, 0], cast: false });
    cyl(g, 0.007, 0.009, 0.11, 8, std({ color: '#3a1a0c', roughness: 0.5 }), [0.1, 0, 0], { r: [0, 0, Math.PI / 2] });
    return g;
  };
  void basic;
}

/* ------------------------------------------------------------------ */
/* Research piles: one per report, the top sheet shows the real chart  */
/* ------------------------------------------------------------------ */

const PILE_SLOTS = [
  { pos: [-0.62, -0.68], ry: 0.14 },
  { pos: [-0.17, -0.87], ry: -0.1 },
  { pos: [0.1, -1.12], ry: 0.06, lift: 0.08 },
  { pos: [-0.9, -0.47], ry: 0.25, lift: 0.07 },
];

export function buildResearchPiles(ctx, reports) {
  const { scene, mats } = ctx;
  const clipMat = std({ color: '#141414', roughness: 0.3, metalness: 0.4 });
  const wire = std({ color: '#b9b4a8', roughness: 0.25, metalness: 0.9 });
  const piles = [];
  reports.slice(0, PILE_SLOTS.length).forEach((rep, i) => {
    const slot = PILE_SLOTS[i];
    const tex = T.paperTex('report', 900 + i, {
      company: rep.company.toUpperCase(),
      ticker: rep.ticker,
      subtitle: rep.dek || rep.title,
      image: ctx.images[`report:${rep.id}`] || null,
    });
    const topMat = std({ map: tex, color: '#e6e2d6', roughness: 0.85 });
    const p = ctx.pile(scene, { pos: [slot.pos[0], Y + (slot.lift || 0), slot.pos[1]], ry: slot.ry, block: 0.018 + i * 0.006, sheets: 4, seed: 40 + i, spread: 0.015, top: topMat });
    dynamic(p.group);
    // binder clip on the top edge
    const clip = new THREE.Group();
    clip.position.set(-0.06, p.top + 0.002, -0.139);
    p.group.add(clip);
    box(clip, 0.032, 0.012, 0.02, clipMat, [0, 0.004, 0.002]);
    for (const s of [-1, 1]) cyl(clip, 0.0012, 0.0012, 0.035, 4, wire, [s * 0.011, 0.02, -0.006], { r: [0.5, 0, 0], cast: false });
    if (i === 0) {
      const mag = ctx.magnifier();
      mag.position.set(0.04, p.top + 0.008, 0.06);
      mag.rotation.y = -0.7;
      p.group.add(mag);
    }
    piles.push({ report: rep, group: p.group, top: p.topMesh, home: p.topMesh.position.clone(), homeRot: p.topMesh.rotation.clone() });
    ctx.anchors[`pile:${rep.id}`] = p.group.localToWorld(new THREE.Vector3(0, p.top + 0.02, 0));
  });
  void mats;
  return piles;
}
