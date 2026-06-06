# ArchDisc Studio ↔ Game Engine Parity Map

Studio's target is **1:1 or better parity with Unreal Engine, Unity, RAGE,
and other major real-time game engines** alongside its DCC (Blender) parity.
This map catalogs every Studio feature with its game-engine counterpart.

## Real-time rendering / lighting

| Studio feature        | Unreal equivalent              | Unity equivalent           | RAGE equivalent     |
|-----------------------|--------------------------------|----------------------------|---------------------|
| Render engines (3)    | RHI (D3D12/Vulkan/Metal)       | URP / HDRP / Built-in      | RAGE renderer       |
| 3-Point Lighting      | DirectionalLight × 3           | Light × 3                  | n/a                  |
| SkyLight              | SkyLight Actor                 | Skybox-based ambient       | RAGE sky probe      |
| Reflection Probe      | SphereReflectionCapture        | ReflectionProbe            | n/a                  |
| HDRI sky              | SkySphere + HDRI               | Skybox material            | env probe           |
| Fog                   | ExponentialHeightFog           | Fog (Lighting Settings)    | RAGE fog volume     |
| Point / Sun / Spot / Area | PointLight / DirectionalLight / SpotLight / RectLight | Point / Directional / Spot / Area | RAGE light suite |
| Shading modes (Solid/Material/Rendered) | Viewport view modes | Scene view shading         | RAGE editor modes   |

## Materials / shaders

| Studio feature        | Unreal equivalent              | Unity equivalent           |
|-----------------------|--------------------------------|----------------------------|
| Material presets (9)  | Material Instance              | Material asset             |
| Shader: Voronoi       | Material function: Voronoi     | Shader Graph Voronoi node  |
| Shader: Wave          | Material function: Wave        | Shader Graph Wave node     |
| Shader: Brick         | Tile texture sample            | TilingAndOffset node       |
| Shader: Magic         | n/a (custom)                   | n/a                         |
| Shader: Noise         | Material function: Perlin      | Shader Graph Noise node    |
| Color Ramp            | LERP color stops               | Gradient node              |
| Procedural canvas    | n/a                            | n/a                         |

## Particles / VFX

| Studio feature        | Unreal equivalent              | Unity equivalent           | RAGE equivalent     |
|-----------------------|--------------------------------|----------------------------|---------------------|
| Particle cloud        | Niagara emitter                | Shuriken ParticleSystem    | RAGE pfx            |
| Fire / Smoke / Sparkle presets | Niagara presets         | Default particle presets   | preset effects      |
| Hair / Fur            | Groom system                   | Hair Designer              | n/a                  |
| Cloth Sim             | Chaos Cloth                    | Cloth component            | RAGE cloth          |

## Animation

| Studio feature        | Unreal equivalent              | Unity equivalent           |
|-----------------------|--------------------------------|----------------------------|
| Keyframes (linear)    | Sequencer linear interp        | AnimationCurve Linear      |
| Bezier easing         | Sequencer cubic interp         | AnimationCurve Bezier      |
| Constant easing       | Sequencer constant interp      | AnimationCurve Constant    |
| Motion Path display   | Sequencer trajectory           | Anim editor preview path   |
| Timeline play         | Sequencer playback             | Animator playback          |
| Armature              | Skeleton asset                 | Avatar / Animator          |
| Pose mode             | Edit-pose mode                 | Avatar pose                 |
| IK Solver             | Two Bone IK / Control Rig      | IK component               |
| Constraints (Track-To/Copy-Loc/Limit-Dist) | Constraint stack | Constraint components |
| Driver (scale = pos.y)| Sequencer Property Bind        | Animation event binding    |

## World / level

| Studio feature        | Unreal equivalent              | Unity equivalent           |
|-----------------------|--------------------------------|----------------------------|
| Landscape (heightmap) | Landscape Actor                | Terrain                    |
| Foliage paint         | Foliage paint mode             | Tree+Detail painter        |
| NavMesh               | RecastNavMesh                  | NavMesh                    |
| Trigger Volume        | TriggerVolume                  | Collider.isTrigger         |
| Audio Source          | AudioComponent                 | AudioSource                |
| Outliner              | World Outliner                 | Hierarchy panel            |

## Compositor / post-process

| Studio feature        | Unreal equivalent              | Unity equivalent           |
|-----------------------|--------------------------------|----------------------------|
| Bloom                 | Bloom (PostProcess Volume)     | Bloom (PostProcessing v2)  |
| Vignette              | Vignette (PostProcess Volume)  | Vignette                   |
| Pixelate              | Custom material PostProcess    | Pixelate shader             |
| Lens Distortion       | Lens Distortion (PP Volume)    | Camera Lens Distortion     |
| Chromatic Aberration  | Chromatic Aberration (PP Vol)  | Chromatic Aberration       |
| Node compositor: Chroma Keyer | Composure keyer / OCIO | n/a (external) — slice 737: real green/blue-screen keyer in the node compositor (`compositor/nodes.js` `keyer`): screen-balance matte (keyChannel − max(others), normalised vs key colour, smoothstep clip-black/white) + DESPILL (suppress the key channel where it dominates the avg of the other two). Nuke Keylight / Fusion Primatte / OBS Chroma Key. e2e: green→alpha 0, subject→alpha 255, green-spill 200→115. `__studioCompositorNodeAdd('keyer')` + `NodeSetParam` + `EvaluateWith`. |
| Node compositor: Glow / Bloom | Bloom (PostProcess) | Bloom | slice 737 — `compositor/nodes.js` `glow`: luminance bright-pass → separable box blur → screen-blend back (Nuke Glow / Fusion SoftGlow / Blender Glare). |

## Geometry Nodes / procedural

| Studio feature        | Unreal equivalent              | Unity equivalent           |
|-----------------------|--------------------------------|----------------------------|
| Mesh → Points         | Niagara Static Mesh sample     | VFX Graph mesh sample      |
| Distribute Points     | Niagara Spawn Per Mesh         | VFX Graph spawn on mesh    |
| Convex Hull           | n/a (manual)                   | MeshCollider convex        |
| Join Geometry         | StaticMesh Editor combine      | Mesh.CombineMeshes         |
| Set Position          | Niagara position module        | VFX Graph position output  |
| Bounding Box          | StaticMesh bounds              | Mesh.bounds                |
| Transform Geometry    | Matrix transform               | Transform component        |

## Shipped engine features

- Material visual graph editor (Unreal Material Editor / Unity Shader Graph /
  Substance Designer) — DONE (slice 165). Node-based PBR material assembly
  (Texture/Color/Scalar/Color Mix -> Material Output channels) on the shared
  node-graph engine; "Material Graph" ribbon toggle + `__studioApplyMaterialGraph`.
- Chaos / PhysX rigid body simulation — DONE (slice 166). Semi-implicit Euler
  solver: 3D momentum + gravity, sphere-proxy pairwise collision with impulse
  resolution + positional correction (bodies stack/settle without
  interpenetration), mass-by-volume, ground + contact friction. Drives the
  VFX/Sim "Drop" tool; `__studioPhysicsStep`/`__studioPhysicsState`.
- Sequencer / Timeline track editor (Unreal Sequencer / Unity Timeline) — DONE
  (slice 167). Native monotone Sequencer dock: frame ruler, scrubber/playhead,
  transport, per-object keyframe tracks; interpolates position/rotation/scale.
- Blueprint visual scripting graph (Unreal Blueprint / Unity Visual Scripting) —
  DONE (slice 168). EXECUTION-flow graph on the shared node-graph engine: Event
  BeginPlay fires and control follows the exec wire through Spawn / Move /
  Rotate / Scale / Set Color nodes acting on the live scene (object data pins
  thread the spawned mesh). "Blueprint" ribbon toggle + `__studioRunBlueprint`.
- AnimBP state machine (Unreal Animation Blueprint / Unity Animator) — DONE
  (slice 172). Named locomotion states (idle/walk/run) drive a procedural pose
  (bob/sway/turn) on the selected mesh with a cross-fade on state change;
  ribbon state buttons + Play, `__studioAnimBPSet`/`__studioAnimBPStep`.
- Lightmass / Progressive Lightmapper AO — DONE (slice 171, see DCC map "Map
  baking"): real hemisphere ray-traced ambient-occlusion bake into vertex colours.
- Niagara / VFX Graph emitter — DONE (slice 173). Module graph (Spawn / Initial
  Velocity / Force / Colour-over-Life -> Emitter Output) on the shared node-graph
  engine, simulated as a deterministic THREE.Points burst (pos = o + v*age +
  0.5*F*age^2); "Niagara FX" ribbon toggle + `__studioEvalNiagara`/`__studioNiagaraStep`.
- Behaviour Tree + Blackboard (Unreal Behavior Tree / Unity Behavior Designer) —
  DONE (slice 174). Tickable AI tree on the shared node-graph engine (Root ->
  Selector/Sequence -> Condition/Action, children ordered left-to-right); the seed
  tree drives the selected agent toward a blackboard target then signals arrival;
  "Behavior Tree" ribbon toggle + `__studioBTTick`.

- World Partition + streaming (Unreal World Partition / Unity Addressables) —
  DONE (slice 175). world/worldPartition.js buckets primitives into a uniform
  spatial grid and streams cells in/out by Chebyshev cell distance from an origin
  (the camera target); "World Part" ribbon toggle + `__studioStreamAround` /
  `__studioRevealAll`. Moving the origin swaps the resident set.
- Wwise / MetaSounds / Unity AudioSource spatial audio — DONE (slice 176).
  audio/spatialAudio.js: real Web Audio graph (Oscillator -> Gain -> StereoPanner)
  per source; the listener (camera) drives inverse-rolloff distance attenuation +
  stereo pan; visible source gizmo; "Audio Src" ribbon + `__studioAddAudioSource`/
  `__studioSetListener`/`__studioAudioState`. (Synthesized tone; HRTF/occlusion/
  reverb zones out of scope.) Replaced the old octahedron-only placeholder.
- WebXR AR/VR (Unity AR Foundation / Unreal XR) — DONE (slice 180). Real WebXR
  immersive session via three.js renderer.xr + the WebXR Device API: detects
  support (`navigator.xr.isSessionSupported`), enters AR/VR on an XR device,
  and degrades gracefully on a non-XR desktop. "AR / VR" ribbon + status +
  `__studioXRSupport`/`__studioEnterXR`. Honest scope: session entry, not full
  AR-Foundation plane-detection/anchors (need on-device AR feature APIs).

## Effectively covered / honest-defer

- Datasmith-class asset import — COVERED by the existing rich-scene import
  pipeline (FBX / USD / glTF / OBJ loaders bring in scene graph + materials).
  A dedicated `.udatasmith` (proprietary Unreal) parser adds little over these.
- Solid sewn trimmed-B-rep booleans (vs the trimmed SURFACE shipped, slice 178)
  need a B-rep kernel — OCCT was removed in the viewport de-CAD by design; mesh
  CSG booleans (manifold-3d) already cover solid combination.

## Caveat

Per the design contract (memory: `feedback_studio_game_engine_parity`),
each new engine-parity slice should cite the engine concept name in
code comments + ribbon button tooltips so users can trace any Studio
feature back to its Unreal/Unity/RAGE counterpart.
