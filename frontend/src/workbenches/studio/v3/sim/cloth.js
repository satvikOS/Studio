// ArchDisc Studio V3 — mass-spring cloth simulation.
//
// Real cloth on a subdivided PlaneGeometry. Every vertex of the
// (segs+1) × (segs+1) grid is a point-mass; every grid edge is a
// structural spring (rest length = initial edge length). Shear springs
// are added on grid diagonals so the cloth doesn't collapse to a line
// under shear. Bending stiffness is approximated by long-range "flex"
// springs spanning two grid steps along each axis.
//
// Integration: semi-implicit (symplectic) Euler — first accumulate
// forces, advance velocity by force·dt/mass, then advance position by
// new-velocity·dt. Per Provot (1995), spring forces are followed by
// a single Jacobi-style constraint relaxation pass that clamps each
// edge's stretch to ≤10% of rest length; that's what keeps real-world
// cloth from exploding at the spring stiffness levels you actually
// want.
//
// Geometry: the simulated PlaneGeometry is created face-up (rotated
// −π/2 about X) and centred on the origin. The mesh's position
// attribute is written-into in place each step, then
// .position.needsUpdate = true. Normals are recomputed every step so
// shading reflects the deformed shape.
//
// Pinning: pinned vertex indices keep their initial world-space
// position regardless of forces (mass treated as infinite). The
// pinning is per-vertex-index (matches PlaneGeometry vertex ordering:
// row-major from -x,-z to +x,+z after the rotation).
//
// All public functions take a clothUuid so multiple cloths can
// co-exist. State is stashed on mesh.userData.archdiscStudioCloth.

import * as THREE from 'three';

const CLOTH_TAG = 'archdiscStudioCloth';

function getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function findCloth(uuid) {
  const scene = getScene();
  if (!scene) return null;
  let m = null;
  scene.traverse((o) => {
    if (m) return;
    if (o.uuid === uuid && o.userData && o.userData[CLOTH_TAG]) m = o;
  });
  return m;
}

function allCloths() {
  const scene = getScene();
  if (!scene) return [];
  const out = [];
  scene.traverse((o) => { if (o.userData && o.userData[CLOTH_TAG]) out.push(o); });
  return out;
}

// Module-level wind vector applied uniformly to every cloth. Wind acts
// as a body force on each vertex proportional to (wind · normal).
const _wind = new THREE.Vector3(0, 0, 0);

// ─── Construction ────────────────────────────────────────────────────────
// width/height in world units, segs = subdivisions per side.
// Total vertex count = (segs+1)².
export function clothCreate(width, height, segs, opts) {
  const scene = getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  const w = Math.max(0.05, Number(width) || 2);
  const h = Math.max(0.05, Number(height) || 2);
  const s = Math.max(2, Math.min(64, Math.floor(Number(segs) || 16)));
  const o = opts || {};

  const geom = new THREE.PlaneGeometry(w, h, s, s);
  // Lay flat in XZ so gravity (-Y) is meaningful and the wind blowing
  // along +Z deforms the visible surface.
  geom.rotateX(-Math.PI / 2);
  const mat = o.material || new THREE.MeshStandardMaterial({
    color: o.color != null ? o.color : 0xaa3344,
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.DoubleSide,
    flatShading: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (Array.isArray(o.position)) {
    mesh.position.set(o.position[0] || 0, o.position[1] || 0, o.position[2] || 0);
  } else {
    mesh.position.set(0, Number(o.height0) || 2.5, 0);
  }
  mesh.name = o.name || `cloth-${(allCloths().length + 1)}`;

  // Pre-bake the spring list. Vertex (i,j) → index i*(s+1)+j where
  // i indexes the X-axis (segs+1 columns), j indexes Z (segs+1 rows).
  const pos = geom.attributes.position;
  const N = pos.count;
  const verts = new Float32Array(N * 3);
  const vels = new Float32Array(N * 3);
  const forces = new Float32Array(N * 3);
  for (let k = 0; k < N; k++) {
    verts[k * 3]     = pos.getX(k);
    verts[k * 3 + 1] = pos.getY(k);
    verts[k * 3 + 2] = pos.getZ(k);
  }
  const initial = new Float32Array(verts);

  const springs = [];
  const pushSpring = (a, b, kind) => {
    const dx = verts[a * 3]     - verts[b * 3];
    const dy = verts[a * 3 + 1] - verts[b * 3 + 1];
    const dz = verts[a * 3 + 2] - verts[b * 3 + 2];
    const rest = Math.hypot(dx, dy, dz);
    if (rest > 0) springs.push({ a, b, rest, kind });
  };
  const idx = (i, j) => i * (s + 1) + j;
  for (let i = 0; i <= s; i++) {
    for (let j = 0; j <= s; j++) {
      // Structural (axis-aligned grid edges).
      if (i < s) pushSpring(idx(i, j), idx(i + 1, j), 'struct');
      if (j < s) pushSpring(idx(i, j), idx(i, j + 1), 'struct');
      // Shear (cell diagonals).
      if (i < s && j < s) {
        pushSpring(idx(i, j), idx(i + 1, j + 1), 'shear');
        pushSpring(idx(i + 1, j), idx(i, j + 1), 'shear');
      }
      // Flex / bending — long-range axis-aligned springs spanning 2
      // cells. Cheap stand-in for proper bending energy.
      if (i < s - 1) pushSpring(idx(i, j), idx(i + 2, j), 'flex');
      if (j < s - 1) pushSpring(idx(i, j), idx(i, j + 2), 'flex');
    }
  }

  const pinned = new Uint8Array(N);
  // Default: pin the two top corners (j == s row's first + last vertex
  // in the original PlaneGeometry ordering after the -π/2 X rotation).
  if (o.defaultPin !== false) {
    pinned[idx(0, 0)] = 1;
    pinned[idx(s, 0)] = 1;
  }

  mesh.userData = {
    ...mesh.userData,
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: 'cloth',
    pickable: true,
    [CLOTH_TAG]: {
      width: w,
      height: h,
      segs: s,
      mass: Number(o.mass) || 1.0,          // per-vertex mass (kg)
      kStruct: Number(o.kStruct) || 600,
      kShear:  Number(o.kShear)  || 250,
      kFlex:   Number(o.kFlex)   || 80,
      damping: Number(o.damping) || 0.05,   // velocity damping per step
      gravity: Array.isArray(o.gravity) ? o.gravity.slice() : [0, -9.81, 0],
      verts, vels, forces, initial,
      springs,
      pinned,
      count: N,
      // Reusable scratch vectors live on userData so step() allocates 0.
      _tmp: new Float32Array(3),
    },
  };
  scene.add(mesh);
  if (typeof window !== 'undefined' && window.__studioToast) {
    window.__studioToast(`Cloth ${s}×${s} (${N} verts)`, 'ok');
  }
  return { ok: true, uuid: mesh.uuid, count: N, springs: springs.length };
}

export function clothList() {
  return {
    ok: true,
    cloths: allCloths().map((m) => {
      const c = m.userData[CLOTH_TAG];
      return {
        uuid: m.uuid,
        name: m.name,
        count: c.count,
        segs: c.segs,
        springs: c.springs.length,
        pinned: Array.from(c.pinned).reduce((s, v) => s + v, 0),
      };
    }),
  };
}

export function clothPinVertex(uuid, idx) {
  const m = findCloth(uuid); if (!m) return { ok: false, error: 'no cloth' };
  const c = m.userData[CLOTH_TAG];
  const i = Math.floor(Number(idx));
  if (!Number.isFinite(i) || i < 0 || i >= c.count) return { ok: false, error: 'bad idx' };
  c.pinned[i] = 1;
  // Zero its velocity so it freezes immediately.
  c.vels[i * 3] = 0; c.vels[i * 3 + 1] = 0; c.vels[i * 3 + 2] = 0;
  return { ok: true, idx: i };
}

export function clothUnpinVertex(uuid, idx) {
  const m = findCloth(uuid); if (!m) return { ok: false, error: 'no cloth' };
  const c = m.userData[CLOTH_TAG];
  const i = Math.floor(Number(idx));
  if (!Number.isFinite(i) || i < 0 || i >= c.count) return { ok: false, error: 'bad idx' };
  c.pinned[i] = 0;
  return { ok: true, idx: i };
}

export function clothSetWind(vec) {
  if (Array.isArray(vec) && vec.length === 3) {
    _wind.set(Number(vec[0]) || 0, Number(vec[1]) || 0, Number(vec[2]) || 0);
  } else if (vec && typeof vec === 'object' && 'x' in vec) {
    _wind.set(Number(vec.x) || 0, Number(vec.y) || 0, Number(vec.z) || 0);
  } else {
    _wind.set(0, 0, 0);
  }
  return { ok: true, wind: [_wind.x, _wind.y, _wind.z] };
}

// ─── Integration ─────────────────────────────────────────────────────────
// Single semi-implicit Euler step at dt (seconds). Caller throttles.
export function clothStep(dt) {
  const step = Math.max(1e-4, Math.min(0.05, Number(dt) || 0.016));
  const cloths = allCloths();
  if (!cloths.length) return { ok: false, error: 'no cloths' };
  for (const m of cloths) stepOne(m, step);
  return { ok: true, count: cloths.length, dt: step };
}

function stepOne(mesh, dt) {
  const c = mesh.userData[CLOTH_TAG];
  if (!c) return;
  const { verts, vels, forces, springs, pinned, count, mass, kStruct, kShear, kFlex, damping, gravity } = c;

  // Reset accumulator + apply gravity.
  for (let i = 0; i < count; i++) {
    forces[i * 3]     = gravity[0] * mass;
    forces[i * 3 + 1] = gravity[1] * mass;
    forces[i * 3 + 2] = gravity[2] * mass;
  }

  // Spring forces (Hooke's law) with velocity-damping along the spring axis.
  for (let i = 0; i < springs.length; i++) {
    const sp = springs[i];
    const a = sp.a, b = sp.b;
    const k = sp.kind === 'struct' ? kStruct : (sp.kind === 'shear' ? kShear : kFlex);
    const dx = verts[a * 3]     - verts[b * 3];
    const dy = verts[a * 3 + 1] - verts[b * 3 + 1];
    const dz = verts[a * 3 + 2] - verts[b * 3 + 2];
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-8) continue;
    const f = k * (L - sp.rest) / L;
    const fx = f * dx, fy = f * dy, fz = f * dz;
    forces[a * 3]     -= fx;
    forces[a * 3 + 1] -= fy;
    forces[a * 3 + 2] -= fz;
    forces[b * 3]     += fx;
    forces[b * 3 + 1] += fy;
    forces[b * 3 + 2] += fz;
  }

  // Wind force: approximate as uniform body force scaled to per-vertex
  // mass. (A proper aero load would project onto each triangle normal,
  // but uniform wind is plenty for visual cloth.)
  if (_wind.x !== 0 || _wind.y !== 0 || _wind.z !== 0) {
    const wx = _wind.x * mass, wy = _wind.y * mass, wz = _wind.z * mass;
    for (let i = 0; i < count; i++) {
      forces[i * 3]     += wx;
      forces[i * 3 + 1] += wy;
      forces[i * 3 + 2] += wz;
    }
  }

  // Symplectic Euler: v += (f/m)*dt, x += v*dt. Damp velocity.
  const invM = 1.0 / Math.max(1e-6, mass);
  const damp = 1.0 - Math.max(0, Math.min(0.99, damping)) * dt * 10;
  for (let i = 0; i < count; i++) {
    if (pinned[i]) {
      vels[i * 3] = 0; vels[i * 3 + 1] = 0; vels[i * 3 + 2] = 0;
      continue;
    }
    vels[i * 3]     = (vels[i * 3]     + forces[i * 3]     * invM * dt) * damp;
    vels[i * 3 + 1] = (vels[i * 3 + 1] + forces[i * 3 + 1] * invM * dt) * damp;
    vels[i * 3 + 2] = (vels[i * 3 + 2] + forces[i * 3 + 2] * invM * dt) * damp;
    verts[i * 3]     += vels[i * 3]     * dt;
    verts[i * 3 + 1] += vels[i * 3 + 1] * dt;
    verts[i * 3 + 2] += vels[i * 3 + 2] * dt;
  }

  // Provot stretch limiter — single Jacobi pass over structural springs
  // clamping any edge stretched > 10 % above rest. This is what keeps
  // semi-implicit Euler stable at high kStruct.
  const MAX_STRETCH = 1.10;
  for (let i = 0; i < springs.length; i++) {
    const sp = springs[i];
    if (sp.kind !== 'struct') continue;
    const a = sp.a, b = sp.b;
    const dx = verts[a * 3]     - verts[b * 3];
    const dy = verts[a * 3 + 1] - verts[b * 3 + 1];
    const dz = verts[a * 3 + 2] - verts[b * 3 + 2];
    const L = Math.hypot(dx, dy, dz);
    const limit = sp.rest * MAX_STRETCH;
    if (L <= limit || L < 1e-8) continue;
    const excess = (L - limit) / L;
    const cx = dx * excess, cy = dy * excess, cz = dz * excess;
    const pa = pinned[a], pb = pinned[b];
    if (pa && pb) continue;
    if (pa) {
      verts[b * 3]     += cx;
      verts[b * 3 + 1] += cy;
      verts[b * 3 + 2] += cz;
    } else if (pb) {
      verts[a * 3]     -= cx;
      verts[a * 3 + 1] -= cy;
      verts[a * 3 + 2] -= cz;
    } else {
      verts[a * 3]     -= cx * 0.5;
      verts[a * 3 + 1] -= cy * 0.5;
      verts[a * 3 + 2] -= cz * 0.5;
      verts[b * 3]     += cx * 0.5;
      verts[b * 3 + 1] += cy * 0.5;
      verts[b * 3 + 2] += cz * 0.5;
    }
  }

  // Write back to the geometry's position attribute.
  const pos = mesh.geometry.attributes.position;
  for (let i = 0; i < count; i++) {
    pos.setXYZ(i, verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingSphere();
}

export function clothReset(uuid) {
  const m = findCloth(uuid); if (!m) return { ok: false, error: 'no cloth' };
  const c = m.userData[CLOTH_TAG];
  for (let i = 0; i < c.count; i++) {
    c.verts[i * 3]     = c.initial[i * 3];
    c.verts[i * 3 + 1] = c.initial[i * 3 + 1];
    c.verts[i * 3 + 2] = c.initial[i * 3 + 2];
    c.vels[i * 3] = 0; c.vels[i * 3 + 1] = 0; c.vels[i * 3 + 2] = 0;
  }
  const pos = m.geometry.attributes.position;
  for (let i = 0; i < c.count; i++) pos.setXYZ(i, c.verts[i * 3], c.verts[i * 3 + 1], c.verts[i * 3 + 2]);
  pos.needsUpdate = true;
  m.geometry.computeVertexNormals();
  return { ok: true };
}

export function clothResetAll() {
  for (const m of allCloths()) clothReset(m.uuid);
  return { ok: true };
}

export function clothRemove(uuid) {
  const m = findCloth(uuid); if (!m) return { ok: false, error: 'no cloth' };
  if (m.parent) m.parent.remove(m);
  if (m.geometry && typeof m.geometry.dispose === 'function') m.geometry.dispose();
  if (m.material && typeof m.material.dispose === 'function') m.material.dispose();
  return { ok: true };
}
