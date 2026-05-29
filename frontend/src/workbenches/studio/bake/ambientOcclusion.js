import * as THREE from 'three';

/*
 * Ray-traced ambient-occlusion bake (Unreal Lightmass / Unity Progressive
 * Lightmapper / Blender bake AO). For every vertex, cast a deterministic
 * Fibonacci hemisphere of rays oriented to the vertex normal and test occlusion
 * against the scene's other geometry (and the mesh itself). The unoccluded
 * fraction becomes a per-vertex AO factor baked into vertex colours — so
 * crevices, contact points and self-occluded cavities darken, exactly like a
 * real GI/lightmap bake. Deterministic (golden-angle spiral, no Math.random).
 */
export function bakeAmbientOcclusion(mesh, occluders, opts = {}) {
  const geo = mesh.geometry;
  if (!geo || !geo.attributes.position) return null;
  const pos = geo.attributes.position;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  const rays = opts.rays || 32;
  const floor = opts.floor != null ? opts.floor : 0.2;
  const strength = opts.strength != null ? opts.strength : 1.1;
  const maxDist = opts.maxDist || (geo.boundingSphere.radius * 1.6);

  mesh.updateMatrixWorld(true);
  // Occluders must be at their CURRENT world transforms (callers may have just
  // repositioned them without a render tick) or rays test stale positions.
  occluders.forEach((o) => { if (o.updateMatrixWorld) o.updateMatrixWorld(true); });
  const nMat = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);

  // Golden-angle spiral hemisphere base directions (about +Y).
  const base = [];
  for (let i = 0; i < rays; i++) {
    const y = (i + 0.5) / rays;               // 0..1 -> upper hemisphere
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * 2.399963229728653;        // golden angle
    base.push(new THREE.Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r));
  }

  const rc = new THREE.Raycaster(); rc.far = maxDist;
  const vWorld = new THREE.Vector3(), nWorld = new THREE.Vector3(), dir = new THREE.Vector3(), origin = new THREE.Vector3();
  const tangent = new THREE.Vector3(), bitangent = new THREE.Vector3(), up = new THREE.Vector3();
  const colors = new Float32Array(pos.count * 3);
  let mn = 1, mx = 0, sum = 0;

  for (let i = 0; i < pos.count; i++) {
    vWorld.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
    nWorld.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).applyMatrix3(nMat).normalize();
    up.set(0, 1, 0); if (Math.abs(nWorld.y) > 0.99) up.set(1, 0, 0);
    tangent.crossVectors(up, nWorld).normalize();
    bitangent.crossVectors(nWorld, tangent);
    origin.copy(vWorld).addScaledVector(nWorld, maxDist * 0.01);

    let occ = 0;
    for (const b of base) {
      dir.set(0, 0, 0).addScaledVector(tangent, b.x).addScaledVector(nWorld, b.y).addScaledVector(bitangent, b.z).normalize();
      rc.set(origin, dir); rc.far = maxDist;
      const hits = rc.intersectObjects(occluders, false);
      for (const h of hits) { if (h.distance > maxDist * 0.02) { occ++; break; } }
    }
    const ao = Math.max(floor, 1 - (occ / base.length) * strength);
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = ao;
    if (ao < mn) mn = ao; if (ao > mx) mx = ao; sum += ao;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (mesh.material) {
    if (mesh.material.color) mesh.material.color.set('#ffffff'); // let AO drive shade
    mesh.material.vertexColors = true;
    mesh.material.needsUpdate = true;
  }
  return { min: mn, max: mx, mean: sum / pos.count, vertices: pos.count, rays: base.length };
}
