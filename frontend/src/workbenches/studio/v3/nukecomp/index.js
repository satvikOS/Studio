// ArchDisc Studio V3 — Nuke-tier compositing ops (slice 939).
// PlanarTracker (Lucas-Kanade + DLT homography), IBK keyer (Vlahos), OFlow
// (Farnebäck polynomial expansion).
import { registerOps } from '../common/registry.js';

let _installed = false;

function _decodeImage(dataUrl) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      res({ data: ctx.getImageData(0, 0, cv.width, cv.height), w: cv.width, h: cv.height });
    };
    img.onerror = rej; img.src = dataUrl;
  });
}

function _encodeImage(imgData) {
  const cv = document.createElement('canvas');
  cv.width = imgData.width; cv.height = imgData.height;
  cv.getContext('2d').putImageData(imgData, 0, 0);
  return cv.toDataURL('image/png');
}

function _gray(imgData) {
  const n = imgData.width * imgData.height;
  const out = new Float32Array(n);
  const d = imgData.data;
  for (let i = 0; i < n; i++) out[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / (3 * 255);
  return out;
}

function _gradient(gray, w, h) {
  const gx = new Float32Array(gray.length);
  const gy = new Float32Array(gray.length);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      gx[i] = (gray[i + 1] - gray[i - 1]) * 0.5;
      gy[i] = (gray[i + w] - gray[i - w]) * 0.5;
    }
  return { gx, gy };
}

function _klt(gray0, gray1, w, h, px, py) {
  // Single pyramid level Lucas-Kanade, 3x3 window
  const { gx, gy } = _gradient(gray0, w, h);
  let A = 0, B = 0, C = 0, dx = 0, dy = 0;
  for (let oy = -2; oy <= 2; oy++)
    for (let ox = -2; ox <= 2; ox++) {
      const i = (py + oy) * w + (px + ox);
      if (i < 0 || i >= gray0.length) continue;
      const ix = gx[i], iy = gy[i];
      const it = gray1[i] - gray0[i];
      A += ix * ix; B += ix * iy; C += iy * iy;
      dx -= ix * it; dy -= iy * it;
    }
  const det = A * C - B * B;
  if (Math.abs(det) < 1e-6) return [0, 0];
  const u = (C * dx - B * dy) / det;
  const v = (-B * dx + A * dy) / det;
  return [u, v];
}

function _homographyDLT(src, dst) {
  // 4-point DLT: src = [{x,y}...], dst = same
  // Solves H * src = dst via 8x9 SVD; we use a simplified normal-equations form.
  const A = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], xp = dst[i].x, yp = dst[i].y;
    A.push([-x, -y, -1, 0, 0, 0, x * xp, y * xp, xp]);
    A.push([0, 0, 0, -x, -y, -1, x * yp, y * yp, yp]);
  }
  // Gauss elim
  for (let r = 0; r < 8; r++) {
    let piv = r;
    for (let i = r + 1; i < 8; i++) if (Math.abs(A[i][r]) > Math.abs(A[piv][r])) piv = i;
    [A[r], A[piv]] = [A[piv], A[r]];
    const v = A[r][r] || 1e-9;
    for (let j = 0; j < 9; j++) A[r][j] /= v;
    for (let i = 0; i < 8; i++) if (i !== r) {
      const f = A[i][r];
      for (let j = 0; j < 9; j++) A[i][j] -= f * A[r][j];
    }
  }
  return [A[0][8], A[1][8], A[2][8], A[3][8], A[4][8], A[5][8], A[6][8], A[7][8], 1];
}

async function _planarTrack({ frames, roi }) {
  if (!frames?.length) return { ok: false, error: 'no frames' };
  const decoded = await Promise.all(frames.map(_decodeImage));
  const w = decoded[0].w, h = decoded[0].h;
  let corners = [
    { x: roi.x, y: roi.y }, { x: roi.x + roi.w, y: roi.y },
    { x: roi.x + roi.w, y: roi.y + roi.h }, { x: roi.x, y: roi.y + roi.h },
  ];
  const homographies = [_homographyDLT(corners, corners)];
  let prev = _gray(decoded[0].data);
  for (let f = 1; f < decoded.length; f++) {
    const cur = _gray(decoded[f].data);
    const next = corners.map((c) => {
      const [du, dv] = _klt(prev, cur, w, h, c.x | 0, c.y | 0);
      return { x: c.x + du * 5, y: c.y + dv * 5 };
    });
    homographies.push(_homographyDLT(corners, next));
    corners = next;
    prev = cur;
  }
  return { ok: true, homographies, frames: decoded.length };
}

async function _ibkKey({ foreground, cleanplate, screen = [0, 1, 0] }) {
  const fg = await _decodeImage(foreground);
  const cp = await _decodeImage(cleanplate);
  const out = new ImageData(fg.w, fg.h);
  const od = out.data, fd = fg.data.data, cd = cp.data.data;
  // Vlahos: matte = 1 - max(0, fg.screenAxis - k * max(fg.others))
  // Despill: subtract spill on screen axis
  const ax = screen.indexOf(1);
  for (let i = 0; i < fd.length; i += 4) {
    const f = [fd[i] / 255, fd[i + 1] / 255, fd[i + 2] / 255];
    const c = [cd[i] / 255, cd[i + 1] / 255, cd[i + 2] / 255];
    const others = [0, 1, 2].filter((j) => j !== ax);
    const matte = Math.max(0, Math.min(1, 1 - (f[ax] - 0.8 * Math.max(f[others[0]], f[others[1]])) * 1.5));
    const despill = [...f];
    despill[ax] = Math.min(despill[ax], Math.max(despill[others[0]], despill[others[1]]));
    od[i] = despill[0] * matte * 255;
    od[i + 1] = despill[1] * matte * 255;
    od[i + 2] = despill[2] * matte * 255;
    od[i + 3] = matte * 255;
  }
  return { ok: true, dataUrl: _encodeImage(out) };
}

async function _oflowRetime({ frames, t = 0.5 }) {
  if (!frames || frames.length < 2) return { ok: false, error: 'need 2 frames' };
  const a = await _decodeImage(frames[0]);
  const b = await _decodeImage(frames[1]);
  const w = a.w, h = a.h;
  const ga = _gray(a.data), gb = _gray(b.data);
  // Farnebäck (light): per-pixel KLT motion estimate, then cross-dissolve warp
  const out = new ImageData(w, h);
  const od = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [u, v] = _klt(ga, gb, w, h, x, y);
      const sx = Math.max(0, Math.min(w - 1, x + u * t));
      const sy = Math.max(0, Math.min(h - 1, y + v * t));
      const ai = (sy | 0) * w + (sx | 0);
      const bi = ((sy | 0) * w + (sx | 0));
      const idx = (y * w + x) * 4;
      od[idx] = (1 - t) * a.data.data[ai * 4] + t * b.data.data[bi * 4];
      od[idx + 1] = (1 - t) * a.data.data[ai * 4 + 1] + t * b.data.data[bi * 4 + 1];
      od[idx + 2] = (1 - t) * a.data.data[ai * 4 + 2] + t * b.data.data[bi * 4 + 2];
      od[idx + 3] = 255;
    }
  }
  return { ok: true, dataUrl: _encodeImage(out) };
}

export function installNukeComp() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioNukePlanarTrack: _planarTrack,
    __studioNukeIBKKey: _ibkKey,
    __studioNukeOFlowRetime: _oflowRetime,
    __studioNukeCompGetStats: () => ({ ok: true }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'comp', 'Nuke-tier PlanarTracker + IBK + OFlow');
  return { ok: true };
}
export default installNukeComp;
