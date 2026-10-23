import * as THREE from '../vendor/three.module.min.js';
import { std, box, put, rng, dynamic, TAU } from './util.js';
import * as T from './textures.js';

/* ==================================================================
   Josh's University of Waterloo degree, framed: black lacquer frame,
   black mat with a gold fillet, the UW wordmark in gold, glass in front.
   The texture is drawn twice from the same layout: once in colour and
   once as a roughness/metalness mask so the gold foil actually shines.
   ================================================================== */

const W = 1024, H = 790; // mat, in design units (aspect matches the real frame opening)
const WIN = { x0: 104, y0: 104, x1: 920, y1: 648 }; // the window cut in the mat
const BLACKLETTER = 'UnifrakturMaguntia, "Old English Text MT", serif';
const ITALIC = '"EB Garamond", Garamond, Georgia, serif';
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';

function goldGradient(g, x0, y0, x1, y1) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, '#8c6a28');
  gr.addColorStop(0.35, '#d9b864');
  gr.addColorStop(0.55, '#f0d78e');
  gr.addColorStop(0.75, '#b8923f');
  gr.addColorStop(1, '#8c6a28');
  return gr;
}

/** Draw text centred at (x, y) and scaled so it is exactly `width` wide, like the printed original. */
function fitText(g, text, x, y, width, font, { align = 'center' } = {}) {
  g.font = `100px ${font}`;
  const k = width / g.measureText(text).width;
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  g.fillText(text, 0, 0);
  g.restore();
}

function arcText(g, text, cx, cy, r, centreAngle, size, { inside = false } = {}) {
  g.font = `600 ${size}px ${SANS}`;
  const spacing = size * 0.18;
  const widths = [...text].map((ch) => g.measureText(ch).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0) - spacing;
  let a = centreAngle - ((inside ? -1 : 1) * total) / r / 2;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  [...text].forEach((ch, i) => {
    const half = widths[i] / 2 / r;
    a += (inside ? -1 : 1) * half;
    g.save();
    g.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.rotate(a + (inside ? -Math.PI / 2 : Math.PI / 2));
    g.fillText(ch, 0, 0);
    g.restore();
    a += (inside ? -1 : 1) * half;
  });
}

/** A small rampant lion silhouette, facing left, about 1 unit tall. */
function lion(g, x, y, s) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.beginPath();
  g.ellipse(0.05, 0.1, 0.18, 0.3, -0.35, 0, TAU); // body
  g.ellipse(-0.12, -0.32, 0.15, 0.14, 0, 0, TAU); // head and mane
  g.ellipse(0.12, 0.42, 0.14, 0.08, 0.3, 0, TAU); // hind leg
  g.fill();
  g.lineWidth = 0.08;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-0.1, -0.1); g.lineTo(-0.38, -0.25); // raised forepaw
  g.moveTo(-0.05, 0.05); g.lineTo(-0.32, 0.02);
  g.moveTo(0.2, 0.25); g.quadraticCurveTo(0.45, 0.1, 0.32, -0.25); // tail
  g.stroke();
  g.restore();
}

function shield(g, cx, cy, w, h) {
  g.beginPath();
  g.moveTo(cx - w / 2, cy - h / 2);
  g.lineTo(cx + w / 2, cy - h / 2);
  g.lineTo(cx + w / 2, cy + h * 0.05);
  g.quadraticCurveTo(cx + w / 2, cy + h * 0.42, cx, cy + h / 2);
  g.quadraticCurveTo(cx - w / 2, cy + h * 0.42, cx - w / 2, cy + h * 0.05);
  g.closePath();
}

/** The university arms: a shield with a chevron between three lions. */
function arms(g, cx, cy, w, h, fill, line, field) {
  shield(g, cx, cy, w, h);
  g.fillStyle = field;
  g.fill();
  g.lineWidth = Math.max(1, w * 0.05);
  g.strokeStyle = line;
  g.stroke();
  // chevron
  g.save();
  shield(g, cx, cy, w, h);
  g.clip();
  g.beginPath();
  g.moveTo(cx - w / 2, cy + h * 0.25);
  g.lineTo(cx, cy - h * 0.08);
  g.lineTo(cx + w / 2, cy + h * 0.25);
  g.lineTo(cx + w / 2, cy + h * 0.42);
  g.lineTo(cx, cy + h * 0.09);
  g.lineTo(cx - w / 2, cy + h * 0.42);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.restore();
  g.fillStyle = fill;
  g.strokeStyle = fill;
  lion(g, cx - w * 0.24, cy - h * 0.24, h * 0.3);
  lion(g, cx + w * 0.22, cy - h * 0.24, h * 0.3);
  lion(g, cx, cy + h * 0.3, h * 0.26);
}

/** Generic pen strokes standing in for the officials' signatures. */
function scribble(g, x, y, w, seed) {
  const r = rng(seed);
  g.lineWidth = 1.1;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  let px = x, py = y;
  g.moveTo(px, py);
  const n = r.int(5, 8);
  for (let i = 0; i < n; i++) {
    const nx = x + ((i + 1) / n) * w;
    const ny = y + r.range(-5, 3);
    g.bezierCurveTo(px + r.range(0, 8), py - r.range(4, 12), nx - r.range(0, 8), ny + r.range(2, 9), nx, ny);
    px = nx;
    py = ny;
  }
  g.stroke();
}

/**
 * Draw the mat + diploma. mode 'color' paints the real colours; mode 'spec' paints a mask:
 * green = roughness (bright = rough), blue = metalness, so only the gold foil is metallic.
 */
function drawDiploma(g, mode) {
  const spec = mode === 'spec';
  const GOLD_SPEC = 'rgb(0, 95, 255)';
  const gold = (x0, y0, x1, y1) => (spec ? GOLD_SPEC : goldGradient(g, x0, y0, x1, y1));
  const ink = (c) => (spec ? 'rgba(0,0,0,0)' : c);

  // black mat board
  g.fillStyle = spec ? 'rgb(0, 245, 0)' : '#111113';
  g.fillRect(0, 0, W, H);
  if (!spec) {
    const r = rng(9);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = r.chance(0.5) ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.25)';
      g.fillRect(r() * W, r() * H, 1, 1);
    }
  }

  // gold fillet around the window, then the white bevel of the mat cut
  g.fillStyle = gold(WIN.x0, WIN.y0, WIN.x1, WIN.y1);
  g.fillRect(WIN.x0, WIN.y0, WIN.x1 - WIN.x0, WIN.y1 - WIN.y0);
  g.fillStyle = spec ? 'rgb(0, 220, 0)' : '#f6f2e8';
  g.fillRect(WIN.x0 + 6, WIN.y0 + 6, WIN.x1 - WIN.x0 - 12, WIN.y1 - WIN.y0 - 12);
  // the diploma paper
  const P = { x0: WIN.x0 + 9, y0: WIN.y0 + 9, x1: WIN.x1 - 9, y1: WIN.y1 - 9 };
  if (!spec) {
    const paper = g.createLinearGradient(P.x0, P.y0, P.x1, P.y1);
    paper.addColorStop(0, '#f3eee2');
    paper.addColorStop(1, '#ebe5d6');
    g.fillStyle = paper;
    g.fillRect(P.x0, P.y0, P.x1 - P.x0, P.y1 - P.y0);
    g.fillStyle = 'rgba(0,0,0,0.12)'; // shadow of the bevel on the paper
    g.fillRect(P.x0, P.y0, P.x1 - P.x0, 2);
    g.fillRect(P.x0, P.y0, 2, P.y1 - P.y0);
  }

  const cx = (WIN.x0 + WIN.x1) / 2;
  const wy = (f) => WIN.y0 + f * (WIN.y1 - WIN.y0);
  const ww = (f) => f * (WIN.x1 - WIN.x0);

  // lettering
  g.fillStyle = ink('#3a3836');
  fitText(g, 'University of Waterloo', cx, wy(0.2), ww(0.528), BLACKLETTER);
  g.fillStyle = ink('#222');
  fitText(g, 'The Senate confirms that', cx, wy(0.305), ww(0.18), ITALIC);
  g.fillStyle = ink('#1b1a19');
  fitText(g, 'Joshua David Keizer McKee', cx, wy(0.372), ww(0.414), BLACKLETTER);
  g.fillStyle = ink('#222');
  fitText(g, 'is admitted to the degree', cx, wy(0.42), ww(0.176), ITALIC);
  g.fillStyle = ink('#1b1a19');
  fitText(g, 'Bachelor of Mathematics', cx, wy(0.483), ww(0.345), BLACKLETTER);
  g.fillStyle = ink('#222');
  fitText(g, 'Honours Mathematics/Financial Analysis & Risk Management-Chartered Financial Analyst', cx, wy(0.532), ww(0.674), ITALIC);
  fitText(g, 'Specialization - Computing Minor - Co-operative Program', cx, wy(0.567), ww(0.423), ITALIC);
  fitText(g, "(Dean's Honours)", cx, wy(0.6), ww(0.126), ITALIC);
  fitText(g, 'with all associated rights, privileges and obligations.', cx, wy(0.652), ww(0.262), ITALIC);

  // signatures and titles
  g.strokeStyle = ink('#1c1f2a');
  const lx = WIN.x0 + ww(0.183);
  scribble(g, lx + 4, wy(0.77), 92, 3);
  scribble(g, lx + 6, wy(0.845), 74, 7);
  const rx = WIN.x0 + ww(0.82);
  scribble(g, rx - 82, wy(0.772), 80, 11);
  g.fillStyle = ink('#333');
  g.font = `500 6px ${SANS}`;
  g.textAlign = 'left';
  g.fillText('PRESIDENT AND VICE-CHANCELLOR', lx, wy(0.8));
  g.fillText('UNIVERSITY REGISTRAR', lx, wy(0.874));
  g.textAlign = 'right';
  g.fillText('DEAN, FACULTY OF MATHEMATICS', rx, wy(0.8));
  g.fillText('THIS FIRST DAY OF JUNE', rx, wy(0.902));
  g.fillText('TWO THOUSAND TWENTY-SIX', rx, wy(0.918));

  // the gold seal
  const sy = wy(0.793), R = 58;
  g.fillStyle = gold(cx - R, sy - R, cx + R, sy + R);
  g.beginPath();
  g.arc(cx, sy, R, 0, TAU);
  g.fill();
  g.fillStyle = spec ? 'rgb(0, 220, 0)' : '#efe9da';
  g.beginPath();
  g.arc(cx, sy, R - 3, 0, TAU);
  g.fill();
  g.fillStyle = gold(cx - R, sy - R, cx + R, sy + R);
  g.beginPath();
  g.arc(cx, sy, R - 4.5, 0, TAU);
  g.arc(cx, sy, R - 17, 0, TAU, true);
  g.fill();
  g.fillStyle = spec ? 'rgb(0, 220, 0)' : '#efe9da';
  arcText(g, 'UNIVERSITY OF WATERLOO', cx, sy, R - 10.8, -Math.PI / 2, 8.6);
  arcText(g, 'CONCORDIA CUM VERITATE', cx, sy, R - 10.8, Math.PI / 2, 6.6, { inside: true });
  const goldInk = spec ? GOLD_SPEC : '#a8873c';
  g.strokeStyle = goldInk;
  g.lineWidth = 1.2;
  g.beginPath();
  g.arc(cx, sy, R - 19.5, 0, TAU);
  g.stroke();
  arms(g, cx, sy - 1, 38, 44, goldInk, goldInk, spec ? 'rgb(0, 220, 0)' : '#f3ecdc');

  // the UW wordmark on the mat
  const ly = 700;
  arms(g, 422, ly, 30, 36, gold(400, ly - 18, 440, ly + 18), gold(400, ly - 18, 440, ly + 18), spec ? 'rgb(0, 245, 0)' : '#111113');
  g.fillStyle = gold(445, ly - 20, 620, ly + 20);
  g.textAlign = 'left';
  g.font = `700 11px ${SANS}`;
  const tracking = (text, x, y, sp) => {
    let px = x;
    for (const ch of text) {
      g.fillText(ch, px, y);
      px += g.measureText(ch).width + sp;
    }
  };
  tracking('UNIVERSITY OF', 452, ly - 7, 2.6);
  g.font = `800 25px ${SANS}`;
  tracking('WATERLOO', 450, ly + 16, 0.6);
}

export function diplomaTextures() {
  const [c, g] = T.makeCanvas(W, H);
  drawDiploma(g, 'color');
  const [s, sg] = T.makeCanvas(W, H, Math.min(1, T.texScale()));
  drawDiploma(sg, 'spec');
  const map = T.toTexture(c);
  const specMap = T.toTexture(s, { srgb: false });
  return { map, specMap, aspect: W / H };
}

/**
 * Build the framed diploma on a wall group (local +z out of the wall, local x along it).
 * Returns the group so it can be made clickable.
 */
export function buildDiploma(parent, { x, y, width = 0.54 }) {
  const g = dynamic(new THREE.Group());
  g.position.set(x, y, 0);
  g.name = 'diploma';
  parent.add(g);
  const { map, specMap, aspect } = diplomaTextures();
  const w = width, h = width / aspect;
  const art = std({ map, roughnessMap: specMap, metalnessMap: specMap, roughness: 0.92, metalness: 1, envMapIntensity: 1.3 });
  put(g, new THREE.PlaneGeometry(w, h), art, [0, 0, 0.012], { cast: false });
  box(g, w + 0.01, h + 0.01, 0.01, std({ color: '#0b0b0c', roughness: 0.9 }), [0, 0, 0.005], { cast: false }); // backing

  // black lacquer frame with a stepped profile
  const lacquer = std({ color: '#0c0c0e', roughness: 0.22, metalness: 0.15 });
  const b = 0.05, d = 0.034, lip = 0.014;
  box(g, w + b * 2, b, d, lacquer, [0, h / 2 + b / 2, d / 2]);
  box(g, w + b * 2, b, d, lacquer, [0, -h / 2 - b / 2, d / 2]);
  box(g, b, h, d, lacquer, [-w / 2 - b / 2, 0, d / 2]);
  box(g, b, h, d, lacquer, [w / 2 + b / 2, 0, d / 2]);
  // raised inner lip
  box(g, w + lip * 2, lip, d + 0.008, lacquer, [0, h / 2 + lip / 2, (d + 0.008) / 2]);
  box(g, w + lip * 2, lip, d + 0.008, lacquer, [0, -h / 2 - lip / 2, (d + 0.008) / 2]);
  box(g, lip, h, d + 0.008, lacquer, [-w / 2 - lip / 2, 0, (d + 0.008) / 2]);
  box(g, lip, h, d + 0.008, lacquer, [w / 2 + lip / 2, 0, (d + 0.008) / 2]);
  // outer bead
  const bead = 0.008;
  box(g, w + b * 2 + bead, bead, d + 0.004, lacquer, [0, h / 2 + b, (d + 0.004) / 2]);
  box(g, w + b * 2 + bead, bead, d + 0.004, lacquer, [0, -h / 2 - b, (d + 0.004) / 2]);
  box(g, bead, h + b * 2, d + 0.004, lacquer, [-w / 2 - b, 0, (d + 0.004) / 2]);
  box(g, bead, h + b * 2, d + 0.004, lacquer, [w / 2 + b, 0, (d + 0.004) / 2]);

  // glass: adds only reflections of the room and the picture light, like real picture glass
  const glass = new THREE.MeshStandardMaterial({
    color: '#000000', roughness: 0.1, metalness: 0, envMapIntensity: 0.9,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pane = put(g, new THREE.PlaneGeometry(w, h), glass, [0, 0, 0.03], { cast: false, receive: false });
  pane.renderOrder = 2;
  return { group: g, size: [w + b * 2, h + b * 2] };
}
