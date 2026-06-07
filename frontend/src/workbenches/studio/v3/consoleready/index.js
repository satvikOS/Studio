// ArchDisc Studio V3 — console-readiness validator (slice 903).
// Checks the scene against Switch / PS5 / Xbox Series asset guidelines.

import { registerOps } from '../common/registry.js';
let _installed = false;
const PLATFORMS = {
  switch:        { maxTris: 100000,  maxTexture: 1024, maxBones: 50,  maxDrawCalls: 200 },
  ps5_quality:   { maxTris: 2000000, maxTexture: 4096, maxBones: 250, maxDrawCalls: 2000 },
  ps5_perf:      { maxTris: 1000000, maxTexture: 2048, maxBones: 150, maxDrawCalls: 1500 },
  xbox_series_x: { maxTris: 2000000, maxTexture: 4096, maxBones: 250, maxDrawCalls: 2000 },
  xbox_series_s: { maxTris: 1000000, maxTexture: 2048, maxBones: 150, maxDrawCalls: 1500 },
  pc_ultra:      { maxTris: 4000000, maxTexture: 8192, maxBones: 500, maxDrawCalls: 5000 },
};
function _validate({ platform = 'ps5_quality' } = {}) {
  const limits = PLATFORMS[platform]; if (!limits) return { ok: false, error: 'unknown platform' };
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  let totalTris = 0, drawCalls = 0, maxTexSize = 0, maxBones = 0;
  const issues = [];
  scene.traverse((o) => {
    if (o.isMesh) {
      drawCalls++;
      if (o.geometry?.index) totalTris += o.geometry.index.count / 3;
      else if (o.geometry?.attributes?.position) totalTris += o.geometry.attributes.position.count / 3;
      const mat = o.material;
      const tex = mat?.map;
      if (tex?.image) {
        const size = Math.max(tex.image.width || 0, tex.image.height || 0);
        if (size > maxTexSize) maxTexSize = size;
        if (size > limits.maxTexture) issues.push({ kind: 'texture-too-large', uuid: o.uuid, size, limit: limits.maxTexture });
      }
    }
    if (o.isSkinnedMesh) {
      const bones = o.skeleton?.bones?.length || 0;
      if (bones > maxBones) maxBones = bones;
      if (bones > limits.maxBones) issues.push({ kind: 'too-many-bones', uuid: o.uuid, bones, limit: limits.maxBones });
    }
  });
  if (totalTris > limits.maxTris) issues.push({ kind: 'triangle-budget-exceeded', triCount: totalTris, limit: limits.maxTris });
  if (drawCalls > limits.maxDrawCalls) issues.push({ kind: 'draw-call-budget-exceeded', drawCalls, limit: limits.maxDrawCalls });
  return { ok: true, platform, issues, stats: { totalTris, drawCalls, maxTexSize, maxBones }, ready: issues.length === 0 };
}
export function installConsoleReady() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioConsoleListPlatforms: () => ({ ok: true, platforms: Object.keys(PLATFORMS) }),
    __studioConsoleValidate: _validate,
    __studioConsoleGetLimits: ({ platform } = {}) => ({ ok: true, limits: PLATFORMS[platform] || null }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'interop', 'Console-readiness validator (Switch/PS5/Xbox)');
  return { ok: true };
}
export default installConsoleReady;
