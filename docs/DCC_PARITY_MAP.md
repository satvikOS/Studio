# ArchDisc Studio ↔ DCC Tool Parity Map

Studio's target is full **Blender** parity as the base (see
`BLENDER_KERNEL_MAP.md`) + game-engine parity (`GAME_ENGINE_PARITY_MAP.md`),
and on top of that **1:1-or-better parity** with the major DCC tools below.

This map is an **honest coverage tracker** (status as of 2026-05-29). It is the
counterpart to the other two maps for the non-Blender DCC tools, which had no
tracking before. Status legend:

- **DONE** — a real implementation exists and is verified by a headed e2e.
- **PARTIAL** — a real but limited/approximate implementation exists.
- **STUB** — a placeholder (counter / marker geometry) — not real yet.
- **ABSENT** — no implementation.

Every parity slice should cite the tool concept in code comments + ribbon
tooltips, mirror the tool's algorithm + UX, and update this table.

## ZBrush / Mudbox / Nomad (digital sculpting)

| Capability | Status | Notes / next |
|------------|--------|--------------|
| Localized brush sculpt (draw/inflate/crease/pinch/flatten/grab/smooth) | PARTIAL | `paintBrushAt` localized brush + X-symmetry shipped; verify per-mode |
| Erosion / weathering / degradation | DONE | `sculptErode` / `sculptWeather` (deterministic fBm) |
| Masking (mask buffer) | STUB | `sculptMaskBrush` counter-only — need a real per-vertex mask buffer |
| Sculpt layers (multi-res levels) | STUB | `sculptLayer` inflate+counter — need a layer stack |
| DynaMesh (uniform reskin) | ABSENT | only coarse voxel `remeshModifier` |
| ZRemesher (quad retopology) | ABSENT | no retopology |
| Polypaint (vertex paint by brush) | PARTIAL | `vertexPaintGradient` bakes a fixed gradient; need brush paint |
| Stamp / stencil / alpha brushes | ABSENT | — |
| Subtools / subtool hierarchy | ABSENT | flat primitive stack |

## Houdini (procedural)

| Capability | Status | Notes / next |
|------------|--------|--------------|
| Procedural node graph (geometry nodes / SOP DAG) | ABSENT | "Geometry Nodes" group = one-shot buttons; **need a real node-graph editor** (highest-impact gap) |
| VEX-like expressions | ABSENT | — |
| Scatter / distribute points | PARTIAL | `geometryNodesDistributePoints` + foliage instancing |
| Cell fracture / explode | DONE | `MOD_explode` cell fracture |
| Volume / VDB | ABSENT | — |

## Maya

| Capability | Status | Notes / next |
|------------|--------|--------------|
| NURBS surfaces/curves | ABSENT in Studio | real NURBS B-rep exists in `kernel/` but is **not imported** into Studio — wire it (slice planned) |
| Deformer stack / node editor | ABSENT | modifiers are destructive one-shots |
| MASH / instancing | PARTIAL | Array modifier + foliage instancing |
| Rigging (joints / IK / constraints / skinning) | PARTIAL | armature + IK + constraints shipped (see GAME_ENGINE map) |

## 3ds Max

| Capability | Status | Notes / next |
|------------|--------|--------------|
| Modifier stack (non-destructive, reorderable) | PARTIAL/STUB | move-up/down + apply exist but don't manage a real live stack |
| Spline → Loft / sweep along path | ABSENT | Bezier/NURBS-path curves exist; no loft/sweep |
| Parametric primitives (re-editable) | PARTIAL | primitives added, not re-editable parametrically |

## Cinema 4D

| Capability | Status | Notes / next |
|------------|--------|--------------|
| MoGraph cloner + effectors | ABSENT | Array only; need falloff-driven effectors |
| Deformers (bend/twist/taper/…) | DONE | Simple Deform family (Blender ports) |

## Substance (Painter / Designer)

| Capability | Status | Notes / next |
|------------|--------|--------------|
| Procedural material graph | PARTIAL | `applyShaderTexture` draws real procedural canvases (Voronoi/Wave/Brick/Magic/Noise) but bakes to a flat image — no node graph, no PBR channel set |
| PBR texture painting on UVs | STUB | `texturePaintCommit` counter-only |
| Map baking (AO/normal/position) | PARTIAL | `bakeOp` bakes to vertex colors (not texture maps) |

## Rhino

| Capability | Status | Notes / next |
|------------|--------|--------------|
| NURBS curves / surfaces | ABSENT in Studio | same as Maya — `kernel/` NURBS not wired |
| SubD | PARTIAL | loop / Catmull approximations |
| Grasshopper (visual node graph) | ABSENT | needs the node-graph editor |

## SketchUp

| Capability | Status | Notes / next |
|------------|--------|--------------|
| Push/Pull face extrude | PARTIAL | `extrudeFaces` pushes all faces along normals; need interactive single-face push/pull |
| Inference snapping | PARTIAL | grid + vertex snap exist; no live inference engine |

## Interop (all tools)

| Capability | Status | Notes / next |
|------------|--------|--------------|
| glTF / OBJ import | DONE | real GLTFLoader / OBJLoader (slice 145) |
| glTF export | DONE | GLTFExporter |
| FBX / USD import | ABSENT | — |

## Caveat

Honest tracker, not a literal claim of feature-complete parity. Many entries are
PARTIAL/STUB/ABSENT by design — this map exists so the gaps are explicit and
trackable as they are closed, slice by slice.
