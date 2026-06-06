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
| Sculpt layers (multi-res levels) | DONE | TWO systems: (1) sculpt LAYERS — `sculpt/layers.js` per-vertex delta layers with live strength + visibility + active + merge-down + recomposite (the composited result = base + Σ layer.delta × strength × visible). (2) MULTI-RESOLUTION levels (slice 733, ZBrush SubDiv/HD Geometry, Mudbox subdivision levels, Blender Multires) — `subdiv/multires.js`: a level stack where subdivideUp() Loop-subdivides the top level into a finer one, setLevel(L) rebuilds from the base re-adding each level's stored per-vertex DETAIL displacement, and bake() captures a sculpt into the active level (base edits at L0, detail = current − subdivision-prediction at L>0). Stepping DOWN to edit low-frequency form and back UP PRESERVES the high-frequency detail. Detail is stored in TANGENT SPACE (slice 735 — coefficients along the smooth surface's normal/tangent/bitangent) so it RIDES the surface when a lower level rotates or deforms (e2e: a bump sculpted at L2 still points along the surface normal after the base is rotated 90°, dot≈1.0). `__studioMultires*` ops in global search; headed e2e proves a bump sculpted at L2 survives a L0→L2 round-trip (dx=0.012).
| DynaMesh (uniform reskin) | DONE | `dynaMeshGeometry` — voxelise (ray-crossing point-in-mesh) -> watertight cuberille -> weld -> Laplacian smooth; uniform-topology reskin (slice 155) |
| ZRemesher (quad retopology) | DONE | TWO modes: (1) UNIFORM quad remesh of any mesh — `quadRemeshGeometry` voxelise -> 4-sided quads -> weld -> smooth (slice 164); (2) FIELD-ALIGNED quad remesh (slice 177, ZBrush ZRemesher / Instant Meshes) — `remesh/fieldAlignedQuad.js` estimates the principal-curvature cross-field (real fundamental forms -> shape operator -> eigen-directions), RoSy-smooths it, and traces a field-following streamline net so quad edges FLOW with curvature (diagonal-wave surface -> ~45deg flow, cylinder -> hoop/axial; alignment ~1.0). "ZRemesh" ribbon + visible quad wireframe + `__studioFieldQuadRemesh`. Honest scope: parametric (disk-topology) surfaces; singularity-aware integer-grid extraction on arbitrary genus is the remaining frontier |
| Polypaint (vertex paint by brush) | DONE | `paintPolyAt` — real per-vertex colour brush with radial falloff; `polypaint` brush mode + colour picker (slice 161) |
| Stamp / stencil / alpha brushes | DONE | `stamp` brush mode — procedural alpha (concentric rings) drives a patterned relief, not a uniform dome (slice 163). Custom alpha-image stencils are the next extension |
| UV Master (one-click unwrap) | DONE | slice 734 — REAL LSCM (Least Squares Conformal Maps, Lévy et al. 2002 — the unwrap Blender/Maya/Headus use). `zuvmaster/lscm.js`: assembles the per-triangle Cauchy-Riemann conformal equations in each triangle's local 2D frame, pins the two farthest-apart vertices to fix the similarity gauge, and solves the over-determined sparse system in the least-squares sense via matrix-free conjugate-gradient on the normal equations (dependency-free). `unwrapAll` now runs LSCM as the primary method (spherical projection only as degenerate fallback); `__studioZUVMasterDistortion` reports mean angle distortion. Headed e2e: a tilted plane unwraps at 0.00001° angle distortion vs 54° for the old spherical projection; cylinder 0.00002°. Honest scope: single-chart (no auto-seam-cutting yet). |
| Subtools / subtool hierarchy | DONE | slice 732 — ZBrush SubTool manager: an ordered list of independent sculptable meshes (each a scene primitive) with one ACTIVE subtool + a SOLO flag. Ops: list / setActive / rename / setVisible / solo (hide the rest) / append (new primitive) / duplicate (geometry+transform) / delete / move (reorder) / merge-down (collapse into the one below) / merge-visible (all visible → one mesh via mergeGeometries with world transforms baked). Auto-syncs to the live scene so meshes spawned by other tools appear as subtools, and active-subtool selection drives `__studioSelectMesh` so sculpt/edit ops target it. `__studioSubtool*` ops in global search; Inspector shows active subtool kind/verts/tris/mass. Headed e2e: append 3 → solo → duplicate → reorder → merge-down → merge-visible → single mesh (3084 tris). (ZBrush SubTools / Mudbox layers / Nomad subtools.) |

## Houdini (procedural)

| Capability | Status | Notes / next |
|------------|--------|--------------|
| Procedural node graph (geometry nodes / SOP DAG) | DONE | real geometry node graph (nodegraph/): DAG eval engine + visual editor (draggable nodes, SVG wires, click-to-connect, params, Evaluate->Scene). Nodes: primitive/transform/subdivide/bevel/displace/array/merge/output (slice 152). Material/shader graph (slice 165) + Blueprint exec-flow graph (slice 168) both reuse this framework, generalized to a node-type registry |
| VEX-like expressions | ABSENT | — |
| Scatter / distribute points | PARTIAL | `geometryNodesDistributePoints` + foliage instancing |
| Cell fracture / explode | DONE | `MOD_explode` cell fracture |
| Rigid body dynamics (RBD) | DONE | real rigid-body solver (slice 166) — semi-implicit Euler, 3D momentum + gravity, sphere-proxy pairwise collision with impulse resolution + positional correction (bodies stack/settle, no interpenetration), mass-by-volume, ground + contact friction. Drives the VFX/Sim "Drop" tool; `__studioPhysicsStep`/`__studioPhysicsState` (also Unreal Chaos / Unity PhysX / Blender Rigid Body World). Sphere-proxy collision is the honest scope (not full convex) |
| Volume / VDB | PARTIAL | slices 730–731 — Eulerian GAS + FIRE SIMULATION (Houdini Pyro FX / Blender Mantaflow / FumeFX / EmberGen): Stam stable-fluids solver on the slice-698 volume grid (`volume/pyro.js`) — semi-Lagrangian advect + Gauss-Seidel pressure-projection + buoyancy + vorticity confinement + dissipation/cooling (slice 730). Slice 731 adds COMBUSTION: a fuel field that ignites above an ignition temperature, releasing heat (fire) + soot (smoke density) + a volumetric expansion (divergence source feeding the projection) and is consumed; pilot-lit fuel jets self-sustain. The reaction-rate 'flame' field writes to the texture B channel and the raymarch shader emits an incandescent red→orange→yellow→white fire ramp. `__studioPyro*` ops + one-shot `__studioPyroIgnite` (smoke) / `__studioPyroCampfire` (fire). Headed e2e: plume rises (730); combustion self-ignites from a pilot light, produces smoke from fuel alone, fire exceeds ignition temp, flame written to texture (731). Honest scope: container-bounded single-grid solver; sparse VDB tiles are the next frontier |

## Maya

| Capability | Status | Notes / next |
|------------|--------|--------------|
| NURBS surfaces/curves | DONE | rational degree-3 tensor-product NURBS SURFACE (slice 153) + rational degree-3 NURBS CURVE (slice 179) + TRIMMED surfaces (slice 178) + SOLID SEWN B-REP BOOLEANS (slice 181, `brep/occtBoolean.js` — real OCCT kernel via opencascade.js, LAZY dynamic import so the main bundle stays small; cut/fuse/common produce exact NURBS-trimmed solids; the box-minus-cylinder cut yields the correct 7-face topology (6 box faces + 1 cylindrical inner wall)). "B-rep Bool" ribbon + `__studioBRepBoolean` |
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
| NURBS curves / surfaces | DONE | NURBS surface (slice 153) + NURBS CURVE (slice 179) + TRIMMED surfaces (slice 178) + SOLID SEWN B-REP BOOLEANS (slice 181, OCCT via opencascade.js, lazy-loaded). The exact-solid-modelling stack is complete |
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
