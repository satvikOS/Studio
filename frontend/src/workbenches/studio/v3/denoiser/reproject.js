// ArchDisc Studio V3 — SVGF temporal reprojection (slice 891).
//
// Reprojects history buffers (colour, moments, age) using motion
// vectors so the previous frame's denoised samples line up with the
// current frame in screen space. This is the "temporal" half of SVGF —
// every reprojected pixel feeds back into the per-pixel variance
// estimator in variance.js and into the colour filter in atrous.js.
//
// Inputs:
//   motionVectors — Float32Array length W*H*2 of (dx, dy) screen-space
//                   pixel deltas. Slice 798's `__studioMotionVecCapture`
//                   returns per-mesh world-space deltas, so we offer
//                   `meshMotionToScreenField` to splat them into a
//                   screen-aligned field driven by the depth buffer's
//                   matching uuid lookup. When motionVectors is omitted
//                   the reprojector behaves as an identity (still valid
//                   — disocclusion gates will simply lower the age).
//
// The reprojection uses BILINEAR sampling of the history with disocclusion
// rejection driven by:
//   • depth gradient  (|z_cur − z_prev| > σ_z · ‖∇z‖ → reject)
//   • normal angle    (n_cur · n_prev < 0.95 → reject)
//
// Pure JS, no deps.

export const REJECT_DEPTH = 0.1;     // relative gradient tolerance
export const REJECT_NORMAL = 0.92;   // cosθ tolerance

// Bilinear-sample a Float32 array at (fx, fy).
function bilinear(buf, width, height, fx, fy) {
  if (fx < 0 || fx > width - 1 || fy < 0 || fy > height - 1) return null;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const a = buf[y0 * width + x0];
  const b = buf[y0 * width + x1];
  const c = buf[y1 * width + x0];
  const d = buf[y1 * width + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

// Per-pixel reprojection. Writes the reprojected history into
// `out` (must be pre-allocated Float32Array length width*height).
// Returns a Uint8Array `validity` flag (1 = accepted, 0 = rejected).
export function reprojectLuma({
  prevBuf,
  motionVectors,   // Float32Array length W*H*2 — pixel-space dx,dy. May be null.
  prevDepth,       // Float32Array length W*H — may be null.
  curDepth,        // Float32Array length W*H — may be null.
  prevNormal,      // Float32Array length W*H*3 — may be null.
  curNormal,       // Float32Array length W*H*3 — may be null.
  width, height,
}) {
  const out = new Float32Array(width * height);
  const validity = new Uint8Array(width * height);
  if (!prevBuf) return { out, validity };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let dx = 0, dy = 0;
      if (motionVectors) {
        dx = motionVectors[i * 2];
        dy = motionVectors[i * 2 + 1];
      }
      const sx = x - dx, sy = y - dy;
      if (sx < 0 || sy < 0 || sx > width - 1 || sy > height - 1) {
        validity[i] = 0;
        continue;
      }
      // Depth gate.
      if (curDepth && prevDepth) {
        const dCur = curDepth[i];
        const dPrev = bilinear(prevDepth, width, height, sx, sy);
        if (dPrev == null) { validity[i] = 0; continue; }
        const rel = Math.abs(dCur - dPrev) / (Math.max(dCur, dPrev) || 1e-6);
        if (rel > REJECT_DEPTH) { validity[i] = 0; continue; }
      }
      // Normal gate.
      if (curNormal && prevNormal) {
        const nx = curNormal[i * 3], ny = curNormal[i * 3 + 1], nz = curNormal[i * 3 + 2];
        const sxi = Math.round(sx), syi = Math.round(sy);
        const pi = syi * width + sxi;
        const px = prevNormal[pi * 3], py = prevNormal[pi * 3 + 1], pz = prevNormal[pi * 3 + 2];
        const dot = nx * px + ny * py + nz * pz;
        if (dot < REJECT_NORMAL) { validity[i] = 0; continue; }
      }
      const sample = bilinear(prevBuf, width, height, sx, sy);
      if (sample == null) { validity[i] = 0; continue; }
      out[i] = sample;
      validity[i] = 1;
    }
  }
  return { out, validity };
}

// Splat per-mesh world-space motion vectors (the shape slice 798 returns)
// into a screen-space pixel-delta field by projecting each mesh's motion
// through the current camera. Pixels that don't map to any mesh stay 0.
//
// meshMotion: [{ uuid, mv: [dx,dy,dz] }, …]
// uuidMap:    Float32Array length W*H of mesh-uuid hashes (slice 798's
//             G-buffer pass populates this when available). For pixels
//             that lack a uuid map we leave the motion at 0.
export function meshMotionToScreenField(meshMotion, uuidMap, width, height, camera, projectFn) {
  const out = new Float32Array(width * height * 2);
  if (!meshMotion || !meshMotion.length) return out;
  if (typeof projectFn !== 'function' || !camera) return out;
  const motionByHash = new Map();
  for (const m of meshMotion) {
    if (!m || !m.uuid || !Array.isArray(m.mv)) continue;
    let h = 0;
    for (let k = 0; k < m.uuid.length; k++) h = ((h << 5) - h + m.uuid.charCodeAt(k)) | 0;
    motionByHash.set(h, m.mv);
  }
  for (let i = 0; i < width * height; i++) {
    if (!uuidMap) break;
    const h = uuidMap[i] | 0;
    const mv = motionByHash.get(h);
    if (!mv) continue;
    // Project mv through camera → screen-space delta. We defer to the
    // caller's `projectFn(worldDelta, camera, width, height)` since the
    // path tracer owns its own camera matrix conventions.
    const screen = projectFn(mv, camera, width, height);
    if (!screen) continue;
    out[i * 2] = screen[0];
    out[i * 2 + 1] = screen[1];
  }
  return out;
}

// Default world→screen delta projection: linear, given a 4x4 projection
// matrix and a viewport. Returns null when the camera lacks the bits we
// expect. Always honours the (width, height) viewport for the final
// pixel scale so the same world delta produces the right pixel count
// regardless of camera type.
export function projectDelta(worldDelta, camera, width, height) {
  if (!camera || !camera.projectionMatrix) return null;
  // Cheap heuristic: world deltas project to screen pixel deltas
  // proportional to focal length / distance. Without a depth here we
  // approximate via the projection matrix's m00 entry (focal-x term)
  // and the viewport width.
  const e = camera.projectionMatrix.elements;
  const fx = e[0]; // m00
  const fy = e[5]; // m11
  const sx = worldDelta[0] * fx * (width  / 2);
  const sy = worldDelta[1] * fy * (height / 2);
  return [sx, sy];
}

export default {
  reprojectLuma,
  meshMotionToScreenField,
  projectDelta,
  REJECT_DEPTH,
  REJECT_NORMAL,
};
