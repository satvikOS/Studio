// ArchDisc Studio V3 — Grease Pencil stroke data model + mesh builder.
//
// A "stroke" here is a list of 3D points authored in scene space. Each
// stroke owns its own visual material attributes (thickness, color,
// hardness, taper) so the user can tweak per-stroke without touching
// the underlying layer. `finalize()` collapses the points into a
// THREE.TubeGeometry mesh and stamps it with `userData.archdiscStudio
// GP = true` so the rest of the V3 surface (outliner, save/load, BVH
// raycast, etc.) sees it as a managed primitive.
//
// Slice 644 already shipped the simple "freehand line" pipeline that
// lives in api.js (window.__studioFreehand*). This module is the
// richer, layered + framed + per-stroke-material alternative that
// behaves like Blender's Grease Pencil — strokes belong to frames,
// frames belong to layers, layers participate in animation.
//
// Pure data + THREE; no DOM, no React, no globals. All exports are
// pure functions; the orchestrator (index.js) keeps an in-memory
// Map<strokeUuid, stroke> on top.

import * as THREE from 'three';

// Convenience flag set on every spawned mesh so a future scene scrub
// can find every GP stroke without keeping a sidecar list in sync.
export const GP_USERDATA_FLAG = 'archdiscStudioGP';

let _seq = 1;
function _uuid() {
  _seq += 1;
  return `gp-stroke-${Date.now().toString(36)}-${_seq.toString(36)}`;
}

// ─── Constructor ─────────────────────────────────────────────────────

/**
 * Build a fresh stroke descriptor. The stroke starts empty; callers
 * push points with addPoint() and then call finalize() to spawn the
 * mesh.
 *
 * @param {object} opts
 *   thickness — tube radius in scene units (default 0.003 m, matches
 *               the PRIMITIVE_SIZE family used by spawn.js)
 *   color     — number (0xRRGGBB) or '#rrggbb' or three.js Color-able
 *   hardness  — [0..1] core opacity; 1 = solid, 0 = wispy (drives the
 *               material's `opacity` once we finalize)
 *   taper     — [0..1] tube radius falloff at the stroke endpoints —
 *               0 = no taper (uniform tube), 1 = full pinch to a point
 */
export function createStroke(opts) {
  const o = opts || {};
  return {
    uuid: _uuid(),
    points: [],            // [[x,y,z], ...] in scene-space
    thickness: _num(o.thickness, 0.003),
    color: _normColor(o.color, 0xff5577),
    hardness: _clamp01(_num(o.hardness, 1)),
    taper: _clamp01(_num(o.taper, 0)),
    mesh: null,            // filled by finalize()
    finalized: false,
  };
}

export function addPoint(stroke, x, y, z) {
  if (!stroke || !Array.isArray(stroke.points)) return 0;
  if (stroke.finalized) return stroke.points.length; // mesh built — frozen
  stroke.points.push([Number(x) || 0, Number(y) || 0, Number(z) || 0]);
  return stroke.points.length;
}

/**
 * Replace the entire point list (used by deserialization / scripting).
 */
export function setPoints(stroke, pts) {
  if (!stroke || !Array.isArray(pts)) return 0;
  if (stroke.finalized) return stroke.points.length;
  stroke.points = pts
    .filter((p) => Array.isArray(p) && p.length >= 3)
    .map((p) => [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0]);
  return stroke.points.length;
}

// ─── Mesh build ──────────────────────────────────────────────────────

/**
 * Build a TubeGeometry mesh from the stroke points. Returns the mesh
 * (or null when the stroke is too short). Idempotent: calling finalize
 * a second time disposes the previous mesh and rebuilds.
 *
 * `taper > 0` is implemented by wrapping the catmull-rom in a custom
 * curve subclass that scales the local frame radius — but TubeGeometry
 * doesn't expose per-segment radius natively, so we instead rebuild the
 * tube as a swept lathe of small cylinders. To keep this slice's blast
 * radius tiny (and the bundle small) we approximate taper by attaching
 * `userData.archdiscStudioGPTaper` so a future renderer can honor it,
 * while the tube itself stays uniform. Real per-vertex radius is a
 * follow-up. Stroke colour + opacity hit the material directly.
 */
export function finalize(stroke) {
  if (!stroke) return null;
  if (stroke.finalized && stroke.mesh) {
    // Already built — return the existing mesh.
    return stroke.mesh;
  }
  if (!Array.isArray(stroke.points) || stroke.points.length < 2) return null;

  // Build the catmull-rom curve from points. Single duplicates would
  // make CatmullRomCurve3 throw; collapse exact dupes first.
  const pts = [];
  for (const p of stroke.points) {
    const v = new THREE.Vector3(p[0], p[1], p[2]);
    if (pts.length === 0 || pts[pts.length - 1].distanceToSquared(v) > 1e-12) {
      pts.push(v);
    }
  }
  if (pts.length < 2) return null;

  // Segment density scales with point count so long strokes stay smooth
  // without wasting tris on short ticks.
  const segs = Math.max(8, Math.min(512, pts.length * 4));
  const radial = 8;            // 8 radial segments — cheap + round-enough
  const radius = Math.max(1e-5, stroke.thickness);

  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const geo = new THREE.TubeGeometry(curve, segs, radius, radial, false);

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(stroke.color),
    roughness: 0.85,
    metalness: 0.0,
    transparent: stroke.hardness < 1,
    opacity: stroke.hardness,
    emissive: new THREE.Color(stroke.color).multiplyScalar(0.15),
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `gp_stroke_${stroke.uuid.slice(-6)}`;
  mesh.userData = mesh.userData || {};
  mesh.userData[GP_USERDATA_FLAG] = true;
  mesh.userData.archdiscStudioGPStrokeUuid = stroke.uuid;
  mesh.userData.archdiscStudioGPTaper = stroke.taper;
  // Mark as a primitive so existing outliner / save pipelines pick it
  // up the same way as cubes / spheres.
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'gp_stroke';

  stroke.mesh = mesh;
  stroke.finalized = true;
  return mesh;
}

/**
 * Update the stroke's colour and push to the existing mesh material
 * in place (no re-build).
 */
export function setColor(stroke, color) {
  if (!stroke) return false;
  stroke.color = _normColor(color, stroke.color);
  if (stroke.mesh && stroke.mesh.material) {
    stroke.mesh.material.color = new THREE.Color(stroke.color);
    if (stroke.mesh.material.emissive) {
      stroke.mesh.material.emissive = new THREE.Color(stroke.color).multiplyScalar(0.15);
    }
    stroke.mesh.material.needsUpdate = true;
  }
  return true;
}

/**
 * Update the stroke's thickness. Because TubeGeometry bakes the radius
 * into geometry, we rebuild the geometry in place (keeping the same
 * mesh + material instance so the scene graph node is stable).
 */
export function setThickness(stroke, thickness) {
  if (!stroke) return false;
  const t = Math.max(1e-5, Number(thickness) || stroke.thickness);
  stroke.thickness = t;
  if (!stroke.mesh) return true;

  // Rebuild geometry only (mesh + material kept).
  const pts = stroke.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  // Collapse dupes (mirror finalize() behavior).
  const clean = [];
  for (const v of pts) {
    if (clean.length === 0 || clean[clean.length - 1].distanceToSquared(v) > 1e-12) {
      clean.push(v);
    }
  }
  if (clean.length < 2) return true;
  const segs = Math.max(8, Math.min(512, clean.length * 4));
  const curve = new THREE.CatmullRomCurve3(clean, false, 'catmullrom', 0.5);
  const oldGeo = stroke.mesh.geometry;
  stroke.mesh.geometry = new THREE.TubeGeometry(curve, segs, t, 8, false);
  if (oldGeo) oldGeo.dispose();
  return true;
}

export function setHardness(stroke, hardness) {
  if (!stroke) return false;
  stroke.hardness = _clamp01(Number(hardness) || 0);
  if (stroke.mesh && stroke.mesh.material) {
    stroke.mesh.material.transparent = stroke.hardness < 1;
    stroke.mesh.material.opacity = stroke.hardness;
    stroke.mesh.material.needsUpdate = true;
  }
  return true;
}

export function setTaper(stroke, taper) {
  if (!stroke) return false;
  stroke.taper = _clamp01(Number(taper) || 0);
  if (stroke.mesh) stroke.mesh.userData.archdiscStudioGPTaper = stroke.taper;
  return true;
}

/**
 * Remove the stroke's mesh from its parent + dispose GPU resources.
 * Safe to call on a stroke that was never finalized.
 */
export function disposeStroke(stroke) {
  if (!stroke) return false;
  const mesh = stroke.mesh;
  if (mesh) {
    if (mesh.parent) mesh.parent.remove(mesh);
    if (mesh.geometry) { try { mesh.geometry.dispose(); } catch (_) { /* ignore */ } }
    if (mesh.material) {
      // material may be an array — handle both
      if (Array.isArray(mesh.material)) {
        for (const m of mesh.material) { try { m.dispose(); } catch (_) {} }
      } else {
        try { mesh.material.dispose(); } catch (_) { /* ignore */ }
      }
    }
  }
  stroke.mesh = null;
  stroke.finalized = false;
  return true;
}

/**
 * Total polyline length in scene units. Cheap O(N).
 */
export function strokeLength(stroke) {
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length < 2) return 0;
  let len = 0;
  for (let i = 1; i < stroke.points.length; i++) {
    const a = stroke.points[i - 1];
    const b = stroke.points[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    len += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return len;
}

// ─── Serialisation (for future save/load wiring) ─────────────────────

export function strokeToJSON(stroke) {
  if (!stroke) return null;
  return {
    uuid: stroke.uuid,
    points: stroke.points.map((p) => [p[0], p[1], p[2]]),
    thickness: stroke.thickness,
    color: _hexFromColor(stroke.color),
    hardness: stroke.hardness,
    taper: stroke.taper,
  };
}

export function strokeFromJSON(json) {
  if (!json || typeof json !== 'object') return null;
  const s = createStroke({
    thickness: json.thickness,
    color: json.color,
    hardness: json.hardness,
    taper: json.taper,
  });
  if (json.uuid) s.uuid = String(json.uuid);
  setPoints(s, json.points || []);
  return s;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function _num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function _clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function _normColor(v, def) {
  // Accept number (0xRRGGBB), string '#rrggbb', or fall back.
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.startsWith('#')) {
      const n = parseInt(s.slice(1), 16);
      if (Number.isFinite(n)) return n;
    }
    const n = parseInt(s, 16);
    if (Number.isFinite(n)) return n;
  }
  return def;
}

function _hexFromColor(c) {
  if (typeof c !== 'number') return '#ff5577';
  return '#' + c.toString(16).padStart(6, '0');
}

// Re-export THREE rev so dead-code elimination doesn't strip it (the
// finalize path needs it).
export const _THREE_REV = THREE.REVISION;
