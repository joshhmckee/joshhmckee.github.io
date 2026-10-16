import * as THREE from '../vendor/three.module.min.js';

/** Room: x from -3 to 3, z from -3.4 (window wall) to 3.2, floor at y = 0. */
export const ROOM = { x0: -3.0, x1: 3.0, z0: -3.4, z1: 3.2, h: 3.0, wall: 0.2 };

/** Window opening in the back wall. */
export const WIN = { x0: -1.15, x1: 1.15, y0: 0.95, y1: 2.6 };

/** Venetian blinds hang just inside the window recess. */
export const BLINDS = {
  z: ROOM.z0 - 0.035,
  top: WIN.y1 - 0.05,
  bottom: WIN.y0 + 0.03,
  pitch: 0.07,
  depth: 0.066,
  thick: 0.005,
  width: WIN.x1 - WIN.x0 - 0.06,
  tiltOpen: -0.3,
  tiltNormal: 0.42,
  tiltClosed: 1.2,
};

/** Direction from the room toward the low evening sun (behind the window, up and to the left). */
export const SUN_DIR = new THREE.Vector3(-0.22, 0.4, -0.89).normalize();

/** Desk: long axis along x, the visitor/owner side faces +z (toward the camera). */
export const DESK = { x: 0, z: -0.78, w: 2.0, d: 0.95, top: 0.76 };

/** Light gets through the blinds in proportion to how much each slat blocks along the sun's path. */
export function blindsOpenFraction(tilt) {
  const phi = Math.atan2(SUN_DIR.y, Math.hypot(SUN_DIR.x, SUN_DIR.z));
  const blocked = (BLINDS.depth * Math.abs(Math.sin(tilt + phi))) / (BLINDS.pitch * Math.cos(phi));
  return Math.max(0.02, Math.min(1, 1 - blocked));
}
