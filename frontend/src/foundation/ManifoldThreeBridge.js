/**
 * ArchDisc Foundation — Manifold → three.js bridge.
 *
 * Converts a manifold-3d `Manifold` into a three.js `BufferGeometry`
 * for direct rendering. The bridge does not duplicate vertex memory
 * unnecessarily — vertProperties is taken straight from the manifold
 * mesh.
 */

import * as THREE from 'three';

/**
 * Build a Manifold from a three.js BufferGeometry, optionally applying
 * a 4×4 matrix to every vertex (so meshes positioned in scene space
 * still overlap correctly under manifold's local-coordinate Boolean
 * ops). Indexed and non-indexed geometries both accepted.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {object} manifoldModule  the resolved manifold-3d WASM module
 * @param {THREE.Matrix4} [transform]
 * @returns {Manifold}
 */
export function geometryToManifold(geometry, manifoldModule, transform) {
  // Three's primitive geometries (BoxGeometry et al) duplicate vertices
  // at every face boundary so per-face normals can differ. Manifold
  // needs a closed-solid topology — vertices at the same position
  // merged — to treat the mesh as manifold. three's mergeVertices
  // helper only merges when ALL attributes match (positions + normals
  // + uvs etc.), which leaves cube corners as 3 separate vertices and
  // produces a "Not manifold" error.
  //
  // We dedupe by QUANTIZED POSITION only, regardless of other attributes.
  // 1 µm precision (1e-6 m) is comfortably finer than any geometric
  // tolerance Studio cares about and coarser than IEEE-754 float jitter.
  const posSrc = geometry.attributes.position.array;
  const idxSrc = geometry.index ? geometry.index.array : null;
  const inCount = posSrc.length / 3;
  const PREC = 1e6;
  const posMap = new Map();
  const uniquePositions = [];
  const remap = new Int32Array(inCount);
  const v = transform ? new THREE.Vector3() : null;
  for (let i = 0; i < inCount; i++) {
    let x = posSrc[i * 3], y = posSrc[i * 3 + 1], z = posSrc[i * 3 + 2];
    if (transform) {
      v.set(x, y, z).applyMatrix4(transform);
      x = v.x; y = v.y; z = v.z;
    }
    const key = `${Math.round(x * PREC)},${Math.round(y * PREC)},${Math.round(z * PREC)}`;
    let mapped = posMap.get(key);
    if (mapped === undefined) {
      mapped = uniquePositions.length / 3;
      uniquePositions.push(x, y, z);
      posMap.set(key, mapped);
    }
    remap[i] = mapped;
  }
  const triCount = idxSrc ? idxSrc.length : inCount;
  const indices = new Uint32Array(triCount);
  if (idxSrc) {
    for (let i = 0; i < triCount; i++) indices[i] = remap[idxSrc[i]];
  } else {
    for (let i = 0; i < triCount; i++) indices[i] = remap[i];
  }
  // Drop degenerate triangles (any pair of corners share the same merged
  // index). Common in dedup'd primitives where a "seam" vertex would
  // collapse two triangle corners onto each other.
  const cleanTris = [];
  for (let t = 0; t < triCount; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    if (a !== b && b !== c && c !== a) cleanTris.push(a, b, c);
  }
  const positions = new Float32Array(uniquePositions);
  const triVerts = new Uint32Array(cleanTris);
  const meshIn = new manifoldModule.Mesh({
    numProp: 3,
    vertProperties: positions,
    triVerts,
  });
  return new manifoldModule.Manifold(meshIn);
}

/**
 * Build a three.js BufferGeometry from a Manifold.
 * @param {Manifold} manifold
 * @returns {THREE.BufferGeometry}
 */
export function manifoldToGeometry(manifold) {
  const mesh = manifold.getMesh();
  const numProp = mesh.numProp;
  const vertProps = mesh.vertProperties;
  const triVerts = mesh.triVerts;
  const numVert = vertProps.length / numProp;

  // Extract positions (first 3 props per vertex)
  const positions = new Float32Array(numVert * 3);
  for (let i = 0; i < numVert; i++) {
    positions[i * 3]     = vertProps[i * numProp];
    positions[i * 3 + 1] = vertProps[i * numProp + 1];
    positions[i * 3 + 2] = vertProps[i * numProp + 2];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(triVerts), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Build a three.js Mesh (geometry + material) from a Manifold.
 * Default material is matte gray PBR.
 *
 * @param {Manifold} manifold
 * @param {object} opts
 * @param {number}  opts.color
 * @param {number}  opts.roughness  (0 = mirror, 1 = matte)
 * @param {number}  opts.metalness  (0 = dielectric, 1 = metal)
 * @param {boolean} opts.flatShading
 * @returns {THREE.Mesh}
 */
export function manifoldToMesh(manifold, opts = {}) {
  const geometry = manifoldToGeometry(manifold);
  const material = new THREE.MeshStandardMaterial({
    color:        opts.color ?? 0x9aa3ad,
    roughness:    opts.roughness ?? 0.55,
    metalness:    opts.metalness ?? 0.30,
    flatShading:  opts.flatShading ?? false,
    // DoubleSide is required so the body renders from every camera angle.
    // Foundation manifolds can be:
    //   - solids (closed) — DoubleSide is harmless, and protects against
    //     inverted normals from CSG / circularPattern / manifold-3d quirks
    //     that would otherwise produce fully-invisible angles.
    //   - sheets / open shells — DoubleSide is REQUIRED, otherwise the back
    //     of the sheet shows nothing.
    //   - bodies placed under a mirror / negative-determinant transform —
    //     winding flips, so DoubleSide keeps them visible after the flip.
    // The user reported "at angles some parts are not rendered or fully
    // invisible you have to move around to look at it" — that is the
    // classic FrontSide-only symptom.
    side:         THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
