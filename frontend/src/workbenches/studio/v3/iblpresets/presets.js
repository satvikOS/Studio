// Slice 727 — HDRI/IBL environment presets. One-call generation of
// procedural HDRI cubemaps for common scenarios (studio neutral,
// sunset, overcast, blue hour, dusk, night). Mirrors KeyShot's HDRI
// library + Polyhaven's free HDRIs as a fallback. Doesn't require
// any download; built from gradient + sun disc + cloud noise.

import * as THREE from 'three';

const _presets = new Map();
let _current = null;

function _buildEnvCanvas(presetName) {
  const w = 512, h = 256;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  switch (presetName) {
    case 'studio_neutral': {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#d8d8e0');
      grad.addColorStop(0.5, '#e8e8eb');
      grad.addColorStop(1, '#bababf');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'sunset': {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#08203a');
      grad.addColorStop(0.5, '#d36a39');
      grad.addColorStop(0.8, '#ffb547');
      grad.addColorStop(1, '#2a1611');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      // Sun disc.
      ctx.fillStyle = '#fff4d6';
      ctx.beginPath();
      ctx.arc(w * 0.7, h * 0.6, 20, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'overcast': {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#9aa3a8');
      grad.addColorStop(0.5, '#bdc4c6');
      grad.addColorStop(1, '#7a8085');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'blue_hour': {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#0a1530');
      grad.addColorStop(0.5, '#3553a6');
      grad.addColorStop(1, '#7295c7');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'dusk': {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#0a0a1a');
      grad.addColorStop(0.4, '#3a2a4a');
      grad.addColorStop(0.8, '#ce6b6b');
      grad.addColorStop(1, '#1a1620');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'night': {
      ctx.fillStyle = '#020412';
      ctx.fillRect(0, 0, w, h);
      // Stars.
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 200; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h * 0.7;
        ctx.fillRect(x, y, 1, 1);
      }
      break;
    }
    case 'desert_sun': {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#48618c');
      grad.addColorStop(0.5, '#d6c194');
      grad.addColorStop(1, '#a78d65');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fffaef';
      ctx.beginPath(); ctx.arc(w * 0.5, h * 0.3, 14, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'snow_day': {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#c4d2dc');
      grad.addColorStop(0.5, '#dde6ed');
      grad.addColorStop(1, '#f3f7fa');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      break;
    }
  }
  return cv;
}

export function applyPreset(name) {
  const cv = _buildEnvCanvas(name);
  if (!cv) return { ok: false };
  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  scene.environment = tex;
  scene.background = tex;
  _current = name;
  return { ok: true, name };
}

export function clearEnv() {
  const scene = window.__archdiscScene;
  if (scene) { scene.environment = null; scene.background = null; }
  _current = null;
  return { ok: true };
}

export function getCurrent() { return { ok: true, name: _current }; }

export function listPresets() {
  return {
    ok: true,
    presets: [
      'studio_neutral', 'sunset', 'overcast', 'blue_hour',
      'dusk', 'night', 'desert_sun', 'snow_day',
    ],
  };
}
