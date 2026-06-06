// Slice 698 — Volumetric smoke/fire rendering.

import { registerOps } from '../common/registry.js';
import {
  createVolume, listVolumes, setVoxel, clearVolume, deleteVolume, getVolume,
} from './grid.js';
import { buildProxyMesh, updateProxyParams } from './proxy.js';
import { cloudPuff, firePlume, groundFog, plasma } from './generators.js';
// Slice 730 — Pyro / gas simulation (Houdini Pyro FX, Blender Mantaflow,
// FumeFX, EmberGen). Stam stable-fluids solver on the volume grid.
import {
  initPyro, addEmitter, clearEmitters, setPyroParam, stepPyro,
  pyroStats, resetPyro, deletePyro, listPyro,
  addFuelEmitter, clearFuelEmitters,
} from './pyro.js';

let _installed = false;
let _params = { densityScale: 1.0, tempScale: 1.0, steps: 64, lightDir: [0.4, 0.7, 0.5] };
let _activeUuid = null;

function _create(sx, sy, sz, voxelSize) {
  const r = createVolume(sx, sy, sz, voxelSize);
  if (!r.ok) return r;
  _activeUuid = r.uuid;
  buildProxyMesh(r.uuid, _params);
  return r;
}

function _generate(kind) {
  if (!_activeUuid) {
    const r = _create(64, 64, 64, 0.05);
    if (!r.ok) return r;
  }
  if (kind === 'cloud') return cloudPuff(_activeUuid);
  if (kind === 'fire') return firePlume(_activeUuid);
  if (kind === 'fog') return groundFog(_activeUuid);
  if (kind === 'plasma') return plasma(_activeUuid);
  return { ok: false, error: 'unknown kind' };
}

function _setDensityScale(v) { _params.densityScale = Number(v); if (_activeUuid) updateProxyParams(_activeUuid, _params); return { ok: true, v: _params.densityScale }; }
function _setTempScale(v) { _params.tempScale = Number(v); if (_activeUuid) updateProxyParams(_activeUuid, _params); return { ok: true, v: _params.tempScale }; }
function _setSteps(n) { _params.steps = Math.max(8, Math.min(256, Math.floor(n))); if (_activeUuid) updateProxyParams(_activeUuid, _params); return { ok: true, v: _params.steps }; }
function _setLightDir(arr) { if (Array.isArray(arr) && arr.length === 3) _params.lightDir = arr.slice(); if (_activeUuid) updateProxyParams(_activeUuid, _params); return { ok: true, v: _params.lightDir }; }

export function installVolume() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioVolumeCreate: _create,
    __studioVolumeGenerate: _generate,
    __studioVolumeList: () => ({ ok: true, count: listVolumes().length, volumes: listVolumes() }),
    __studioVolumeSetVoxel: (x, y, z, d, t) => _activeUuid ? setVoxel(_activeUuid, x, y, z, d, t) : { ok: false },
    __studioVolumeClear: () => _activeUuid ? clearVolume(_activeUuid) : { ok: false },
    __studioVolumeDelete: (uuid) => { const r = deleteVolume(uuid || _activeUuid); if ((uuid || _activeUuid) === _activeUuid) _activeUuid = null; return r; },
    __studioVolumeSetDensityScale: _setDensityScale,
    __studioVolumeSetTemperatureScale: _setTempScale,
    __studioVolumeSetSteps: _setSteps,
    __studioVolumeSetLightDir: _setLightDir,
    __studioVolumeGetActive: () => ({ ok: true, uuid: _activeUuid, params: { ..._params } }),

    // ── Slice 730 — Pyro / gas simulation ──────────────────────────
    // Eulerian stable-fluids solver. These operate on the active volume
    // by default; pass an explicit uuid to target another.
    __studioPyroInit: (uuid) => initPyro(uuid || _activeUuid),
    __studioPyroAddEmitter: (x, y, z, radius, density, temperature, velocity) =>
      addEmitter(_activeUuid, x, y, z, radius, density, temperature, velocity),
    __studioPyroClearEmitters: () => clearEmitters(_activeUuid),
    // Slice 731 — combustion: fuel jets / gas burners.
    __studioPyroAddFuelEmitter: (x, y, z, radius, fuel, velocity, pilot) =>
      addFuelEmitter(_activeUuid, x, y, z, radius, fuel, velocity, pilot),
    __studioPyroClearFuelEmitters: () => clearFuelEmitters(_activeUuid),
    __studioPyroSetParam: (key, value) => setPyroParam(_activeUuid, key, value),
    __studioPyroStep: (dt, steps) => stepPyro(_activeUuid, dt, steps),
    __studioPyroStats: () => pyroStats(_activeUuid),
    __studioPyroReset: () => resetPyro(_activeUuid),
    __studioPyroDelete: (uuid) => deletePyro(uuid || _activeUuid),
    __studioPyroList: () => ({ ok: true, sims: listPyro() }),

    // Convenience: create a fresh smoke volume with a bottom-centre
    // emitter and pre-roll N frames so a rising plume is immediately
    // visible in the viewport (Houdini "Pyro Burst" shelf tool).
    __studioPyroIgnite: (frames) => {
      const r = _create(64, 64, 64, 0.05);
      if (!r.ok) return r;
      const init = initPyro(_activeUuid);
      if (!init.ok) return init;
      clearEmitters(_activeUuid);
      addEmitter(_activeUuid, 32, 10, 32, 7, 5.0, 1.0, 9.0);
      const n = Math.max(1, Math.min(240, Math.floor(frames) || 30));
      let last = null;
      for (let i = 0; i < n; i++) last = stepPyro(_activeUuid, 0.1, 1);
      return { ok: true, uuid: _activeUuid, frames: n, stats: last };
    },

    // Slice 731 — one-shot combustion demo (Houdini Pyro 'Campfire' /
    // Blender 'Fire' quick-effect): a fuel jet with a pilot light that
    // self-ignites into a sustained flame, producing fire + rising smoke.
    __studioPyroCampfire: (frames) => {
      const r = _create(64, 64, 64, 0.05);
      if (!r.ok) return r;
      const init = initPyro(_activeUuid);
      if (!init.ok) return init;
      clearEmitters(_activeUuid);
      clearFuelEmitters(_activeUuid);
      // Pilot-lit fuel jet at the base → ignites and sustains.
      addFuelEmitter(_activeUuid, 32, 8, 32, 6, 7.0, 7.0, true);
      const n = Math.max(1, Math.min(240, Math.floor(frames) || 40));
      let last = null;
      for (let i = 0; i < n; i++) last = stepPyro(_activeUuid, 0.1, 1);
      return { ok: true, uuid: _activeUuid, frames: n, stats: last };
    },
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'volume', 'Volumetric smoke/fire rendering + Pyro gas simulation (Houdini Pyro / Blender Mantaflow)');
}
