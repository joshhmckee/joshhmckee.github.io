import * as THREE from '../vendor/three.module.min.js';
import { std, put, rng, TAU } from './util.js';
import * as T from './textures.js';

/* ------------------------------------------------------------------ */
/* Leaves                                                              */
/* ------------------------------------------------------------------ */

/**
 * A single leaf, base at the origin, growing along +y. The outline narrows to a point,
 * the blade folds along the midrib, and the tip droops.
 */
export function leafGeometry({ length = 0.2, width = 0.1, fold = 0.25, droop = 0.6, shape = 'ellipse', segsL = 10, segsW = 6 } = {}) {
  const g = new THREE.PlaneGeometry(1, 1, segsW, segsL);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i); // -0.5..0.5 across
    const v = p.getY(i) + 0.5; // 0..1 along
    let w;
    if (shape === 'heart') w = Math.pow(Math.sin(Math.PI * Math.min(1, v * 1.05)), 0.55) * (1.25 - v * 0.75);
    else if (shape === 'sword') w = Math.min(1, v * 6) * (1 - Math.pow(v, 6)) * (1 - v * 0.25);
    else w = Math.pow(Math.sin(Math.PI * v), 0.8) * (1 - v * 0.15);
    const x = u * width * w;
    const along = v * length;
    const z = fold * Math.abs(x) - droop * along * along;
    p.setXYZ(i, x, along, z);
  }
  g.computeVertexNormals();
  return g;
}

function leafTex(kind, seed = 1) {
  const W = 64, H = 128;
  const [c, g] = T.makeCanvas(W, H);
  const r = rng(seed);
  if (kind === 'snake') {
    // Sansevieria 'Laurentii': dark green with pale wavy cross-bands and golden edges
    g.fillStyle = '#23462b';
    g.fillRect(0, 0, W, H);
    for (let y = 2; y < H; y += r.range(5, 9)) {
      g.strokeStyle = r.chance(0.5) ? 'rgba(170,190,150,0.55)' : 'rgba(120,150,110,0.5)';
      g.lineWidth = r.range(1, 2.4);
      g.beginPath();
      g.moveTo(8, y);
      for (let x = 8; x <= W - 8; x += 6) g.lineTo(x, y + Math.sin(x * 0.25 + y) * 2.2);
      g.stroke();
    }
    g.fillStyle = '#c9b452';
    g.fillRect(0, 0, 7, H);
    g.fillRect(W - 7, 0, 7, H);
    g.fillStyle = 'rgba(0,0,0,0.15)';
    g.fillRect(7, 0, 2, H);
    g.fillRect(W - 9, 0, 2, H);
    return T.toTexture(c);
  }
  const base = kind === 'pothos' ? '#3f7a32' : '#173d22';
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, kind === 'pothos' ? '#2f6226' : '#10301a');
  grad.addColorStop(0.5, base);
  grad.addColorStop(1, kind === 'pothos' ? '#2f6226' : '#10301a');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  if (kind === 'pothos') {
    // golden variegation streaks
    for (let i = 0; i < 9; i++) {
      g.strokeStyle = 'rgba(214,200,96,0.55)';
      g.lineWidth = r.range(1, 3);
      const x0 = r.range(10, W - 10);
      g.beginPath();
      g.moveTo(W / 2, H * 0.9);
      g.quadraticCurveTo(x0, H * 0.5, x0 + r.range(-8, 8), H * r.range(0.05, 0.3));
      g.stroke();
    }
  }
  // midrib and lateral veins
  g.strokeStyle = kind === 'rubber' ? 'rgba(170,120,90,0.75)' : 'rgba(200,220,150,0.6)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(W / 2, H);
  g.lineTo(W / 2, 2);
  g.stroke();
  g.strokeStyle = kind === 'rubber' ? 'rgba(120,150,110,0.22)' : 'rgba(200,220,150,0.25)';
  g.lineWidth = 1;
  for (let y = H - 10; y > 8; y -= 7) {
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(W / 2, y);
      g.quadraticCurveTo(W / 2 + s * 14, y - 5, W / 2 + s * 30, y - 13);
      g.stroke();
    }
  }
  return T.toTexture(c);
}

function soilTex() {
  const [c, g] = T.makeCanvas(64, 64);
  g.fillStyle = '#2a1a10';
  g.fillRect(0, 0, 64, 64);
  const r = rng(4);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = r.pick(['#3a2616', '#1a0f08', '#4a3420', '#5a4a3a']);
    g.fillRect(r() * 64, r() * 64, r.range(0.6, 1.8), r.range(0.6, 1.8));
  }
  return T.toTexture(c);
}

/* ------------------------------------------------------------------ */
/* Pots                                                                */
/* ------------------------------------------------------------------ */

function terracottaPot(parent, { rTop = 0.17, rBot = 0.13, h = 0.34, color = '#a4573a' } = {}) {
  const pts = [
    [0, 0], [rBot - 0.01, 0], [rBot, 0.012], [rTop - 0.012, h - 0.05], [rTop, h - 0.05], [rTop + 0.012, h - 0.04],
    [rTop + 0.012, h - 0.005], [rTop - 0.004, h], [rTop - 0.016, h - 0.004], [rTop - 0.022, h - 0.06], [0, h - 0.06],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const mat = std({ color, roughness: 0.82 });
  put(parent, new THREE.LatheGeometry(pts, 32), mat, [0, 0, 0]);
  const soil = std({ map: soilTex(), roughness: 1 });
  put(parent, new THREE.CircleGeometry(rTop - 0.02, 32), soil, [0, h - 0.035, 0], { r: [-Math.PI / 2, 0, 0], cast: false });
  return h - 0.035;
}

function glazedPlanter(parent, { r: rad = 0.07, h = 0.13, color = '#e8e0cc' } = {}) {
  const pts = [[0, 0], [rad * 0.82, 0], [rad, 0.02], [rad, h - 0.005], [rad - 0.006, h], [rad - 0.01, h - 0.02], [0, h - 0.02]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  put(parent, new THREE.LatheGeometry(pts, 28), std({ color, roughness: 0.18 }), [0, 0, 0]);
  put(parent, new THREE.CircleGeometry(rad - 0.01, 24), std({ map: soilTex(), roughness: 1 }), [0, h - 0.018, 0], { r: [-Math.PI / 2, 0, 0], cast: false });
  return h - 0.018;
}

/* ------------------------------------------------------------------ */
/* Plants                                                              */
/* ------------------------------------------------------------------ */

/** Ficus elastica: three trunks, glossy leaves spiralling up, red sheaths on the new growth. */
export function rubberPlant(parent, pos, seed = 6) {
  const r = rng(seed);
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  parent.add(g);
  const soilY = terracottaPot(g);
  const leafMat = std({ map: leafTex('rubber', seed), roughness: 0.32, side: THREE.DoubleSide });
  const stemMat = std({ color: '#4a3e2c', roughness: 0.75 });
  const sheath = std({ color: '#a8323a', roughness: 0.4 });
  const leafGeos = [0, 1, 2].map((i) => leafGeometry({ length: 0.2 + i * 0.03, width: 0.1 + i * 0.012, fold: 0.3, droop: 1.6 + i * 0.3 }));
  for (let s = 0; s < 3; s++) {
    const a = (s / 3) * TAU + r.range(-0.3, 0.3);
    const lean = r.range(0.06, 0.2);
    const h = r.range(0.75, 1.15);
    const trunk = new THREE.Group();
    trunk.position.set(Math.cos(a) * 0.035, soilY, Math.sin(a) * 0.035);
    trunk.rotation.set(Math.sin(a) * lean, 0, -Math.cos(a) * lean);
    g.add(trunk);
    const bend = new THREE.CatmullRomCurve3([[0, 0, 0], [0.01, h * 0.35, 0], [-0.008, h * 0.7, 0.006], [0.004, h, 0]].map((q) => new THREE.Vector3(...q)));
    put(trunk, new THREE.TubeGeometry(bend, 12, 0.007, 8, false), stemMat, [0, 0, 0]);
    const n = r.int(8, 11);
    for (let l = 0; l < n; l++) {
      const t = 0.22 + (l / n) * 0.78;
      const petiole = new THREE.Group();
      petiole.position.y = h * t;
      petiole.rotation.y = l * 2.4 + a; // golden-angle spiral
      trunk.add(petiole);
      // leaf runs outward and a little up from the trunk, face up, tip drooping:
      // its length (+y) maps to (cos e, sin e, 0), its width to z, its face (+z) to (-sin e, cos e, 0)
      const e = 0.25 + t * 0.55 + r.range(-0.12, 0.12);
      const geo = leafGeos[Math.min(2, Math.floor((1 - t) * 3))];
      const leaf = put(petiole, geo, leafMat, [0.012, 0, 0]);
      leaf.rotation.set(r.range(-0.12, 0.12), -Math.PI / 2, e - Math.PI / 2, 'ZYX');
      leaf.scale.setScalar(0.75 + (1 - t) * 0.45);
    }
    // new growth at the tip
    put(trunk, new THREE.ConeGeometry(0.008, 0.07, 8), sheath, [0, h + 0.03, 0]);
  }
  return g;
}

/** Sansevieria: upright sword leaves with banded variegation. */
export function snakePlant(parent, pos, seed = 5) {
  const r = rng(seed);
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  parent.add(g);
  const soilY = glazedPlanter(g);
  const mat = std({ map: leafTex('snake', seed), roughness: 0.45, side: THREE.DoubleSide });
  for (let i = 0; i < 9; i++) {
    const a = r.range(0, TAU);
    const len = r.range(0.24, 0.44);
    const geo = leafGeometry({ length: len, width: r.range(0.04, 0.06), fold: 0.6, droop: r.range(-0.15, 0.25), shape: 'sword', segsL: 8, segsW: 4 });
    const leaf = put(g, geo, mat, [Math.cos(a) * 0.025, soilY, Math.sin(a) * 0.025], { r: [0, a, 0] });
    leaf.rotation.order = 'YXZ';
    leaf.rotation.x = r.range(-0.18, 0.18);
    leaf.rotation.z = r.range(-0.12, 0.12);
  }
  return g;
}

/** Golden pothos for a bookshelf: heart-shaped leaves, a few trailing over the edge. */
export function pothos(parent, pos, seed = 8) {
  const r = rng(seed);
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  parent.add(g);
  const soilY = glazedPlanter(g, { r: 0.05, h: 0.08, color: '#b5523a' });
  const mat = std({ map: leafTex('pothos', seed), roughness: 0.4, side: THREE.DoubleSide });
  const vine = std({ color: '#5f7a34', roughness: 0.6 });
  const geo = leafGeometry({ length: 0.055, width: 0.05, fold: 0.15, droop: 2.0, shape: 'heart', segsL: 6, segsW: 4 });
  for (let i = 0; i < 12; i++) {
    const a = r.range(0, TAU);
    const trail = i < 4;
    const leaf = put(g, geo, mat, [Math.cos(a) * r.range(0.01, 0.045), soilY + (trail ? -r.range(0.02, 0.09) : r.range(0, 0.04)), Math.sin(a) * r.range(0.01, 0.045)], { cast: false });
    leaf.rotation.order = 'YXZ';
    leaf.rotation.y = a;
    leaf.rotation.x = trail ? r.range(0.9, 1.6) : r.range(-0.6, 0.4);
    if (trail) put(g, new THREE.CylinderGeometry(0.002, 0.002, 0.09, 4), vine, [Math.cos(a) * 0.05, soilY - 0.03, Math.sin(a) * 0.05], { cast: false });
  }
  return g;
}
