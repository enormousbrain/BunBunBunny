// recipeToWorldPlan — the pure expansion both sides consume. Sim instantiates physics
// from it; render instantiates visuals from it. Because expansion is deterministic
// (placement array order; grid layer->row->col; scatter PRNG sequence), client and
// server agree on bodyId by construction — no registration handshake, ever.

import type {
  Archetype,
  BodyClass,
  MovementPlane,
  Placement,
  Substrate,
  ValidRecipe,
  Vec3,
} from './schema';
import { computeRecipeId } from './recipe-id';

export interface PlannedBody {
  /** Dense u16, assigned in expansion order. This is the id on the wire. */
  readonly bodyId: number;
  readonly archetypeId: string;
  readonly bodyClass: BodyClass;
  readonly position: Vec3;
  readonly yaw: number;
}

export interface WorldPlan {
  readonly recipeId: string;
  readonly gravity: Vec3;
  readonly movementPlane: MovementPlane;
  readonly substrate: Substrate;
  /** Passed through so sim and render need ONLY the plan -- never the recipe. */
  readonly archetypes: readonly Archetype[];
  readonly spawnPoints: readonly Vec3[];
  readonly bodies: readonly PlannedBody[];
}

// Deterministic PRNG for scatter placements. Local mutable state inside a closure is the
// idiomatic PRNG shape; it never escapes.
const mulberry32 = (seed: number): (() => number) => {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type Pose = { readonly position: Vec3; readonly yaw: number };

const expandPlacement = (placement: Placement): readonly Pose[] => {
  switch (placement.kind) {
    case 'single':
      return [{ position: placement.position, yaw: placement.yaw ?? 0 }];
    case 'grid': {
      const poses: Pose[] = [];
      const { origin, spacing } = placement;
      for (let layer = 0; layer < placement.layers; layer += 1) {
        for (let row = 0; row < placement.rows; row += 1) {
          for (let column = 0; column < placement.columns; column += 1) {
            poses.push({
              position: {
                x: origin.x + column * spacing,
                y: origin.y + layer * spacing,
                z: origin.z + row * spacing,
              },
              yaw: 0,
            });
          }
        }
      }
      return poses;
    }
    case 'scatter': {
      const next = mulberry32(placement.seed);
      const poses: Pose[] = [];
      for (let i = 0; i < placement.count; i += 1) {
        // sqrt for uniform density on the disc; draw order is part of determinism.
        const angle = next() * Math.PI * 2;
        const distance = placement.radius * Math.sqrt(next());
        const yaw = next() * Math.PI * 2;
        poses.push({
          position: {
            x: placement.center.x + Math.cos(angle) * distance,
            y: placement.center.y,
            z: placement.center.z + Math.sin(angle) * distance,
          },
          yaw,
        });
      }
      return poses;
    }
  }
};

export const recipeToWorldPlan = (recipe: ValidRecipe): WorldPlan => {
  const classById = new Map(recipe.archetypes.map((a) => [a.id, a.bodyClass]));
  const bodies = recipe.placements.flatMap((placement) => {
    const bodyClass = classById.get(placement.archetypeId);
    if (bodyClass === undefined)
      throw new Error(`unvalidated recipe reached worldPlan: '${placement.archetypeId}'`);
    return expandPlacement(placement).map((pose) => ({
      archetypeId: placement.archetypeId,
      bodyClass,
      ...pose,
    }));
  });
  return {
    recipeId: computeRecipeId(recipe),
    gravity: { x: 0, y: -recipe.substrate.gravity, z: 0 },
    movementPlane: recipe.movementPlane,
    substrate: recipe.substrate,
    archetypes: recipe.archetypes,
    spawnPoints: recipe.spawnPoints,
    bodies: bodies.map((body, bodyId) => ({ bodyId, ...body })),
  };
};
