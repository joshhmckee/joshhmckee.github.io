import * as THREE from '../vendor/three.module.min.js';

const PANEL_FOR = (target) => {
  if (!target) return null;
  if (target === 'terminal') return 'terminal';
  if (target.startsWith('report:')) return 'paper';
  if (target === 'library' || target.startsWith('book:')) return 'library';
  if (target === 'podcasts' || target.startsWith('tape:')) return 'podcasts';
  if (target === 'contact' || target === 'about') return target;
  return null;
};

const HASH_FOR = (target) => {
  if (!target || target === 'main') return '';
  if (target === 'terminal') return '#research';
  const [k, id] = target.split(':');
  return id ? `#${k}/${id}` : `#${k}`;
};

const store = {
  get(k) {
    try { return localStorage.getItem(`office:${k}`); } catch (e) { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(`office:${k}`, v); } catch (e) { /* private mode */ }
  },
};

export class UI {
  constructor(office, content, { reduced }) {
    this.o = office;
    this.content = content;
    this.reduced = reduced;
    this.textMode = false;
    this.panelOpen = null;
    this.markersOn = false;
    this.markerTimer = null;
    this.markerFilter = null;
    this.$ = (s) => document.querySelector(s);
    this.el = {
      body: document.body,
      tooltip: this.$('#tooltip'),
      hint: this.$('#hint'),
      back: this.$('.back-btn'),
      boot: this.$('#boot'),
      bootText: this.$('#boot-text'),
      bootBar: this.$('#boot-bar'),
      markers: this.$('#markers'),
      announcer: this.$('#announcer'),
      paper: this.$('#paper'),
      panels: {
        terminal: this.$('#research'),
        library: this.$('#library'),
        podcasts: this.$('#podcasts'),
        contact: this.$('#contact'),
        about: this.$('#about'),
        paper: this.$('#paper'),
      },
    };
    this.bind();
    this.prepTerminal();
    this.tipLast = '';
  }

  /* ---------------- wiring ---------------- */

  bind() {
    document.querySelectorAll('[data-go]').forEach((b) =>
      b.addEventListener('click', () => {
        const go = b.dataset.go;
        if (this.o.state.target === go) this.o.navigate('main');
        else this.o.navigate(go);
      }));
    document.querySelectorAll('[data-action="back"]').forEach((b) => b.addEventListener('click', () => this.o.back()));
    const crtBtn = this.$('[data-action="crt"]');
    const soundBtn = this.$('[data-action="sound"]');
    const hintBtn = this.$('[data-action="hints"]');
    crtBtn.addEventListener('click', () => this.setCRT(crtBtn.getAttribute('aria-pressed') !== 'true'));
    soundBtn.addEventListener('click', () => this.setSound(soundBtn.getAttribute('aria-pressed') !== 'true'));
    hintBtn.addEventListener('click', () => this.toggleMarkers());
    this.$('[data-action="text"]').addEventListener('click', (e) => {
      e.preventDefault();
      this.enterTextMode();
    });
    this.$('[data-action="office"]').addEventListener('click', (e) => {
      if (this.o.pipeline) {
        e.preventDefault();
        this.exitTextMode();
      }
    });
    window.addEventListener('popstate', () => this.fromLocation());
    window.addEventListener('hashchange', () => this.fromLocation());

    // library + podcast cards talk to their 3D counterparts
    const hookList = (panel, prefix, kind) => {
      panel.querySelectorAll('.item[data-id]').forEach((li) => {
        const id = li.dataset.id;
        li.tabIndex = -1;
        const enter = () => this.o.previewItem && this.o.previewItem(kind, id, true);
        const leave = () => this.o.previewItem && this.o.previewItem(kind, id, false);
        li.addEventListener('mouseenter', enter);
        li.addEventListener('mouseleave', leave);
        li.addEventListener('focusin', enter);
        li.addEventListener('focusout', leave);
        li.addEventListener('click', (e) => {
          if (e.target.closest('a')) return;
          this.o.navigate(`${prefix}:${id}`);
        });
      });
    };
    hookList(this.el.panels.library, 'book', 'book');
    hookList(this.el.panels.podcasts, 'tape', 'tape');
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
        if (this.textMode) return;
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
      const next = links[(i + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length];
      next.focus();
    });
  }

  expandReport(art) {
    this.reports.forEach((a) => a.classList.toggle('is-expanded', a === art));
    this.el.panels.terminal.classList.toggle('has-expanded', !!art);
    if (art) {
      art.querySelector('.report-open a').focus({ preventScroll: true });
      art.scrollIntoView({ block: 'nearest' });
      this.o.sound.keys();
    }
  }

  /* ---------------- preferences ---------------- */

  prefersText() {
    return location.hash === '#text-version' || new URLSearchParams(location.search).has('text');
  }

  applyPrefs() {
    if (store.get('crt') === '0') this.setCRT(false);
    if (store.get('sound') === '1') this.setSound(true, { silent: true });
  }

  setCRT(on) {
    const btn = this.$('[data-action="crt"]');
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? 'CRT ON' : 'CRT OFF';
    this.o.pipeline && this.o.pipeline.setCRT(on);
    store.set('crt', on ? '1' : '0');
  }

  setSound(on, { silent = false } = {}) {
    const btn = this.$('[data-action="sound"]');
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? 'SOUND ON' : 'SOUND OFF';
    this.o.sound.setEnabled(on);
    if (on && !silent) this.o.sound.click();
    store.set('sound', on ? '1' : '0');
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
      'Brewing coffee ..................... OK',
      'Dusting the blinds ................. OK',
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
    this.applyPrefs();
    this.el.boot.classList.add('is-off');
    this.el.body.classList.remove('is-booting');
    await new Promise((r) => setTimeout(r, this.reduced ? 50 : 650));
    this.el.boot.hidden = true;
  }

  /* ---------------- hash routing ---------------- */

  targetFromHash() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!h || h === 'text-version') return null;
    if (h === 'research') return 'terminal';
    const [k, id] = h.split('/');
    if (['report', 'book', 'tape'].includes(k) && id) return `${k}:${id}`;
    if (['library', 'podcasts', 'contact', 'about', 'desk', 'window'].includes(k)) return k;
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
    if (location.hash === '#text-version') {
      if (!this.textMode) this.enterTextMode({ fromHash: true });
      return;
    }
    if (this.textMode) return;
    const t = this.targetFromHash() || 'main';
    if (t !== this.o.state.target) this.o.navigate(t, { fromHash: true });
  }

  /* ---------------- panels ---------------- */

  openPanel(name, { focus = null } = {}) {
    const el = this.el.panels[name];
    if (!el) return;
    const active = document.activeElement;
    const insidePanel = active && Object.values(this.el.panels).some((p) => p.contains(active));
    if (!insidePanel) this.returnFocus = active;
    for (const [k, p] of Object.entries(this.el.panels)) if (k !== name) this.hide(p);
    el.hidden = false;
    el.classList.add('is-open');
    this.panelOpen = name;
    this.el.back.hidden = false;
    this.el.body.classList.add('has-panel', `panel-${name}`);
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
    const title = el.querySelector('h2')?.textContent || name;
    this.announce(`Opened ${title}`);
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
    for (const [k, p] of Object.entries(this.el.panels)) if (k !== keep) this.hide(p);
    for (const k of Object.keys(this.el.panels)) if (k !== keep) this.el.body.classList.remove(`panel-${k}`);
    if (!keep) {
      this.panelOpen = null;
      this.el.body.classList.remove('has-panel');
      this.el.back.hidden = keepFor === 'main' || !keepFor;
      this.o.rig.shiftFor(0, 0);
      if (this.returnFocus && document.contains(this.returnFocus) && this.returnFocus !== document.body) {
        this.returnFocus.focus({ preventScroll: true });
      }
      this.returnFocus = null;
    }
    if (keepFor && keepFor !== 'main') this.el.back.hidden = false;
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

  tooltip(h, x, y) {
    const t = this.el.tooltip;
    if (!h || this.panelOpen) {
      if (t.classList.contains('is-on')) t.classList.remove('is-on');
      return;
    }
    const label = typeof h.label === 'function' ? h.label() : h.label;
    const key = `${label}|${h.sub}`;
    if (key !== this.tipLast) {
      t.innerHTML = `<strong></strong><span></span>`;
      t.firstChild.textContent = label;
      t.lastChild.textContent = h.sub || '';
      this.tipLast = key;
    }
    const pad = 18;
    const w = t.offsetWidth || 180;
    const left = x + pad + w > window.innerWidth ? x - pad - w : x + pad;
    t.style.transform = `translate(${Math.round(left)}px, ${Math.round(y + pad)}px)`;
    t.classList.add('is-on');
  }

  hoverItem(h) {
    const id = h && (h.book ? h.book.item.id : h.tape ? h.tape.item.id : null);
    document.querySelectorAll('.item.is-hot').forEach((li) => li.classList.remove('is-hot'));
    if (id) document.querySelectorAll(`.item[data-id="${CSS.escape(id)}"]`).forEach((li) => li.classList.add('is-hot'));
  }

  /* ---------------- markers ---------------- */

  visibleHotspots() {
    const v = this.o.state.view;
    return this.o.hotspots.filter((h) => h.anchor && (!h.views || h.views.includes(v)) && (!this.markerFilter || this.markerFilter(h)));
  }

  toggleMarkers(force) {
    const on = force !== undefined ? force : !this.markersOn;
    this.markersOn = on;
    this.markerFilter = null;
    clearTimeout(this.markerTimer);
    this.$('[data-action="hints"]').setAttribute('aria-pressed', String(on));
    if (on) this.buildMarkers();
    this.el.markers.classList.toggle('is-on', on);
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
      this.$('[data-action="hints"]').setAttribute('aria-pressed', 'false');
    }, ms);
  }

  buildMarkers() {
    const box = this.el.markers;
    box.textContent = '';
    this.markerEls = this.visibleHotspots().map((h) => {
      const m = document.createElement('div');
      m.className = `marker${h.minor ? ' is-minor' : ''}`;
      const label = typeof h.label === 'function' ? h.label() : h.label;
      m.innerHTML = '<i></i><span></span>';
      m.lastChild.textContent = h.minor ? label : `${label}`;
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

  setActiveDock(view) {
    document.querySelectorAll('.dock-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.go === view));
  }

  announce(text) {
    this.el.announcer.textContent = '';
    setTimeout(() => (this.el.announcer.textContent = text), 30);
  }

  interacted() {
    if (!this.el.body.classList.contains('has-interacted')) this.el.body.classList.add('has-interacted');
  }

  /* ---------------- text mode ---------------- */

  enterTextMode({ initial = false, reason = null, fromHash = false } = {}) {
    this.textMode = true;
    this.el.body.classList.add('text-mode');
    this.el.body.classList.remove('is-booting', 'has-panel');
    if (this.boot) {
      clearTimeout(this.boot.timer);
      this.boot = null;
    }
    this.el.boot.hidden = true;
    for (const p of Object.values(this.el.panels)) {
      p.classList.remove('is-open', 'is-on', 'is-full');
      p.style.cssText = '';
      p.hidden = p === this.el.paper;
    }
    this.o.pause && this.o.pause();
    if (reason === 'webgl' || reason === 'error') {
      const note = document.createElement('p');
      note.className = 'doc-note';
      note.textContent = reason === 'webgl'
        ? 'Your browser can’t show the 3D office, so here is the text version.'
        : 'The 3D office hit a snag, so here is the text version.';
      this.$('.doc-head').appendChild(note);
      this.$('.doc-switch').hidden = true;
    }
    if (!fromHash && !initial) history.replaceState(null, '', location.pathname + location.search + '#text-version');
    window.scrollTo(0, 0);
    if (!initial) this.$('#text-version').focus({ preventScroll: true });
  }

  exitTextMode() {
    this.textMode = false;
    this.el.body.classList.remove('text-mode');
    history.replaceState(null, '', location.pathname + location.search);
    this.o.resume();
    this.o.state.target = null;
    this.o.navigate('main');
  }
}
