// Slice A — playground entry + boot chain (implementation guide §5).
//
// Proves the serialization pipe in the browser: recipe -> plan -> local
// Worker channel -> decoded snapshots. There is no render yet (slice B); the
// overlay surfaces the live tick + awake-body count so the pipe is visible
// without a console. Acceptance: ticks advance ~30/s and the awake count
// starts near the full dynamic-body count, then falls as the pile sleeps
// across the worker boundary.

import { PERFECT_LINK } from './shell/transport/channel';
import { createLocalChannel } from './shell/transport/local-channel';
import { decodeSnapshot } from './core/net/snapshot';
import { THE_PLAYGROUND } from './core/recipe/the-playground';
import { validate } from './core/recipe/validate';
import { recipeToWorldPlan } from './core/recipe/world-plan';

const statusEl = document.querySelector<HTMLElement>('.playground__status');
const statsEl = document.querySelector<HTMLElement>('.playground__stats');

if (!statusEl || !statsEl) {
  throw new Error('playground page is missing its overlay elements');
}

const recipe = validate(THE_PLAYGROUND);
if (!recipe.ok) {
  throw new Error(`The Playground recipe is invalid: ${JSON.stringify(recipe.issues)}`);
}
const plan = recipeToWorldPlan(recipe.recipe);

const channel = createLocalChannel(plan, PERFECT_LINK);

// Throttled readout so "~30/s" is visible without flooding the console. The
// rate is a rolling tick-delta over the last second; a dropped frame lowers it.
let lastStatsAt = performance.now();
let lastLogAt = 0;
let lastTick = -1;
let tickRate = 0;

const reportSnapshot = (tick: number, awakeCount: number): void => {
  const now = performance.now();
  const windowMs = now - lastStatsAt;
  if (windowMs >= 1000) {
    if (lastTick >= 0) tickRate = ((tick - lastTick) * 1000) / windowMs;
    lastStatsAt = now;
    statsEl.textContent = `tick ${tick} · ${awakeCount} awake · ~${tickRate.toFixed(1)}/s`;
  }
  lastTick = tick;
  if (now - lastLogAt >= 1000) {
    lastLogAt = now;
    console.log(`[playground] tick=${tick} awake=${awakeCount} rate≈${tickRate.toFixed(1)}/s`);
  }
};

channel.onSnapshot((buffer) => {
  const snapshot = decodeSnapshot(buffer);
  reportSnapshot(snapshot.tick, snapshot.bodies.length);
});

statusEl.textContent = `Booting sim (${plan.bodies.length} planned bodies)...`;

void channel
  .start()
  .then(() => channel.addPlayer())
  .then(({ slot, bodyId }) => {
    statusEl.textContent = `Sim running (player slot ${slot}, body ${bodyId})`;
  })
  .catch((error: unknown) => {
    statusEl.textContent = `Boot failed: ${error instanceof Error ? error.message : String(error)}`;
  });

window.addEventListener('pagehide', () => channel.close());
