import * as THREE from '../vendor/three.module.min.js';
import { buildRoom } from './room.js';
import { buildShelves, buildHeroBooks } from './shelves.js';
import { buildDesk, buildResearchPiles, buildMate } from './desk.js';
import { buildDecor, buildTapes } from './decor.js';
import { buildEffects, shaftUniforms } from './effects.js';
import { buildDog } from './dog.js';
import { mergeStatic } from './util.js';

export function buildWorld({ content, images, quality, screen }) {
  const scene = new THREE.Scene();
  const ctx = { scene, mats: {}, anchors: {}, quality, images, screen };
  buildRoom(ctx);
  buildShelves(ctx);
  buildDesk(ctx);
  buildDecor(ctx);
  buildMate(ctx);
  const books = buildHeroBooks(ctx, content.library);
  const piles = buildResearchPiles(ctx, content.reports);
  const tapes = buildTapes(ctx, content.podcasts);
  const dog = buildDog(ctx);
  const shaft = shaftUniforms();
  const fx = buildEffects(ctx, shaft);
  mergeStatic(scene);
  return { scene, ctx, books, piles, tapes, fx, shaft, dog };
}
