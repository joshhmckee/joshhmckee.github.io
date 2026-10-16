import * as THREE from '../vendor/three.module.min.js';
import { readContent } from './content.js';
import { buildWorld } from './world.js';
import { RetroPipeline } from './post.js';
import { Rig } from './rig.js';
import { makeViews } from './views.js';
import { CRTScreen } from './screen.js';
import { BLINDS, blindsOpenFraction } from './layout.js';
import { UI } from './ui.js';
import { lerp, clamp } from './util.js';
import { setTexScale } from './textures.js';

const params = new URLSearchParams(location.search);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const SHOT = params.has('shot'); // for automated screenshots: no boot, no intro

function pickQuality() {
  const small = Math.min(screen.width, screen.height) < 600;
  const q = coarse || small
    ? { name: 'low', lowH: 1400, sunShadow: 1024, lampShadow: 0, shaftSteps: 18, bloomPasses: 1, dust: 260, ao: false, tex: 1 }
    : { name: 'high', lowH: 900, sunShadow: 2048, lampShadow: 1024, shaftSteps: 28, bloomPasses: 2, dust: 520, ao: true, tex: 2 };
  q.dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (params.get('lowh')) q.lowH = +params.get('lowh');
  return q;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const loadImage = (src) => new Promise((res) => {
  if (!src) return res(null);
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => res(img);
  img.onerror = () => res(null);
  img.src = src;
});

/* ------------------------------------------------------------------ */

class Office {
  constructor() {
    this.content = readContent(document);
    this.ui = new UI(this, this.content, { reduced, touch: coarse });
    this.state = { view: null, target: null };
    this.clock = new THREE.Clock();
    this.time = 0;
    this.running = false;
    this.pointer = { x: 0, y: 0, down: false, sx: 0, sy: 0, moved: false, type: 'mouse', seen: false };
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.hovered = null;
    this.frameTimes = [];
  }

  async start() {
    const canvas = document.getElementById('scene');
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
      if (!this.renderer.capabilities.isWebGL2) throw new Error('WebGL2 required');
    } catch (err) {
      this.ui.showFallback();
      return;
    }
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.quality = pickQuality();
    setTexScale(this.quality.tex);
    if (SHOT) this.ui.el.boot.hidden = true;
    else this.ui.bootStart(this.content);

    // fonts are needed before we paint text into textures
    const fonts = Promise.all([document.fonts.load('16px VT323'), document.fonts.load('16px "Courier Prime"'), document.fonts.load('bold 16px "Courier Prime"')]).catch(() => null);
    const imgs = Promise.all([
      loadImage('assets/img/profile.jpg'),
      ...this.content.reports.map((r) => loadImage(r.image)),
    ]);
    await Promise.race([fonts, wait(2500)]);
    this.ui.bootStep(1);
    const [profile, ...reportImgs] = await imgs;
    const images = { profile };
    this.content.reports.forEach((r, i) => (images[`report:${r.id}`] = reportImgs[i]));
    this.ui.bootStep(2);
    await wait(16);

    this.screen = new CRTScreen(this.content.reports, images);
    this.world = buildWorld({ content: this.content, images, quality: this.quality, screen: this.screen });
    this.ctx = this.world.ctx;
    this.ui.bootStep(3);
    await wait(16);

    this.captureEnvironment();
    this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.04, 40);
    this.pipeline = new RetroPipeline(this.renderer, this.world.scene, this.camera, { quality: this.quality, shaft: this.world.shaft });
    this.pipeline.raw = params.has('raw');
    if (params.has('noshaft')) this.pipeline.compMat.uniforms.uShaft.value = 0;
    if (params.has('nodither')) Object.assign(this.pipeline.compMat.uniforms, { uDither: { value: 0 }, uLevels: { value: 255 } });
    this.rig = new Rig(this.camera, { reducedMotion: reduced });
    this.views = makeViews(this.world);
    this.setupHotspots();
    this.setupInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => (document.hidden ? this.pause() : this.resume()));

    this.blinds = { tilt: BLINDS.tiltNormal, target: BLINDS.tiltNormal, state: 0 };
    this.applyBlinds(this.blinds.tilt);

    // initial view: deep link or the overview
    const deep = this.ui.targetFromHash();
    if (params.get('view')) {
      this.rig.set(this.views[params.get('view')] || this.views.main);
      this.state.view = params.get('view');
    } else if (SHOT || reduced) {
      this.rig.set(this.views.main);
      this.state.view = 'main';
    } else {
      // start a step back and glide in
      this.rig.set({ ...this.views.main, pos: [0.1, 1.66, 3.1] });
      this.state.view = 'main';
    }
    this.rig.update(0, 0);
    this.renderer.compile(this.world.scene, this.camera);
    this.ui.bootStep(4);
    this.running = true;
    this.clock.start();
    this.renderFrame();
    if (!SHOT) await this.ui.bootEnd();
    document.body.classList.add('is-ready');

    if (!SHOT && !reduced && !params.get('view')) this.rig.go(this.views.main, { duration: 2.4, arc: 0 });
    if (deep) setTimeout(() => this.navigate(deep, { fromHash: true }), SHOT ? 0 : 900);
    else if (!SHOT && coarse) setTimeout(() => this.ui.flashMarkers(4500), 2600); // no hover on touch screens, so hint once
    if (params.get('open')) this.navigate(params.get('open'));
    requestAnimationFrame(() => this.loop());
  }

  /**
   * Bake the room into an environment map once: brass, glass, lacquered wood and the
   * floor then reflect the window and lamps, and every surface gets soft bounced light.
   */
  captureEnvironment() {
    const scene = this.world.scene;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    scene.position.y = -1.25; // capture from about chest height, above the rug
    scene.updateMatrixWorld(true);
    const env = pmrem.fromScene(scene, 0.02, 0.05, 30);
    scene.position.y = 0;
    scene.updateMatrixWorld(true);
    pmrem.dispose();
    scene.environment = env.texture;
    scene.environmentIntensity = 0.42;
    this.renderer.shadowMap.needsUpdate = true;
  }

  /* ---------------- hotspots ---------------- */

  setupHotspots() {
    const { ctx, books, piles, tapes, dog } = this.world;
    const meshes = (...objs) => {
      const out = [];
      for (const o of objs) o && o.traverse((m) => m.isMesh && out.push(m));
      return out;
    };
    this.hotspots = [];
    const add = (h) => {
      h.meshes = h.meshes || meshes(...(h.objects || []));
      h.views = h.views || null; // null = active in every view
      this.hotspots.push(h);
    };
    const notIn = (...v) => Object.keys(this.views).filter((k) => !v.includes(k));

    add({ id: 'terminal', objects: [ctx.computer.group], anchor: ctx.anchors.terminal, go: 'terminal', views: notIn('terminal') });
    piles.forEach((p) => add({ id: `pile:${p.report.id}`, objects: [p.group], anchor: ctx.anchors[`pile:${p.report.id}`], go: `report:${p.report.id}` }));
    add({ id: 'library', meshes: books.books.map((b) => b.mesh), anchor: books.centre, go: 'library', views: notIn('library') });
    books.books.forEach((b) => add({ id: `book:${b.item.id}`, meshes: [b.mesh], go: `book:${b.item.id}`, views: ['library'], book: b }));
    add({ id: 'podcasts', objects: [ctx.hifi.group, ...tapes.map((t) => t.mesh)], anchor: ctx.anchors.hifi, go: 'podcasts', views: notIn('podcasts') });
    tapes.forEach((t) => add({ id: `tape:${t.item.id}`, meshes: [t.mesh], go: `tape:${t.item.id}`, views: ['podcasts'], tape: t }));
    add({ id: 'contact', objects: [ctx.phone.group, ctx.rolodex.group], anchor: ctx.anchors.phone, go: 'contact' });
    add({ id: 'about', objects: [ctx.nameplate.group, ctx.photo.group], anchor: ctx.anchors.nameplate, go: 'about' });
    add({ id: 'dog', objects: [dog.group], anchor: ctx.anchors.dog, action: () => dog.pet(), minor: true });
    add({ id: 'mate', objects: [ctx.mate.group], anchor: ctx.anchors.mate, action: () => (ctx.mate.wobble = 1), minor: true });
    add({ id: 'lamp', objects: [ctx.lamp.group], anchor: ctx.anchors.lamp, action: () => this.toggleLamp(), minor: true });
    add({ id: 'blinds', objects: [ctx.blinds.group], anchor: new THREE.Vector3(0.9, 1.6, -3.4), action: () => this.cycleBlinds(), minor: true });
    add({ id: 'globe', objects: [ctx.globe.group], anchor: ctx.anchors.globe, action: () => this.spinGlobe(), minor: true });

    this.meshToHotspots = new Map();
    for (const h of this.hotspots) {
      for (const m of h.meshes) {
        if (!this.meshToHotspots.has(m)) this.meshToHotspots.set(m, []);
        this.meshToHotspots.get(m).push(h);
      }
    }
    this.pickables = [...this.meshToHotspots.keys()];
  }

  activeHotspot(mesh) {
    const list = this.meshToHotspots.get(mesh) || [];
    const v = this.state.view;
    return list.find((h) => !h.views || h.views.includes(v)) || null;
  }

  pick(clientX, clientY) {
    this.pipeline.pointerToNdc(clientX, clientY, window.innerWidth, window.innerHeight, this.ndc);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.pickables, false)) {
      const hs = this.activeHotspot(hit.object);
      if (hs) return hs;
    }
    return null;
  }

  setHover(h) {
    if (h === this.hovered) return;
    this.hovered = h;
    this.pipeline.hover = h ? h.meshes : [];
    document.body.classList.toggle('is-pointing', !!h);
    this.ui.hoverItem(h);
  }

  /* ---------------- input ---------------- */

  setupInput() {
    const stage = document.getElementById('stage');
    const p = this.pointer;
    const toFollow = (e) => this.rig.follow((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);

    stage.addEventListener('pointerdown', (e) => {
      p.down = true;
      p.moved = false;
      p.sx = p.x = e.clientX;
      p.sy = p.y = e.clientY;
      p.type = e.pointerType;
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or stale pointer */ }
    });
    stage.addEventListener('pointermove', (e) => {
      p.type = e.pointerType;
      p.seen = true;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (e.pointerType === 'mouse') {
        // the view simply follows the cursor; no dragging
        toFollow(e);
        if (p.down && Math.hypot(p.x - p.sx, p.y - p.sy) > 6) p.moved = true;
        return;
      }
      // touch screens have no cursor, so a drag looks around instead
      if (p.down) {
        if (!p.moved && Math.hypot(p.x - p.sx, p.y - p.sy) > 8) {
          p.moved = true;
          this.rig.dragging = true;
        }
        if (p.moved) this.rig.drag(dx, dy);
      }
    });
    const end = (e) => {
      if (!p.down) return;
      p.down = false;
      this.rig.dragging = false;
      if (p.moved || e.type !== 'pointerup') return;
      const h = this.pick(e.clientX, e.clientY);
      if (h) this.activate(h);
      else if (this.state.view && this.state.view !== 'main') this.back(); // click away to step back
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') {
        this.rig.follow(0, 0);
        this.setHover(null);
        p.seen = false;
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.back();
      }
    });
  }

  activate(h) {
    if (h.action) h.action();
    else if (h.go) this.navigate(h.go);
  }

  /* ---------------- navigation ---------------- */

  static viewFor(target) {
    if (target.startsWith('report:')) return 'desk';
    if (target.startsWith('book:')) return 'library';
    if (target.startsWith('tape:')) return 'podcasts';
    return target;
  }

  navigate(target, { fromHash = false } = {}) {
    if (!this.running || !target) return;
    if (target === this.state.target && !this.rig.moving) return;
    const viewName = Office.viewFor(target);
    const view = this.views[viewName];
    if (!view) return;
    const prev = this.state.target;
    this.state.target = target;
    this.ui.closePanels({ keepFor: target });
    this.resetSelections(target);
    if (!fromHash) this.ui.setHash(target, prev);
    this.ui.setActiveNav(viewName);
    if (window.gtag) window.gtag('event', 'office_open', { target });
    const arrive = () => {
      this.state.view = viewName;
      this.onArrive(target);
    };
    if (this.state.view === viewName && !this.rig.moving) {
      arrive();
    } else {
      this.state.view = null; // nothing is clickable mid-flight
      this.setHover(null);
      this.rig.go(view, { onDone: arrive });
    }
  }

  onArrive(target) {
    const { books, tapes, piles } = this.world;
    if (target === 'terminal') {
      this.screen.mode = 'session';
      this.ui.openPanel('terminal');
    } else if (target.startsWith('report:')) {
      const id = target.slice(7);
      const pile = piles.find((p) => p.report.id === id);
      const rep = this.content.reports.find((r) => r.id === id);
      if (pile) pile.lift = 1;
      if (rep) this.ui.openPaper(rep);
    } else if (target === 'library' || target.startsWith('book:')) {
      const id = target.startsWith('book:') ? target.slice(5) : null;
      const b = id && books.books.find((x) => x.item.id === id);
      if (b) b.target = 0.12;
      this.ui.openPanel('library', { focus: id });
    } else if (target === 'podcasts' || target.startsWith('tape:')) {
      const id = target.startsWith('tape:') ? target.slice(5) : null;
      const t = id && tapes.find((x) => x.item.id === id);
      if (t) {
        t.target = 1;
        this.ctx.hifi.playing = 1;
      }
      this.ui.openPanel('podcasts', { focus: id });
    } else if (target === 'contact') {
      this.ctx.phone.lift = 1;
      this.ui.openPanel('contact');
    } else if (target === 'about') {
      this.ui.openPanel('about');
    } else if (target === 'desk') {
      this.ui.flashMarkers(3200, (h) => h.id.startsWith('pile:'));
    } else if (target === 'main') {
      this.ui.announce('Back in the office');
    }
  }

  resetSelections(target) {
    const { books, tapes, piles } = this.world;
    for (const b of books.books) if (target !== `book:${b.item.id}`) b.target = 0;
    for (const t of tapes) if (target !== `tape:${t.item.id}`) t.target = 0;
    for (const p of piles) if (target !== `report:${p.report.id}`) p.lift = 0;
    if (!target.startsWith('tape:')) this.ctx.hifi.playing = 0;
    if (target !== 'contact') this.ctx.phone.lift = 0;
    if (target !== 'terminal') this.screen.mode = 'idle';
  }

  back() {
    const t = this.state.target;
    if (!t || t === 'main') return;
    if (t.startsWith('book:')) return this.navigate('library');
    if (t.startsWith('tape:')) return this.navigate('podcasts');
    if (t.startsWith('report:')) return this.navigate('desk');
    this.navigate('main');
  }

  /** Hovering a card in the library or tape panel previews the matching 3D object. */
  previewItem(kind, id, on) {
    const list = kind === 'book' ? this.world.books.books : this.world.tapes;
    const it = list.find((x) => x.item.id === id);
    if (!it) return;
    if (this.state.target !== `${kind}:${id}`) it.target = on ? (kind === 'book' ? 0.06 : 0.45) : 0;
    this.pipeline.hover = on ? [it.mesh] : this.hovered ? this.hovered.meshes : [];
  }

  /* ---------------- interactive props ---------------- */

  toggleLamp() {
    const L = this.ctx.lamp;
    L.on = !L.on;
    L.spot.intensity = L.on ? L.base.spot : 0;
    L.glow.intensity = L.on ? L.base.glow : 0;
    L.inner.emissiveIntensity = L.on ? 1.6 : 0.0;
    L.bulb.color.setScalar(L.on ? 4 : 0.35);
    this.renderer.shadowMap.needsUpdate = true;
    this.ui.announce(L.on ? 'Lamp on' : 'Lamp off');
  }

  cycleBlinds() {
    const states = [BLINDS.tiltNormal, BLINDS.tiltOpen, BLINDS.tiltClosed];
    this.blinds.state = (this.blinds.state + 1) % states.length;
    this.blinds.target = states[this.blinds.state];
    this.ui.announce(['Blinds half open', 'Blinds open', 'Blinds closed'][this.blinds.state]);
  }

  applyBlinds(tilt) {
    this.ctx.blinds.setTilt(tilt);
    const open = blindsOpenFraction(tilt);
    this.world.shaft.uOpen.value = open;
    this.ctx.lights.windowGlow.intensity = 1.2 + open * 3.2;
    this.renderer.shadowMap.needsUpdate = true;
  }

  spinGlobe() {
    this.ctx.globe.spin += 7 + Math.random() * 4;
  }

  /* ---------------- frame ---------------- */

  resize() {
    this.pipeline.setSize(window.innerWidth, window.innerHeight, this.quality.dpr);
    this.rig.resize(this.camera.aspect);
    const px = Math.max(1.2, this.pipeline.low.y / 420);
    this.world.fx.dustMat.uniforms.uPx.value = px;
    this.world.fx.steamMat.uniforms.uPx.value = px;
    this.ui.layout();
  }

  pause() {
    this.running = false;
  }

  resume() {
    if (this.running || !this.pipeline) return;
    this.running = true;
    this.clock.getDelta();
    requestAnimationFrame(() => this.loop());
  }

  loop() {
    if (!this.running) return;
    this.renderFrame();
    requestAnimationFrame(() => this.loop());
  }

  /** Where the dog should look: at you, nudged toward the cursor. */
  dogGaze() {
    const { dog } = this.world;
    const head = dog.head.getWorldPosition(new THREE.Vector3());
    const to = this.camera.position.clone().sub(head);
    let yaw = Math.atan2(to.x, to.z) - dog.group.rotation.y;
    yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    let pitch = -Math.atan2(to.y, Math.hypot(to.x, to.z));
    if (this.pointer.seen) {
      yaw -= ((this.pointer.x / window.innerWidth) * 2 - 1) * 0.45;
      pitch += ((this.pointer.y / window.innerHeight) * 2 - 1) * 0.25;
    }
    return { yaw: clamp(yaw, -1.0, 1.0), pitch: clamp(pitch, -0.55, 0.3) };
  }

  renderFrame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.time += dt;
    const t = this.time;
    const { ctx, books, tapes, piles, fx, dog } = this.world;

    this.rig.followScale = this.ui.panelOpen ? 0.3 : 1;
    this.rig.update(dt, t);

    // the room moves under the cursor, so hover is re-checked every frame
    if (this.pointer.seen && this.pointer.type === 'mouse') {
      this.setHover(this.state.view ? this.pick(this.pointer.x, this.pointer.y) : null);
    }

    // ambient motion
    ctx.fan.rotor.rotation.y += dt * 1.15;
    const now = new Date();
    const sec = now.getSeconds() + now.getMilliseconds() / 1000;
    const min = now.getMinutes() + sec / 60;
    const hr = (now.getHours() % 12) + min / 60;
    ctx.clock.secHand.rotation.z = -(Math.floor(sec) / 60) * Math.PI * 2;
    ctx.clock.minHand.rotation.z = -(min / 60) * Math.PI * 2;
    ctx.clock.hourHand.rotation.z = -(hr / 12) * Math.PI * 2;
    ctx.globe.sphere.rotation.y += ctx.globe.spin * dt;
    ctx.globe.spin = lerp(ctx.globe.spin, 0.25, 1 - Math.exp(-dt * 0.8));
    dog.update(dt, t, this.dogGaze());
    const mt = ctx.mate;
    if (mt.wobble > 0) {
      mt.wobble = Math.max(0, mt.wobble - dt * 1.2);
      const w = (1 - mt.wobble) * 22;
      mt.group.rotation.z = Math.sin(w) * 0.1 * mt.wobble;
      mt.group.rotation.x = Math.cos(w) * 0.07 * mt.wobble;
    }

    // blinds animation
    if (Math.abs(this.blinds.tilt - this.blinds.target) > 0.002) {
      this.blinds.tilt = lerp(this.blinds.tilt, this.blinds.target, 1 - Math.exp(-dt * 5));
      this.applyBlinds(this.blinds.tilt);
    }

    // books slide out, tapes lift, papers rise
    let moved = false;
    for (const b of books.books) {
      const goal = this.hovered && this.hovered.book === b ? Math.max(b.target, 0.045) : b.target;
      if (Math.abs(b.out - goal) > 0.0005) {
        b.out = lerp(b.out, goal, 1 - Math.exp(-dt * 10));
        b.mesh.position.z = b.home.z + b.out;
        b.mesh.rotation.x = -b.out * 0.7;
        moved = true;
      }
    }
    for (const tp of tapes) {
      const goal = this.hovered && this.hovered.tape === tp ? Math.max(tp.target, 0.35) : tp.target;
      if (Math.abs(tp.out - goal) > 0.001) {
        tp.out = lerp(tp.out, goal, 1 - Math.exp(-dt * 9));
        tp.mesh.position.y = tp.home.y + tp.out * 0.05;
        tp.mesh.position.z = tp.home.z + tp.out * 0.03;
        tp.mesh.rotation.x = tp.out * 0.55;
        moved = true;
      }
    }
    for (const p of piles) {
      p.l = p.l || 0;
      const goal = p.lift || 0;
      if (Math.abs(p.l - goal) > 0.001) {
        p.l = lerp(p.l, goal, 1 - Math.exp(-dt * 7));
        p.top.position.y = p.home.y + p.l * 0.16;
        p.top.position.z = p.home.z + p.l * 0.06;
        p.top.rotation.x = p.homeRot.x + p.l * 0.9;
        moved = true;
      }
    }
    const ph = ctx.phone;
    ph.l = ph.l || 0;
    const phGoal = Math.max(ph.lift || 0, this.hovered && this.hovered.id === 'contact' ? 0.35 : 0);
    if (Math.abs(ph.l - phGoal) > 0.001) {
      ph.l = lerp(ph.l, phGoal, 1 - Math.exp(-dt * 8));
      ph.handset.position.y = ph.handsetHome + ph.l * 0.05;
      ph.handset.rotation.z = ph.l * 0.25;
      moved = true;
    }
    // the dog moves all the time, so shadows refresh at a gentle rate rather than every frame
    this.shadowTick = (this.shadowTick || 0) + dt;
    if ((moved || this.shadowTick > 0.1) && this.quality.name === 'high') {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowTick = 0;
    }

    // hi-fi glow pulses while a tape is "playing"
    const hf = ctx.hifi;
    hf.front.emissiveIntensity = 1.1 + (hf.playing ? 0.5 + 0.35 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 3.1)) : 0);

    // live surfaces
    this.screen.update(t);
    fx.dustMat.uniforms.uTime.value = t;
    fx.steamMat.uniforms.uTime.value = t;

    this.pipeline.render(t, dt);
    this.ui.frame(this);

    // adapt to slower machines: first drop the ambient occlusion, then step the resolution down
    if (this.time > 2.5 && !this.rig.moving && !this.qualitySettled) {
      this.frameTimes.push(dt);
      if (this.frameTimes.length === 90) {
        const avg = this.frameTimes.reduce((a, b) => a + b, 0) / 90;
        this.frameTimes.length = 0;
        const u = this.pipeline.compMat.uniforms;
        if (avg > 1 / 45 && u.uAO.value > 0) u.uAO.value = 0;
        else if (avg > 1 / 40 && this.quality.lowH > 420) {
          this.quality.lowH = Math.round(this.quality.lowH * 0.8);
          this.resize();
        } else this.qualitySettled = true;
      }
    }
  }

  /** World point -> CSS pixel position (accounts for CRT curvature). */
  project(v, out = new THREE.Vector2()) {
    const p = v.clone().project(this.camera);
    if (p.z > 1 || p.z < -1) return null;
    return this.pipeline.ndcToCss(p, window.innerWidth, window.innerHeight, out);
  }
}

const office = new Office();
window.__office = office;
office.start().catch((err) => {
  console.error(err);
  office.ui.showFallback();
});
