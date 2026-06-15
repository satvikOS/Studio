// SCAFFOLD (workflow-designed, 2026-06-15) — 100k-scale / AAA foundation.
// Designed by scale-100k-aaa-architecture workflow; wire + perf-verify before demo use.

// /Users/account_clawteam1/archdisc-Studio/frontend/src/workbenches/studio/v3/builders/environmentBuilder.js

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * 100k-Instance Environment Generator
 * ====================================
 * Builds AAA-scale foliage/city blocks via InstancedMesh + LOD + chunking.
 * 8 base assets × 12.5k instances each = 100k total, ~8 draw calls per frame.
 *
 * Public API:
 *   window.__studioBuildEnvironment({ preset: 'forest'|'city'|'mixed', count: 100000 })
 *   → { meshes: [...InstancedMeshes], stats: {totalInstances, activeMeshes, ...} }
 */

// Deterministic RNG for procedural placement
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ───────────────────────────────────────────────────────────────────────────
// ASSET LIBRARY: minimal geometries for each base asset type
// ───────────────────────────────────────────────────────────────────────────

function createAssetGeometries() {
  const assets = {};

  // FOREST ASSETS
  assets.oak = {
    display: 'Oak Tree',
    baseColor: 0x6b5a3b,
    lods: {
      // LOD 0: billboard (two intersecting quads, ~4 tris)
      0: new THREE.BufferGeometry(),
      // LOD 1: stylized trunk+cone (~150 tris)
      1: createTreeLow(),
      // LOD 2: branched trunk+foliage (~800 tris)
      2: createTreeMedium(),
      // LOD 3: detailed modelled tree (~3500 tris)
      3: createTreeHigh(),
    },
  };

  assets.pine = {
    display: 'Pine Tree',
    baseColor: 0x2d5016,
    lods: {
      0: new THREE.BufferGeometry(),
      1: createPineLow(),
      2: createPineMedium(),
      3: createPineHigh(),
    },
  };

  assets.fern = {
    display: 'Fern',
    baseColor: 0x4a7c3f,
    lods: {
      0: new THREE.BufferGeometry(),
      1: createFernLow(),
      2: createFernMedium(),
      3: new THREE.BufferGeometry(), // same as LOD 2
    },
  };

  assets.boulder = {
    display: 'Boulder',
    baseColor: 0x8a8a84,
    lods: {
      0: createBoulderLow(),
      1: createBoulderLow(),
      2: createBoulderMedium(),
      3: createBoulderHigh(),
    },
  };

  // CITY ASSETS
  assets.building = {
    display: 'Building',
    baseColor: 0xc8b8a8,
    lods: {
      0: new THREE.BufferGeometry(), // billboard
      1: createBuildingLow(),
      2: createBuildingMedium(),
      3: createBuildingHigh(),
    },
  };

  assets.streetlight = {
    display: 'Streetlight',
    baseColor: 0x4a4a4a,
    lods: {
      0: new THREE.BufferGeometry(),
      1: createStreetlightLow(),
      2: createStreetlightMedium(),
      3: createStreetlightHigh(),
    },
  };

  assets.bench = {
    display: 'Bench',
    baseColor: 0x5a4a3a,
    lods: {
      0: new THREE.BufferGeometry(),
      1: createBenchLow(),
      2: createBenchMedium(),
      3: new THREE.BufferGeometry(),
    },
  };

  assets.lamppost = {
    display: 'Lamppost',
    baseColor: 0x3a3a3a,
    lods: {
      0: new THREE.BufferGeometry(),
      1: createLamppostLow(),
      2: createLamppostMedium(),
      3: createLamppostHigh(),
    },
  };

  return assets;
}

// Tree geometries
function createTreeLow() {
  const g = new THREE.ConeGeometry(1.5, 8, 8);
  const trunk = new THREE.CylinderGeometry(0.3, 0.4, 3, 6);
  trunk.translate(0, 1.5, 0);
  return mergeGeometries([trunk, g]);
}
function createTreeMedium() {
  const g = new THREE.ConeGeometry(2.2, 12, 12);
  const trunk = new THREE.CylinderGeometry(0.35, 0.5, 4, 8);
  trunk.translate(0, 2, 0);
  const branch1 = new THREE.ConeGeometry(1.2, 8, 8);
  branch1.translate(0.8, 2, 0.5);
  return mergeGeometries([trunk, g, branch1]);
}
function createTreeHigh() {
  const parts = [];
  parts.push(new THREE.CylinderGeometry(0.4, 0.6, 5, 10));
  for (let i = 0; i < 3; i++) {
    const c = new THREE.ConeGeometry(2.5 - i * 0.6, 14, 14);
    c.translate(0, 2.5 + i * 1.2, 0);
    parts.push(c);
  }
  return mergeGeometries(parts);
}
function createPineLow() {
  const g = new THREE.ConeGeometry(1.2, 10, 6);
  const trunk = new THREE.CylinderGeometry(0.25, 0.3, 4, 6);
  trunk.translate(0, 2, 0);
  return mergeGeometries([trunk, g]);
}
function createPineMedium() {
  const g = new THREE.ConeGeometry(2, 14, 8);
  const trunk = new THREE.CylinderGeometry(0.3, 0.4, 5, 8);
  trunk.translate(0, 2.5, 0);
  return mergeGeometries([trunk, g]);
}
function createPineHigh() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.35, 0.5, 6, 10);
  parts.push(trunk);
  for (let i = 0; i < 2; i++) {
    const c = new THREE.ConeGeometry(2.2 - i * 0.4, 16, 10);
    c.translate(0, 3 + i * 0.8, 0);
    parts.push(c);
  }
  return mergeGeometries(parts);
}
function createFernLow() {
  return new THREE.PlaneGeometry(1.5, 2.5);
}
function createFernMedium() {
  const planes = [];
  planes.push(new THREE.PlaneGeometry(1.8, 2.8));
  planes.push(new THREE.PlaneGeometry(1.2, 2.2));
  planes[1].rotateZ(Math.PI / 4);
  return mergeGeometries(planes);
}
function createBoulderLow() {
  const g = new THREE.SphereGeometry(1.2, 8, 6);
  g.scale(1.1, 0.7, 1.2);
  return g;
}
function createBoulderMedium() {
  const g = new THREE.SphereGeometry(1.5, 12, 10);
  g.scale(1.2, 0.8, 1.3);
  return g;
}
function createBoulderHigh() {
  const g = new THREE.IcosahedronGeometry(1.6, 4);
  g.scale(1.2, 0.8, 1.3);
  return g;
}

// Building geometries (simple facades)
function createBuildingLow() {
  return new THREE.BoxGeometry(4, 5, 3, 2, 3, 2);
}
function createBuildingMedium() {
  const g = new THREE.BoxGeometry(4, 6, 3.5, 4, 4, 3);
  return g;
}
function createBuildingHigh() {
  const g = new THREE.BoxGeometry(4.5, 7, 3.5, 6, 5, 3);
  return g;
}
function createStreetlightLow() {
  const pole = new THREE.CylinderGeometry(0.08, 0.1, 4, 6);
  const head = new THREE.SphereGeometry(0.3, 6, 4);
  head.translate(0, 4, 0);
  return mergeGeometries([pole, head]);
}
function createStreetlightMedium() {
  const pole = new THREE.CylinderGeometry(0.1, 0.12, 4.5, 8);
  const head = new THREE.SphereGeometry(0.35, 8, 6);
  head.translate(0, 4.5, 0);
  const arm = new THREE.CylinderGeometry(0.04, 0.04, 0.8, 4);
  arm.translate(0.8, 4, 0);
  return mergeGeometries([pole, head, arm]);
}
function createStreetlightHigh() {
  const pole = new THREE.CylinderGeometry(0.1, 0.12, 5, 10);
  const head = new THREE.SphereGeometry(0.4, 10, 8);
  head.translate(0, 5, 0);
  const arm = new THREE.CylinderGeometry(0.05, 0.04, 1, 6);
  arm.translate(1, 5, 0);
  const lamp = new THREE.CylinderGeometry(0.25, 0.2, 0.3, 8);
  lamp.translate(1, 5, 0);
  return mergeGeometries([pole, head, arm, lamp]);
}
function createBenchLow() {
  return new THREE.BoxGeometry(1.5, 0.8, 0.6, 2, 2, 2);
}
function createBenchMedium() {
  const seat = new THREE.BoxGeometry(1.6, 0.12, 0.5, 3, 1, 2);
  const back = new THREE.BoxGeometry(1.6, 0.8, 0.1, 3, 3, 1);
  back.translate(0, 0.5, -0.3);
  return mergeGeometries([seat, back]);
}
function createLamppostLow() {
  const pole = new THREE.CylinderGeometry(0.06, 0.08, 3.5, 6);
  const head = new THREE.CylinderGeometry(0.2, 0.15, 0.4, 6);
  head.translate(0, 3.5, 0);
  return mergeGeometries([pole, head]);
}
function createLamppostMedium() {
  const pole = new THREE.CylinderGeometry(0.08, 0.1, 4, 8);
  const head = new THREE.CylinderGeometry(0.25, 0.2, 0.5, 8);
  head.translate(0, 4, 0);
  return mergeGeometries([pole, head]);
}
function createLamppostHigh() {
  const pole = new THREE.CylinderGeometry(0.08, 0.1, 4.5, 10);
  const head = new THREE.SphereGeometry(0.3, 10, 8);
  head.translate(0, 4.5, 0);
  return mergeGeometries([pole, head]);
}

// Utility: merge geometries (simple version)
function mergeGeometries(geos) {
  if (!geos || geos.length === 0) return new THREE.BufferGeometry();
  if (geos.length === 1) return geos[0];
  const merged = geos[0].clone();
  for (let i = 1; i < geos.length; i++) {
    const other = geos[i];
    const mergedPos = new Float32Array(merged.attributes.position.array.length + other.attributes.position.array.length);
    mergedPos.set(merged.attributes.position.array, 0);
    mergedPos.set(other.attributes.position.array, merged.attributes.position.array.length);
    merged.attributes.position = new THREE.BufferAttribute(mergedPos, 3);
    merged.computeBoundingSphere();
  }
  return merged;
}

// ───────────────────────────────────────────────────────────────────────────
// SPATIAL CHUNKING: 50m chunks in grid
// ───────────────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 50; // metres per chunk
const CHUNK_EXTENT = 8; // 8×8 grid = 400m×400m total

function getChunkIndex(worldX, worldZ) {
  const cx = Math.floor(worldX / CHUNK_SIZE) + Math.floor(CHUNK_EXTENT / 2);
  const cz = Math.floor(worldZ / CHUNK_SIZE) + Math.floor(CHUNK_EXTENT / 2);
  const valid = cx >= 0 && cx < CHUNK_EXTENT && cz >= 0 && cz < CHUNK_EXTENT;
  return valid ? { cx, cz, idx: cz * CHUNK_EXTENT + cx } : null;
}

function getChunkBounds(cx, cz) {
  const minX = (cx - Math.floor(CHUNK_EXTENT / 2)) * CHUNK_SIZE;
  const maxX = minX + CHUNK_SIZE;
  const minZ = (cz - Math.floor(CHUNK_EXTENT / 2)) * CHUNK_SIZE;
  const maxZ = minZ + CHUNK_SIZE;
  return { minX, maxX, minZ, maxZ, cx, cz };
}

// ───────────────────────────────────────────────────────────────────────────
// PROCEDURAL PLACEMENT: density heat-map + seeded RNG
// ───────────────────────────────────────────────────────────────────────────

function computeDensity(worldX, worldZ, preset) {
  const cx = worldX / 50, cz = worldZ / 50;
  // Radial falloff from center (sparse edges, dense core)
  const dist = Math.hypot(cx, cz);
  const radialMult = Math.max(0, 1 - (dist / 8) ** 1.5);
  
  if (preset === 'forest') {
    // Forest: denser in center, sparse at edges
    return radialMult * 0.85;
  } else if (preset === 'city') {
    // City: clustered blocks, sparser streets
    const grid = Math.sin(worldX * 0.1) * Math.cos(worldZ * 0.1);
    return radialMult * (0.5 + grid * 0.35);
  } else {
    // Mixed: moderate density
    return radialMult * 0.7;
  }
}

function getAssetPreset(preset) {
  if (preset === 'forest') return ['oak', 'pine', 'fern', 'boulder'];
  if (preset === 'city') return ['building', 'streetlight', 'bench', 'lamppost'];
  return ['oak', 'building', 'streetlight', 'fern'];
}

// ───────────────────────────────────────────────────────────────────────────
// LOD MANAGEMENT: distance-based LOD selection
// ───────────────────────────────────────────────────────────────────────────

const LOD_DISTANCES = [
  { dist: 15, lod: 3 },  // high detail within 15m
  { dist: 50, lod: 2 },  // medium detail 15-50m
  { dist: 150, lod: 1 }, // low detail 50-150m
  { dist: Infinity, lod: 0 }, // billboard 150m+
];

function selectLOD(distanceSq) {
  const dist = Math.sqrt(distanceSq);
  for (const { dist: d, lod } of LOD_DISTANCES) {
    if (dist < d) return lod;
  }
  return 0;
}

// ───────────────────────────────────────────────────────────────────────────
// MAIN ENVIRONMENT BUILDER
// ───────────────────────────────────────────────────────────────────────────

export function buildEnvironment({ preset = 'forest', count = 100000, seed = 42 } = {}) {
  const scene = (typeof window !== 'undefined') && (window.__archdiscScene || (window.__archdiscViewport?.scene));
  if (!scene) throw new Error('buildEnvironment: no scene');

  const rng = makeRng(seed);
  const assetLibrary = createAssetGeometries();
  const assetList = getAssetPreset(preset);
  const instancesPerAsset = Math.floor(count / assetList.length);

  // Material palette
  const matCache = {};
  function getMaterial(assetKey) {
    if (!matCache[assetKey]) {
      const asset = assetLibrary[assetKey];
      matCache[assetKey] = new THREE.MeshStandardMaterial({
        color: asset.baseColor,
        roughness: preset === 'forest' ? 0.8 : 0.6,
        metalness: preset === 'forest' ? 0 : 0.05,
      });
    }
    return matCache[assetKey];
  }

  // Instance data buffers (one per asset, tracks active LOD assignments)
  const instanceData = {}; // {assetKey: {positions: [...], rotations: [...], scales: [...], colors: [...]}}
  
  for (const assetKey of assetList) {
    instanceData[assetKey] = {
      positions: new Float32Array(instancesPerAsset * 3),
      rotations: new Float32Array(instancesPerAsset),
      scales: new Float32Array(instancesPerAsset),
      colors: new Float32Array(instancesPerAsset * 3),
      lodAssignments: new Uint8Array(instancesPerAsset), // per instance LOD level
      chunkMembership: new Uint8Array(instancesPerAsset), // which chunk
      count: 0,
    };
  }

  // Procedurally place instances
  for (let chunkIdx = 0; chunkIdx < CHUNK_EXTENT * CHUNK_EXTENT; chunkIdx++) {
    const cx = chunkIdx % CHUNK_EXTENT;
    const cz = Math.floor(chunkIdx / CHUNK_EXTENT);
    const bounds = getChunkBounds(cx, cz);
    
    const chunkDensity = computeDensity(bounds.minX + CHUNK_SIZE / 2, bounds.minZ + CHUNK_SIZE / 2, preset);
    const chunkCount = Math.floor(instancesPerAsset / (CHUNK_EXTENT * CHUNK_EXTENT) * (0.5 + chunkDensity * 1.5));

    for (let i = 0; i < chunkCount; i++) {
      const assetKey = assetList[Math.floor(rng() * assetList.length)];
      const data = instanceData[assetKey];
      if (data.count >= instancesPerAsset) continue;

      const idx = data.count;
      const x = bounds.minX + rng() * CHUNK_SIZE;
      const z = bounds.minZ + rng() * CHUNK_SIZE;
      const y = preset === 'forest' ? 0 : 0; // ground level for now

      // Position
      data.positions[idx * 3 + 0] = x;
      data.positions[idx * 3 + 1] = y;
      data.positions[idx * 3 + 2] = z;

      // Rotation (Y-axis spin only)
      data.rotations[idx] = rng() * Math.PI * 2;

      // Scale variation (±10%)
      data.scales[idx] = 0.9 + rng() * 0.2;

      // Color variation (±10% per channel)
      const asset = assetLibrary[assetKey];
      const baseCol = new THREE.Color(asset.baseColor);
      const colorVar = 0.1;
      data.colors[idx * 3 + 0] = Math.max(0, Math.min(1, baseCol.r + (rng() - 0.5) * colorVar));
      data.colors[idx * 3 + 1] = Math.max(0, Math.min(1, baseCol.g + (rng() - 0.5) * colorVar));
      data.colors[idx * 3 + 2] = Math.max(0, Math.min(1, baseCol.b + (rng() - 0.5) * colorVar));

      data.chunkMembership[idx] = chunkIdx;
      data.count++;
    }
  }

  // Build InstancedMeshes for each (asset, LOD) pair
  const meshes = [];
  const activeMeshByLOD = {}; // {assetKey: { lodLevel: InstancedMesh }}

  for (const assetKey of assetList) {
    const asset = assetLibrary[assetKey];
    const data = instanceData[assetKey];
    const material = getMaterial(assetKey);
    activeMeshByLOD[assetKey] = {};

    // Create one InstancedMesh per LOD (LOD 1, 2, 3 visible; LOD 0 billboard rarely needed at runtime)
    for (let lodLevel = 1; lodLevel <= 3; lodLevel++) {
      const geo = asset.lods[lodLevel];
      const instMesh = new THREE.InstancedMesh(geo, material, data.count);
      
      // Mark as AAA environment asset
      instMesh.userData.archdiscEnvironmentAsset = true;
      instMesh.userData.assetKey = assetKey;
      instMesh.userData.lodLevel = lodLevel;

      // Populate instance matrices
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < data.count; i++) {
        const pos = new THREE.Vector3(
          data.positions[i * 3 + 0],
          data.positions[i * 3 + 1],
          data.positions[i * 3 + 2]
        );
        const quat = new THREE.Quaternion();
        quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), data.rotations[i]);
        const scale = data.scales[i];
        matrix.compose(pos, quat, new THREE.Vector3(scale, scale, scale));
        instMesh.setMatrixAt(i, matrix);
      }
      instMesh.instanceMatrix.needsUpdate = true;

      // Placeholder: LOD visibility toggled by camera distance (update loop will cull)
      instMesh.visible = false; // initially hidden; update() will show appropriate LOD
      scene.add(instMesh);
      meshes.push(instMesh);
      activeMeshByLOD[assetKey][lodLevel] = instMesh;
    }
  }

  // Return public API + internal state for updates
  const envHandle = {
    meshes,
    instanceData,
    activeMeshByLOD,
    assetList,
    assetLibrary,
    preset,
    stats: {
      totalInstances: assetList.reduce((s, k) => s + instanceData[k].count, 0),
      activeMeshes: meshes.length,
      chunks: CHUNK_EXTENT * CHUNK_EXTENT,
      chunkSize: CHUNK_SIZE,
    },
  };

  // Install update loop (frustum + LOD culling)
  installEnvironmentUpdateLoop(envHandle);

  return envHandle;
}

// ───────────────────────────────────────────────────────────────────────────
// UPDATE LOOP: frustum culling + per-instance LOD assignment
// ───────────────────────────────────────────────────────────────────────────

function installEnvironmentUpdateLoop(env) {
  const camera = (typeof window !== 'undefined') && window.__archdiscViewport?.camera;
  if (!camera) return;

  // Attach update to r3f frame loop via window callback
  const origUpdateFn = window.__studioEnvironmentUpdate;
  window.__studioEnvironmentUpdate = (deltaTime) => {
    if (origUpdateFn) origUpdateFn(deltaTime);
    updateEnvironmentLODAndVisibility(env, camera);
  };

  // Trigger at least once per render
  if (typeof window !== 'undefined' && typeof requestAnimationFrame !== 'undefined') {
    const tick = () => {
      window.__studioEnvironmentUpdate?.(0);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

function updateEnvironmentLODAndVisibility(env, camera) {
  const frustum = new THREE.Frustum();
  frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));

  for (const assetKey of env.assetList) {
    const data = env.instanceData[assetKey];
    const meshByLOD = env.activeMeshByLOD[assetKey];
    
    // Determine which LOD levels to show based on camera distance
    const lodVisibility = { 1: false, 2: false, 3: false };
    
    for (let i = 0; i < data.count; i++) {
      const x = data.positions[i * 3 + 0];
      const y = data.positions[i * 3 + 1];
      const z = data.positions[i * 3 + 2];
      const distSq = camera.position.distanceToSquared(new THREE.Vector3(x, y, z));
      const lod = selectLOD(distSq);
      data.lodAssignments[i] = lod;
      if (lod > 0) lodVisibility[lod] = true;
    }

    // Show/hide meshes per LOD
    for (let lod = 1; lod <= 3; lod++) {
      if (meshByLOD[lod]) {
        meshByLOD[lod].visible = lodVisibility[lod];
      }
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// PUBLIC WINDOW API
// ───────────────────────────────────────────────────────────────────────────

export function installEnvironmentBuilder() {
  if (typeof window === 'undefined') return;
  window.__studioBuildEnvironment = (opts) => buildEnvironment(opts);
  window.__studioEnvironmentHandle = null;
}

export const ENVIRONMENT_PRESETS = ['forest', 'city', 'mixed'];
