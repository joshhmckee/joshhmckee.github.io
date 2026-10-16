import * as THREE from '../vendor/three.module.min.js';
import { std, put, cyl, dynamic, rng, TAU, lerp, clamp } from './util.js';
import * as T from './textures.js';

/* ==================================================================
   A long-haired dapple dachshund who lives in the office.
   Built facing +z, standing on y = 0. Units are metres.
   ================================================================== */

const COAT = '#5a321d';   // chocolate
const COAT2 = '#6b3d22';  // warmer chocolate in the long feathering
const SPOT = '#b8a690';   // silver dapple
const TAN = '#7a4a2a';    // tan points

/* ---------------- textures ---------------- */

/** Short body coat: chocolate with soft silver dapple patches and fine hair-direction strokes. */
function coatTex(seed = 3) {
  const W = 128, H = 64;
  const [c, g] = T.makeCanvas(W, H);
  const r = rng(seed);
  g.fillStyle = COAT;
  g.fillRect(0, 0, W, H);
  const blot = (cx, cy, rad, a) => {
    for (const off of [-W, 0, W]) {
      const grd = g.createRadialGradient(cx + off, cy, 0, cx + off, cy, rad);
      grd.addColorStop(0, `rgba(176,156,132,${a})`);
      grd.addColorStop(0.55, `rgba(160,140,118,${a * 0.75})`);
      grd.addColorStop(1, 'rgba(160,140,118,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(cx + off, cy, rad * r.range(1.1, 1.8), rad, r() * 3, 0, TAU);
      g.fill();
    }
  };
  // dapple: irregular merged patches of silver, plus scattered flecks
  for (let i = 0; i < 13; i++) {
    const cx = r() * W, cy = r() * H;
    for (let j = 0; j < r.int(2, 5); j++) blot(cx + r.range(-6, 6), cy + r.range(-3, 3), r.range(2.5, 6.5), r.range(0.55, 0.85));
  }
  for (let i = 0; i < 30; i++) blot(r() * W, r() * H, r.range(0.8, 1.6), 0.6);
  for (let i = 0; i < 900; i++) {
    const x = r() * W, y = r() * H;
    g.strokeStyle = r.chance(0.5) ? 'rgba(20,10,4,0.28)' : 'rgba(150,100,60,0.18)';
    g.lineWidth = 0.4;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + r.range(-0.6, 0.6), y + 1.5, x + r.range(-0.8, 0.8), y + r.range(2.5, 4.5));
    g.stroke();
  }
  return T.toTexture(c, { wrap: true });
}

/** Head: loft UVs run around (u) and back-to-nose (v); tan sits low on the muzzle and cheeks. */
function headTex(seed = 4) {
  const W = 128, H = 64;
  const [c, g] = T.makeCanvas(W, H);
  const r = rng(seed);
  g.fillStyle = COAT;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 7; i++) {
    const cx = r() * W, cy = H * r.range(0.3, 1), rad = r.range(2, 5);
    const gg = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    gg.addColorStop(0, 'rgba(176,156,132,0.8)');
    gg.addColorStop(1, 'rgba(176,156,132,0)');
    g.fillStyle = gg;
    g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  // u from 0.55 to 0.95 is the underside of the ring; v near 1 (canvas top) is the nose end
  const tanGrad = g.createLinearGradient(0, H, 0, 0);
  tanGrad.addColorStop(0, 'rgba(143,90,50,0)');
  tanGrad.addColorStop(0.45, 'rgba(126,78,42,0)');
  tanGrad.addColorStop(0.65, 'rgba(126,78,42,0.85)');
  tanGrad.addColorStop(1, 'rgba(126,78,42,0.9)');
  g.fillStyle = tanGrad;
  g.beginPath();
  g.moveTo(W * 0.6, 0);
  g.lineTo(W * 0.9, 0);
  g.lineTo(W * 0.85, H);
  g.lineTo(W * 0.65, H);
  g.closePath();
  g.fill();
  return T.toTexture(c, { wrap: true });
}

/** Long silky hair: wavy strands on transparent, dense at the root, thinning to fine tips. */
function strandTex(palette, seed = 5) {
  const W = 64, H = 128;
  const [c, g] = T.makeCanvas(W, H);
  const r = rng(seed);
  g.clearRect(0, 0, W, H);
  g.lineCap = 'round';
  // strands start at ragged points near the root, wave as they fall, and taper to fine tips
  for (let i = 0; i < 300; i++) {
    const x = r() * W;
    const y0 = Math.pow(r(), 1.6) * 38; // roots spread out over the top third
    const len = H * r.range(0.4, 0.98);
    const phase = r() * TAU, amp = r.range(1.5, 4.0), freq = r.range(0.035, 0.07);
    g.strokeStyle = r.chance(0.05) ? SPOT : r.pick(palette);
    const w0 = r.range(0.7, 1.5);
    let px = x, py = y0;
    for (let y = y0 + 3; y <= Math.max(len, y0 + 30); y += 3) {
      const nx = x + Math.sin(y * freq + phase) * amp * (y / H);
      const f = (y - y0) / Math.max(1, Math.max(len, y0 + 30) - y0);
      g.lineWidth = w0 * Math.min(1, f * 5) * (1 - f * 0.8); // thin at the root, full, then tapering
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(nx, y);
      g.stroke();
      px = nx;
      py = y;
    }
  }
  return T.toTexture(c);
}

function plaidTex() {
  const S = 64;
  const [c, g] = T.makeCanvas(S, S);
  g.fillStyle = '#7a1c1c';
  g.fillRect(0, 0, S, S);
  const band = (pos, w, col, a) => {
    g.globalAlpha = a;
    g.fillStyle = col;
    g.fillRect(pos, 0, w, S);
    g.fillRect(0, pos, S, w);
  };
  band(8, 14, '#1f3b2b', 0.85);
  band(40, 10, '#1d2a4a', 0.8);
  band(28, 2, '#d9b45a', 0.9);
  band(56, 2, '#e9e1cc', 0.6);
  g.globalAlpha = 1;
  const r = rng(2);
  for (let i = 0; i < 1200; i++) {
    g.fillStyle = r.chance(0.5) ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.04)';
    g.fillRect(r() * S, r() * S, 1, 0.5);
  }
  return T.toTexture(c, { wrap: true });
}

function heartTex() {
  const [c, g] = T.makeCanvas(9, 8, 4);
  const rows = ['.XX...XX.', 'XXXX.XXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '...XXX...', '....X....'];
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === 'X') {
      g.fillStyle = y < 2 && (x === 1 || x === 6) ? '#ffb3c1' : '#e0384f';
      g.fillRect(x, y, 1, 1);
    }
  }));
  return T.toTexture(c, { mip: false, nearest: true });
}

function blobTex() {
  const [c, g] = T.makeCanvas(64, 64, 1);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.5)');
  grd.addColorStop(0.6, 'rgba(0,0,0,0.22)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return T.toTexture(c);
}

/* ---------------- geometry helpers ---------------- */

const cat = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);

/**
 * Loft a smooth tube through stations { p:[x,y,z], w, h, drop } (half width, half height;
 * drop deepens the underside). Rings stay square to the spine.
 */
function loft(stations, { radial = 22, rings = 48, uv = [1, 3] } = {}) {
  const curve = new THREE.CatmullRomCurve3(stations.map((s) => new THREE.Vector3(...s.p)), false, 'centripetal');
  const n = stations.length;
  const get = (k, key) => stations[clamp(k, 0, n - 1)][key] ?? 0;
  const pos = [], uvs = [], idx = [];
  const side = new THREE.Vector3(1, 0, 0), up = new THREE.Vector3(), tan = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    curve.getPoint(t, c);
    curve.getTangent(t, tan);
    up.crossVectors(tan, side).normalize();
    const f = t * (n - 1), k = Math.min(n - 2, Math.floor(f)), a = f - k;
    const w = Math.max(0.0005, cat(get(k - 1, 'w'), get(k, 'w'), get(k + 1, 'w'), get(k + 2, 'w'), a));
    const h = Math.max(0.0005, cat(get(k - 1, 'h'), get(k, 'h'), get(k + 1, 'h'), get(k + 2, 'h'), a));
    const drop = cat(get(k - 1, 'drop'), get(k, 'drop'), get(k + 1, 'drop'), get(k + 2, 'drop'), a);
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * TAU;
      const cx = Math.cos(ang), sy = Math.sin(ang);
      const yy = sy < 0 ? sy * (1 + drop * -sy) : sy;
      pos.push(c.x + side.x * w * cx + up.x * h * yy, c.y + side.y * w * cx + up.y * h * yy, c.z + side.z * w * cx + up.z * h * yy);
      uvs.push((j / radial) * uv[0], t * uv[1]);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A hair card hanging from its top edge (y = 0) down -y, curling toward +z, with a gentle wave. */
function hairCard(width, length, { curl = 0.25, wave = 0.006, seed = 1 } = {}) {
  const r = rng(seed);
  const g = new THREE.PlaneGeometry(width, length, 4, 7);
  g.translate(0, -length / 2, 0);
  const p = g.attributes.position;
  const ph = r() * TAU;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const v = -y / length;
    p.setXYZ(i, x + Math.sin(v * 5 + ph) * wave * v, y, curl * length * v * v + Math.sin(x * 60 + ph) * 0.002 * v);
  }
  g.computeVertexNormals();
  return g;
}

/** A tapered limb segment hanging from the origin down to y = -len. */
function limb(len, r0, r1) {
  const g = new THREE.CylinderGeometry(r0, r1, len, 12, 1);
  g.translate(0, -len / 2, 0);
  return g;
}

/* ---------------- navigation ---------------- */

/** Open-floor waypoints and the clear paths between them (checked against the furniture). */
const NODES = {
  A: [-0.25, 0.25], B: [0.45, 0.3], C: [-1.12, 0.36], D: [-0.55, 0.75], E: [0.5, 0.66], F: [1.85, 0.6], G: [2.06, -0.25],
  H: [2.0, -1.75], I: [0.9, -2.2], J: [-0.2, -2.45], K: [-1.6, -2.25], L: [-1.9, -1.75], M: [-1.7, 0.9],
};
const EDGES = ['AB', 'AC', 'AD', 'AE', 'BE', 'BF', 'CD', 'CM', 'DE', 'DM', 'EF', 'FG', 'GH', 'HI', 'IJ', 'JK', 'KL', 'LM'];
const BED = 'C';
const LINKS = {};
for (const [a, b] of EDGES.map((e) => e.split(''))) {
  (LINKS[a] ||= []).push(b);
  (LINKS[b] ||= []).push(a);
}

function route(from, to) {
  const prev = { [from]: null };
  const q = [from];
  while (q.length) {
    const n = q.shift();
    if (n === to) break;
    for (const m of LINKS[n]) if (!(m in prev)) { prev[m] = n; q.push(m); }
  }
  const path = [];
  for (let n = to; n; n = prev[n]) path.unshift(n);
  return path;
}

/* ================================================================== */

export function buildDog(ctx, { scale = 1.12 } = {}) {
  const { scene } = ctx;
  const r = rng(21);
  const coat = std({ map: coatTex(), roughness: 0.78 });
  const tan = std({ color: TAN, roughness: 0.8 });
  const nose = std({ color: '#141010', roughness: 0.2 });
  const eye = std({ color: '#0a0604', roughness: 0.05, metalness: 0.1 });
  const glint = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const hair = std({ map: strandTex([COAT, '#3a1f12', '#43251a', '#5a321d'], 5), roughness: 0.55, alphaTest: 0.38, side: THREE.DoubleSide });
  const warmHair = std({ map: strandTex([COAT2, '#5e331c', '#4e2c1a', '#7a4626'], 9), roughness: 0.55, alphaTest: 0.38, side: THREE.DoubleSide });
  const lowQ = ctx.quality.name === 'low';

  /* ---------------- the bed ---------------- */
  const bedPos = NODES[BED];
  const bedG = dynamic(new THREE.Group());
  bedG.position.set(bedPos[0], 0, bedPos[1]);
  bedG.name = 'dogBed';
  scene.add(bedG);
  const plaid = std({ map: plaidTex(), roughness: 0.95 });
  plaid.map.repeat.set(3, 3);
  cyl(bedG, 0.31, 0.32, 0.05, 24, plaid, [0, 0.025, 0]);
  put(bedG, new THREE.TorusGeometry(0.29, 0.07, 14, 40), plaid, [0, 0.07, 0], { r: [Math.PI / 2, 0, 0], s: [1, 1, 0.75] });

  /* ---------------- the dog ---------------- */
  const dog = dynamic(new THREE.Group());
  dog.name = 'dog';
  dog.scale.setScalar(scale);
  scene.add(dog);
  const body = new THREE.Group(); // bob, roll, lying down
  dog.add(body);

  // torso and neck: one loft from the rump, through the deep chest, up into the head
  const torso = loft([
    { p: [0, 0.172, -0.29], w: 0.004, h: 0.004 },
    { p: [0, 0.174, -0.272], w: 0.042, h: 0.046 },
    { p: [0, 0.172, -0.24], w: 0.063, h: 0.066 },
    { p: [0, 0.17, -0.17], w: 0.069, h: 0.069, drop: 0.1 },
    { p: [0, 0.168, -0.09], w: 0.064, h: 0.06 },
    { p: [0, 0.163, 0.0], w: 0.069, h: 0.07, drop: 0.25 },
    { p: [0, 0.158, 0.09], w: 0.075, h: 0.082, drop: 0.45 },
    { p: [0, 0.168, 0.155], w: 0.07, h: 0.077, drop: 0.35 },
    { p: [0, 0.205, 0.2], w: 0.052, h: 0.058 },
    { p: [0, 0.252, 0.222], w: 0.047, h: 0.05 },
    { p: [0, 0.292, 0.232], w: 0.043, h: 0.044 },
  ], { uv: [2, 5] });
  put(body, torso, coat, [0, 0, 0]);
  put(body, new THREE.SphereGeometry(0.036, 18, 12), std({ color: '#6e4226', roughness: 0.85 }), [0, 0.118, 0.19], { s: [0.95, 0.9, 0.5] }); // forechest

  // legs: two segments each so the trot can lift and fold the paws
  const legs = [];
  const makeLeg = (x, y, z, upper, lower, front, side) => {
    const hip = new THREE.Group();
    hip.position.set(x, y, z);
    body.add(hip);
    if (front) put(hip, limb(upper, 0.024, 0.02), coat, [0, 0, 0]);
    else {
      put(hip, new THREE.SphereGeometry(0.042, 16, 12), coat, [-side * 0.012, 0.004, 0.004], { s: [0.48, 0.9, 1.0] }); // thigh, blended into the body
      put(hip, limb(upper, 0.027, 0.019), coat, [0, 0, 0]);
    }
    const knee = new THREE.Group();
    knee.position.set(0, -upper, front ? 0.004 : -0.012);
    hip.add(knee);
    put(knee, new THREE.SphereGeometry(0.0185, 14, 10), coat, [0, 0, 0]);
    put(knee, limb(lower, 0.0175, 0.014), coat, [0, 0, 0]);
    const paw = put(knee, new THREE.SphereGeometry(0.018, 14, 10), tan, [side * 0.003, -lower + 0.003, 0.008], { s: [1, 0.55, 1.2] });
    paw.rotation.y = front ? side * 0.22 : side * 0.08;
    // trot: diagonal pairs move together
    legs.push({ hip, knee, front, phase: front ? (side > 0 ? 0 : Math.PI) : (side > 0 ? Math.PI : 0) });
    return hip;
  };
  const fl = makeLeg(-0.046, 0.128, 0.142, 0.06, 0.06, true, -1);
  const fr = makeLeg(0.046, 0.128, 0.142, 0.06, 0.06, true, 1);
  const hl = makeLeg(-0.048, 0.142, -0.19, 0.072, 0.059, false, -1);
  const hr = makeLeg(0.048, 0.142, -0.19, 0.072, 0.059, false, 1);

  // long hair: flank skirts, chest frill, front-leg feathering, breeches. Cards hang down and curl outward.
  const card = (parent, mat, w, len, pos, rot, opts) => put(parent, hairCard(w, len, { ...opts, seed: r.int(1, 999) }), mat, pos, { r: rot, order: 'YXZ', cast: !lowQ });
  for (const s of [-1, 1]) {
    const N = 15;
    for (let i = 0; i < N; i++) {
      const t = (i + r.range(0.1, 0.9)) / N;
      const z = -0.22 + t * 0.4;
      const deep = 0.45 + 0.55 * Math.sin(Math.pow(t, 0.8) * Math.PI); // longest under the chest
      const len = (0.075 + deep * 0.05) * r.range(0.8, 1.12);
      card(body, r.chance(0.5) ? warmHair : hair, r.range(0.045, 0.065), len, [s * 0.044, r.range(0.19, 0.215), z], [r.range(-0.05, 0.12), (s * Math.PI) / 2 + r.range(-0.3, 0.3), r.range(-0.12, 0.12)], { curl: r.range(0.3, 0.55), wave: 0.01 });
      if (i % 2 === 0) card(body, r.chance(0.5) ? hair : warmHair, r.range(0.04, 0.055), len * 0.8, [s * 0.052, r.range(0.165, 0.185), z + 0.01], [0.1, (s * Math.PI) / 2 + r.range(-0.35, 0.35), 0], { curl: 0.6, wave: 0.01 });
    }
    card(s < 0 ? fl : fr, warmHair, 0.035, 0.07, [0, -0.01, -0.018], [0.1, Math.PI, 0], { curl: 0.5 });
    card(s < 0 ? hl : hr, warmHair, 0.06, 0.06, [0, -0.02, -0.045], [0.2, Math.PI, 0], { curl: 0.5 });
  }
  for (let i = 0; i < 3; i++) card(body, warmHair, 0.06, 0.085, [(i - 1) * 0.026, 0.135, 0.205], [-0.15, 0.25 * (i - 1), 0], { curl: 0.3 });

  // tail: a tapering tube that carries on from the topline, with a long plume underneath
  const tailRoot = new THREE.Group();
  tailRoot.position.set(0, 0.2, -0.275);
  body.add(tailRoot);
  const tailCurve = new THREE.CatmullRomCurve3([[0, 0, 0], [0, 0.018, -0.07], [0, 0.05, -0.14], [0, 0.1, -0.19]].map((p) => new THREE.Vector3(...p)));
  const tailGeo = new THREE.TubeGeometry(tailCurve, 20, 0.016, 10, false);
  const tp = tailGeo.attributes.position, along = new THREE.Vector3();
  for (let i = 0; i < tp.count; i++) {
    const seg = Math.floor(i / 11) / 20; // rings of 11 verts (10 radial segments + seam)
    tailCurve.getPointAt(Math.min(1, seg), along);
    const k = 1 - seg * 0.6;
    tp.setXYZ(i, along.x + (tp.getX(i) - along.x) * k, along.y + (tp.getY(i) - along.y) * k, along.z + (tp.getZ(i) - along.z) * k);
  }
  tailGeo.computeVertexNormals();
  put(tailRoot, tailGeo, coat, [0, 0, 0]);
  for (let i = 0; i < 8; i++) {
    const t = 0.08 + i * 0.12;
    const p = tailCurve.getPointAt(t);
    const tg = tailCurve.getTangentAt(t);
    const pitch = Math.atan2(tg.y, -tg.z);
    for (const s of [-1, 1]) {
      const m = card(tailRoot, i % 2 ? warmHair : hair, 0.045, 0.055 + Math.sin(t * Math.PI) * 0.035, [p.x + s * 0.004, p.y, p.z], [0, 0, 0], { curl: 0.5, wave: 0.01 });
      m.rotation.set(-pitch * 0.4, (s * Math.PI) / 2 + s * 0.35, 0, 'YXZ');
    }
  }

  // collar with a brass tag
  const collar = std({ color: '#8c1c13', roughness: 0.45 });
  const brass = std({ color: '#c9a24a', roughness: 0.25, metalness: 0.9 });
  put(body, new THREE.TorusGeometry(0.049, 0.005, 8, 32), collar, [0, 0.228, 0.21], { r: [-1.13, 0, 0], s: [1, 1, 1.6] });
  put(body, new THREE.CylinderGeometry(0.01, 0.01, 0.003, 18), brass, [0, 0.2, 0.256], { r: [Math.PI / 2 - 0.42, 0, 0] });

  // head: one long tapered wedge with a glossy nose, almond eyes set on the sides and tan brows
  const neckTop = new THREE.Group();
  neckTop.position.set(0, 0.292, 0.232);
  body.add(neckTop);
  const head = new THREE.Group();
  neckTop.add(head);
  const headMat = std({ map: headTex(), roughness: 0.75 });
  head.rotation.order = 'YXZ';
  const skull = loft([
    { p: [0, 0.016, -0.034], w: 0.004, h: 0.004 },
    { p: [0, 0.018, -0.02], w: 0.032, h: 0.032 },
    { p: [0, 0.021, 0.008], w: 0.044, h: 0.041 },
    { p: [0, 0.019, 0.038], w: 0.04, h: 0.035, drop: 0.08 },
    { p: [0, 0.012, 0.064], w: 0.031, h: 0.026, drop: 0.05 },
    { p: [0, 0.004, 0.098], w: 0.024, h: 0.02 },
    { p: [0, -0.002, 0.128], w: 0.018, h: 0.016 },
    { p: [0, -0.005, 0.152], w: 0.013, h: 0.013 },
    { p: [0, -0.005, 0.164], w: 0.004, h: 0.004 },
  ], { radial: 24, rings: 40, uv: [1, 1] });
  put(head, skull, headMat, [0, 0, 0]);
  put(head, new THREE.SphereGeometry(0.0115, 16, 12), nose, [0, -0.002, 0.157], { s: [1.15, 0.85, 0.85] });
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = put(head, new THREE.SphereGeometry(0.0078, 14, 10), eye, [s * 0.029, 0.022, 0.058], { s: [0.8, 0.75, 1] });
    e.rotation.y = s * 0.5;
    put(e, new THREE.SphereGeometry(0.0021, 6, 4), glint, [s * 0.002, 0.003, 0.007], { cast: false });
    eyes.push(e);
    put(head, new THREE.SphereGeometry(0.0065, 10, 6), tan, [s * 0.026, 0.035, 0.056], { s: [1.2, 0.5, 0.9] }); // brow
  }
  // ears: set high and back; leather plus layers of long silky hair reaching well past the jaw
  const ears = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.038, 0.04, 0.0);
    head.add(pivot);
    const flap = new THREE.Group();
    flap.rotation.z = s * 0.1;
    pivot.add(flap);
    put(flap, new THREE.SphereGeometry(0.034, 14, 10), coat, [s * 0.008, -0.04, 0.0], { s: [0.26, 1.35, 0.95] });
    for (let i = 0; i < 5; i++) {
      card(flap, i % 2 ? hair : warmHair, r.range(0.05, 0.07), r.range(0.15, 0.18), [s * (0.008 + i * 0.002), 0.02 - i * 0.004, -0.018 + i * 0.009], [r.range(-0.12, 0.12), (s * Math.PI) / 2 + r.range(-0.25, 0.25), r.range(-0.08, 0.08)], { curl: r.range(0.18, 0.35), wave: 0.012 });
    }
    ears.push(flap);
  }

  dog.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = !lowQ;
      o.receiveShadow = true;
    }
  });

  // a soft contact shadow so it always feels grounded
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.56), new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false }));
  blob.rotation.order = 'YXZ';
  blob.rotation.x = -Math.PI / 2;
  blob.renderOrder = 1;
  scene.add(blob);

  /* ---------------- hearts when petted ---------------- */
  const heartMat = new THREE.SpriteMaterial({ map: heartTex(), transparent: true, depthWrite: false });
  const hearts = Array.from({ length: 4 }, () => {
    const sp = new THREE.Sprite(heartMat.clone());
    sp.scale.set(0.045, 0.04, 1);
    sp.visible = false;
    scene.add(sp);
    return { sp, t: 1 };
  });

  /* ---------------- behaviour ---------------- */
  const st = {
    pos: new THREE.Vector2(...NODES.A), heading: Math.PI / 2, speed: 0, phase: 0,
    mode: 'idle', timer: 1.5, path: [], node: 'A', lie: 0, sleep: 0, sniff: 0, excite: 0, hop: 0,
    blink: 0, nextBlink: 2, gazeYaw: 0, gazePitch: 0, lastBed: -20, clock: 0,
  };
  const headWorld = new THREE.Vector3();
  const bedV = new THREE.Vector2(...bedPos);
  const MAX_SPEED = 0.34, STRIDE = 0.17;

  function pickDestination() {
    if (st.clock - st.lastBed > 40 && r.chance(0.3)) return BED;
    return r.pick(Object.keys(NODES).filter((k) => k !== st.node && k !== BED));
  }

  function startWalk(dest) {
    st.path = route(st.node, dest).slice(1);
    st.mode = st.path.length ? 'walk' : 'idle';
    st.timer = 2;
  }

  function pet() {
    st.excite = 1;
    st.hop = 1;
    if (st.mode !== 'idle') st.mode = 'idle';
    st.timer = Math.max(st.timer, 2.5);
    head.getWorldPosition(headWorld);
    hearts.forEach((h, i) => {
      h.t = -i * 0.18;
      h.sp.position.copy(headWorld).add(new THREE.Vector3((i - 1.5) * 0.035, 0.07, 0));
      h.sp.material.opacity = 0;
      h.sp.visible = true;
    });
  }

  const goal = new THREE.Vector2();
  function think(dt) {
    st.timer -= dt;
    st.sniff = Math.max(0, st.sniff - dt);
    if (st.mode === 'walk') {
      const key = st.path[0];
      goal.set(...NODES[key]);
      const toX = goal.x - st.pos.x, toZ = goal.y - st.pos.y;
      const dist = Math.hypot(toX, toZ);
      const dh = Math.atan2(Math.sin(Math.atan2(toX, toZ) - st.heading), Math.cos(Math.atan2(toX, toZ) - st.heading));
      st.heading += clamp(dh, -2.6 * dt, 2.6 * dt);
      const sharp = Math.min(1, Math.abs(dh) / 1.2);
      const last = st.path.length === 1;
      const want = MAX_SPEED * (1 - sharp * 0.75) * (last ? clamp(dist / 0.25, 0.25, 1) : 1);
      st.speed = lerp(st.speed, want, 1 - Math.exp(-dt * 4));
      st.pos.x += Math.sin(st.heading) * st.speed * dt;
      st.pos.y += Math.cos(st.heading) * st.speed * dt;
      if (dist < (last ? 0.06 : 0.16)) {
        st.node = key;
        st.path.shift();
        if (!st.path.length) {
          if (key === BED) {
            st.mode = 'settle';
            st.timer = 1.2;
          } else {
            st.mode = 'idle';
            st.timer = r.range(2.5, 6);
            st.sniff = r.chance(0.55) ? r.range(1.2, 2.5) : 0;
          }
        }
      }
      return;
    }
    st.speed = lerp(st.speed, 0, 1 - Math.exp(-dt * 6));
    if (st.mode === 'settle') {
      // turn to face out of the bed toward the room, then curl up
      const want = 0.55;
      st.heading += clamp(Math.atan2(Math.sin(want - st.heading), Math.cos(want - st.heading)), -2 * dt, 2 * dt);
      st.pos.lerp(bedV, 1 - Math.exp(-dt * 3));
      if (st.timer < 0) {
        st.mode = 'lie';
        st.timer = r.range(12, 22);
        st.lastBed = st.clock;
      }
    } else if (st.mode === 'lie' && st.timer < 0) {
      st.mode = 'idle'; // stand up first
      st.timer = 1.5;
    } else if (st.mode === 'idle' && st.timer < 0) {
      startWalk(pickDestination());
    }
  }

  let hopY = 0;
  /** gaze: { yaw, pitch } toward the viewer in the dog's own frame. */
  function update(dt, t, gaze) {
    st.clock += dt;
    think(dt);
    st.excite = Math.max(0, st.excite - dt * 0.4);
    const ex = st.excite;
    const k = Math.min(1, st.speed / MAX_SPEED);
    const walking = k > 0.06;
    st.phase += (st.speed / STRIDE) * TAU * dt;
    st.lie = lerp(st.lie, st.mode === 'lie' ? 1 : 0, 1 - Math.exp(-dt * (st.mode === 'lie' ? 2.2 : 4)));
    const L = st.lie;
    st.sleep = lerp(st.sleep, st.mode === 'lie' && st.timer < 18 ? 1 : 0, 1 - Math.exp(-dt * 1.5));

    dog.position.set(st.pos.x, 0, st.pos.y);
    dog.rotation.y = st.heading;
    blob.position.set(st.pos.x, 0.006 + L * 0.05, st.pos.y);
    blob.rotation.y = st.heading;
    blob.material.opacity = 1 - L * 0.4;

    // legs: a trot while walking, folded when lying
    for (const leg of legs) {
      const ph = st.phase + leg.phase;
      const swing = Math.sin(ph) * 0.42 * k;
      const lift = Math.max(0, Math.cos(ph)) * k;
      leg.hip.rotation.x = lerp(-swing, leg.front ? -1.35 : -1.15, L);
      leg.knee.rotation.x = lerp(leg.front ? lift * 0.9 : -lift * 0.7, leg.front ? 0.1 : 1.75, L);
    }
    hopY = st.hop > 0 ? Math.abs(Math.sin((1 - st.hop) * Math.PI * 2)) * 0.03 * st.hop : 0;
    st.hop = Math.max(0, st.hop - dt * 2.2);
    body.position.y = Math.abs(Math.sin(st.phase)) * 0.006 * k - L * 0.038 + hopY;
    body.rotation.z = Math.sin(st.phase) * 0.025 * k;
    body.scale.y = 1 + Math.sin(t * (st.mode === 'lie' ? 1.4 : 2.4 + ex * 4)) * (0.012 + ex * 0.008);

    // tail: wags while walking or happy, curls around when lying
    const wagSpeed = 3 + ex * 11 + k * 3;
    tailRoot.rotation.y = lerp(Math.sin(t * wagSpeed) * (0.2 + ex * 0.55 + k * 0.15), 0.9, L);
    tailRoot.rotation.x = lerp(-0.12 - ex * 0.25 - k * 0.1, 0.75, L);

    // head: looks at you when standing, forward when trotting, nose down when sniffing, resting when lying
    const lookYaw = walking ? Math.sin(t * 0.7) * 0.15 : gaze.yaw;
    const lookPitch = walking ? 0.12 : st.sniff > 0 ? 0.7 + Math.sin(t * 9) * 0.05 : gaze.pitch;
    st.gazeYaw = lerp(st.gazeYaw, lerp(lookYaw, 0.25, L), 1 - Math.exp(-dt * 4));
    st.gazePitch = lerp(st.gazePitch, lerp(lookPitch, 0.18, L), 1 - Math.exp(-dt * 4));
    neckTop.position.y = 0.292 - L * 0.06;
    neckTop.position.z = 0.232 + L * 0.03;
    head.rotation.set(0.14 + st.gazePitch + Math.sin(st.phase * 2) * 0.03 * k, st.gazeYaw, Math.sin(t * 6) * 0.14 * ex + 0.04, 'YXZ');

    // blinking, and sleepy eyes on the bed
    st.nextBlink -= dt;
    if (st.nextBlink < 0) {
      st.blink = 0.13;
      st.nextBlink = 2.5 + Math.random() * 4;
    }
    st.blink = Math.max(0, st.blink - dt);
    const open = st.blink > 0 ? 0.12 : lerp(0.78, 0.1, st.sleep);
    eyes.forEach((e) => (e.scale.y = open));

    // ears swing with the trot and lift when excited
    ears.forEach((e, i) => {
      const s = i === 0 ? -1 : 1;
      e.rotation.z = s * (0.1 + ex * 0.28 + Math.abs(Math.sin(st.phase)) * 0.06 * k);
      e.rotation.x = -ex * 0.18 + Math.sin(st.phase * 2 + 1) * 0.08 * k;
    });

    hearts.forEach((h) => {
      if (!h.sp.visible) return;
      h.t += dt;
      if (h.t < 0) return;
      h.sp.position.y += dt * 0.12;
      h.sp.position.x += Math.sin(h.t * 6 + h.sp.id) * dt * 0.03;
      h.sp.material.opacity = Math.max(0, Math.min(1, h.t * 6) * (1 - h.t / 1.4));
      if (h.t > 1.4) h.sp.visible = false;
    });
    ctx.anchors.dog.set(st.pos.x, 0.25 - L * 0.08, st.pos.y);
  }

  ctx.anchors.dog = new THREE.Vector3(st.pos.x, 0.25, st.pos.y);
  return {
    group: dog, bed: bedG, head, update, pet,
    get moving() { return st.speed > 0.02; },
    debug: st,
  };
}
