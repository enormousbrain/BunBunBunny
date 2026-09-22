// Recipe schema — spec §4.1. A post is a recipe: a small set of enumerable knobs
// over the fixed physics substrate. Pure data; the only executable neighbors are
// validate() and recipeToWorldPlan().

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** L1 — movement plane is a constraint knob, separate from camera. Enforced in the sim. */
export type MovementPlane = 'free' | 'side' | 'ground';

/** §7 — enumerable menu of named, solved packages. Not a free dial. */
export type CameraMode = 'side-2d' | 'isometric';

/** §8.1 body classes. 'destructible' is dynamic + may despawn on threshold impact. */
export type BodyClass = 'fixed' | 'dynamic' | 'destructible';

export type Shape =
  | { readonly kind: 'box'; readonly halfExtents: Vec3 }
  | { readonly kind: 'sphere'; readonly radius: number }
  | { readonly kind: 'cylinder'; readonly halfHeight: number; readonly radius: number };

/**
 * An ingredient archetype: one physical/visual kind of prop. Placements reference
 * archetypes by id; render side maps materialTag -> InstancedMesh appearance.
 */
export interface Archetype {
  readonly id: string;
  readonly shape: Shape;
  readonly bodyClass: BodyClass;
  /** kg/m^3-ish; ignored for 'fixed'. */
  readonly density: number;
  /** 0..1 bounciness. */
  readonly restitution: number;
  /** >= 0. */
  readonly friction: number;
  /** Render-side lookup key. No physics meaning. */
  readonly materialTag: string;
}

// ponytail: placements are yaw-only (no pitch/roll). Ramps and tilted props need full
// orientation — add a quaternion variant when the first recipe actually wants one.
export type Placement =
  | {
      readonly kind: 'single';
      readonly archetypeId: string;
      readonly position: Vec3;
      readonly yaw?: number;
    }
  | {
      /** A rectangular stack. Expansion order: layer -> row -> column (bodyId order). */
      readonly kind: 'grid';
      readonly archetypeId: string;
      readonly origin: Vec3;
      readonly columns: number;
      readonly rows: number;
      readonly layers: number;
      readonly spacing: number;
    }
  | {
      /** Seeded uniform scatter on a disc. Same seed -> same positions, everywhere. */
      readonly kind: 'scatter';
      readonly archetypeId: string;
      readonly count: number;
      readonly seed: number;
      readonly center: Vec3;
      readonly radius: number;
    };

/** Substrate tuning — the shared sandbox constants, including the character controller dial. */
export interface Substrate {
  /** Gravity magnitude (applied as -y). */
  readonly gravity: number;
  readonly player: {
    readonly accel: number;
    readonly maxSpeed: number;
    readonly jumpImpulse: number;
    /** 0..1 fraction of ground accel available airborne. */
    readonly airControl: number;
    readonly capsule: { readonly radius: number; readonly halfHeight: number };
  };
}

/** §6 / L4 — spawn *rules* only. Relic properties are platform-injected, never authored here. */
export interface RelicTable {
  readonly maxSpawns: number;
}

/** §9.3 — auto-director is the universal backfill. */
export type PreviewShot =
  | { readonly kind: 'auto-director' }
  | { readonly kind: 'named'; readonly shotId: string };

export interface Recipe {
  readonly name: string;
  readonly substrate: Substrate;
  readonly movementPlane: MovementPlane;
  readonly camera: CameraMode;
  readonly archetypes: readonly Archetype[];
  readonly placements: readonly Placement[];
  readonly spawnPoints: readonly Vec3[];
  readonly relicTable: RelicTable;
  readonly previewShot: PreviewShot;
}

declare const validBrand: unique symbol;
/**
 * A Recipe that has passed validate(). recipeToWorldPlan() accepts only this,
 * so an unvalidated recipe reaching the sim is a type error, not a runtime surprise (L6).
 */
export type ValidRecipe = Recipe & { readonly [validBrand]: true };
