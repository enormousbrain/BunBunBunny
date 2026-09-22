// The transport seam (plan doc §0). One interface, two implementations: the local
// Worker channel today, a WebSocket channel to the authoritative room later. Render
// code depends ONLY on this interface -- swapping transports must not touch it.

export interface SimChannel {
  /** Boot the sim with an encoded world plan. Resolves when the first tick runs. */
  readonly start: () => Promise<void>;
  /** Request a player; resolves with the slot and wire bodyId. */
  readonly addPlayer: () => Promise<{ readonly slot: number; readonly bodyId: number }>;
  /** Fire-and-forget encoded InputCommand (see core/net/input). */
  readonly sendInput: (buffer: ArrayBuffer) => void;
  /** Encoded snapshots (see core/net/snapshot), in arrival order -- NOT tick order. */
  readonly onSnapshot: (callback: (buffer: ArrayBuffer) => void) => void;
  readonly close: () => void;
}

/** The fake-LTE knob (plan doc §3): applies to snapshots AND inputs, both directions. */
export interface LinkConditions {
  readonly delayMs: number;
  readonly jitterMs: number;
}

export const PERFECT_LINK: LinkConditions = { delayMs: 0, jitterMs: 0 };
export const LTE_LIKE_LINK: LinkConditions = { delayMs: 60, jitterMs: 40 };
