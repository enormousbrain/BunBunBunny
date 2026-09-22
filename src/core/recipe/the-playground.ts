// The first blessed recipe (§4.3). Pure data — no logic, nothing executable. This is
// the shape the cold-start engine mints and the shape AI generation targets: emit an
// object like this that validates, and you have shipped a game.

import type { Recipe } from './schema';

export const THE_PLAYGROUND: Recipe = {
  name: 'The Playground',
  substrate: {
    gravity: 9.81,
    player: {
      accel: 40,
      maxSpeed: 6,
      jumpImpulse: 5.5,
      airControl: 0.3,
      capsule: { radius: 0.35, halfHeight: 0.55 },
    },
  },
  movementPlane: 'free',
  // The shippable default; the playground page overlays a dev-only orbit camera at runtime.
  camera: 'isometric',
  archetypes: [
    {
      id: 'ground',
      shape: { kind: 'box', halfExtents: { x: 15, y: 0.25, z: 15 } },
      bodyClass: 'fixed',
      density: 1,
      restitution: 0.05,
      friction: 0.9,
      materialTag: 'ground',
    },
    {
      id: 'crate',
      shape: { kind: 'box', halfExtents: { x: 0.4, y: 0.4, z: 0.4 } },
      bodyClass: 'dynamic',
      density: 1,
      restitution: 0.1,
      friction: 0.6,
      materialTag: 'crate',
    },
    {
      id: 'ball',
      shape: { kind: 'sphere', radius: 0.35 },
      bodyClass: 'dynamic',
      density: 0.6,
      restitution: 0.55,
      friction: 0.4,
      materialTag: 'ball',
    },
    {
      id: 'pillar',
      shape: { kind: 'cylinder', halfHeight: 1.2, radius: 0.35 },
      bodyClass: 'fixed',
      density: 1,
      restitution: 0.1,
      friction: 0.8,
      materialTag: 'pillar',
    },
    {
      id: 'block',
      shape: { kind: 'box', halfExtents: { x: 0.35, y: 0.35, z: 0.35 } },
      bodyClass: 'destructible',
      density: 0.8,
      restitution: 0.15,
      friction: 0.5,
      materialTag: 'block',
    },
  ],
  placements: [
    { kind: 'single', archetypeId: 'ground', position: { x: 0, y: -0.25, z: 0 } },
    // The crate pile — the shove-and-topple centerpiece. 5x4x3 = 60 bodies.
    {
      kind: 'grid',
      archetypeId: 'crate',
      origin: { x: -3.6, y: 0.4, z: -4.2 },
      columns: 5,
      rows: 4,
      layers: 3,
      spacing: 0.82,
    },
    // Loose balls to kick around. 12 bodies, deterministic from the seed.
    {
      kind: 'scatter',
      archetypeId: 'ball',
      count: 12,
      seed: 7,
      center: { x: 4.5, y: 0.35, z: 0 },
      radius: 4,
    },
    // Fixed pillars — cover, corners, something to bank shots off.
    { kind: 'single', archetypeId: 'pillar', position: { x: -8, y: 1.2, z: -8 } },
    { kind: 'single', archetypeId: 'pillar', position: { x: 8, y: 1.2, z: -8 } },
    { kind: 'single', archetypeId: 'pillar', position: { x: -8, y: 1.2, z: 8 } },
    { kind: 'single', archetypeId: 'pillar', position: { x: 8, y: 1.2, z: 8 } },
    // The destructible wall — 8 wide x 4 tall = 32 bodies begging to be run through.
    {
      kind: 'grid',
      archetypeId: 'block',
      origin: { x: -2.55, y: 0.35, z: 5.5 },
      columns: 8,
      rows: 1,
      layers: 4,
      spacing: 0.72,
    },
  ],
  // 1 + 60 + 12 + 4 + 32 = 109 bodies total; well under the soft cap.
  spawnPoints: [
    { x: -5, y: 1, z: 0 },
    { x: 5, y: 1, z: 3 },
    { x: 0, y: 1, z: -6 },
    { x: 0, y: 1, z: 2.5 },
  ],
  relicTable: { maxSpawns: 8 },
  previewShot: { kind: 'auto-director' },
};
