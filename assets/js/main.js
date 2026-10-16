import * as THREE from '../vendor/three.module.min.js';
import { readContent } from './content.js';
import { buildWorld } from './world.js';
import { RetroPipeline } from './post.js';
import { Rig } from './rig.js';
import { makeViews } from './views.js';
import { CRTScreen } from './screen.js';
import { BLINDS, blindsOpenFraction } from './layout.js';
import { UI } from './ui.js';
import { Sound } from './audio.js';
import { lerp } from './util.js';

const params = new URLSearchParams(location.search);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SHOT = params.has('shot'); // for automated screenshots: no boot, no intro

function pickQuality() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 600;
  const q = coarse || small
    ? { name: 'low', lowH: 300, sunShadow: 1024, lampShadow: 0, shaftSteps: 16, bloomPasses: 1, dust: 260 }
    : { name: 'high', lowH: 330, sunShadow: 2048, lampShadow: 1024, shaftSteps: 32, bloomPasses: 2, dust: 520 };
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
    this.ui = new UI(this, this.content, { reduced });
    this.sound = new Sound();
    this.state = { view: null, target: null, panel: null };
    this.clock = new THREE.Clock();
    this.time = 0;
    this.running = false;
    this.pointer = { x: 0, y: 0, down: false, sx: 0, sy: 0, moved: false, id: null, type: 'mouse' };
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.hovered = null;
    this.frameTimes = [];
  }

  async start() {
    if (this.ui.prefersText()) {
      this.ui.enterTextMode({ initial: true });
      return;
    }
    const canvas = document.getElementById('scene');
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
      if (!this.renderer.capabilities.isWebGL2) throw new Error('WebGL2 required');
    } catch (err) {
      this.ui.enterTextMode({ initial: true, reason: 'webgl' });
      return;
    }
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.quality = pickQuality();
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
      const intro = { ...this.views.main, pos: [0.1, 1.72, 3.05], target: [0, 1.05, -1.5] };
      this.rig.set(intro);
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

    if (!SHOT && !reduced && !params.get('view')) {
      this.rig.go(this.views.main, { duration: 2.4, arc: 0 });
    }
    if (deep) {
      setTimeout(() => this.navigate(deep, { fromHash: true }), SHOT ? 0 : 900);
    } else if (!SHOT) {
      setTimeout(() => this.ui.flashMarkers(5200), 2600);
    }
    if (params.get('open')) this.navigate(params.get('open'));
    requestAnimationFrame(() => this.loop());
  }

  /* ---------------- hotspots ---------------- */

  setupHotspots() {
    const { ctx, books, piles, tapes } = this.world;
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
      return h;
    };
    const notIn = (...v) => Object.keys(this.views).filter((k) => !v.includes(k));

    add({ id: 'terminal', label: 'Research terminal', sub: 'Browse the research', objects: [ctx.computer.group], anchor: ctx.anchors.terminal, go: 'terminal', views: notIn('terminal') });
    piles.forEach((p) => add({
      id: `pile:${p.report.id}`, label: `${p.report.ticker} · ${p.report.company}`, sub: 'Read the report', objects: [p.group],
      anchor: ctx.anchors[`pile:${p.report.id}`], go: `report:${p.report.id}`,
    }));
    add({ id: 'library', label: 'The library', sub: 'Browse the reading list', meshes: books.books.map((b) => b.mesh), anchor: books.centre, go: 'library', views: notIn('library') });
    books.books.forEach((b) => add({ id: `book:${b.item.id}`, label: b.item.title, sub: b.item.by, meshes: [b.mesh], go: `book:${b.item.id}`, views: ['library'], book: b }));
    add({ id: 'podcasts', label: 'Hi-fi & tapes', sub: 'The podcasts I listen to', objects: [ctx.hifi.group, ...tapes.map((t) => t.mesh)], anchor: ctx.anchors.hifi, go: 'podcasts', views: notIn('podcasts') });
    tapes.forEach((t) => add({ id: `tape:${t.item.id}`, label: t.item.title, sub: t.item.by, meshes: [t.mesh], go: `tape:${t.item.id}`, views: ['podcasts'], tape: t }));
    add({ id: 'contact', label: 'Telephone & Rolodex', sub: 'Get in touch', objects: [ctx.phone.group, ctx.rolodex.group], anchor: ctx.anchors.phone, go: 'contact' });
    add({ id: 'about', label: 'Josh McKee', sub: 'About me', objects: [ctx.nameplate.group, ctx.photo.group], anchor: ctx.anchors.nameplate, go: 'about' });
    add({ id: 'lamp', label: 'Desk lamp', sub: 'Pull the chain', objects: [ctx.lamp.group], anchor: ctx.anchors.lamp, action: () => this.toggleLamp(), minor: true });
    add({ id: 'blinds', label: 'Venetian blinds', sub: 'Tilt the slats', objects: [ctx.blinds.group], anchor: new THREE.Vector3(0.9, 1.6, -3.4), action: () => this.cycleBlinds(), minor: true });
    add({ id: 'globe', label: 'Globe', sub: 'Give it a spin', objects: [ctx.globe.group], anchor: ctx.anchors.globe, action: () => this.spinGlobe(), minor: true });
    add({ id: 'door', label: 'Office door', sub: 'Leave for the text version', meshes: [ctx.door.glass], anchor: ctx.anchors.door, action: () => this.ui.enterTextMode(), minor: true });
    add({ id: 'clock', label: () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), sub: 'Local time', objects: [this.world.scene.getObjectByName('clock') || null].filter(Boolean), anchor: ctx.anchors.clock, minor: true });

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
    const w = window.innerWidth, h = window.innerHeight;
    this.pipeline.pointerToNdc(clientX, clientY, w, h, this.ndc);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    for (const hit of hits) {
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
    if (h) this.sound.blip();
    this.ui.hoverItem(h);
  }

  /* ---------------- input ---------------- */

  setupInput() {
    const stage = document.getElementById('stage');
    const p = this.pointer;
    stage.addEventListener('pointerdown', (e) => {
      p.down = true;
      p.moved = false;
      p.sx = p.x = e.clientX;
      p.sy = p.y = e.clientY;
      p.id = e.pointerId;
      p.type = e.pointerType;
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or stale pointer */ }
      this.sound.unlock();
      this.ui.interacted();
    });
    stage.addEventListener('pointermove', (e) => {
      p.type = e.pointerType;
      p.seen = true;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (p.down) {
        if (!p.moved && Math.hypot(p.x - p.sx, p.y - p.sy) > 6) {
          p.moved = true;
          this.rig.dragging = true;
          document.body.classList.add('is-dragging');
          this.setHover(null);
        }
        if (p.moved) this.rig.drag(dx, dy);
        return;
      }
      if (e.pointerType === 'mouse') {
        this.rig.setParallax(e.clientX / window.innerWidth - 0.5, e.clientY / window.innerHeight - 0.5);
        this.hoverDirty = true;
      }
    });
    const end = (e) => {
      if (!p.down) return;
      p.down = false;
      this.rig.dragging = false;
      document.body.classList.remove('is-dragging');
      if (!p.moved && e.type === 'pointerup') {
        const h = this.pick(e.clientX, e.clientY);
        if (h) this.activate(h);
        else if (this.state.view !== 'main' && !this.rig.moving && e.pointerType !== 'mouse') this.hoverDirty = true;
      }
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('pointerleave', () => {
      if (!p.down) this.setHover(null);
    });
    stage.addEventListener('wheel', (e) => {
      this.rig.nudge(-e.deltaX * 0.002, -e.deltaY * 0.0015);
    }, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (this.ui.textMode) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.back();
      } else if (!this.ui.panelOpen && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && document.activeElement === document.body) {
        e.preventDefault();
        const k = 0.9;
        this.rig.nudge(e.key === 'ArrowLeft' ? k : e.key === 'ArrowRight' ? -k : 0, e.key === 'ArrowUp' ? 0.6 : e.key === 'ArrowDown' ? -0.6 : 0);
      }
    });
  }

  activate(h) {
    this.sound.click();
    if (h.action) {
      h.action();
      return;
    }
    if (h.go) this.navigate(h.go);
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
    this.ui.setActiveDock(viewName);
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
      this.sound.whoosh();
      this.rig.go(view, { onDone: arrive });
    }
  }

  onArrive(target) {
    const { books, tapes, piles } = this.world;
    if (target === 'terminal') {
      this.screen.mode = 'session';
      this.ui.openPanel('terminal');
      this.sound.keys();
    } else if (target.startsWith('report:')) {
      const id = target.slice(7);
      const pile = piles.find((p) => p.report.id === id);
      const rep = this.content.reports.find((r) => r.id === id);
      if (pile) pile.lift = 1;
      this.sound.paper();
      if (rep) this.ui.openPaper(rep);
    } else if (target === 'library' || target.startsWith('book:')) {
      const id = target.startsWith('book:') ? target.slice(5) : null;
      if (id) {
        const b = books.books.find((x) => x.item.id === id);
        if (b) b.target = 0.12;
        this.sound.slide();
      }
      this.ui.openPanel('library', { focus: id });
    } else if (target === 'podcasts' || target.startsWith('tape:')) {
      const id = target.startsWith('tape:') ? target.slice(5) : null;
      if (id) {
        const t = tapes.find((x) => x.item.id === id);
        if (t) t.target = 1;
        this.ctx.hifi.playing = 1;
        this.sound.clunk();
      }
      this.ui.openPanel('podcasts', { focus: id });
    } else if (target === 'contact') {
      this.ctx.phone.lift = 1;
      this.sound.ring();
      this.ui.openPanel('contact');
    } else if (target === 'about') {
      this.ui.openPanel('about');
    } else if (target === 'desk') {
      this.ui.flashMarkers(3200, (h) => h.id.startsWith('pile:'));
    } else if (target === 'main') {
      this.ui.announce('Back in the office');
    }
    this.hoverDirty = true;
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
    if (!t || t === 'main') {
      if (this.ui.markersOn) this.ui.toggleMarkers(false);
      return;
    }
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
    const selected = this.state.target === `${kind}:${id}`;
    if (!selected) it.target = on ? (kind === 'book' ? 0.06 : 0.45) : 0;
    this.pipeline.hover = on ? [it.mesh] : this.hovered ? this.hovered.meshes : [];
    if (on) this.sound.blip();
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
    this.sound.chain();
    this.ui.announce(L.on ? 'Lamp on' : 'Lamp off');
  }

  cycleBlinds() {
    const states = [BLINDS.tiltNormal, BLINDS.tiltOpen, BLINDS.tiltClosed];
    this.blinds.state = (this.blinds.state + 1) % states.length;
    this.blinds.target = states[this.blinds.state];
    this.sound.blinds();
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
    this.sound.spin();
  }

  /* ---------------- frame ---------------- */

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.pipeline.setSize(w, h, this.quality.dpr);
    this.rig.resize(this.camera.aspect);
    const px = Math.max(1, Math.round(this.pipeline.low.y / 270));
    this.world.fx.dustMat.uniforms.uPx.value = px;
    this.world.fx.steamMat.uniforms.uPx.value = px;
    this.ui.layout();
  }

  pause() {
    this.running = false;
  }

  resume() {
    if (this.running || this.ui.textMode || !this.pipeline) return;
    this.running = true;
    this.clock.getDelta();
    requestAnimationFrame(() => this.loop());
  }

  loop() {
    if (!this.running) return;
    this.renderFrame();
    requestAnimationFrame(() => this.loop());
  }

  renderFrame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.time += dt;
    const t = this.time;
    const { ctx, books, tapes, piles, fx } = this.world;

    this.rig.update(dt, t);

    // hover is re-evaluated when the pointer or camera moves
    if ((this.hoverDirty || this.rig.moving) && this.pointer.seen && this.pointer.type === 'mouse' && !this.pointer.down) {
      this.hoverDirty = false;
      this.setHover(this.state.view ? this.pick(this.pointer.x, this.pointer.y) : null);
    }
    const tip = this.hovered;
    this.ui.tooltip(tip && this.pointer.type === 'mouse' ? tip : null, this.pointer.x, this.pointer.y);

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
    if (moved && this.quality.name === 'high') this.renderer.shadowMap.needsUpdate = true;

    // hi-fi glow pulses while a tape is "playing"
    const hf = ctx.hifi;
    hf.front.emissiveIntensity = 1.1 + (hf.playing ? 0.5 + 0.35 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 3.1)) : 0);

    // live surfaces
    this.screen.update(t);
    fx.dustMat.uniforms.uTime.value = t;
    fx.steamMat.uniforms.uTime.value = t;

    this.pipeline.render(t, dt);
    this.ui.frame(this);

    // adapt quality if the machine is struggling
    if (this.time > 2.5 && this.frameTimes.length < 90) {
      this.frameTimes.push(dt);
      if (this.frameTimes.length === 90) {
        const avg = this.frameTimes.reduce((a, b) => a + b, 0) / 90;
        if (avg > 1 / 38 && this.quality.lowH > 200) {
          this.quality.lowH = Math.round(this.quality.lowH * 0.75);
          this.resize();
        }
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
if (params.has('og')) document.body.classList.add('og');
office.start().catch((err) => {
  console.error(err);
  office.ui.enterTextMode({ initial: true, reason: 'error' });
});

