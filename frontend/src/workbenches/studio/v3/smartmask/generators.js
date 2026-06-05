// Slice 703 — Substance Painter smart-mask generators. Each generator
// builds a per-vertex (or per-pixel UV-baked) mask Float32Array that
// drives layer opacity. Inputs: AO map / curvature map / normal map
// from the slice-699 bakemaps module. Outputs feed slice-686 stack.

import * as THREE from 'three';

function _meshOf(uuid) {
  return window.__archdiscScene ? window.__archdiscScene.getObjectByProperty('uuid', uuid) : null;
}

function _make(size) { return new Float32Array(size * size); }

// EdgeWearMask — emphasizes high-curvature ridges (curvature > 0.7),
// optional dirt noise for break-up.
export function edgeWearMask(opts) {
  const size = Math.max(64, Math.min(2048, Number(opts?.size) || 512));
  const curv = opts?.curvature instanceof Float32Array
    ? opts.curvature
    : null;
  if (!curv) return { ok: false, error: 'curvature map required' };
  const m = _make(size);
  const thresh = Number(opts?.threshold) ?? 0.55;
  const sharp = Number(opts?.sharpness) ?? 6;
  for (let i = 0; i < m.length; i++) {
    const c = curv[i] ?? 0;
    const t = Math.max(0, (c - thresh) * sharp);
    m[i] = Math.min(1, t);
  }
  // Break-up with hash noise.
  if (opts?.breakUp !== false) {
    const amp = Number(opts?.breakUpAmp) || 0.4;
    for (let i = 0; i < m.length; i++) {
      const r = ((i * 9301 + 49297) % 233280) / 233280;
      m[i] *= 1 - amp + amp * r;
    }
  }
  return { ok: true, mask: m, size };
}

// DirtMask — emphasizes deep concavities (AO low), with grain.
export function dirtMask(opts) {
  const size = Math.max(64, Math.min(2048, Number(opts?.size) || 512));
  const ao = opts?.ao instanceof Float32Array ? opts.ao : null;
  if (!ao) return { ok: false, error: 'ao map required' };
  const intensity = Number(opts?.intensity) ?? 1.0;
  const grain = Number(opts?.grain) ?? 0.2;
  const m = _make(size);
  for (let i = 0; i < m.length; i++) {
    const a = ao[i] ?? 1;
    let v = (1 - a) * intensity;
    v *= 1 - grain + grain * (((i * 4787 + 19) % 1009) / 1009);
    m[i] = Math.max(0, Math.min(1, v));
  }
  return { ok: true, mask: m, size };
}

// HeightFalloff — sample-by-V (vertical) gradient with a noise-modulated
// transition band. Useful for moss-from-bottom, paint-from-top.
export function heightFalloffMask(opts) {
  const size = Math.max(64, Math.min(2048, Number(opts?.size) || 512));
  const top = Number(opts?.top) ?? 1.0;
  const bottom = Number(opts?.bottom) ?? 0.0;
  const noiseAmp = Number(opts?.noiseAmp) ?? 0.15;
  const m = _make(size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    const t = (v - bottom) / (top - bottom);
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const n = ((x * 113 + y * 67) % 256) / 256;
      const tn = t + (n - 0.5) * noiseAmp;
      m[i] = Math.max(0, Math.min(1, tn));
    }
  }
  return { ok: true, mask: m, size };
}

// CavityMask — combines AO (low spots) and curvature (concave).
export function cavityMask(opts) {
  const size = Math.max(64, Math.min(2048, Number(opts?.size) || 512));
  const ao = opts?.ao instanceof Float32Array ? opts.ao : null;
  const curv = opts?.curvature instanceof Float32Array ? opts.curvature : null;
  if (!ao || !curv) return { ok: false, error: 'ao + curvature required' };
  const m = _make(size);
  for (let i = 0; i < m.length; i++) {
    const inv = 1 - (ao[i] ?? 1);
    const cv = curv[i] ?? 0;
    m[i] = Math.max(0, Math.min(1, inv * 0.7 + Math.max(0, -cv) * 0.6));
  }
  return { ok: true, mask: m, size };
}

// MetalEdgesMask — preset blend: edge wear emphasis + dirt cavities,
// tuned for "worn metal" look.
export function metalEdgesMask(opts) {
  const ew = edgeWearMask({ ...opts, threshold: 0.5, sharpness: 8 });
  const dirt = dirtMask({ ...opts, intensity: 0.6 });
  if (!ew.ok || !dirt.ok) return { ok: false };
  const m = _make(ew.size);
  for (let i = 0; i < m.length; i++) {
    m[i] = Math.max(0, Math.min(1, ew.mask[i] * 0.7 + dirt.mask[i] * 0.5));
  }
  return { ok: true, mask: m, size: ew.size };
}

// Apply a smart mask to a mesh's vertexColors as an alpha channel,
// enabling preview without painting.
export function previewMaskOnMesh(meshUuid, maskFloat32, size) {
  const mesh = _meshOf(meshUuid);
  if (!mesh || !mesh.geometry) return { ok: false };
  const pos = mesh.geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const uv = mesh.geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const u = uv ? uv.array[i * 2] : 0.5;
    const v = uv ? uv.array[i * 2 + 1] : 0.5;
    const x = Math.min(size - 1, Math.floor(u * size));
    const y = Math.min(size - 1, Math.floor(v * size));
    const m = maskFloat32[y * size + x];
    colors[i * 3] = m; colors[i * 3 + 1] = m; colors[i * 3 + 2] = m;
  }
  mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (mesh.material) {
    mesh.material.vertexColors = true;
    mesh.material.needsUpdate = true;
  }
  return { ok: true };
}
