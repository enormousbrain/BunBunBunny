# Playground Foundation — the physics substrate build plan

Companion to the architecture spec (v0.5) and `foundation.md`. The walking skeleton (feed +
companion + push-in handoff) is running; this doc plans the next slice: **the 3D physics
playground that becomes the substrate every game is a recipe over** (spec §7: "the physics
party-sandbox is the substrate/core"). Written so the playground *is* the foundation, not a
demo that gets rewritten.

---

## 0. The one organizing decision

**The playground is two programs separated by the snapshot boundary from day one.**

Not "three.js + Rapier in one loop." That's the corner. Instead:

- **Sim** (`shell/sim/`) — owns Rapier. Consumes a recipe + input commands; emits binary
  snapshots at a fixed tick rate. Imports no three.js, no DOM. **Runs in a Web Worker.**
- **View** (`shell/render/`) — consumes snapshots, interpolates, renders. Never touches a
  Rapier body. Not once, not for debugging convenience.
- **Between them** (`core/net/`) — the codec + interpolation math, pure and tested. The
  graybox already validated the 12 B/body wire format; this is where it becomes real code.

Why a Worker and not just "a well-separated module": the worker's `postMessage` boundary is
**structurally identical to the network boundary**. It forces serialization honesty — nothing
can sneak an object reference across. When the authoritative server lands (§8.7), the change
is: swap the local channel for a WebSocket, run the same sim module in Node
(`rapier3d-compat` runs in both). The client render path doesn't change *at all*. The
playground and the netcode de-risk each other for free.

`shell/transport/` defines the channel interface now (`send(input)`, `onSnapshot(cb)`), with
the worker-postMessage implementation first and WS later. Same interface, two impls.

## 1. World from recipe, never imperative

No scene-building code. `core/recipe/` gets:

- The recipe schema (spec §4.1) + validation (L6 — invalid recipe unrepresentable).
- A pure `recipeToWorldPlan(recipe)` → a **deterministic, ordered body list** with stable
  body IDs. Same recipe → same plan → same IDs, every time, everywhere.

Both sides consume the same plan: sim instantiates physics bodies from it; render
instantiates visuals from it. Client and server agree on body identity **by construction** —
no registration handshake, no drift. The playground itself is just one hardcoded blessed
recipe (`the-playground.recipe`), which means the recipe pipeline exists from the first
commit and the AI-generation path (§4.3) has a real target shape.

**Ingredients are data-driven archetypes**, not classes: `{ shape, halfExtents, density,
restitution, bodyClass: fixed | dynamic | destructible, materialTag }`. Render side maps
archetype → `InstancedMesh` (the pattern the graybox proved to 800 bodies).

## 2. Wire format: ID-tagged, awake-only — decide now

The graybox streamed a dense array (12 B × all bodies). That format **blocks** awake-island
culling and delta encoding — the one real wall (§8.7, ledger #15). So the production shape
starts here:

- Snapshot = header (tick, count) + per-body records of **`bodyId (u16)` + 12 B pose**.
- Only **awake** bodies are included (Rapier island sleeping gives the awake set for free).
- Render keeps last-known pose for bodies absent from the snapshot (they're asleep — they
  haven't moved).

That's 14 B/body instead of 12, and it *is* awake-island culling in embryo. The settled tier
(§8.1) and delta encoding layer onto this format without a migration. `core/net/` ships
encode/decode + tests immediately.

## 3. Fixed timestep, interpolated render, fake latency from day one

- Sim ticks on a **fixed timestep with an accumulator** (proposed: 30 Hz to start — open
  ledger #1, and the graybox's 50 ms budget suggests 20–30 Hz is comfortable). Never tied to
  `requestAnimationFrame` — rAF doesn't exist headless.
- Render interpolates between the two most recent snapshots (`core/net/` interp math, pure,
  tested — it's just lerp + slerp with a delay buffer).
- The playground ships a **latency/jitter knob** that artificially delays and jitters the
  local channel. Costs an hour; means the interpolation path is exercised under LTE-like
  conditions from the first week instead of discovered snapping in the field (the graybox's
  known jitter-buffer issue, ledger #16, becomes locally reproducible).

## 4. Character: dynamic capsule, force-driven — not kinematic

Shoving is the core verb (§10: "shoving is the core verb"). Rapier's built-in
`KinematicCharacterController` cannot be shoved — kinematic bodies ignore forces. So:

- **Dynamic capsule**, rotation locked upright, moved by velocity/impulse, grounded via a
  short ray/shape-cast for jump eligibility. This is the Fall Guys / Gang Beasts tier the
  spec already targets (§8), and it means player-vs-player and player-vs-prop physics work
  with zero special cases.
- Controller tuning (accel, max speed, jump impulse, friction) lives in a substrate tuning
  object — one place, recipe-overridable later if wanted.
- The character's **visual** binds to the capsule via the skeleton root (the §3.5 gotcha:
  skinned meshes move via skeleton, not a wrapping group). `run` plays with root motion
  stripped (ledger #20); position comes from the sim.
- **Inputs are commands**: `{ playerId, seq, moveVector, buttons }` sent over the transport
  channel — even for the local single player. The seam where prediction will live exists
  from day one; prediction itself is deferred (spec: snapshot + interp, no rollback).

## 5. Cameras: modes as data, constraint in the sim

L1 — 2D and isometric are *lenses* on true 3D. Concretely:

- `core/camera/` (or `core/modes/`): each named mode is a data package —
  `{ projection, angle, movementPlane, controlScheme }` (§7).
- The **movement-plane constraint is enforced in the sim** (lock the off-plane translation
  axis on the player body), never faked in the camera or controls. Otherwise side-2D drifts
  off-plane and the lie shows.
- Playground ships three toggleable modes: **debug-orbit** (dev only), **Side-2D**, and
  **Isometric** (the launch pair). Toggling live, same world, is the visible proof of L1 —
  and a great screen recording.

## 6. Where it lives

A **second Vite entry** (`playground.html`) in the same repo. The feed skeleton stays clean;
the playground shares `core/` and `shell/` modules. Convergence path is already visible: the
playground scene is what eventually renders into the focused-card context on commit (§9.2) —
same renderer, same sim client. No throwaway.

```
src/
  core/
    recipe/      schema, validate, recipeToWorldPlan     (pure, tested)
    net/         snapshot codec (ID-tagged), interp math (pure, tested)
    camera/      mode packages                           (pure, tested)
  shell/
    sim/         worker entry: Rapier world, tick loop, capsule controller
    transport/   channel interface; local (postMessage) impl now, WS later
    render/      playground scene: instanced archetypes, character binding,
                 camera-mode applier
playground.html  second entry point
```

Dependency added: `@dimforge/rapier3d-compat` (justification: physics engine; already
validated in the graybox; compat build runs in workers, browsers, and Node — which is the
whole play).

## 7. Build order — small green slices

1. **Codec + interp** (`core/net/`) — encode/decode with body IDs, awake-only; lerp/slerp
   interp. Pure, tested. *(The wire format decision, made in code.)*
2. **Recipe → world plan** (`core/recipe/`) — schema, validation, deterministic plan; the
   hardcoded playground recipe. Pure, tested.
3. **Sim worker walking skeleton** — ground + a pile of dynamic boxes, fixed-tick loop,
   snapshots over postMessage. Headless-true from the first commit.
4. **Render side** — instanced archetypes from the plan, snapshot interpolation, latency
   knob. *(At this point: boxes falling, rendered across a real serialization boundary.)*
5. **Character** — dynamic capsule + input commands + tap-discrete controls; Bunny Boy
   bound via skeleton root, `run`/`idle`/`jump` driven by sim state.
6. **Camera modes** — orbit / Side-2D / Isometric toggle, movement-plane lock in sim.
7. **Awake-only under load** — let the box pile sleep, verify sparse snapshots + last-known
   rendering. *(Ledger #15's first real bite.)*

Each slice is done-means-green (typecheck, lint, vitest) and each is independently
demonstrable.

## 8. The corners, named (what this plan is defending against)

- **Render reaching into Rapier** → blocks the server split. The snapshot boundary is law.
- **Dense-array wire format** → blocks culling and delta encoding (the one real wall).
- **Kinematic character controller** → blocks shoving, the core verb.
- **Imperative world-building** → blocks recipes, and therefore AI generation and L6.
- **Sim coupled to rAF / DOM** → blocks headless server reuse.
- **Camera baked into world or assets** → violates L1; kills the multi-lens substrate.

## 9. Open (flagged, not guessed)

- **Tick rate** — 20 / 30 / 60 Hz (ledger #1). Proposal: start 30, it's a constant.
- **Player-vs-player friction & mass tuning** — the Gang Beasts feel dial; pure playtest
  territory once the capsule exists.
- **Prediction timing** — the input-command seam exists from slice 5; when local-player
  latency starts to feel bad over the fake-latency knob is when prediction earns its slot.
- **Jump/land animation states** — minimal state machine (idle/run/air) in slice 5, or
  defer air pose to a later pass.
