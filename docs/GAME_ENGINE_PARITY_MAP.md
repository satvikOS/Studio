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

## Pending engine features (queued)

- Blueprint visual scripting graph (Unreal Blueprint / Unity Visual Scripting)
- AnimBP state machine (Unreal Animation Blueprint / Unity Animator state machine)
- Niagara emitter graph (separate from Studio's particle presets)
- Datasmith-class asset import (FBX, USD, Datasmith)
- Lightmass baking (Unreal Lightmass / Unity Progressive Lightmapper)
- World Partition + streaming (Unreal World Partition / Unity Addressables)
- Wwise / MetaSounds audio integration
- Behavior Tree + Blackboard (Unreal AI / Unity Behavior Designer)
- AR Foundation parity (Unity AR Foundation)

## Caveat

Per the design contract (memory: `feedback_studio_game_engine_parity`),
each new engine-parity slice should cite the engine concept name in
code comments + ribbon button tooltips so users can trace any Studio
feature back to its Unreal/Unity/RAGE counterpart.
