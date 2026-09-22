# Playground Implementation Guide — handoff document

**Audience:** the implementing agent (Claude Code on Opus 4.8 or similar) and Jesse.
**Status:** the high-complexity core and the first browser assembly are BUILT AND VERIFIED
(see §1). The feed shell now starts the local sim and renders the playground into the focused
card, then full-screen during play. The companion visual now binds to the simulated player
body, uses idle/run locomotion based on movement, faces its travel direction, and basic
keyboard/on-screen controls send input commands. The remaining work is camera toggles,
latency UI, and deeper locomotion polish. The architecture is decided — implement it, don't redesign
it. When something here conflicts with reality, surface it (charter rule); don't quietly
improvise.

Read first, every session: `AGENTS.md` (charter), `spec/playground-foundation.md` (the
plan this executes), then this file.

---

## 1. What is already built, and its verification status

### Verified green (typecheck strict + 63 vitest tests passing, including a full headless
### integration chain: recipe → plan → Rapier sim → snapshots → codec round-trip)

| File | What it is |
|---|---|
| `src/core/recipe/schema.ts` | §4.1 recipe types; branded `ValidRecipe` |
| `src/core/recipe/validate.ts` | validation + backfill (L6); body caps |
| `src/core/recipe/recipe-id.ts` | canonical-JSON FNV content hash |
| `src/core/recipe/world-plan.ts` | pure `recipeToWorldPlan`; deterministic bodyIds. **Carries archetypes, substrate, movementPlane** — sim and render need only the plan |
| `src/core/recipe/the-playground.ts` | the blessed recipe: 109 bodies (104 non-fixed) |
| `src/core/net/quat.ts` | pure quaternion math (normalize, slerp) — no three.js in core |
| `src/core/net/snapshot.ts` | the binary wire codec (see §3) |
| `src/core/net/interpolate.ts` | snapshot buffer + interpolation with hold/snap semantics |
| `src/core/net/input.ts` | 8-byte input command codec |
| `src/core/loop/fixed-step.ts` | fixed-timestep accumulator with spiral-of-death guard |
| `src/core/camera/modes.ts` | camera mode packages + movement-plane translation locks |
| `src/shell/sim/simulation.ts` | **the headless Rapier sim** — world from plan, dynamic-capsule character controller, awake-only snapshots. Verified against rapier 0.19.3 |
| `src/shell/render/playground-scene.ts` | browser render edge: instanced meshes from the plan, snapshot interpolation, active companion visual bound to the player body with generic idle/run clip selection |
| `src/main.ts` focused-card integration | starts `createLocalChannel`, feeds snapshots into the playground scene, renders it into the focused native card and full-screen play view, sends keyboard/on-screen input |
| `src/core/recipe/recipe.test.ts`, `src/core/net/net.test.ts`, `src/shell/sim/simulation.test.ts` | the tests proving all of the above |

### Browser-verified through focused-card integration

| File | Risk points |
|---|---|
| `src/shell/sim/sim.worker.ts` | worker module loading and `performance.now` pacing verified in Vite |
| `src/shell/transport/channel.ts` | none (pure interface + constants) |
| `src/shell/transport/local-channel.ts` | Vite worker URL pattern and snapshot message plumbing verified |

### Not built — your job (slices A–E below)

Standalone playground page, latency selector, camera-mode toggle, and deeper locomotion polish.
The feed-card render path, basic controls, and sim-driven companion visual binding with idle/run
animation exist.

**Dependency added:** `@dimforge/rapier3d-compat` (justification per charter: physics engine,
validated in graybox and in `simulation.test.ts`; compat build runs in workers, browsers, and
Node).

---

## 2. Non-negotiable invariants (the corners, restated as rules for you)

1. **Render code never imports Rapier or `shell/sim`.** It talks only to `SimChannel`
   (`shell/transport/channel.ts`) and decodes snapshots via `core/net`. If you find
   yourself importing the simulation into render code, stop — that is the corner.
2. **Do not change the wire format** (`core/net/snapshot.ts`, `input.ts`). It is
   load-bearing for the future server. If it seems insufficient, surface it.
3. **The sim never touches `requestAnimationFrame`, the DOM, or three.js.** It must run
   headless in Node unchanged — that's the whole play.
4. **World construction only from the plan.** No imperative scene-building. Want a
   different playground? Edit `the-playground.ts` data.
5. **The movement-plane constraint lives in the sim** (`enabledTranslations`), never
   faked in camera or controls (L1).
6. **Done means green and you ran it:** `npm run typecheck && npm run lint && npm run test`.

---

## 3. Wire format reference (already implemented; for your understanding)

Snapshot, little-endian:
- Header (8 B): `u8 version=1 | u8 flags=0 | u16 bodyCount | u32 tick`
- Per body (14 B): `u16 (quatIndex<<14 | bodyId)` + `i16×3 position` (millimetres,
  `POSITION_SCALE=1000`, world clamp ±32.767 m) + `i16×3 smallest-three quaternion`
- bodyId is 14-bit: planned bodies count **up from 0** (expansion order of the plan);
  player capsules count **down from 16383** (`playerBodyId(slot)`). Ranges cannot collide.
- Per-tick broadcasts are **awake-only**; a body absent from a snapshot has not moved.
  `core/net/interpolate.ts#sample` already implements hold (asleep) / snap (woke).

Input (8 B): `u8 playerSlot | u32 seq | i8 moveX | i8 moveZ | u8 buttons(bit0=jump)`.
The sim clamps move magnitude server-side and consumes the jump edge — don't re-add
client-side trust assumptions.

## 4. Verified Rapier facts (checked live against 0.19.3 — do not "correct" these)

- `import RAPIER from '@dimforge/rapier3d-compat'`; `await RAPIER.init()` before any use
  (a deprecation warning about init parameters is benign).
- `ColliderDesc.capsule(halfHeight, radius)` and `.cylinder(halfHeight, radius)` —
  **halfHeight comes first**. `cuboid(hx, hy, hz)` takes half-extents.
- `world.timestep` is a settable property; the sim sets it to `TICK_SECONDS` (1/30).
- Plane locking: `RigidBodyDesc.enabledTranslations(x, y, z)` at creation,
  `body.setEnabledTranslations(x, y, z, wake)` after.
- Ray grounding: `new RAPIER.Ray(origin, dir)`;
  `world.castRay(ray, maxToi, solid, undefined, undefined, undefined, excludeBody)`
  returns a hit with `.timeOfImpact`, or `null`.
- `body.translation()` / `body.rotation()` return `{x,y,z}` / `{x,y,z,w}` objects;
  `body.isSleeping()` drives awake-only snapshots.

---

## 5. Remaining slices (do them in order; each ends green and demonstrable)

### Slice A — playground entry + boot chain

1. Create `playground.html` at repo root (second Vite entry beside `index.html`) with a
   full-viewport canvas container and a small overlay UI root. Add it to Vite's
   `build.rollupOptions.input` (create `vite.config.ts` if absent — there isn't one yet;
   Vite defaults have sufficed so far, so add the multi-entry config minimally).
2. Create `src/playground.ts`: validate `THE_PLAYGROUND` → `recipeToWorldPlan` →
   `createLocalChannel(plan, PERFECT_LINK)` → `await channel.start()` →
   `await channel.addPlayer()`.
3. Prove the pipe: log decoded snapshot tick + body count from `channel.onSnapshot`.
   **Acceptance:** console shows ticks advancing at ~30/s and ~104 bodies initially,
   dropping as the pile settles (sleep working across the worker boundary).
   This is where `sim.worker.ts` / `local-channel.ts` get their browser verification —
   fix what breaks, keep the interfaces.

### Slice B — instanced rendering from the plan

1. `src/shell/render/playground-scene.ts`. Build visuals **from the plan**: for each
   archetype, one `THREE.InstancedMesh` (Box/Sphere/CylinderGeometry from the archetype
   shape; simple `MeshStandardMaterial` per `materialTag` — flat colors fine, this is
   graybox). Instance count = number of planned bodies of that archetype.
2. Build the index once: `bodyId → { mesh, instanceIndex }`, assigned in plan order.
   Fixed bodies: set their matrices once from the plan and never touch again.
3. Per frame: maintain `InterpolationState` (`pushSnapshot` on arrival), then
   `sampleAtDelay(state, 2)` (2 ticks ≈ 66 ms), write poses via `setMatrixAt` +
   `instanceMatrix.needsUpdate = true`. Convert `core/net` quats to
   `THREE.Quaternion` at this edge only.
   **Acceptance:** the crate pile, balls, wall, and pillars visible; boxes settle and
   stop updating; player capsule (a placeholder capsule mesh, not instanced) visible.

### Slice C — controls + the latency knob

1. Tap-discrete controls per the §9.1 constraint (vertical drag stays reserved):
   on-screen left/right (and forward/back when not side-plane) buttons + jump button;
   keyboard WASD/space as the desktop dev equivalent. Each change sends an encoded
   `InputCommand` with an incrementing `seq` through `channel.sendInput` —
   **continuously while held** (e.g. every frame or on an interval), because the sim
   uses latest-input, not key-event edges (except jump, which is edge-consumed sim-side).
2. Overlay UI: link-condition selector (`PERFECT_LINK` / `LTE_LIKE_LINK`) — recreate the
   channel or make conditions mutable, your call, but keep `SimChannel` unchanged.
   **Acceptance:** run into the crate pile and it topples; balls kick; jump works; with
   LTE-like conditions motion stays smooth (interpolation absorbing jitter), just delayed.

### Slice D — camera modes

1. `src/shell/render/camera-rig.ts`: consume `CAMERA_MODES` packages. Orthographic
   camera positioned by azimuth/elevation at fixed distance, following the player's
   interpolated position; `orthoHalfHeight` sets zoom. Plus a dev-only perspective
   orbit mode (pointer-drag), clearly labeled dev.
2. Mode toggle in the overlay: orbit / side-2d / isometric. Movement plane is already
   enforced sim-side from the recipe; do NOT re-lock it in controls.
   **Acceptance:** toggling lenses live over the same running world — the L1 demo.
   (Note: the recipe says `free`; side-2d as a *lens* is expected to allow z-drift
   here. That's correct behavior — the side-2d *recipe* would set `movementPlane:
   'side'`. Consider adding a second blessed recipe to show it.)

### Slice E — companion visual polish (optional flourish, after A–D)

The feed-card path already replaces the placeholder player mesh with the active companion
visual from `src/main.ts`, chooses idle/run clips by alias, and turns the model toward
pose-derived travel direction. Remaining polish: expose this path in the standalone page,
add companion-specific forward-axis metadata for each new model, tune blend thresholds, and
add an airborne state once snapshots carry enough motion/grounding signal. Known gotcha
from spec §3.5: drive position via the **skeleton/armature root, not a wrapping group**;
strip root motion from locomotion clips (ledger #20) — position comes from the sim.

---

## 6. What NOT to do (anticipated failure modes for the implementing model)

- Don't add React, a state library, or any runtime dependency beyond
  `@dimforge/rapier3d-compat` and existing `three`. The charter's dependency rule applies.
- Don't "optimize" the codec, change record layouts, or widen bodyId. If a limit binds,
  surface it.
- Don't move the tick loop to the main thread "for simplicity." The worker boundary is
  the architecture (plan doc §0).
- Don't implement client-side prediction, delta encoding, or the WebSocket channel in
  this pass. The seams for all three exist deliberately; filling them is later work
  (spec §8.7) with its own plan.
- Don't rename verbs, clips, or wire fields to taste. Naming is spec-bound.
- If a test must change, explain why in the commit; never delete one to get green.

## 7. Definition of done for the playground

All slices A–D green and demonstrated on a real phone (the graybox precedent): pile
topples under shoving, sleep visibly reduces snapshot sizes (log it), LTE-like link
stays smooth, all three camera modes work. Then update `spec/playground-foundation.md`
status notes in the same change (spec-is-law rule: keep code and spec from drifting).
