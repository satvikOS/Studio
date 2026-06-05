// ArchDisc Studio V3 — position-based dynamics soft body.
//
// Real PBD on any indexed THREE.Mesh geometry. The algorithm follows
// Müller et al. "Position Based Dynamics" (VRIPHYS 2006):
//
//   1) Apply external forces (gravity here) → predicted velocity.
//   2) Predict positions x' = x + v·dt.
//   3) Project edge-length constraints iteratively against x'.
//   4) Clamp predicted positions against the ground plane (y ≥ 0)
//      with simple friction.
//   5) v = (x' - x) / dt, x = x'.
//
// Constraint set: every unique edge of every triangle. The rest-length
// of each edge is snapshotted from the geometry the first time
// `attach()` is called for that mesh. Subsequent calls (re-attach) keep
// the same rest lengths.
//
// Particles are derived from geometry.attributes.position; we do NOT
// duplicate vertex positions — we mutate the buffer in place and call
// .needsUpdate / .computeVertexNormals() per step.
//
// Storage on mesh.userData.archdiscStudioSoftBody:
//   { positions, velocities, predicted, invMass, edges (Uint32Array
//     pairs), restLengths (Float32Array), stiffness, gravity,
//     iterations, ground }

import * as THREE from 'three';

const SOFT_TAG = 'archdiscStudioSoftBody';

function getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function findMesh(uuid) {
  const scene = getScene();
  if (!scene) return null;
  let m = null;
  scene.traverse((o) => {
    if (m) return;
    if (o.uuid === uuid && o.isMesh) m = o;
  });
  return m;
}

function allSoftBodies() {
  const scene = getScene();
  if (!scene) return [];
  const out = [];
  scene.traverse((o) => {
    if (o.isMesh && o.userData && o.userData[SOFT_TAG]) out.push(o);
  });
  return out;
}

// Extract the unique-edge list from an indexed (or non-indexed) BufferGeometry.
function buildEdgeList(geom) {
  const pos = geom.attributes.position;
  const idx = geom.index;
  const seen = new Set();
  const edges = [];
  const push = (a, b) => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const key = lo * 1e9 + hi;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(lo, hi);
  };
  if (idx) {
    const arr = idx.array;
    for (let i = 0; i < arr.length; i += 3) {
      push(arr[i], arr[i + 1]);
      push(arr[i + 1], arr[i + 2]);
      push(arr[i + 2], arr[i]);
    }
  } else {
    const n = pos.count;
    for (let i = 0; i < n; i += 3) {
      push(i, i + 1);
      push(i + 1, i + 2);
      push(i + 2, i);
    }
  }
  return new Uint32Array(edges);
}

export function softBodyAttach(meshUuid, opts) {
  const mesh = findMesh(meshUuid);
  if (!mesh) return { ok: false, error: 'no mesh' };
  if (!mesh.geometry || !mesh.geometry.attributes || !mesh.geometry.attributes.position) {
    return { ok: false, error: 'no geometry' };
  }
  if (mesh.userData && mesh.userData[SOFT_TAG]) {
    return { ok: true, alreadyAttached: true, uuid: mesh.uuid };
  }

  const o = opts || {};
  // Bake the mesh's world transform into the geometry so the simulation
  // operates in world space — otherwise translating/rotating the mesh
  // would silently invalidate the rest lengths.
  mesh.updateMatrixWorld(true);
  if (!mesh.matrixWorld.equals(new THREE.Matrix4())) {
    mesh.geometry = mesh.geometry.clone();
    mesh.geometry.applyMatrix4(mesh.matrixWorld);
    mesh.position.set(0, 0, 0);
    mesh.quaternion.set(0, 0, 0, 1);
    mesh.scale.set(1, 1, 1);
    mesh.updateMatrixWorld(true);
  }

  const pos = mesh.geometry.attributes.position;
  const N = pos.count;
  const positions   = new Float32Array(N * 3);
  const velocities  = new Float32Array(N * 3);
  const predicted   = new Float32Array(N * 3);
  const initial     = new Float32Array(N * 3);
  const invMass     = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    positions[i * 3]     = pos.getX(i);
    positions[i * 3 + 1] = pos.getY(i);
    positions[i * 3 + 2] = pos.getZ(i);
    initial[i * 3]     = positions[i * 3];
    initial[i * 3 + 1] = positions[i * 3 + 1];
    initial[i * 3 + 2] = positions[i * 3 + 2];
    invMass[i] = 1.0;
  }

  const edges = buildEdgeList(mesh.geometry);
  const edgeCount = edges.length / 2;
  const restLengths = new Float32Array(edgeCount);
  for (let e = 0; e < edgeCount; e++) {
    const a = edges[e * 2], b = edges[e * 2 + 1];
    const dx = positions[a * 3]     - positions[b * 3];
    const dy = positions[a * 3 + 1] - positions[b * 3 + 1];
    const dz = positions[a * 3 + 2] - positions[b * 3 + 2];
    restLengths[e] = Math.hypot(dx, dy, dz);
  }

  // Pin any vertices the caller asks for (infinite mass).
  if (Array.isArray(o.pinned)) {
    for (const i of o.pinned) {
      if (Number.isFinite(i) && i >= 0 && i < N) invMass[i] = 0;
    }
  }

  mesh.userData[SOFT_TAG] = {
    positions,
    velocities,
    predicted,
    initial,
    invMass,
    edges,
    restLengths,
    edgeCount,
    count: N,
    gravity: Array.isArray(o.gravity) ? o.gravity.slice() : [0, -9.81, 0],
    stiffness: Number(o.stiffness) != null ? Math.max(0, Math.min(1, Number(o.stiffness))) : 0.8,
    iterations: Math.max(1, Math.min(20, Math.floor(Number(o.iterations) || 4))),
    damping: Number(o.damping) || 0.01,
    ground: o.ground !== false,
    groundY: Number(o.groundY) || 0,
    groundFriction: Number(o.groundFriction) != null ? Number(o.groundFriction) : 0.4,
    bounce: Number(o.bounce) != null ? Number(o.bounce) : 0.2,
  };
  return { ok: true, uuid: mesh.uuid, count: N, edges: edgeCount };
}

export function softBodyDetach(meshUuid) {
  const mesh = findMesh(meshUuid);
  if (!mesh) return { ok: false, error: 'no mesh' };
  const sb = mesh.userData && mesh.userData[SOFT_TAG];
  if (!sb) return { ok: false, error: 'not attached' };
  // Optionally snap back to rest.
  for (let i = 0; i < sb.count; i++) {
    mesh.geometry.attributes.position.setXYZ(i, sb.initial[i * 3], sb.initial[i * 3 + 1], sb.initial[i * 3 + 2]);
  }
  mesh.geometry.attributes.position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  delete mesh.userData[SOFT_TAG];
  return { ok: true };
}

export function softBodyStep(dt) {
  const step = Math.max(1e-4, Math.min(0.05, Number(dt) || 0.016));
  const bodies = allSoftBodies();
  if (!bodies.length) return { ok: false, error: 'no bodies' };
  for (const m of bodies) stepOne(m, step);
  return { ok: true, count: bodies.length, dt: step };
}

function stepOne(mesh, dt) {
  const sb = mesh.userData[SOFT_TAG];
  if (!sb) return;
  const {
    positions, velocities, predicted, invMass, edges, restLengths,
    edgeCount, count, gravity, stiffness, iterations, damping,
    ground, groundY, groundFriction, bounce,
  } = sb;

  // 1+2: integrate velocity with gravity, predict new positions.
  const dampFactor = 1.0 - Math.max(0, Math.min(0.99, damping));
  for (let i = 0; i < count; i++) {
    if (invMass[i] === 0) {
      predicted[i * 3]     = positions[i * 3];
      predicted[i * 3 + 1] = positions[i * 3 + 1];
      predicted[i * 3 + 2] = positions[i * 3 + 2];
      continue;
    }
    velocities[i * 3]     = (velocities[i * 3]     + gravity[0] * dt) * dampFactor;
    velocities[i * 3 + 1] = (velocities[i * 3 + 1] + gravity[1] * dt) * dampFactor;
    velocities[i * 3 + 2] = (velocities[i * 3 + 2] + gravity[2] * dt) * dampFactor;
    predicted[i * 3]     = positions[i * 3]     + velocities[i * 3]     * dt;
    predicted[i * 3 + 1] = positions[i * 3 + 1] + velocities[i * 3 + 1] * dt;
    predicted[i * 3 + 2] = positions[i * 3 + 2] + velocities[i * 3 + 2] * dt;
  }

  // 3: project edge-length constraints. Iterations × Jacobi-style
  // sweep. Each pass nudges both endpoints by their inverse-mass-weighted
  // share of the violation.
  const k = stiffness;
  for (let it = 0; it < iterations; it++) {
    for (let e = 0; e < edgeCount; e++) {
      const a = edges[e * 2], b = edges[e * 2 + 1];
      const wa = invMass[a], wb = invMass[b];
      const wSum = wa + wb;
      if (wSum === 0) continue;
      const dx = predicted[a * 3]     - predicted[b * 3];
      const dy = predicted[a * 3 + 1] - predicted[b * 3 + 1];
      const dz = predicted[a * 3 + 2] - predicted[b * 3 + 2];
      const L = Math.hypot(dx, dy, dz);
      if (L < 1e-8) continue;
      const C = (L - restLengths[e]) / L;
      const sa = (wa / wSum) * C * k;
      const sb_ = (wb / wSum) * C * k;
      predicted[a * 3]     -= dx * sa;
      predicted[a * 3 + 1] -= dy * sa;
      predicted[a * 3 + 2] -= dz * sa;
      predicted[b * 3]     += dx * sb_;
      predicted[b * 3 + 1] += dy * sb_;
      predicted[b * 3 + 2] += dz * sb_;
    }
  }

  // 4: ground plane collision response — clamp y and apply friction
  // tangentially. Done on the predicted positions so step-5 captures
  // the correct post-collision velocity automatically.
  if (ground) {
    const fric = 1.0 - Math.max(0, Math.min(1, groundFriction));
    for (let i = 0; i < count; i++) {
      if (invMass[i] === 0) continue;
      if (predicted[i * 3 + 1] < groundY) {
        const penet = groundY - predicted[i * 3 + 1];
        predicted[i * 3 + 1] = groundY;
        // Reflect downward velocity with restitution + damp horizontal.
        // Velocity hasn't been re-derived yet — encode here by adjusting
        // predicted so the (predicted-pos)/dt yields the right v.
        const vx = (predicted[i * 3]     - positions[i * 3])     / dt;
        const vy = (predicted[i * 3 + 1] - positions[i * 3 + 1]) / dt;
        const vz = (predicted[i * 3 + 2] - positions[i * 3 + 2]) / dt;
        let nvx = vx * fric;
        let nvy = vy < 0 ? -vy * bounce : vy;
        let nvz = vz * fric;
        predicted[i * 3]     = positions[i * 3]     + nvx * dt;
        predicted[i * 3 + 1] = positions[i * 3 + 1] + nvy * dt + penet;
        predicted[i * 3 + 2] = positions[i * 3 + 2] + nvz * dt;
      }
    }
  }

  // 5: derive new velocity from position delta, commit new position.
  const pos = mesh.geometry.attributes.position;
  for (let i = 0; i < count; i++) {
    if (invMass[i] === 0) continue;
    velocities[i * 3]     = (predicted[i * 3]     - positions[i * 3])     / dt;
    velocities[i * 3 + 1] = (predicted[i * 3 + 1] - positions[i * 3 + 1]) / dt;
    velocities[i * 3 + 2] = (predicted[i * 3 + 2] - positions[i * 3 + 2]) / dt;
    positions[i * 3]     = predicted[i * 3];
    positions[i * 3 + 1] = predicted[i * 3 + 1];
    positions[i * 3 + 2] = predicted[i * 3 + 2];
    pos.setXYZ(i, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingSphere();
}

export function softBodyList() {
  return {
    ok: true,
    bodies: allSoftBodies().map((m) => ({
      uuid: m.uuid,
      name: m.name,
      count: m.userData[SOFT_TAG].count,
      edges: m.userData[SOFT_TAG].edgeCount,
    })),
  };
}

export function softBodyReset(meshUuid) {
  const mesh = findMesh(meshUuid);
  if (!mesh) return { ok: false, error: 'no mesh' };
  const sb = mesh.userData && mesh.userData[SOFT_TAG];
  if (!sb) return { ok: false, error: 'not attached' };
  for (let i = 0; i < sb.count; i++) {
    sb.positions[i * 3]     = sb.initial[i * 3];
    sb.positions[i * 3 + 1] = sb.initial[i * 3 + 1];
    sb.positions[i * 3 + 2] = sb.initial[i * 3 + 2];
    sb.velocities[i * 3] = 0; sb.velocities[i * 3 + 1] = 0; sb.velocities[i * 3 + 2] = 0;
    mesh.geometry.attributes.position.setXYZ(i, sb.initial[i * 3], sb.initial[i * 3 + 1], sb.initial[i * 3 + 2]);
  }
  mesh.geometry.attributes.position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  return { ok: true };
}

export function softBodyResetAll() {
  for (const m of allSoftBodies()) softBodyReset(m.uuid);
  return { ok: true };
}
