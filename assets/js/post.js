import * as THREE from '../vendor/three.module.min.js';
import { retro, retroUniforms } from './util.js';
import { SHAFT_GLSL } from './effects.js';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT = /* glsl */ `
uniform sampler2D tScene;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tScene, vUv + uTexel * vec2(-0.5, -0.5)).rgb
         + texture2D(tScene, vUv + uTexel * vec2( 0.5, -0.5)).rgb
         + texture2D(tScene, vUv + uTexel * vec2(-0.5,  0.5)).rgb
         + texture2D(tScene, vUv + uTexel * vec2( 0.5,  0.5)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float k = max(l - uThreshold, 0.0) / max(l, 1e-4);
  gl_FragColor = vec4(min(c * k, vec3(8.0)), 1.0);
}`;

const BLUR = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tInput, vUv).rgb * 0.227027;
  c += texture2D(tInput, vUv + uDir * 1.3846).rgb * 0.3162162;
  c += texture2D(tInput, vUv - uDir * 1.3846).rgb * 0.3162162;
  c += texture2D(tInput, vUv + uDir * 3.2308).rgb * 0.0702703;
  c += texture2D(tInput, vUv - uDir * 3.2308).rgb * 0.0702703;
  gl_FragColor = vec4(c, 1.0);
}`;

/** Low-res composite: volumetric sun shafts, bloom, tone mapping, grading, hover outline, dithering. */
const COMPOSITE = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform sampler2D tMask;
uniform sampler2D tShaft;
uniform vec2 uRes;
uniform vec3 uSunColor;
uniform float uShaft;
uniform float uTime;
uniform float uExposure;
uniform float uBloom;
uniform float uHover;
uniform vec3 uOutline;
uniform float uLevels;
uniform float uDither;
uniform float uSat;
uniform float uFade;
varying vec2 vUv;

float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec3 col = texture2D(tScene, vUv).rgb;

  col += uSunColor * texture2D(tShaft, vUv).r * uShaft;

  col += texture2D(tBloom, vUv).rgb * uBloom;

  // --- tone map & grade
  col = aces(col * uExposure);
  col = pow(col, vec3(1.0 / 2.2));
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uSat);
  col += (1.0 - lum) * (1.0 - lum) * vec3(0.012, 0.0, 0.035); // violet shadows
  col = (col - 0.5) * 1.05 + 0.5;

  // --- hover outline (one low-res pixel, pulsing)
  if (uHover > 0.0) {
    vec2 px = 1.0 / uRes;
    float m = texture2D(tMask, vUv).r;
    float n = max(max(texture2D(tMask, vUv + vec2(px.x, 0.0)).r, texture2D(tMask, vUv - vec2(px.x, 0.0)).r),
                  max(texture2D(tMask, vUv + vec2(0.0, px.y)).r, texture2D(tMask, vUv - vec2(0.0, px.y)).r));
    float edge = clamp(n - m, 0.0, 1.0);
    col = mix(col, uOutline, edge * uHover);
    col += m * uHover * 0.07;
  }

  // --- ordered dither into a limited palette
  float th = bayer4(gl_FragCoord.xy) - 0.5;
  col = floor(col * uLevels + 0.5 + th * uDither) / uLevels;
  gl_FragColor = vec4(clamp(col * uFade, 0.0, 1.0), 1.0);
}`;

/** Volumetric light through the blinds, ray-marched at half the low resolution. */
const SHAFTS = /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uTime;
varying vec2 vUv;
${SHAFT_GLSL}
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
vec3 worldFromDepth(vec2 uv, float depth) {
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  v /= v.w;
  return (uCamWorld * v).xyz;
}
void main() {
  float depth = texture2D(tDepth, vUv).r;
  vec3 pEnd = worldFromDepth(vUv, depth);
  vec3 rd = pEnd - uCamPos;
  float L = min(length(rd), 9.0);
  rd = normalize(rd);
  float dt = L / float(STEPS);
  float start = bayer4(gl_FragCoord.xy) * dt;
  float acc = 0.0;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = uCamPos + rd * (start + float(i) * dt);
    float density = 0.85 + 0.15 * sin(p.x * 3.0 + uTime * 0.21) * sin(p.y * 2.5 - uTime * 0.17) * sin(p.z * 2.0 + uTime * 0.13);
    acc += shaftAt(p) * density;
  }
  acc *= dt;
  float mu = max(dot(rd, uSunDir), 0.0);
  acc *= 0.3 + 1.4 * pow(mu, 5.0);
  gl_FragColor = vec4(acc, acc, acc, 1.0);
}`;

/** Full-res pass: nearest upscale + CRT treatment. */
const CRT = /* glsl */ `
uniform sampler2D tLow;
uniform vec2 uLowRes;
uniform vec2 uScreen;
uniform float uScan;
uniform float uMask;
uniform float uCurve;
uniform float uVig;
uniform float uTime;
uniform float uNoise;
uniform float uAberr;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 uv = gl_FragCoord.xy / uScreen;
  vec2 cc = uv - 0.5;
  vec2 duv = 0.5 + cc * (1.0 + uCurve * dot(cc, cc));
  if (duv.x < 0.0 || duv.y < 0.0 || duv.x > 1.0 || duv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 lp = duv * uLowRes;
  vec2 cell = floor(lp);
  vec2 f = lp - cell;
  vec3 c = texture2D(tLow, (cell + 0.5) / uLowRes).rgb;
  float ab = uAberr * length(cc) * 2.0;
  if (ab > 0.001) {
    c.r = mix(c.r, texture2D(tLow, (cell + vec2(-1.0, 0.0) + 0.5) / uLowRes).r, ab);
    c.b = mix(c.b, texture2D(tLow, (cell + vec2(1.0, 0.0) + 0.5) / uLowRes).b, ab);
  }
  float s = abs(f.y - 0.5) * 2.0;
  c *= 1.0 - uScan * s * s;
  float mx = mod(floor(gl_FragCoord.x), 3.0);
  vec3 mask = vec3(mx < 1.0 ? 1.0 : 1.0 - uMask, (mx >= 1.0 && mx < 2.0) ? 1.0 : 1.0 - uMask, mx >= 2.0 ? 1.0 : 1.0 - uMask);
  c *= mask * (1.0 + uMask * 0.6);
  float vig = 16.0 * duv.x * duv.y * (1.0 - duv.x) * (1.0 - duv.y);
  c *= mix(1.0, pow(vig, 0.22), uVig);
  float edge = min(min(duv.x, 1.0 - duv.x), min(duv.y, 1.0 - duv.y));
  c *= smoothstep(0.0, 0.004, edge);
  c += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * uNoise;
  c *= 1.0 + 0.012 * sin(uTime * 110.0);
  gl_FragColor = vec4(c, 1.0);
}`;

export class RetroPipeline {
  constructor(renderer, scene, camera, { quality, shaft }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    this.shaftUniforms = shaft;

    const nearest = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false };
    // HDR targets where the GPU can render to them; plain 8-bit otherwise
    const ext = renderer.extensions;
    const hdr = ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float');
    const type = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, { ...nearest, type, depthBuffer: true });
    this.rtScene.depthTexture = new THREE.DepthTexture(4, 4);
    this.rtScene.depthTexture.type = THREE.UnsignedIntType;
    this.rtMask = new THREE.WebGLRenderTarget(4, 4, { ...nearest, depthBuffer: true });
    const linear = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, type, depthBuffer: false };
    this.rtBloomA = new THREE.WebGLRenderTarget(4, 4, linear);
    this.rtBloomB = new THREE.WebGLRenderTarget(4, 4, linear);
    this.rtLow = new THREE.WebGLRenderTarget(4, 4, { ...nearest, depthBuffer: false });
    this.rtShaftA = new THREE.WebGLRenderTarget(4, 4, linear);
    this.rtShaftB = new THREE.WebGLRenderTarget(4, 4, linear);

    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(tri, null);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);

    this.brightMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: BRIGHT,
      uniforms: { tScene: { value: this.rtScene.texture }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.9 } },
      depthTest: false, depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: BLUR,
      uniforms: { tInput: { value: null }, uDir: { value: new THREE.Vector2() } },
      depthTest: false, depthWrite: false,
    });
    this.shaftMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: SHAFTS,
      defines: { STEPS: quality.shaftSteps },
      uniforms: {
        ...shaft,
        tDepth: { value: this.rtScene.depthTexture },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uTime: { value: 0 },
      },
      depthTest: false, depthWrite: false,
    });
    this.compMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: COMPOSITE,
      uniforms: {
        tScene: { value: this.rtScene.texture },
        tBloom: { value: this.rtBloomA.texture },
        tMask: { value: this.rtMask.texture },
        tShaft: { value: this.rtShaftA.texture },
        uRes: { value: new THREE.Vector2() },
        uSunColor: { value: new THREE.Color('#ffb36e') },
        uShaft: { value: 0.6 },
        uTime: { value: 0 },
        uExposure: { value: 1.3 },
        uBloom: { value: 0.55 },
        uHover: { value: 0 },
        uOutline: { value: new THREE.Color('#fff1b8') },
        uLevels: { value: 28 },
        uDither: { value: 1.0 },
        uSat: { value: 1.08 },
        uFade: { value: 1 },
      },
      depthTest: false, depthWrite: false,
    });
    this.crtMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: CRT,
      uniforms: {
        tLow: { value: this.rtLow.texture },
        uLowRes: { value: new THREE.Vector2() },
        uScreen: { value: new THREE.Vector2() },
        uScan: { value: 0.32 },
        uMask: { value: 0.1 },
        uCurve: { value: 0.045 },
        uVig: { value: 0.55 },
        uTime: { value: 0 },
        uNoise: { value: 0.025 },
        uAberr: { value: 0.18 },
      },
      depthTest: false, depthWrite: false,
    });
    this.maskMat = retro(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.hover = [];
    this.hoverAmount = 0;
    this.crtOn = true;
  }

  setSize(cssW, cssH, dpr) {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cssW, cssH, false);
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const devW = buf.x, devH = buf.y;
    const scale = Math.max(1, Math.round(devH / this.quality.lowH));
    const lw = Math.ceil(devW / scale), lh = Math.ceil(devH / scale);
    this.scale = scale;
    this.low = new THREE.Vector2(lw, lh);
    this.rtScene.setSize(lw, lh);
    this.rtMask.setSize(lw, lh);
    this.rtLow.setSize(lw, lh);
    const bw = Math.max(1, Math.ceil(lw / 2)), bh = Math.max(1, Math.ceil(lh / 2));
    this.rtBloomA.setSize(bw, bh);
    this.rtBloomB.setSize(bw, bh);
    this.bloomSize = new THREE.Vector2(bw, bh);
    this.rtShaftA.setSize(bw, bh);
    this.rtShaftB.setSize(bw, bh);
    this.compMat.uniforms.uRes.value.set(lw, lh);
    this.crtMat.uniforms.uLowRes.value.set(lw, lh);
    // each low-res pixel covers exactly scale x scale device pixels
    this.crtMat.uniforms.uScreen.value.set(lw * scale, lh * scale);
    this.devSize = new THREE.Vector2(devW, devH);
    retroUniforms.uSnap.value.set(lw / 2, lh / 2);
    this.camera.aspect = lw / lh;
    this.camera.updateProjectionMatrix();
  }

  /** Map a CSS-pixel pointer to NDC, applying the same CRT curvature the image is drawn with. */
  pointerToNdc(x, y, cssW, cssH, out = new THREE.Vector2()) {
    const S = this.crtMat.uniforms.uScreen.value;
    let u = (x / cssW) * (this.devSize.x / S.x);
    let v = (1 - y / cssH) * (this.devSize.y / S.y);
    const k = this.crtMat.uniforms.uCurve.value;
    if (k > 0) {
      const cx = u - 0.5, cy = v - 0.5;
      const f = 1 + k * (cx * cx + cy * cy);
      u = 0.5 + cx * f;
      v = 0.5 + cy * f;
    }
    return out.set(u * 2 - 1, v * 2 - 1);
  }

  /** Inverse of pointerToNdc (approximately): world point -> CSS pixel, used to place HTML over 3D objects. */
  ndcToCss(ndc, cssW, cssH, out = new THREE.Vector2()) {
    const S = this.crtMat.uniforms.uScreen.value;
    let u = (ndc.x + 1) / 2, v = (ndc.y + 1) / 2;
    const k = this.crtMat.uniforms.uCurve.value;
    if (k > 0) {
      // invert duv = 0.5 + c * (1 + k|c|^2) with two fixed-point iterations
      const dx = u - 0.5, dy = v - 0.5;
      let cx = dx, cy = dy;
      for (let i = 0; i < 3; i++) {
        const f = 1 + k * (cx * cx + cy * cy);
        cx = dx / f;
        cy = dy / f;
      }
      u = 0.5 + cx;
      v = 0.5 + cy;
    }
    return out.set((u * S.x / this.devSize.x) * cssW, (1 - (v * S.y) / this.devSize.y) * cssH);
  }

  setCRT(on) {
    this.crtOn = on;
    const u = this.crtMat.uniforms;
    u.uScan.value = on ? 0.32 : 0;
    u.uMask.value = on ? 0.1 : 0;
    u.uCurve.value = on ? 0.045 : 0;
    u.uAberr.value = on ? 0.18 : 0;
    u.uNoise.value = on ? 0.025 : 0;
    u.uVig.value = on ? 0.55 : 0.3;
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(time, dt) {
    const r = this.renderer;
    const cam = this.camera;
    if (this.raw) {
      // debug: straight render, no retro treatment
      r.setRenderTarget(null);
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.render(this.scene, cam);
      return;
    }
    // 1. scene at low resolution
    r.setRenderTarget(this.rtScene);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.scene, cam);

    // 2. hover mask
    const target = this.hover.length ? 1 : 0;
    this.hoverAmount += (target - this.hoverAmount) * Math.min(1, dt * 12);
    if (this.hover.length) {
      for (const m of this.hover) m.layers.enable(2);
      cam.layers.set(2);
      const ov = this.scene.overrideMaterial;
      this.scene.overrideMaterial = this.maskMat;
      r.setRenderTarget(this.rtMask);
      r.setClearColor(0x000000, 1);
      r.clear();
      r.render(this.scene, cam);
      this.scene.overrideMaterial = ov;
      cam.layers.set(0);
      for (const m of this.hover) m.layers.disable(2);
    }

    // 3. bloom
    this.brightMat.uniforms.uTexel.value.set(1 / this.low.x, 1 / this.low.y);
    this.pass(this.brightMat, this.rtBloomA);
    const passes = this.quality.bloomPasses;
    for (let i = 0; i < passes; i++) {
      const s = 1 + i;
      this.blurMat.uniforms.tInput.value = this.rtBloomA.texture;
      this.blurMat.uniforms.uDir.value.set(s / this.bloomSize.x, 0);
      this.pass(this.blurMat, this.rtBloomB);
      this.blurMat.uniforms.tInput.value = this.rtBloomB.texture;
      this.blurMat.uniforms.uDir.value.set(0, s / this.bloomSize.y);
      this.pass(this.blurMat, this.rtBloomA);
    }

    // 4. volumetric shafts at half res, softened with one blur
    const u = this.compMat.uniforms;
    if (u.uShaft.value > 0) {
      const su = this.shaftMat.uniforms;
      su.uProjInv.value.copy(cam.projectionMatrixInverse);
      su.uCamWorld.value.copy(cam.matrixWorld);
      su.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
      su.uTime.value = time;
      this.pass(this.shaftMat, this.rtShaftA);
      this.blurMat.uniforms.tInput.value = this.rtShaftA.texture;
      this.blurMat.uniforms.uDir.value.set(0.7 / this.bloomSize.x, 0);
      this.pass(this.blurMat, this.rtShaftB);
      this.blurMat.uniforms.tInput.value = this.rtShaftB.texture;
      this.blurMat.uniforms.uDir.value.set(0, 0.7 / this.bloomSize.y);
      this.pass(this.blurMat, this.rtShaftA);
    }

    // 5. composite at low res
    u.uTime.value = time;
    u.uHover.value = this.hoverAmount > 0.01 && this.hover.length ? this.hoverAmount * (0.78 + 0.22 * Math.sin(time * 6)) : 0;
    this.pass(this.compMat, this.rtLow);

    // 6. CRT upscale to the screen
    this.crtMat.uniforms.uTime.value = time;
    this.pass(this.crtMat, null);
  }
}

