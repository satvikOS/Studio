// ArchDisc Studio V3 — SVG path import → extruded mesh.
//
// `importSvgString(svgText, extrudeDepth, bevelSize)` returns a single
// THREE.Mesh built from every `<path>` (and rect/polygon/etc.) in the
// SVG, merged into one BufferGeometry. The mesh inherits the SVG
// outline shape; depth controls how thick the extrusion is on +Z;
// bevelSize controls the bevel on both ends. Pass 0 to either to
// disable that feature.
//
// Implementation notes
// ────────────────────
// • Uses three/examples/jsm/loaders/SVGLoader (bundled — no new dep).
// • SVG's y-axis points DOWN; three.js's y points UP. We pre-flip
//   the loaded shape by scaling Y by -1 inside the geometry, then
//   re-center the mesh on the origin so callers don't have to.
// • All paths share one MeshStandardMaterial. Per-path fill colour
//   is preserved in mesh.userData.archdiscStudioVectorPaths[i].fill
//   for inspection but isn't applied (single-material merge keeps
//   the draw-call count low and matches how Illustrator imports
//   "Flatten Artwork").
// • Each extruded shape becomes a sub-Mesh; we wrap them all in a
//   THREE.Group so downstream picking + transforms behave as one
//   logical object. The returned uuid is the group's uuid.

import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

function getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function attachAndSelect(obj) {
  const s = getScene();
  if (!s) return false;
  s.add(obj);
  if (typeof window !== 'undefined' && typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(obj); } catch (_) {}
  }
  return true;
}

// Centre a Group on its combined bounding box. Returns the centring
// offset for diagnostics.
function centreGroup(group) {
  const box = new THREE.Box3();
  group.traverse((o) => {
    if (o.isMesh && o.geometry) {
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone();
      b.applyMatrix4(o.matrixWorld);
      box.union(b);
    }
  });
  if (!box.isEmpty()) {
    const c = new THREE.Vector3();
    box.getCenter(c);
    group.position.sub(c);
    group.updateMatrixWorld(true);
    return [c.x, c.y, c.z];
  }
  return [0, 0, 0];
}

export function importSvgString(svgText, extrudeDepth, bevelSize) {
  if (typeof svgText !== 'string' || !svgText.length) {
    return { ok: false, error: 'empty svg' };
  }
  const scene = getScene();
  if (!scene) return { ok: false, error: 'no scene' };

  const depth = Math.max(0, Number(extrudeDepth) || 0);
  const bevel = Math.max(0, Number(bevelSize) || 0);

  let data;
  try {
    const loader = new SVGLoader();
    data = loader.parse(svgText);
  } catch (e) {
    return { ok: false, error: 'svg parse failed: ' + (e && e.message ? e.message : String(e)) };
  }
  if (!data || !Array.isArray(data.paths) || data.paths.length === 0) {
    return { ok: false, error: 'no paths in svg' };
  }

  const group = new THREE.Group();
  group.name = 'studio-vector-svg';
  group.userData.archdiscStudioPrimitive = true;
  group.userData.archdiscStudioPrimitiveKind = 'svg';
  group.userData.pickable = true;

  // Track per-path metadata for round-trip introspection.
  const pathMeta = [];
  let shapeCount = 0;

  // Shared material — Illustrator-flatten semantics.
  const material = new THREE.MeshStandardMaterial({
    color: 0xeeeeee,
    side: THREE.DoubleSide,
    roughness: 0.55,
    metalness: 0.05,
    flatShading: false,
  });

  for (let pi = 0; pi < data.paths.length; pi++) {
    const path = data.paths[pi];
    const fill = (path.userData && path.userData.style && path.userData.style.fill) || null;
    const shapes = SVGLoader.createShapes(path);
    pathMeta.push({
      fill: fill || '#eeeeee',
      shapes: shapes.length,
    });
    for (const shape of shapes) {
      let geo;
      if (depth > 0) {
        geo = new THREE.ExtrudeGeometry(shape, {
          depth,
          bevelEnabled: bevel > 0,
          bevelSize: bevel,
          bevelThickness: bevel,
          bevelSegments: bevel > 0 ? 2 : 0,
          curveSegments: 12,
          steps: 1,
        });
      } else {
        geo = new THREE.ShapeGeometry(shape);
      }
      // Flip SVG y-down → three.js y-up.
      geo.scale(1, -1, 1);
      const m = new THREE.Mesh(geo, material);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.archdiscStudioVectorPathIndex = pi;
      m.userData.archdiscStudioVectorFill = fill || null;
      group.add(m);
      shapeCount++;
    }
  }

  if (shapeCount === 0) {
    return { ok: false, error: 'no fillable shapes in svg' };
  }

  group.userData.archdiscStudioVectorPaths = pathMeta;
  group.userData.archdiscStudioVectorDepth = depth;
  group.userData.archdiscStudioVectorBevel = bevel;

  attachAndSelect(group);
  // Centre once the group is in the scene so world matrices resolve.
  const offset = centreGroup(group);

  return {
    ok: true,
    uuid: group.uuid,
    paths: data.paths.length,
    shapes: shapeCount,
    depth,
    bevel,
    centreOffset: offset,
  };
}
