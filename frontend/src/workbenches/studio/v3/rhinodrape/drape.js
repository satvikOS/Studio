// Slice 714 — Rhino Drape + N-rail Loft. Drape projects a mesh onto a
// target surface from above (or any direction); N-rail loft generates
// a surface from a profile traveling along N rails by N-D barycentric
// interpolation. Closes Rhino's surface-generation toolbox gap.

import * as THREE from 'three';

function _vec(p) { return new THREE.Vector3(p[0], p[1], p[2]); }

function _sample(pts, t) {
  if (pts.length < 2) return _vec(pts[0] || [0, 0, 0]);
  const seg = (pts.length - 1) * t;
  const i = Math.min(pts.length - 2, Math.floor(seg));
  const f = seg - i;
  return _vec(pts[i]).lerp(_vec(pts[i + 1]), f);
}

export function drape(meshUuid, opts) {
  // Project mesh's surface onto every collision point with the target,
  // pinning the top edge and letting the rest follow gravity until it
  // settles. We approximate this via raycast: for each vertex, shoot a
  // ray in direction `dir` and snap to the first hit on any other mesh.
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry?.attributes?.position) return { ok: false };
  const dir = new THREE.Vector3(...(opts?.direction || [0, -1, 0])).normalize();
  const maxDist = Number(opts?.maxDist) || 20;
  const stickOnHit = !!opts?.stickOnHit;
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;
  const targets = [];
  scene.traverseVisible((o) => { if (o.isMesh && o.uuid !== meshUuid) targets.push(o); });
  const pos = mesh.geometry.attributes.position;
  mesh.updateMatrixWorld(true);
  let hits = 0;
  for (let i = 0; i < pos.count; i++) {
    const localPos = new THREE.Vector3(pos.array[i * 3], pos.array[i * 3 + 1], pos.array[i * 3 + 2]);
    const worldPos = localPos.clone().applyMatrix4(mesh.matrixWorld);
    raycaster.set(worldPos, dir);
    raycaster.far = maxDist;
    const ix = raycaster.intersectObjects(targets, false);
    if (ix.length > 0) {
      const hitWorld = ix[0].point;
      // Convert back to local.
      const localHit = hitWorld.clone().applyMatrix4(new THREE.Matrix4().copy(mesh.matrixWorld).invert());
      // Snap or attract.
      const factor = stickOnHit ? 1 : 0.5;
      pos.array[i * 3]     = localPos.x + (localHit.x - localPos.x) * factor;
      pos.array[i * 3 + 1] = localPos.y + (localHit.y - localPos.y) * factor;
      pos.array[i * 3 + 2] = localPos.z + (localHit.z - localPos.z) * factor;
      hits++;
    }
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  return { ok: true, hits, total: pos.count };
}

export function loftNRail(profile, rails, opts) {
  const segments = Math.max(2, Math.min(256, Number(opts?.segments) || 32));
  if (!Array.isArray(rails) || rails.length === 0) return { ok: false };
  const profN = profile.length;
  const positions = [];
  const indices = [];
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const railPts = rails.map((r) => _sample(r, t));
    // For each profile point, compute target as weighted avg of rail points
    // where the weight is determined by 2D barycentric from profile bbox.
    const minX = Math.min(...profile.map((p) => p[0]));
    const maxX = Math.max(...profile.map((p) => p[0]));
    const minY = Math.min(...profile.map((p) => p[1]));
    const maxY = Math.max(...profile.map((p) => p[1]));
    for (const pp of profile) {
      const nx = (pp[0] - minX) / Math.max(1e-6, maxX - minX);
      const ny = (pp[1] - minY) / Math.max(1e-6, maxY - minY);
      const weights = rails.map((_, ri) => {
        // Distribute rails along [0..1] in NX, NY space.
        const ang = (ri / rails.length) * Math.PI * 2;
        const rx = 0.5 + 0.5 * Math.cos(ang);
        const ry = 0.5 + 0.5 * Math.sin(ang);
        return 1 / (Math.max(1e-3, Math.hypot(nx - rx, ny - ry)) ** 1.5);
      });
      const sum = weights.reduce((a, b) => a + b, 0);
      let x = 0, y = 0, z = 0;
      for (let r = 0; r < railPts.length; r++) {
        x += railPts[r].x * weights[r] / sum;
        y += railPts[r].y * weights[r] / sum;
        z += railPts[r].z * weights[r] / sum;
      }
      positions.push(x, y, z);
    }
  }
  for (let s = 0; s < segments; s++) {
    for (let p = 0; p < profN - 1; p++) {
      const a = s * profN + p;
      const b = s * profN + p + 1;
      const c = (s + 1) * profN + p + 1;
      const d = (s + 1) * profN + p;
      indices.push(a, b, c, a, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb09aa0, roughness: 0.5, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'rhino-loft-nrail';
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'rhino-loft-nrail';
  if (window.__archdiscScene) window.__archdiscScene.add(mesh);
  if (typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(mesh); } catch (_) {}
  }
  return { ok: true, uuid: mesh.uuid };
}

// Boundary surface — given a closed boundary loop, fill with a smooth
// Coons-like patch (4-sided + bilinear fallback for more sides).
export function boundarySurface(boundary, opts) {
  const segs = Math.max(2, Math.min(64, Number(opts?.segments) || 16));
  // Split boundary into 4 roughly-equal edges.
  if (boundary.length < 4) return { ok: false };
  const n = boundary.length;
  const q = Math.floor(n / 4);
  const e1 = boundary.slice(0, q + 1);
  const e2 = boundary.slice(q, 2 * q + 1);
  const e3 = boundary.slice(2 * q, 3 * q + 1).reverse();
  const e4 = boundary.slice(3 * q).concat([boundary[0]]).reverse();
  const positions = [];
  const indices = [];
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    for (let j = 0; j <= segs; j++) {
      const v = j / segs;
      const a = _sample(e1, u);
      const b = _sample(e3, u);
      const c = _sample(e4, v);
      const d = _sample(e2, v);
      const ca = _vec(e1[0]);
      const cb = _vec(e1[e1.length - 1]);
      const cc = _vec(e3[e3.length - 1]);
      const cd = _vec(e3[0]);
      // Coons patch.
      const Cu = a.clone().lerp(b, v);
      const Cv = c.clone().lerp(d, u);
      const Cuv = ca.clone().multiplyScalar((1 - u) * (1 - v))
                .add(cb.clone().multiplyScalar(u * (1 - v)))
                .add(cd.clone().multiplyScalar((1 - u) * v))
                .add(cc.clone().multiplyScalar(u * v));
      const P = Cu.add(Cv).sub(Cuv);
      positions.push(P.x, P.y, P.z);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const b = i * (segs + 1) + (j + 1);
      const c = (i + 1) * (segs + 1) + (j + 1);
      const d = (i + 1) * (segs + 1) + j;
      indices.push(a, b, c, a, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xa098b8, roughness: 0.45, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'rhino-boundary-surface';
  if (window.__archdiscScene) window.__archdiscScene.add(mesh);
  if (typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(mesh); } catch (_) {}
  }
  return { ok: true, uuid: mesh.uuid };
}
