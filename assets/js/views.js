import * as THREE from '../vendor/three.module.min.js';

/**
 * Camera viewpoints. pos/target are world positions; hfov is the minimum
 * horizontal field of view (so narrow screens widen vertically); look is the
 * allowed [yaw, pitch] drag range in radians.
 */
export function makeViews(world) {
  const { ctx } = world;
  const views = {
    main: { pos: [0, 1.62, 2.55], target: [0, 1.0, -1.5], hfov: 74, vfov: 46, look: [1.3, 0.42], maxV: 68, backoff: 0.5 },
    desk: { pos: [-0.38, 1.52, 0.3], target: [-0.38, 0.74, -0.76], hfov: 64, vfov: 44, look: [0.3, 0.16], spring: 0.5, backoff: 0.6 },
    library: { pos: [-2.02, 1.5, -1.8], target: [-2.02, 1.44, -3.02], hfov: 50, vfov: 38, look: [0.45, 0.25], spring: 0.4, backoff: 0.9 },
    podcasts: { pos: [2.08, 1.16, -1.67], target: [2.68, 0.85, -1.67], hfov: 50, vfov: 38, look: [0.4, 0.2], spring: 0.4, backoff: 0.6 },
    contact: { pos: [0.98, 1.22, 0.08], target: [0.82, 0.8, -0.86], hfov: 52, vfov: 40, look: [0.3, 0.18], spring: 0.5, backoff: 0.5 },
    about: { pos: [-0.3, 1.06, 0.2], target: [-0.36, 0.82, -0.52], hfov: 54, vfov: 40, look: [0.3, 0.18], spring: 0.5, backoff: 0.5 },
    window: { pos: [0.0, 1.6, -1.8], target: [0.0, 1.74, -3.4], hfov: 70, vfov: 48, look: [0.5, 0.3], spring: 0.3 },
  };

  // terminal: square-on to the CRT, close enough that the screen fills the frame
  const { group, center } = ctx.terminalFrame;
  group.updateMatrixWorld(true);
  const c = group.localToWorld(new THREE.Vector3(...center));
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()));
  const p = c.clone().addScaledVector(n, 0.6);
  p.y += 0.035;
  views.terminal = { pos: p.toArray(), target: c.toArray(), hfov: 34, vfov: 30, look: [0.12, 0.08], spring: 1.2, backoff: 0.5 };
  return views;
}
