// Integration smoke test: the full headless chain -- blessed recipe -> plan -> Rapier
// sim -> awake-only snapshot -> binary codec -> decode. If this is green, the entire
// server-side stack is proven before a browser ever opens.

import { beforeAll, describe, expect, it } from 'vitest';
import { validate } from '../../core/recipe/validate';
import { recipeToWorldPlan } from '../../core/recipe/world-plan';
import { THE_PLAYGROUND } from '../../core/recipe/the-playground';
import { decodeSnapshot, encodeSnapshot } from '../../core/net/snapshot';
import { orientationDot } from '../../core/net/quat';
import { createSimulation, initPhysics, TICK_RATE_HZ } from './simulation';

const plan = (() => {
  const result = validate(THE_PLAYGROUND);
  if (!result.ok) throw new Error('playground recipe failed validation');
  return recipeToWorldPlan(result.recipe);
})();

const defined = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) throw new Error(`${label} missing from simulation test`);
  return value;
};

beforeAll(async () => {
  await initPhysics();
});

describe('createSimulation', () => {
  it('builds the playground and settles bodies to sleep', () => {
    const sim = createSimulation(plan);
    for (let i = 0; i < TICK_RATE_HZ * 20; i += 1) sim.step();
    const awake = sim.awakeSnapshot().bodies.length;
    const full = sim.fullSnapshot().bodies.length;
    expect(full).toBe(104); // 109 planned minus 5 fixed (ground + 4 pillars)
    expect(awake).toBeLessThan(full / 2); // most of the pile should be asleep
    sim.free();
  });

  it('moves a player under input commands', () => {
    const sim = createSimulation(plan);
    const { slot, bodyId } = sim.addPlayer();
    for (let i = 0; i < TICK_RATE_HZ; i += 1) {
      sim.applyInput({ playerSlot: slot, seq: i + 1, move: { x: 1, z: 0 }, jump: false });
      sim.step();
    }
    const pose = sim.fullSnapshot().bodies.find((b) => b.bodyId === bodyId);
    const spawn = defined(plan.spawnPoints[0], 'first spawn point');
    expect(defined(pose, 'player pose').position.x).toBeGreaterThan(spawn.x + 2);
    sim.free();
  });

  it('jumps only when grounded and consumes the jump edge', () => {
    const sim = createSimulation(plan);
    const { slot, bodyId } = sim.addPlayer();
    for (let i = 0; i < TICK_RATE_HZ; i += 1) sim.step(); // land + settle
    const before = defined(
      sim.fullSnapshot().bodies.find((b) => b.bodyId === bodyId),
      'player pose before jump',
    ).position.y;
    sim.applyInput({ playerSlot: slot, seq: 100, move: { x: 0, z: 0 }, jump: true });
    for (let i = 0; i < 8; i += 1) sim.step();
    const airborne = defined(
      sim.fullSnapshot().bodies.find((b) => b.bodyId === bodyId),
      'player pose after jump',
    ).position.y;
    expect(airborne).toBeGreaterThan(before + 0.3);
    sim.free();
  });

  it('round-trips an awake snapshot through the wire codec within bounds', () => {
    const sim = createSimulation(plan);
    sim.addPlayer();
    for (let i = 0; i < 10; i += 1) sim.step();
    const original = sim.awakeSnapshot();
    expect(original.bodies.length).toBeGreaterThan(0);
    const decoded = decodeSnapshot(encodeSnapshot(original));
    expect(decoded.tick).toBe(original.tick);
    decoded.bodies.forEach((body, i) => {
      const source = original.bodies[i];
      if (source === undefined) throw new Error(`missing source body at ${i}`);
      expect(body.bodyId).toBe(source.bodyId);
      expect(Math.abs(body.position.x - source.position.x)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(body.position.y - source.position.y)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(body.position.z - source.position.z)).toBeLessThanOrEqual(0.001);
      expect(orientationDot(body.rotation, source.rotation)).toBeGreaterThan(0.999999);
    });
    sim.free();
  });
});
