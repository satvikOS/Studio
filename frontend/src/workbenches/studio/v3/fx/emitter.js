// ArchDisc Studio V3 — mesh-vertex particle emitter.
//
// Slice 632 ships __studioCreateParticleSystem which seeds particles in
// a disc of `radius`. Blender's particle stack also supports "Emit from
// → Verts" — every particle spawns at a source-mesh vertex (world
// space). emitFromMesh(meshUuid, count) builds the same userData
// schema as slice 632 so:
//
//   • the existing __studioParticleStep gravity integration drives it,
//   • our fx augment tick (forces + colliders) applies to it,
//   • __studioListParticleSystems lists it.
//
// Sampling strategy:
//   • If count ≤ vertex count: deterministic round-robin over the first
//     `count` verts so two emitters from the same mesh land identically.
//   • If count > vertex count: cycle through every vertex `count/N`
//     times with a tiny jitter so particles don't perfectly overlap
//     (which would freeze the visual mass into a single moving cluster).
//
// Returned uuid is the THREE.Points node uuid — the user removes it via
// scene.remove() / __studioFXEmitDelete (or __studioParticleSystems
// trimming).

import * as THREE from 'three';

function _getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function _findMesh(uuid) {
  const scene = _getScene();
  if (!scene) return null;
  let m = null;
  scene.traverse((o) => {
    if (m) return;
    if (o.uuid === uuid && (o.isMesh || o.isPoints)) m = o;
  });
  return m;
}

// emitFromMesh — spawn `count` particles starting at the source mesh's
// vertex positions. Drop-in slice-632 schema.
export function emitFromMesh(meshUuid, count, opts) {
  const scene = _getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  const src = _findMesh(meshUuid);
  if (!src) return { ok: false, error: 'mesh not in scene' };
  if (!src.geometry || !src.geometry.attributes || !src.geometry.attributes.position) {
    return { ok: false, error: 'mesh has no position attribute' };
  }
  const n = Math.max(1, Math.min(50000, Math.floor(Number(count) || 1000)));
  const o = opts || {};
  const positions = new Float32Array(n * 3);
  const colors    = new Float32Array(n * 3);
  const vels      = new Float32Array(n * 3);
  const life      = new Float32Array(n);
  const max       = new Float32Array(n);

  const c1 = new THREE.Color(o.color1 != null ? o.color1 : 0xff8844);
  const c2 = new THREE.Color(o.color2 != null ? o.color2 : 0x66ccff);

  src.updateMatrixWorld(true);
  const m4 = src.matrixWorld;
  const srcPos = src.geometry.attributes.position;
  const V = srcPos.count;
  const v = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    const vi = (V > 0) ? (i % V) : 0;
    v.fromBufferAttribute(srcPos, vi);
    v.applyMatrix4(m4);
    // Tiny jitter only when re-sampling the same vertex.
    const jit = (i >= V) ? 0.01 : 0;
    positions[i * 3]     = v.x + (Math.random() - 0.5) * jit;
    positions[i * 3 + 1] = v.y + (Math.random() - 0.5) * jit;
    positions[i * 3 + 2] = v.z + (Math.random() - 0.5) * jit;
    vels[i * 3]     = (Math.random() - 0.5) * 0.4;
    vels[i * 3 + 1] = Math.random() * 1.2 + 0.4;
    vels[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
    max[i] = 0.8 + Math.random() * 1.4;
    life[i] = Math.random() * max[i];
    const t = life[i] / max[i];
    colors[i * 3]     = c1.r * (1 - t) + c2.r * t;
    colors[i * 3 + 1] = c1.g * (1 - t) + c2.g * t;
    colors[i * 3 + 2] = c1.b * (1 - t) + c2.b * t;
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: o.size || 0.04,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const pts = new THREE.Points(g, mat);
  // Match slice-632 userData schema so __studioParticleStep operates on
  // us, and tag with fx provenance for diagnostics.
  pts.userData.archdiscStudioParticles = {
    vels, life, max, count: n, c1, c2,
    gravity: o.gravity != null ? o.gravity : -1.2,
  };
  pts.userData.archdiscStudioFXEmitter = {
    source: meshUuid,
    count: n,
  };
  pts.name = o.name || `fx-emit-${(src.name || 'mesh')}`;
  scene.add(pts);

  if (typeof window !== 'undefined') {
    if (!window.__studioParticleSystems) window.__studioParticleSystems = [];
    window.__studioParticleSystems.push(pts);
  }
  if (typeof window !== 'undefined' && window.__studioToast) {
    window.__studioToast(`FX emitter ×${n} from ${src.name || 'mesh'}`, 'ok');
  }
  return { ok: true, uuid: pts.uuid, count: n, source: meshUuid, verts: V };
}

export function emitterRemove(uuid) {
  const scene = _getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  const obj = scene.getObjectByProperty('uuid', uuid);
  if (!obj || !obj.userData || !obj.userData.archdiscStudioFXEmitter) {
    return { ok: false, error: 'not an fx emitter' };
  }
  if (obj.parent) obj.parent.remove(obj);
  if (obj.geometry && typeof obj.geometry.dispose === 'function') obj.geometry.dispose();
  if (obj.material && typeof obj.material.dispose === 'function') obj.material.dispose();
  if (typeof window !== 'undefined' && Array.isArray(window.__studioParticleSystems)) {
    const i = window.__studioParticleSystems.indexOf(obj);
    if (i >= 0) window.__studioParticleSystems.splice(i, 1);
  }
  return { ok: true, removed: uuid };
}

export function emitterList() {
  const scene = _getScene();
  if (!scene) return { ok: true, emitters: [] };
  const out = [];
  scene.traverse((o) => {
    if (o.userData && o.userData.archdiscStudioFXEmitter) {
      out.push({
        uuid: o.uuid,
        name: o.name || '(unnamed)',
        source: o.userData.archdiscStudioFXEmitter.source,
        count: o.userData.archdiscStudioFXEmitter.count,
      });
    }
  });
  return { ok: true, emitters: out };
}
