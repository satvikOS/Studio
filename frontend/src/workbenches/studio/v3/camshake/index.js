// ArchDisc Studio V3 — cinematic camera shake (slice 794).
// 6 preset shake profiles + applicator hooked into viewport tick.

import { registerOps } from '../common/registry.js';

let _installed = false;
const _PRESETS = {
  handheld:   { amplitude: 0.001, frequency: 2.5,  decay: 0.5,  axes: 'xyz' },
  explosion:  { amplitude: 0.02,  frequency: 12,   decay: 4,    axes: 'xyz' },
  kick:       { amplitude: 0.005, frequency: 8,    decay: 6,    axes: 'y' },
  punch:      { amplitude: 0.003, frequency: 14,   decay: 10,   axes: 'xy' },
  earthquake: { amplitude: 0.008, frequency: 3,    decay: 0.4,  axes: 'xz' },
  trauma:     { amplitude: 0.015, frequency: 8,    decay: 2,    axes: 'xyz' },
};

const _active = [];
let _hookInstalled = false;

function _seededNoise(t, axis) {
  return Math.sin(t * 12.9898 + axis * 78.233) * 43758.5453 % 1;
}

function _tick() {
  if (typeof window === 'undefined') return;
  const vp = window.__archdiscViewport;
  if (!vp?.camera) return;
  const now = performance.now() / 1000;
  let totalDx = 0, totalDy = 0, totalDz = 0;
  for (let i = _active.length - 1; i >= 0; i--) {
    const sh = _active[i];
    const elapsed = now - sh.startTime;
    if (elapsed > sh.duration) { _active.splice(i, 1); continue; }
    const decayMul = Math.exp(-elapsed * sh.profile.decay);
    const amp = sh.profile.amplitude * sh.intensity * decayMul;
    if (sh.profile.axes.includes('x')) totalDx += amp * (_seededNoise(elapsed * sh.profile.frequency, 1) - 0.5);
    if (sh.profile.axes.includes('y')) totalDy += amp * (_seededNoise(elapsed * sh.profile.frequency, 2) - 0.5);
    if (sh.profile.axes.includes('z')) totalDz += amp * (_seededNoise(elapsed * sh.profile.frequency, 3) - 0.5);
  }
  vp.camera.position.x += totalDx;
  vp.camera.position.y += totalDy;
  vp.camera.position.z += totalDz;
  if (window.__studioInvalidate) window.__studioInvalidate();
}

function _installHook() {
  if (_hookInstalled) return;
  _hookInstalled = true;
  const vp = window.__archdiscViewport;
  if (vp) {
    const prev = vp.__studioAnimTick;
    vp.__studioAnimTick = (now) => { if (prev) prev(now); _tick(); };
  } else {
    setInterval(_tick, 16);
  }
}

export function installCamShake() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioCamShakeAdd: ({ presetName, duration = 1, intensity = 1 } = {}) => {
      const profile = _PRESETS[presetName];
      if (!profile) return { ok: false, error: `unknown preset ${presetName}` };
      _active.push({ profile, duration, intensity, startTime: performance.now() / 1000 });
      _installHook();
      return { ok: true, activeCount: _active.length };
    },
    __studioCamShakeStop: () => { _active.length = 0; return { ok: true }; },
    __studioCamShakeList: () => ({ ok: true, presets: Object.keys(_PRESETS), active: _active.length }),
    __studioCamShakeListen: () => { _installHook(); return { ok: true }; },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'anim', 'Cinematic camera shake');
  return { ok: true };
}

export default installCamShake;
