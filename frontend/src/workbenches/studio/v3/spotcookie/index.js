// ArchDisc Studio V3 — spotlight projected textures / cookies (slice 856).
// Attach a projected texture pattern (gobo) to a spotlight.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
const _PATTERNS = ['window', 'leaves', 'caustic', 'venetian', 'circle', 'star', 'company-logo'];
function _genTexture(name) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#fff';
  if (name === 'window') {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) ctx.fillRect(20 + c * 56, 20 + r * 56, 48, 48);
  } else if (name === 'leaves') {
    for (let i = 0; i < 24; i++) {
      ctx.beginPath();
      ctx.ellipse(Math.random() * 256, Math.random() * 256, 20 + Math.random() * 20, 8 + Math.random() * 10, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (name === 'venetian') {
    for (let y = 0; y < 256; y += 16) ctx.fillRect(0, y, 256, 6);
  } else if (name === 'circle') {
    ctx.beginPath(); ctx.arc(128, 128, 100, 0, Math.PI * 2); ctx.fill();
  } else if (name === 'star') {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 100 : 40, a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const x = 128 + r * Math.cos(a), y = 128 + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.fill();
  } else if (name === 'caustic') {
    for (let i = 0; i < 30; i++) {
      ctx.globalAlpha = 0.3 + Math.random() * 0.5;
      ctx.beginPath();
      ctx.arc(Math.random() * 256, Math.random() * 256, 10 + Math.random() * 50, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return new THREE.CanvasTexture(canvas);
}
export function installSpotCookie() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioCookieListPatterns: () => ({ ok: true, patterns: _PATTERNS.slice() }),
    __studioCookieApply: ({ lightUuid, pattern = 'window' } = {}) => {
      const scene = window.__archdiscScene; if (!scene) return { ok: false };
      const light = scene.getObjectByProperty('uuid', lightUuid);
      if (!light?.isSpotLight) return { ok: false };
      light.map = _genTexture(pattern);
      return { ok: true, pattern };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'Spotlight cookies / projected gobos');
  return { ok: true };
}
export default installSpotCookie;
