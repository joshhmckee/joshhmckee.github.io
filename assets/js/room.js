import * as THREE from '../vendor/three.module.min.js';
import { ROOM, WIN, SUN_DIR } from './layout.js';
import { std, basic, box, boxB, cyl, put, tiledBox, dynamic, rng, TAU } from './util.js';
import * as T from './textures.js';

/**
 * Room shell: floor, ceiling, walls, mouldings, the picture window and its
 * drapes, radiator, door, ceiling fan, and the scene lights.
 */
export function buildRoom(ctx) {
  const { scene, mats } = ctx;
  const { x0, x1, z0, z1, h, wall } = ROOM;
  const W = x1 - x0, D = z1 - z0;

  /* ---------------- floor & ceiling ---------------- */
  const parquet = T.parquetTex();
  parquet.repeat.set(W / 1.2, D / 1.2);
  mats.floor = std({ map: parquet, roughness: 0.55, metalness: 0.0 });
  const floor = put(scene, new THREE.PlaneGeometry(W, D), mats.floor, [0, 0, (z0 + z1) / 2], { r: [-Math.PI / 2, 0, 0], cast: false });
  floor.name = 'floor';

  const plaster = T.plasterTex('#cbbd9f');
  plaster.repeat.set(W / 0.8, D / 0.8);
  mats.ceiling = std({ map: plaster, roughness: 1 });
  put(scene, new THREE.PlaneGeometry(W, D), mats.ceiling, [0, h, (z0 + z1) / 2], { r: [Math.PI / 2, 0, 0], cast: true });

  /* ---------------- walls ---------------- */
  const paper = T.wallpaperTex();
  mats.wallpaper = std({ map: paper, roughness: 0.92 });
  const wallBox = (w, hh, d, pos) => {
    const g = tiledBox(w, hh, d, 2.0);
    return put(scene, g, mats.wallpaper, pos, { cast: true });
  };
  const wz = z0 - wall / 2; // back wall centre plane
  // back wall around the window opening
  wallBox(WIN.x0 - x0 + wall, h, wall, [(x0 - wall + WIN.x0) / 2, h / 2, wz]);
  wallBox(x1 + wall - WIN.x1, h, wall, [(WIN.x1 + x1 + wall) / 2, h / 2, wz]);
  wallBox(WIN.x1 - WIN.x0, WIN.y0, wall, [0, WIN.y0 / 2, wz]);
  wallBox(WIN.x1 - WIN.x0, h - WIN.y1, wall, [0, (WIN.y1 + h) / 2, wz]);
  // side walls (right wall has a door opening)
  wallBox(wall, h, D + wall * 2, [x0 - wall / 2, h / 2, (z0 + z1) / 2]);
  const door = { z0: 0.65, z1: 1.6, h: 2.1 };
  wallBox(wall, h, door.z0 - z0 + wall, [x1 + wall / 2, h / 2, (z0 - wall + door.z0) / 2]);
  wallBox(wall, h, z1 + wall - door.z1, [x1 + wall / 2, h / 2, (door.z1 + z1 + wall) / 2]);
  wallBox(wall, h - door.h, door.z1 - door.z0, [x1 + wall / 2, (door.h + h) / 2, (door.z0 + door.z1) / 2]);
  // front wall
  wallBox(W + wall * 2, h, wall, [0, h / 2, z1 + wall / 2]);

  /* ---------------- wood: wainscot, rails, crown ---------------- */
  const woodLight = T.woodTex({ light: '#6e3a22', dark: '#331709', seed: 3 });
  mats.trim = std({ map: woodLight, roughness: 0.55 });
  const panel = T.panelTex({ light: '#6a3420', dark: '#2a1209', seed: 8 });
  panel.repeat.set(1, 1);
  mats.panel = std({ map: panel, roughness: 0.6 });

  const wains = 0.95;
  // right wall wainscot segments (around the door), front wall, back wall under window
  const wainscotRun = (axis, a, b, fixed, face) => {
    const len = b - a;
    if (len <= 0.05) return;
    const n = Math.max(1, Math.round(len / 0.62));
    const pw = len / n;
    for (let i = 0; i < n; i++) {
      const c = a + pw * (i + 0.5);
      if (axis === 'z') box(scene, 0.025, wains - 0.16, pw - 0.004, mats.panel, [fixed - face * 0.0125, 0.16 + (wains - 0.16) / 2, c]);
      else box(scene, pw - 0.004, wains - 0.16, 0.025, mats.panel, [c, 0.16 + (wains - 0.16) / 2, fixed - face * 0.0125]);
    }
    if (axis === 'z') {
      box(scene, 0.04, 0.045, len, mats.trim, [fixed - face * 0.02, wains, (a + b) / 2]);
      box(scene, 0.03, 0.16, len, mats.trim, [fixed - face * 0.015, 0.08, (a + b) / 2]);
    } else {
      box(scene, len, 0.045, 0.04, mats.trim, [(a + b) / 2, wains, fixed - face * 0.02]);
      box(scene, len, 0.16, 0.03, mats.trim, [(a + b) / 2, 0.08, fixed - face * 0.015]);
    }
  };
  wainscotRun('z', z0, door.z0 - 0.08, x1, 1);
  wainscotRun('z', door.z1 + 0.08, z1, x1, 1);
  wainscotRun('x', x0, x1, z1, 1);
  wainscotRun('x', WIN.x0, WIN.x1, z0, -1);
  wainscotRun('z', 1.7, z1, x0, -1);

  // crown moulding around the whole room
  const crown = (len, pos, alongX) => {
    if (alongX) {
      box(scene, len, 0.11, 0.07, mats.trim, [pos[0], h - 0.055, pos[2]], { cast: false });
      box(scene, len, 0.04, 0.12, mats.trim, [pos[0], h - 0.02, pos[2]], { cast: false });
    } else {
      box(scene, 0.07, 0.11, len, mats.trim, [pos[0], h - 0.055, pos[2]], { cast: false });
      box(scene, 0.12, 0.04, len, mats.trim, [pos[0], h - 0.02, pos[2]], { cast: false });
    }
  };
  crown(W, [0, 0, z0 + 0.035], true);
  crown(W, [0, 0, z1 - 0.035], true);
  crown(D, [x0 + 0.035, 0, (z0 + z1) / 2], false);
  crown(D, [x1 - 0.035, 0, (z0 + z1) / 2], false);

  /* ---------------- window ---------------- */
  const winW = WIN.x1 - WIN.x0, winH = WIN.y1 - WIN.y0;
  // jambs, head, stool (sill) and apron
  box(scene, 0.07, winH, wall + 0.02, mats.trim, [WIN.x0 + 0.035, WIN.y0 + winH / 2, wz]);
  box(scene, 0.07, winH, wall + 0.02, mats.trim, [WIN.x1 - 0.035, WIN.y0 + winH / 2, wz]);
  box(scene, winW, 0.07, wall + 0.02, mats.trim, [0, WIN.y1 - 0.035, wz]);
  box(scene, winW + 0.24, 0.04, wall + 0.12, mats.trim, [0, WIN.y0 - 0.02, wz + 0.05]);
  box(scene, winW + 0.1, 0.1, 0.025, mats.trim, [0, WIN.y0 - 0.09, z0 + 0.012]);
  // casing on the inner wall face
  box(scene, 0.1, winH + 0.2, 0.03, mats.trim, [WIN.x0 - 0.05, WIN.y0 + winH / 2 + 0.05, z0 + 0.015]);
  box(scene, 0.1, winH + 0.2, 0.03, mats.trim, [WIN.x1 + 0.05, WIN.y0 + winH / 2 + 0.05, z0 + 0.015]);
  box(scene, winW + 0.3, 0.12, 0.035, mats.trim, [0, WIN.y1 + 0.06, z0 + 0.017]);

  // a single picture-window pane in a slim painted frame: nothing crossing the view
  mats.sash = std({ color: '#d8ccb0', roughness: 0.6 });
  const sz = z0 - wall * 0.62;
  const sx0 = WIN.x0 + 0.07, sx1 = WIN.x1 - 0.07, sy0 = WIN.y0, sy1 = WIN.y1 - 0.07;
  const sw = sx1 - sx0, sh = sy1 - sy0, mid = (sy0 + sy1) / 2;
  box(scene, sw, 0.05, 0.05, mats.sash, [0, sy0 + 0.025, sz]);
  box(scene, sw, 0.05, 0.05, mats.sash, [0, sy1 - 0.025, sz]);
  box(scene, 0.05, sh, 0.05, mats.sash, [sx0 + 0.025, mid, sz]);
  box(scene, 0.05, sh, 0.05, mats.sash, [sx1 - 0.025, mid, sz]);

  /* ---------------- outside ---------------- */
  // The mountain view is a separate scene (see outdoors.js), drawn first through the window opening.
  // This invisible pane makes the window itself clickable.
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(WIN.x1 - WIN.x0, WIN.y1 - WIN.y0), new THREE.MeshBasicMaterial({ visible: false }));
  pane.position.set(0, (WIN.y0 + WIN.y1) / 2, z0 - 0.06);
  pane.name = 'windowPane';
  dynamic(pane);
  scene.add(pane);
  ctx.windowPane = pane;

  /* ---------------- drapes ---------------- */
  mats.velvet = std({ color: '#5e1518', roughness: 0.85, side: THREE.DoubleSide });
  const drape = (cx, flip) => {
    const g = new THREE.PlaneGeometry(0.5, 2.82, 28, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const gather = 1 - (y + 1.41) / 2.82; // folds deepen toward the top
      p.setZ(i, Math.sin((x + 0.25) * 38) * (0.022 + 0.01 * gather) + (flip ? -1 : 1) * x * 0.03);
    }
    g.computeVertexNormals();
    return put(scene, g, mats.velvet, [cx, 1.44, z0 + 0.09], { cast: true });
  };
  drape(-1.35, false);
  drape(1.35, true);
  mats.brass = std({ color: '#b48a3c', roughness: 0.32, metalness: 0.75 });
  const rod = cyl(scene, 0.016, 0.016, 3.5, 10, mats.brass, [0, 2.88, z0 + 0.1], { r: [0, 0, Math.PI / 2] });
  void rod;
  for (const s of [-1, 1]) put(scene, new THREE.SphereGeometry(0.035, 10, 8), mats.brass, [s * 1.76, 2.88, z0 + 0.1]);

  /* ---------------- radiator under the window ---------------- */
  mats.iron = std({ color: '#a39d8e', roughness: 0.5, metalness: 0.35 });
  const rad = new THREE.Group();
  scene.add(rad);
  const sections = 17;
  for (let i = 0; i < sections; i++) {
    const rx = -0.7 + (i / (sections - 1)) * 1.4;
    boxB(rad, 0.055, 0.6, 0.15, mats.iron, [rx, 0.08, z0 + 0.16]);
  }
  box(rad, 1.48, 0.04, 0.12, mats.iron, [0, 0.66, z0 + 0.16]);
  box(rad, 1.48, 0.04, 0.12, mats.iron, [0, 0.12, z0 + 0.16]);
  for (const s of [-1, 1]) boxB(rad, 0.05, 0.08, 0.13, mats.iron, [s * 0.68, 0, z0 + 0.16]);
  cyl(rad, 0.02, 0.02, 0.1, 8, mats.brass, [0.8, 0.2, z0 + 0.16]);

  /* ---------------- door (right wall): it leads outside, and swings open as you walk up to it ---------------- */
  const dz = (door.z0 + door.z1) / 2, dw = door.z1 - door.z0;
  mats.doorWood = std({ map: T.woodTex({ light: '#5a2e1a', dark: '#2a1208', seed: 21 }), roughness: 0.55 });
  const dx = x1 - 0.04;
  // the leaf hangs from hinges on the far side from the knob and swings into the room
  const leaf = dynamic(new THREE.Group());
  leaf.position.set(dx, 0, door.z1);
  leaf.name = 'door';
  scene.add(leaf);
  box(leaf, 0.05, 1.05, dw, mats.panel, [0, 0.525, -dw / 2]);
  box(leaf, 0.05, 0.16, dw, mats.doorWood, [0, 1.13, -dw / 2]);
  box(leaf, 0.05, 0.12, dw, mats.doorWood, [0, door.h - 0.06, -dw / 2]);
  box(leaf, 0.05, door.h - 1.21 - 0.12, 0.12, mats.doorWood, [0, 1.21 + (door.h - 1.33) / 2, -dw + 0.06]);
  box(leaf, 0.05, door.h - 1.21 - 0.12, 0.12, mats.doorWood, [0, 1.21 + (door.h - 1.33) / 2, -0.06]);
  const glassMat = std({ map: T.doorGlassTex(), emissive: '#ffe2b0', emissiveIntensity: 0.55, roughness: 0.3 });
  glassMat.emissiveMap = glassMat.map;
  const glass = box(leaf, 0.012, door.h - 1.33, dw - 0.24, glassMat, [0, 1.21 + (door.h - 1.33) / 2, -dw / 2], { cast: false });
  glass.name = 'doorGlass';
  put(leaf, new THREE.SphereGeometry(0.03, 10, 8), mats.brass, [-0.06, 1.0, -dw + 0.1]);
  box(leaf, 0.008, 0.16, 0.05, mats.brass, [-0.028, 1.0, -dw + 0.1]);
  // casing
  box(scene, 0.03, door.h + 0.1, 0.1, mats.trim, [x1 - 0.015, (door.h + 0.1) / 2, door.z0 - 0.05]);
  box(scene, 0.03, door.h + 0.1, 0.1, mats.trim, [x1 - 0.015, (door.h + 0.1) / 2, door.z1 + 0.05]);
  box(scene, 0.035, 0.12, dw + 0.24, mats.trim, [x1 - 0.017, door.h + 0.08, dz]);
  ctx.anchors.door = new THREE.Vector3(x1 - 0.05, 1.5, dz);
  /** angle: 0 shut, ~1.4 wide open (radians, into the room). */
  ctx.door = { glass, leaf, angle: 0, x: x1, z0: door.z0, z1: door.z1, h: door.h, setAngle: (a) => (leaf.rotation.y = a) };

  /* ---------------- ceiling fan ---------------- */
  const fan = dynamic(new THREE.Group());
  fan.position.set(0, h, -0.55);
  scene.add(fan);
  mats.darkBrass = std({ color: '#6b5428', roughness: 0.4, metalness: 0.7 });
  cyl(fan, 0.07, 0.08, 0.05, 12, mats.darkBrass, [0, -0.025, 0], { cast: false });
  cyl(fan, 0.012, 0.012, 0.34, 6, mats.darkBrass, [0, -0.2, 0], { cast: false });
  cyl(fan, 0.13, 0.11, 0.12, 14, mats.darkBrass, [0, -0.42, 0], { cast: false });
  const rotor = new THREE.Group();
  rotor.position.y = -0.47;
  fan.add(rotor);
  const blade = std({ map: woodLight, roughness: 0.5 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const arm = new THREE.Group();
    arm.rotation.y = a;
    rotor.add(arm);
    box(arm, 0.16, 0.012, 0.03, mats.darkBrass, [0.17, 0, 0], { cast: false });
    box(arm, 0.56, 0.008, 0.13, blade, [0.5, -0.004, 0], { r: [0.12, 0, 0], cast: false });
  }
  // the frosted bowl is lit: a soft warm glow over the whole room
  const bowl = std({ color: '#efe3c4', roughness: 0.3, emissive: '#ffcf8a', emissiveIntensity: 1.0, transparent: true, opacity: 0.92 });
  put(fan, new THREE.SphereGeometry(0.11, 14, 8, 0, TAU, Math.PI / 2, Math.PI / 2), bowl, [0, -0.5, 0], { cast: false });
  const fanLight = new THREE.PointLight('#ffcb86', 1.7, 7.5, 1.3);
  fanLight.position.set(0, -0.62, 0);
  fan.add(fanLight);
  ctx.fan = { rotor, bowl };

  /* ---------------- lights ---------------- */
  const sun = new THREE.DirectionalLight('#ffbd78', 3.8);
  const target = new THREE.Object3D();
  target.position.set(0.6, 0.6, -0.4);
  scene.add(target);
  sun.target = target;
  sun.position.copy(target.position).addScaledVector(SUN_DIR, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(ctx.quality.sunShadow, ctx.quality.sunShadow);
  const sc = sun.shadow.camera;
  sc.left = -3.2; sc.right = 3.2; sc.top = 3.2; sc.bottom = -3.2; sc.near = 4; sc.far = 18;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.015;
  scene.add(sun);

  // warm ambient: lamplight bouncing off wood and plaster rather than a cool sky
  const hemi = new THREE.HemisphereLight('#ffdcb0', '#3e2416', 0.42);
  scene.add(hemi);
  // the rest of the light comes from the lamps themselves and the baked environment's soft bounce
  ctx.lights = { sun, hemi, fan: fanLight };

  void rng;
  void basic;
}
