import { describe, expect, it } from 'vitest';
import type { Recipe } from './schema';
import { backfill, expandedBodyCount, validate } from './validate';
import { computeRecipeId } from './recipe-id';
import { recipeToWorldPlan } from './world-plan';
import { THE_PLAYGROUND } from './the-playground';

const validPlayground = () => {
  const result = validate(THE_PLAYGROUND);
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
  return result.recipe;
};

const defined = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) throw new Error(`${label} missing from playground fixture`);
  return value;
};

describe('validate', () => {
  it('accepts the blessed playground recipe', () => {
    expect(validate(THE_PLAYGROUND).ok).toBe(true);
  });

  it('rejects a placement referencing an unknown archetype', () => {
    const broken: Recipe = {
      ...THE_PLAYGROUND,
      placements: [
        { kind: 'single', archetypeId: 'ghost', position: { x: 0, y: 0, z: 0 } },
      ],
    };
    const result = validate(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.message).toContain('ghost');
    }
  });

  it('rejects out-of-domain restitution', () => {
    const broken: Recipe = {
      ...THE_PLAYGROUND,
      archetypes: [{ ...defined(THE_PLAYGROUND.archetypes[0], 'first archetype'), restitution: 1.5 }],
      placements: [defined(THE_PLAYGROUND.placements[0], 'first placement')],
    };
    expect(validate(broken).ok).toBe(false);
  });

  it('backfills a sparse draft into a valid recipe (L6)', () => {
    const result = backfill({
      name: 'Sparse',
      archetypes: [defined(THE_PLAYGROUND.archetypes[0], 'first archetype')],
      placements: [defined(THE_PLAYGROUND.placements[0], 'first placement')],
    });
    expect(result.ok).toBe(true);
  });
});

describe('recipeToWorldPlan', () => {
  it('expands the playground to the documented body count', () => {
    expect(expandedBodyCount(THE_PLAYGROUND)).toBe(109);
    expect(recipeToWorldPlan(validPlayground()).bodies).toHaveLength(109);
  });

  it('is deterministic — same recipe, identical plan', () => {
    const recipe = validPlayground();
    expect(recipeToWorldPlan(recipe)).toEqual(recipeToWorldPlan(recipe));
  });

  it('assigns dense bodyIds in expansion order', () => {
    const plan = recipeToWorldPlan(validPlayground());
    plan.bodies.forEach((body, index) => {
      expect(body.bodyId).toBe(index);
    });
  });
});

describe('computeRecipeId', () => {
  it('is insensitive to property insertion order', () => {
    const reordered = JSON.parse(JSON.stringify(THE_PLAYGROUND)) as Recipe;
    const shuffled: Recipe = { ...reordered, name: reordered.name };
    expect(computeRecipeId(shuffled)).toBe(computeRecipeId(THE_PLAYGROUND));
  });

  it('changes when content changes', () => {
    const tweaked: Recipe = {
      ...THE_PLAYGROUND,
      substrate: { ...THE_PLAYGROUND.substrate, gravity: 9.8 },
    };
    expect(computeRecipeId(tweaked)).not.toBe(computeRecipeId(THE_PLAYGROUND));
  });
});
