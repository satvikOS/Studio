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
| ZRemesher (quad retopology) | DONE | TWO modes: (1) UNIFORM quad remesh of any mesh — `quadRemeshGeometry` voxelise -> 4-sided quads -> weld -> smooth (slice 164); (2) FIELD-ALIGNED quad remesh (slice 177, ZBrush ZRemesher / Instant Meshes) — `remesh/fieldAlignedQuad.js` estimates the principal-curvature cross-field (real fundamental forms -> shape operator -> eigen-directions), RoSy-smooths it, and traces a field-following streamline net so quad edges FLOW with curvature (diagonal-wave surface -> ~45deg flow, cylinder -> hoop/axial; alignment ~1.0). "ZRemesh" ribbon + visible quad wireframe + `__studioFieldQuadRemesh`. Honest scope: parametric (disk-topology) surfaces; singularity-aware integer-grid extraction on arbitrary genus is the remaining frontier |
| Polypaint (vertex paint by brush) | DONE | `paintPolyAt` — real per-vertex colour brush with radial falloff; `polypaint` brush mode + colour picker (slice 161) |
| Stamp / stencil / alpha brushes | DONE | `stamp` brush mode — procedural alpha (concentric rings) drives a patterned relief, not a uniform dome (slice 163). Custom alpha-image stencils are the next extension |
| Subtools / subtool hierarchy | ABSENT | flat primitive stack |

## Houdini (procedural)

| Capability | Status | Notes / next |
|------------|--------|--------------|
| Procedural node graph (geometry nodes / SOP DAG) | DONE | real geometry node graph (nodegraph/): DAG eval engine + visual editor (draggable nodes, SVG wires, click-to-connect, params, Evaluate->Scene). Nodes: primitive/transform/subdivide/bevel/displace/array/merge/output (slice 152). Material/shader graph (slice 165) + Blueprint exec-flow graph (slice 168) both reuse this framework, generalized to a node-type registry |
| VEX-like expressions | ABSENT | — |
| Scatter / distribute points | PARTIAL | `geometryNodesDistributePoints` + foliage instancing |
| Cell fracture / explode | DONE | `MOD_explode` cell fracture |
| Rigid body dynamics (RBD) | DONE | real rigid-body solver (slice 166) — semi-implicit Euler, 3D momentum + gravity, sphere-proxy pairwise collision with impulse resolution + positional correction (bodies stack/settle, no interpenetration), mass-by-volume, ground + contact friction. Drives the VFX/Sim "Drop" tool; `__studioPhysicsStep`/`__studioPhysicsState` (also Unreal Chaos / Unity PhysX / Blender Rigid Body World). Sphere-proxy collision is the honest scope (not full convex) |
| Volume / VDB | ABSENT | — |

## Maya

| Capability | Status | Notes / next |
|------------|--------|--------------|
| NURBS surfaces/curves | DONE | rational degree-3 tensor-product NURBS SURFACE (slice 153) + rational degree-3 NURBS CURVE (slice 179, `nurbs/nurbsCurve.js` — Cox-de Boor, clamped knots interpolate endpoints, control-point weights warp the curve; "NURBS Crv" ribbon + `__studioAddNurbsCurve`) + TRIMMED surfaces (slice 178). Only solid sewn trimmed-B-rep booleans remain (need a B-rep kernel; mesh CSG already covers solids) |
| Deformer stack / node editor | DONE | non-destructive modifier stack (slice 154) + the geometry node editor (slice 152) |
| MASH / instancing | PARTIAL | Array modifier + foliage instancing |
| Rigging (joints / IK / constraints / skinning) | PARTIAL | armature + IK + constraints shipped (see GAME_ENGINE map) |
| Timeline / Sequencer (keyframe track editor) | DONE | native monotone Sequencer dock (slice 167, Unreal Sequencer / Unity Timeline / Blender Dope Sheet) — frame ruler, draggable playhead/scrubber, transport, one track per animated object with keyframe diamonds; wired to the keyframe engine which now interpolates position + rotation + SCALE with linear/bezier/constant easing. Replaces the inherited blue display-only TimelineEditor |

## 3ds Max

| Capability | Status | Notes / next |
|------------|--------|--------------|
| Modifier stack (non-destructive, reorderable) | DONE | real live stack re-evaluated from a clean base every edit (reuses the node engine); add/remove/reorder/toggle; removing a mid-stack modifier truly reverts it (slice 154) |
| Spline → Loft / sweep along path | DONE | Loft/Sweep (slice 170, 3ds Max Loft / Rhino Sweep1) — sweeps an arbitrary polygonal profile (square/L/star/n-gon) along a path curve (helix/arc/S-curve/closed ring) via Frenet frames into a swept surface; "Loft/Sweep" primitive + `__studioSweepLoft`. (Path drives a built-in curve set; sweep along a user-drawn curve is the next step.) |
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
| PBR texture painting on UVs | DONE | full PBR channel set — paint colour / roughness / metalness / emissive / HEIGHT, each its own CanvasTexture wired to the matching MeshStandardMaterial map; channel selector + colour picker + `texpaint` brush mode (slices 156, 160). Height paints a bumpMap; a Sobel "Height -> Normal" bake derives a tangent-space normalMap (slice 169) — completes the Substance channel set |
| Map baking (AO/normal/position) | PARTIAL | `bakeOp` bakes to vertex colours. AO is now a REAL hemisphere ray-traced bake (slice 171, Unreal Lightmass / Unity Progressive Lightmapper) — inter-object occlusion + contact + self-occlusion darken, not the old curvature proxy. Normals/position are visualisation bakes. (Baking to texture maps, not vertex colours, is the remaining step.) |

## Rhino

| Capability | Status | Notes / next |
|------------|--------|--------------|
| NURBS curves / surfaces | DONE | NURBS surface (slice 153) + NURBS CURVE (slice 179, rational degree-3 Cox-de Boor) + TRIMMED surfaces (slice 178, `surf/trimmedSurface.js` — uv-loop trimmed B-rep FACE; "Trim Surf" ribbon). Only solid sewn trimmed-B-rep booleans still need a B-rep kernel (OCCT, removed by de-CAD); mesh CSG booleans already cover solid combination |
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
