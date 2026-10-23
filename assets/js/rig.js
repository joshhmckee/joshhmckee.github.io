import * as THREE from '../vendor/three.module.min.js';
import { clamp, lerp, DEG, TAU } from './util.js';

const tmp = new THREE.Vector3();
const tmpLook = new THREE.Vector3();

function anglesTo(pos, target) {
  tmp.copy(target).sub(pos).normalize();
  return { yaw: Math.atan2(-tmp.x, -tmp.z), pitch: Math.asin(clamp(tmp.y, -1, 1)) };
}

/** A point 1 m along the view from pos, for angles yaw and pitch. */
function lookPoint(pos, yaw, pitch) {
  return new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).add(pos);
}

function shortest(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d;
}

/**
 * Minimum-jerk easing: the speed profile people's own reaching and head turns follow, starting
 * and settling gently with no sudden change in acceleration.
 */
const minJerk = (t) => t * t * t * (10 - 15 * t + 6 * t * t);

// on foot: walking and running speeds (m/s), and eye height over the floor (someone of about 1.6 m)
const WALK = 1.4, RUN = 3.4;
export const EYE = 1.48;

/**
 * A view is { pos, target, hfov, vfov, look: [yawRange, pitchRange] }.
 * The rig keeps a base pose (from the view) plus user look offsets and parallax, and under it
 * all a body: a gait while moving, breathing, and the small sway of someone standing.
 */
export class Rig {
  constructor(camera, { reducedMotion = false } = {}) {
    this.camera = camera;
    this.reduced = reducedMotion;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.fov = 50;
    this.view = null;
    this.look = { yaw: 0, pitch: 0, vy: 0, vp: 0 };
    this.par = { x: 0, y: 0, tx: 0, ty: 0 };
    this.tween = null;
    this.dragging = false;
    this.aspect = 16 / 9;
    this.shift = 0;
    this.shiftTarget = 0;
    // cursor-look: where the cursor is (-1..1), how strongly to follow it, and whether it's active
    this.fol = { x: 0, y: 0 };
    this.followOn = false;
    this.followScale = 1;
    // mouse-look: the pointer is locked and the mouse turns the view directly (see mouseLook);
    // held: the look stays just where it is (the mouse has been let go, until it's picked up again)
    this.locked = false;
    this.held = false;
    this.shiftPitch = 0;
    this.shiftPitchTarget = 0;
    // walking about: bounds(pos) keeps the walker out of walls and furniture, and returns the
    // height of the floor (or the ground outside) underfoot
    this.walking = false;
    this.sitting = false; // in the desk chair: you turn, and the chair turns with you (main.js swivels it)
    this.bounds = null;
    this.floor = 0;
    this.vel = new THREE.Vector2(); // over the floor (x, z), m/s
    this.turnRate = 0;
    this.eyeVel = 0;
    this.intent = { fwd: 0, strafe: 0, turn: 0, run: false }; // from the keys, each frame
    this.auto = null; // walking somewhere by itself: { pts: [{ x, z }], face, onArrive }
    this.body = { stride: 0, bob: 0, exertion: 0, breath: Math.random() * TAU, y: 0, side: 0, sx: 0, sz: 0, pitch: 0, yaw: 0, roll: 0 };
  }

  /**
   * Turn the view so the subject sits in the part of the screen a panel leaves free:
   * fx = share of the width covered on the right, fy = share of the height covered at the bottom.
   */
  shiftFor(fx = 0, fy = 0) {
    const vf = this.fov * DEG;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.aspect);
    this.shiftTarget = fx ? -Math.atan(fx * Math.tan(hf / 2)) : 0;
    this.shiftPitchTarget = fy ? -Math.atan(fy * Math.tan(vf / 2)) : 0;
  }

  fovFor(view) {
    const minH = (view.hfov || 70) * DEG;
    const fromH = 2 * Math.atan(Math.tan(minH / 2) / this.aspect) / DEG;
    return clamp(Math.max(view.vfov || 0, fromH), 30, view.maxV || 82);
  }

  poseFor(view) {
    const pos = new THREE.Vector3().fromArray(view.pos);
    const target = new THREE.Vector3().fromArray(view.target);
    let p = pos;
    if (view.backoff && this.aspect < 1) {
      // on portrait screens, step back along the view direction so close-ups still fit
      const dir = pos.clone().sub(target).normalize();
      p = pos.clone().addScaledVector(dir, view.backoff * (1 - this.aspect));
    }
    const a = anglesTo(p, target);
    return { pos: p, yaw: a.yaw, pitch: a.pitch, fov: this.fovFor(view) };
  }

  /** Stop walking, wherever you are (a flight or a jump to a view takes over). */
  halt() {
    this.walking = false;
    this.sitting = false;
    this.auto = null;
    this.vel.set(0, 0);
    this.turnRate = 0;
    this.eyeVel = 0;
  }

  set(view) {
    this.view = view;
    this.halt();
    const p = this.poseFor(view);
    this.pos.copy(p.pos);
    this.yaw = p.yaw;
    this.pitch = p.pitch;
    this.fov = p.fov;
    this.look.yaw = this.look.pitch = this.look.vy = this.look.vp = 0;
    this.tween = null;
  }

  /**
   * Fly to a view. via: waypoints [{ pos, target }] to pass through on the way (in at the door and
   * round the chalet, say), making a smooth walk-paced route instead of a straight flight.
   */
  go(view, { duration = 1.25, arc = 0.06, onDone = null, via = null } = {}) {
    this.halt();
    const to = this.poseFor(view);
    // with a mouse, the look keeps following the cursor all the way (so arriving doesn't swing the
    // view); on touch, a look you'd dragged to folds into the flight
    const keep = this.followOn && !this.locked;
    const fromYaw = this.yaw + (keep ? 0 : this.look.yaw);
    const fromPitch = this.pitch + (keep ? 0 : this.look.pitch);
    this.view = view;
    if (!keep) this.look.yaw = this.look.pitch = 0;
    this.look.vy = this.look.vp = 0;
    let dist = this.pos.distanceTo(to.pos), path = null;
    if (via && via.length) {
      // one curve for where the camera goes and another, alongside, for where it looks
      const pts = [this.pos.clone(), ...via.map((w) => new THREE.Vector3().fromArray(w.pos)), to.pos.clone()];
      const looks = [lookPoint(this.pos, fromYaw, fromPitch)];
      via.forEach((w, i) => {
        const a = anglesTo(pts[i + 1], new THREE.Vector3().fromArray(w.target));
        looks.push(lookPoint(pts[i + 1], a.yaw, a.pitch));
      });
      looks.push(lookPoint(to.pos, to.yaw, to.pitch));
      path = { pos: new THREE.CatmullRomCurve3(pts, false, 'centripetal'), look: new THREE.CatmullRomCurve3(looks, false, 'centripetal') };
      dist = path.pos.getLength();
    }
    // a little longer than strictly needed: minimum-jerk moves are unhurried at both ends
    const dur = this.reduced ? 0.001 : path ? clamp(dist / 1.6, 2.4, 9) : duration * clamp(0.62 + dist * 0.2, 0.7, 1.5);
    this.tween = {
      t: 0,
      dur,
      path,
      // a routed walk gets the full gait; a short glide between views just a hint of one
      gait: path ? 1 : 0.45,
      from: { pos: this.pos.clone(), yaw: fromYaw, pitch: fromPitch, fov: this.fov },
      to: { ...to, yaw: shortest(fromYaw, to.yaw) },
      arc: path ? 0 : arc * Math.min(1, dist),
      onDone,
    };
  }

  resize(aspect) {
    this.aspect = aspect;
    if (this.view && !this.tween && !this.walking) {
      const p = this.poseFor(this.view);
      this.pos.copy(p.pos);
      this.yaw = p.yaw;
      this.pitch = p.pitch;
      this.fov = p.fov;
    }
  }

  drag(dx, dy) {
    if (!this.view || this.tween) return;
    const k = (this.fov * DEG) / 600;
    this.look.vy = -dx * k * 60;
    this.look.vp = -dy * k * 60;
    if (this.walking || this.sitting) {
      // on foot (or swivelling in the chair), a drag turns you right round
      this.yaw -= dx * k;
      this.look.pitch = clamp(this.look.pitch - dy * k, -1.1, 0.7);
      return;
    }
    this.look.yaw -= dx * k;
    this.look.pitch -= dy * k;
    this.clampLook();
  }

  nudge(dyaw, dpitch) {
    this.look.vy += dyaw;
    this.look.vp += dpitch;
  }

  clampLook() {
    const [yr, pr] = this.view.look || [0.2, 0.12];
    this.look.yaw = clamp(this.look.yaw, -yr, yr);
    this.look.pitch = clamp(this.look.pitch, -pr, pr);
  }

  /**
   * Mouse-look, with the pointer locked: the view turns with the mouse, one to one and as far as
   * you like (on your feet or in the overview); close-up views keep a little leeway round their subject.
   */
  mouseLook(dx, dy) {
    if (!this.view) return;
    const k = 0.0042 * Math.min(1, this.fov / 60);
    if (this.walking || this.sitting) this.yaw -= dx * k;
    else this.look.yaw -= dx * k;
    this.look.pitch -= dy * k;
    if (this.walking || this.sitting || (this.view.lookScale ?? 1) >= 1) {
      this.look.pitch = clamp(this.look.pitch, -1.35 - this.pitch, 1.1 - this.pitch);
    } else {
      const [yr, pr] = this.view.look || [0.2, 0.12];
      this.look.yaw = clamp(this.look.yaw, -yr * 1.5 - 0.15, yr * 1.5 + 0.15);
      this.look.pitch = clamp(this.look.pitch, -pr * 1.5 - 0.12, pr * 1.5 + 0.12);
    }
  }

  /** Look toward the cursor: nx, ny in -1..1 from the screen centre. */
  follow(nx, ny) {
    this.followOn = true;
    this.fol.x = clamp(nx, -1, 1);
    this.fol.y = clamp(ny, -1, 1);
  }

  get moving() {
    return !!this.tween;
  }

  /** Get on your feet (from wherever the view had you): the keys, or a walk somewhere, move you from here. */
  startWalking() {
    if (this.walking) return;
    this.tween = null;
    this.walking = true;
    this.sitting = false;
    // with mouse-look, where you'd turned to becomes the way you're facing
    if (this.locked) {
      this.yaw += this.look.yaw;
      this.look.yaw = 0;
    }
    this.vel.set(0, 0);
    this.turnRate = 0;
    this.eyeVel = 0;
  }

  /**
   * What the keys ask for this frame: fwd and strafe (-1..1) across the floor relative to where
   * you're looking, turn (-1..1) to swing round, run to go at a jog.
   */
  setIntent(fwd, strafe, turn, run = false) {
    Object.assign(this.intent, { fwd, strafe, turn, run });
  }

  /**
   * Walk by yourself through the points [{ x, z }] (the last is where you stop), turning at the
   * end to face yaw `face` if given; onArrive(stuck) when there, or if something's in the way.
   */
  walkTo(pts, { face = null, onArrive = null } = {}) {
    this.startWalking();
    this.auto = { pts: pts.map((p) => ({ x: p.x, z: p.z })), face, onArrive, best: Infinity, stall: 0 };
  }

  /**
   * One frame on foot: ease the velocity toward what the keys (or the walk somewhere) want,
   * accelerating and slowing as a person does rather than starting and stopping dead; slide along
   * whatever's in the way; and follow the floor with the knees, not the eyes. Returns the speed.
   */
  stepWalk(dt) {
    const it = this.intent;
    let turn = it.turn + this.edgeTurn(), wx = 0, wz = 0;
    const yaw = this.yaw + this.look.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw); // forward over the floor; right is (-fz, fx)
    if (this.auto) {
      [wx, wz] = this.steer(dt);
    } else {
      // stepping back or sideways is slower than walking on
      let f = it.fwd < 0 ? it.fwd * 0.65 : it.fwd, s = it.strafe * 0.8;
      const n = Math.hypot(it.fwd, it.strafe);
      if (n > 1) {
        f /= n;
        s /= n;
      }
      const speed = it.run ? RUN : WALK;
      wx = (fx * f - fz * s) * speed;
      wz = (fz * f + fx * s) * speed;
    }
    this.turn(turn, dt);
    // speed up over about a stride, slow to a stop over about a step
    const dvx = wx - this.vel.x, dvz = wz - this.vel.y, dv = Math.hypot(dvx, dvz);
    if (dv > 1e-6) {
      const k = wx * wx + wz * wz > this.vel.lengthSq() ? 3.4 : 3.0;
      const step = Math.min(dv, dv * (1 - Math.exp(-dt * k)) + dt * 0.45);
      this.vel.x += (dvx / dv) * step;
      this.vel.y += (dvz / dv) * step;
    }
    const ox = this.pos.x, oz = this.pos.z;
    const tx = ox + this.vel.x * dt, tz = oz + this.vel.y * dt;
    this.pos.x = tx;
    this.pos.z = tz;
    if (this.bounds) {
      const floor = this.bounds(this.pos);
      if (typeof floor === 'number') this.floor = floor;
      const cx = this.pos.x - tx, cz = this.pos.z - tz, c = Math.hypot(cx, cz);
      if (c > 1e-6) {
        // starting out somewhere you can't stand (inside the desk, say): step clear, don't jump
        const most = (this.vel.length() + 1.2) * dt;
        if (c > most) {
          this.pos.x = tx + (cx / c) * most;
          this.pos.z = tz + (cz / c) * most;
        }
        // whatever was in the way took that part of the step: carry on with what's left, sliding along it
        const ax = (this.pos.x - ox) / dt, az = (this.pos.z - oz) / dt, a = Math.hypot(ax, az), cap = this.vel.length();
        const s = a > cap ? cap / a : 1;
        this.vel.set(ax * s, az * s);
      }
    }
    // eyes at standing height: a critically damped spring, so a step down is a soft dip
    const w = 9, target = this.floor + EYE;
    this.eyeVel += ((target - this.pos.y) * w * w - 2 * w * this.eyeVel) * dt;
    this.pos.y += this.eyeVel * dt;
    // and looking out level rather than down at the desk
    this.pitch += (-0.08 - this.pitch) * (1 - Math.exp(-dt * 2.5));
    return this.vel.length();
  }

  /** The cursor held near a side of the screen keeps turning you that way (on your feet, or swivelling in the chair). */
  edgeTurn() {
    if (!this.followOn || this.locked) return 0;
    const e = Math.abs(this.fol.x);
    return e > 0.7 ? -Math.sign(this.fol.x) * ((e - 0.7) / 0.3) * 1.5 : 0;
  }

  /** Swing round (turn -1..1 of full speed, beyond for the screen edge), easing in and out of it. */
  turn(turn, dt) {
    const want = clamp(turn, -1.6, 1.6) * 1.9;
    this.turnRate += (want - this.turnRate) * (1 - Math.exp(-dt * (want ? 7 : 5)));
    this.yaw += this.turnRate * dt;
  }

  /** The walk somewhere: which way to go, how fast, turning to face the way (and at the end, the way asked). */
  steer(dt) {
    const a = this.auto;
    let p = a.pts[0], dx = p.x - this.pos.x, dz = p.z - this.pos.z, dist = Math.hypot(dx, dz);
    while (a.pts.length > 1 && dist < 0.5) {
      a.pts.shift();
      a.best = Infinity;
      p = a.pts[0];
      dx = p.x - this.pos.x;
      dz = p.z - this.pos.z;
      dist = Math.hypot(dx, dz);
    }
    const last = a.pts.length === 1;
    // the body turns to the way it's going; where you look (the cursor) rides on top of that
    const cur = this.yaw;
    let want = dist > 0.3 ? Math.atan2(-dx, -dz) : cur;
    if (last && a.face != null && dist < 0.7) want = a.face;
    const diff = shortest(cur, want) - cur;
    this.yaw += diff * (1 - Math.exp(-dt * 3.4));
    // coming up to the last point, slow down the way a person does; and turn before striding off
    const speed = (last ? Math.min(WALK, Math.sqrt(2 * 0.9 * dist)) : WALK) * (0.3 + 0.7 * Math.max(0, Math.cos(diff)));
    if (dist < a.best - 0.02) {
      a.best = dist;
      a.stall = 0;
    } else a.stall += dt;
    const there = last && dist < 0.05 && this.vel.length() < 0.08 && (a.face == null || Math.abs(diff) < 0.03);
    if (there || a.stall > 1.6) {
      const done = a.onArrive;
      this.auto = null;
      if (done) done(!there);
      return [0, 0];
    }
    return dist > 0.02 ? [(dx / dist) * speed, (dz / dist) * speed] : [0, 0];
  }

  /**
   * The body under the camera: a gait (a dip and rise each step, a sway from foot to foot each
   * stride, the shoulders turning with it), breathing (quicker and deeper for a while after a run)
   * and the slow sway of someone standing, never quite still.
   */
  moveBody(dt, time, speed) {
    const b = this.body;
    if (this.reduced) {
      b.y = b.side = b.sx = b.sz = b.pitch = b.yaw = b.roll = 0;
      return;
    }
    const run = clamp((speed - WALK) / (RUN - WALK), 0, 1);
    b.stride += ((speed * dt) / (0.7 + 0.28 * run)) * Math.PI; // half a turn a step
    const amp = clamp(speed / WALK, 0, 1.5);
    b.bob += (amp - b.bob) * (1 - Math.exp(-dt * (amp > b.bob ? 3 : 4)));
    const exert = speed > 2.2 ? 1 : speed > 0.4 ? 0.3 : 0;
    b.exertion += (exert - b.exertion) * (1 - Math.exp(-dt * (exert > b.exertion ? 0.25 : 0.05)));
    b.breath += dt * TAU * (0.22 + 0.32 * b.exertion);
    const depth = 1 + 1.7 * b.exertion;
    const s = Math.sin(b.breath), breath = s > 0 ? s : s * 0.8; // a slightly longer, softer out-breath
    // reading something, you hold a little stiller
    const calm = 0.5 + 0.5 * this.followScale;
    const t = time;
    const st = b.stride, g = b.bob;
    b.y = -0.017 * g * Math.cos(2 * st) + 0.0045 * depth * breath;
    b.side = 0.011 * g * Math.sin(st);
    b.sx = calm * 0.0032 * (Math.sin(t * 0.29 + 1.1) + 0.6 * Math.sin(t * 0.71 + 0.3));
    b.sz = calm * 0.0032 * (Math.sin(t * 0.23 + 2.2) + 0.5 * Math.sin(t * 0.67 + 4.1));
    b.pitch = 0.0025 * g * Math.sin(2 * st + 0.8) + 0.0013 * depth * breath + calm * 0.0009 * (Math.sin(t * 0.27 + 0.5) + 0.6 * Math.sin(t * 0.61 + 2.3));
    b.yaw = 0.0018 * g * Math.sin(st) + calm * 0.0012 * (Math.sin(t * 0.19) + 0.7 * Math.sin(t * 0.53 + 1.7));
    b.roll = -0.004 * g * Math.sin(st) + calm * 0.0011 * Math.sin(t * 0.33 + 0.9);
  }

  update(dt, time) {
    let speed = 0; // over the floor, for the gait
    if (this.tween) {
      const tw = this.tween;
      const px = this.pos.x, pz = this.pos.z;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const e = minJerk(tw.t);
      if (tw.path) {
        // along the route at a walking pace, turning to look the way each waypoint faces
        const t = tw.path.pos.getUtoTmapping(e);
        tw.path.pos.getPoint(t, this.pos);
        const a = anglesTo(this.pos, tw.path.look.getPoint(t, tmpLook));
        this.yaw = shortest(this.yaw, a.yaw);
        this.pitch = a.pitch;
      } else {
        this.pos.lerpVectors(tw.from.pos, tw.to.pos, e);
        this.pos.y += Math.sin(Math.PI * e) * tw.arc;
        this.yaw = lerp(tw.from.yaw, tw.to.yaw, e);
        this.pitch = lerp(tw.from.pitch, tw.to.pitch, e);
      }
      this.fov = lerp(tw.from.fov, tw.to.fov, e);
      if (dt > 0) speed = (Math.hypot(this.pos.x - px, this.pos.z - pz) / dt) * tw.gait;
      if (tw.t >= 1) {
        this.tween = null;
        this.yaw = tw.path ? shortest(this.yaw, tw.to.yaw) : tw.to.yaw;
        this.pitch = tw.to.pitch;
        tw.onDone && tw.onDone();
      }
    }
    if (this.locked || this.held) {
      // mouse-look sets the look directly (mouseLook); held, it stays put
    } else if (this.view && this.followOn) {
      // Look where the cursor is: the middle of the view swings to what the pointer is over, right
      // away, with only enough smoothing to take the tremor out of a hand on a mouse. Toward the top
      // and bottom of the screen the reach grows, so on your feet you can look right down at the
      // desk or up at the ceiling. (Close-up views keep a gentler, scaled-down look.)
      const tv = Math.tan((this.fov * DEG) / 2);
      const th = tv * this.aspect;
      const scale = this.view.lookScale ?? 1;
      const onFoot = this.walking || this.sitting;
      const k = (onFoot ? 1 : scale) * this.followScale;
      const fy = this.fol.y;
      let ty = -Math.atan(this.fol.x * th) * k;
      let tp = -Math.atan(fy * tv) * k;
      if (onFoot || scale >= 1) {
        const edge = Math.max(0, Math.abs(fy) - 0.5) / 0.5;
        tp -= Math.sign(fy) * edge * edge * (fy > 0 ? 0.6 : 0.35) * this.followScale;
      }
      tp = clamp(tp, -1.35 - this.pitch, 1.1 - this.pitch); // never quite straight down or up
      const s = this.reduced ? 1 : 1 - Math.exp(-dt * 22);
      this.look.yaw += (ty - this.look.yaw) * s;
      this.look.pitch += (tp - this.look.pitch) * s;
    } else if (this.view && !this.dragging && !this.tween) {
      // touch: inertia from a drag, then a soft pull back toward the composed view
      const damp = Math.exp(-dt * 5);
      if (this.walking || this.sitting) {
        this.yaw += this.look.vy * dt;
        this.look.pitch = clamp(this.look.pitch + this.look.vp * dt, -1.1, 0.7);
      } else {
        this.look.yaw += this.look.vy * dt;
        this.look.pitch += this.look.vp * dt;
        this.clampLook();
        if (this.view.spring) {
          const s = 1 - Math.exp(-dt * this.view.spring);
          this.look.yaw -= this.look.yaw * s;
          this.look.pitch -= this.look.pitch * s;
        }
      }
      this.look.vy *= damp;
      this.look.vp *= damp;
    }
    if (this.walking && !this.tween && dt > 0) speed = this.stepWalk(dt);
    else if (this.sitting && !this.tween) this.turn(this.intent.turn + this.edgeTurn(), dt);
    this.moveBody(dt, time, speed);
    const sk = this.reduced ? 1 : 1 - Math.exp(-dt * 4);
    this.shift += (this.shiftTarget - this.shift) * sk;
    this.shiftPitch += (this.shiftPitchTarget - this.shiftPitch) * sk;
    const pk = 1 - Math.exp(-dt * 3);
    this.par.x += (this.par.tx - this.par.x) * pk;
    this.par.y += (this.par.ty - this.par.y) * pk;

    // the body's motion rides on top of the pose: sideways along the view, sway, breathing
    const b = this.body;
    const yaw = this.yaw + this.look.yaw + this.par.x + this.shift + b.yaw;
    this.camera.position.copy(this.pos);
    this.camera.position.x += Math.cos(yaw) * b.side + b.sx;
    this.camera.position.z += -Math.sin(yaw) * b.side + b.sz;
    this.camera.position.y += b.y;
    this.camera.rotation.set(this.pitch + this.look.pitch + this.par.y + this.shiftPitch + b.pitch, yaw, b.roll, 'YXZ');
    if (Math.abs(this.camera.fov - this.fov) > 1e-3) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    // now, not at render time: the view out of the window is drawn first and copies these
    // matrices, so stale ones made the mountains trail a frame behind the room
    this.camera.updateMatrixWorld();
  }
}
