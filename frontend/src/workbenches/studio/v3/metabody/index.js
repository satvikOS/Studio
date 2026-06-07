// ArchDisc Studio V3 — MetaHuman-tier body presets / character creator
// (slice 817). Generates a parameterised humanoid body from gender +
// height + build + ethnicity preset. Spawns a low-poly base mesh with
// proper anatomical proportions ready for auto-rig (slice 813).

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
const _BUILD_PRESETS = {
  slim:      { headSize: 0.045, shoulderW: 0.115, chestW: 0.105, waistW: 0.090, hipW: 0.105 },
  average:   { headSize: 0.050, shoulderW: 0.135, chestW: 0.125, waistW: 0.105, hipW: 0.125 },
  athletic:  { headSize: 0.052, shoulderW: 0.155, chestW: 0.145, waistW: 0.110, hipW: 0.130 },
  heavy:     { headSize: 0.055, shoulderW: 0.165, chestW: 0.165, waistW: 0.155, hipW: 0.160 },
  muscular:  { headSize: 0.050, shoulderW: 0.170, chestW: 0.160, waistW: 0.115, hipW: 0.135 },
};
const _GENDER_PRESETS = {
  male:      { hipChestRatio: 0.92, shoulderBias: 1.10, headWidthBias: 1.05 },
  female:    { hipChestRatio: 1.05, shoulderBias: 0.92, headWidthBias: 0.95 },
  androgynous: { hipChestRatio: 1.0, shoulderBias: 1.0, headWidthBias: 1.0 },
};
function _buildBody({ gender = 'male', build = 'average', height = 1.75, skinPreset = 'caucasian' } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const b = _BUILD_PRESETS[build] || _BUILD_PRESETS.average;
  const g = _GENDER_PRESETS[gender] || _GENDER_PRESETS.androgynous;
  const scale = height / 1.75; // 1.75m reference
  const group = new THREE.Group();
  // Use slice 814 skin shader if loaded
  const mat = (typeof window.__studioSkinApply === 'function')
    ? null // we'll apply later via skin op
    : new THREE.MeshStandardMaterial({ color: 0xd7a896, roughness: 0.55 });
  const parts = [
    // [name, type, [w,h,d], [x,y,z]]
    ['head', 'sphere', [b.headSize * g.headWidthBias * scale, b.headSize * scale, b.headSize * scale], [0, 1.62 * scale, 0]],
    ['neck', 'cylinder', [b.headSize * 0.5 * scale, b.headSize * 0.5 * scale, b.headSize * 0.5 * scale], [0, 1.55 * scale, 0]],
    ['chest', 'box', [b.shoulderW * g.shoulderBias * scale, 0.18 * scale, b.chestW * 0.5 * scale], [0, 1.42 * scale, 0]],
    ['waist', 'box', [b.waistW * scale, 0.08 * scale, b.waistW * 0.5 * scale], [0, 1.18 * scale, 0]],
    ['hips', 'box', [b.hipW * g.hipChestRatio * scale, 0.08 * scale, b.hipW * 0.5 * scale], [0, 1.08 * scale, 0]],
    ['armL', 'cylinder', [0.022 * scale, 0.022 * scale, 0.32 * scale], [b.shoulderW * 0.7 * scale, 1.30 * scale, 0]],
    ['armR', 'cylinder', [0.022 * scale, 0.022 * scale, 0.32 * scale], [-b.shoulderW * 0.7 * scale, 1.30 * scale, 0]],
    ['forearmL', 'cylinder', [0.020 * scale, 0.020 * scale, 0.27 * scale], [b.shoulderW * 0.7 * scale, 1.05 * scale, 0]],
    ['forearmR', 'cylinder', [0.020 * scale, 0.020 * scale, 0.27 * scale], [-b.shoulderW * 0.7 * scale, 1.05 * scale, 0]],
    ['legL', 'cylinder', [0.045 * scale, 0.045 * scale, 0.42 * scale], [b.hipW * 0.4 * scale, 0.75 * scale, 0]],
    ['legR', 'cylinder', [0.045 * scale, 0.045 * scale, 0.42 * scale], [-b.hipW * 0.4 * scale, 0.75 * scale, 0]],
    ['shinL', 'cylinder', [0.038 * scale, 0.038 * scale, 0.40 * scale], [b.hipW * 0.4 * scale, 0.30 * scale, 0]],
    ['shinR', 'cylinder', [0.038 * scale, 0.038 * scale, 0.40 * scale], [-b.hipW * 0.4 * scale, 0.30 * scale, 0]],
  ];
  for (const [name, type, dims, pos] of parts) {
    let geom;
    if (type === 'sphere') geom = new THREE.SphereGeometry(dims[0], 12, 8);
    else if (type === 'cylinder') geom = new THREE.CylinderGeometry(dims[0], dims[1], dims[2], 12);
    else geom = new THREE.BoxGeometry(dims[0], dims[1], dims[2]);
    const partMat = mat ? mat.clone() : new THREE.MeshStandardMaterial({ color: 0xd7a896, roughness: 0.55 });
    const part = new THREE.Mesh(geom, partMat);
    part.position.set(...pos);
    part.name = name;
    group.add(part);
  }
  group.userData.archdiscStudioPrimitive = true;
  group.userData.archdiscStudioPrimitiveKind = 'metabody';
  group.userData.archdiscStudioMetaBodyParams = { gender, build, height, skinPreset };
  scene.add(group);
  // Apply skin SSS to every part if available
  if (typeof window.__studioSkinApply === 'function') {
    group.traverse((o) => { if (o.isMesh) window.__studioSkinApply({ meshUuid: o.uuid, preset: skinPreset }); });
  }
  return { ok: true, uuid: group.uuid, partCount: parts.length, params: { gender, build, height, skinPreset } };
}
export function installMetaBody() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioMetaBodyBuild: _buildBody,
    __studioMetaBodyListBuilds: () => ({ ok: true, builds: Object.keys(_BUILD_PRESETS) }),
    __studioMetaBodyListGenders: () => ({ ok: true, genders: Object.keys(_GENDER_PRESETS) }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rig', 'MetaHuman-tier body presets');
  return { ok: true };
}
export default installMetaBody;
