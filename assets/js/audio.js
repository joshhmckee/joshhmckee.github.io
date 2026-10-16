/** Tiny procedural sound kit: everything is synthesised, nothing is downloaded. Off by default. */
export class Sound {
  constructor() {
    this.enabled = false;
    this.ac = null;
    this.lastBlip = 0;
  }

  ensure() {
    if (this.ac) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ac = new AC();
    this.master = this.ac.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ac.destination);
    const len = this.ac.sampleRate * 2;
    this.noise = this.ac.createBuffer(1, len, this.ac.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b = (b + 0.02 * w) / 1.02;
      d[i] = i % 2 ? w : b * 3.5; // interleave white and brown-ish noise
    }
    return true;
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) {
      if (!this.ensure()) return;
      this.ac.resume();
      this.startAmbience();
    } else if (this.ac) {
      this.stopAmbience();
      this.ac.suspend();
    }
  }

  unlock() {
    if (this.enabled && this.ac && this.ac.state === 'suspended') this.ac.resume();
  }

  get ok() {
    return this.enabled && this.ac && this.ac.state === 'running';
  }

  tone(freq, dur, { type = 'square', gain = 0.04, to = null, delay = 0 } = {}) {
    if (!this.ok) return;
    const t = this.ac.currentTime + delay;
    const o = this.ac.createOscillator();
    const g = this.ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  burst(dur, { type = 'bandpass', freq = 1200, q = 1, gain = 0.08, delay = 0, sweep = null, shape = 'decay' } = {}) {
    if (!this.ok) return;
    const t = this.ac.currentTime + delay;
    const s = this.ac.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ac.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    f.Q.value = q;
    const g = this.ac.createGain();
    if (shape === 'swell') {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    } else {
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  blip() {
    const now = performance.now();
    if (now - this.lastBlip < 90) return;
    this.lastBlip = now;
    this.tone(1320, 0.035, { gain: 0.012, to: 1760 });
  }

  click() {
    this.burst(0.03, { type: 'highpass', freq: 2500, gain: 0.07 });
    this.tone(900, 0.03, { type: 'triangle', gain: 0.03 });
  }

  whoosh() {
    this.burst(0.9, { type: 'bandpass', freq: 250, sweep: 900, q: 0.7, gain: 0.05, shape: 'swell' });
  }

  keys() {
    for (let i = 0; i < 7; i++) {
      const d = i * (0.05 + Math.random() * 0.06);
      this.burst(0.025, { type: 'bandpass', freq: 2600 + Math.random() * 900, q: 3, gain: 0.08, delay: d });
      this.tone(180 + Math.random() * 40, 0.03, { type: 'sine', gain: 0.03, delay: d });
    }
  }

  paper() {
    for (let i = 0; i < 4; i++) this.burst(0.09 + Math.random() * 0.08, { type: 'bandpass', freq: 3000 + Math.random() * 2500, q: 0.8, gain: 0.05, delay: i * 0.06 });
  }

  slide() {
    this.burst(0.28, { type: 'lowpass', freq: 900, sweep: 500, gain: 0.07 });
  }

  clunk() {
    this.tone(110, 0.12, { type: 'sine', gain: 0.12, to: 70 });
    this.burst(0.04, { type: 'bandpass', freq: 1800, q: 2, gain: 0.08, delay: 0.02 });
    this.burst(0.04, { type: 'bandpass', freq: 1400, q: 2, gain: 0.06, delay: 0.16 });
  }

  ring() {
    for (let i = 0; i < 6; i++) {
      this.tone(1040, 0.05, { type: 'triangle', gain: 0.02, delay: i * 0.055 });
      this.tone(1310, 0.05, { type: 'triangle', gain: 0.015, delay: i * 0.055 + 0.027 });
    }
  }

  chain() {
    this.burst(0.03, { type: 'highpass', freq: 3500, gain: 0.08 });
    this.burst(0.03, { type: 'highpass', freq: 3000, gain: 0.06, delay: 0.09 });
    this.tone(2200, 0.05, { type: 'sine', gain: 0.015, delay: 0.09 });
  }

  blinds() {
    for (let i = 0; i < 14; i++) this.burst(0.02, { type: 'bandpass', freq: 3800 + Math.random() * 1500, q: 4, gain: 0.04, delay: i * 0.028 + Math.random() * 0.01 });
  }

  spin() {
    this.burst(1.1, { type: 'bandpass', freq: 400, sweep: 160, q: 2, gain: 0.05, shape: 'swell' });
  }

  startAmbience() {
    if (!this.ac || this.amb) return;
    const s = this.ac.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = this.ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    const g = this.ac.createGain();
    g.gain.value = 0.035;
    s.connect(f).connect(g).connect(this.master);
    s.start();
    const tick = setInterval(() => this.ok && this.burst(0.012, { type: 'highpass', freq: 4200, gain: 0.025 }), 1000);
    this.amb = { s, tick };
  }

  stopAmbience() {
    if (!this.amb) return;
    try { this.amb.s.stop(); } catch (e) { /* already stopped */ }
    clearInterval(this.amb.tick);
    this.amb = null;
  }
}
