import * as THREE from '../vendor/three.module.min.js';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/** Deterministic PRNG (mulberry32) so the room looks the same on every visit. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (a, b) => a + (b - a) * next();
  next.int = (a, b) => Math.floor(a + (b - a + 1) * next());
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.chance = (p) => next() < p;
  return next;
}

/* ------------------------------------------------------------------ */
/* Retro vertex snapping (PS1-style wobble) shared by every material.  */
/* ------------------------------------------------------------------ */

export const retroUniforms = {
  uSnap: { value: new THREE.Vector2(320, 180) },
};

export function retro(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnap = retroUniforms.uSnap;
    shader.vertexShader = 'uniform vec2 uSnap;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      if (gl_Position.w > 0.0) {
        gl_Position.xy = floor(gl_Position.xy / gl_Position.w * uSnap + 0.5) / uSnap * gl_Position.w;
      }`
    );
  };
  material.customProgramCacheKey = () => 'retro-snap';
  return material;
}

export const std = (params) => retro(new THREE.MeshStandardMaterial(params));
export const basic = (params) => retro(new THREE.MeshBasicMaterial(params));

/* ------------------------------------------------------------------ */
/* Mesh helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Create a mesh, place it and add it to a parent.
 * opts: { r: [rx, ry, rz], s: [sx, sy, sz], cast, receive, name }
 */
export function put(parent, geometry, material, pos = [0, 0, 0], opts = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(pos[0], pos[1], pos[2]);
  if (opts.r) m.rotation.set(opts.r[0], opts.r[1], opts.r[2], opts.order || 'XYZ');
  if (opts.s) m.scale.set(opts.s[0], opts.s[1], opts.s[2]);
  m.castShadow = opts.cast !== false;
  m.receiveShadow = opts.receive !== false;
  if (opts.name) m.name = opts.name;
  parent.add(m);
  return m;
}

/**
 * A box with softly rounded edges: real furniture catches a thin highlight along every edge.
 * Built from a 3x3x3 box whose inner grid lines are pulled out to the bevel, then the edge
 * and corner vertices are swung onto the rounding.
 */
export function roundedBox(w, h, d, radius) {
  const g = new THREE.BoxGeometry(1, 1, 1, 3, 3, 3);
  const half = [w / 2, h / 2, d / 2];
  const rr = Math.min(radius, half[0] * 0.5, half[1] * 0.5, half[2] * 0.5);
  const p = g.attributes.position, n = g.attributes.normal;
  const v = [0, 0, 0], q = [0, 0, 0], dir = [0, 0, 0];
  for (let i = 0; i < p.count; i++) {
    v[0] = p.getX(i); v[1] = p.getY(i); v[2] = p.getZ(i);
    for (let a = 0; a < 3; a++) {
      // grid at -0.5, -1/6, 1/6, 0.5 -> -h, -h+r, h-r, h
      const t = v[a];
      v[a] = Math.abs(t) > 0.4 ? Math.sign(t) * half[a] : Math.sign(t) * (half[a] - rr);
      q[a] = clamp(v[a], -(half[a] - rr), half[a] - rr);
      dir[a] = v[a] - q[a];
    }
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    const axes = (Math.abs(dir[0]) > 1e-6) + (Math.abs(dir[1]) > 1e-6) + (Math.abs(dir[2]) > 1e-6);
    if (axes >= 2) {
      for (let a = 0; a < 3; a++) v[a] = q[a] + (dir[a] / len) * rr;
      n.setXYZ(i, dir[0] / len, dir[1] / len, dir[2] / len);
    }
    p.setXYZ(i, v[0], v[1], v[2]);
  }
  return g;
}

const boxCache = new Map();
/** Shared box geometry cache keyed by dimensions (rounded edges unless the box is tiny). */
export function boxGeo(w, h, d) {
  const k = `${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}`;
  let g = boxCache.get(k);
  if (!g) {
    const r = Math.min(0.006, 0.3 * Math.min(w, h, d));
    g = r > 0.0015 ? roundedBox(w, h, d, r) : new THREE.BoxGeometry(w, h, d);
    boxCache.set(k, g);
  }
  return g;
}

/** Box positioned by its centre. */
export function box(parent, w, h, d, material, pos, opts) {
  return put(parent, boxGeo(w, h, d), material, pos, opts);
}

/** Box positioned by its bottom-centre (handy for furniture). */
export function boxB(parent, w, h, d, material, [x, y, z], opts) {
  return put(parent, boxGeo(w, h, d), material, [x, y + h / 2, z], opts);
}

export function cyl(parent, rTop, rBot, h, seg, material, pos, opts = {}) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, Math.max(seg * 2, 12), 1, !!opts.open, opts.thetaStart || 0, opts.thetaLength || TAU);
  return put(parent, g, material, pos, opts);
}

/** Box geometry whose UVs are scaled to world size, so textures tile at a constant density. */
export function tiledBox(w, h, d, density = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    let su, sv;
    if (nx > 0.5) { su = d; sv = h; } else if (ny > 0.5) { su = w; sv = d; } else { su = w; sv = h; }
    uv.setXY(i, uv.getX(i) * su * density, uv.getY(i) * sv * density);
  }
  return g;
}

/* ------------------------------------------------------------------ */
/* Static merge: collapse non-interactive meshes into one mesh per     */
/* material so the whole room costs a few dozen draw calls.            */
/* ------------------------------------------------------------------ */

export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const victims = [];

  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    let p = o;
    while (p) {
      if (p.userData.dynamic) return;
      p = p.parent;
    }
    const m = o.material;
    if (Array.isArray(m)) return;
    const key = `${m.uuid}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${o.layers.mask}`;
    if (!groups.has(key)) groups.set(key, { material: m, cast: o.castShadow, receive: o.receiveShadow, layers: o.layers.mask, items: [] });
    groups.get(key).items.push(o);
    victims.push(o);
  });

  for (const g of groups.values()) {
    if (g.items.length < 2) continue;
    let total = 0;
    const parts = [];
    for (const o of g.items) {
      let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      if (!geo.attributes.uv) {
        geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      }
      parts.push(geo);
      total += geo.attributes.position.count;
    }
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const uvs = new Float32Array(total * 2);
    let off = 0;
    for (const geo of parts) {
      const c = geo.attributes.position.count;
      pos.set(geo.attributes.position.array, off * 3);
      if (geo.attributes.normal) nor.set(geo.attributes.normal.array, off * 3);
      uvs.set(geo.attributes.uv.array.subarray(0, c * 2), off * 2);
      off += c;
      geo.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, g.material);
    mesh.castShadow = g.cast;
    mesh.receiveShadow = g.receive;
    mesh.layers.mask = g.layers;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    for (const o of g.items) o.parent && o.parent.remove(o);
  }
  return root;
}

/**
 * Merge the meshes inside one movable group into a mesh per material, in the group's own space,
 * so something like the chair still moves as a whole but draws in a few calls instead of dozens.
 */
export function mergeGroup(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const byMat = new Map();
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || !o.material.visible) return;
    const key = `${o.material.uuid}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}`;
    if (!byMat.has(key)) byMat.set(key, []);
    byMat.get(key).push(o);
  });
  const m = new THREE.Matrix4();
  for (const items of byMat.values()) {
    if (items.length < 2) continue;
    const parts = items.map((o) => {
      const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      geo.applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld));
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      return geo;
    });
    const total = parts.reduce((a, g) => a + g.attributes.position.count, 0);
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uvs = new Float32Array(total * 2);
    let off = 0;
    for (const geo of parts) {
      const c = geo.attributes.position.count;
      pos.set(geo.attributes.position.array, off * 3);
      if (geo.attributes.normal) nor.set(geo.attributes.normal.array, off * 3);
      uvs.set(geo.attributes.uv.array.subarray(0, c * 2), off * 2);
      off += c;
      geo.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, items[0].material);
    mesh.castShadow = items[0].castShadow;
    mesh.receiveShadow = items[0].receiveShadow;
    group.add(mesh);
    for (const o of items) o.parent.remove(o);
  }
  return group;
}

/** Mark a subtree as dynamic (excluded from static merging). */
export function dynamic(obj) {
  obj.userData.dynamic = true;
  return obj;
}
