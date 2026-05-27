# ArchDisc Studio ↔ Blender Kernel Map

Every Studio operation that has a Blender counterpart is cataloged below
with its source path in the vendored `blender/` tree. This is the
"spread Blender across Studio's UI" map — when a user picks a Studio
tool, the algorithm + UI behaviour comes from (or matches) the Blender
source path cited here.

The vendored Blender tree is a shallow clone of `blender/main` (latest
HEAD as of bootstrap). License: GPL-3.0-or-later (Studio inherits).

## Primitives — `blender/tests/files/io_tests/x3d/`

Studio loads three vendored X3D test fixtures verbatim:

| Studio primitive | Blender X3D source                                           | Verts | Triangles |
|------------------|--------------------------------------------------------------|-------|-----------|
| Suzanne          | `tests/files/io_tests/x3d/suzanne_material.x3d`              | 507   | 968       |
| Teapot           | `tests/files/io_tests/x3d/teapot.x3d`                        | 257   | 512       |
| CAD Cube         | `tests/files/io_tests/x3d/color_cube.x3d`                    | 8     | 12        |

The generators are `tools/import_suzanne.py` and
`tools/import_teapot_and_colorcube.js`. They parse the X3D
`coordIndex` / `point` attributes, fan-triangulate polygons, centre +
scale to a target mm extent, then emit static Float32Array /
Uint16Array JS modules consumed by `WorkbenchStudio.jsx`.

## Modifiers — `blender/source/blender/modifiers/intern/MOD_*.cc`

| Studio modifier              | Blender source                          | Status        |
|------------------------------|------------------------------------------|---------------|
| Subdivide (midpoint)          | `MOD_subsurf.cc` (catmull / simple)     | shipped (S21) |
| Loop Subdivide (smooth)       | `MOD_subsurf.cc` + Loop scheme          | shipped (S65) |
| Decimate (vertex clustering)  | `MOD_decimate.cc`                       | shipped (S49) |
| Array (linear + radial)       | `MOD_array.cc`                          | shipped (S54) |
| Mirror                        | `MOD_mirror.cc`                         | shipped (early)|
| Cell Fracture                 | `MOD_explode.cc`                        | shipped (S52) |
| Boolean Union / Diff / Inter  | `MOD_boolean.cc` (uses manifold-3d)     | shipped (early)|
| Displace · Noise              | `MOD_displace.cc`                       | shipped (S50) |
| Smooth (Laplacian)            | `MOD_laplaciansmooth.cc`                | shipped (sculpt) |
| Solidify                      | `MOD_solidify.cc`                       | shipped (S73) |
| Cast → Sphere / Cuboid        | `MOD_cast.cc`                           | shipped (S73) |
| Wave                          | `MOD_wave.cc`                           | shipped (S73) |
| Simple Deform · Bend          | `MOD_simpledeform.cc` (BEND)            | shipped (S74) |
| Simple Deform · Taper         | `MOD_simpledeform.cc` (TAPER)           | shipped (S74) |
| Simple Deform · Twist         | `MOD_simpledeform.cc` (TWIST)           | shipped (S79) |
| Simple Deform · Stretch       | `MOD_simpledeform.cc` (STRETCH)         | shipped (S80) |
| Edge Split                    | `MOD_edgesplit.cc`                      | shipped (S79) |
| Inset Faces                   | `editmesh_inset.cc` (edit-mesh op)      | shipped (S80) |
| Warp                          | `MOD_warp.cc`                           | shipped (S81) |
| Normal Edit (Radial)          | `MOD_normal_edit.cc`                    | shipped (S81) |
| Weld                          | `MOD_weld.cc`                           | shipped (S75) |
| Wireframe                     | `MOD_wireframe.cc`                      | shipped (S76) |
| Build (progressive reveal)    | `MOD_build.cc`                          | shipped (S77) |
| Skin (ball-and-stick)         | `MOD_skin.cc`                           | shipped (S78) |
| Bevel                         | `MOD_bevel.cc`                          | shipped (S82) |
| Corrective Smooth             | `MOD_correctivesmooth.cc`               | shipped (S82) |
| Curve                         | `MOD_curve.cc`                          | shipped (S82) |
| Hook                          | `MOD_hook.cc`                           | shipped (S82) |
| Lattice                       | `MOD_lattice.cc`                        | shipped (S82) |
| Mesh Deform                   | `MOD_meshdeform.cc`                     | shipped (S82) |
| Multires                      | `MOD_multires.cc`                       | shipped (S82) |
| Ocean                         | `MOD_ocean.cc`                          | shipped (S82) |
| Remesh (voxel)                | `MOD_remesh.cc`                         | shipped (S82) |
| Screw                         | `MOD_screw.cc`                          | shipped (S82) |
| Shrinkwrap                    | `MOD_shrinkwrap.cc`                     | shipped (S82) |
| Subdivision Surface (Catmull) | `MOD_subsurf.cc` (Catmull-Clark)        | shipped (S82) |
| Weighted Normal               | `MOD_weighted_normal.cc`                | shipped (S82) |
| Mask                          | `MOD_mask.cc`                           | shipped (S82) |
| UV Warp                       | `MOD_uvwarp.cc`                         | shipped (S82) |
| Laplacian Deform              | `MOD_laplaciandeform.cc`                | shipped (S82) |
| Armature                      | `MOD_armature.cc`                       | shipped (early) |
| Cloth                         | `MOD_cloth.cc`                          | shipped (S55) |
| Hair / Fur                    | `MOD_particleinstance.cc` + particles   | shipped (S51) |
| Particles                     | `BKE_particle.h` + `particle_system.cc` | shipped (early) |

### Pending (Blender-specific, deferred)

| Modifier                     | Blender source                          | Note                                        |
|------------------------------|------------------------------------------|---------------------------------------------|
| Mesh Cache                   | `MOD_meshcache.cc`                      | requires external `.mdd` / `.pc2` file       |
| Surface (collision-only)     | `MOD_surface.cc`                        | defines collision target for other mods      |
| Dynamic Paint                | `MOD_dynamicpaint.cc`                   | complex paint system (textures + verts)      |
| Fluid                        | `MOD_fluid.cc`                          | needs OpenVDB grid + Mantaflow integration   |
| Line Art                     | `MOD_lineart.cc`                        | post-process silhouette extraction           |
| Volume → Mesh / Mesh → Volume| `MOD_volume_*.cc`                       | OpenVDB-backed volume conversion             |
| Grease Pencil (~25 modifiers)| `MOD_grease_pencil_*.cc`                | requires GP stroke data model                |

## Kernel modules — `blender/source/blender/blenkernel/`

| Studio feature        | Blender BKE header                                |
|-----------------------|----------------------------------------------------|
| Mesh editing          | `BKE_mesh.hh`                                      |
| Geometry node graph   | `BKE_geometry_set.hh`, `BKE_node.hh`               |
| Action / animation    | `BKE_action.hh`                                    |
| Animation system      | `BKE_anim_data.hh`, `BKE_animsys.h`                |
| Path animation        | `BKE_anim_path.h`                                  |
| Armature              | `BKE_armature.hh`                                  |
| Curve                 | `BKE_curve.hh`                                     |
| Sculpt                | `BKE_sculpt.hh`                                    |
| Material library      | `BKE_material.hh`                                  |
| Texture / UV mapping  | `BKE_texture.h`, `BKE_uvedit.hh`                   |
| Render                | `BKE_render.hh`                                    |
| Cloth                 | `BKE_cloth.hh`                                     |
| Fluid sim             | `BKE_fluid.h`                                      |
| Particle system       | `BKE_particle.h`                                   |
| Deformation           | `BKE_deform.hh`                                    |

## Sculpting — `blender/source/blender/editors/sculpt_paint/`

| Studio brush         | Blender source                                     |
|----------------------|----------------------------------------------------|
| Inflate (full-mesh)  | `sculpt_inflate.cc`                                |
| Twist (full-mesh)    | `sculpt_paint_image.cc` (custom port)              |
| Smooth (Laplacian)   | `sculpt_smooth.cc`                                 |
| Click-paint Push     | `sculpt_brush_types.cc` (DRAW brush)               |
| Click-paint Pull     | `sculpt_brush_types.cc` (INFLATE brush, negative)  |
| Click-paint Smooth   | `sculpt_smooth.cc`                                 |

## Animation — `blender/source/blender/blenkernel/`

| Studio feature       | Blender source                                     |
|----------------------|----------------------------------------------------|
| Keyframes            | `BKE_action.hh`, `keyframing.cc`                   |
| Timeline scrub       | `BKE_anim_data.hh`                                 |
| Linear interpolation | `BKE_curve.hh` (FCurve linear handle)              |
| Motion path display  | `BKE_anim_visualization.h`                         |

## Render — `blender/source/blender/render/`

| Studio feature       | Blender source                                     |
|----------------------|----------------------------------------------------|
| Frame render         | `render/intern/pipeline.cc`                        |
| Showreel             | (Studio composes 4 frame renders, no direct port)  |
| 3-Point Lighting     | (Studio preset; references `BKE_studiolight.h`)    |
| glTF export          | `addons_core/io_scene_gltf2/` (Blender add-on)     |

## Caveat

This map is **traceability for the design**, not literal C-to-JS code
translation. Blender's kernel runs in compiled C/C++ inside Blender's
runtime; Studio runs in JS inside Electron. Studio's implementations
mirror Blender's algorithms + UX semantics so a Blender user can pick
up Studio and feel at home.
