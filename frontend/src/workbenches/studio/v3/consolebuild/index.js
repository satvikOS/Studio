// ArchDisc Studio V3 — console build target adapter shells (slice 944).
// PS5 / Xbox Series / Switch 2 SDK plug-in seams (loud errors without adapters).
import { registerOps } from '../common/registry.js';

const TARGETS = {
  'pc-windows': { abi: 'x64-msvc', texFormat: 'BC7', audioFormat: 'WAV', native: true },
  'pc-mac':     { abi: 'arm64-apple', texFormat: 'BC7', audioFormat: 'WAV', native: true },
  'pc-linux':   { abi: 'x64-elf', texFormat: 'BC7', audioFormat: 'WAV', native: true },
  'web-wasm':   { abi: 'wasm32', texFormat: 'KTX2-BasisU', audioFormat: 'OGG', native: true },
  'mobile-ios':     { abi: 'arm64-apple', texFormat: 'ASTC', audioFormat: 'AAC', native: true },
  'mobile-android': { abi: 'arm64-android', texFormat: 'ASTC', audioFormat: 'OGG', native: true },
  'console-ps5':   { abi: 'amd64-ps5', texFormat: 'BC7', audioFormat: 'Opus/Wwise', native: false, requiredSDK: 'Sony PS5 SDK (NDA)' },
  'console-xsx':   { abi: 'amd64-xbox', texFormat: 'BC7', audioFormat: 'XMA2', native: false, requiredSDK: 'Microsoft Xbox Series GDK (NDA)' },
  'console-switch2': { abi: 'arm64-switch2', texFormat: 'ASTC', audioFormat: 'ADX', native: false, requiredSDK: 'Nintendo Switch 2 SDK (NDA)' },
};

const _adapters = new Map(); // id → adapter

let _installed = false;

function _requireAdapter(targetId) {
  const t = TARGETS[targetId];
  if (!t) throw Object.assign(new Error(`unknown target: ${targetId}`), { code: 'UNKNOWN_TARGET' });
  if (t.native) return null;
  const id = targetId.replace('console-', '');
  const adapter = _adapters.get(id);
  if (!adapter) {
    const err = new Error(`Build target ${targetId} requires a licensed SDK adapter.`);
    err.requiredSDK = t.requiredSDK;
    err.code = 'SDK_REQUIRED';
    throw err;
  }
  return adapter;
}

export function installConsoleBuild() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioConsoleBuildTargets: () => ({ ok: true, targets: TARGETS }),
    __studioConsoleBuildTranscode: async ({ target, asset }) => {
      try {
        const adapter = _requireAdapter(target);
        if (!adapter) return { ok: true, transcoded: asset, target, format: TARGETS[target].texFormat };
        const out = await adapter.transcodeTexture(asset);
        return { ok: true, transcoded: out, target, format: TARGETS[target].texFormat };
      } catch (e) { return { ok: false, error: e.message, requiredSDK: e.requiredSDK, code: e.code }; }
    },
    __studioConsoleBuildCompileShader: async ({ target, glsl }) => {
      try {
        const adapter = _requireAdapter(target);
        if (!adapter) return { ok: true, compiled: glsl, target };
        const out = await adapter.compileShader({ glsl, target });
        return { ok: true, compiled: out, target };
      } catch (e) { return { ok: false, error: e.message, requiredSDK: e.requiredSDK, code: e.code }; }
    },
    __studioConsoleBuildPackage: async ({ target, assets, shaders, metadata }) => {
      try {
        const adapter = _requireAdapter(target);
        if (!adapter) return { ok: true, descriptor: { target, assets: assets?.length || 0, shaders: shaders?.length || 0, metadata } };
        const pkg = await adapter.packageBundle({ assets, shaders, metadata });
        return { ok: true, package: pkg, target };
      } catch (e) { return { ok: false, error: e.message, requiredSDK: e.requiredSDK, code: e.code }; }
    },
    __studioConsoleBuildValidate: async ({ target, build }) => {
      try {
        const adapter = _requireAdapter(target);
        if (!adapter) return { ok: true, valid: true, target };
        const res = await adapter.validateTRC(build);
        return { ok: true, ...res, target };
      } catch (e) { return { ok: false, error: e.message, requiredSDK: e.requiredSDK, code: e.code }; }
    },
    __studioSDKAdapterRegister: ({ adapter }) => {
      if (!adapter?.id || typeof adapter.transcodeTexture !== 'function' || typeof adapter.compileShader !== 'function' || typeof adapter.packageBundle !== 'function') {
        return { ok: false, error: 'adapter must implement {id, transcodeTexture, compileShader, packageBundle, validateTRC, signBuild}' };
      }
      _adapters.set(adapter.id, adapter);
      return { ok: true, adapterId: adapter.id };
    },
    __studioSDKAdapterList: () => ({ ok: true, registered: [..._adapters.keys()], slots: ['ps5', 'xsx', 'switch2'] }),
    __studioSDKAdapterUnregister: ({ id }) => ({ ok: _adapters.delete(id) }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'build', 'Console build target adapter shells (PS5/XSX/Switch2)');
  return { ok: true };
}
export default installConsoleBuild;
