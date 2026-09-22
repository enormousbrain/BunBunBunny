// L6 — a broken post is unrepresentable. validate() is the only door into ValidRecipe;
// backfill() is how a sparse draft ships safely (§4.2/§4.3).

import type { Placement, Recipe, ValidRecipe } from './schema';

export interface Issue {
  readonly path: string;
  readonly message: string;
}

export type ValidationResult =
  | { readonly ok: true; readonly recipe: ValidRecipe }
  | { readonly ok: false; readonly issues: readonly Issue[] };

/** Wire format carries u16 body ids; this is the hard ceiling. */
export const HARD_BODY_CAP = 65_535;
// ponytail: soft cap is a guess pending the varied-mesh render test (ledger #17) and
// production awake budgets (ledger #1). Raise or lower with measurements, not vibes.
export const SOFT_BODY_CAP = 1_024;

const placementBodyCount = (placement: Placement): number => {
  switch (placement.kind) {
    case 'single':
      return 1;
    case 'grid':
      return placement.columns * placement.rows * placement.layers;
    case 'scatter':
      return placement.count;
  }
};

export const expandedBodyCount = (recipe: Recipe): number =>
  recipe.placements.reduce((sum, p) => sum + placementBodyCount(p), 0);

const isFiniteNumber = (value: number): boolean => Number.isFinite(value);

const isPositiveInt = (value: number): boolean =>
  Number.isInteger(value) && value >= 1;

export const validate = (recipe: Recipe): ValidationResult => {
  const issues: Issue[] = [];
  const flag = (path: string, message: string): void => {
    issues.push({ path, message });
  };

  if (recipe.name.trim().length === 0) flag('name', 'must be non-empty');

  const { substrate } = recipe;
  if (!(substrate.gravity > 0)) flag('substrate.gravity', 'must be > 0');
  const { player } = substrate;
  if (!(player.accel > 0)) flag('substrate.player.accel', 'must be > 0');
  if (!(player.maxSpeed > 0)) flag('substrate.player.maxSpeed', 'must be > 0');
  if (!(player.jumpImpulse >= 0)) flag('substrate.player.jumpImpulse', 'must be >= 0');
  if (!(player.airControl >= 0 && player.airControl <= 1))
    flag('substrate.player.airControl', 'must be in 0..1');
  if (!(player.capsule.radius > 0)) flag('substrate.player.capsule.radius', 'must be > 0');
  if (!(player.capsule.halfHeight > 0))
    flag('substrate.player.capsule.halfHeight', 'must be > 0');

  const archetypeIds = new Set<string>();
  recipe.archetypes.forEach((archetype, i) => {
    const path = `archetypes[${i}]`;
    if (archetypeIds.has(archetype.id)) flag(`${path}.id`, `duplicate id '${archetype.id}'`);
    archetypeIds.add(archetype.id);
    if (archetype.bodyClass !== 'fixed' && !(archetype.density > 0))
      flag(`${path}.density`, 'must be > 0 for non-fixed bodies');
    if (!(archetype.restitution >= 0 && archetype.restitution <= 1))
      flag(`${path}.restitution`, 'must be in 0..1');
    if (!(archetype.friction >= 0)) flag(`${path}.friction`, 'must be >= 0');
    const { shape } = archetype;
    switch (shape.kind) {
      case 'box':
        if (!(shape.halfExtents.x > 0 && shape.halfExtents.y > 0 && shape.halfExtents.z > 0))
          flag(`${path}.shape.halfExtents`, 'all components must be > 0');
        break;
      case 'sphere':
        if (!(shape.radius > 0)) flag(`${path}.shape.radius`, 'must be > 0');
        break;
      case 'cylinder':
        if (!(shape.radius > 0)) flag(`${path}.shape.radius`, 'must be > 0');
        if (!(shape.halfHeight > 0)) flag(`${path}.shape.halfHeight`, 'must be > 0');
        break;
    }
  });

  recipe.placements.forEach((placement, i) => {
    const path = `placements[${i}]`;
    if (!archetypeIds.has(placement.archetypeId))
      flag(`${path}.archetypeId`, `unknown archetype '${placement.archetypeId}'`);
    switch (placement.kind) {
      case 'single':
        if (placement.yaw !== undefined && !isFiniteNumber(placement.yaw))
          flag(`${path}.yaw`, 'must be finite');
        break;
      case 'grid':
        if (!isPositiveInt(placement.columns)) flag(`${path}.columns`, 'must be int >= 1');
        if (!isPositiveInt(placement.rows)) flag(`${path}.rows`, 'must be int >= 1');
        if (!isPositiveInt(placement.layers)) flag(`${path}.layers`, 'must be int >= 1');
        if (!(placement.spacing > 0)) flag(`${path}.spacing`, 'must be > 0');
        break;
      case 'scatter':
        if (!isPositiveInt(placement.count)) flag(`${path}.count`, 'must be int >= 1');
        if (!Number.isInteger(placement.seed)) flag(`${path}.seed`, 'must be an integer');
        if (!(placement.radius > 0)) flag(`${path}.radius`, 'must be > 0');
        break;
    }
  });

  const bodyCount = expandedBodyCount(recipe);
  if (bodyCount > HARD_BODY_CAP)
    flag('placements', `expands to ${bodyCount} bodies; hard cap is ${HARD_BODY_CAP} (u16 ids)`);
  else if (bodyCount > SOFT_BODY_CAP)
    flag('placements', `expands to ${bodyCount} bodies; soft cap is ${SOFT_BODY_CAP}`);

  if (recipe.spawnPoints.length === 0) flag('spawnPoints', 'need at least one spawn point');

  if (!(recipe.relicTable.maxSpawns >= 0) || !Number.isInteger(recipe.relicTable.maxSpawns))
    flag('relicTable.maxSpawns', 'must be int >= 0');

  return issues.length === 0
    ? { ok: true, recipe: recipe as ValidRecipe }
    : { ok: false, issues };
};

/** §4.3 defaults — what an empty/sparse draft ships as. Every field has a backfill (L6). */
export const RECIPE_DEFAULTS = {
  movementPlane: 'ground',
  camera: 'isometric',
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
  spawnPoints: [{ x: 0, y: 1.5, z: 0 }],
  relicTable: { maxSpawns: 8 },
  previewShot: { kind: 'auto-director' },
} as const satisfies Partial<Recipe>;

/** Fill a sparse draft with defaults, then validate. The random half of §4.3 lives elsewhere. */
export const backfill = (
  draft: Partial<Recipe> & Pick<Recipe, 'name' | 'archetypes' | 'placements'>,
): ValidationResult =>
  validate({
    ...RECIPE_DEFAULTS,
    ...draft,
  });
