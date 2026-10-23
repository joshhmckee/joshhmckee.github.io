import * as THREE from '../vendor/three.module.min.js';
import { std, retro, put, cyl, dynamic, rng, TAU, lerp, clamp, smooth } from './util.js';
import * as T from './textures.js';

/* ==================================================================
   A long-haired chocolate-and-tan dachshund who lives in the office.
   Built facing +z, standing on y = 0. Units are metres.

   Body, neck and tail are one closed skin bent by a chain of spine
   bones, so he can bend into turns and curl up nose-to-tail in his bed.
   The long coat is layered over that solid body as tapering ribbons of
   real geometry (no cut-out cards), so he is solid from every side.
   ================================================================== */

const COAT = '#45271a';   // chocolate
const COAT2 = '#52301f';  // warmer chocolate in the long feathering
const DARK = '#28160d';   // the deeper shade along the back and at the roots
const TIP = '#6a3f27';    // sun-warmed tips of the long hair
const TAN = '#875331';    // tan points: brows, cheeks, muzzle, forechest, feet

const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1), DOWN = new THREE.Vector3(0, -1, 0);

/* ---------------- textures ---------------- */

/** Short coat: a light grey detail map (the colour comes from the vertices) with fine hairs lying along v. */
function coatTex(seed = 3) {
  const W = 128, H = 128;
  const [c, g] = T.makeCanvas(W, H);
  const r = rng(seed);
  g.fillStyle = '#dadada';
  g.fillRect(0, 0, W, H);
  // soft drifts where the coat clumps and parts
  for (let i = 0; i < 46; i++) {
    const x = r() * W, y = r() * H, rw = r.range(3, 9), rh = r.range(10, 26), rot = r.range(-0.2, 0.2), a = r.range(0.05, 0.14);
    g.fillStyle = r.chance(0.5) ? `rgba(255,255,255,${a})` : `rgba(30,30,30,${a})`;
    for (const ox of [-W, 0, W]) {
      for (const oy of [-H, 0, H]) {
        g.beginPath();
        g.ellipse(x + ox, y + oy, rw, rh, rot, 0, TAU);
        g.fill();
      }
    }
  }
  // fine hairs following the lay of the coat
  g.lineCap = 'round';
  for (let i = 0; i < 1600; i++) {
    const x = r() * W, y = r() * H, len = r.range(3, 7), bend = r.range(-0.8, 0.8);
    g.strokeStyle = r.chance(0.55) ? `rgba(30,24,20,${r.range(0.15, 0.35)})` : `rgba(255,255,255,${r.range(0.15, 0.4)})`;
    g.lineWidth = r.range(0.35, 0.7);
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + bend, y + len * 0.5, x + bend * 0.4, y + len);
    g.stroke();
  }
  return T.toTexture(c, { wrap: true });
}

/** Long silky hair: a grey map of fine wavy strands running the length of each lock (v), with glossy highlights. */
function strandTex(seed = 5) {
  const W = 64, H = 128;
  const [c, g] = T.makeCanvas(W, H);
  const r = rng(seed);
  g.fillStyle = '#969696';
  g.fillRect(0, 0, W, H);
  g.lineCap = 'round';
  for (let i = 0; i < 240; i++) {
    const x0 = r() * W, amp = r.range(0.5, 2.2), freq = r.range(0.04, 0.09), ph = r() * TAU, v = r();
    g.strokeStyle = v < 0.35 ? `rgba(45,45,45,${r.range(0.3, 0.6)})` : v < 0.8 ? `rgba(215,215,215,${r.range(0.4, 0.8)})` : `rgba(255,255,255,${r.range(0.5, 0.9)})`;
    g.lineWidth = r.range(0.4, 1.1);
    for (const ox of [-W, 0, W]) {
      g.beginPath();
      for (let y = 0; y <= H; y += 4) {
        const x = x0 + ox + Math.sin(y * freq + ph) * amp;
        if (y) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
    }
  }
  return T.toTexture(c, { wrap: true });
}

/** Nose leather for a sphere whose front sits at u = 0.25: pebbled, with two curved nostrils and a philtrum. */
function noseTex() {
  const W = 64, H = 32;
  const [c, g] = T.makeCanvas(W, H);
  const r = rng(8);
  g.fillStyle = '#3a2a23';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = r.chance(0.5) ? 'rgba(0,0,0,0.35)' : 'rgba(130,100,90,0.16)';
    g.fillRect(r() * W, r() * H, 0.8, 0.8);
  }
  g.fillStyle = '#040202';
  g.strokeStyle = '#060403';
  g.lineWidth = 0.7;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(16 + s * 3.8, 17.4, 2.1, 1.3, s * 0.45, 0, TAU);
    g.fill();
    g.beginPath(); // the slit curling out and down from each nostril
    g.moveTo(16 + s * 5.4, 18);
    g.quadraticCurveTo(16 + s * 6.6, 19.8, 16 + s * 6, 21.5);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(16, 19.5);
  g.lineTo(16, 32);
  g.stroke();
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
 * Loft a closed solid through stations { p:[x,y,z], w, t, b, k, sq }: half width, height above and
 * depth below the spine (t defaults to w, b to t), keel (narrows the underside, for a deep chest)
 * and squareness (2 = ellipse). Rings stay square to the spine and are spaced evenly along it; faces
 * wind outward and each closed end gets a dome. `side` is the direction the width spans;
 * tint(colour, { a, u, p }) paints vertex colours. Each vertex also carries `su`, its place along
 * the spine (0..1), for skinning. userData: at(u, a) -> { p, n, tan }, frame(u), uz(z).
 */
function loft(stations, { radial = 24, rings = 48, uv = [1, 1], side = X, caps = [true, true], capRings = 4, tint = null } = {}) {
  const curve = new THREE.CatmullRomCurve3(stations.map((s) => new THREE.Vector3(...s.p)), false, 'centripetal');
  const n = stations.length;
  const val = (k, key) => {
    const s = stations[clamp(k, 0, n - 1)];
    if (key === 't') return s.t ?? s.w;
    if (key === 'b') return s.b ?? s.t ?? s.w;
    if (key === 'sq') return s.sq ?? 2;
    return s[key] ?? 0;
  };
  const param = (t, key) => {
    const f = t * (n - 1), k = Math.min(n - 2, Math.floor(f)), a = f - k;
    return cat(val(k - 1, key), val(k, key), val(k + 1, key), val(k + 2, key), a);
  };
  const C = new THREE.Vector3(), Tg = new THREE.Vector3(), S = new THREE.Vector3(), U = new THREE.Vector3();
  const sec = { w: 0, t: 0, b: 0, k: 0, sq: 2 };
  const frame = (u) => {
    const t = curve.getUtoTmapping(clamp(u, 0, 1));
    curve.getPoint(t, C);
    curve.getTangent(t, Tg);
    S.copy(side).addScaledVector(Tg, -side.dot(Tg)).normalize();
    U.crossVectors(Tg, S);
    sec.w = Math.max(1e-4, param(t, 'w'));
    sec.t = Math.max(1e-4, param(t, 't'));
    sec.b = Math.max(1e-4, param(t, 'b'));
    sec.k = param(t, 'k');
    sec.sq = Math.max(1.2, param(t, 'sq'));
    return sec;
  };
  // the cross-section at angle a (0 = +side, PI/2 = top): offsets along S and U, then a rough outward normal
  const shape = (a, f, out) => {
    let c = Math.cos(a), s = Math.sin(a);
    if (Math.abs(f.sq - 2) > 1e-3) {
      c = Math.sign(c) * Math.abs(c) ** (2 / f.sq);
      s = Math.sign(s) * Math.abs(s) ** (2 / f.sq);
    }
    const h = s >= 0 ? f.t : f.b;
    out[0] = f.w * c * (1 - f.k * Math.max(0, -s) ** 1.5 * 0.6);
    out[1] = h * s;
    out[2] = c / f.w;
    out[3] = s / h;
    return out;
  };

  // rings: a dome of shrinking rings closes each capped end
  const list = [];
  const dome = (u, sign) => {
    const out = [];
    for (let m = 1; m <= capRings; m++) {
      const ph = (m / capRings) * (Math.PI / 2);
      out.push({ u, sc: m === capRings ? 0 : Math.cos(ph), off: sign * Math.sin(ph) });
    }
    return out;
  };
  if (caps[0]) list.push(...dome(0, -1).reverse());
  for (let i = 0; i <= rings; i++) list.push({ u: i / rings, sc: 1, off: 0 });
  if (caps[1]) list.push(...dome(1, 1));

  const len = curve.getLength();
  const pos = [], uvs = [], col = [], su = [], idx = [];
  const tmp = [0, 0, 0, 0], P = new THREE.Vector3(), colr = new THREE.Color();
  for (const rg of list) {
    const f = frame(rg.u);
    const d = ((f.w + f.t + f.b) / 3) * rg.off;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      shape(a, f, tmp);
      P.copy(C).addScaledVector(Tg, d).addScaledVector(S, tmp[0] * rg.sc).addScaledVector(U, tmp[1] * rg.sc);
      pos.push(P.x, P.y, P.z);
      uvs.push((j / radial) * uv[0], (rg.u + d / len) * uv[1]);
      su.push(rg.u);
      if (tint) {
        tint(colr, { a, u: rg.u, p: P });
        col.push(colr.r, colr.g, colr.b);
      }
    }
  }
  const R = radial + 1;
  for (let i = 0; i < list.length - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * R + j, b = a + R;
      idx.push(a, a + 1, b, a + 1, b + 1, b); // around the ring x along the spine = outward
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (tint) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('su', new THREE.Float32BufferAttribute(su, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld normals across the seam, and point each pole straight out along the spine
  const no = g.attributes.normal, v = new THREE.Vector3();
  list.forEach((rg, i) => {
    if (rg.sc === 0) {
      frame(rg.u);
      for (let j = 0; j <= radial; j++) no.setXYZ(i * R + j, Tg.x * Math.sign(rg.off), Tg.y * Math.sign(rg.off), Tg.z * Math.sign(rg.off));
      return;
    }
    v.set(no.getX(i * R) + no.getX(i * R + radial), no.getY(i * R) + no.getY(i * R + radial), no.getZ(i * R) + no.getZ(i * R + radial)).normalize();
    no.setXYZ(i * R, v.x, v.y, v.z);
    no.setXYZ(i * R + radial, v.x, v.y, v.z);
  });

  const zs = [];
  for (let i = 0; i <= 400; i++) zs.push(curve.getPointAt(i / 400).z);
  g.userData = {
    at(u, a) {
      const f = frame(u);
      shape(a, f, tmp);
      const p = C.clone().addScaledVector(S, tmp[0]).addScaledVector(U, tmp[1]);
      return { p, n: S.clone().multiplyScalar(tmp[2]).addScaledVector(U, tmp[3]).normalize(), tan: Tg.clone() };
    },
    frame(u) {
      const f = frame(u);
      return { ...f, c: C.clone(), tan: Tg.clone(), side: S.clone(), up: U.clone() };
    },
    /** u at the point of the spine nearest the given z. */
    uz(z) {
      let best = 0;
      zs.forEach((q, i) => { if (Math.abs(q - z) < Math.abs(zs[best] - z)) best = i; });
      return best / 400;
    },
  };
  return g;
}

/** Merge geometries that carry the same attributes into one. */
function merge(geos) {
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(geos[0].attributes)) {
    const arr = new Float32Array(geos.reduce((s, g) => s + g.attributes[name].array.length, 0));
    let off = 0;
    for (const g of geos) {
      arr.set(g.attributes[name].array, off);
      off += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, geos[0].attributes[name].itemSize));
  }
  const idx = [];
  let base = 0;
  for (const g of geos) {
    for (const i of g.index.array) idx.push(i + base);
    base += g.attributes.position.count;
  }
  out.setIndex(idx);
  return out;
}

/** Give a plain geometry vertex colours, fn(colour, position), so it can share the coat material. */
function paint(geo, fn) {
  const p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color(), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    fn(c, v.fromBufferAttribute(p, i));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Skin weights from each vertex's place along the spine, shared linearly between the two nearest bones. */
function skin(geo, boneU) {
  const su = geo.attributes.su.array, si = new Uint16Array(su.length * 4), sw = new Float32Array(su.length * 4);
  for (let i = 0; i < su.length; i++) {
    let k = 0;
    while (k < boneU.length - 2 && su[i] > boneU[k + 1]) k++;
    const f = clamp((su[i] - boneU[k]) / (boneU[k + 1] - boneU[k]), 0, 1);
    si[i * 4] = k;
    si[i * 4 + 1] = k + 1;
    sw[i * 4] = 1 - f;
    sw[i * 4 + 1] = f;
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.deleteAttribute('su');
  return geo;
}

/** Three more points for a lock leaving the skin at q (normal n): it falls under gravity in a soft S, flaring out. */
function fallFrom(pts, q, n, len, across, r, flare, wave) {
  const dir = new THREE.Vector3();
  q = q.clone();
  for (let i = 1; i <= 3; i++) {
    dir.copy(DOWN).addScaledVector(n, flare * (0.3 + i * 0.25)).normalize();
    q.addScaledVector(dir, len / 3).addScaledVector(across, wave * (i % 2 ? 1 : -1) * r.range(0.4, 1.2));
    pts.push(q.clone());
  }
  return pts;
}

/** A lock rooted at p on skin with outward normal n: it runs a little way along the surface, then falls. */
function fall(p, n, len, across, r, { flare = 0.3, wave = 0.005, lie = 0.2 } = {}) {
  const d = DOWN.clone().addScaledVector(n, -DOWN.dot(n));
  if (d.lengthSq() < 0.02) d.copy(DOWN);
  d.normalize();
  const q = p.clone().addScaledVector(n, 0.002);
  const pts = [p.clone().addScaledVector(n, -0.004), q.clone()];
  q.addScaledVector(d, len * lie);
  pts.push(q.clone());
  return fallFrom(pts, q, n, len * (1 - lie), across, r, flare, wave);
}

/**
 * A lock that lies over a lofted surface along path [[u, a], ...] (gap above the skin, so it never
 * touches it), then falls free for `len`. This is how the coat parts along the spine and drapes the flanks.
 */
function drape(surf, path, gap, len, across, r, { flare = 0.25, wave = 0.005 } = {}) {
  const root = surf.at(...path[0]);
  const pts = [root.p.clone().addScaledVector(root.n, -0.003)];
  let s;
  path.forEach(([u, a], i) => {
    s = surf.at(u, a);
    pts.push(s.p.addScaledVector(s.n, gap * (0.35 + (0.65 * i) / (path.length - 1))));
  });
  return fallFrom(pts, pts[pts.length - 1], s.n, len, across, r, flare, wave);
}

/**
 * A curtain of long hair: columns path(f, hem) -> [Vector3, ...] from root to tip (f = 0..1 across;
 * hem scales how far each column falls; su(f, v) places it along the spine) joined into one closed
 * slab. It is thickest mid-lock and thins to nothing at the root, the edges and the tips; the hem is
 * cut into pointed locks (about `lock` columns wide) of uneven width and length, each lock rounded (bulging toward `out`) so the light picks
 * out the clumps, and the free hair waves gently along `waveDir`.
 */
function curtain(path, { cols = 28, rows = 12, lock = 4, jag = 0.4, thick = 0.003, ripple = 0.002, fade = 0.1, out = null, waveDir = null, wave = 0, repeat = 6, su = () => 0, r, colours }) {
  // split the columns into locks of uneven width; at(j) -> [lock, next lock, place across the lock]
  const starts = [0];
  while (starts[starts.length - 1] <= cols) starts.push(starts[starts.length - 1] + Math.max(2, Math.round(lock * r.range(0.6, 1.5))));
  const locks = starts.map(() => ({ len: r.range(0.82, 1.12), jag: jag * r.range(0.6, 1.25), rip: r.range(0.2, 1.3), tint: colours(), ph: r() * TAU }));
  const at = (j) => {
    let k = 0;
    while (starts[k + 1] <= j) k++;
    return [locks[k], locks[k + 1], (j - starts[k]) / (starts[k + 1] - starts[k])];
  };
  const C = [];
  for (let j = 0; j <= cols; j++) {
    const f = j / cols, [A, B, q] = at(j);
    const tooth = 1 - lerp(A.jag, B.jag, q) * Math.abs(2 * q - 1) ** 1.3;
    const cv = new THREE.CatmullRomCurve3(path(f, tooth * lerp(A.len, B.len, smooth(q))), false, 'centripetal');
    C.push(Array.from({ length: rows + 1 }, (_, i) => {
      const p = cv.getPointAt(i / rows);
      if (wave) p.addScaledVector(waveDir, Math.sin(f * 23 + (i / rows) * 7 + A.ph * 0.3) * wave * smooth(i / rows));
      return p;
    }));
  }
  // the sheet's normal (across x down), turned to face `out`
  const N = C.map((col, j) => col.map((p, i) => {
    const a = C[Math.min(cols, j + 1)][i].clone().sub(C[Math.max(0, j - 1)][i]);
    const b = col[Math.min(rows, i + 1)].clone().sub(col[Math.max(0, i - 1)]);
    return a.cross(b).normalize();
  }));
  const flip = !!out && N[cols >> 1][rows >> 1].dot(out) < 0;
  const pos = [], uvs = [], col = [], sus = [], idx = [], c = new THREE.Color(), c1 = new THREE.Color(), R = rows + 1;
  for (const sgn of [1, -1]) {
    for (let j = 0; j <= cols; j++) {
      const f = j / cols, [A, B, q] = at(j);
      const edge = smooth(clamp(Math.min(f, 1 - f) / fade, 0, 1)), bulge = 0.5 - 0.5 * Math.cos(q * TAU);
      for (let i = 0; i <= rows; i++) {
        const v = i / rows, n = flip ? N[j][i].clone().negate() : N[j][i];
        const body = smooth(clamp(v / 0.15, 0, 1)) * (1 - smooth(clamp((v - 0.35) / 0.65, 0, 1)));
        const th = thick * edge * body * (0.5 + 0.5 * bulge);
        const p = C[j][i].clone().addScaledVector(n, ripple * A.rip * edge * bulge * smooth(clamp(v / 0.3, 0, 1)) * (1 - v * 0.5) + sgn * th);
        pos.push(p.x, p.y, p.z);
        uvs.push(f * repeat, 1 - v);
        c.lerpColors(A.tint[0], B.tint[0], smooth(q));
        c1.lerpColors(A.tint[1], B.tint[1], smooth(q));
        c.lerp(c1, smooth(v)).multiplyScalar(0.78 + 0.22 * bulge);
        col.push(c.r, c.g, c.b);
        sus.push(su(f, v));
      }
    }
  }
  for (let s = 0; s < 2; s++) {
    for (let j = 0; j < cols; j++) {
      for (let i = 0; i < rows; i++) {
        const a = s * (cols + 1) * R + j * R + i, b = a + R;
        if ((s === 0) !== flip) idx.push(a, b, a + 1, b, b + 1, a + 1); // across x down: faces the normal
        else idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('su', new THREE.Float32BufferAttribute(sus, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Width along a lock (f = 0 root .. 1 tip, by length): fullest just below the root, then tapering to a fine point. */
const taper = (f) => (f < 0.1 ? 0.55 + f * 4.5 : 1 - smooth(clamp((f - 0.42) / 0.58, 0, 1)) * 0.95);

/** A lock of long hair through pts: a flat, tapering ribbon whose width spans `across`, shaded root to tip. */
function lock(pts, width, thick, across, c0, c1, su, q) {
  const d = [0];
  for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const g = loft(pts.map((p, i) => ({ p: p.toArray(), w: width * taper(d[i] / d[d.length - 1]), t: thick * taper(d[i] / d[d.length - 1]) })), {
    radial: q.radial, rings: q.rings, side: across, caps: [true, false], capRings: 2, uv: [2, 1],
    tint: (c, { u }) => c.lerpColors(c0, c1, smooth(u)),
  });
  g.attributes.su.array.fill(su);
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

/* ---------------- anatomy ---------------- */

/** The spine, from the tip of the tail along the back and up the neck to just under the skull. */
const SPINE = [
  { p: [0, 0.262, -0.468], w: 0.006 },                                // tail tip
  { p: [0, 0.236, -0.43], w: 0.0095 },
  { p: [0, 0.214, -0.385], w: 0.0125 },
  { p: [0, 0.203, -0.338], w: 0.0155, b: 0.017 },
  { p: [0, 0.2, -0.302], w: 0.02, t: 0.02, b: 0.024 },                // set of the tail
  { p: [0, 0.188, -0.272], w: 0.046, t: 0.034, b: 0.062 },            // seat
  { p: [0, 0.18, -0.232], w: 0.06, t: 0.048, b: 0.074 },              // croup
  { p: [0, 0.174, -0.17], w: 0.06, t: 0.056, b: 0.068, sq: 2.2 },     // loin
  { p: [0, 0.172, -0.095], w: 0.056, t: 0.058, b: 0.058, k: 0.1, sq: 2.2 }, // tuck-up
  { p: [0, 0.168, -0.02], w: 0.062, t: 0.062, b: 0.08, k: 0.35, sq: 2.2 },  // back of the ribs
  { p: [0, 0.164, 0.06], w: 0.064, t: 0.065, b: 0.098, k: 0.5, sq: 2.2 },   // deep chest
  { p: [0, 0.168, 0.125], w: 0.061, t: 0.063, b: 0.1, k: 0.5 },       // brisket, behind the front legs
  { p: [0, 0.188, 0.178], w: 0.053, t: 0.054, b: 0.088, k: 0.35 },    // withers and prosternum
  { p: [0, 0.226, 0.214], w: 0.044, t: 0.042, b: 0.06 },              // base of the neck
  { p: [0, 0.264, 0.236], w: 0.035, t: 0.034, b: 0.043 },
  { p: [0, 0.296, 0.248], w: 0.029, t: 0.03, b: 0.034 },              // under the skull
];

/** Spine bones (by z along the spine), tail tip first. `mid` is the root of both chains. */
const BONES = [['tail3', -0.43], ['tail2', -0.386], ['tail1', -0.34], ['tail0', -0.3], ['rump', -0.232], ['loin', -0.15],
  ['mid', -0.06], ['ribs', 0.03], ['chest', 0.12], ['neck0', 0.207], ['neck1', 0.248]];

/** Head, from the occiput to the nose; the neck pivot (the origin) sits inside the back of the skull. */
const SKULL = [
  { p: [0, 0.02, -0.024], w: 0.026, t: 0.026, b: 0.027 },   // occiput
  { p: [0, 0.021, 0.0], w: 0.037, t: 0.036, b: 0.035 },     // domed cranium
  { p: [0, 0.019, 0.03], w: 0.035, t: 0.033, b: 0.034 },    // cheekbones; the eyes sit just ahead
  { p: [0, 0.012, 0.056], w: 0.026, t: 0.023, b: 0.029 },   // stop
  { p: [0, 0.006, 0.081], w: 0.0205, t: 0.0195, b: 0.023 }, // long muzzle
  { p: [0, 0.002, 0.105], w: 0.0175, t: 0.0175, b: 0.018 },
  { p: [0, -0.001, 0.126], w: 0.0145, t: 0.015, b: 0.014 }, // under the nose leather
];
const JAW = [
  { p: [0, -0.009, 0.02], w: 0.02, t: 0.009, b: 0.01 },
  { p: [0, -0.0105, 0.065], w: 0.0155, t: 0.008, b: 0.0095 },
  { p: [0, -0.0095, 0.095], w: 0.012, t: 0.007, b: 0.008 },
  { p: [0, -0.007, 0.115], w: 0.009, t: 0.006, b: 0.0055 },
];

/* ================================================================== */

export function buildDog(ctx, { scale = 1.12 } = {}) {
  const { scene } = ctx;
  const r = rng(21);
  const lowQ = ctx.quality.name === 'low';

  // fur: physically based for its sheen, a soft warm glow at grazing angles like a silky coat
  const fur = (params) => retro(new THREE.MeshPhysicalMaterial({ sheen: 1, sheenRoughness: 0.4, sheenColor: new THREE.Color('#6b4630'), ...params }));
  const coat = fur({ map: coatTex(), vertexColors: true, roughness: 0.8, sheen: 0.7 });
  const hair = fur({ map: strandTex(), vertexColors: true, roughness: 0.6 });
  const nose = retro(new THREE.MeshPhysicalMaterial({ map: noseTex(), roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.35 }));
  const eye = retro(new THREE.MeshPhysicalMaterial({ color: '#1c0d06', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.04 }));
  const glint = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const lidMat = std({ color: '#2a160c', roughness: 0.55 });
  const nail = std({ color: '#1b120d', roughness: 0.35 });
  const cCoat = new THREE.Color(COAT), cCoat2 = new THREE.Color(COAT2), cDark = new THREE.Color(DARK), cTip = new THREE.Color(TIP), cTan = new THREE.Color(TAN);
  const Q = lowQ ? { radial: 4, rings: 6 } : { radial: 4, rings: 10 }; // locks: diamond-section ribbons

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

  // body, neck and tail: one skin, darker along the back, warmer underneath, tan on the forechest and under the tail
  const torso = loft(SPINE, {
    radial: lowQ ? 18 : 24, rings: lowQ ? 48 : 72, uv: [3, 7],
    tint: (c, { a, p }) => {
      const s = Math.sin(a);
      c.copy(cCoat).lerp(cDark, smooth(clamp((s - 0.3) / 0.6, 0, 1)) * 0.6).lerp(cCoat2, smooth(clamp((-s - 0.2) / 0.6, 0, 1)) * 0.6);
      const chest = smooth(clamp((p.z - 0.15) / 0.04, 0, 1)) * smooth(clamp((-s - 0.1) / 0.4, 0, 1)) * (1 - smooth(clamp((p.y - 0.15) / 0.05, 0, 1)));
      const tail = smooth(clamp((-0.285 - p.z) / 0.03, 0, 1)) * smooth(clamp((-s - 0.3) / 0.5, 0, 1));
      c.lerp(cTan, Math.max(chest * 0.85, tail * 0.7));
    },
  });
  const sp = torso.userData;

  // spine bones: one chain runs forward from the middle of the back to the head, the other back to the tip of the tail
  const bone = {}, bones = [], boneU = [];
  for (const [name, z] of BONES) {
    const b = new THREE.Bone();
    b.name = name;
    b.rotation.order = 'YXZ';
    const u = name === 'neck1' ? 1 : sp.uz(z);
    b.userData.home = sp.frame(u).c;
    bone[name] = b;
    bones.push(b);
    boneU.push(u);
  }
  body.add(bone.mid);
  bone.mid.position.copy(bone.mid.userData.home);
  for (const chain of [['mid', 'ribs', 'chest', 'neck0', 'neck1'], ['mid', 'loin', 'rump', 'tail0', 'tail1', 'tail2', 'tail3']]) {
    for (let i = 1; i < chain.length; i++) {
      const b = bone[chain[i]], parent = bone[chain[i - 1]];
      parent.add(b);
      b.position.copy(b.userData.home).sub(parent.userData.home);
    }
  }
  const tailBones = ['tail0', 'tail1', 'tail2', 'tail3'].map((k) => bone[k]);
  const skeleton = new THREE.Skeleton(bones);
  const skinned = (geo, mat) => {
    const m = new THREE.SkinnedMesh(skin(geo, boneU), mat);
    m.frustumCulled = false; // he changes shape when he curls up; he's small, so just always draw him
    body.add(m);
    return m;
  };
  const skins = [skinned(torso, coat)];
  // a joint on a bone, placed by its rest position in the body
  const attach = (b, x, y, z) => {
    const g = new THREE.Group();
    g.position.set(x, y, z).sub(b.userData.home);
    b.add(g);
    return g;
  };

  /* long hair: curtains draped over the solid body and cut into pointed locks at the hem, plus a few loose locks */
  const furGeos = [];
  const hairColours = () => [new THREE.Color().lerpColors(cDark, cCoat, r.range(0.1, 0.9)), new THREE.Color().lerpColors(cCoat2, cTip, r.range(0.1, 1))];
  const addLock = (list, pts, w, across, su) => list.push(lock(pts, w, w * 0.22, across, ...hairColours(), su, Q));
  const hang = (path, opts) => curtain(path, { r, colours: hairColours, cols: lowQ ? 16 : 28, rows: lowQ ? 8 : 12, ...opts });
  const side = (s, a) => (s > 0 ? a : Math.PI - a); // mirror an angle round the body onto the right-hand side
  // the coat parts along the spine and drapes both flanks from just under the collar to the rump, then falls
  // free in a fringe that is longest under the chest, where it nearly sweeps the floor, and shorter on the neck
  const floorAt = (z) => (z < 0.02 ? lerp(0.112, 0.036, smooth(clamp((z + 0.22) / 0.2, 0, 1))) : lerp(0.036, 0.085, smooth(clamp((z - 0.11) / 0.11, 0, 1))));
  const uCoat = [sp.uz(-0.29), 0.93];
  const uf = (f) => lerp(uCoat[0], uCoat[1], f);
  for (const s of [-1, 1]) {
    furGeos.push(hang((f, hem) => {
      const u = uf(f), a1 = -0.36;
      const path = [0, 1, 2, 3, 4, 5, 6].map((i) => [u, side(s, lerp(1.49, a1, i / 6))]);
      const leave = sp.at(u, side(s, a1)).p;
      const len = Math.min(leave.y - floorAt(leave.z), lerp(0.13, 0.06, smooth(clamp((u - 0.82) / 0.08, 0, 1))));
      return drape(sp, path, 0.0062, Math.max(0.008, len * hem), Z, r, { flare: 0.32, wave: 0 });
    }, {
      cols: lowQ ? 26 : 50, rows: lowQ ? 9 : 13, lock: 3, jag: 0.45, su: uf, out: new THREE.Vector3(s, 0, 0),
      waveDir: Z, wave: 0.004, repeat: 14, fade: 0.06, thick: 0.0034, ripple: 0.0034,
    }));
  }
  // belly fringe between the two curtains, seen from low down
  for (let i = 0, M = lowQ ? 3 : 6; i < M; i++) {
    const z = lerp(-0.13, 0.08, (i + r.range(0.2, 0.8)) / M), u = sp.uz(z);
    const { p, n, tan } = sp.at(u, -Math.PI / 2 + r.range(-0.35, 0.35));
    addLock(furGeos, fall(p, n, r.range(0.026, 0.036), tan, r, { flare: 0.1, lie: 0.05 }), r.range(0.014, 0.017), tan, u);
  }
  // a bib from the base of the neck down over the forechest, hanging between the front legs
  const uThroat = 0.92, uBrisket = sp.uz(0.155);
  furGeos.push(hang((f, hem) => {
    const da = lerp(-1.5, 1.5, f);
    const path = [0, 0.25, 0.5, 0.75, 1].map((t) => [lerp(uThroat, uBrisket, t), -Math.PI / 2 + da * lerp(1, 0.8, t)]);
    const leave = sp.at(uBrisket, -Math.PI / 2 + da * 0.8).p.y;
    return drape(sp, path, 0.005, Math.max(0.01, (leave - 0.042) * hem), X, r, { flare: 0.2, wave: 0 });
  }, { cols: lowQ ? 12 : 20, su: (f, v) => lerp(uThroat, uBrisket, Math.min(1, v * 1.6)), out: new THREE.Vector3(0, -0.4, 1), waveDir: X, wave: 0.003, repeat: 5 }));
  // the flag under the tail, longest halfway along
  const uTail = [sp.uz(-0.458), sp.uz(-0.305)];
  furGeos.push(hang((f, hem) => {
    const { p, n } = sp.at(lerp(uTail[0], uTail[1], f), -Math.PI / 2);
    return fall(p, n, (0.035 + Math.sin(Math.pow(f, 0.75) * Math.PI) * 0.06) * hem, Z, r, { flare: 0.12, lie: 0.1, wave: 0 });
  }, { cols: lowQ ? 10 : 18, lock: 3, su: (f) => lerp(uTail[0], uTail[1], f), waveDir: Z, wave: 0.004, repeat: 5, thick: 0.0045, fade: 0.15 }));
  skins.push(skinned(merge(furGeos), hair));

  // collar with a brass tag, high on the neck above the long hair
  const nf = sp.frame(0.952);
  const collarMat = std({ color: '#5e1810', roughness: 0.55 });
  const brass = std({ color: '#c9a24a', roughness: 0.25, metalness: 0.9 });
  const collar = attach(bone.neck0, ...nf.c.clone().addScaledVector(nf.up, (nf.t - nf.b) / 2).toArray());
  collar.quaternion.setFromUnitVectors(Z, nf.tan); // the ring lies across the neck; local -y points down the throat
  const nh = (nf.t + nf.b) / 2;
  put(collar, new THREE.TorusGeometry(1, 0.06, 8, 36), collarMat, [0, 0, 0], { s: [(nf.w + 0.0025) / 0.94, (nh + 0.0025) / 0.94, 0.085] });
  put(collar, new THREE.CylinderGeometry(0.0095, 0.0095, 0.0025, 18), brass, [0, -(nh + 0.011), 0.006], { r: [Math.PI / 2 + 0.25, 0, 0] });

  /* ---------------- legs ---------------- */
  // shoulder/hip, elbow/stifle and wrist/hock joints, so the trot can swing, fold and flick each paw
  const legs = [];
  const legTint = (c, y) => c.lerpColors(cCoat, cTan, smooth(clamp((0.085 - y) / 0.05, 0, 1)) * 0.9);
  const segment = (parent, pts, radii, y0) => put(parent, loft(pts.map((p, i) => ({ p, w: radii[i][0], t: radii[i][1], b: radii[i][2] ?? radii[i][1] })), {
    radial: lowQ ? 8 : 10, rings: lowQ ? 4 : 6, capRings: 3, uv: [1, 2], tint: (c, { p }) => legTint(c, p.y + y0),
  }), coat);
  const nailGeo = new THREE.ConeGeometry(0.0018, 0.0058, 6);
  const foot = (parent, s, front, floor) => {
    const k = front ? 1 : 0.9;
    const f = new THREE.Group(); // on the floor under the ball of the foot, toes turned out a little
    f.position.set(0, floor, 0.01 * k);
    f.rotation.y = s * (front ? 0.24 : 0.08);
    parent.add(f);
    const tint = (c) => c.copy(cTan).lerp(cCoat2, 0.25);
    put(f, paint(new THREE.SphereGeometry(0.0155 * k, 12, 8), tint), coat, [0, 0.0085 * k, -0.003], { s: [1, 0.62, 1.15] });
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 0.0074 * k, z = (0.0118 - Math.abs(i - 1.5) * 0.0032) * k;
      put(f, paint(new THREE.SphereGeometry(0.0059 * k, 8, 6), tint), coat, [x, 0.0059 * k, z], { s: [1, 1, 1.12] });
      put(f, nailGeo, nail, [x * 1.04, 0.0036 * k, z + 0.0056 * k], { r: [Math.PI / 2 + 0.4, 0, 0] });
    }
  };
  const makeLeg = (front, s) => {
    const J = front
      ? { at: [0.04, 0.152, 0.128], knee: [0.0, -0.068, -0.014], paw: [-0.007, -0.05, 0.012], bone: bone.chest }
      : { at: [0.04, 0.162, -0.212], knee: [0.012, -0.06, 0.03], paw: [-0.004, -0.058, -0.044], bone: bone.rump };
    const hip = attach(J.bone, s * J.at[0], J.at[1], J.at[2]);
    const [kx, ky, kz] = [s * J.knee[0], J.knee[1], J.knee[2]];
    const [px, py, pz] = [s * J.paw[0], J.paw[1], J.paw[2]];
    const knee = new THREE.Group();
    knee.position.set(kx, ky, kz);
    hip.add(knee);
    const paw = new THREE.Group();
    paw.position.set(px, py, pz);
    knee.add(paw);
    const yKnee = J.at[1] + ky, yPaw = yKnee + py;
    const feather = [];
    if (front) {
      // shoulder and upper arm, tucked in against the chest; the forearm curves in around the keel
      segment(hip, [[0, 0.03, 0.01], [s * 0.002, 0, 0], [kx * 0.6, ky * 0.6, kz * 0.6], [kx, ky, kz]], [[0.018, 0.026], [0.02, 0.025], [0.018, 0.02], [0.016, 0.017]], J.at[1]);
      segment(knee, [[0, 0.008, 0], [px * 0.5, py * 0.5, pz * 0.5], [px, py, pz]], [[0.016, 0.017], [0.0135, 0.014], [0.012, 0.012]], yKnee);
      // feathering down the back of the forearm
      feather.push(hang((f, hem) => fall(new THREE.Vector3(s * 0.003 + lerp(-0.011, 0.011, f), -0.002, -0.011), new THREE.Vector3(s * 0.2, 0, -1).normalize(), 0.044 * hem, X, r, { flare: 0.45, lie: 0.15, wave: 0 }),
        { cols: lowQ ? 4 : 6, rows: lowQ ? 5 : 7, lock: 2, jag: 0.35, thick: 0.0035, ripple: 0.0015, fade: 0.2, repeat: 2 }));
      put(knee, merge(feather), hair);
    } else {
      // a broad, muscular thigh blended into the rump, then the second thigh back down to the hock
      segment(hip, [[0, 0.03, -0.008], [0, 0, 0], [kx * 0.55, ky * 0.55, kz * 0.55], [kx, ky, kz]], [[0.017, 0.024, 0.028], [0.022, 0.028, 0.034], [0.02, 0.022, 0.024], [0.015, 0.016, 0.016]], J.at[1]);
      segment(knee, [[0, 0.006, 0], [px * 0.5, py * 0.5, pz * 0.5], [px, py, pz]], [[0.0135, 0.016], [0.011, 0.012], [0.0105, 0.0105]], yKnee);
      // breeches: long hair down the back of the thighs
      feather.push(hang((f, hem) => fall(new THREE.Vector3(s * lerp(-0.006, 0.026, f), 0.012, -0.036), new THREE.Vector3(s * 0.5, 0, -1).normalize(), 0.075 * hem, X, r, { flare: 0.4, lie: 0.25, wave: 0 }),
        { cols: lowQ ? 5 : 8, rows: lowQ ? 6 : 8, lock: 2, jag: 0.35, thick: 0.004, ripple: 0.0018, fade: 0.2, repeat: 2, waveDir: X, wave: 0.003 }));
      put(hip, merge(feather), hair);
    }
    // pastern (or hock) and foot
    const floor = -yPaw;
    segment(paw, [[0, 0.006, 0], [0, floor * 0.5, 0.004], [0, floor + 0.01, 0.008]], [[0.011, 0.011], [0.0105, 0.0102], [0.0118, 0.011]], yPaw);
    foot(paw, s, front, floor);
    // trot: diagonal pairs move together. fold: the joint angles lying down: forearms along the bed, hind legs folded flat
    legs.push({ hip, knee, paw, front, side: s, phase: front ? (s > 0 ? 0 : Math.PI) : (s > 0 ? Math.PI : 0), fold: front ? [0.1, -1.5, 1.4] : [-1.0, 2.4, -1.7] });
  };
  makeLeg(true, -1);
  makeLeg(true, 1);
  makeLeg(false, -1);
  makeLeg(false, 1);

  /* ---------------- head ---------------- */
  // domed skull, a gentle stop, a long tapering muzzle over a separate lower jaw; tan brows, cheeks and muzzle
  const head = new THREE.Group();
  head.rotation.order = 'YXZ';
  bone.neck1.add(head);
  const skull = loft(SKULL, {
    radial: lowQ ? 18 : 26, rings: lowQ ? 20 : 30, uv: [2, 2],
    tint: (c, { a, p }) => {
      const s = Math.sin(a);
      c.copy(cCoat).lerp(cDark, smooth(clamp((p.y - 0.03) / 0.025, 0, 1)) * 0.45);
      let tan = smooth(clamp((p.z - 0.05) / 0.035, 0, 1)) * smooth(clamp((0.35 - s) / 0.5, 0, 1)); // muzzle
      for (const sx of [-1, 1]) {
        const brow = Math.hypot(p.x - sx * 0.019, p.y - 0.039, (p.z - 0.042) * 0.8);
        const cheek = Math.hypot(p.x - sx * 0.028, p.y - 0.002, p.z - 0.04);
        tan = Math.max(tan, 1 - smooth(clamp((brow - 0.004) / 0.006, 0, 1)), (1 - smooth(clamp((cheek - 0.006) / 0.01, 0, 1))) * 0.8);
      }
      c.lerp(cTan, tan * 0.85);
    },
  });
  const sk = skull.userData;
  put(head, skull, coat);
  // lower jaw: tan, with dark lips where it tucks under the muzzle
  put(head, loft(JAW, {
    radial: lowQ ? 10 : 14, rings: lowQ ? 8 : 10,
    tint: (c, { a }) => c.copy(cTan).lerp(cCoat, 0.45).lerp(cDark, smooth(clamp((Math.sin(a) - 0.35) / 0.3, 0, 1)) * 0.8),
  }), coat);
  put(head, new THREE.SphereGeometry(0.0112, 18, 12), nose, [0, 0.0035, 0.1305], { s: [1.15, 0.86, 0.92] });

  // eyes: dark and glossy with a catchlight, almond shaped under dark lids that blink and droop when he's sleepy
  const lids = [];
  for (const s of [-1, 1]) {
    const { p, n } = sk.at(sk.uz(0.047), s > 0 ? 0.5 : Math.PI - 0.5);
    const g = new THREE.Group();
    g.position.copy(p).addScaledVector(n, -0.0046);
    g.quaternion.setFromUnitVectors(Z, n.clone().multiplyScalar(0.55).add(new THREE.Vector3(0, 0.06, 0.8)).normalize());
    g.scale.set(1, 0.8, 0.9);
    head.add(g);
    put(g, new THREE.SphereGeometry(0.0094, 14, 10), eye, [0, 0, 0]);
    put(g, new THREE.SphereGeometry(0.0019, 8, 6), glint, [-s * 0.0018, 0.0039, 0.0079], { cast: false, receive: false });
    const upper = new THREE.Group();
    g.add(upper);
    put(upper, new THREE.SphereGeometry(0.0107, 14, 5, 0, TAU, 0, Math.PI / 2), lidMat, [0, 0, 0]);
    put(g, new THREE.SphereGeometry(0.0104, 14, 4, 0, TAU, Math.PI / 2, Math.PI / 2), lidMat, [0, 0, 0], { r: [0.62, 0, 0] });
    lids.push(upper);
  }

  // ears: set high and back, a long soft leather hanging against the cheek under a curtain of silky hair
  // that reaches well below the jaw
  const ears = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.copy(sk.at(sk.uz(0.004), side(s, 0.62)).p).add(new THREE.Vector3(-s * 0.003, -0.002, 0));
    head.add(pivot);
    const flap = new THREE.Group();
    pivot.add(flap);
    const leather = loft([[0.002, -0.002, 0.003], [0.016, -0.022, 0.002], [0.024, -0.05, -0.002], [0.025, -0.078, -0.004], [0.022, -0.094, -0.003]].map(([x, y, z], i) => ({
      p: [s * x, y, z], w: [0.012, 0.022, 0.027, 0.025, 0.015][i], t: 0.0042,
    })), { radial: 10, rings: 10, side: Z, tint: (c) => c.copy(cCoat).lerp(cDark, 0.35) });
    put(flap, leather, coat);
    const lu = leather.userData, out = s > 0 ? -Math.PI / 2 : Math.PI / 2; // angle of the leather's outer face
    const earHair = [[out, 1.45, s, 1], [-out, 1.2, -s, 0.75]].map(([face, spread, ox, k]) => hang((f, hem) => {
      const a = face + lerp(-spread, spread, f);
      return drape(lu, [0.06, 0.25, 0.5, 0.75, 0.94].map((u) => [u, a]), 0.0045, 0.045 * k * hem, Z, r, { flare: 0.12, wave: 0 });
    }, { cols: lowQ ? 6 : 12, rows: lowQ ? 8 : 12, lock: 3, out: new THREE.Vector3(ox, 0, 0), repeat: 3, thick: 0.004, ripple: 0.003, waveDir: Z, wave: 0.003 }));
    put(flap, merge(earHair), hair);
    ears.push(flap);
  }

  dog.traverse((o) => {
    if (o.isMesh && o.material !== glint) {
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

  // bind the skins in the rest pose
  dog.updateMatrixWorld(true);
  for (const m of skins) m.bind(skeleton);

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
      // turn round (as dogs do) so that, once curled up nose to tail, he faces out of the bed toward the room
      const want = 0.55 + Math.PI;
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

  let hopY = 0, prevHeading = st.heading, bend = 0, lastYaw = 0;
  const earSt = ears.map(() => ({ x: 0, z: 0, vx: 0, vz: 0 }));
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
    const S = st.sleep * L; // properly asleep only once he's down

    dog.position.set(st.pos.x, 0, st.pos.y);
    dog.rotation.y = st.heading;
    blob.position.set(st.pos.x, 0.006 + L * 0.05, st.pos.y);
    blob.rotation.y = st.heading;
    blob.material.opacity = 1 - L * 0.4;

    // legs: a trot while walking (paws stay flat on the ground, then flick up as they swing through), folded when lying
    for (const leg of legs) {
      const ph = st.phase + leg.phase;
      const swing = Math.sin(ph) * 0.42 * k;
      const lift = Math.max(0, Math.cos(ph)) * k;
      const hip = -swing, knee = leg.front ? -lift * 0.3 : lift * 0.5;
      const paw = -(hip + knee) + (leg.front ? lift * 1.5 : -lift * 0.9);
      leg.hip.rotation.x = lerp(hip, leg.fold[0], L);
      leg.hip.rotation.z = leg.front ? 0 : -leg.side * 0.3 * L; // hind legs fold in under him
      leg.knee.rotation.x = lerp(knee, leg.fold[1], L);
      leg.paw.rotation.x = lerp(paw, leg.fold[2], L);
    }
    hopY = st.hop > 0 ? Math.abs(Math.sin((1 - st.hop) * Math.PI * 2)) * 0.03 * st.hop : 0;
    st.hop = Math.max(0, st.hop - dt * 2.2);
    body.position.y = Math.abs(Math.sin(st.phase)) * 0.006 * k - L * 0.024 + hopY;
    body.position.x = -S * 0.065; // curled up (both ends come round to his left), he shifts over to stay in the middle of the bed
    body.rotation.z = Math.sin(st.phase) * 0.025 * k;

    // spine: bends into turns, wiggles from the hips when he's happy, curls up nose-to-tail asleep
    const dh = Math.atan2(Math.sin(st.heading - prevHeading), Math.cos(st.heading - prevHeading));
    prevHeading = st.heading;
    bend = lerp(bend, clamp((dh / Math.max(dt, 1e-3)) * 0.1, -0.2, 0.2) * (1 - L), 1 - Math.exp(-dt * 6));
    const curl = L * 0.12 + S * 0.46;
    const wagSpeed = 3 + ex * 11 + k * 3;
    const wag = Math.sin(t * wagSpeed);
    const fore = bend * 0.5 + curl, aft = -bend * 0.4 - curl;
    bone.ribs.rotation.y = fore * 0.8;
    bone.chest.rotation.y = fore;
    bone.loin.rotation.y = aft * 0.8 - wag * 0.05 * ex;
    bone.rump.rotation.y = aft - wag * 0.09 * ex;
    // breathing: the ribcage swells; the chest bone undoes it so the head and front legs stay put
    const br = Math.sin(t * (st.mode === 'lie' ? 1.4 : 2.4 + ex * 4)) * (0.014 + ex * 0.01);
    bone.ribs.scale.set(1 + br * 0.7, 1 + br, 1);
    bone.chest.scale.set(1 / (1 + br * 0.7), 1 / (1 + br), 1);

    // tail: a wave runs down it as it wags; carried higher when happy, wrapped round him in bed
    const amp = (0.16 + ex * 0.4 + k * 0.1) * (1 - L * 0.8);
    const lift = lerp(0.08 + ex * 0.3 + k * 0.08, -0.3, L);
    tailBones.forEach((b, i) => {
      b.rotation.y = Math.sin(t * wagSpeed - i * 0.7) * amp * (0.6 + i * 0.25) - curl * 1.3;
      b.rotation.x = i ? lift * 0.25 : lift;
    });

    // head: looks at you when standing, forward when trotting, nose down when sniffing, resting when lying
    const lookYaw = walking ? Math.sin(t * 0.7) * 0.15 : gaze.yaw;
    const lookPitch = walking ? 0.12 : st.sniff > 0 ? 0.7 + Math.sin(t * 9) * 0.05 : gaze.pitch;
    st.gazeYaw = lerp(st.gazeYaw, lerp(lookYaw, 0.25, L), 1 - Math.exp(-dt * 4));
    st.gazePitch = lerp(st.gazePitch, lerp(lookPitch, 0.18, L), 1 - Math.exp(-dt * 4));
    const gy = st.gazeYaw, gp = st.gazePitch;
    const nod = Math.sin(st.phase * 2) * 0.03 * k;
    // the neck takes part of every turn of the head; asleep, it lays his chin down along his flank
    bone.neck0.rotation.set(gp * 0.3 + S * 0.5, gy * 0.25 + curl * 1.1, 0);
    bone.neck1.rotation.set(gp * 0.2 + S * 0.35, gy * 0.25 + curl * 1.1, 0);
    head.rotation.set(0.08 + gp * 0.5 + nod - S * 0.75, gy * 0.5 + curl * 1.3, Math.sin(t * 6) * 0.14 * ex + 0.04 * (1 - S) + S * 0.3, 'YXZ');

    // blinking, and sleepy eyes on the bed
    st.nextBlink -= dt;
    if (st.nextBlink < 0) {
      st.blink = 0.13;
      st.nextBlink = 2.5 + Math.random() * 4;
    }
    st.blink = Math.max(0, st.blink - dt);
    const open = st.blink > 0 ? 0 : 1 - st.sleep;
    lids.forEach((l) => (l.rotation.x = lerp(1.35, -0.6, open)));

    // ears: hang under gravity whatever the head does, bounce with the trot, lift when he's excited, swing after quick turns
    const yawAll = bone.neck0.rotation.y + bone.neck1.rotation.y + head.rotation.y;
    const yawVel = clamp((yawAll - lastYaw) / Math.max(dt, 1e-3), -6, 6);
    lastYaw = yawAll;
    const pitchAll = bone.neck0.rotation.x + bone.neck1.rotation.x + head.rotation.x;
    const step = Math.min(dt, 0.05);
    ears.forEach((e, i) => {
      const s = i ? 1 : -1, es = earSt[i];
      const tz = s * (0.04 + ex * 0.3 + Math.abs(Math.sin(st.phase)) * 0.1 * k + S * 0.3) - head.rotation.z;
      const tx = -pitchAll * 0.85 - ex * 0.12 + Math.sin(st.phase * 2 + 1) * 0.08 * k;
      es.vz += ((tz - es.z) * 90 - es.vz * 8 - yawVel * 6) * step;
      es.vx += ((tx - es.x) * 90 - es.vx * 8) * step;
      es.z += es.vz * step;
      es.x += es.vx * step;
      e.rotation.set(es.x, 0, es.z);
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
