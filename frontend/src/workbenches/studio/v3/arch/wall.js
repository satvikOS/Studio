// ArchDisc Studio V3 — SketchUp-style architectural walls.
//
// A wall is a vertical extruded rectangle between two world-space
// points on the XZ ground plane. The rectangle has a centerline
// running from p1 to p2 and a fixed thickness perpendicular to that
// centerline in the XZ plane. The wall extrudes upward along +Y from
// y=0 to y=height.
//
// We return a THREE.Mesh whose geometry is a BoxGeometry rotated +
// translated into place so the lower edge sits on the ground. Using
// BoxGeometry (rather than ExtrudeGeometry over a Shape) keeps the
// vertex topology simple and watertight — important because door /
// window cuts rely on manifold-3d CSG against the wall, which prefers
// a clean closed brep.
//
// Wall meshes carry userData markers so downstream tooling can find
// them:
//   userData.archdiscStudioPrimitive       = true
//   userData.archdiscStudioPrimitiveKind   = 'arch-wall'
//   userData.archdiscStudioArchWall        = { p1, p2, height, thickness }
//
// Pure native THREE; no extra deps.

import * as THREE from 'three';

/**
 * Create a wall between two world-space points.
 *
 * @param {[number, number, number] | THREE.Vector3} p1 — world point on XZ plane (Y typically 0)
 * @param {[number, number, number] | THREE.Vector3} p2 — world point on XZ plane
 * @param {number} height — wall height along +Y in metres (default 2.7)
 * @param {number} thickness — wall thickness along the in-plane normal in metres (default 0.2)
 * @returns {THREE.Mesh}
 */
export function createWall(p1, p2, height, thickness) {
  const h = (typeof height === 'number' && isFinite(height) && height > 0) ? height : 2.7;
  const th = (typeof thickness === 'number' && isFinite(thickness) && thickness > 0) ? thickness : 0.2;

  const a = _toVec3(p1);
  const b = _toVec3(p2);
  // We flatten to the XZ plane: the wall always sits on the ground
  // regardless of the y coordinate the caller passes. Architects pass
  // floor plans in 2D, then the wall extrudes upward.
  a.y = 0;
  b.y = 0;
  const span = b.clone().sub(a);
  const len = span.length();
  if (len < 1e-6) throw new Error('createWall: zero-length wall (p1 == p2)');

  // BoxGeometry parameters: width=len (along local X), height=h (along
  // local Y, which becomes world Y), depth=th (along local Z).
  // We place its origin at (len/2, h/2, 0) — i.e. the centre — then
  // translate it so the lower-back-left corner sits at the origin of
  // the wall's local frame, then rotate + translate the whole mesh
  // into world space.
  const geo = new THREE.BoxGeometry(len, h, th);
  // Shift so the wall's local origin is at the *start* of the centerline
  // on the ground (midline of the bottom edge of the wall):
  geo.translate(len * 0.5, h * 0.5, 0);

  const mat = new THREE.MeshStandardMaterial({
    color: 0xd9d2c5,
    roughness: 0.78,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'arch-wall';

  // Orient the wall: its local +X axis must align with span (XZ-plane).
  mesh.position.copy(a);
  const angle = Math.atan2(span.x, span.z);
  // BoxGeometry's local X must rotate toward the world vector (span).
  // Rotating around +Y by (PI/2 - angle) sends local +X → world span
  // direction. We can equivalently set rotation.y = (PI/2 - angle).
  mesh.rotation.y = Math.PI * 0.5 - angle;

  mesh.userData = mesh.userData || {};
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'arch-wall';
  mesh.userData.archdiscStudioArchWall = {
    p1: [a.x, a.y, a.z],
    p2: [b.x, b.y, b.z],
    height: h,
    thickness: th,
    length: len,
  };
  mesh.updateMatrixWorld(true);
  return mesh;
}

function _toVec3(p) {
  if (!p) return new THREE.Vector3();
  if (p.isVector3) return new THREE.Vector3(p.x, p.y, p.z);
  if (Array.isArray(p)) return new THREE.Vector3(p[0] || 0, p[1] || 0, p[2] || 0);
  if (typeof p === 'object') return new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0);
  return new THREE.Vector3();
}

/**
 * Compute a point along the wall centerline at fraction t ∈ [0, 1].
 * Used by door / window cuts to position the opening box.
 */
export function wallCenterAt(mesh, t) {
  const meta = mesh && mesh.userData && mesh.userData.archdiscStudioArchWall;
  if (!meta) return null;
  const a = new THREE.Vector3(meta.p1[0], meta.p1[1], meta.p1[2]);
  const b = new THREE.Vector3(meta.p2[0], meta.p2[1], meta.p2[2]);
  const f = Math.min(1, Math.max(0, Number(t) || 0));
  return new THREE.Vector3().lerpVectors(a, b, f);
}

/**
 * Return the unit direction along the wall centerline.
 */
export function wallDirection(mesh) {
  const meta = mesh && mesh.userData && mesh.userData.archdiscStudioArchWall;
  if (!meta) return new THREE.Vector3(1, 0, 0);
  const a = new THREE.Vector3(meta.p1[0], meta.p1[1], meta.p1[2]);
  const b = new THREE.Vector3(meta.p2[0], meta.p2[1], meta.p2[2]);
  return b.clone().sub(a).normalize();
}

/**
 * Return the unit in-plane normal of the wall (horizontal, perpendicular
 * to the centerline). Used to size the cutter box's depth axis.
 */
export function wallNormal(mesh) {
  const dir = wallDirection(mesh);
  // Rotate 90° about Y. (dx, 0, dz) → (dz, 0, -dx) gives the perpendicular
  // in the XZ plane.
  return new THREE.Vector3(dir.z, 0, -dir.x).normalize();
}
