import * as THREE from '../vendor/three.module.min.js';

/** Room: x from -3 to 3, z from -3.4 (window wall) to 3.2, floor at y = 0. */
export const ROOM = { x0: -3.0, x1: 3.0, z0: -3.4, z1: 3.2, h: 3.0, wall: 0.2 };

/** Window opening in the back wall. */
export const WIN = { x0: -1.15, x1: 1.15, y0: 0.95, y1: 2.6 };

/** The window glass sits in the middle of the wall's thickness. */
export const GLASS_Z = ROOM.z0 - 0.12;

/** Direction from the room toward the low evening sun (behind the window, up and to the left). */
export const SUN_DIR = new THREE.Vector3(-0.22, 0.4, -0.89).normalize();

/** Desk: long axis along x, the visitor/owner side faces +z (toward the camera). */
export const DESK = { x: 0, z: -0.78, w: 2.0, d: 0.95, top: 0.76 };
