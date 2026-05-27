# ArchDisc Studio

**The 3D content-creation workstation in the ArchDisc Universe.**

ArchDisc Studio is a desktop application for 3D modelling, sculpting, rigging,
animation, VFX, simulation, texture work, rendering, and real-time game-asset
authoring — all driven by the same AI plug-and-play orchestration model as
the rest of the ArchDisc family. From an empty viewport to a fully rendered,
publishable output, the user steers entirely through prompts and the AI's
follow-up MCQs.

## Scope

Studio targets parity (and beyond) with the workflows of Blender, Maya,
3ds Max, Cinema 4D, Houdini, ZBrush, Substance Painter / Designer, Mari,
Plasticity / MoI, SketchUp, Rhino / Grasshopper, Unreal Engine, KeyShot,
MagicaVoxel, and Cascadeur — all integrated into a single AI-driven
authoring surface.

Coverage areas:

- **Modelling** — polygon, hard-surface, NURBS, voxel, subdivision
- **Sculpting** — multi-million-poly digital clay, retopology, tablet workflow
- **Rigging & animation** — advanced character rigs, keyframe, physics-based,
  AI-assisted pose, automated center-of-mass balancing
- **Texturing** — layer-based, PBR, procedural, UDIM, projection painting
- **VFX & simulation** — node-based procedural, smoke / fire, fluids,
  large-scale destruction, complex physics
- **Rendering** — real-time PBR, photoreal product viz, Nanite-scale
  geometry streaming, Lumen-style cinematic lighting
- **Motion graphics** — broadcast typography, procedural cloning, dynamic
  text effects
- **Architectural visualization** — ArchViz, floor-plan extrusion, schematic
- **Game-asset pipelines** — AAA workflows, voxel / low-poly stylized,
  drag-and-drop product visualization

## Relationship to the rest of ArchDisc

Studio is an **independent** workstation. It has no runtime, build, or
deployment relationship with `archdisc-Mech` (the mechanical-CAD
workstation). Pushes here build and release Studio installers only;
nothing here touches the Mech repo or its installer channel.

## License

GPL-3.0-or-later. Studio vendors and extends Blender (also GPL-3); see
`NOTICE.md` for attribution and the source distribution policy.

## Status

Newly bootstrapped (2026-05-26) from the ArchDisc shell. Foundational
Mech-era CAD modules are still present and will be displaced as Studio's
own content-creation features land.
