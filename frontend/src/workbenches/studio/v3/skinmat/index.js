// ArchDisc Studio V3 — skin SSS material (slice 814).
// Approximates subsurface scattering via diffuse-color biasing + emissive
// rim that mimics light bleed at thin geometry (ears, fingers, lips).
// Drop-in replacement for MeshStandardMaterial when modelling characters.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
const _SKIN_PRESETS = {
  caucasian:  { base: 0xd7a896, sss: 0xff8866, sssIntensity: 0.35, roughness: 0.55 },
  asian:      { base: 0xe2bb95, sss: 0xff9070, sssIntensity: 0.35, roughness: 0.5  },
  african:    { base: 0x6e4a36, sss: 0x8a3018, sssIntensity: 0.25, roughness: 0.5  },
  latino:     { base: 0xbf8a6c, sss: 0xc05030, sssIntensity: 0.3,  roughness: 0.55 },
  porcelain:  { base: 0xf6e0d4, sss: 0xff7060, sssIntensity: 0.5,  roughness: 0.4  },
  tanned:     { base: 0xa87a58, sss: 0xc05030, sssIntensity: 0.3,  roughness: 0.6  },
};
function _build(presetName = 'caucasian', opts = {}) {
  const p = { ..._SKIN_PRESETS[presetName] || _SKIN_PRESETS.caucasian, ...opts };
  const mat = new THREE.MeshPhysicalMaterial({
    color: p.base,
    roughness: p.roughness,
    metalness: 0,
    clearcoat: 0.1,
    clearcoatRoughness: 0.4,
    transmission: 0,
    sheen: 0.15,
    sheenColor: p.sss,
    sheenRoughness: 0.6,
    emissive: p.sss,
    emissiveIntensity: p.sssIntensity * 0.18,
  });
  mat.userData.archdiscStudioSkinSSS = true;
  mat.userData.archdiscStudioSkinPreset = presetName;
  return mat;
}
function _apply({ meshUuid, preset = 'caucasian', opts } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const m = scene.getObjectByProperty('uuid', meshUuid); if (!m) return { ok: false };
  const old = m.material;
  m.material = _build(preset, opts);
  try { old?.dispose?.(); } catch (_) {}
  return { ok: true, uuid: meshUuid, preset };
}
export function installSkinMat() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioSkinApply: _apply,
    __studioSkinListPresets: () => ({ ok: true, presets: Object.keys(_SKIN_PRESETS) }),
    __studioSkinGetPreset: ({ name } = {}) => ({ ok: true, preset: _SKIN_PRESETS[name] || null }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'texpaint', 'Skin SSS material (Unreal CharacterShader-tier)');
  return { ok: true };
}
export default installSkinMat;
