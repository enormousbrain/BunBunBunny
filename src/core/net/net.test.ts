import { describe, expect, it } from 'vitest';
import { orientationDot, normalizeQuat, type Quat } from './quat';
import {
  decodeSnapshot,
  encodeSnapshot,
  MAX_BODY_ID,
  playerBodyId,
  type Snapshot,
} from './snapshot';
import { EMPTY_INTERPOLATION, pushSnapshot, sample, sampleAtDelay } from './interpolate';
import { decodeInput, encodeInput } from './input';
import { planSteps } from '../loop/fixed-step';

const quat = (x: number, y: number, z: number, w: number): Quat =>
  normalizeQuat({ x, y, z, w });

const testSnapshot = (tick: number): Snapshot => ({
  tick,
  bodies: [
    { bodyId: 0, position: { x: 1.234, y: -0.5, z: 12.001 }, rotation: quat(0.2, -0.4, 0.1, 0.88) },
    { bodyId: 107, position: { x: -14.999, y: 0.35, z: 3.2 }, rotation: quat(0, 0, 0, 1) },
    { bodyId: playerBodyId(0), position: { x: 0, y: 1, z: -6 }, rotation: quat(0, 0.7, 0, 0.7) },
  ],
});

describe('snapshot codec', () => {
  it('round-trips within quantization bounds', () => {
    const original = testSnapshot(4242);
    const decoded = decodeSnapshot(encodeSnapshot(original));
    expect(decoded.tick).toBe(4242);
    expect(decoded.bodies).toHaveLength(original.bodies.length);
    original.bodies.forEach((body, i) => {
      const round = decoded.bodies[i];
      if (round === undefined) throw new Error(`missing decoded body at ${i}`);
      expect(round.bodyId).toBe(body.bodyId);
      expect(Math.abs(round.position.x - body.position.x)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(round.position.y - body.position.y)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(round.position.z - body.position.z)).toBeLessThanOrEqual(0.001);
      expect(orientationDot(round.rotation, body.rotation)).toBeGreaterThan(0.999999);
    });
  });

  it('rejects out-of-range bodyIds', () => {
    const bad: Snapshot = {
      tick: 1,
      bodies: [
        {
          bodyId: MAX_BODY_ID + 1,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      ],
    };
    expect(() => encodeSnapshot(bad)).toThrow();
  });
});

describe('interpolation', () => {
  const older: Snapshot = {
    tick: 10,
    bodies: [
      { bodyId: 1, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      { bodyId: 2, position: { x: 5, y: 5, z: 5 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    ],
  };
  const newer: Snapshot = {
    tick: 20,
    bodies: [
      { bodyId: 1, position: { x: 10, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      { bodyId: 3, position: { x: -1, y: 2, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    ],
  };
  const state = pushSnapshot(pushSnapshot(EMPTY_INTERPOLATION, newer), older);

  it('lerps bodies present in both snapshots', () => {
    const midpoint = sample(state, 15);
    const moving = midpoint.find((b) => b.bodyId === 1);
    expect(moving?.position.x).toBeCloseTo(5);
  });

  it('holds bodies missing from the newer snapshot (asleep)', () => {
    const midpoint = sample(state, 15);
    const sleeping = midpoint.find((b) => b.bodyId === 2);
    expect(sleeping?.position.x).toBe(5);
  });

  it('snaps bodies missing from the older snapshot (just woke)', () => {
    const midpoint = sample(state, 15);
    const woken = midpoint.find((b) => b.bodyId === 3);
    expect(woken?.position.x).toBe(-1);
  });

  it('samples at a delay behind the latest snapshot', () => {
    const delayed = sampleAtDelay(state, 5);
    expect(delayed.find((b) => b.bodyId === 1)?.position.x).toBeCloseTo(5);
  });
});

describe('input codec', () => {
  it('round-trips a command', () => {
    const decoded = decodeInput(
      encodeInput({ playerSlot: 3, seq: 90210, move: { x: -1, z: 0.5 }, jump: true }),
    );
    expect(decoded.playerSlot).toBe(3);
    expect(decoded.seq).toBe(90210);
    expect(decoded.move.x).toBeCloseTo(-1, 1);
    expect(decoded.move.z).toBeCloseTo(0.5, 1);
    expect(decoded.jump).toBe(true);
  });
});

describe('planSteps', () => {
  it('accumulates fractional frames', () => {
    const dt = 1 / 30;
    const first = planSteps(0, 0.02, dt);
    expect(first.steps).toBe(0);
    const second = planSteps(first.accumulator, 0.02, dt);
    expect(second.steps).toBe(1);
    expect(second.accumulator).toBeCloseTo(0.04 - dt);
  });

  it('caps catch-up steps and drops backlog', () => {
    const dt = 1 / 30;
    const stalled = planSteps(0, 2, dt, 5);
    expect(stalled.steps).toBe(5);
    expect(stalled.accumulator).toBeLessThanOrEqual(dt);
  });
});
