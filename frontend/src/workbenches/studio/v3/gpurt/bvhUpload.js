// ArchDisc Studio V3 — extracts three-mesh-bvh BVH roots and packs them
// into GPU-ready storage buffers (slice 886).
//
// We can't reuse `MeshBVHUniformStruct` because that targets WebGL2
// (DataTexture). For WebGPU compute we need flat ArrayBuffers.
//
// Layout produced (sizes in bytes):
//   nodes       : 32 * nodeCount    — see BVHNode struct in wgslShader.js
//   triIndices  : 4 * triCount * 3  — vertex indices, three per triangle
//   positions   : 4 * vertCount * 3 — packed vec3 floats (we pad to vec3<f32>
//                                     directly; WGSL aligns to 4-byte stride
//                                     for f32 arrays so this is correct)
//   materials   : 32 * materialCount — vec4 albedo + vec4 emissive
//   triMaterial : 4 * triCount       — per-triangle material slot
//
// The three-mesh-bvh node format is:
//   f32[0..2] = min, f32[3..5] = max
//   u32[6]    = right node index (inner) OR triangle offset (leaf)
//   u32[7]    = SPLIT_AXIS (inner)
//   u16[14]   = COUNT (leaf)
//   u16[15]   = 0xFFFF if leaf else != 0xFFFF
//
// We re-encode `flagsCount`:
//   bit 31    = is-leaf flag (1 = leaf)
//   bits 0..30 = COUNT (leaf) or SPLIT_AXIS (inner)

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const BYTES_PER_NODE_SRC = 32;
const BYTES_PER_NODE_GPU = 32; // matches WGSL BVHNode

function _ensureBVH(mesh) {
  const g = mesh.geometry;
  if (!g.boundsTree) {
    g.boundsTree = new MeshBVH(g);
  }
  return g.boundsTree;
}

// Flatten one (potentially multi-mesh) scene into a single merged mesh
// in world space, so we only need one BVH for the kernel. For Studio
// this is fine — the primitive count is typically < 200.
//
// NOTE: scene meshes are merged in world space because the WGSL kernel
// works in a single world frame; we'd need per-mesh inverse matrices to
// avoid the copy. The merged mesh is owned by us and gets a fresh BVH.
export function mergeSceneMeshes(meshes) {
  const positions = [];
  const indices = [];
  const triMaterial = [];
  const materials = [];
  const materialMap = new Map(); // material-uuid → slot
  let vertOffset = 0;
  const tmpV = new THREE.Vector3();
  for (const mesh of meshes) {
    if (!mesh.geometry) continue;
    const g = mesh.geometry;
    const posAttr = g.attributes.position;
    if (!posAttr) continue;
    // Material slot
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const matKey = mat ? mat.uuid : 'default';
    let matSlot = materialMap.get(matKey);
    if (matSlot === undefined) {
      matSlot = materials.length;
      const albedo = mat?.color ? [mat.color.r, mat.color.g, mat.color.b] : [0.7, 0.7, 0.7];
      const emissive = mat?.emissive ? [mat.emissive.r, mat.emissive.g, mat.emissive.b] : [0, 0, 0];
      const roughness = (typeof mat?.roughness === 'number') ? mat.roughness : 0.6;
      const metalness = (typeof mat?.metalness === 'number') ? mat.metalness : 0.0;
      materials.push({ albedo, emissive, roughness, metalness });
      materialMap.set(matKey, matSlot);
    }
    // Vertices in world space
    mesh.updateWorldMatrix(true, false);
    for (let i = 0; i < posAttr.count; i++) {
      tmpV.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
      positions.push(tmpV.x, tmpV.y, tmpV.z);
    }
    // Indices
    if (g.index) {
      const idxAttr = g.index;
      for (let i = 0; i < idxAttr.count; i += 3) {
        indices.push(
          idxAttr.array[i + 0] + vertOffset,
          idxAttr.array[i + 1] + vertOffset,
          idxAttr.array[i + 2] + vertOffset,
        );
        triMaterial.push(matSlot);
      }
    } else {
      // Non-indexed: generate sequential indices
      for (let i = 0; i < posAttr.count; i += 3) {
        indices.push(i + vertOffset, i + 1 + vertOffset, i + 2 + vertOffset);
        triMaterial.push(matSlot);
      }
    }
    vertOffset += posAttr.count;
  }
  if (!positions.length || !indices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geometry.computeVertexNormals();
  return {
    geometry,
    triMaterial: new Uint32Array(triMaterial),
    materials,
    vertCount: positions.length / 3,
    triCount: indices.length / 3,
  };
}

// Repack a three-mesh-bvh root ArrayBuffer into our WGSL-friendly node
// layout. Returns a Float32Array view over a fresh ArrayBuffer plus the
// node count. The triangle index buffer is also returned because three-
// mesh-bvh may shuffle indices into an indirect buffer; we resolve that
// down to a flat (i0, i1, i2) per triangle.
export function packBVHForGPU(geometry, triMaterial) {
  const bvh = geometry.boundsTree || new MeshBVH(geometry);
  if (!geometry.boundsTree) geometry.boundsTree = bvh;
  const roots = bvh._roots;
  if (!roots || roots.length !== 1) {
    throw new Error('GPURT: BVH must have a single root (got ' + (roots?.length ?? 0) + ')');
  }
  const root = roots[0];
  const nodeCount = root.byteLength / BYTES_PER_NODE_SRC;
  const srcF32 = new Float32Array(root);
  const srcU32 = new Uint32Array(root);
  const srcU16 = new Uint16Array(root);
  // Output BVH nodes — 8 floats per node packed exactly as the WGSL
  // struct expects.
  const outBuf = new ArrayBuffer(nodeCount * BYTES_PER_NODE_GPU);
  const outF32 = new Float32Array(outBuf);
  const outU32 = new Uint32Array(outBuf);
  for (let i = 0; i < nodeCount; i++) {
    const n32 = i * (BYTES_PER_NODE_SRC / 4);
    const n16 = n32 * 2;
    // Bounds
    outF32[i * 8 + 0] = srcF32[n32 + 0];
    outF32[i * 8 + 1] = srcF32[n32 + 1];
    outF32[i * 8 + 2] = srcF32[n32 + 2];
    outF32[i * 8 + 4] = srcF32[n32 + 3];
    outF32[i * 8 + 5] = srcF32[n32 + 4];
    outF32[i * 8 + 6] = srcF32[n32 + 5];
    // Leaf?
    const isLeaf = srcU16[n16 + 15] === 0xFFFF;
    if (isLeaf) {
      const count  = srcU16[n16 + 14];
      const offset = srcU32[n32 + 6];
      outU32[i * 8 + 3] = offset;
      outU32[i * 8 + 7] = 0x80000000 | (count & 0x7FFFFFFF);
    } else {
      const rightByteOffset = srcU32[n32 + 6];
      const rightNodeIdx    = rightByteOffset / BYTES_PER_NODE_SRC;
      const splitAxis       = srcU32[n32 + 7];
      outU32[i * 8 + 3] = rightNodeIdx;
      outU32[i * 8 + 7] = splitAxis & 0x7FFFFFFF;
    }
  }
  // Triangle indices: resolve through indirect buffer if needed.
  const triCount = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
  const triIdxBuf = new Uint32Array(triCount * 3);
  const indirect = bvh._indirectBuffer || null;
  const idxArray = geometry.index ? geometry.index.array : null;
  for (let t = 0; t < triCount; t++) {
    const source = indirect ? indirect[t] : t;
    const base = source * 3;
    if (idxArray) {
      triIdxBuf[t * 3 + 0] = idxArray[base + 0];
      triIdxBuf[t * 3 + 1] = idxArray[base + 1];
      triIdxBuf[t * 3 + 2] = idxArray[base + 2];
    } else {
      triIdxBuf[t * 3 + 0] = base + 0;
      triIdxBuf[t * 3 + 1] = base + 1;
      triIdxBuf[t * 3 + 2] = base + 2;
    }
  }
  // Material per triangle — keep order; we must also reorder via indirect
  // when present so triMaterial[tri-in-bvh-order] points at the right
  // material slot.
  let triMatFinal = triMaterial;
  if (indirect && triMaterial && triMaterial.length === triCount) {
    triMatFinal = new Uint32Array(triCount);
    for (let t = 0; t < triCount; t++) {
      triMatFinal[t] = triMaterial[indirect[t]];
    }
  } else if (!triMaterial || triMaterial.length !== triCount) {
    triMatFinal = new Uint32Array(triCount);
  }
  return {
    nodes:     new Uint8Array(outBuf),
    nodeCount,
    triIndices: triIdxBuf,
    triCount,
    triMaterial: triMatFinal,
  };
}

// Position attribute packed for GPU upload — copies into a contiguous
// f32 array of length 3 * vertCount.
export function packPositions(geometry) {
  const pos = geometry.attributes.position;
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    out[i * 3 + 0] = pos.getX(i);
    out[i * 3 + 1] = pos.getY(i);
    out[i * 3 + 2] = pos.getZ(i);
  }
  return out;
}

// Material list → ArrayBuffer matching the WGSL Material struct
// (vec4 albedo + vec4 emissive). Returns a Uint8Array of size
// 32 * materialCount.
export function packMaterials(materials) {
  const list = (materials && materials.length) ? materials : [{
    albedo: [0.7, 0.7, 0.7], emissive: [0, 0, 0], roughness: 0.6, metalness: 0.0,
  }];
  const buf = new ArrayBuffer(list.length * 32);
  const f32 = new Float32Array(buf);
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    f32[i * 8 + 0] = m.albedo[0];
    f32[i * 8 + 1] = m.albedo[1];
    f32[i * 8 + 2] = m.albedo[2];
    f32[i * 8 + 3] = m.roughness;
    f32[i * 8 + 4] = m.emissive[0];
    f32[i * 8 + 5] = m.emissive[1];
    f32[i * 8 + 6] = m.emissive[2];
    f32[i * 8 + 7] = m.metalness;
  }
  return new Uint8Array(buf);
}

// Convenience: full pipeline for one mesh.
export function buildGPUResources(meshes) {
  const merged = mergeSceneMeshes(meshes);
  if (!merged) return null;
  const packed = packBVHForGPU(merged.geometry, merged.triMaterial);
  const positions = packPositions(merged.geometry);
  const materials = packMaterials(merged.materials);
  return {
    nodes: packed.nodes,
    nodeCount: packed.nodeCount,
    triIndices: packed.triIndices,
    triCount: packed.triCount,
    positions,
    vertCount: positions.length / 3,
    materials,
    materialCount: merged.materials.length || 1,
    triMaterialId: packed.triMaterial,
    geometry: merged.geometry,
  };
}

export default buildGPUResources;
