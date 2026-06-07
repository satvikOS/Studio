// ArchDisc Studio V3 — cel / toon shader (slice 860).
// Replaces a mesh material with MeshToonMaterial + ramp gradient.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
function _gradient(steps = 3) {
  const c = document.createElement('canvas'); c.width = steps; c.height = 1;
  const ctx = c.getContext('2d');
  for (let i = 0; i < steps; i++) {
    const v = Math.round(((i + 1) / steps) * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(i, 0, 1, 1);
  }
  const t = new THREE.CanvasTexture(c); t.minFilter = t.magFilter = THREE.NearestFilter;
  return t;
}
function _apply({ meshUuid, steps = 3, color } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const m = scene.getObjectByProperty('uuid', meshUuid); if (!m) return { ok: false };
  const mat = new THREE.MeshToonMaterial({ color: color != null ? color : (m.material?.color?.getHex?.() ?? 0xcccccc), gradientMap: _gradient(steps) });
  try { m.material?.dispose?.(); } catch (_) {}
  m.material = mat;
  m.userData.archdiscStudioCelSteps = steps;
  return { ok: true };
}
export function installCelShader() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioCelApply: _apply,
    __studioCelOutline: ({ meshUuid, thickness = 0.005 } = {}) => {
      const scene = window.__archdiscScene; if (!scene) return { ok: false };
      const m = scene.getObjectByProperty('uuid', meshUuid); if (!m) return { ok: false };
      const outline = m.clone();
      outline.material = new THREE.MeshBasicMaterial({ color: 0, side: THREE.BackSide });
      outline.scale.multiplyScalar(1 + thickness);
      outline.userData.archdiscStudioCelOutline = true;
      m.add(outline);
      return { ok: true };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'texpaint', 'Cel / toon shader');
  return { ok: true };
}
export default installCelShader;
