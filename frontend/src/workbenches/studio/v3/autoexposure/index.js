// ArchDisc Studio V3 — auto-exposure / eye adaptation (slice 928).
// Computes average luminance via downsampled mipmap; smoothly adjusts
// renderer.toneMappingExposure toward a target so dark scenes brighten
// and bright scenes dim — Unreal Eye Adaptation parity.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
let _enabled = false;
let _targetEV = 0.5;
let _currentEV = 1.0;
let _speed = 0.3;
let _hookInstalled = false;
function _measureLuminance() {
  const vp = window.__archdiscViewport;
  if (!vp?.renderer || !vp?.scene || !vp?.camera) return 0.5;
  // Render to a 64×64 target, read back, average
  const target = new THREE.WebGLRenderTarget(64, 64);
  const prev = vp.renderer.getRenderTarget();
  vp.renderer.setRenderTarget(target);
  if (vp.renderer.__studioOrigRender) {
    vp.renderer.__studioOrigRender(vp.scene, vp.camera);
  } else {
    vp.renderer.render(vp.scene, vp.camera);
  }
  vp.renderer.setRenderTarget(prev);
  const buf = new Uint8Array(64 * 64 * 4);
  vp.renderer.readRenderTargetPixels(target, 0, 0, 64, 64, buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i += 4) {
    sum += (buf[i] * 0.299 + buf[i + 1] * 0.587 + buf[i + 2] * 0.114) / 255;
  }
  target.dispose();
  return sum / (64 * 64);
}
function _tick() {
  if (!_enabled) return;
  const vp = window.__archdiscViewport;
  if (!vp?.renderer) return;
  // Sample every ~10 frames to keep cost low.
  if ((_tick._counter = (_tick._counter || 0) + 1) % 10 !== 0) return;
  try {
    const lum = _measureLuminance();
    const wanted = _targetEV / Math.max(0.05, lum);
    _currentEV += (wanted - _currentEV) * _speed * 0.05;
    _currentEV = Math.max(0.1, Math.min(8, _currentEV));
    vp.renderer.toneMappingExposure = _currentEV;
  } catch (_) {}
}
function _hook() {
  if (_hookInstalled) return; _hookInstalled = true;
  const vp = window.__archdiscViewport;
  if (vp) { const prev = vp.__studioAnimTick; vp.__studioAnimTick = (n) => { prev?.(n); _tick(); }; }
}
export function installAutoExposure() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioAutoExposureEnable: ({ on, targetEV, speed } = {}) => {
      if (on != null) _enabled = !!on;
      if (targetEV != null) _targetEV = targetEV;
      if (speed != null) _speed = speed;
      _hook();
      return { ok: true, enabled: _enabled, targetEV: _targetEV, currentEV: _currentEV };
    },
    __studioAutoExposureGetStats: () => ({ ok: true, enabled: _enabled, targetEV: _targetEV, currentEV: _currentEV, speed: _speed }),
    __studioAutoExposureMeasure: () => ({ ok: true, luminance: _measureLuminance() }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'Auto-exposure / eye adaptation');
  return { ok: true };
}
export default installAutoExposure;
