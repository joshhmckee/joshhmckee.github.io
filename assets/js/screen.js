import { makeCanvas, toTexture } from './textures.js';

const W = 320, H = 240;
const M = 14; // safe margin inside the CRT glass
const FG = '#46ff86', DIM = '#1f9a4c', BG = '#03100a';

/** Re-draw a chart image as phosphor pixels (bars light up, paper goes dark). */
function phosphorChart(img, w, h) {
  const [c, g] = makeCanvas(w, h);
  g.fillStyle = BG;
  g.fillRect(0, 0, w, h);
  if (!img) return c;
  const [t, tg] = makeCanvas(w, h);
  tg.imageSmoothingEnabled = true;
  try {
    tg.drawImage(img, 0, 0, w, h);
  } catch (e) {
    return c;
  }
  const src = tg.getImageData(0, 0, w, h);
  const out = g.getImageData(0, 0, w, h);
  for (let i = 0; i < src.data.length; i += 4) {
    const r = src.data[i], gg = src.data[i + 1], b = src.data[i + 2];
    const lum = (0.299 * r + 0.587 * gg + 0.114 * b) / 255;
    const sat = (Math.max(r, gg, b) - Math.min(r, gg, b)) / 255;
    const ink = Math.max(1 - lum, sat);
    if (ink > 0.22) {
      const k = Math.min(1, 0.45 + ink);
      out.data[i] = 70 * k;
      out.data[i + 1] = 255 * k;
      out.data[i + 2] = 134 * k;
    }
  }
  g.putImageData(out, 0, 0);
  return c;
}

export class CRTScreen {
  constructor(reports, images) {
    const [c, g] = makeCanvas(W, H);
    this.canvas = c;
    this.g = g;
    this.texture = toTexture(c, { mip: false });
    this.reports = reports;
    this.charts = reports.map((r) => phosphorChart(images[`report:${r.id}`], 150, 64));
    this.last = -1;
    this.mode = 'idle';
  }

  update(time) {
    if (time - this.last < 0.09) return;
    this.last = time;
    this.draw(time);
    this.glass();
    this.texture.needsUpdate = true;
  }

  /** Rounded CRT corners and a soft falloff toward the edge of the tube. */
  glass() {
    if (!this.mask) {
      const [m, mg] = makeCanvas(W, H);
      const v = mg.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,0.6)');
      mg.fillStyle = v;
      mg.fillRect(0, 0, W, H);
      mg.fillStyle = '#000';
      mg.beginPath();
      mg.rect(0, 0, W, H);
      roundedRect(mg, 3, 3, W - 6, H - 6, 26);
      mg.fill('evenodd');
      this.mask = m;
    }
    this.g.drawImage(this.mask, 0, 0);
  }

  text(s, x, y, col = FG, size = 16) {
    this.g.fillStyle = col;
    this.g.font = `${size}px VT323, monospace`;
    this.g.fillText(s, x, y);
  }

  draw(time) {
    const g = this.g;
    g.fillStyle = BG;
    g.fillRect(0, 0, W, H);
    // header bar
    g.fillStyle = FG;
    g.fillRect(M - 4, 8, W - 2 * M + 8, 17);
    const now = new Date();
    const date = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${String(now.getFullYear()).slice(2)}`;
    this.text('THE DEEP VIEW \u00b7 RESEARCH', M, 21, BG);
    this.text(date, W - M - 56, 21, BG);

    if (this.mode === 'session') {
      this.text('SESSION IN USE', M, 50);
      this.text('> ' + '\u2588'.repeat(Math.floor(time * 6) % 2), M, 70);
      return;
    }

    this.text('C:\\RESEARCH> DIR /COVERAGE', M, 44, DIM);
    const n = this.reports.length;
    const cycle = 7;
    const idx = n ? Math.floor(time / cycle) % n : 0;
    const local = time % cycle;
    this.reports.slice(0, 4).forEach((r, i) => {
      const y = 62 + i * 15;
      const sel = i === idx;
      if (sel) {
        g.fillStyle = '#0d3a1f';
        g.fillRect(M - 2, y - 11, W - 2 * M + 4, 14);
      }
      this.text(`${sel ? '>' : ' '} ${r.ticker.padEnd(5)} ${r.dateShort}  ${r.company.toUpperCase().slice(0, 16)}`, M, y, sel ? FG : DIM);
    });
    const rep = this.reports[idx];
    if (!rep) return;
    const y0 = 62 + Math.min(n, 4) * 15 + 6;
    g.fillStyle = DIM;
    g.fillRect(M, y0 - 6, W - 2 * M, 1);
    // type the title out
    const title = rep.title.toUpperCase();
    const shown = Math.floor(Math.min(1, local / 2.2) * title.length);
    const lines = wrap(title.slice(0, shown), 34);
    lines.slice(0, 2).forEach((l, i) => this.text(l, M, y0 + 12 + i * 14));
    const chart = this.charts[idx];
    if (chart && local > 2.4) {
      const reveal = Math.min(1, (local - 2.4) / 1.6);
      g.drawImage(chart, 0, 0, chart.width * reveal, chart.height, M + 2, y0 + 34, chart.width * reveal, chart.height);
      g.strokeStyle = DIM;
      g.strokeRect(M + 1.5, y0 + 33.5, chart.width + 1, chart.height + 1);
      this.text(rep.dek ? wrap(rep.dek.toUpperCase(), 15)[0] : '', 164, y0 + 46, DIM);
      this.text(rep.dek ? (wrap(rep.dek.toUpperCase(), 15)[1] || '') : '', 164, y0 + 60, DIM);
      this.text('[ENTER] OPEN', 164, y0 + 86, FG);
    }
    // prompt with blinking cursor
    const cursor = Math.floor(time * 2.5) % 2 ? '\u2588' : ' ';
    this.text(`C:\\RESEARCH> ${cursor}`, M, H - 14, DIM);
  }
}

function wrap(s, n) {
  const words = s.split(' ');
  const out = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > n) {
      out.push(line.trim());
      line = w;
    } else line += ' ' + w;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}

/** Canvas roundRect() is missing in older Safari; arcs work everywhere. */
function roundedRect(g, x, y, w, h, r) {
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
