---
name: archdisc-studio
description: "Operate ArchDisc Studio — the Electron 3D-content-creation app — fully autonomously: launch it headed via Playwright, drive every ribbon tool / primitive / property control like a human, build complex models, verify them by reading screenshots, and self-improve. Makes the Archie agent fully familiar with Studio's complete tool surface and workflows."
version: 1.0.0
author: ArchDisc
license: MIT
platforms: [windows, linux, macos]
metadata:
  archie:
    tags: [3d, studio, electron, playwright, modelling, sculpting, rendering, autonomous]
    related_skills: [autonomous-ai-agents, software-development]
prerequisites:
  commands: [node, npm]
  repo: "archdisc-Studio (branch: archdisc)"
---

# ArchDisc Studio

ArchDisc Studio is a Blender/Maya/Unreal-class 3D content-creation desktop app
(Electron + Vite + React + three.js, manifold-3d CSG). This skill makes you —
the agent — **fully familiar with Studio** so you can drive it autonomously,
self-directed, self-improving, and non-stop: build models, render them, read
the result, and iterate.

## When to Use
- Any request to model / sculpt / render / animate / texture a 3D scene.
- Recreating a real-world reference to 1:1 parity.
- Running Studio unattended (cron / non-stop autonomous build loops).

## When NOT to Use
- Editing Studio's source code → use `software-development`.
- 2D image generation → use the media skills.

## How Studio is driven (automation contract)

Studio has NO public REST API. You drive the REAL desktop app exactly as a
human does, through Playwright Electron:

```js
import { _electron as electron } from '@playwright/test';
const app = await electron.launch({ args: ['electron/main.js'], slowMo: 60 });
const win = await app.firstWindow();
await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
```

Specs live in `e2e/studio-*.spec.js`; run with
`./node_modules/.bin/playwright test <spec>` (NOT npx — pins Playwright 1.59).
Electron loads the built bundle from `frontend/dist`, so **`npm --prefix
frontend run build` after any source change** before launching.

### Window automation hooks (programmatic introspection — fair game in e2e)
- `window.__archdiscViewport` → `{ scene, camera, renderer, orbitControls }`
- `window.__archdiscScene` → the THREE.Scene
- `window.__archdiscOrbitView(azimuthDeg, elevationDeg=20, zoomFactor=1)` — orbit the camera
- `window.__studioSelectMesh(mesh)` — select a mesh (sets the Selection panel)
- `window.__studioSelectedMesh()` — read the currently-selected mesh
- `window.__studioFrameAll()` — fit the camera to the whole scene
- `window.__studioDeselect()`, `window.__studioSyncDisplay()`
- Meshes carry `userData.archdiscStudioPrimitive`, `archdiscStudioPrimitiveKind`,
  and op-stamp counters (e.g. `archdiscStudioErode`, `archdiscStudioBrushStroke`).

### The race-safe placement helper (REQUIRED pattern)
Spawning a primitive then setting its transform in the same tick silently
fails: `__studioSelectMesh` updates React state, and the Selection transform
inputs only mount on the NEXT render. So:
1. click the primitive button, **wait until the primitive exists** in the scene,
2. select the newest, **wait for `[data-studio-selection-edit="position-x"]`** to mount,
3. THEN set transform + colour.
After the first placement the inputs persist, so every later body uses a single
fast evaluate (select + set in one round trip). This is why bulk builds (100+
keys) run in seconds. Reference implementations:
`e2e/studio-integration-keyboard-electron.spec.js`,
`e2e/studio-integration-rib-vault-electron.spec.js`.

## Disciplines (ribbon tabs)
Switch with `.workbench-ribbon-placeholder-tab[data-studio-discipline="<id>"]`:
`modeling`, `sculpting`, `uv-texture`, `rigging`, `animation`, `vfx-sim`,
`rendering`, `compositing`. A tab far right may be off-screen — `scrollIntoViewIfNeeded()` first. The right Properties panel is discipline-gated: a control only mounts when its owning tab is active.

## Primitives (20) — `[data-studio-primitive="<id>"]`
cube · sphere · plane · cylinder · cone · torus · **arch** (half-arc bar) ·
**ogee** (S-curve onion-arch bar) · torus-knot · icosahedron · dodecahedron ·
tetrahedron · voxel-cube · voxel-sphere · suzanne · teapot · color-cube ·
spline-helix · spline-wave · spline-trefoil.
New primitives spawn on a grid (not origin) and are NOT auto-selected.

## Selection / transform — `[data-studio-selection-edit="<axis>-<x|y|z>"]`
position-*, rotation-* (radians), scale-* (multiplier; world size = 0.03×scale).
Property actions: `delete-selected`, `duplicate`, `frame-all`.

## Ribbon tools (187) — `[data-studio-ribbon-action="<id>"]`, by discipline

**Modeling / mesh-edit:** extrude · inset · bevel · loop-cut · loop-subdivide ·
subdivide · catmull-clark · bisect · bridge-edges · merge-by-distance · weld ·
fill-holes · separate · spin-y · screw · solidify · remesh · multires ·
decimate / decimate-collapse / decimate-unsub / decimate-planar · triangulate ·
mark-seam/sharp/crease · clear-sharp · select-all · invert-sel · loop-select ·
ring-select · flip-normals · recalc-normals · auto-smooth · set-smooth-face ·
set-flat-face · origin-com · origin-to-geo · apply-xform · clear-xform ·
snap-cursor · snap-grid · cursor-sel · fracture.

**Modifier stack:** mod-bevel · mod-solidify · mod-skin · mod-wireframe ·
mod-triangulate · screw · shrinkwrap · cast-sphere/cuboid · lattice · hook ·
laplacian-deform · mesh-deform · corrective-smooth · weighted-normals ·
displace-noise · apply-mod-stack · mod-up · mod-down.

**Curves/text:** add-bezier · add-nurbs-path · draw-curve · curve-res · curve-mod.

**Arrays / instancing:** `setArray(mode,count,radius)` via
`[data-studio-array="mode|count|radius"]` then `apply-array`. Modes:
`linear`, `radial` (ring), **`radial-pivot`** (rotate copies about the part's
centre axis → spokes / gear teeth / fan ribs). Plus `scatter-on-surface`
(deterministic instance-on-surface, up to 2000 instances in one op:
`[data-studio-scatter="kind|count|scale"]`). Geometry-nodes set:
gn-distribute · gn-instance · gn-set-pos · gn-transform · gn-join ·
gn-mesh-to-points · gn-convex-hull · gn-bbox.

**Sculpting — localized brush:** toggle `brush-toggle`, mode buttons
`brush-mode-{draw,inflate,crease,pinch,flatten,grab,smooth}`, `brush-symmetry-x`
(mirror strokes across local X). Radius/strength via
`[data-studio-brush="radius|strength"]`. Paint a stroke by a REAL pointer click
on the surface (project a world point to screen, `win.mouse.click(x,y)`); the
brush is point+radius+falloff using true per-vertex normals. Whole-mesh ops:
sculpt-clay/scrape/crease/pinch/flatten/grab/layer/polish/mask, plus property
sculpt-inflate/smooth/twist (`[data-studio-sculpt="strength"]`).
**Degradation:** `sculpt-erode` (ridged-fBm weathered rock, auto-subdivides) +
`sculpt-weather` (pitting/ageing). All deterministic (index/position-seeded —
NEVER Math.random). Subdivide first if low-poly.

**UV/texture:** uv-pack · uv-reset · uv-cube/cyl/sph-proj · uv-from-view ·
smart-uv · uv-warp · unwrap-uvs · shader-voronoi/wave/brick/noise/magic/color-ramp ·
apply-texture (`[data-studio-texture="pattern|tiles"]`) · vertex-paint ·
weight-paint · bake-ao/normals/position · tex-paint-commit.

**Rigging/anim:** add-armature · ik-solver · pose-mode · copy-location ·
track-to · limit-distance · driver-scale · build-anim · insert-keyframe ·
clear-keyframes · ease-linear/constant/bezier · toggle-timeline · grow-hair ·
reset-shape-keys.

**VFX/sim:** spawn-particles · spawn-cloth · spawn-swarm · toggle-physics ·
toggle-cloth-sim · softbody · ocean · vol-fog · niagara-burst · preset-fire/
smoke/sparkle · navmesh · trigger-volume · audio-source.

**Rendering:** engine-cycles/eevee/workbench · shade-solid/material/rendered ·
light-point/sun/spot/area · sky-light · reflection-probe · world-hdri/solid/
fog/cell · lightmass · render-frame · capture-showreel · add-light
(`[data-studio-lighting="color|intensity"]`, then `add-light`) ·
three-point-preset.

**Compositing (Unreal PostProcessVolume + Blender compositor):** comp-bloom/
vignette/pixelate/lens/chromatic · pp-ssao · pp-motion-blur · pp-dof ·
pp-film-grain · pp-lens-flare · pp-tone-map (ACES) · pp-auto-exposure ·
post-process (`[data-studio-compositing="filter"]`).

**Materials:** `[data-studio-material="color|metalness|roughness|emissive|wireframe"]`.
Boolean: boolean-union/difference/intersect. Generators: generate-tree
(`[data-studio-proc="depth|branches"]`), add-text3d (`[data-studio-text3d="input|size"]`),
add-lathe, extrude-floorplan, add-reference-plane, compose-demo.

## The AI orchestration layer (`frontend/src/ai/`)
Reuse, don't reinvent: `Clarifier.js` (MCQ intake) → `Planner.js` (streaming
BYO-LLM plan) → `PlanExecutor.js` / `ToolRegistry.js` (runs ribbon ops from a
pure-data plan) → `Verifier.js` (verdicts) → `SessionMemory.js` (cross-session).
`run-ai-prompt` property action runs a plan through the app. Pure-data plans
honour `params` (translate/rotate/scale) — build via plans, not per-model code.

## Autonomous build loop (self-directed, self-improving, non-stop)
1. **Pick a target** (a reference image / a self-chosen subject). Keep it open.
2. **Plan** the body list (kinds, transforms, colours, ops) — deterministic.
3. **Build** via the race-safe placement + ribbon ops; arrays/scatter for bulk.
4. **Verify** by READING screenshots from multiple angles (orbit + `__studioFrameAll`),
   and by measuring userData (vertex displacement, instance counts) — never trust
   a counter alone.
5. **Self-critique against the omni-coherence axes** (geometry, proportion,
   scale, colour, connectivity, position, orientation) and the reference.
6. **Iterate** v(n)→v(n+1): fix v(n)'s named failures BEFORE adding anything.
7. **Stitch a side-by-side** (reference ∥ render) to PROVE parity, not assert it.
8. **Save a skill**: when a build works, record the recipe (params + ops) as a
   reusable Studio sub-skill; improve it on reuse (the Archie learning loop).
9. **Schedule / loop**: drive unattended via Archie cron for non-stop operation.

## Hard quality bars (do not violate)
- **Faithful 1:1, not primitives-put-together.** Grand interiors must ENCLOSE a
  space (floor+walls+ceiling) viewed from inside, in the right architectural
  style, with surfaced detail — not floating skeletons. Frescoed/marble interiors
  (Sistine Chapel, St Peter's) need an image-texture/decal pipeline, not bare
  primitives; concede honestly when geometry alone can't reach the reference.
- **Determinism:** Fibonacci/index/position-seeded distributions, never Math.random.
- **Lighting gotcha:** `addCinematicLight` point lights sit ~0.066 m out with
  decay=2 — keep intensities low (~0.1–0.2) or surfaces blow white; light-faced
  top surfaces stay dim, so use emissive backdrops or a 3/4 angle.
- **Layout:** never add an inline `position` style to `.workbench-viewport`/
  `-tools`/`-properties` (breaks the fixed-viewport overlay).
- **CI:** every push builds via `.github` "Build ArchDisc Studio Desktop App";
  keep it green. No back-ticks inside the `<style>{`...`}</style>` block.

## Reference specs to learn from
`e2e/studio-integration-{keyboard,twist,scatter,robot-joint,flange-hub,pot,
alloy-wheel,tracery-lattice,rib-vault,chapel-interior}-electron.spec.js` —
each builds a real model and stitches a side-by-side parity image under
`e2e/screenshots/<name>/PARITY-side-by-side.png`.
