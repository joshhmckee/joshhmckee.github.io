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

const boxCache = new Map();
/** Shared unit-ish box geometry cache keyed by dimensions. */
export function boxGeo(w, h, d) {
  const k = `${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}`;
  let g = boxCache.get(k);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
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
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, !!opts.open, opts.thetaStart || 0, opts.thetaLength || TAU);
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
    const key = `${m.uuid}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}`;
    if (!groups.has(key)) groups.set(key, { material: m, cast: o.castShadow, receive: o.receiveShadow, items: [] });
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
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    for (const o of g.items) o.parent && o.parent.remove(o);
  }
  return root;
}

/** Mark a subtree as dynamic (excluded from static merging). */
export function dynamic(obj) {
  obj.userData.dynamic = true;
  return obj;
}
