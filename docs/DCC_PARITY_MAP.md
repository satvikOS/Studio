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
| Masking (mask buffer) | DONE | real per-vertex protect-mask: `paintMaskAt` + `mask` brush mode; the brush restores masked verts post-stroke; masked areas shade darker; Clear/Invert (slice 151) |
| Sculpt layers (multi-res levels) | STUB | `sculptLayer` inflate+counter — need a layer stack |
| DynaMesh (uniform reskin) | DONE | `dynaMeshGeometry` — voxelise (ray-crossing point-in-mesh) -> watertight cuberille -> weld -> Laplacian smooth; uniform-topology reskin (slice 155) |
| ZRemesher (quad retopology) | PARTIAL | UNIFORM quad remesh shipped — `quadRemeshGeometry` voxelises -> genuine 4-sided quad faces -> weld -> smooth (slice 164). Field-aligned / curvature-adaptive quad FLOW (true ZRemesher) is the remaining deep extension |
| Polypaint (vertex paint by brush) | DONE | `paintPolyAt` — real per-vertex colour brush with radial falloff; `polypaint` brush mode + colour picker (slice 161) |
| Stamp / stencil / alpha brushes | DONE | `stamp` brush mode — procedural alpha (concentric rings) drives a patterned relief, not a uniform dome (slice 163). Custom alpha-image stencils are the next extension |
| Subtools / subtool hierarchy | ABSENT | flat primitive stack |

## Houdini (procedural)

| Capability | Status | Notes / next |
|------------|--------|--------------|
| Procedural node graph (geometry nodes / SOP DAG) | DONE | real geometry node graph (nodegraph/): DAG eval engine + visual editor (draggable nodes, SVG wires, click-to-connect, params, Evaluate->Scene). Nodes: primitive/transform/subdivide/bevel/displace/array/merge/output (slice 152). Material/shader graph now reuses this framework (slice 165, generalized to a node-type registry); Blueprint graph next |
| VEX-like expressions | ABSENT | — |
| Scatter / distribute points | PARTIAL | `geometryNodesDistributePoints` + foliage instancing |
| Cell fracture / explode | DONE | `MOD_explode` cell fracture |
| Rigid body dynamics (RBD) | DONE | real rigid-body solver (slice 166) — semi-implicit Euler, 3D momentum + gravity, sphere-proxy pairwise collision with impulse resolution + positional correction (bodies stack/settle, no interpenetration), mass-by-volume, ground + contact friction. Drives the VFX/Sim "Drop" tool; `__studioPhysicsStep`/`__studioPhysicsState` (also Unreal Chaos / Unity PhysX / Blender Rigid Body World). Sphere-proxy collision is the honest scope (not full convex) |
| Volume / VDB | ABSENT | — |

## Maya

| Capability | Status | Notes / next |
|------------|--------|--------------|
| NURBS surfaces/curves | PARTIAL | rational degree-3 tensor-product NURBS SURFACE shipped — ribbon primitive + node-graph node (three Cox-de Boor, slice 153). NURBS curves + exact trimmed B-rep (OCCT booleans) still a separate effort |
| Deformer stack / node editor | DONE | non-destructive modifier stack (slice 154) + the geometry node editor (slice 152) |
| MASH / instancing | PARTIAL | Array modifier + foliage instancing |
| Rigging (joints / IK / constraints / skinning) | PARTIAL | armature + IK + constraints shipped (see GAME_ENGINE map) |
| Timeline / Sequencer (keyframe track editor) | DONE | native monotone Sequencer dock (slice 167, Unreal Sequencer / Unity Timeline / Blender Dope Sheet) — frame ruler, draggable playhead/scrubber, transport, one track per animated object with keyframe diamonds; wired to the keyframe engine which now interpolates position + rotation + SCALE with linear/bezier/constant easing. Replaces the inherited blue display-only TimelineEditor |

## 3ds Max

| Capability | Status | Notes / next |
|------------|--------|--------------|
| Modifier stack (non-destructive, reorderable) | DONE | real live stack re-evaluated from a clean base every edit (reuses the node engine); add/remove/reorder/toggle; removing a mid-stack modifier truly reverts it (slice 154) |
| Spline → Loft / sweep along path | ABSENT | Bezier/NURBS-path curves exist; no loft/sweep |
| Parametric primitives (re-editable) | PARTIAL | primitives added, not re-editable parametrically |

## Cinema 4D

| Capability | Status | Notes / next |
|------------|--------|--------------|
| MoGraph cloner + effectors | DONE | `mographCloner` — grid clones (one InstancedMesh) + radial/linear falloff effector driving scale/rise/twist (slice 149) |
| Deformers (bend/twist/taper/…) | DONE | Simple Deform family (Blender ports) |

## Substance (Painter / Designer)

| Capability | Status | Notes / next |
|------------|--------|--------------|
| Procedural material graph | DONE | node-based MATERIAL/SHADER graph (slice 165) — reuses the geometry DAG engine retargeted to PBR: Texture (deterministic Voronoi/noise/checker/wave/gradient -> CanvasTexture) / Color / Scalar / Color Mix nodes feed a Material Output node that assembles a MeshStandardMaterial (colour / roughness / metalness / emissive / map channels), applied to the selected mesh. Visual editor + `__studioApplyMaterialGraph` hook. (Substance Designer / Unreal Material Editor / Unity Shader Graph.) |
| PBR texture painting on UVs | DONE | full PBR channel set — paint into colour / roughness / metalness / emissive, each its own CanvasTexture wired to the matching MeshStandardMaterial map; channel selector + colour picker + `texpaint` brush mode (slices 156, 160). (Normal/height map is the remaining extension.) |
| Map baking (AO/normal/position) | PARTIAL | `bakeOp` bakes to vertex colors (not texture maps) |

## Rhino

| Capability | Status | Notes / next |
|------------|--------|--------------|
| NURBS curves / surfaces | PARTIAL | NURBS surface shipped (slice 153, shared with Maya); NURBS curves + trimmed B-rep pending |
| SubD | PARTIAL | loop / Catmull approximations |
| Grasshopper (visual node graph) | PARTIAL | the geometry node-graph editor (slice 152) is the Grasshopper-style DAG; needs Rhino-specific NURBS nodes |

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
| FBX / USD import | DONE | Autodesk FBX (three FBXLoader) + Pixar USD/USDZ (three USDZLoader) wired into the import pipeline + ribbon buttons (slice 162); real battle-tested loaders |

## Caveat

Honest tracker, not a literal claim of feature-complete parity. Many entries are
PARTIAL/STUB/ABSENT by design — this map exists so the gaps are explicit and
trackable as they are closed, slice by slice.
