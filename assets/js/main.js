import * as THREE from '../vendor/three.module.min.js';
import { readContent } from './content.js';
import { buildWorld } from './world.js';
import { RetroPipeline } from './post.js';
import { Rig, EYE } from './rig.js';
import { makeViews } from './views.js';
import { CRTScreen } from './screen.js';
import { WIN, ROOM } from './layout.js';
import { buildOutdoors, envCard, walkOutside, groundHit, CHALET, NEAR_LAYER } from './outdoors.js';
import { UI } from './ui.js';
import { lerp, clamp, TAU } from './util.js';
import { setTexScale } from './textures.js';

const params = new URLSearchParams(location.search);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const fine = matchMedia('(pointer: fine)').matches; // a mouse: look through the person's eyes, no cursor
const SHOT = params.has('shot'); // for automated screenshots: no boot, no intro

function pickQuality() {
  const small = Math.min(screen.width, screen.height) < 600;
  const q = coarse || small
    ? { name: 'low', lowH: 1400, sunShadow: 1024, lampShadow: 0, shaftSteps: 18, bloomPasses: 1, dust: 260, ao: false, tex: 1 }
    : { name: 'high', lowH: 2160, sunShadow: 2048, lampShadow: 1024, shaftSteps: 28, bloomPasses: 2, dust: 520, ao: true, tex: 2 };
  q.dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (params.get('lowh')) q.lowH = +params.get('lowh');
  return q;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Walking keys -> [forward, strafe right, turn left]. (E is for using things: see interact.) */
const WALK_KEYS = {
  w: [1, 0, 0], arrowup: [1, 0, 0],
  s: [-1, 0, 0], arrowdown: [-1, 0, 0],
  a: [0, -1, 0], d: [0, 1, 0],
  arrowleft: [0, 0, 1], arrowright: [0, 0, -1],
};
const REACH = 2.4; // on your feet, how close something has to be to use it (m)
const SEAT_EYE = 1.16; // eye height sitting in the desk chair
/** Does the segment a-b (in x, z) cross the rectangle [x0, x1] x [z0, z1]? */
function segmentHitsRect(ax, az, bx, bz, x0, x1, z0, z1) {
  let t0 = 0, t1 = 1;
  for (const [p, d, lo, hi] of [[ax, bx - ax, x0, x1], [az, bz - az, z0, z1]]) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return false;
      continue;
    }
    let a = (lo - p) / d, b = (hi - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

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
    this.keys = new Set(); // walking keys held down
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
    const fonts = Promise.all(['16px VT323', '16px "Courier Prime"', 'bold 16px "Courier Prime"', '40px UnifrakturMaguntia', 'italic 20px "EB Garamond"', '700 20px Cinzel', '900 20px Cinzel'].map((f) => document.fonts.load(f))).catch(() => null);
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
    this.dogShadow = this.makeDogShadow();
    this.outdoors = buildOutdoors({ quality: this.quality });
    this.ctx = this.world.ctx;
    this.ui.bootStep(3);
    await wait(16);

    this.captureEnvironment();
    this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.04, 40);
    this.pipeline = new RetroPipeline(this.renderer, this.world.scene, this.camera, { quality: this.quality, shaft: this.world.shaft });
    // the outdoors shows through the window, and through the door while it's open
    const z = ROOM.z0 - 0.02, door = this.ctx.door;
    this.doorPortal = { open: false, near: true, corners: [[door.z0, 0], [door.z0, door.h], [door.z1, door.h], [door.z1, 0]].map(([dz, y]) => new THREE.Vector3(ROOM.x1, y, dz)) };
    this.pipeline.outdoor = {
      scene: this.outdoors.scene,
      camera: this.outdoors.camera,
      nearLayer: NEAR_LAYER,
      portals: [
        { open: true, corners: [[WIN.x0, WIN.y0], [WIN.x1, WIN.y0], [WIN.x1, WIN.y1], [WIN.x0, WIN.y1]].map(([x, y]) => new THREE.Vector3(x, y, z)) },
        this.doorPortal,
      ],
    };
    this.doorBox = new THREE.Box3(new THREE.Vector3(ROOM.x1 - 0.05, 0, door.z0), new THREE.Vector3(CHALET.x1 + 0.05, door.h, door.z1));
    this.chaletBox = new THREE.Box3(new THREE.Vector3(CHALET.x0, -1, CHALET.z0), new THREE.Vector3(CHALET.x1, 7, CHALET.z1));
    this.pipeline.raw = params.has('raw');
    if (params.has('noshaft')) this.pipeline.compMat.uniforms.uShaft.value = 0;
    this.pipeline.shaftBase = this.pipeline.compMat.uniforms.uShaft.value;
    if (params.has('nodither')) Object.assign(this.pipeline.compMat.uniforms, { uDither: { value: 0 }, uLevels: { value: 255 } });
    this.rig = new Rig(this.camera, { reducedMotion: reduced });
    this.rig.bounds = (p) => this.walkBounds(p);
    this.views = makeViews(this.world);
    // sitting in the desk chair, wherever it's been pushed and turned (filled in as you sit down)
    this.views.seated = { pos: [0, SEAT_EYE, 0], target: [0, 1, -1], hfov: 72, vfov: 48, look: [1, 0.5], lookScale: 1 };
    this.chairGhostUntil = 0;
    this.setupHotspots();
    this.setupInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => (document.hidden ? this.pause() : this.resume()));

    this.atWindow = 0; // 0..1, eased: how close the camera is to standing at the window
    this.outside = false; // the camera is out of the office (on the balcony, in the yard)
    this.doorOpen = false; // whether the door is (or is swinging) open
    this.doorPassed = false; // you've been through it since it opened: it's pulled to once you walk on

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
    const view = envCard(); // a painted stand-in for the mountains, so reflections show a bright window
    scene.add(view);
    scene.position.y = -1.25; // capture from about chest height, above the rug
    scene.updateMatrixWorld(true);
    const env = pmrem.fromScene(scene, 0.02, 0.05, 30);
    scene.remove(view);
    scene.position.y = 0;
    scene.updateMatrixWorld(true);
    pmrem.dispose();
    scene.environment = env.texture;
    scene.environmentIntensity = 0.42;
    this.renderer.shadowMap.needsUpdate = true;
  }

  /* ---------------- hotspots ---------------- */

  setupHotspots() {
    const { ctx, books, piles, tapes, mixtapes, dog } = this.world;
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

    // label: what the prompt by the dot says you'll do (E, or a click)
    add({ id: 'terminal', label: 'Use the computer', objects: [ctx.computer.group], anchor: ctx.anchors.terminal, go: 'terminal', views: notIn('terminal') });
    piles.forEach((p) => add({ id: `pile:${p.report.id}`, label: `Read the ${p.report.company} report`, objects: [p.group], anchor: ctx.anchors[`pile:${p.report.id}`], go: `report:${p.report.id}` }));
    add({ id: 'library', label: 'Browse the books', meshes: books.books.map((b) => b.mesh), anchor: books.centre, go: 'library', views: notIn('library') });
    books.books.forEach((b) => add({ id: `book:${b.item.id}`, meshes: [b.mesh], go: `book:${b.item.id}`, views: ['library'], book: b }));
    add({ id: 'podcasts', label: 'Look through the tapes', objects: [ctx.hifi.group, ...tapes.map((t) => t.mesh), ...mixtapes.map((m) => m.mesh)], anchor: ctx.anchors.hifi, go: 'podcasts', views: notIn('podcasts') });
    tapes.forEach((t) => add({ id: `tape:${t.item.id}`, meshes: [t.mesh], go: `tape:${t.item.id}`, views: ['podcasts'], tape: t }));
    mixtapes.forEach((m) => add({ id: `song:${m.item.id}`, meshes: [m.mesh], go: `song:${m.item.id}`, views: ['podcasts'], mixtape: m }));
    add({ id: 'contact', label: 'Pick up the phone', objects: [ctx.phone.group, ctx.rolodex.group], anchor: ctx.anchors.phone, go: 'contact' });
    add({ id: 'about', label: 'About Josh', objects: [ctx.nameplate.group, ctx.photo.group], anchor: ctx.anchors.nameplate, go: 'about' });
    add({ id: 'diploma', label: 'Look at the degree', objects: [ctx.diploma.group], anchor: ctx.anchors.diploma, go: 'diploma', views: notIn('diploma') });
    // the dog is a detailed skinned model, far too slow to raycast every frame; a plain box rides along for picking
    const dogPick = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.72), new THREE.MeshBasicMaterial({ visible: false }));
    dogPick.position.set(0, 0.2, 0);
    dog.group.add(dogPick);
    add({ id: 'dog', label: 'Pet the dog', meshes: [dogPick], outline: meshes(...dog.group.children.filter((c) => c !== dogPick)), anchor: ctx.anchors.dog, action: () => dog.pet(), minor: true });
    add({ id: 'mate', label: 'Give the mate a swirl', objects: [ctx.mate.group], anchor: ctx.anchors.mate, action: () => (ctx.mate.wobble = 1), minor: true });
    add({ id: 'lamp', label: () => (ctx.lamp.on ? 'Turn the lamp off' : 'Turn the lamp on'), objects: [ctx.lamp.group], anchor: ctx.anchors.lamp, action: () => this.toggleLamp(), minor: true });
    add({ id: 'window', label: 'Look out of the window', reach: 3.2, meshes: [ctx.windowPane], anchor: new THREE.Vector3(0.6, 1.5, ROOM.z0), go: 'window', views: notIn('window', 'outside') });
    // the door out to the balcony, and from outside, back in
    add({ id: 'door', label: () => (this.doorOpen ? 'Shut the door' : 'Open the door'), objects: [ctx.door.leaf], anchor: ctx.anchors.door, action: () => this.useDoor() });
    add({ id: 'globe', label: 'Spin the globe', objects: [ctx.globe.group], anchor: ctx.anchors.globe, action: () => this.spinGlobe(), minor: true });
    // things you can move: the chair slides about the floor (and you can sit in it and swivel it
    // round), the ladder rolls along its rail; hold and look (or drag) to move them
    ctx.anchors.chair = new THREE.Vector3();
    ctx.anchors.ladder = new THREE.Vector3();
    this.updateMovableAnchors();
    add({ id: 'chair', label: 'Sit down', objects: [ctx.chair.group], anchor: ctx.anchors.chair, drag: 'chair', action: () => this.sitDown(), minor: true, views: notIn('seated') });
    add({ id: 'ladder', label: 'Hold to slide the ladder', objects: [ctx.ladder.group], anchor: ctx.anchors.ladder, drag: 'ladder', minor: true });

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
    if (this.outside) {
      // out here only the door does anything, seen from its own side of the chalet
      const c = this.camera.position;
      const at = c.x > CHALET.x1 && this.raycaster.ray.intersectBox(this.doorBox, new THREE.Vector3());
      return at ? this.inReach(this.hotspots.find((h) => h.id === 'door'), at.distanceTo(c)) : null;
    }
    for (const hit of this.raycaster.intersectObjects(this.pickables, false)) {
      const hs = this.activeHotspot(hit.object);
      if (hs) return this.inReach(hs, hit.distance);
    }
    return null;
  }

  /** On your feet (or in the chair), things only answer once you're close enough to reach them. */
  inReach(h, dist) {
    const close = this.rig.walking || this.rig.sitting || this.outside;
    return h && (!close || dist <= (h.reach || REACH)) ? h : null;
  }

  /** E: use whatever the dot's on (as a click would); sitting, with nothing in reach, get up. */
  interact() {
    if (this.hovered) this.activate(this.hovered);
    else if (this.rig.sitting) this.standUp();
  }

  /** The prompt by the dot: what E (or a click) will do. */
  updatePrompt() {
    let text = '';
    if (this.aiming && !this.rig.moving && this.state.view) {
      const h = this.hovered;
      text = h ? (typeof h.label === 'function' ? h.label() : h.label) || '' : this.rig.sitting ? 'Stand up' : '';
    }
    if (text === this.promptText) return;
    this.promptText = text;
    const el = this.promptEl || (this.promptEl = document.getElementById('act-hint'));
    if (text) el.querySelector('span').textContent = text;
    el.classList.toggle('is-on', !!text);
    document.body.classList.toggle('has-prompt', !!text);
  }

  setHover(h) {
    if (h === this.hovered) return;
    this.hovered = h;
    this.pipeline.hover = h ? h.outline || h.meshes : [];
    document.body.classList.toggle('is-pointing', !!h);
    document.body.classList.toggle('is-grabbable', !!(h && h.drag));
    this.ui.hoverItem(h);
  }

  /* ---------------- input ---------------- */

  /**
   * With a mouse you look through the person's eyes: there's no cursor over the office, just a dot
   * in the middle of the view, and hovering and clicking act on whatever it's on. A click locks the
   * pointer, so the mouse turns you as far as you like (Esc lets it go). While a panel is open the
   * cursor comes back, to use the panel and point at things on the shelf.
   */
  get aiming() {
    return fine && this.pointer.type === 'mouse' && !this.ui.panelOpen;
  }

  /** Where hovering and clicking act: the middle of the view, or the cursor while it's showing. */
  aim(e = null) {
    if (this.aiming) return [window.innerWidth / 2, window.innerHeight / 2];
    return e ? [e.clientX, e.clientY] : [this.pointer.x, this.pointer.y];
  }

  lockPointer() {
    if (!fine || this.locked || this.ui.panelOpen || !this.stage.requestPointerLock) return;
    try {
      const r = this.stage.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
    } catch (err) { /* not allowed just now (too soon after Esc): the next click will do */ }
  }

  /** Give the cursor back (a panel has opened and wants it). */
  releasePointer() {
    if (!document.pointerLockElement) return;
    this.releasing = true;
    document.exitPointerLock();
  }

  setupInput() {
    const stage = (this.stage = document.getElementById('stage'));
    const p = this.pointer;
    const toFollow = (e) => this.rig.follow((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    this.locked = false;
    this.lookPaused = false;
    this.unlockedAt = -1e9;

    stage.addEventListener('pointerdown', (e) => {
      p.down = true;
      p.moved = false;
      p.travel = 0;
      p.type = e.pointerType;
      if (!this.locked) {
        p.sx = p.x = e.clientX;
        p.sy = p.y = e.clientY;
      }
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or stale pointer */ }
      const [ax, ay] = this.aim(e);
      const h = this.state.view ? this.pick(ax, ay) : null;
      if (h && h.drag) this.startDrag(h, ax, ay);
    });
    stage.addEventListener('pointermove', (e) => {
      p.type = e.pointerType;
      p.seen = true;
      if (this.locked) {
        // mouse-look: the mouse turns the view; a drag follows the dot each frame
        p.travel += Math.abs(e.movementX) + Math.abs(e.movementY);
        if (p.down && p.travel > 10) p.moved = true;
        this.rig.mouseLook(e.movementX, e.movementY);
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.drag) {
        if (!p.moved && Math.hypot(p.x - p.sx, p.y - p.sy) > 4) p.moved = true;
        if (this.aiming) toFollow(e);
        else if (p.moved) this.moveDrag(p.x, p.y);
        return;
      }
      if (e.pointerType === 'mouse') {
        // the view follows the mouse (held still after Esc, until a click picks it back up)
        if (!(this.lookPaused && this.aiming)) toFollow(e);
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
      if (this.drag) {
        const { h } = this.drag;
        this.endDrag();
        if (!p.moved && e.type === 'pointerup') this.activate(h);
        return;
      }
      if (p.moved || e.type !== 'pointerup') return;
      const [ax, ay] = this.aim(e);
      const h = this.pick(ax, ay);
      if (h) this.activate(h);
      else {
        // on your feet (or in the overview), a click on the floor or the snow walks you there
        const v = this.state.view;
        const g = (v === 'main' || v === 'outside' || this.rig.walking) && !this.rig.moving ? this.groundPoint(ax, ay) : null;
        if (g) this.walkToPoint(g);
        else if (v && v !== 'main' && v !== 'seated' && !this.outside) this.back(); // click away to step back
      }
      // and a click puts the mouse in charge of the view (unless a panel's just opened and wants the cursor)
      if (e.pointerType === 'mouse') this.lockPointer();
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.locked) {
        this.rig.follow(0, 0);
        this.setHover(null);
        p.seen = false;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === stage;
      this.locked = this.rig.locked = locked;
      document.body.classList.toggle('is-locked', locked);
      if (locked) {
        this.rig.followOn = false;
        this.lookPaused = false;
        p.seen = true;
      } else {
        this.unlockedAt = performance.now();
        // let go with Esc: the view holds still until a click picks the mouse back up
        if (!this.releasing) this.lookPaused = true;
        this.releasing = false;
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        // the first Esc only lets the mouse go (the browser does that); the next steps back
        if (this.locked || performance.now() - this.unlockedAt < 400) return;
        this.back();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target.closest && e.target.closest('input, textarea, [contenteditable]'))) return;
      const k = e.key.toLowerCase();
      if (k === 'e' && !e.repeat) {
        this.interact();
        return;
      }
      if (WALK_KEYS[k] || k === 'shift') {
        if (k.startsWith('arrow')) e.preventDefault();
        this.keys.add(k);
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  activate(h) {
    if (h.action) h.action();
    else if (h.go) this.navigate(h.go);
  }

  /* ---------------- navigation ---------------- */

  static viewFor(target) {
    if (target.startsWith('report:')) return 'desk';
    if (target.startsWith('book:')) return 'library';
    if (target.startsWith('tape:') || target.startsWith('song:')) return 'podcasts';
    return target;
  }

  navigate(target, { fromHash = false } = {}) {
    if (!this.running || !target) return;
    // start the music right away, while the click still counts as the go-ahead for sound
    if (target.startsWith('song:')) this.playSong(target.slice(5));
    // going outside is up to you: you're walked to the door, it's opened, and the rest is yours
    if (target === 'outside') {
      if (!this.outside) this.useDoor({ open: true });
      return;
    }
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
      // from outside, back in by the door, not through the walls
      if (this.outside) this.doorOpen = true;
      this.rig.go(view, { via: this.outside ? this.doorRoute() : null, onDone: arrive });
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
    } else if (target === 'podcasts' || target.startsWith('tape:') || target.startsWith('song:')) {
      const id = target.includes(':') ? target.slice(5) : null;
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
    } else if (target === 'window') {
      this.ui.announce('At the window');

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
    if (this.rig.sitting) return this.standUp();
    if (this.outside) return this.walkBackIn();
    if (this.rig.walking) {
      // stepping back from a walk returns to the starting view
      this.rig.go(this.views.main, { onDone: () => (this.state.view = 'main') });
      return;
    }
    if (!t || t === 'main') return;
    if (t.startsWith('book:')) return this.navigate('library');
    if (t.startsWith('tape:') || t.startsWith('song:')) return this.navigate('podcasts');
    if (t.startsWith('report:')) return this.navigate('desk');
    this.navigate('main');
  }

  /** Hovering a card in the library or tape panel previews the matching 3D object. */
  previewItem(kind, id, on) {
    const list = kind === 'book' ? this.world.books.books : kind === 'song' ? this.world.mixtapes : this.world.tapes;
    const it = list.find((x) => x.item.id === id);
    if (!it) return;
    if (kind === 'song') {
      it.preview = on;
      this.pipeline.hover = on ? [it.mesh] : this.hovered ? this.hovered.meshes : [];
      return;
    }
    if (this.state.target !== `${kind}:${id}`) it.target = on ? (kind === 'book' ? 0.06 : 0.45) : 0;
    this.pipeline.hover = on ? [it.mesh] : this.hovered ? this.hovered.meshes : [];
  }

  /* ---------------- walking about ---------------- */

  /** Keys held down -> what the walker wants this frame (the rig eases into it and out of it). */
  walkFromKeys() {
    let fwd = 0, strafe = 0, turn = 0;
    for (const k of this.keys) {
      const [f, s, t] = WALK_KEYS[k] || [0, 0, 0];
      fwd += f;
      strafe += s;
      turn += t;
    }
    const any = (fwd || strafe || turn) && !this.rig.moving;
    // sitting, the arrow keys swivel the chair; anything else gets you up
    if (this.rig.sitting && !fwd && !strafe) {
      this.rig.setIntent(0, 0, clamp(turn, -1, 1), false);
      return;
    }
    if (any) {
      if (this.rig.sitting) this.standUp();
      else if (!this.rig.walking) this.startWalk();
      this.rig.auto = null; // the keys take over from a walk somewhere
    }
    this.rig.setIntent(any ? clamp(fwd, -1, 1) : 0, any ? clamp(strafe, -1, 1) : 0, any ? clamp(turn, -1, 1) : 0, this.keys.has('shift'));
  }

  /** On your feet: whatever was open closes, the view is freed, and the keys (or a walk somewhere) move you from here. */
  startWalk() {
    const prev = this.state.target, here = this.outside ? 'outside' : 'main';
    if (prev && prev !== here && prev !== 'main') {
      this.ui.closePanels();
      this.resetSelections('main');
      this.ui.setHash('main', prev);
    }
    this.state.target = this.state.view = here;
    this.rig.view = this.views[here];
    this.rig.startWalking();
  }

  /**
   * Where you can stand: inside the room, clear of the bookcases, the desk, the credenza and the
   * reading chair; and, once the door's open, out through it (see walkOutside). Returns the height
   * of the floor underfoot.
   */
  walkBounds(p) {
    const door = this.ctx.door, open = door.angle > 0.9;
    const jambs = [door.z0 + 0.2, door.z1 - 0.2];
    const atDoor = open && p.z > jambs[0] - 0.3 && p.z < jambs[1] + 0.3;
    if (p.x > ROOM.x1 || p.x < ROOM.x0 || p.z < ROOM.z0 || p.z > ROOM.z1 || (atDoor && p.x > ROOM.x1 - 0.4)) return walkOutside(p, open);
    p.x = clamp(p.x, ROOM.x0 + 0.65, atDoor ? ROOM.x1 : ROOM.x1 - 0.45);
    if (p.x > ROOM.x1 - 0.45) p.z = clamp(p.z, jambs[0], jambs[1]); // in the doorway
    p.z = clamp(p.z, ROOM.z0 + 0.6, ROOM.z1 - 0.35);
    if (p.z > -2.8 && p.z < -0.85) p.x = Math.min(p.x, ROOM.x1 - 0.8); // the credenza
    const push = (x0, x1, z0, z1) => {
      const dx0 = p.x - x0, dx1 = x1 - p.x, dz0 = p.z - z0, dz1 = z1 - p.z;
      if (dx0 <= 0 || dx1 <= 0 || dz0 <= 0 || dz1 <= 0) return;
      const m = Math.min(dx0, dx1, dz0, dz1);
      if (m === dx0) p.x = x0;
      else if (m === dx1) p.x = x1;
      else if (m === dz0) p.z = z0;
      else p.z = z1;
    };
    push(-1.35, 1.35, -1.6, 0.0); // the desk, with room for your knees
    push(-3.0, -1.6, 1.7, 3.2); // the reading nook
    // the desk chair, wherever it's been pushed (not while you're getting up out of it)
    if (this.time > this.chairGhostUntil) {
      const c = this.ctx.chair.group.position, r = 0.55;
      const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz);
      if (d < r) {
        p.x = c.x + (d > 1e-4 ? (dx / d) * r : r);
        p.z = c.z + (d > 1e-4 ? (dz / d) * r : 0);
      }
    }
    return 0;
  }

  /* ---------------- the desk chair: sit in it, swivel it ---------------- */

  /** Where your eyes are sitting in the chair: over the seat, a little back, wherever it's turned. */
  seatEye() {
    const ch = this.ctx.chair.group, ry = ch.rotation.y;
    return new THREE.Vector3(-0.04 * Math.sin(ry), SEAT_EYE, -0.04 * Math.cos(ry)).add(ch.position);
  }

  /** Sit down in the desk chair, facing the way it faces. */
  sitDown() {
    const ry = this.ctx.chair.group.rotation.y, eye = this.seatEye();
    const v = this.views.seated;
    v.pos = eye.toArray();
    v.target = eye.clone().add(new THREE.Vector3(Math.sin(ry) * 2, -0.35, Math.cos(ry) * 2)).toArray();
    const prev = this.state.target;
    if (prev && prev !== 'main') {
      this.ui.closePanels();
      this.resetSelections('main');
      this.ui.setHash('main', prev);
    }
    this.state.view = null;
    this.state.target = 'seated';
    this.setHover(null);
    this.rig.go(v, {
      duration: 1.1,
      arc: 0,
      onDone: () => {
        this.rig.sitting = true;
        this.state.view = 'seated';
        this.ui.announce('Sitting in the desk chair. Turn to swivel it round; E or W to get up.');
      },
    });
  }

  /** Get up out of the chair and step clear of it (leaving it turned the way you had it). */
  standUp() {
    const ch = this.ctx.chair.group, ry = ch.rotation.y;
    this.chairGhostUntil = this.time + 1.4;
    this.startWalk();
    const spot = ch.position.clone().add(new THREE.Vector3(Math.sin(ry) * 0.62, 0, Math.cos(ry) * 0.62));
    this.walkBounds(spot);
    this.rig.walkTo([spot]);
  }

  /** Sitting: the chair swivels round with you, a moment behind, carrying you with it. */
  swivelChair(dt) {
    const ch = this.ctx.chair.group;
    let d = (this.rig.yaw + this.rig.look.yaw * 0.6 + Math.PI - ch.rotation.y) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    if (Math.abs(d) > 1e-4) {
      ch.rotation.y += d * (reduced ? 1 : 1 - Math.exp(-dt * 6));
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.rig.pos.copy(this.seatEye());
  }

  /* ---------------- in and out of the door ---------------- */

  /** Height of the eyes of someone standing at (x, z) outside. */
  standAt(x, z) {
    return walkOutside(new THREE.Vector3(x, 0, z)) + EYE;
  }

  /** Where to stand to use the door: a step inside it, or just outside past the step. */
  doorSpot(inside) {
    const d = this.ctx.door, dz = (d.z0 + d.z1) / 2;
    return inside ? { x: ROOM.x1 - 1.0, z: dz } : { x: CHALET.x1 + 1.1, z: dz };
  }

  /**
   * The door. Within reach, open it or shut it (not while you're standing in it); further off,
   * walk over to it, on whichever side you are, and open it. Then the walking is yours.
   */
  useDoor({ open = false } = {}) {
    const d = this.ctx.door, c = this.rig.pos;
    if (this.rig.walking && Math.hypot(c.x - d.x, c.z - (d.z0 + d.z1) / 2) < 2.4) {
      const inDoorway = c.x > ROOM.x1 - 0.55 && c.x < CHALET.x1 + 0.45;
      if (open) this.doorOpen = true;
      else if (!(this.doorOpen && inDoorway)) this.doorOpen = !this.doorOpen;
      return;
    }
    this.startWalk();
    const spot = this.doorSpot(!this.outside);
    const route = this.outside ? this.roundChalet(c, spot) : this.roundDesk(c, spot);
    this.rig.walkTo([...route, spot], {
      face: this.outside ? Math.PI / 2 : -Math.PI / 2,
      onArrive: () => {
        this.doorOpen = true;
        this.ui.walkHint();
      },
    });
  }

  /** Back inside from wherever you are out here: round the chalet to the door (opening it) and a step into the room. */
  walkBackIn() {
    this.startWalk();
    const out = this.doorSpot(false), inside = this.doorSpot(true);
    this.doorOpen = true;
    this.rig.walkTo([...this.roundChalet(this.rig.pos, out), out, inside], { face: Math.PI / 2 });
  }

  /** Where the pointer meets the office floor, or the ground outside (seen through the open door, from in here); null if neither. */
  groundPoint(x, y) {
    this.pipeline.pointerToNdc(x, y, window.innerWidth, window.innerHeight, this.ndc);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const ray = this.raycaster.ray, o = ray.origin, dir = ray.direction, door = this.ctx.door;
    if (!this.outside) {
      if (dir.y > -0.02) return null;
      const p = o.clone().addScaledVector(dir, -o.y / dir.y);
      if (p.x > ROOM.x0 && p.x < ROOM.x1 && p.z > ROOM.z0 && p.z < ROOM.z1) {
        // only if it's the floor (or the rug) you're pointing at, not the desk or a chair in front of it
        const first = this.raycaster.intersectObject(this.world.scene, true).find((h) => h.object.isMesh && h.object.visible && h.object.material.visible !== false);
        return first && first.point.y < 0.06 && first.distance < 14 ? p : null;
      }
      // out through the open doorway onto the snow
      if (door.angle < 0.9 || dir.x <= 0) return null;
      const at = o.clone().addScaledVector(dir, (ROOM.x1 - o.x) / dir.x);
      if (at.z < door.z0 || at.z > door.z1 || at.y > door.h) return null;
      return groundHit(at, dir, 60);
    }
    const hit = groundHit(o, dir, 80);
    // not the ground behind the chalet's walls
    const wall = hit && ray.intersectBox(this.chaletBox, new THREE.Vector3());
    return hit && !(wall && wall.distanceTo(o) < hit.distanceTo(o)) ? hit : null;
  }

  /** Walk to a point on the floor or the snow: round the desk or the chalet, and through the door if it's on the other side. */
  walkToPoint(p) {
    const c = this.rig.pos, inRoom = p.x > ROOM.x0 && p.x < ROOM.x1 && p.z > ROOM.z0 && p.z < ROOM.z1;
    const target = p.clone();
    let pts;
    if (!this.outside && inRoom) {
      this.walkBounds(target);
      pts = [...this.roundDesk(c, target), target];
    } else if (!this.outside) {
      walkOutside(target, true);
      const inside = this.doorSpot(true), out = this.doorSpot(false);
      this.doorOpen = true;
      pts = [...this.roundDesk(c, inside), inside, out, ...this.roundChalet(out, target), target];
    } else {
      walkOutside(target, true);
      pts = [...this.roundChalet(c, target), target];
    }
    this.startWalk();
    this.rig.walkTo(pts);
  }

  /** A corner of the desk to walk round, if it stands between `from` and `to` ({ x, z }). */
  roundDesk(from, to) {
    const hit = (ax, az, bx, bz) => segmentHitsRect(ax, az, bx, bz, -1.6, 1.6, -1.85, 0.25);
    if (!hit(from.x, from.z, to.x, to.z)) return [];
    let best = null, len = Infinity;
    for (const [x, z] of [[-1.95, 0.55], [1.95, 0.55], [-1.95, -2.15], [1.95, -2.15]]) {
      if (hit(from.x, from.z, x, z) || hit(x, z, to.x, to.z)) continue;
      const l = Math.hypot(x - from.x, z - from.z) + Math.hypot(to.x - x, to.z - z);
      if (l < len) {
        len = l;
        best = { x, z };
      }
    }
    return best ? [best] : [];
  }

  /** Corners to walk round on the way from `from` to `to` ({ x, z }) if the chalet stands between them (its door is on the +x side). */
  roundChalet(from, to) {
    const C = CHALET, m = 1.5;
    const blocked = (ax, az, bx, bz) => segmentHitsRect(ax, az, bx, bz, C.x0 - 0.6, C.x1 + 0.6, C.z0 - 0.6, C.z1 + 0.6);
    if (!blocked(from.x, from.z, to.x, to.z)) return [];
    const z = from.z < (C.z0 + C.z1) / 2 ? C.z0 - m : C.z1 + m; // round the front or the back
    const corners = [];
    if (blocked(from.x, from.z, C.x1 + m, z)) corners.push({ x: C.x0 - m, z });
    corners.push({ x: C.x1 + m, z });
    return corners;
  }

  /** Waypoints for the walk back in that a jump to a view inside makes from out here: round the chalet, to the door and in. */
  doorRoute() {
    const out = this.doorSpot(false), inside = this.doorSpot(true), outY = this.standAt(out.x, out.z);
    const corners = this.roundChalet(this.rig.pos, out).map((k, i, all) => {
      const y = this.standAt(k.x, k.z), next = all[i + 1] || out;
      return { pos: [k.x, y, k.z], target: [next.x, y, next.z] };
    });
    return [...corners, { pos: [out.x, outY, out.z], target: [ROOM.x1 - 1, EYE - 0.1, out.z] }, { pos: [inside.x, EYE, inside.z], target: [ROOM.x1 - 3, EYE - 0.1, inside.z] }];
  }

  /** The door swings open or shut; walking into it pushes it open, and once you've been through and walked on, it's pulled to behind you. */
  moveDoor(dt) {
    const door = this.ctx.door, c = this.camera.position, dz = (door.z0 + door.z1) / 2;
    const far = Math.hypot(c.x - door.x, c.z - dz);
    if (!this.doorOpen && this.rig.walking && far < 1.3) {
      const v = this.rig.vel;
      if ((door.x - c.x) * v.x + (dz - c.z) * v.y > 0.25 * far) this.doorOpen = true;
    }
    if (this.doorOpen && this.doorPassed && far > 3.2) this.doorOpen = this.doorPassed = false;
    const want = this.doorOpen ? 1.35 : 0;
    if (door.angle === want) return false;
    // a swing that starts briskly and slows into place (a door's own weight and its closer)
    const diff = want - door.angle;
    const step = Math.max(Math.abs(diff) * (1 - Math.exp(-dt * 3)), dt * 0.35);
    door.angle = reduced || step >= Math.abs(diff) ? want : door.angle + Math.sign(diff) * step;
    door.setAngle(door.angle);
    this.outdoors.setDoor(door.angle);
    this.doorPortal.open = door.angle > 0.01;
    return true;
  }

  /** Out of the office: past its walls, through the door or onto the balcony. */
  isOutside() {
    const c = this.camera.position;
    return c.x > ROOM.x1 + 0.05 || c.x < ROOM.x0 || c.z < ROOM.z0 || c.z > ROOM.z1 || c.y > ROOM.h;
  }

  /* ---------------- moving the chair and the ladder ---------------- */

  /** Where the pointer meets the surface a dragged thing moves in: the floor plane at seat height, or the ladder's rail plane (in the bookcase's own space). */
  dragPoint(kind, x, y) {
    this.pipeline.pointerToNdc(x, y, window.innerWidth, window.innerHeight, this.ndc);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const plane = new THREE.Plane();
    if (kind === 'chair') plane.set(new THREE.Vector3(0, 1, 0), -0.45);
    else {
      const L = this.ctx.ladder;
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(L.track.getWorldQuaternion(new THREE.Quaternion()));
      plane.setFromNormalAndCoplanarPoint(n, L.group.getWorldPosition(new THREE.Vector3()));
    }
    const hit = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return null;
    return kind === 'chair' ? hit : this.ctx.ladder.track.worldToLocal(hit);
  }

  startDrag(h, x, y) {
    const grab = this.dragPoint(h.drag, x, y);
    if (!grab) return;
    const obj = h.drag === 'chair' ? this.ctx.chair.group : this.ctx.ladder.group;
    this.drag = { h, grab, from: obj.position.clone() };
    document.body.classList.add('is-dragging');
  }

  moveDrag(x, y) {
    const d = this.drag;
    const hit = this.dragPoint(d.h.drag, x, y);
    if (!hit) return;
    if (d.h.drag === 'chair') this.placeChair(d.from.clone().add(hit).sub(d.grab));
    else {
      const L = this.ctx.ladder;
      L.group.position.x = clamp(d.from.x + hit.x - d.grab.x, L.min, L.max);
    }
    this.updateMovableAnchors();
    this.renderer.shadowMap.needsUpdate = true;
  }

  endDrag() {
    this.drag = null;
    document.body.classList.remove('is-dragging');
  }

  /** Keep the chair on the floor, out of the walls, the bookcases and the desk. */
  placeChair(p) {
    const r = 0.32;
    p.x = clamp(p.x, -2.25, 2.2);
    p.z = clamp(p.z, ROOM.z0 + 0.55 + r, ROOM.z1 - r);
    const dx0 = p.x - (-1.0 - r), dx1 = 1.0 + r - p.x, dz0 = p.z - (-1.255 - r), dz1 = -0.305 + r - p.z;
    if (dx0 > 0 && dx1 > 0 && dz0 > 0 && dz1 > 0) {
      // inside the desk: push out the shortest way
      const m = Math.min(dx0, dx1, dz0, dz1);
      if (m === dx0) p.x -= dx0;
      else if (m === dx1) p.x += dx1;
      else if (m === dz0) p.z -= dz0;
      else p.z += dz1;
    }
    this.ctx.chair.group.position.set(p.x, 0, p.z);
  }

  updateMovableAnchors() {
    const { chair, ladder, anchors } = this.ctx;
    anchors.chair.copy(chair.group.position).setY(0.95);
    ladder.group.getWorldPosition(anchors.ladder).y = 1.3;
  }

  /* ---------------- the tape deck ---------------- */

  /** Put a mixtape in the deck: the one already in flies home first, then this one flies in and plays. */
  playSong(id) {
    const m = this.world.mixtapes.find((x) => x.item.id === id);
    if (!m || this.nowPlaying === m) return;
    if (this.nowPlaying) {
      this.nowPlaying.target = 0;
      m.wait = 0.8;
    }
    this.nowPlaying = m;
    m.target = 1;
    this.ui.playSong(m.item);
  }

  ejectSong() {
    if (!this.nowPlaying) return;
    this.nowPlaying.target = 0;
    this.nowPlaying = null;
    this.ui.stopSong();
  }

  /** A cassette's pose along its trip: up out of the holder, over to the deck, then in through the door. */
  poseMixtape(m) {
    const { mesh, home, door, homeTilt, k } = m;
    const ease = (x) => x * x * (3 - 2 * x);
    const front = door.clone().setZ(door.z + 0.1);
    if (k <= 0.7) {
      const f = ease(k / 0.7);
      mesh.position.lerpVectors(home, front, f);
      mesh.position.y += Math.sin(f * Math.PI) * 0.16 + m.hover * 0.025 * (1 - f);
      mesh.rotation.set(homeTilt * (1 - f), Math.sin(f * Math.PI) * 0.4, 0);
      mesh.scale.setScalar(1);
    } else {
      const f = ease((k - 0.7) / 0.3);
      mesh.position.lerpVectors(front, door.clone().setZ(door.z - 0.07), f);
      mesh.rotation.set(0, 0, 0);
      mesh.scale.setScalar(1 - 0.12 * f);
    }
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

  /**
   * The dog moves all the time, so rather than redraw the shadow maps every few frames for him he
   * casts no shadow of his own and carries a soft contact shadow on the floor instead.
   */
  makeDogShadow() {
    const { dog, scene } = this.world;
    dog.group.traverse((m) => m.isMesh && (m.castShadow = false));
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const geo = new THREE.PlaneGeometry(0.34 * dog.group.scale.x, 0.86 * dog.group.scale.x);
    geo.rotateX(-Math.PI / 2);
    const blob = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    blob.renderOrder = 1;
    scene.add(blob);
    return blob;
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
    this.walkFromKeys();
    if (this.rig.sitting && !this.rig.moving) this.swivelChair(dt);
    this.rig.update(dt, t);
    const doorMoved = this.moveDoor(dt);
    const outside = this.isOutside();
    if (outside !== this.outside) {
      this.outside = this.pipeline.outside = outside;
      this.doorPassed = true;
      document.body.classList.toggle('is-outside', outside);
      this.setHover(null);
      if (this.rig.walking) {
        // walked out (or in) through the door
        this.state.target = this.state.view = outside ? 'outside' : 'main';
        this.rig.view = this.views[this.state.view];
        this.ui.announce(outside ? 'Outside' : 'Back in the office');
      }
    }

    // the room moves under the cursor (or the dot), so hover is re-checked every frame
    const aiming = this.aiming;
    this.rig.held = this.lookPaused && aiming && !this.locked;
    if (aiming !== this.wasAiming) {
      this.wasAiming = aiming;
      document.body.classList.toggle('is-aiming', aiming);
    }
    if ((this.pointer.seen && this.pointer.type === 'mouse') || this.locked) {
      const [ax, ay] = this.aim();
      this.setHover(this.state.view ? this.pick(ax, ay) : null);
      // something being dragged goes where you look
      if (this.drag && aiming && this.pointer.moved) this.moveDrag(ax, ay);
    }
    this.updatePrompt();

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
    const ds = this.dogShadow;
    ds.position.set(dog.group.position.x, 0.006, dog.group.position.z);
    ds.rotation.y = dog.group.rotation.y;
    const mt = ctx.mate;
    if (mt.wobble > 0) {
      mt.wobble = Math.max(0, mt.wobble - dt * 1.2);
      const w = (1 - mt.wobble) * 22;
      mt.group.rotation.z = Math.sin(w) * 0.1 * mt.wobble;
      mt.group.rotation.x = Math.cos(w) * 0.07 * mt.wobble;
    }

    // standing in the beam at the window, thin the haze so the view stays clear
    const near = this.state.target === 'window' ? 1 : 0;
    if (Math.abs(this.atWindow - near) > 0.002) {
      this.atWindow += clamp(near - this.atWindow, -dt * 0.9, dt * 0.9);
      this.pipeline.compMat.uniforms.uShaft.value = this.pipeline.shaftBase * (1 - 0.92 * this.atWindow);
    }
    this.outdoors.update(dt, t);

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
    // mixtapes fly between their holder and the deck, and lift a little when pointed at
    for (const m of this.world.mixtapes) {
      if (m.wait > 0) {
        m.wait -= dt;
        continue;
      }
      const lift = m.target === 0 && m.k === 0 && ((this.hovered && this.hovered.mixtape === m) || m.preview) ? 1 : 0;
      if (Math.abs(m.k - m.target) > 1e-4 || Math.abs(m.hover - lift) > 0.01) {
        m.k += clamp(m.target - m.k, -dt / 1.4, dt / 1.4);
        m.hover = lerp(m.hover, lift, 1 - Math.exp(-dt * 10));
        this.poseMixtape(m);
        moved = true;
      }
    }
    // the chair swivels when clicked
    const ch = ctx.chair;
    if (Math.abs(ch.spin) > 0.002) {
      const step = ch.spin * Math.min(1, dt * 2.2);
      ch.group.rotation.y += step;
      ch.spin -= step;
      moved = true;
    }
    // shadow maps are only redrawn when something that casts one has moved
    if (moved || doorMoved) this.renderer.shadowMap.needsUpdate = true;

    // hi-fi glow pulses while a tape is "playing"
    const hf = ctx.hifi;
    hf.front.emissiveIntensity = 1.1 + (hf.playing || this.nowPlaying ? 0.5 + 0.35 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 3.1)) : 0);

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
          this.quality.lowH = Math.round(Math.min(this.quality.lowH, this.pipeline.low.y) * 0.85);
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
