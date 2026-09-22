// Snapshot interpolation (spec §8: snapshot-authoritative + interpolation, no rollback).
// Pure reducer over a small sorted buffer. Awake-only semantics: a body absent from the
// newer snapshot is asleep/settled -- HOLD its older pose; a body absent from the older
// snapshot just woke -- SNAP to its newer pose. No extrapolation by design.

import type { Vec3 } from '../recipe/schema';
import { slerpQuat } from './quat';
import type { BodyPose, Snapshot } from './snapshot';

export interface InterpolationState {
  readonly snapshots: readonly Snapshot[];
}

export const EMPTY_INTERPOLATION: InterpolationState = { snapshots: [] };

// ponytail: re-sort on every push is O(n log n) on a <=32 buffer -- irrelevant. Switch
// to sorted insert if the buffer ever grows.
export const pushSnapshot = (
  state: InterpolationState,
  snapshot: Snapshot,
  maxBuffered = 32,
): InterpolationState => {
  const kept = state.snapshots.filter((s) => s.tick !== snapshot.tick);
  const merged = [...kept, snapshot].sort((a, b) => a.tick - b.tick);
  return { snapshots: merged.slice(-maxBuffered) };
};

export const latestTick = (state: InterpolationState): number | undefined =>
  state.snapshots.at(-1)?.tick;

const lerpVec3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

/** Interpolated poses at a (fractional) render tick. */
export const sample = (
  state: InterpolationState,
  renderTick: number,
): readonly BodyPose[] => {
  const snapshots = state.snapshots;
  if (snapshots.length === 0) return [];
  const older = [...snapshots].reverse().find((s) => s.tick <= renderTick);
  const newer = snapshots.find((s) => s.tick > renderTick);
  if (older === undefined) return newer?.bodies ?? [];
  if (newer === undefined) return older.bodies;
  const t = (renderTick - older.tick) / (newer.tick - older.tick);
  const newerById = new Map(newer.bodies.map((b) => [b.bodyId, b]));
  const blended: BodyPose[] = [];
  for (const previous of older.bodies) {
    const next = newerById.get(previous.bodyId);
    if (next === undefined) {
      blended.push(previous); // asleep or settled: hold last pose
      continue;
    }
    newerById.delete(previous.bodyId);
    blended.push({
      bodyId: previous.bodyId,
      position: lerpVec3(previous.position, next.position, t),
      rotation: slerpQuat(previous.rotation, next.rotation, t),
    });
  }
  for (const woken of newerById.values()) blended.push(woken); // just woke: snap
  return blended;
};

/** Convenience: sample at a fixed interpolation delay behind the newest snapshot. */
export const sampleAtDelay = (
  state: InterpolationState,
  delayTicks: number,
): readonly BodyPose[] => {
  const latest = latestTick(state);
  return latest === undefined ? [] : sample(state, latest - delayTicks);
};
