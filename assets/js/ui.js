import * as THREE from '../vendor/three.module.min.js';
import { Jukebox } from './music.js';

const PANEL_FOR = (target) => {
  if (!target) return null;
  if (target === 'terminal') return 'terminal';
  if (target.startsWith('report:')) return 'paper';
  if (target === 'library' || target.startsWith('book:')) return 'library';
  if (target === 'podcasts' || target.startsWith('tape:') || target.startsWith('song:')) return 'podcasts';
  if (target === 'contact' || target === 'about') return target;
  return null;
};

const HASH_FOR = (target) => {
  if (!target || target === 'main') return '';
  if (target === 'terminal') return '#research';
  const [k, id] = target.split(':');
  return id ? `#${k}/${id}` : `#${k}`;
};

export class UI {
  constructor(office, content, { reduced, touch }) {
    this.o = office;
    this.content = content;
    this.reduced = reduced;
    this.touch = touch;
    this.panelOpen = null;
    this.markersOn = false;
    this.markerTimer = null;
    this.markerFilter = null;
    this.$ = (s) => document.querySelector(s);
    this.el = {
      body: document.body,
      boot: this.$('#boot'),
      bootText: this.$('#boot-text'),
      bootBar: this.$('#boot-bar'),
      markers: this.$('#markers'),
      announcer: this.$('#announcer'),
      paper: this.$('#paper'),
      jukebox: this.$('#jukebox'),
      walkHint: this.$('#walk-hint'),
      panels: {
        terminal: this.$('#research'),
        library: this.$('#library'),
        podcasts: this.$('#podcasts'),
        contact: this.$('#contact'),
        about: this.$('#about'),
        paper: this.$('#paper'),
      },
    };
    this.jukebox = new Jukebox(this.$('#jukebox-player'), { onEnd: () => this.o.ejectSong() });
    this.bind();
    this.prepTerminal();
  }

  /* ---------------- wiring ---------------- */

  bind() {
    // keyboard-only menu (hidden until it receives focus)
    document.querySelectorAll('[data-go]').forEach((b) =>
      b.addEventListener('click', () => {
        const go = b.dataset.go;
        this.o.navigate(this.o.state.target === go ? 'main' : go);
      }));
    document.querySelectorAll('[data-action="back"]').forEach((b) => b.addEventListener('click', () => this.o.back()));
    window.addEventListener('popstate', () => this.fromLocation());
    window.addEventListener('hashchange', () => this.fromLocation());

    // library + podcast cards talk to their 3D counterparts
    const hookList = (panel, prefix) => {
      panel.querySelectorAll('.item[data-id]').forEach((li) => {
        const id = li.dataset.id;
        const kind = li.classList.contains('song') ? 'song' : prefix;
        li.tabIndex = -1;
        const enter = () => this.o.previewItem && this.o.previewItem(kind, id, true);
        const leave = () => this.o.previewItem && this.o.previewItem(kind, id, false);
        li.addEventListener('mouseenter', enter);
        li.addEventListener('mouseleave', leave);
        li.addEventListener('focusin', enter);
        li.addEventListener('focusout', leave);
        li.addEventListener('click', (e) => {
          if (e.target.closest('a')) return;
          this.o.navigate(`${kind}:${id}`);
        });
      });
    };
    hookList(this.el.panels.library, 'book');
    hookList(this.el.panels.podcasts, 'tape');
    this.el.jukebox.querySelector('.jukebox-eject').addEventListener('click', () => this.o.ejectSong());
  }

  /* ---------------- the tape deck's "now playing" card ---------------- */

  playSong(song) {
    const j = this.el.jukebox;
    j.querySelector('.jukebox-title').textContent = song.title;
    j.querySelector('.jukebox-by').textContent = song.by;
    j.classList.remove('is-error');
    j.hidden = false;
    document.querySelectorAll('.song.is-playing').forEach((li) => li.classList.remove('is-playing'));
    document.querySelectorAll(`.song[data-id="${CSS.escape(song.id)}"]`).forEach((li) => li.classList.add('is-playing'));
    this.jukebox.play(song).catch(() => j.classList.add('is-error'));
    this.announce(`Now playing ${song.title} by ${song.by}`);
  }

  stopSong() {
    this.jukebox.stop();
    this.el.jukebox.hidden = true;
    document.querySelectorAll('.song.is-playing').forEach((li) => li.classList.remove('is-playing'));
  }

  prepTerminal() {
    const term = this.el.panels.terminal;
    this.reports = [...term.querySelectorAll('.report')];
    this.reports.forEach((art) => {
      // compact terminal columns: bare ticker and MM-DD-YY date
      const meta = art.querySelector('.report-meta');
      const time = meta && meta.querySelector('time');
      if (meta && time) {
        const [y, m, d] = (time.getAttribute('datetime') || '').split('-');
        const short = document.createElement('span');
        short.className = 'term-short';
        short.setAttribute('aria-hidden', 'true');
        const tk = document.createElement('b');
        tk.textContent = art.dataset.ticker || '';
        const dt = document.createElement('i');
        dt.textContent = y ? `${m}-${d}-${y.slice(2)}` : '';
        short.append(tk, dt);
        meta.appendChild(short);
      }
      const link = art.querySelector('.report-title a');
      const fig = art.querySelector('.report-figure');
      const cta = document.createElement('p');
      cta.className = 'report-open';
      const open = document.createElement('a');
      open.href = link.getAttribute('href');
      open.target = '_blank';
      open.rel = 'noopener';
      open.textContent = 'OPEN FULL REPORT \u2197';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'report-close';
      close.textContent = '< BACK TO LIST';
      close.addEventListener('click', () => this.expandReport(null));
      cta.append(open, ' ', close);
      if (fig) fig.after(cta);
      else art.appendChild(cta);
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.expandReport(art.classList.contains('is-expanded') ? null : art);
      });
    });
    const prompt = document.createElement('p');
    prompt.className = 'term-prompt';
    prompt.setAttribute('aria-hidden', 'true');
    prompt.innerHTML = 'C:\\RESEARCH&gt; <span class="cursor">&#9608;</span>';
    term.querySelector('.term').appendChild(prompt);
    term.addEventListener('keydown', (e) => {
      if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
      const links = this.reports.map((a) => a.querySelector('.report-title a'));
      const i = links.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      links[(i + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length].focus();
    });
  }

  expandReport(art) {
    this.reports.forEach((a) => a.classList.toggle('is-expanded', a === art));
    this.el.panels.terminal.classList.toggle('has-expanded', !!art);
    if (art) {
      art.querySelector('.report-open a').focus({ preventScroll: true });
      art.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ---------------- boot ---------------- */

  bootStart(content) {
    const n = (k, w) => `${k}`.padStart(w, ' ');
    const lines = [
      'JMcK BIOS v4.86   (C) 1987-' + new Date().getFullYear(),
      'CPU: 486DX2-66      MEMORY TEST: 640K OK',
      '',
      `Detecting research reports ......... ${n(content.reports.length, 2)} FOUND`,
      `Shelving the library ............... ${n(content.library.length, 2)} VOLUMES`,
      `Rewinding cassettes ................ ${n(content.podcasts.length, 2)} TAPES`,
      'Walking the dog .................... OK',
      'Polishing the window ............... OK',
      '',
      'C:\\> OFFICE.EXE',
    ];
    this.boot = { lines, shown: 0, start: performance.now(), step: 0, skip: false };
    this.el.body.classList.add('is-booting');
    const skip = () => {
      if (!this.boot) return;
      this.boot.skip = true;
      this.boot.shown = lines.length;
    };
    window.addEventListener('keydown', skip, { once: true });
    this.el.boot.addEventListener('pointerdown', skip, { once: true });
    const tick = () => {
      if (!this.boot) return;
      const allowed = Math.min(lines.length, 2 + this.boot.step * 2);
      if (this.boot.shown < allowed) {
        this.boot.shown++;
        this.el.bootText.textContent = lines.slice(0, this.boot.shown).join('\n') + (this.boot.shown < lines.length ? '\n\u2588' : '');
      }
      this.el.bootBar.style.width = `${Math.min(100, (this.boot.shown / lines.length) * 100)}%`;
      this.boot.timer = setTimeout(tick, this.reduced ? 20 : 95);
    };
    tick();
  }

  bootStep(i) {
    if (this.boot) this.boot.step = Math.max(this.boot.step, i);
  }

  async bootEnd() {
    if (!this.boot) return;
    this.boot.step = 99;
    const minTime = this.reduced ? 200 : 1500;
    while (!this.boot.skip && (this.boot.shown < this.boot.lines.length || performance.now() - this.boot.start < minTime)) {
      await new Promise((r) => setTimeout(r, 60));
    }
    clearTimeout(this.boot.timer);
    this.boot = null;
    this.el.boot.classList.add('is-off');
    this.el.body.classList.remove('is-booting');
    await new Promise((r) => setTimeout(r, this.reduced ? 50 : 650));
    this.el.boot.hidden = true;
  }

  /** Shown only when the 3D office can't run at all. */
  showFallback() {
    if (this.boot) {
      clearTimeout(this.boot.timer);
      this.boot = null;
    }
    this.el.boot.hidden = true;
    this.el.body.classList.remove('is-booting');
    this.el.body.classList.add('no-office');
  }

  /* ---------------- hash routing ---------------- */

  targetFromHash() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!h) return null;
    if (h === 'research') return 'terminal';
    const [k, id] = h.split('/');
    if (['report', 'book', 'tape', 'song'].includes(k) && id) return `${k}:${id}`;
    if (['library', 'podcasts', 'contact', 'about', 'desk', 'window', 'diploma', 'outside'].includes(k)) return k;
    return null;
  }

  setHash(target, prev) {
    const hash = HASH_FOR(target);
    const url = location.pathname + location.search + hash;
    if (url === location.pathname + location.search + location.hash) return;
    const fromMain = !prev || prev === 'main';
    if (fromMain && target !== 'main') history.pushState({ office: target }, '', url);
    else history.replaceState({ office: target }, '', url);
  }

  fromLocation() {
    const t = this.targetFromHash() || 'main';
    if (t !== this.o.state.target) this.o.navigate(t, { fromHash: true });
  }

  /* ---------------- panels ---------------- */

  openPanel(name, { focus = null } = {}) {
    const el = this.el.panels[name];
    if (!el) return;
    this.o.releasePointer(); // a panel needs the cursor
    const active = document.activeElement;
    const insidePanel = active && Object.values(this.el.panels).some((p) => p.contains(active));
    if (!insidePanel) this.returnFocus = active;
    for (const [k, p] of Object.entries(this.el.panels)) if (k !== name) this.hide(p);
    el.hidden = false;
    el.classList.add('is-open');
    this.panelOpen = name;
    this.el.body.classList.add('has-panel', `open-${name}`);
    if (name === 'terminal') {
      this.expandReport(null);
      this.layoutTerminal();
      requestAnimationFrame(() => el.classList.add('is-on'));
    }
    if (name === 'library' || name === 'podcasts') {
      el.querySelectorAll('.item').forEach((li) => li.classList.toggle('is-focused', li.dataset.id === focus));
      const li = focus && el.querySelector(`.item[data-id="${CSS.escape(focus)}"]`);
      if (li) {
        li.scrollIntoView({ block: 'nearest', behavior: this.reduced ? 'auto' : 'smooth' });
        li.focus({ preventScroll: true });
      }
    }
    if (!(focus && (name === 'library' || name === 'podcasts'))) {
      const first = name === 'terminal' ? el.querySelector('.report-title a') : el.querySelector('h2');
      if (first) {
        if (first.tagName === 'H2') first.tabIndex = -1;
        first.focus({ preventScroll: true });
      }
    }
    requestAnimationFrame(() => {
      const f = this.panelFraction(name);
      this.o.rig.shiftFor(f.x, f.y);
    });
    this.announce(`Opened ${el.querySelector('h2')?.textContent || name}`);
  }

  /** How much of the screen a panel covers: from the right on wide screens, from the bottom on narrow ones. */
  panelFraction(name) {
    if (name === 'terminal') return { x: 0, y: 0 };
    const el = this.el.panels[name];
    const box = (name === 'paper' ? el.querySelector('.paper') : el).getBoundingClientRect();
    if (window.innerWidth < 760) return { x: 0, y: Math.min(0.7, (window.innerHeight - box.top) / window.innerHeight) };
    return { x: Math.min(0.5, (window.innerWidth - box.left) / window.innerWidth), y: 0 };
  }

  hide(p) {
    p.classList.remove('is-open', 'is-on');
    p.hidden = p === this.el.paper;
  }

  closePanels({ keepFor = null } = {}) {
    const keep = PANEL_FOR(keepFor);
    for (const [k, p] of Object.entries(this.el.panels)) {
      if (k === keep) continue;
      this.hide(p);
      this.el.body.classList.remove(`open-${k}`);
    }
    if (keep) return;
    this.panelOpen = null;
    this.el.body.classList.remove('has-panel');
    this.o.rig.shiftFor(0, 0);
    if (this.returnFocus && document.contains(this.returnFocus) && this.returnFocus !== document.body) {
      this.returnFocus.focus({ preventScroll: true });
    }
    this.returnFocus = null;
  }

  openPaper(rep) {
    const p = this.el.paper;
    p.querySelector('.paper-meta').textContent = `${rep.exchange ? rep.exchange + ': ' : ''}${rep.ticker} · ${rep.dateText}`;
    p.querySelector('.paper-title').textContent = rep.title;
    p.querySelector('.paper-dek').textContent = rep.dek;
    const img = p.querySelector('.paper-figure img');
    const src = rep.el.querySelector('.report-figure img');
    img.src = src ? src.getAttribute('src') : rep.image;
    img.alt = src ? src.alt : '';
    p.querySelector('.paper-cta').href = rep.url;
    this.openPanel('paper');
    p.querySelector('.paper-cta').focus({ preventScroll: true });
  }

  /* ---------------- terminal overlay ---------------- */

  layoutTerminal() {
    const el = this.el.panels.terminal;
    if (!el.classList.contains('is-open')) return;
    const narrow = window.innerWidth < 760 || window.innerHeight < 520;
    el.classList.toggle('is-full', narrow);
    if (narrow || !this.o.ctx) {
      el.style.cssText = '';
      return;
    }
    const { group, center, width, height } = this.o.ctx.terminalFrame;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) =>
      group.localToWorld(new THREE.Vector3(center[0] + (sx * width) / 2, center[1] + (sy * height) / 2, center[2])));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of corners) {
      const p = this.o.project(c);
      if (!p) return;
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    const w = x1 - x0, h = y1 - y0;
    if (w < 420 || h < 300) {
      el.classList.add('is-full');
      el.style.cssText = '';
      return;
    }
    el.style.left = `${x0}px`;
    el.style.top = `${y0}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.fontSize = `${Math.max(14, Math.min(26, w / 34))}px`;
  }

  layout() {
    if (this.panelOpen === 'terminal') this.layoutTerminal();
  }

  /* ---------------- per frame ---------------- */

  frame(o) {
    if (this.panelOpen === 'terminal' && !o.rig.moving) this.layoutTerminal();
    if (this.markersOn) this.placeMarkers();
    const clock = this.el.panels.terminal.querySelector('.term-clock');
    if (clock && this.panelOpen === 'terminal') {
      const d = new Date();
      const s = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      if (clock.textContent !== s) clock.textContent = s;
    }
  }

  hoverItem(h) {
    const id = h && (h.book ? h.book.item.id : h.tape ? h.tape.item.id : h.mixtape ? h.mixtape.item.id : null);
    document.querySelectorAll('.item.is-hot').forEach((li) => li.classList.remove('is-hot'));
    if (id) document.querySelectorAll(`.item[data-id="${CSS.escape(id)}"]`).forEach((li) => li.classList.add('is-hot'));
  }

  /* ---------------- markers: small pulsing diamonds, no labels ---------------- */

  visibleHotspots() {
    const v = this.o.state.view;
    return this.o.hotspots.filter((h) => h.anchor && (!h.views || h.views.includes(v)) && (!this.markerFilter || this.markerFilter(h)));
  }

  flashMarkers(ms, filter = null) {
    if (this.reduced && !filter) return;
    this.markersOn = true;
    this.markerFilter = filter;
    this.buildMarkers();
    this.el.markers.classList.add('is-on');
    clearTimeout(this.markerTimer);
    this.markerTimer = setTimeout(() => {
      this.markersOn = false;
      this.el.markers.classList.remove('is-on');
    }, ms);
  }

  buildMarkers() {
    const box = this.el.markers;
    box.textContent = '';
    this.markerEls = this.visibleHotspots().map((h) => {
      const m = document.createElement('div');
      m.className = `marker${h.minor ? ' is-minor' : ''}`;
      box.appendChild(m);
      return { h, m };
    });
    this.markerView = this.o.state.view;
    this.placeMarkers();
  }

  placeMarkers() {
    if (this.markerView !== this.o.state.view) this.buildMarkers();
    for (const { h, m } of this.markerEls || []) {
      const p = this.o.state.view ? this.o.project(h.anchor) : null;
      if (!p || this.panelOpen) {
        m.style.opacity = '0';
        continue;
      }
      m.style.opacity = '';
      m.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    }
  }

  /* ---------------- misc ---------------- */

  setActiveNav(view) {
    document.querySelectorAll('[data-go]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.go === view)));
  }

  /** Once a visit, when the door's been opened for you: how to walk out of it. */
  walkHint() {
    const el = this.el.walkHint;
    if (!el || this.walkHinted) return;
    this.walkHinted = true;
    el.textContent = this.touch ? 'Tap the snow to walk out · drag to look round' : 'W A S D to walk out · Shift to run · or click the ground';
    el.hidden = false;
    clearTimeout(this.walkHintTimer);
    this.walkHintTimer = setTimeout(() => (el.hidden = true), 6000);
    this.announce('The door is open. Walk out with W, A, S and D.');
  }

  announce(text) {
    this.el.announcer.textContent = '';
    setTimeout(() => (this.el.announcer.textContent = text), 30);
  }
}
