// ArchDisc Studio V3 — shader-graph ↔ GPU path tracer bridge installer.
//
// Attaches the bridge's op surface to window and registers each function
// with the V3 command palette under category 'rt' (alongside the CPU
// tracer + GPU PT ops, since the bridge is a GPU-PT augmentation).
//
// Op contract per the slice brief:
//
//   __studioShaderPTBridgeEnable()      → { ok }
//   __studioShaderPTBridgeDisable()
//   __studioShaderPTBridgeIsEnabled()   → { ok, on }
//   __studioShaderPTBridgeForceRebuild()
//
// We mirror the same retry-loop the rtgpu installer uses for the command
// palette so the registration succeeds whether autoload runs before or
// after registerV3Api(). Re-installs are idempotent.

import { enable, disable, isEnabled, forceRebuild, runOnce } from './bridge.js';
import { registerOp, unregisterOps } from '../common/registry.js';

let _installed = false;

// Wraps enable() so the op layer can present a stable shape to agent
// plans (always returns { ok }, never throws). Same wrap pattern used by
// the slice-693 GPU PT and the slice-684 CPU tracer index modules.
function bridgeEnable() {
  try {
    const r = enable();
    return r || { ok: false, error: 'enable returned no result' };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

function bridgeDisable() {
  try {
    const r = disable();
    return r || { ok: true, on: false };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

function bridgeIsEnabled() {
  try {
    return isEnabled();
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

function bridgeForceRebuild() {
  try {
    const r = forceRebuild();
    return r || { ok: false, error: 'force rebuild returned no result' };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

// Exposed for tests + debugging. Runs the tint pass once without
// triggering a GPU PT rebuild. Useful for asserting "did the bridge
// actually see this mesh?" without waiting for the next animation frame.
function bridgeRunOnce() {
  try {
    const r = runOnce();
    return r || { ok: false, error: 'run-once returned no result' };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

// Same registration helper rtgpu/index.js uses, sourced from common/
// (slice 695). Attaches to window then queues a retry if the V3 command
// registry isn't installed yet.
function _reg(name, fn, description) {
  registerOp(name, fn, 'rt', description);
}

export function installShaderPTBridge() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, already: true };
  _installed = true;

  _reg('__studioShaderPTBridgeEnable', bridgeEnable,
    'Enable shader-graph → GPU path tracer per-frame texture bridge.');
  _reg('__studioShaderPTBridgeDisable', bridgeDisable,
    'Disable the shader-graph → GPU PT bridge + restore base material colours.');
  _reg('__studioShaderPTBridgeIsEnabled', bridgeIsEnabled,
    'Probe whether the shader-graph → GPU PT bridge is currently active.');
  _reg('__studioShaderPTBridgeForceRebuild', bridgeForceRebuild,
    'Force a one-shot tint pass + GPU PT rebuild, bypassing the rebuild cool-down.');
  _reg('__studioShaderPTBridgeRunOnce', bridgeRunOnce,
    'Run the shader-graph tint pass once without triggering a GPU PT rebuild (debug).');

  return { ok: true, ops: 5 };
}

export function uninstallShaderPTBridge() {
  if (!_installed) return { ok: true };
  // Ensure tints are cleaned up first so meshes aren't left coloured.
  try { bridgeDisable(); } catch (_) { /* swallow */ }
  const names = [
    '__studioShaderPTBridgeEnable',
    '__studioShaderPTBridgeDisable',
    '__studioShaderPTBridgeIsEnabled',
    '__studioShaderPTBridgeForceRebuild',
    '__studioShaderPTBridgeRunOnce',
  ];
  unregisterOps(names);
  _installed = false;
  return { ok: true };
}

// Re-exports so tests / future internal callers can reach the underlying
// machinery without going through the window surface.
export { enable, disable, isEnabled, forceRebuild, runOnce } from './bridge.js';
export { sampleTextureAtUV } from './sampler.js';
