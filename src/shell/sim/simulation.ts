// The authoritative simulation (plan doc §0, §4). Headless by construction: imports
// Rapier and core only -- no three.js, no DOM, no rAF. Runs identically inside a Web
// Worker today and a Node room server later; that portability IS the architecture.
//
// Verified against @dimforge/rapier3d-compat 0.19.3 (API names checked, not recalled).

import RAPIER from '@dimforge/rapier3d-compat';
import type { Archetype, Vec3 } from '../../core/recipe/schema';
import type { WorldPlan } from '../../core/recipe/world-plan';
import type { InputCommand } from '../../core/net/input';
import { playerBodyId, type BodyPose, type Snapshot } from '../../core/net/snapshot';
import { enabledTranslations } from '../../core/camera/modes';

export const TICK_RATE_HZ = 30;
export const TICK_SECONDS = 1 / TICK_RATE_HZ;

/** Extra ray reach beyond the capsule bottom that still counts as grounded. */
const GROUND_PROBE = 0.08;
// ponytail: player collider friction is a feel dial, not physics truth. Low value
// avoids sticking to walls; tune in playtest alongside accel/maxSpeed.
const PLAYER_FRICTION = 0.2;

let physicsReady: Promise<unknown> | undefined;
/** Must resolve before createSimulation. Idempotent. */
export const initPhysics = (): Promise<unknown> => {
  physicsReady ??= RAPIER.init();
  return physicsReady;
};

export interface Simulation {
  readonly addPlayer: () => { readonly slot: number; readonly bodyId: number };
  readonly applyInput: (command: InputCommand) => void;
  readonly step: () => void;
  readonly tick: () => number;
  /** Awake, non-fixed bodies only -- the per-tick broadcast (spec §8.1). */
  readonly awakeSnapshot: () => Snapshot;
  /** All non-fixed bodies regardless of sleep -- the join/rejoin baseline. */
  readonly fullSnapshot: () => Snapshot;
  readonly free: () => void;
}

interface PlayerState {
  readonly slot: number;
  readonly bodyId: number;
  readonly body: RAPIER.RigidBody;
  latest: InputCommand | undefined;
}

const colliderDescFor = (archetype: Archetype): RAPIER.ColliderDesc => {
  const { shape } = archetype;
  const desc =
    shape.kind === 'box'
      ? RAPIER.ColliderDesc.cuboid(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z)
      : shape.kind === 'sphere'
        ? RAPIER.ColliderDesc.ball(shape.radius)
        : RAPIER.ColliderDesc.cylinder(shape.halfHeight, shape.radius);
  return desc
    .setDensity(archetype.density)
    .setRestitution(archetype.restitution)
    .setFriction(archetype.friction);
};

const yawQuat = (yaw: number): RAPIER.Rotation => ({
  x: 0,
  y: Math.sin(yaw / 2),
  z: 0,
  w: Math.cos(yaw / 2),
});

/** Move a velocity component toward a target by at most maxDelta. */
const approach = (current: number, target: number, maxDelta: number): number =>
  current + Math.max(-maxDelta, Math.min(maxDelta, target - current));

const toVec3 = (v: RAPIER.Vector): Vec3 => ({ x: v.x, y: v.y, z: v.z });

export const createSimulation = (plan: WorldPlan): Simulation => {
  const world = new RAPIER.World(plan.gravity);
  world.timestep = TICK_SECONDS;

  const archetypesById = new Map(plan.archetypes.map((a) => [a.id, a]));
  const trackedBodies: { readonly bodyId: number; readonly body: RAPIER.RigidBody }[] = [];

  for (const planned of plan.bodies) {
    const archetype = archetypesById.get(planned.archetypeId);
    if (archetype === undefined)
      throw new Error(`plan references unknown archetype '${planned.archetypeId}'`);
    // ponytail: 'destructible' behaves as plain dynamic for now; despawn-on-impact
    // is a later slice and needs a despawn message in the wire protocol first.
    const bodyDesc = (
      planned.bodyClass === 'fixed' ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic()
    )
      .setTranslation(planned.position.x, planned.position.y, planned.position.z)
      .setRotation(yawQuat(planned.yaw));
    const body = world.createRigidBody(bodyDesc);
    world.createCollider(colliderDescFor(archetype), body);
    if (planned.bodyClass !== 'fixed') trackedBodies.push({ bodyId: planned.bodyId, body });
  }

  const players = new Map<number, PlayerState>();
  const locks = enabledTranslations(plan.movementPlane);
  const { player: tuning } = plan.substrate;
  const groundedReach = tuning.capsule.halfHeight + tuning.capsule.radius + GROUND_PROBE;
  let tickCount = 0;

  const isGrounded = (body: RAPIER.RigidBody): boolean => {
    const origin = body.translation();
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: 0, y: -1, z: 0 },
    );
    return world.castRay(ray, groundedReach, true, undefined, undefined, undefined, body) !== null;
  };

  const poses = (includeSleeping: boolean): readonly BodyPose[] => {
    const out: BodyPose[] = [];
    const collect = (bodyId: number, body: RAPIER.RigidBody): void => {
      if (!includeSleeping && body.isSleeping()) return;
      out.push({ bodyId, position: toVec3(body.translation()), rotation: body.rotation() });
    };
    for (const tracked of trackedBodies) collect(tracked.bodyId, tracked.body);
    for (const player of players.values()) collect(player.bodyId, player.body);
    return out;
  };

  return {
    addPlayer: () => {
      const slot = players.size;
      const bodyId = playerBodyId(slot);
      const spawn = plan.spawnPoints[slot % plan.spawnPoints.length];
      if (spawn === undefined) throw new Error('world plan has no spawn points');
      const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y, spawn.z)
        .lockRotations()
        .enabledTranslations(locks.x, locks.y, locks.z)
        .setCcdEnabled(true);
      const body = world.createRigidBody(bodyDesc);
      world.createCollider(
        RAPIER.ColliderDesc.capsule(tuning.capsule.halfHeight, tuning.capsule.radius)
          .setDensity(1)
          .setFriction(PLAYER_FRICTION)
          .setRestitution(0),
        body,
      );
      players.set(slot, { slot, bodyId, body, latest: undefined });
      return { slot, bodyId };
    },

    applyInput: (command) => {
      const player = players.get(command.playerSlot);
      if (player === undefined) return;
      if (player.latest !== undefined && command.seq <= player.latest.seq) return;
      // Never trust the client: clamp the move vector to unit length server-side.
      const magnitude = Math.hypot(command.move.x, command.move.z);
      const scale = magnitude > 1 ? 1 / magnitude : 1;
      player.latest = {
        ...command,
        move: { x: command.move.x * scale, z: command.move.z * scale },
      };
    },

    step: () => {
      for (const player of players.values()) {
        const input = player.latest;
        const grounded = isGrounded(player.body);
        const velocity = player.body.linvel();
        const control = grounded ? 1 : tuning.airControl;
        const maxDelta = tuning.accel * control * TICK_SECONDS;
        const jumping = grounded && input?.jump === true;
        player.body.setLinvel(
          {
            x: approach(velocity.x, (input?.move.x ?? 0) * tuning.maxSpeed, maxDelta),
            y: jumping ? tuning.jumpImpulse : velocity.y,
            z: approach(velocity.z, (input?.move.z ?? 0) * tuning.maxSpeed, maxDelta),
          },
          true,
        );
        // Consume the jump edge so a held button doesn't bunny-hop every grounded tick.
        if (jumping && input !== undefined) player.latest = { ...input, jump: false };
      }
      world.step();
      tickCount += 1;
    },

    tick: () => tickCount,
    awakeSnapshot: () => ({ tick: tickCount, bodies: poses(false) }),
    fullSnapshot: () => ({ tick: tickCount, bodies: poses(true) }),
    free: () => world.free(),
  };
};
