// Slice 698 — Volumetric smoke/fire rendering.

import { registerOps } from '../common/registry.js';
import {
  createVolume, listVolumes, setVoxel, clearVolume, deleteVolume, getVolume,
} from './grid.js';
import { buildProxyMesh, updateProxyParams } from './proxy.js';
import { cloudPuff, firePlume, groundFog, plasma } from './generators.js';

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
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'volume', 'Volumetric smoke/fire rendering');
}
