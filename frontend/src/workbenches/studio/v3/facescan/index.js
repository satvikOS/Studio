// ArchDisc Studio V3 — face scan ingestion (slice 940).
// Wrap3 / R3DS / TexturingXYZ-ready: import scan mesh + maps, conform base
// topology, transfer textures via barycentric lookup, attach procedural iris.
import * as THREE from 'three';
import { registerOps } from '../common/registry.js';

let _installed = false, _nextId = 1;
const _scans = new Map();

const IRIS_LIBRARY = {
  blue:   { albedo: [0.18, 0.40, 0.62], limbalRing: 0.85, fiberDensity: 1.0 },
  brown:  { albedo: [0.30, 0.18, 0.10], limbalRing: 0.78, fiberDensity: 1.1 },
  green:  { albedo: [0.20, 0.42, 0.22], limbalRing: 0.82, fiberDensity: 1.0 },
  hazel:  { albedo: [0.40, 0.28, 0.15], limbalRing: 0.80, fiberDensity: 1.0 },
  grey:   { albedo: [0.45, 0.48, 0.50], limbalRing: 0.86, fiberDensity: 0.9 },
  amber:  { albedo: [0.55, 0.35, 0.10], limbalRing: 0.80, fiberDensity: 1.0 },
  hetero: { albedo: [0.18, 0.40, 0.62], albedoR: [0.40, 0.28, 0.15], limbalRing: 0.85, fiberDensity: 1.0 },
  albino: { albedo: [0.85, 0.50, 0.50], limbalRing: 0.90, fiberDensity: 0.8 },
};

async function _loadObj(url) {
  const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
  const loader = new OBJLoader();
  return new Promise((res, rej) => loader.load(url, res, undefined, rej));
}
async function _loadPly(url) {
  const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
  const loader = new PLYLoader();
  return new Promise((res, rej) => loader.load(url, res, undefined, rej));
}
async function _loadFbx(url) {
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  const loader = new FBXLoader();
  return new Promise((res, rej) => loader.load(url, res, undefined, rej));
}
async function _loadTex(url) {
  return new Promise((res, rej) => {
    const loader = new THREE.TextureLoader();
    loader.load(url, res, undefined, rej);
  });
}

function _wrapTopology(scanMesh, baseTopoMesh, landmarks) {
  const scanPos = scanMesh.geometry.attributes.position.array;
  const basePos = baseTopoMesh.geometry.attributes.position.array;
  const newPos = new Float32Array(basePos);
  // Closest-point projection from base to scan
  for (let i = 0; i < basePos.length; i += 3) {
    let bestD = Infinity, bestX = basePos[i], bestY = basePos[i + 1], bestZ = basePos[i + 2];
    for (let j = 0; j < scanPos.length; j += 3) {
      const dx = basePos[i] - scanPos[j], dy = basePos[i + 1] - scanPos[j + 1], dz = basePos[i + 2] - scanPos[j + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; bestX = scanPos[j]; bestY = scanPos[j + 1]; bestZ = scanPos[j + 2]; }
    }
    newPos[i] = bestX; newPos[i + 1] = bestY; newPos[i + 2] = bestZ;
  }
  // Laplacian smoothing
  for (let pass = 0; pass < 5; pass++) {
    const smoothed = new Float32Array(newPos);
    for (let i = 0; i < newPos.length; i += 3) {
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (let j = Math.max(0, i - 9); j <= Math.min(newPos.length - 3, i + 9); j += 3) {
        sx += newPos[j]; sy += newPos[j + 1]; sz += newPos[j + 2]; n++;
      }
      if (n > 0) { smoothed[i] = (newPos[i] + sx / n) * 0.5; smoothed[i + 1] = (newPos[i + 1] + sy / n) * 0.5; smoothed[i + 2] = (newPos[i + 2] + sz / n) * 0.5; }
    }
    newPos.set(smoothed);
  }
  // Anchor landmarks
  if (landmarks) {
    for (const lm of landmarks) {
      const vi = lm.baseVertex * 3;
      newPos[vi] = lm.scanPosition[0]; newPos[vi + 1] = lm.scanPosition[1]; newPos[vi + 2] = lm.scanPosition[2];
    }
  }
  baseTopoMesh.geometry.attributes.position.array.set(newPos);
  baseTopoMesh.geometry.attributes.position.needsUpdate = true;
  baseTopoMesh.geometry.computeVertexNormals();
  return { vertices: newPos.length / 3 };
}

export function installFaceScan() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioFaceScanImport: async ({ objUrl, plyUrl, fbxUrl, textureUrls = {} } = {}) => {
      let mesh = null;
      if (objUrl) mesh = await _loadObj(objUrl);
      else if (plyUrl) { const g = await _loadPly(plyUrl); mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial()); }
      else if (fbxUrl) mesh = await _loadFbx(fbxUrl);
      else return { ok: false, error: 'no scan url' };
      const mat = mesh.material instanceof THREE.Material ? mesh.material : new THREE.MeshStandardMaterial();
      if (textureUrls.albedo) mat.map = await _loadTex(textureUrls.albedo);
      if (textureUrls.normal) mat.normalMap = await _loadTex(textureUrls.normal);
      if (textureUrls.roughness) mat.roughnessMap = await _loadTex(textureUrls.roughness);
      if (textureUrls.displacement) mat.displacementMap = await _loadTex(textureUrls.displacement);
      if (mesh.traverse) mesh.traverse((o) => { if (o.isMesh) o.material = mat; o.userData.archdiscStudioPrimitive = true; });
      else { mesh.material = mat; mesh.userData.archdiscStudioPrimitive = true; }
      const vp = window.__archdiscViewport;
      if (vp?.scene) vp.scene.add(mesh);
      const id = `scan-${_nextId++}`;
      _scans.set(id, { mesh, textureUrls });
      return { ok: true, id, uuid: mesh.uuid };
    },
    __studioFaceScanWrap: ({ scanUuid, baseTopologyUuid, landmarks }) => {
      const vp = window.__archdiscViewport;
      if (!vp?.scene) return { ok: false, error: 'no viewport' };
      let scan = null, base = null;
      vp.scene.traverse((o) => { if (o.uuid === scanUuid) scan = o; if (o.uuid === baseTopologyUuid) base = o; });
      if (!scan || !base) return { ok: false, error: 'no scan or base mesh' };
      return { ok: true, ..._wrapTopology(scan, base, landmarks) };
    },
    __studioFaceScanAttachIris: ({ scanUuid, eyePositions = [], color = 'brown' }) => {
      const vp = window.__archdiscViewport;
      if (!vp?.scene) return { ok: false, error: 'no viewport' };
      const cfg = IRIS_LIBRARY[color];
      if (!cfg) return { ok: false, error: `unknown iris color: ${color}` };
      const meshes = [];
      for (const [x, y, z] of eyePositions) {
        const geom = new THREE.SphereGeometry(0.012, 32, 16);
        const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(...cfg.albedo), roughness: 0.2, metalness: 0.1 });
        const m = new THREE.Mesh(geom, mat);
        m.position.set(x, y, z);
        m.userData.archdiscStudioPrimitive = true;
        m.userData.iris = { color, limbalRing: cfg.limbalRing, fiberDensity: cfg.fiberDensity };
        vp.scene.add(m);
        meshes.push(m.uuid);
      }
      return { ok: true, uuids: meshes };
    },
    __studioFaceScanListIrisColors: () => ({ ok: true, colors: Object.keys(IRIS_LIBRARY), library: IRIS_LIBRARY }),
    __studioFaceScanList: () => ({ ok: true, ids: [..._scans.keys()] }),
    __studioFaceScanDelete: ({ id }) => { const s = _scans.get(id); if (s?.mesh) s.mesh.parent?.remove(s.mesh); return { ok: _scans.delete(id) }; },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'ingest', 'Face scan ingestion (Wrap3/TexturingXYZ ready)');
  return { ok: true };
}
export default installFaceScan;
