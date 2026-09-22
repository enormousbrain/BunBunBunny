// UNVERIFIED IN BROWSER -- written headless; the simulation module it drives IS
// verified (simulation.test.ts). This file is deliberately thin: receive plan, tick
// on a fixed-step accumulator, broadcast awake-only snapshots as transferables.

/// <reference lib="webworker" />

import type { WorldPlan } from '../../core/recipe/world-plan';
import { decodeInput } from '../../core/net/input';
import { encodeSnapshot } from '../../core/net/snapshot';
import { planSteps } from '../../core/loop/fixed-step';
import { createSimulation, initPhysics, TICK_SECONDS, type Simulation } from './simulation';

type InboundMessage =
  | { readonly type: 'start'; readonly plan: WorldPlan }
  | { readonly type: 'addPlayer' }
  | { readonly type: 'input'; readonly buffer: ArrayBuffer };

let simulation: Simulation | undefined;
let accumulator = 0;
let lastTime = 0;

const tickLoop = (): void => {
  if (simulation === undefined) return;
  const now = performance.now();
  const stepPlan = planSteps(accumulator, (now - lastTime) / 1000, TICK_SECONDS);
  lastTime = now;
  accumulator = stepPlan.accumulator;
  for (let i = 0; i < stepPlan.steps; i += 1) simulation.step();
  if (stepPlan.steps > 0) {
    const buffer = encodeSnapshot(simulation.awakeSnapshot());
    self.postMessage({ type: 'snapshot', buffer }, { transfer: [buffer] });
  }
};

self.onmessage = (event: MessageEvent<InboundMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'start':
      void initPhysics().then(() => {
        simulation = createSimulation(message.plan);
        lastTime = performance.now();
        // Interval faster than the tick so the accumulator, not the timer, sets pace.
        setInterval(tickLoop, (TICK_SECONDS * 1000) / 2);
        self.postMessage({ type: 'started' });
      });
      break;
    case 'addPlayer': {
      if (simulation === undefined) return;
      const added = simulation.addPlayer();
      self.postMessage({ type: 'playerAdded', slot: added.slot, bodyId: added.bodyId });
      // New player needs a full baseline; awake-only would hide sleeping bodies.
      const buffer = encodeSnapshot(simulation.fullSnapshot());
      self.postMessage({ type: 'snapshot', buffer }, { transfer: [buffer] });
      break;
    }
    case 'input':
      simulation?.applyInput(decodeInput(message.buffer));
      break;
  }
};
