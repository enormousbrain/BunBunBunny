# Feed of Games — Foundational Architecture Spec

**Version:** 0.5 (+ validated character production pipeline; companion doc: `foundation.md`)
**Status:** Architecture locked on the load-bearing decisions. §8.6 carries measured numbers; §3 defines the transition grammar, rendering architecture, and now the validated asset pipeline (§3.5); §3A scopes the companion intelligence as v2. Codebase setup lives in the companion `foundation.md`.
**Working name:** _TBD_
**Changes since v0.4:** see §15 changelog.

---

## 0. What this document is

A record of decisions, not a wishlist. "Locked" items are commitments downstream work can lean on. "Open" items are deliberately unspecified so we don't freeze a guess. "Measured" items (§8.6) are empirical results from a throwaway graybox rig, caveats attached. "v2" items are explicitly out of the first build and captured so the thread isn't lost.

---

## 1. Product thesis

A vertical-scroll social feed (TikTok / Instagram shape) where **every post is a playable, drop-in multiplayer game**. You scroll to discover; you stop to play; your friends drop in with you.

### What makes this not Rune / not Roblox

1. **The feed is the product.** Discovery by scrolling, not by browsing a catalogue page or friends list.
2. **Drop-in-first as a design law.** Games are *places you're in*, not *matches you start and finish*. No lobby, no countdown, no tutorial gate in; no game-over that ejects you out.
3. **A persistent traveling character.** A customized character travels the feed with you, reacts to it, and visibly moves between games. The keystone (§3).

### Design priorities (in order)

- Easy and fun to play **with friends** > graphical fidelity.
- A **signature look** is a branding moat *and* what makes AI game-generation tractable. Same decision.
- Constraints are features. Nearly every hard problem here was solved by *narrowing* what a game is allowed to be.

---

## 2. Core invariants (the "laws")

- **L1 — One model, many lenses.** The world is always true 3D physics. "2D" and "isometric" are *cameras* (orthographic projection + movement-plane constraint), never separate art. The character is one 3D model framed differently.
- **L2 — Character adapts to the world.** When the world can't honor your loadout, the character degrades gracefully; the world is never forced to accommodate the character.
- **L3 — Appearance travels; gear is local.** The character's **appearance** (skins, hats, emotes, leap/idle animations) is visible in *every* game — the monetized surface (§11). **Gear** (cars, weapons) is local and **poofs to inventory on exit**. Relics are abstract, account-bound, **kept** (§6).
- **L4 — The platform owns the economy.** Relics are platform-injected, never author-placed.
- **L5 — The recipe is the persistent unit.** A post is a recipe (§4). Liveness is a state layered on top (§5).
- **L6 — A broken post is unrepresentable.** Every recipe field has a valid domain and a backfill.
- **L7 — The character speaks only to data it has.** Any reactive/companion behavior (§3, §3A) is driven by real in-app signals (telemetry, friend graph) — never invented facts and never the player's life outside the app. This is both the right emotional scope and the safety rail; they are the same line.

---

## 3. The traveling character — presence & transitions (keystone)

A persistent, customizable character that travels the feed with the player. v0.4 refines *how* it moves and *how* it's rendered.

### 3.1 The character & its contract (locked)

- **Carries appearance, not capability.** "Recognizably me everywhere," not "my stuff works everywhere." Appearance is the monetized layer (§11) because it's guaranteed visible everywhere.
- **The character contract is load-bearing.** Every game hosts a standard character with a known verb set (walk, jump, mount, interact). The generator builds *worlds that honor the contract*, not arbitrary games.
- **The canonical skeleton is the Mixamo humanoid rig** (validated in §3.5). Every character and every skin is bound to this one skeleton, so a clip authored once (`idle`, `run`, `leap`, …) plays on Bunny Boy, the dragon, and any future purchased skin. This is the concrete mechanism that makes "one rig, many appearances" — and the §11 cosmetic economy — actually work.
- **Why this works where others failed.** Persistent cross-game identity has been tried (e.g. Xbox Avatars) and stalled on *developer adoption* — independent studios with independent engines had no incentive to support someone else's character standard. We don't ask: **we own the engine, games are recipes within it**, so the contract is structural and true by construction, not a voluntary integration anyone can decline. The exact failure mode that killed prior attempts is designed out.

### 3.2 Presence tiers (locked) — the character has three modes, each earning its cost by how often it fires

Scrolling and committing are different gestures and must not share a transition. You flick past many cards per second; you commit to a game rarely. So:

1. **Companion (scrolling — cheap, constant).** The character perches in a corner of the feed and *spectates alongside you*. No server, no loading, no 3D world — it rides the native HTML feed as a character layer. This is continuous customization showcase and the home of reactive behavior (§3A). **Its prominence inversely tracks the card's liveness:** big and expressive on cold cards (where it's the most interesting thing on screen), shrinking/fading on live populated cards (let the party be the star). Idle behaviors are canned animations.
2. **Push-in (commit — the everyday transition).** When you actually pick a game, the character first makes a short scripted 90-degree turn toward the card. Once that turn completes, a straightforward push-into-the-world camera move and the character's `leap` animation play concurrently, targeting card center. The character starts shrinking 250 ms into the leap, moving from roughly one-third to one-fifth viewport height so it reads as moving away from the viewer rather than shrinking while still planted. Near landing, a fade to white covers the leap-to-idle pose reset and center reposition; it clears with the character centered in the game viewport. This fires the single HTML→WebGL handoff (§3.3) and masks warm-pool init (§8.5). Happens once per *decision*, not per card — so it can be as long/beautiful as it needs to be to hide load, because the user has committed and is willing to wait a beat.
3. **Leap (rare — the signature flourish).** The full arcing world-to-world dive (the screen-recordable "what IS this app" moment, all the Bunny Boy key art) is **reserved for special moments** — finishing a game and diving into a suggested next one, or a continuous-play "keep going" mode that strings games together. It is a *special move, not the default grammar*. Reserving it is what keeps it magical instead of a tax paid on every transition.

### 3.3 Rendering architecture (locked) — hybrid handoff

The transition options reduce to one real question: *what is real during the transition?*

- **Pre-rendered video — ruled out.** It can't show a character it's never seen, so it's incompatible with the customizable character + leap-animation monetization (L3/§11). Only viable for a fixed mascot, which we are not.
- **Chosen: hybrid handoff.** The feed scrolls as **native HTML** (cheap, smooth, accessible, free momentum scrolling — and the feed must feel as good as TikTok, which is too important to rebuild in WebGL). One persistent transparent WebGL layer renders the companion over the feed; it is anchored to the viewport, not replicated inside cards. The focused, center-snapped card's live scene can render into that same context (§9.2). On commit (push-in or leap), the WebGL layer **takes over the full screen** — the destination world is already warming in it, so the character moves through a now-fully-3D space with no cut, then you're 100% WebGL in-game. On exit (swipe up), hand back to the HTML feed. So: **option-2 (HTML) at rest, option-3 (full 3D) during transition and play.** The boundary moves only at the moment of the tap — exactly when attention is locked on the character and most forgiving.
- **Why concurrent beats sequential.** In a pure overlay model, loading is sequential (transition plays → then game boots → hard cut). In the handoff, the destination world materializes *in the same 3D space the character is already entering*, so latency-masking and visual continuity become the **same mechanism** rather than two glued together.

### 3.4 Open risks (this section)

- **The handoff seam.** Getting a WebGL canvas to seamlessly take over from an HTML focused-card without flicker or layout jump is fiddly. **Prototype it before committing** (afternoon-sized, graybox-style): an HTML card that on tap expands a WebGL canvas over itself with the character continuing motion across the boundary. Seamless → hybrid is confirmed; stubbornly janky → push toward full-WebGL-everywhere (eat the feed cost) or pure overlay (accept the seam). New ledger item #18.
- Exact verb set in the character contract; graceful-degradation rules per case (L2).

### 3.5 Character production pipeline (validated)

The end-to-end path from concept to a web-ready, rigged, animated character — proven on Bunny Boy. Every character and skin walks this road, so it's a reusable pipeline, not a one-off.

1. **Concept → mesh.** GPT-image for the 2D concept (lock identity early: original glyphs only, no licensed marks), then Meshy.ai image-to-3D for a textured, T-posed mesh. *Meshy's own rig/animation are weaker — use Mixamo for that step.*
2. **Decimate + compress.** Meshy output is ~250k tris / ~18 MB — far too heavy. Run gltf-transform: simplify to a real-time budget and convert the texture to resized WebP (declare `EXT_texture_webp` so it stays spec-valid). Target **~15–25k tris, ~1–2 MB** per character. (Bunny Boy: 263k→21k tris, 18.2→1.3 MB, rig intact.)
3. **Rig → canonical skeleton.** Export geometry-only OBJ (proper scale — beware skinned-mesh world-matrix bakes that shrink the model ~100×) and run **Mixamo auto-rig** to bind it to the canonical Mixamo humanoid skeleton (§3.1). Eyeball deformation under motion (ears/hands/hoodie) before trusting it.
4. **Re-texture + merge clips.** Download the rigged base ("T-pose, with skin") plus the needed Mixamo clips (all share the Mixamo skeleton → no retargeting). Re-apply the original WebP texture (UVs survive auto-rig unchanged) and merge clips into one glb, renamed to the contract verbs.
5. **Validate.** Khronos glTF-Validator must pass clean (`NODE_SKINNED_MESH_NON_ROOT` is expected and benign).

**Output contract.** One glb per character: textured, Mixamo-rigged, named clips. Bunny Boy v1 ships `idle`, `happy_idle`, `leap` (= Mixamo "Run To Dive", the §3.2 signature), `run`, `wave` (= companion greeting, §9.4).

**Known production notes:**
- Clips carry **root motion** (hips translate). Keep it on `leap`; strip it from looping locomotion (`run`) so the character runs in place and position is driven by physics/code. (Open: ledger #20.)
- Skinned meshes move via their **skeleton, not a parent transform** (the validator warning). Drive position through the armature/skeleton root, not a wrapping group — a known day-one integration gotcha.
- Bunny Boy's felt look currently uses a runtime `MeshPhysicalMaterial` with pink/blue color classification to generate masked sheen and micro-normal maps. A single expanded, alpha-hashed skinned pass softens the same regions at the silhouette without paying for layered shell fur. These are prototype shortcuts; production skins ship an authored fuzz mask so material regions remain intentional across cosmetics.

---

## 3A. Companion intelligence (v2)

A v2 layer on top of §3.2's companion: an **LLM-driven, TTS-voiced** character that reacts and talks. Captured now so the thread and its guardrails aren't lost; **not in v1** (it sits on top of the character, friend graph, and telemetry, none of which exist yet).

### Vision

The companion gives *voice* to data the app already has — narrating your runs, reacting to friends in active games, pulling you toward play. The reference is the game-companion in *Her*: presence and continuity, not a feature waiting to be addressed. Example of the right register: *"Greg's been crushing this one — wanna show him up?"* / *"Rough run? Let's go knock some blocks over."*

### Locked principles (for when it's built)

1. **Voice of real data only** (L7). It narrates telemetry and the friend graph — never invented stats, never facts it would have to guess.
2. **Tone governor.** Encourage by default; celebrate the player far more than it ribs them. Tease *only* established friends, framed as invitation ("wanna show him up?") not deficit ("you got stuck"). Punch sideways (at the game) or at itself ("I fell off that ledge nine times, no judgment"). Never mock failure. This is enforced in prompting, not hoped for in tone.
3. **The friendship lives inside the play.** The companion is **a friend you play *with*, not a friend you confide *in*.** It knows your *game* life deeply and your *outside* life not at all. This is the right emotional scope **and** the safety rail — it can only ever speak to data it has (L7), so it structurally can't comment on a child's private life.
4. **Loyal, not neutral.** The companion is *the player's* friend/hype-buddy, not a neutral narrator that roasts both sides. Warmer, safer with kids, and a stronger attachment hook for the signup wall ("keep your guy" is far stronger if your guy demonstrably knows you).
5. **Child-safety model, designed in from day one.** An LLM+TTS speaking to minors, referencing real friends by name, needs hard guardrails: output filtering; no commentary on a child's body/appearance/location; resistance to a child steering it anywhere inappropriate; and "recognizes friends" must not become a vector for an adult posing as a friend to reach a child through a trusted mascot.

### Prompt and profile model

The companion brain is layered, not one giant mutable prompt:

1. **Common system prompt.** Platform-wide identity and guardrails: loyal companion, play-focused scope, real-data-only (L7), tone governor, child-safety constraints, and refusal posture.
2. **`CompanionProfile`.** The internal model for per-user customization. User-facing surfaces call this **Companion Style**, with **Personality Traits** inside it. The profile includes name, style, traits, boundaries, and bounded memory.
3. **Allowed in-app context.** Current recipe/session telemetry, friend graph facts, player profile fields, and recent gameplay signals. External facts and unverified claims are filtered out before prompt composition.

Learned behavior is stored as bounded companion memory, not as an unlimited diary. Acceptable memory categories: explicit player preference ("less teasing"), gameplay preference ("likes tower-smash games"), and personality adjustment ("celebrates quietly"). Out-of-app facts, body/location commentary, and inferred private-life details are not memory.

The code shape follows the architecture charter: prompt composition, signal filtering, and memory filtering live in the pure core; model calls, TTS, realtime sessions, storage, and moderation APIs live in the shell/server edge.

### Cost / scarcity model

LLM+TTS inference fires **only on rare, meaningful beats** (a friend is here; you have real history with this game; you just finished one) — never per card. Idle is canned animation; *speech* is the scarce, earned event. The constraint that makes it affordable is the same one that makes it meaningful rather than chatty wallpaper.

### Speech-driven mouth animation (next companion spike)

A prior working prototype established the minimal path for both buffered TTS and full-duplex speech: route **assistant output audio only** through a Web Audio `AnalyserNode`, reuse one frequency buffer, normalize its energy, then apply asymmetric smoothing (fast attack, slower release) each render frame. Keep the energy normalization and smoothing in the pure core; the audio transport only exposes samples and the three.js shell only applies the resulting pose. For Bunny Boy, the runtime drives the exported `mouth_open` morph target instead of rotating a jaw bone; the continuous fuzzy muzzle deforms cleaner as a shape key layered over the body animations. This replaces the temporary one-second jaw oscillator when companion speech work begins.

### Full-duplex realtime spike

The local spike uses OpenAI Realtime over browser WebRTC, with a tiny development token server that mints ephemeral client secrets from `OPENAI_API_KEY`. The browser never stores the standard API key. The shell owns microphone capture, the `oai-events` data channel, remote assistant audio playback, the output-audio analyser, and simple companion action callbacks. Production hosting remains open: Supabase Edge Functions, a dedicated app server, or another trusted backend can replace the local token server as long as the client contract stays the same.

Assistant output audio can pass through lightweight character-voice shaping before it reaches the analyser and speakers. The current Bunny Boy spike uses the proven path from the prior prototype: Rubber Band WASM pitch shift, a small brightness EQ around 3kHz, and a high-pass filter when pitch is raised. The old prototype carried formant/reverb config fields, but those were not real processing stages; do not expose them until there is an actual DSP implementation behind them.

### Explicitly out of scope

The broader "synthetic companion who knows your whole life" idea (the heavier, adult-facing heart of *Her*) is **not** this product and not the default behavior of a character in a kids' game feed. It carries real dependency/displacement responsibilities and, if ever built, is its own deliberate product for users who opt into exactly that. Parked, not poured into this.

---

## 4. The recipe (a "post")

The persistent catalogue atom and the entire generation spec. The AI fills a small set of enumerable knobs over a fixed physics substrate.

### 4.1 Recipe fields (locked shape)

| Field | Description |
|---|---|
| `recipeId` | Content hash. Identical recipes collapse. Asset cache key (§3.3) + preview-clip binding key (§9.3). |
| Substrate | The shared 3D physics sandbox (always present). |
| Movement plane | Constraint on character movement. Separate knob from camera. |
| Camera | One of an enumerable menu of named modes (§7), each a solved package. |
| Ingredient set | Props/hazards/objects placed in the world. |
| Body classes | Which props are dynamic/destructible vs fixed scenery (§8.1). |
| Relic table | Spawn rules against the global relic interface (§6.1). |
| Preview shot | Which canned shot represents the recipe in the feed (§9.3), with an auto-director default. |

### 4.2 Authoring (locked direction)

Valid-options-per-field; start empty or random; empty ships safely via default/random backfill. Input methods (any/all): guided, LLM natural-language, or direct UI — all resolve to the same field-validated recipe. **(v1 has no user-facing authoring — see §5.0.)**

### 4.3 The floor guarantee

L6 makes an invalid post impossible. "Random" draws from a **blessed set of known-good combinations** (floor-of-fun), not uniform-random. The blessed-set ceiling is bounded by measured capacity (§8.6). Random-backfill doubles as the **cold-start engine**: the platform mints thousands of valid recipes before there's a single user.

### Open

- Recipe-authoring UX (v2); contents/curation of the blessed sets.

---

## 5. Feed & liveness model

**Resolution: the catalogue is the substrate; liveness is a state layered on top.**

### 5.0 v1 content scope (locked)

**User-authored games are v2.** v1's feed is filled by **platform-minted + AI recipes** (the §4.3 cold-start engine makes this viable with zero human authoring). This removes the one unresolved fork (the creation paradigm) from v1 entirely. Decision grounded in observed behavior: the core joy is playing with friends and customizing the character, not authoring.

### 5.1 Locked

- The feed ranks and persists **recipes** → never empty, any hour, region, launch day.
- A recipe is **"live"** if ≥1 session has players.
  - Stop on a **live** recipe → drop into a running session.
  - Stop on a **cold** recipe → instant-start a fresh instance (warm pool, §8.5); you become the live room.
- **Graceful degradation by scale:** catalogue when small, live-map at peak.

### 5.2 Identity (locked)

- **`recipeId`** = persistent catalogue atom (content hash; asset + preview cache key).
- **`sessionId`** = a single running instance.
- **Many sessions : one recipe.** A hot game is live in 40 rooms but one feed entry.

### 5.3 Why this is the spine

"The recipe is the persistent unit" answers the feed model, the floor guarantee, and cold-start at once.

### Open

- Discovery / ranking algorithm. (Note: the companion's reactions, §3A, are a *surfacing* of this same intelligence as emotion.)

---

## 6. Relics (cross-game collectibles)

### Locked

- **Account-bound, non-tradeable** (v1). **Platform-injected, not author-placed** (L4). **Abstract type + rarity, not a mechanic** — interop at the schema level. **Platform-placement gives the hunt for free** (recommender routes players to unfound rares). v1 placement: any reachable surface; v2: weight rares toward hard-to-reach spots. Relics respawn with world-state reset (§8.3).

### 6.1 The global relic interface (locked)

| Property | Type | Example reads |
|---|---|---|
| `EnergyYield` | 0–100 | Racer → boost; sandbox → explosion force |
| `ElementalType` | enum (Fire / Kinetic / Void) | Shooter → damage type; platformer → hazard flavor |
| `RarityTier` | 1–5 | Visual treatment; hunt routing; drop weighting |

The relic is a noun with typed stats; local meaning is the recipe's mapping. The generator never reasons about game logic.

### Depth dial (decided)

v1 = collection & flex (interface present, little consumed). v2 = fuel that changes play (needs a deep catalogue honoring the interface). Insurance: every relic ships with the three properties from day one → v2 switches on with no migration.

### Reachability dependency (free)

Relic injection needs the world to advertise **valid reachable locations** — the same nav data the character needs. One contract.

### Open

- Final property set / enum values; rarity → drop-weight curve.

---

## 7. Cameras & modes

### Locked

- Camera is a **lens onto true 3D physics** (L1). Two separate knobs: projection/angle and movement plane. **Enumerable menu** of 3–4 named modes, each a solved package (projection + movement constraint + control scheme + relic-legibility rule). Not a free dial.

### Launch camera pair

- **Side-2D** — orthographic, fixed camera, side-plane movement. Cleanest controls; most legible post.
- **Isometric** — orthographic, fixed camera, free-on-ground movement, tap-to-move. Keeps party-chaos visible.

Both orthographic, no player-controlled look axis → finishable and scroll-gesture-safe.

### Deferred

Third-person follow = v2 marquee. First-person rejected (hides the character).

### Scope reframing (locked)

Real unit of scope = **locomotion mode × camera**. "Driving" = the mount-vehicle verb. The **physics party-sandbox is the substrate/core**; platformer/racer are constrained presets.

---

## 8. Session & netcode model

### Locked

- **Server-authoritative** headless Rapier sim per room (single source of truth, cheat-resistant). **Snapshot-authoritative + local prediction + interpolation. No rollback** (Fall Guys / Gang Beasts tier). Drop-in = current snapshot + settled-deltas, no history replay.

### 8.1 Three-tier body lifecycle (world-state sync)

| Tier | Meaning | Cost | Sync |
|---|---|---|---|
| **Dormant** | At recipe-defined spot, asleep | ~zero | Rendered from recipe |
| **Awake** | Currently simulating | Full | Rides the per-tick snapshot stream |
| **Settled** | At rest ≠ default | low | Single stored transform-delta, then silent |

Bodies on the wire = the engine's awake islands (Rapier island sleeping).

### 8.2 Capacity (locked unit, measured baseline)

- Bound is **awake-bodies-per-tick**, not player count. Cap both max players and max simultaneously-awake props; over-budget force-sleeps/despawns oldest (= auto cleanup).
- The cap earns its place for three reasons: (a) client render, (b) server egress economics, (c) **large per-snapshot payloads degrade over jittery transports** — (c) is binding at high awake counts.
- **Measured baseline (§8.6):** ~200 awake bodies stream cleanly over LTE on a naive full-snapshot relay; degrades between ~200 and ~800. Production target higher via §8.7.

### 8.3 Teardown — two timers

1. **World-state reset:** instant on empty (fresh sessions clean; relics respawn).
2. **Session-slot keepalive:** short grace window (seconds → ~1 min) so reconnect/late-friend lands in the same room and the "live" badge doesn't strobe.

### 8.4 Cost note

Empty session ≈ free if you stop ticking it (registry row + small delta blob). Teardown is a feel decision.

### 8.5 Warm-pool architecture (locked)

A standing pool of empty headless workers; on cold-recipe drop-in the orchestrator assigns one instantly and passes the `recipeId`. The push-in/leap (§3.2–3.3) masks assignment + init, never provisioning. Agones-style dedicated fleet for sims; edge/DO-class for matchmaking/routing.

### 8.6 Measured findings — graybox rig (June 2026)

Headless Rapier room broadcasting compact binary snapshots (12 B/body: int16 position + smallest-three quaternion, ~0.2° error) over WebSocket to an interpolating three.js client, on an **iPhone over LTE** via a free cloudflared tunnel (pessimistic transport). Worst case: every body awake.

- **Server CPU — non-issue.** 808 bodies all awake stepped ~1.6ms p95 vs a 50ms budget — ~30x headroom. *(Caveat: sandbox CPU; margin survives.)*
- **Compact wire format — validated** (sub-mm position, ~0.2° rotation).
- **Per-client bandwidth — matches model.** ~200 awake bodies full-snapshot ≈ 641 kbps (all-awake worst case; real rooms pay a fraction via §8.1).
- **Render ceiling — not found.** Frame p95 pinned at **17ms / 60fps from 28 through 808 instanced bodies** — **vsync-capped, not GPU-bound.** *(Caveat: instanced identical cubes; varied meshes pull it down — treat >800 as best-case.)*
- **Transport — the binding constraint.** Clean through ~200 awake bodies; collapsed at 808 over the naive relay. The wall is **message size × frequency × transport**, not kbps, render, or CPU.
- **Cellular jitter** caused visible interpolation snapping at default delay; deeper jitter buffer is the known fix (a tuning task).

**Net:** the assumed-hard parts (mobile render, server physics) are safe. The one real engineering surface is **snapshot transport at high awake counts**, already targeted by the production design (§8.7).

### 8.7 Named v1 engineering tasks (scoped)

1. **Snapshot transport at scale:** awake-island culling (§8.1) + **delta encoding** + a real transport (direct WebSocket / WebTransport datagrams). Push the comfortable awake edge well past the ~200 naive baseline.
2. **Jitter-buffer depth tuning:** absorb cellular burstiness; consider adapting delay to measured jitter.

### Open

- Tick rate, production budgets (bounded below by §8.6); keepalive duration; warm-pool sizing/orchestrator; build-vs-buy (lean: own it); a varied-mesh render-ceiling test.

---

## 9. Client modes & controls

### Locked — soft modal

Explicit "tap to enter game mode" is dropped. **Soft modal:** stopping on a live card auto-shows the live scene (passive watching); the **first discrete touch (tap) *is* the first game action**; the **vertical-drag axis is permanently reserved for scroll-away** (exit always one swipe up). A visible close button is the accessible, discoverable equivalent while selected.

### 9.1 Control constraint (locked)

v1 controls must be **tap-discrete and must not own the vertical-drag gesture** (no drag-joysticks at launch). Both launch cameras already want discrete controls, so the constraint is free.

### 9.2 Live preview rendering + the handoff seam (locked)

- **One persistent full-viewport transparent WebGL renderer/context** composited over the feed; it renders the viewport-level companion at rest and swaps the focused live scene into that same context on center-snap. The canvas remains viewport-sized in every state so character animation and root motion cannot be clipped by a companion-sized DOM box; camera/model framing controls apparent size. Never create/destroy a context per card or replicate the companion inside cards.
- The live render is reserved for **populated (live) rooms in center focus** (cold/off-center use clips, §9.3).
- **This focused-card context is the seam** where the §3.3 HTML→WebGL handoff happens on commit. The companion (§3.2) rides the HTML layer until that handoff.
- The focused card is shorter than the viewport so the adjacent cards peek above and below; native center snapping remains the source of focus truth.

### 9.3 Preview clips (locked)

A short (~5s) **recorded loop** made at creation time = the preview for **cold** recipes and **all off-center** cards; the §9.2 live render is the **center-snap upgrade for live rooms only**. "Preview shot" is a recipe field with an **auto-director default** (also covers platform-minted recipes). Generated on the warm pool. Bound to `recipeId` (edit → new hash → re-record). Motion shots hard-cut; reused as the §10 share card.

### 9.4 Companion in the feed (locked v1, ties to §3.2)

The corner companion is part of the feed UI. Prominence inversely tracks card liveness (expressive on cold, recedes on live). Mind the crowded corner — title chip, liveness pill, friend avatars, jump-in button, and the companion compete for space; the inverse-prominence rule is partly what keeps it uncluttered. Reactions stay scarce and legible: greet with `wave` on load, repeat roughly once per minute while browsing, use canned idle by default, and reserve meaningful perk-ups for real signals. Feed waves stop during selection/play and restart after returning. LLM/TTS voice is §3A (v2).

### Axis convention (locked)

Vertical scroll = move between worlds (companion/push-in/leap per §3.2). Horizontal scroll = lore / behind-the-scenes / text.

### Open

- Per-mode control layouts (within §9.1); preview-clip refresh/storage details; companion idle-animation set.

---

## 10. Social, moderation & growth

### Locked

- **Top-level toggle: Explore → Friends-only**, also the **moderation valve** (shoving is the core verb; friends-only self-polices).
- **Signup wall:** share → friend plays → dismissable CTA after a threshold. Hook = **"sign up to keep your guy."** Strengthened by §3A: a companion that demonstrably knows you makes the identity-at-risk hook far stronger. Share card reuses the §9.3 clip.

### Open

- Wall threshold (experiment); scheduling/calendars/invites = v2.

---

## 11. Monetization

Monetize the layer **guaranteed visible in 100% of games**: the character's **appearance**.

- **Traveling cosmetics (monetize aggressively):** skins, hats, emotes, idle behaviors, and especially the **leap animation** (seen on every leap; §3.2). Never suppressed by recipe constraints → guaranteed ROI.
- **Local gear (NOT v1-monetized):** poofs on exit; suppressible by recipes; if ever monetized (v2), sell only its *appearance* as conditional cosmetic.
- **Relics outside monetization** — retention/collection, not revenue.

### Open

- Pricing/currency; v2 gear-appearance cosmetics.

---

## 12. Tech reference

- Render: three.js. Physics: Rapier. Both validated in the graybox (§8.6).
- Netcode: server-authoritative headless Rapier per room; Agones-style warm fleet for sims, edge/DO-class for routing. Wire format: compact 12 B/body (validated). Production transport: delta + awake-island culling over direct WS / WebTransport (§8.7).
- Client architecture: native HTML feed + single persistent WebGL context on the focused card, full-WebGL takeover on commit (§3.3, §9.2).
- **Substrate maturity note:** authoritative dedicated servers and client-prediction netcode are *mature, well-understood* tech — the innovation budget goes to the catalogue-of-recipes + instant-liveness layer, not the substrate. Persistent cross-game identity is the one ambitious bet, de-risked by owning the engine (§3.1). Learning path when returning to implementation: Gambetta's "Fast-Paced Multiplayer" series → a small Colyseus authoritative room → skim Agones for the fleet layer. (Cloud/video game-streaming is deliberately *not* relevant — this product runs on the phone's GPU and syncs state, not pixels; streaming would blow egress and kill instant-join.)
- Prior art: **Rune**, **Hytopia**. Neither does feed-as-primary-surface with a traveling character.

---

## 13. Glossary

- **Recipe / Session / Live / Cold** — see §4, §5.
- **Appearance / Gear / Relic** — see §6, §11; appearance travels & is monetized, gear is local, relics are account-bound typed collectibles.
- **Dormant / Awake / Settled** — body-lifecycle tiers (§8.1).
- **Companion** — the character in corner/scrolling presence (§3.2); cheap, emotive, prominence inversely tracks liveness.
- **Push-in** — the everyday commit transition; one WebGL handoff.
- **Leap** — the rare arcing world-to-world dive; the signature flourish, reserved for special moments.
- **Hybrid handoff** — native HTML feed at rest, full WebGL takeover on commit (§3.3).
- **Companion intelligence** — the v2 LLM+TTS reactive/voiced layer (§3A); "a friend you play with, not confide in."

---

## 14. Open decisions ledger (consolidated)

| # | Decision | Where | Status |
|---|---|---|---|
| 1 | Tick rate + production capacity budgets | §8 / §8.6 | Measured baseline; production numbers open |
| 2 | Teardown keepalive window | §8.3 | Open (number) |
| 3 | Build-vs-buy (own vs Rune/Hytopia) | §8 / §12 | Open; lean = own it |
| 4 | Discovery / ranking algorithm | §5 | Open (companion surfaces it, §3A) |
| 5 | Recipe-authoring UX | §4.2 | **Deferred to v2** (§5.0) |
| 6 | Blessed ingredient-set curation | §4.3 | Open (capacity-bounded by §8.6) |
| 7 | Relic interface final set + rarity curve | §6.1 | Open |
| 8 | Per-mode control layouts | §9.1 | Partly resolved (constraint locked) |
| 9 | Graceful-degradation rules for unhonored gear | §3.4 / L2 | Open |
| 10 | Signup-wall threshold | §10 | Open (experiment) |
| 11 | Character verb-set contract | §3.1 / §3.5 | Partly resolved (Mixamo skeleton + 5 v1 clips locked; full verb set open) |
| 12 | Warm-pool sizing + orchestrator | §8.5 | Open (infra) |
| 13 | Preview pipeline | §9.3 | Resolved |
| 14 | Asset pre-fetch budget | §3.3 | Open (number) |
| 15 | Snapshot transport at scale | §8.7 | Scoped v1 task |
| 16 | Jitter-buffer depth tuning | §8.7 | Scoped v1 task |
| 17 | Varied-mesh render ceiling | §8.6 | Open (one more graybox test) |
| 18 | HTML→WebGL handoff seam | §3.4 | **Open — prototype next** (afternoon-sized) |
| 19 | Companion intelligence (LLM+TTS) design | §3A | **v2** (principles locked) |
| 20 | Root-motion handling for locomotion clips | §3.5 | Open (strip on `run`, keep on `leap`) |
| 21 | Character production pipeline | §3.5 | **Resolved** (validated end-to-end) |
| 22 | Speech-driven jaw / mouth flap | §3A | **Next companion spike** (proven analyser + smoothing approach recorded) |
| 23 | Companion profile + prompt core | §3A | **Foundation slice** (pure prompt layering and real-data filtering started) |
| 24 | Full-duplex realtime companion shell | §3A | **Local spike** (OpenAI Realtime WebRTC + dev token server; production host open) |
| — | Codebase foundation, stack, walking-skeleton first build | `foundation.md` | See companion doc |

---

## 15. Changelog

### v0.4 → v0.5

1. **Added §3.5: the validated character production pipeline** — GPT-image → Meshy → decimate+WebP (gltf-transform) → Mixamo auto-rig → re-texture + merge clips → validate. Proven end-to-end on Bunny Boy (263k→21k tris, 18.2→1.3 MB, rigged, 5 named clips). Ledger #21 resolved.
2. **§3.1 contract** now names the **canonical Mixamo humanoid skeleton** as the shared rig — the concrete mechanism behind "one rig, many appearances" and the §11 economy. Ledger #11 partly resolved (skeleton + 5 v1 clips locked).
3. **Added production notes:** root-motion handling (keep on `leap`, strip on `run`; ledger #20) and the skinned-mesh-moves-via-skeleton gotcha.
4. **Split out `foundation.md`** as the companion codebase doc (stack, repo layout, walking-skeleton first build, tooling). The engineering charter lives at repo root as `CLAUDE.md`. This spec stays product/architecture; foundation stays code-setup.

### v0.3 → v0.4

1. **Expanded §3 into character presence & transitions.** Added the three-tier grammar — **companion** (corner, scrolling, cheap, emotive, prominence inversely tracks liveness), **push-in** (everyday commit transition, one handoff), **leap** (rare world-to-world dive, reserved as the signature flourish). Resolved the scroll-vs-commit tension that earlier drafts left implicit.
2. **Chose the rendering architecture (§3.3): hybrid handoff.** Pre-render ruled out (kills customization/monetization). Native HTML feed at rest; full WebGL takeover on commit, with the §9.2 focused-card context as the seam. Added the handoff-seam prototype as ledger #18.
3. **Added §3A: companion intelligence (v2).** LLM+TTS reactive/voiced layer, with five locked principles — voice-of-real-data (new law **L7**), tone governor, "friend you play with not confide in," loyal-not-neutral, and a child-safety model — plus a scarcity/cost model and an explicit out-of-scope note on the broader "synthetic life-companion" idea. Ledger #19.
4. **Added §5.0:** v1 has no user-facing authoring; feed is platform-minted + AI recipes; user-authored games are v2 (resolves the creation-paradigm fork; ledger #5 → deferred).
5. **Added L7** (the character speaks only to data it has) and threaded it through §3A and §9.4.
6. **§12 tech reference** gained the substrate-maturity note, the Xbox-Avatars-validation point, the learning path, and why game-streaming is deliberately irrelevant.
7. **§11** added idle behaviors as a monetizable cosmetic; **§10** noted the companion strengthens the signup hook.

### Earlier
- v0.2: resolved gear/monetization contradiction; added pre-fetch, warm pool, soft-modal controls, relic interface, single-context preview.
- v0.3: folded in the preview-clip decision and the first graybox measurements; scoped transport + jitter-buffer as v1 tasks.

---

_Frozen here. v1 build order, unchanged by this pass: the one real wall is §8.7 task 1 (delta + awake-island + real transport). The next cheap de-risking prototype is the §3.4 handoff seam (ledger #18) — an afternoon, the way the graybox was. The companion intelligence (§3A) is a v2 product with its principles already on the record, including the boundary that keeps it a delight rather than a dependency: a friend you play with, not one you confide in._
