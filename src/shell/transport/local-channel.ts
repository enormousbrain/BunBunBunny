// UNVERIFIED IN BROWSER -- written headless; exercise via the playground page and fix
// what reality disagrees with (Vite worker URL syntax is the likely friction point).
//
// Local SimChannel: wraps the sim Worker, injecting artificial latency/jitter so the
// interpolation path is exercised under LTE-like conditions from day one.

import type { WorldPlan } from '../../core/recipe/world-plan';
import type { LinkConditions, SimChannel } from './channel';
import { PERFECT_LINK } from './channel';

type WorkerMessage =
  | { readonly type: 'started' }
  | { readonly type: 'playerAdded'; readonly slot: number; readonly bodyId: number }
  | { readonly type: 'snapshot'; readonly buffer: ArrayBuffer };

const jittered = (link: LinkConditions): number =>
  Math.max(0, link.delayMs + (Math.random() * 2 - 1) * link.jitterMs);

export const createLocalChannel = (
  plan: WorldPlan,
  link: LinkConditions = PERFECT_LINK,
): SimChannel => {
  // Vite bundles module workers via this exact URL pattern; do not "simplify" it.
  const worker = new Worker(new URL('../sim/sim.worker.ts', import.meta.url), {
    type: 'module',
  });
  let snapshotCallback: ((buffer: ArrayBuffer) => void) | undefined;
  let startedResolve: (() => void) | undefined;
  const playerResolvers: ((added: { slot: number; bodyId: number }) => void)[] = [];

  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    switch (message.type) {
      case 'started':
        startedResolve?.();
        break;
      case 'playerAdded':
        playerResolvers.shift()?.({ slot: message.slot, bodyId: message.bodyId });
        break;
      case 'snapshot': {
        const deliver = (): void => snapshotCallback?.(message.buffer);
        const delay = jittered(link);
        if (delay === 0) deliver();
        else setTimeout(deliver, delay);
        break;
      }
    }
  };

  return {
    start: () => {
      const started = new Promise<void>((resolve) => {
        startedResolve = resolve;
      });
      worker.postMessage({ type: 'start', plan });
      return started;
    },
    addPlayer: () =>
      new Promise((resolve) => {
        playerResolvers.push(resolve);
        worker.postMessage({ type: 'addPlayer' });
      }),
    sendInput: (buffer) => {
      const send = (): void => worker.postMessage({ type: 'input', buffer }, [buffer]);
      const delay = jittered(link);
      if (delay === 0) send();
      else setTimeout(send, delay);
    },
    onSnapshot: (callback) => {
      snapshotCallback = callback;
    },
    close: () => worker.terminate(),
  };
};
