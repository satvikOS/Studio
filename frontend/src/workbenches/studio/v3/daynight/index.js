// ArchDisc Studio V3 — day/night cycle (slice 826).
// Animates sun direction + ambient + Hosek sky over a 24-hour cycle.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
let _state = { timeOfDay: 0.5, speed: 0, latitude: 40, season: 0 };
let _sun = null;
function _setTime(t) {
  _state.timeOfDay = ((t % 1) + 1) % 1; // wrap
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  if (!_sun) {
    _sun = new THREE.DirectionalLight(0xffffff, 1);
    _sun.name = 'DayNightSun';
    scene.add(_sun);
  }
  // Map t [0,1] → sun elevation/azimuth
  const elev = Math.sin(_state.timeOfDay * Math.PI * 2 - Math.PI / 2) * (Math.PI / 2 - 0.1);
  const azim = _state.timeOfDay * Math.PI * 2;
  const r = 10;
  _sun.position.set(r * Math.cos(elev) * Math.cos(azim), r * Math.sin(elev), r * Math.cos(elev) * Math.sin(azim));
  _sun.lookAt(0, 0, 0);
  // Daylight intensity by elevation
  const dayMix = Math.max(0, Math.sin(_state.timeOfDay * Math.PI * 2 - Math.PI / 2));
  _sun.intensity = dayMix * 1.5 + 0.05;
  const cool = new THREE.Color(0xffd9a0); cool.lerp(new THREE.Color(0x6080a0), 1 - dayMix);
  _sun.color = cool;
  // Apply Hosek sky if slice 805 is loaded
  if (typeof window.__studioSkyAtmGenerate === 'function') {
    try { window.__studioSkyAtmGenerate({ sunElevation: elev, sunAzimuth: azim, turbidity: 3 }); } catch (_) {}
  }
  return { ok: true, t: _state.timeOfDay, elev, azim };
}
export function installDayNight() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioDayNightSet: ({ timeOfDay } = {}) => _setTime(timeOfDay ?? 0.5),
    __studioDayNightTick: ({ dt = 0.016 } = {}) => _setTime(_state.timeOfDay + dt * _state.speed),
    __studioDayNightSetSpeed: ({ speed = 0 } = {}) => { _state.speed = speed; return { ok: true }; },
    __studioDayNightGet: () => ({ ok: true, ..._state }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'Day/night cycle');
  return { ok: true };
}
export default installDayNight;
