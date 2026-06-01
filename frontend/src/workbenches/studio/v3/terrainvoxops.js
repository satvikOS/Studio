// ArchDisc Studio V3 — terrain / voxel / volume family.
//
// V3-native ports of:
//   __studioAddMountain     — fBm-displaced sphere (Houdini Mountain SOP)
//   __studioTerrainAdd      — heightmap-backed plane terrain
//   __studioTerrainSculpt   — radial brush over the terrain heightmap
//   __studioMarchVoxelGrid  — marching-cubes mesh from a 3D Uint8 grid
//   __studioVoxelizeMesh    — rasterize a mesh into a voxel grid
//   __studioAddVolume       — ray-marched fBm volume box (raymarched fog)
//
// All ops are direct ports of the V2 implementations (no React refs).

import * as THREE from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';

function scene() {
  return window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene) || null;
}
function activeMesh() {
  const vp = window.__archdiscViewport;
  return (vp && vp.getSelected && vp.getSelected()) || null;
}
function attachAndSelect(mesh) {
  const s = scene(); if (!s) return;
  s.add(mesh);
  if (window.__studioSelectMesh) { try { window.__studioSelectMesh(mesh); } catch (_) {} }
}

function addMountain(opts = {}) {
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  const { radius = 0.04, segments = 64, strength = 0.35, seed = 1, color = '#8a8d75' } = opts;
  const geo = new THREE.SphereGeometry(radius, segments, Math.max(8, segments / 2));
  const pos = geo.attributes.position;
  const hash = (x, y, z) => {
    const h = ((x * 374761393) ^ (y * 668265263) ^ (z * 99277) ^ (seed * 1597)) >>> 0;
    return (h % 65536) / 65536;
  };
  const noise = (x, y, z) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const w = fz * fz * (3 - 2 * fz);
    const c000 = hash(ix,     iy,     iz);
    const c100 = hash(ix + 1, iy,     iz);
    const c010 = hash(ix,     iy + 1, iz);
    const c110 = hash(ix + 1, iy + 1, iz);
    const c001 = hash(ix,     iy,     iz + 1);
    const c101 = hash(ix + 1, iy,     iz + 1);
    const c011 = hash(ix,     iy + 1, iz + 1);
    const c111 = hash(ix + 1, iy + 1, iz + 1);
    return ((c000 * (1 - u) + c100 * u) * (1 - v) + (c010 * (1 - u) + c110 * u) * v) * (1 - w)
         + ((c001 * (1 - u) + c101 * u) * (1 - v) + (c011 * (1 - u) + c111 * u) * v) * w;
  };
  const fbm = (x, y, z) => 0.5 * noise(x, y, z) + 0.25 * noise(x * 2, y * 2, z * 2) + 0.125 * noise(x * 4, y * 4, z * 4);
  const freq = 5.5 / radius;
  const amp = strength * radius * 0.4;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, y, z) || 1e-6;
    const nx = x / r, ny = y / r, nz = z / r;
    const n = fbm(x * freq, y * freq, z * freq);
    const d = (n - 0.5) * amp * 2;
    pos.setXYZ(i, x + nx * d, y + ny * d, z + nz * d);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.85, flatShading: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'mountain';
  mesh.userData.archdiscStudioMountain = { radius, segments, strength, seed };
  mesh.userData.pickable = true;
  mesh.name = 'studio-primitive-mountain';
  attachAndSelect(mesh);
  return { ok: true, uuid: mesh.uuid, radius, segments, strength, seed, verts: pos.count };
}

function terrainAdd(opts = {}) {
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  const { width = 10, depth = 10, segments = 64 } = opts;
  const geo = new THREE.PlaneGeometry(width, depth, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const n = segments + 1;
  const heightmap = new Float32Array(n * n);
  const mat = new THREE.MeshStandardMaterial({ color: 0x6b8e4e, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'terrain';
  mesh.userData.studioTerrain = { width, depth, segments, n, heightmap };
  mesh.userData.pickable = true;
  mesh.name = 'studio-terrain';
  attachAndSelect(mesh);
  return { ok: true, uuid: mesh.uuid, name: mesh.name };
}

function terrainSculpt(opts = {}) {
  const { worldX = 0, worldZ = 0, mode = 'raise', radius = 1, strength = 0.1 } = opts;
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  let mesh = null;
  s.traverse((o) => { if (o.userData && o.userData.studioTerrain) mesh = o; });
  if (!mesh) return { ok: false, error: 'no terrain' };
  const t = mesh.userData.studioTerrain;
  const cellW = t.width / t.segments, cellD = t.depth / t.segments;
  const cx = (worldX + t.width / 2) / cellW;
  const cz = (worldZ + t.depth / 2) / cellD;
  const rCellsX = Math.ceil(radius / cellW), rCellsZ = Math.ceil(radius / cellD);
  const centerIdx = Math.min(t.n * t.n - 1, Math.max(0, Math.round(cz) * t.n + Math.round(cx)));
  const centerH = t.heightmap[centerIdx];
  let touched = 0;
  for (let j = Math.max(0, Math.floor(cz - rCellsZ)); j <= Math.min(t.n - 1, Math.ceil(cz + rCellsZ)); j++) {
    for (let i = Math.max(0, Math.floor(cx - rCellsX)); i <= Math.min(t.n - 1, Math.ceil(cx + rCellsX)); i++) {
      const dx = (i - cx) * cellW, dz = (j - cz) * cellD;
      const d = Math.hypot(dx, dz);
      if (d > radius) continue;
      const fall = 1 - d / radius;
      const k = j * t.n + i;
      if (mode === 'raise') t.heightmap[k] += strength * fall;
      else if (mode === 'lower') t.heightmap[k] -= strength * fall;
      else if (mode === 'flatten') t.heightmap[k] += (centerH - t.heightmap[k]) * fall * 0.5;
      else if (mode === 'smooth') {
        let sm = 0, cnt = 0;
        for (let jj = j - 1; jj <= j + 1; jj++) for (let ii = i - 1; ii <= i + 1; ii++) {
          if (ii < 0 || jj < 0 || ii >= t.n || jj >= t.n) continue;
          sm += t.heightmap[jj * t.n + ii]; cnt++;
        }
        t.heightmap[k] = (1 - fall) * t.heightmap[k] + fall * (sm / cnt);
      }
      touched++;
    }
  }
  const pos = mesh.geometry.attributes.position;
  for (let k = 0; k < t.n * t.n; k++) pos.array[k * 3 + 1] = t.heightmap[k];
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  return { ok: true, touched, mode };
}

function marchVoxelGrid(opts) {
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  const { grid, resolution, bbox } = (opts || {});
  if (!grid || !resolution || !bbox) return { ok: false, error: 'grid/resolution/bbox required' };
  const res = resolution | 0;
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.15, roughness: 0.6 });
  const mc = new MarchingCubes(res, mat, false, false, 60000);
  mc.init(res); mc.isolation = 0.5;
  for (let k = 0; k < res; k++) {
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        if (grid[(k * res + j) * res + i]) mc.setCell(i, j, k, 1.0);
      }
    }
  }
  try { mc.blur(1); } catch (_) {}
  mc.update();
  const vCount = mc.count;
  if (!vCount) return { ok: false, error: 'no surface extracted' };
  const minX = bbox.min[0], minY = bbox.min[1], minZ = bbox.min[2];
  const sx = bbox.max[0] - bbox.min[0], sy = bbox.max[1] - bbox.min[1], sz = bbox.max[2] - bbox.min[2];
  const posArr = new Float32Array(vCount * 3);
  const nrmArr = new Float32Array(vCount * 3);
  for (let n = 0; n < vCount * 3; n += 3) {
    posArr[n]     = minX + (mc.positionArray[n]     + 1) * 0.5 * sx;
    posArr[n + 1] = minY + (mc.positionArray[n + 1] + 1) * 0.5 * sy;
    posArr[n + 2] = minZ + (mc.positionArray[n + 2] + 1) * 0.5 * sz;
    nrmArr[n]     = mc.normalArray[n];
    nrmArr[n + 1] = mc.normalArray[n + 1];
    nrmArr[n + 2] = mc.normalArray[n + 2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(nrmArr, 3));
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  const outMesh = new THREE.Mesh(geo, mat);
  outMesh.userData.archdiscStudioPrimitive = true;
  outMesh.userData.archdiscStudioPrimitiveKind = 'voxel-march';
  outMesh.userData.archdiscStudioVoxelMarched = { resolution: res, vertices: vCount };
  outMesh.userData.pickable = true;
  outMesh.name = 'studio-primitive-voxelmarch';
  attachAndSelect(outMesh);
  return { ok: true, uuid: outMesh.uuid, vertices: vCount, resolution: res };
}

function voxelizeMesh(opts) {
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  const { meshUuid, resolution = 16 } = (opts || {});
  let mesh = activeMesh();
  if (meshUuid) s.traverse((o) => { if (o.isMesh && o.uuid === meshUuid) mesh = o; });
  if (!mesh || !mesh.geometry) return { ok: false, error: 'no mesh' };
  const res = Math.max(8, Math.min(32, resolution | 0));
  mesh.updateMatrixWorld(true);
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  g.applyMatrix4(mesh.matrixWorld);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const ex = bb.max.x - bb.min.x, ey = bb.max.y - bb.min.y, ez = bb.max.z - bb.min.z;
  const pad = Math.max(ex, ey, ez) * 0.04 + 1e-5;
  const minX = bb.min.x - pad, minY = bb.min.y - pad, minZ = bb.min.z - pad;
  const csX = (ex + 2 * pad) / res, csY = (ey + 2 * pad) / res, csZ = (ez + 2 * pad) / res;
  const grid = new Uint8Array(res * res * res);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), P = new THREE.Vector3();
  const pos = g.attributes.position;
  const tris = pos.count / 3;
  const stepDen = res * 2;
  for (let t = 0; t < tris; t++) {
    A.fromBufferAttribute(pos, t * 3);
    B.fromBufferAttribute(pos, t * 3 + 1);
    C.fromBufferAttribute(pos, t * 3 + 2);
    for (let u = 0; u <= stepDen; u++) {
      for (let v = 0; v <= stepDen - u; v++) {
        const a = u / stepDen, b = v / stepDen, c = 1 - a - b;
        P.set(A.x * a + B.x * b + C.x * c, A.y * a + B.y * b + C.y * c, A.z * a + B.z * b + C.z * c);
        const i = Math.floor((P.x - minX) / csX);
        const j = Math.floor((P.y - minY) / csY);
        const k = Math.floor((P.z - minZ) / csZ);
        if (i >= 0 && j >= 0 && k >= 0 && i < res && j < res && k < res) {
          grid[(k * res + j) * res + i] = 1;
        }
      }
    }
  }
  let voxelCount = 0;
  for (let n = 0; n < grid.length; n++) if (grid[n]) voxelCount++;
  g.dispose();
  mesh.userData.archdiscStudioVoxelized = { resolution: res, voxelCount };
  return {
    ok: true, resolution: res, voxelCount,
    bbox: { min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z] },
    grid,
  };
}

function addVolume(opts = {}) {
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  const { size = 0.3, density = 0.6, color = 0xb0c4d8, steps = 32 } = opts;
  const sz = Math.max(0.01, Number(size));
  const stepsClamped = Math.max(8, Math.min(96, steps | 0));
  const vertexShader = `
    varying vec3 vLocalPos;
    void main() {
      vLocalPos = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const fragmentShader = `
    varying vec3 vLocalPos;
    uniform vec3  uCamLocal;
    uniform vec3  uColor;
    uniform float uDensity;
    uniform int   uSteps;
    uniform float uTime;
    float hash(vec3 p){ return fract(sin(dot(p, vec3(17.1,113.5,71.7))) * 43758.5453); }
    float noise(vec3 p){
      vec3 i = floor(p), f = fract(p);
      f = f*f*(3.0-2.0*f);
      float n = mix(mix(mix(hash(i), hash(i+vec3(1,0,0)),f.x),
                        mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)),f.x), f.y),
                    mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)),f.x),
                        mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)),f.x), f.y), f.z);
      return n;
    }
    float fbm(vec3 p){ return 0.5*noise(p) + 0.25*noise(p*2.03) + 0.125*noise(p*4.07); }
    void main(){
      vec3 rd = normalize(vLocalPos - uCamLocal);
      float tStep = 1.0 / float(uSteps);
      float alpha = 0.0;
      vec3 pos = vLocalPos;
      for (int i = 0; i < 96; i++) {
        if (i >= uSteps) break;
        if (any(greaterThan(abs(pos), vec3(0.5)))) break;
        float d = fbm(pos * 4.0 + vec3(0.0, uTime * 0.05, 0.0));
        d = smoothstep(0.45, 0.75, d);
        alpha += (1.0 - alpha) * d * uDensity * tStep * float(uSteps);
        pos += rd * tStep;
      }
      if (alpha < 0.01) discard;
      gl_FragColor = vec4(uColor, clamp(alpha, 0.0, 1.0));
    }
  `;
  const uniforms = {
    uCamLocal: { value: new THREE.Vector3() },
    uColor:    { value: new THREE.Color(color) },
    uDensity:  { value: density },
    uSteps:    { value: stepsClamped },
    uTime:     { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms,
    transparent: true, depthWrite: false, side: THREE.BackSide,
  });
  const geo = new THREE.BoxGeometry(sz, sz, sz);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    mesh.worldToLocal(uniforms.uCamLocal.value.copy(camera.position));
    uniforms.uTime.value = performance.now() / 1000;
  };
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'volume';
  mesh.userData.archdiscStudioVolume = { size: sz, density, color, steps: stepsClamped };
  mesh.userData.pickable = true;
  mesh.name = 'studio-primitive-volume';
  attachAndSelect(mesh);
  return { ok: true, uuid: mesh.uuid, size: sz, density, color, steps: stepsClamped };
}

export function registerTerrainVoxOps() {
  window.__studioAddMountain    = addMountain;
  window.__studioTerrainAdd     = terrainAdd;
  window.__studioTerrainSculpt  = terrainSculpt;
  window.__studioMarchVoxelGrid = marchVoxelGrid;
  window.__studioVoxelizeMesh   = voxelizeMesh;
  window.__studioAddVolume      = addVolume;
}

export function unregisterTerrainVoxOps() {
  for (const k of [
    '__studioAddMountain', '__studioTerrainAdd', '__studioTerrainSculpt',
    '__studioMarchVoxelGrid', '__studioVoxelizeMesh', '__studioAddVolume',
  ]) { try { delete window[k]; } catch (_) {} }
}
