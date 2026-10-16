import * as THREE from '../vendor/three.module.min.js';
import { ROOM, WIN, BLINDS, SUN_DIR } from './layout.js';
import { rng } from './util.js';

/** Shared GLSL: is a world point inside a sunbeam that made it through the blinds? */
export const SHAFT_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec4 uWin;      // x0, x1, y0, y1 of the blinds opening
uniform float uWinZ;
uniform float uPitch;
uniform float uOpen;    // fraction of each slat pitch that lets light through
float shaftAt(vec3 p) {
  float t = (uWinZ - p.z) / uSunDir.z;
  if (t < 0.0) return 0.0;
  vec3 w = p + uSunDir * t;
  float inside = step(uWin.x, w.x) * step(w.x, uWin.y) * step(uWin.z, w.y) * step(w.y, uWin.w);
  float f = fract((uWin.w - w.y) / uPitch);
  float d = abs(f - 0.5);
  float edge = (1.0 - uOpen) * 0.5;
  // beams are strongest close to the window and fade as they travel into the room
  return inside * smoothstep(edge - 0.02, edge + 0.02, d) * exp(-t * 0.3);
}
`;

export function shaftUniforms() {
  return {
    uSunDir: { value: SUN_DIR.clone() },
    uWin: { value: new THREE.Vector4(WIN.x0 + 0.07, WIN.x1 - 0.07, BLINDS.bottom, BLINDS.top) },
    uWinZ: { value: BLINDS.z },
    uPitch: { value: BLINDS.pitch },
    uOpen: { value: 0.33 },
  };
}

export function buildEffects(ctx, shared) {
  const { scene } = ctx;
  const r = rng(404);

  /* ---------------- dust motes ---------------- */
  const N = ctx.quality.dust;
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  const down = SUN_DIR.clone().negate();
  let i = 0;
  while (i < N) {
    let p;
    if (i < N * 0.8) {
      p = new THREE.Vector3(r.range(WIN.x0, WIN.x1), r.range(WIN.y0, WIN.y1), BLINDS.z + 0.05).addScaledVector(down, r.range(0.1, 7.5));
      p.x += r.range(-0.3, 0.3);
      p.y += r.range(-0.3, 0.3);
    } else {
      p = new THREE.Vector3(r.range(ROOM.x0, ROOM.x1), r.range(0.2, 2.8), r.range(ROOM.z0, 2.0));
    }
    if (p.x < ROOM.x0 + 0.1 || p.x > ROOM.x1 - 0.1 || p.y < 0.05 || p.y > ROOM.h - 0.05 || p.z < ROOM.z0 + 0.05 || p.z > ROOM.z1 - 0.1) continue;
    pos.set([p.x, p.y, p.z], i * 3);
    seed[i] = r();
    i++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const dustMat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uTime: { value: 0 }, uColor: { value: new THREE.Color('#ffd6a0') }, uPx: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float uTime;
      uniform float uPx;
      varying float vLit;
      ${SHAFT_GLSL}
      void main() {
        vec3 p = position;
        float t = uTime * (0.05 + seed * 0.06) + seed * 50.0;
        p += vec3(sin(t * 1.3 + seed * 9.0), sin(t * 0.7 + seed * 3.0) - 0.4 * fract(t * 0.05), cos(t * 1.1 + seed * 5.0)) * 0.06;
        vLit = shaftAt(p) * (0.6 + 0.4 * sin(uTime * (1.0 + seed * 3.0) + seed * 20.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPx * (seed > 0.85 ? 2.0 : 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vLit;
      void main() {
        gl_FragColor = vec4(uColor * (0.04 + vLit * 2.4), 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const dust = new THREE.Points(g, dustMat);
  dust.frustumCulled = false;
  dust.name = 'dust';
  scene.add(dust);

  /* ---------------- coffee steam ---------------- */
  const S = 18;
  const sp = new Float32Array(S * 3);
  const ss = new Float32Array(S);
  for (let k = 0; k < S; k++) {
    sp.set([0, 0, 0], k * 3);
    ss[k] = k / S;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sg.setAttribute('seed', new THREE.BufferAttribute(ss, 1));
  const steamMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOrigin: { value: ctx.anchors.mug.clone() }, uPx: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float uTime;
      uniform vec3 uOrigin;
      uniform float uPx;
      varying float vA;
      void main() {
        float life = fract(uTime * 0.18 + seed);
        vec3 p = uOrigin + vec3(sin(life * 6.0 + seed * 20.0) * 0.02 * life, life * 0.28, cos(life * 5.0 + seed * 13.0) * 0.02 * life);
        vA = sin(life * 3.14159) * (1.0 - life) * 0.55;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPx * (1.0 + life * 2.5);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() { gl_FragColor = vec4(vec3(0.95, 0.9, 0.82) * vA, 1.0); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const steam = new THREE.Points(sg, steamMat);
  steam.frustumCulled = false;
  scene.add(steam);

  return { dust, dustMat, steam, steamMat };
}
