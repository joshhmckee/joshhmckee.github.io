import * as THREE from '../vendor/three.module.min.js';
import { retroUniforms } from './util.js';
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

/** Screen-space ambient occlusion: grounds objects and darkens corners and crevices. */
const SSAO = /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform mat4 uProj;
uniform vec2 uAspect;
uniform float uRadius;
uniform float uIntensity;
varying vec2 vUv;
vec3 viewPos(vec2 uv) {
  float d = texture2D(tDepth, uv).r;
  vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  float d = texture2D(tDepth, vUv).r;
  if (d >= 0.9999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv);
  vec3 N = normalize(cross(dFdx(P), dFdy(P)));
  float rs = min(uRadius * uProj[1][1] / -P.z * 0.5, 0.12);
  float ang = hash(gl_FragCoord.xy) * 6.2831853;
  float sum = 0.0;
  for (int i = 0; i < 14; i++) {
    float t = (float(i) + 0.5) / 14.0;
    float a = ang + t * 6.2831853 * 2.618;
    vec2 off = vec2(cos(a), sin(a)) * sqrt(t) * rs * uAspect;
    vec3 v = viewPos(vUv + off) - P;
    float vl = length(v);
    sum += max(0.0, dot(N, v / max(vl, 1e-4)) - 0.12) * smoothstep(uRadius, uRadius * 0.25, vl);
  }
  float ao = clamp(1.0 - uIntensity * sum / 14.0, 0.0, 1.0);
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}`;

/** Composite: AO, sun shafts, bloom, tone mapping, grading, hover outline, fine dither against banding. */
const COMPOSITE = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tMask;
uniform sampler2D tShaft;
uniform sampler2D tAO;
uniform vec2 uRes;
uniform vec3 uSunColor;
uniform float uShaft;
uniform float uAO;
uniform float uExposure;
uniform float uBloom;
uniform float uHover;
uniform float uOutlineW;
uniform vec3 uOutline;
uniform float uSat;
varying vec2 vUv;

float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec3 col = texture2D(tScene, vUv).rgb;
  col *= mix(1.0, texture2D(tAO, vUv).r, uAO);
  col += uSunColor * texture2D(tShaft, vUv).r * uShaft;
  col += texture2D(tBloom, vUv).rgb * uBloom;

  col = aces(col * uExposure);
  col = pow(col, vec3(1.0 / 2.2));
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uSat);
  col += (1.0 - lum) * (1.0 - lum) * vec3(0.008, 0.0, 0.02); // a touch of violet in the shadows

  if (uHover > 0.0) {
    vec2 px = uOutlineW / uRes;
    float m = texture2D(tMask, vUv).r;
    float n = max(max(texture2D(tMask, vUv + vec2(px.x, 0.0)).r, texture2D(tMask, vUv - vec2(px.x, 0.0)).r),
                  max(texture2D(tMask, vUv + vec2(0.0, px.y)).r, texture2D(tMask, vUv - vec2(0.0, px.y)).r));
    col = mix(col, uOutline, clamp(n - m, 0.0, 1.0) * uHover);
    col += m * uHover * 0.05;
  }

  // invisible 8-bit dither so gradients don't band
  col += (bayer4(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/** Volumetric light through the blinds, ray-marched at half resolution. */
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

/** Final pass: FXAA edge smoothing, then a gentle vignette, film grain and lens fringing. */
const PRESENT = /* glsl */ `
uniform sampler2D tLow;
uniform vec2 uScreen;
uniform vec2 uTexel;
uniform float uVig;
uniform float uTime;
uniform float uNoise;
uniform float uAberr;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 fxaa(vec2 uv, vec2 rcp) {
  const vec3 L = vec3(0.299, 0.587, 0.114);
  vec3 nw = texture2D(tLow, uv + vec2(-1.0, -1.0) * rcp).rgb;
  vec3 ne = texture2D(tLow, uv + vec2( 1.0, -1.0) * rcp).rgb;
  vec3 sw = texture2D(tLow, uv + vec2(-1.0,  1.0) * rcp).rgb;
  vec3 se = texture2D(tLow, uv + vec2( 1.0,  1.0) * rcp).rgb;
  vec3 m = texture2D(tLow, uv).rgb;
  float lNW = dot(nw, L), lNE = dot(ne, L), lSW = dot(sw, L), lSE = dot(se, L), lM = dot(m, L);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.03, lMax * 0.08)) return m;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), -8.0, 8.0) * rcp;
  vec3 a = 0.5 * (texture2D(tLow, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tLow, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tLow, uv - dir * 0.5).rgb + texture2D(tLow, uv + dir * 0.5).rgb);
  float lB = dot(b, L);
  return (lB < lMin || lB > lMax) ? a : b;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uScreen;
  vec2 cc = uv - 0.5;
  vec3 c = fxaa(uv, uTexel);
  vec2 shift = cc * uAberr * 0.012;
  c.r = mix(c.r, texture2D(tLow, uv - shift).r, 0.35);
  c.b = mix(c.b, texture2D(tLow, uv + shift).b, 0.35);
  float vig = 16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
  c *= mix(1.0, pow(vig, 0.22), uVig);
  c += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * uNoise;
  gl_FragColor = vec4(c, 1.0);
}`;

export class RetroPipeline {
  constructor(renderer, scene, camera, { quality, shaft }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;

    const nearest = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false };
    const linear = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
    // HDR targets where the GPU can render to them; plain 8-bit otherwise
    const ext = renderer.extensions;
    const hdr = ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float');
    const type = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, { ...nearest, type, depthBuffer: true });
    this.rtScene.depthTexture = new THREE.DepthTexture(4, 4);
    this.rtScene.depthTexture.type = THREE.UnsignedIntType;
    this.rtMask = new THREE.WebGLRenderTarget(4, 4, { ...nearest, depthBuffer: true });
    const half = { ...linear, type, depthBuffer: false };
    this.rtBloomA = new THREE.WebGLRenderTarget(4, 4, half);
    this.rtBloomB = new THREE.WebGLRenderTarget(4, 4, half);
    this.rtShaftA = new THREE.WebGLRenderTarget(4, 4, half);
    this.rtShaftB = new THREE.WebGLRenderTarget(4, 4, half);
    this.rtAOA = new THREE.WebGLRenderTarget(4, 4, { ...linear, depthBuffer: false });
    this.rtAOB = new THREE.WebGLRenderTarget(4, 4, { ...linear, depthBuffer: false });
    this.rtLow = new THREE.WebGLRenderTarget(4, 4, { ...linear, depthBuffer: false });

    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(tri, null);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);

    const fs = (fragmentShader, uniforms, defines) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, defines: defines || {}, depthTest: false, depthWrite: false });
    this.brightMat = fs(BRIGHT, { tScene: { value: this.rtScene.texture }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.95 } });
    this.blurMat = fs(BLUR, { tInput: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.aoMat = fs(SSAO, {
      tDepth: { value: this.rtScene.depthTexture },
      uProjInv: { value: new THREE.Matrix4() },
      uProj: { value: new THREE.Matrix4() },
      uAspect: { value: new THREE.Vector2(1, 1) },
      uRadius: { value: 0.32 },
      uIntensity: { value: 1.25 },
    });
    this.shaftMat = fs(SHAFTS, {
      ...shaft,
      tDepth: { value: this.rtScene.depthTexture },
      uProjInv: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uTime: { value: 0 },
    }, { STEPS: quality.shaftSteps });
    this.compMat = fs(COMPOSITE, {
      tScene: { value: this.rtScene.texture },
      tBloom: { value: this.rtBloomA.texture },
      tMask: { value: this.rtMask.texture },
      tShaft: { value: this.rtShaftA.texture },
      tAO: { value: this.rtAOA.texture },
      uRes: { value: new THREE.Vector2() },
      uSunColor: { value: new THREE.Color('#ffb36e') },
      uShaft: { value: 0.55 },
      uAO: { value: quality.ao ? 0.85 : 0 },
      uExposure: { value: 1.35 },
      uBloom: { value: 0.45 },
      uHover: { value: 0 },
      uOutlineW: { value: 1 },
      uOutline: { value: new THREE.Color('#fff1b8') },
      uSat: { value: 1.05 },
    });
    this.presentMat = fs(PRESENT, {
      tLow: { value: this.rtLow.texture },
      uScreen: { value: new THREE.Vector2() },
      uTexel: { value: new THREE.Vector2() },
      uVig: { value: 0.4 },
      uTime: { value: 0 },
      uNoise: { value: 0.01 },
      uAberr: { value: 0.35 },
    });
    this.maskMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.hover = [];
    this.hoverAmount = 0;
  }

  setSize(cssW, cssH, dpr) {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cssW, cssH, false);
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const devW = buf.x, devH = buf.y;
    const scale = Math.max(1, Math.round(devH / this.quality.lowH));
    const lw = Math.ceil(devW / scale), lh = Math.ceil(devH / scale);
    this.low = new THREE.Vector2(lw, lh);
    this.rtScene.setSize(lw, lh);
    this.rtMask.setSize(lw, lh);
    this.rtLow.setSize(lw, lh);
    const bw = Math.max(1, Math.ceil(lw / 2)), bh = Math.max(1, Math.ceil(lh / 2));
    for (const rt of [this.rtBloomA, this.rtBloomB, this.rtShaftA, this.rtShaftB, this.rtAOA, this.rtAOB]) rt.setSize(bw, bh);
    this.halfSize = new THREE.Vector2(bw, bh);
    this.compMat.uniforms.uRes.value.set(lw, lh);
    this.compMat.uniforms.uOutlineW.value = Math.max(1, Math.round(lh / 450));
    this.aoMat.uniforms.uAspect.value.set(lh / lw, 1);
    this.presentMat.uniforms.uScreen.value.set(devW, devH);
    this.presentMat.uniforms.uTexel.value.set(1 / lw, 1 / lh);
    this.devSize = new THREE.Vector2(devW, devH);
    retroUniforms.uSnap.value.set(1e5, 1e5); // no vertex wobble: it read as low-fi at this resolution
    this.camera.aspect = lw / lh;
    this.camera.updateProjectionMatrix();
  }

  /** CSS-pixel pointer -> NDC. */
  pointerToNdc(x, y, cssW, cssH, out = new THREE.Vector2()) {
    return out.set((x / cssW) * 2 - 1, 1 - (y / cssH) * 2);
  }

  /** NDC -> CSS pixel, used to place HTML over 3D objects. */
  ndcToCss(ndc, cssW, cssH, out = new THREE.Vector2()) {
    return out.set(((ndc.x + 1) / 2) * cssW, (1 - (ndc.y + 1) / 2) * cssH);
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  blur(src, tmp, k) {
    this.blurMat.uniforms.tInput.value = src.texture;
    this.blurMat.uniforms.uDir.value.set(k / this.halfSize.x, 0);
    this.pass(this.blurMat, tmp);
    this.blurMat.uniforms.tInput.value = tmp.texture;
    this.blurMat.uniforms.uDir.value.set(0, k / this.halfSize.y);
    this.pass(this.blurMat, src);
  }

  render(time, dt) {
    const r = this.renderer;
    const cam = this.camera;
    if (this.raw) {
      r.setRenderTarget(null);
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.render(this.scene, cam);
      return;
    }
    // 1. the scene
    r.setRenderTarget(this.rtScene);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.scene, cam);

    // 2. hover mask
    this.hoverAmount += ((this.hover.length ? 1 : 0) - this.hoverAmount) * Math.min(1, dt * 12);
    if (this.hover.length) {
      for (const m of this.hover) m.layers.enable(2);
      cam.layers.set(2);
      const ov = this.scene.overrideMaterial;
      this.scene.overrideMaterial = this.maskMat;
      r.setRenderTarget(this.rtMask);
      r.clear();
      r.render(this.scene, cam);
      this.scene.overrideMaterial = ov;
      cam.layers.set(0);
      for (const m of this.hover) m.layers.disable(2);
    }

    const res = this.low.y / 330; // keep glows the same size on screen at any resolution

    // 3. ambient occlusion
    const u = this.compMat.uniforms;
    if (u.uAO.value > 0) {
      const au = this.aoMat.uniforms;
      au.uProjInv.value.copy(cam.projectionMatrixInverse);
      au.uProj.value.copy(cam.projectionMatrix);
      this.pass(this.aoMat, this.rtAOA);
      this.blur(this.rtAOA, this.rtAOB, 0.8 * res);
    }

    // 4. bloom
    this.brightMat.uniforms.uTexel.value.set(1 / this.low.x, 1 / this.low.y);
    this.pass(this.brightMat, this.rtBloomA);
    for (let i = 0; i < this.quality.bloomPasses; i++) this.blur(this.rtBloomA, this.rtBloomB, (1 + i) * res);

    // 5. volumetric shafts
    if (u.uShaft.value > 0) {
      const su = this.shaftMat.uniforms;
      su.uProjInv.value.copy(cam.projectionMatrixInverse);
      su.uCamWorld.value.copy(cam.matrixWorld);
      su.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
      su.uTime.value = time;
      this.pass(this.shaftMat, this.rtShaftA);
      this.blur(this.rtShaftA, this.rtShaftB, 0.7 * res);
    }

    // 6. composite, then present
    u.uHover.value = this.hoverAmount > 0.01 && this.hover.length ? this.hoverAmount * (0.78 + 0.22 * Math.sin(time * 6)) : 0;
    this.pass(this.compMat, this.rtLow);
    this.presentMat.uniforms.uTime.value = time;
    this.pass(this.presentMat, null);
  }
}
