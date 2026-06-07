// ArchDisc Studio V3 — photogrammetry / 3D-scan asset import (slice 890).
//
// Closes the "no photogrammetry input" gap on the DCC parity map.
// Photogrammetry pipelines (Reality Capture / Agisoft Metashape /
// Meshroom / Pix4D / openMVS / Polycam / Scaniverse) export their
// reconstructions almost exclusively as Stanford PLY (binary little-
// endian for dense, ASCII for sparse + colour) or vertex-colour
// Wavefront OBJ. This module ships the two parsers PLUS a point-cloud
// → mesh transform so a raw cloud lands as something Studio can
// shade, sculpt, or hand off to the rest of the asset pipeline.
//
// Ops registered (category 'interop'):
//
//   __studioScanImportPLY({text, binary})    → import a .ply (string OR
//                                                ArrayBuffer)
//   __studioScanImportOBJ({text})            → import a .obj with vertex
//                                                colours
//   __studioScanImportFromUrl({url, format}) → fetch + parse a .ply / .obj
//                                                from a URL
//   __studioScanPointCloudToMesh({meshUuid, sampleN, seed})
//                                            → convert a loaded point
//                                                cloud into a real mesh
//   __studioScanList()                       → list every loaded scan
//   __studioScanRemove({meshUuid})           → drop a scan + dispose
//
// Every imported scan is added to `window.__archdiscScene` tagged
// `userData.archdiscStudioPrimitive = true` + `archdiscStudioScan =
// {format, vertexCount, faceCount, hasColors, source}` so the
// existing outliner / selection / save-scene surface treats it as a
// regular primitive. Point clouds (no indices) are spawned as
// `THREE.Points` with the vertex colour buffer wired in; meshes are
// `THREE.Mesh` with vertex-colour MeshStandardMaterial. Pure JS, no
// new deps.

import * as THREE from 'three';
import { registerOps, unregisterOps } from '../common/registry.js';
import { parsePLY, parsePLYAscii, parsePLYBinary } from './plyParser.js';
import { parseOBJ } from './objParser.js';
import { poissonDiskSubsample, convexHullTriangulate } from './pointCloudToMesh.js';

let _installed = false;
const _scans = new Map(); // uuid → { format, source, vertexCount, faceCount, hasColors }

function _scene() {
  if (typeof window === 'undefined') return null;
  return (window && window.__archdiscScene)
    || (window && window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

// Build a THREE.BufferGeometry from a parser blob.
// `blob` = { positions, normals, colors, indices, vertexCount, faceCount, hasNormals, hasColors }
function _blobToGeometry(blob) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(blob.positions, 3));
  if (blob.colors) geom.setAttribute('color', new THREE.Float32BufferAttribute(blob.colors, 3));
  if (blob.normals) geom.setAttribute('normal', new THREE.Float32BufferAttribute(blob.normals, 3));
  if (blob.indices) geom.setIndex(new THREE.BufferAttribute(blob.indices, 1));
  if (blob.indices && !blob.normals) {
    geom.computeVertexNormals();
  }
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

// Spawn either a Mesh (when indices are present) or a Points cloud.
function _spawnFromBlob(blob, opts = {}) {
  const scene = _scene();
  if (!scene) return { ok: false, error: 'no scene' };
  const geom = _blobToGeometry(blob);
  let obj;
  if (blob.indices && blob.faceCount > 0) {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: !!blob.hasColors,
      color: blob.hasColors ? 0xffffff : 0xb8c4d2,
      roughness: 0.85,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    obj = new THREE.Mesh(geom, mat);
    obj.castShadow = true;
    obj.receiveShadow = true;
  } else {
    const mat = new THREE.PointsMaterial({
      size: opts.pointSize || 0.005,
      vertexColors: !!blob.hasColors,
      color: blob.hasColors ? 0xffffff : 0xb8c4d2,
      sizeAttenuation: true,
    });
    obj = new THREE.Points(geom, mat);
  }
  const sourceLabel = opts.source || 'scanimport';
  obj.name = opts.name || `scan-${sourceLabel}-${Date.now() % 100000}`;
  obj.userData = {
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: blob.indices ? 'scan-mesh' : 'scan-pointcloud',
    archdiscStudioScan: {
      format: opts.format || 'unknown',
      vertexCount: blob.vertexCount,
      faceCount: blob.faceCount || 0,
      hasColors: !!blob.hasColors,
      hasNormals: !!blob.hasNormals,
      source: sourceLabel,
    },
    pickable: true,
  };
  scene.add(obj);
  _scans.set(obj.uuid, {
    uuid: obj.uuid,
    name: obj.name,
    format: opts.format || 'unknown',
    source: sourceLabel,
    vertexCount: blob.vertexCount,
    faceCount: blob.faceCount || 0,
    hasColors: !!blob.hasColors,
    hasNormals: !!blob.hasNormals,
    kind: blob.indices ? 'mesh' : 'pointcloud',
  });
  return { ok: true, uuid: obj.uuid, geometry: geom, vertCount: blob.vertexCount };
}

// ── Ops ─────────────────────────────────────────────────────────────

function __studioScanImportPLY(arg) {
  const opts = (arg && typeof arg === 'object') ? arg : {};
  try {
    let blob;
    if (opts.binary) {
      blob = parsePLYBinary(opts.binary instanceof ArrayBuffer
        ? opts.binary
        : (opts.binary.buffer ? opts.binary.buffer.slice(opts.binary.byteOffset, opts.binary.byteOffset + opts.binary.byteLength) : null));
    } else if (typeof opts.text === 'string') {
      blob = parsePLYAscii(opts.text);
    } else if (opts.data !== undefined) {
      blob = parsePLY(opts.data);
    } else {
      return { ok: false, error: 'expected {text} or {binary}' };
    }
    const r = _spawnFromBlob(blob, {
      format: 'ply',
      source: opts.source || 'ply',
      name: opts.name,
      pointSize: opts.pointSize,
    });
    return {
      ok: r.ok,
      uuid: r.uuid,
      vertCount: blob.vertexCount,
      faceCount: blob.faceCount,
      hasColors: blob.hasColors,
      hasNormals: blob.hasNormals,
      format: blob.format,
      kind: blob.indices ? 'mesh' : 'pointcloud',
    };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function __studioScanImportOBJ(arg) {
  const opts = (arg && typeof arg === 'object') ? arg : {};
  if (typeof opts.text !== 'string') return { ok: false, error: 'expected {text}' };
  try {
    const blob = parseOBJ(opts.text);
    const r = _spawnFromBlob(blob, {
      format: 'obj',
      source: opts.source || 'obj',
      name: opts.name,
    });
    return {
      ok: r.ok,
      uuid: r.uuid,
      vertCount: blob.vertexCount,
      faceCount: blob.faceCount,
      hasColors: blob.hasColors,
      hasNormals: blob.hasNormals,
      mtllib: blob.mtllib || null,
      materialRanges: blob.materialRanges || [],
      kind: 'mesh',
    };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

async function __studioScanImportFromUrl(arg) {
  const opts = (arg && typeof arg === 'object') ? arg : {};
  if (!opts.url) return { ok: false, error: 'expected {url}' };
  let format = (opts.format || '').toLowerCase();
  if (!format) {
    if (/\.ply($|\?)/i.test(opts.url)) format = 'ply';
    else if (/\.obj($|\?)/i.test(opts.url)) format = 'obj';
  }
  if (format !== 'ply' && format !== 'obj') {
    return { ok: false, error: `unknown format "${format}" (expected ply / obj)` };
  }
  try {
    const resp = await fetch(opts.url);
    if (!resp.ok) return { ok: false, error: `fetch failed: ${resp.status}` };
    if (format === 'ply') {
      const buf = await resp.arrayBuffer();
      // Peek to choose ascii vs binary path.
      const peek = new TextDecoder('utf-8').decode(new Uint8Array(buf).subarray(0, 256));
      if (/^format\s+ascii/m.test(peek)) {
        const text = new TextDecoder('utf-8').decode(new Uint8Array(buf));
        return __studioScanImportPLY({ text, source: opts.url, name: opts.name, pointSize: opts.pointSize });
      }
      return __studioScanImportPLY({ binary: buf, source: opts.url, name: opts.name, pointSize: opts.pointSize });
    }
    const text = await resp.text();
    return __studioScanImportOBJ({ text, source: opts.url, name: opts.name });
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function __studioScanPointCloudToMesh(arg) {
  const opts = (arg && typeof arg === 'object') ? arg : {};
  const scene = _scene();
  if (!scene) return { ok: false, error: 'no scene' };
  let src = null;
  if (opts.meshUuid) {
    scene.traverse((o) => { if (o.uuid === opts.meshUuid) src = o; });
  } else {
    // Use the most-recently loaded point cloud.
    const candidates = Array.from(_scans.values()).filter((s) => s.kind === 'pointcloud');
    if (candidates.length) {
      const last = candidates[candidates.length - 1];
      scene.traverse((o) => { if (o.uuid === last.uuid) src = o; });
    }
  }
  if (!src || !src.geometry || !src.geometry.attributes || !src.geometry.attributes.position) {
    return { ok: false, error: 'no source point cloud' };
  }
  const positions = src.geometry.attributes.position.array;
  const colorsAttr = src.geometry.attributes.color;
  const target = opts.sampleN || Math.min(2000, positions.length / 3);
  const sub = poissonDiskSubsample(positions, target, { seed: opts.seed || 1 });
  const hull = convexHullTriangulate(sub.positions);
  // Build the blob.
  let colors = null;
  if (colorsAttr) {
    // Map subsampled positions back to the closest source-vertex colour.
    // Cheap O(N·N) scan, but `kept` is capped at ~2k.
    colors = new Float32Array(sub.kept * 3);
    const srcN = positions.length / 3;
    for (let i = 0; i < sub.kept; i++) {
      const px = sub.positions[i * 3];
      const py = sub.positions[i * 3 + 1];
      const pz = sub.positions[i * 3 + 2];
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < srcN; j++) {
        const dx = positions[j * 3] - px;
        const dy = positions[j * 3 + 1] - py;
        const dz = positions[j * 3 + 2] - pz;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { bestD = d; best = j; }
      }
      colors[i * 3] = colorsAttr.array[best * 3];
      colors[i * 3 + 1] = colorsAttr.array[best * 3 + 1];
      colors[i * 3 + 2] = colorsAttr.array[best * 3 + 2];
    }
  }
  const blob = {
    positions: sub.positions,
    normals: null,
    colors,
    indices: hull.indices.length ? hull.indices : null,
    vertexCount: sub.kept,
    faceCount: hull.faceCount,
    hasNormals: false,
    hasColors: !!colors,
  };
  const r = _spawnFromBlob(blob, {
    format: 'derived',
    source: `mesh-from-${src.uuid.slice(0, 8)}`,
    name: opts.name || 'scan-mesh',
  });
  return {
    ok: r.ok,
    uuid: r.uuid,
    sourceUuid: src.uuid,
    sampledVerts: sub.kept,
    hullFaces: hull.faceCount,
  };
}

function __studioScanList() {
  // Re-sync the registry against the scene (drop ghosts whose mesh was
  // removed via the outliner).
  const scene = _scene();
  if (scene) {
    const live = new Set();
    scene.traverse((o) => { if (_scans.has(o.uuid)) live.add(o.uuid); });
    for (const uuid of Array.from(_scans.keys())) {
      if (!live.has(uuid)) _scans.delete(uuid);
    }
  }
  return { ok: true, count: _scans.size, entries: Array.from(_scans.values()) };
}

function __studioScanRemove(arg) {
  const opts = (arg && typeof arg === 'object') ? arg : {};
  if (!opts.meshUuid) return { ok: false, error: 'expected {meshUuid}' };
  const scene = _scene();
  if (!scene) return { ok: false, error: 'no scene' };
  let removed = 0;
  scene.traverse((o) => {
    if (o.uuid === opts.meshUuid) {
      scene.remove(o);
      if (o.geometry && o.geometry.dispose) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose && m.dispose());
        else o.material.dispose && o.material.dispose();
      }
      removed++;
    }
  });
  _scans.delete(opts.meshUuid);
  return { ok: removed > 0, removed };
}

// ── Install / uninstall ────────────────────────────────────────────

const OP_NAMES = [
  '__studioScanImportPLY',
  '__studioScanImportOBJ',
  '__studioScanImportFromUrl',
  '__studioScanPointCloudToMesh',
  '__studioScanList',
  '__studioScanRemove',
];

export function installScanImport() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioScanImportInstalled) {
    return { ok: true, alreadyInstalled: true };
  }
  _installed = true;
  window.__studioScanImportInstalled = true;
  const ops = {
    __studioScanImportPLY: [
      __studioScanImportPLY,
      'Photogrammetry scan import — Stanford PLY (binary + ASCII) with vertex colours',
    ],
    __studioScanImportOBJ: [
      __studioScanImportOBJ,
      'Photogrammetry scan import — Wavefront OBJ with vertex colours',
    ],
    __studioScanImportFromUrl: [
      __studioScanImportFromUrl,
      'Photogrammetry scan import — fetch + parse a .ply or .obj from URL',
    ],
    __studioScanPointCloudToMesh: [
      __studioScanPointCloudToMesh,
      'Photogrammetry scan import — Poisson-subsample + convex-hull triangulate a point cloud',
    ],
    __studioScanList: [
      __studioScanList,
      'Photogrammetry scan import — list loaded scans',
    ],
    __studioScanRemove: [
      __studioScanRemove,
      'Photogrammetry scan import — remove a loaded scan from the scene',
    ],
  };
  registerOps(ops, 'interop',
    'Photogrammetry / 3D scan import — Reality Capture / Agisoft Metashape / Meshroom (.ply + .obj)');
  return { ok: true, ops: OP_NAMES.length };
}

export function uninstallScanImport() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  unregisterOps(OP_NAMES);
  _installed = false;
  window.__studioScanImportInstalled = false;
  _scans.clear();
  return { ok: true };
}

export {
  __studioScanImportPLY,
  __studioScanImportOBJ,
  __studioScanImportFromUrl,
  __studioScanPointCloudToMesh,
  __studioScanList,
  __studioScanRemove,
  parsePLY,
  parsePLYAscii,
  parsePLYBinary,
  parseOBJ,
  poissonDiskSubsample,
  convexHullTriangulate,
};

export default installScanImport;
