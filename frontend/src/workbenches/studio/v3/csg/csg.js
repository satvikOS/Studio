// ArchDisc Studio V3 — Real watertight CSG via manifold-3d.
//
// Pure native three.js + the existing `manifold-3d` npm dep — no new
// packages, no extra WASM beyond what manifold-3d itself ships.
//
// The earlier visually-faked variants (slice-684 geomnodes Boolean and
// the slice-579 __studioBoolean wrapper) merged or shrunk inputs. This
// module does the real thing:
//   • THREE.BufferGeometry  →  Manifold.Mesh
//   • Manifold.{add | subtract | intersect}
//   • result.getMesh()      →  THREE.BufferGeometry  (normals + bounds)
//
// The WASM lives inside manifold-3d (`manifold.wasm`) and is loaded on
// the first call to `ensureManifoldModule()`. Subsequent calls reuse
// the cached module — `setup()` is a no-op after first invocation per
// the manifold-3d source.
//
// All exports are pure functions over THREE primitives; no side
// effects on `window`. The window-surface wiring lives in `./index.js`.

import * as THREE from 'three';

// ─── Singleton module loader ────────────────────────────────────────────
// Cached promise of the initialised manifold-3d Module instance. We hold
// the promise (not the resolved value) so concurrent callers all await
// the same Initialisation rather than racing on `await import(...)`.
let _manifoldPromise = null;
let _manifoldError = null;

/**
 * Lazily import manifold-3d and return the initialised Module instance.
 * The dynamic import keeps the ~3 MB WASM out of the initial bundle.
 *
 * The manifold-3d package's default export is itself the Module factory
 * (an async function). Some bundlers may double-wrap the default in an
 * additional `default` property — handle both shapes.
 */
export async function ensureManifoldModule() {
  if (_manifoldError) throw _manifoldError;
  if (_manifoldPromise) return _manifoldPromise;
  _manifoldPromise = (async () => {
    try {
      const mod = await import('manifold-3d');
      const factory = (mod && typeof mod.default === 'function') ? mod.default
        : (typeof mod === 'function' ? mod : null);
      if (!factory) throw new Error('manifold-3d: no callable factory export');
      const m = await factory();
      if (m && typeof m.setup === 'function') m.setup();
      if (!m || !m.Manifold) throw new Error('manifold-3d: Manifold class missing after setup');
      return m;
    } catch (e) {
      _manifoldError = e;
      _manifoldPromise = null;
      throw e;
    }
  })();
  return _manifoldPromise;
}

/**
 * Probe — returns { ok: true } once the WASM module is loaded and the
 * Manifold class is reachable; { ok: false, error } otherwise. Does not
 * throw — useful for UI status pings.
 */
export async function isReady() {
  try {
    const m = await ensureManifoldModule();
    return { ok: !!(m && m.Manifold), };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

// ─── Conversion helpers (THREE ↔ Manifold) ─────────────────────────────
/**
 * Bake a THREE.Mesh's world matrix into a fresh BufferGeometry and
 * collapse it to an indexed Float32Array position + Uint32Array index
 * — the exact shape Manifold's Mesh constructor expects.
 *
 * Returns an object with `{ numProp: 3, vertProperties, triVerts }` —
 * the Manifold WASM glue accepts plain object literals here.
 */
export function threeMeshToManifoldMesh(mesh) {
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes ||
      !mesh.geometry.attributes.position) {
    throw new Error('threeMeshToManifoldMesh: mesh has no position attribute');
  }
  mesh.updateMatrixWorld(true);
  const g = mesh.geometry.clone();
  g.applyMatrix4(mesh.matrixWorld);
  // Manifold needs an indexed mesh. If the source is non-indexed we
  // generate a trivial 0..N-1 index — every consecutive triple is one
  // triangle.
  if (!g.index) {
    const n = g.attributes.position.count;
    const idx = (n > 0xFFFF) ? new Uint32Array(n) : new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  // Manifold's Mesh constructor wants Float32 positions and a Uint32 index.
  const posSrc = g.attributes.position.array;
  const vertProperties = (posSrc instanceof Float32Array)
    ? new Float32Array(posSrc)
    : Float32Array.from(posSrc);
  const idxSrc = g.index.array;
  const triVerts = (idxSrc instanceof Uint32Array)
    ? new Uint32Array(idxSrc)
    : Uint32Array.from(idxSrc);
  // Drop the temporary clone we built for the matrix-bake.
  g.dispose();
  return { numProp: 3, vertProperties, triVerts };
}

/**
 * Convert a Manifold instance back into a THREE.BufferGeometry,
 * recomputing vertex normals + bounds. Caller is responsible for
 * disposing the returned geometry when no longer needed.
 */
export function manifoldToThreeGeometry(manifold) {
  if (!manifold || typeof manifold.getMesh !== 'function') {
    throw new Error('manifoldToThreeGeometry: not a Manifold instance');
  }
  const mesh = manifold.getMesh();
  const geo = new THREE.BufferGeometry();
  // Manifold's vertProperties is GL-style interleaved with numProp; the
  // first three values per vert are x/y/z. We only carry positions here
  // — the input meshes lose attribute data on the way through, but the
  // result is watertight and re-normalled.
  const numProp = mesh.numProp || 3;
  let positions;
  if (numProp === 3) {
    positions = new Float32Array(mesh.vertProperties);
  } else {
    const nv = mesh.vertProperties.length / numProp;
    positions = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      positions[i * 3 + 0] = mesh.vertProperties[i * numProp + 0];
      positions[i * 3 + 1] = mesh.vertProperties[i * numProp + 1];
      positions[i * 3 + 2] = mesh.vertProperties[i * numProp + 2];
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// ─── Core boolean ops ──────────────────────────────────────────────────
/**
 * Internal: run a single boolean op against two THREE.Mesh instances.
 * `kind` is 'union' | 'difference' | 'intersect'.
 * Returns a fresh THREE.BufferGeometry; on failure throws.
 *
 * The Manifold + Mesh handles allocated here are released via .delete()
 * so the WASM heap does not leak. Result geometry is plain JS.
 */
export async function csgBoolean(kind, meshA, meshB) {
  const m = await ensureManifoldModule();
  const Manifold = m.Manifold;
  const Mesh = m.Mesh;
  const mA = new Mesh(threeMeshToManifoldMesh(meshA));
  const mB = new Mesh(threeMeshToManifoldMesh(meshB));
  let manA = null, manB = null, result = null;
  try {
    manA = new Manifold(mA);
    manB = new Manifold(mB);
    if (kind === 'union') {
      result = manA.add(manB);
    } else if (kind === 'difference') {
      result = manA.subtract(manB);
    } else if (kind === 'intersect') {
      result = manA.intersect(manB);
    } else {
      throw new Error(`csgBoolean: unknown op ${kind}`);
    }
    return manifoldToThreeGeometry(result);
  } finally {
    // Manifold's encapsulated types expose .delete() on every handle;
    // call them even on the error path so the WASM heap stays sane.
    try { if (result && result.delete) result.delete(); } catch (_) {}
    try { if (manA && manA.delete) manA.delete(); } catch (_) {}
    try { if (manB && manB.delete) manB.delete(); } catch (_) {}
    try { if (mA && mA.delete) mA.delete(); } catch (_) {}
    try { if (mB && mB.delete) mB.delete(); } catch (_) {}
  }
}

// Named convenience exports — match the on-window op surface shape.
export const csgUnion       = (a, b) => csgBoolean('union',      a, b);
export const csgDifference  = (a, b) => csgBoolean('difference', a, b);
export const csgIntersect   = (a, b) => csgBoolean('intersect',  a, b);
