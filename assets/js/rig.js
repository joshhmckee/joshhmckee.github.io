import * as THREE from '../vendor/three.module.min.js';
import { clamp, lerp, easeInOut, DEG } from './util.js';

const tmp = new THREE.Vector3();

function anglesTo(pos, target) {
  tmp.copy(target).sub(pos).normalize();
  return { yaw: Math.atan2(-tmp.x, -tmp.z), pitch: Math.asin(clamp(tmp.y, -1, 1)) };
}

function shortest(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d;
}

/**
 * A view is { pos, target, hfov, vfov, look: [yawRange, pitchRange] }.
 * The rig keeps a base pose (from the view) plus user look offsets and parallax.
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
    this.shiftPitch = 0;
    this.shiftPitchTarget = 0;
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

  set(view) {
    this.view = view;
    const p = this.poseFor(view);
    this.pos.copy(p.pos);
    this.yaw = p.yaw;
    this.pitch = p.pitch;
    this.fov = p.fov;
    this.look.yaw = this.look.pitch = this.look.vy = this.look.vp = 0;
    this.tween = null;
  }

  go(view, { duration = 1.25, arc = 0.06, onDone = null } = {}) {
    const to = this.poseFor(view);
    const fromYaw = this.yaw + this.look.yaw;
    const fromPitch = this.pitch + this.look.pitch;
    this.view = view;
    this.look.yaw = this.look.pitch = this.look.vy = this.look.vp = 0;
    const dist = this.pos.distanceTo(to.pos);
    const dur = this.reduced ? 0.001 : duration * clamp(0.55 + dist * 0.18, 0.6, 1.35);
    this.tween = {
      t: 0,
      dur,
      from: { pos: this.pos.clone(), yaw: fromYaw, pitch: fromPitch, fov: this.fov },
      to: { ...to, yaw: shortest(fromYaw, to.yaw) },
      arc: arc * Math.min(1, dist),
      onDone,
    };
  }

  resize(aspect) {
    this.aspect = aspect;
    if (this.view && !this.tween) {
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

  /** Look toward the cursor: nx, ny in -1..1 from the screen centre. */
  follow(nx, ny) {
    this.followOn = true;
    this.fol.x = clamp(nx, -1, 1);
    this.fol.y = clamp(ny, -1, 1);
  }

  get moving() {
    return !!this.tween;
  }

  update(dt, time) {
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const e = easeInOut(tw.t);
      this.pos.lerpVectors(tw.from.pos, tw.to.pos, e);
      this.pos.y += Math.sin(Math.PI * e) * tw.arc;
      this.yaw = lerp(tw.from.yaw, tw.to.yaw, e);
      this.pitch = lerp(tw.from.pitch, tw.to.pitch, e);
      this.fov = lerp(tw.from.fov, tw.to.fov, e);
      if (tw.t >= 1) {
        this.tween = null;
        this.yaw = tw.to.yaw;
        this.pitch = tw.to.pitch;
        tw.onDone && tw.onDone();
      }
    } else if (this.view && this.followOn) {
      // Turn toward the cursor, but always slower than the cursor itself moves across the
      // picture (gain < 1), so whatever you reach for drifts toward the pointer instead of away.
      const tv = Math.tan((this.fov * DEG) / 2);
      const th = tv * this.aspect;
      const k = (this.view.lookScale ?? 1) * this.followScale;
      const ty = -this.fol.x * 0.65 * th * k;
      const tp = -this.fol.y * 0.55 * tv * k;
      const s = this.reduced ? 1 : 1 - Math.exp(-dt * 3.2);
      this.look.yaw += (ty - this.look.yaw) * s;
      this.look.pitch += (tp - this.look.pitch) * s;
    } else if (this.view && !this.dragging) {
      // touch: inertia from a drag, then a soft pull back toward the composed view
      this.look.yaw += this.look.vy * dt;
      this.look.pitch += this.look.vp * dt;
      const damp = Math.exp(-dt * 5);
      this.look.vy *= damp;
      this.look.vp *= damp;
      this.clampLook();
      if (this.view.spring) {
        const s = 1 - Math.exp(-dt * this.view.spring);
        this.look.yaw -= this.look.yaw * s;
        this.look.pitch -= this.look.pitch * s;
      }
    }
    const sk = this.reduced ? 1 : 1 - Math.exp(-dt * 4);
    this.shift += (this.shiftTarget - this.shift) * sk;
    this.shiftPitch += (this.shiftPitchTarget - this.shiftPitch) * sk;
    const pk = 1 - Math.exp(-dt * 3);
    this.par.x += (this.par.tx - this.par.x) * pk;
    this.par.y += (this.par.ty - this.par.y) * pk;

    const breathe = this.reduced ? 0 : Math.sin(time * 0.7) * 0.004;
    this.camera.position.copy(this.pos);
    this.camera.position.y += breathe;
    this.camera.rotation.set(this.pitch + this.look.pitch + this.par.y + this.shiftPitch, this.yaw + this.look.yaw + this.par.x + this.shift, 0, 'YXZ');
    if (Math.abs(this.camera.fov - this.fov) > 1e-3) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
