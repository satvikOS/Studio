#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# render-flagship-photoreal.sh — DEFERRED render of the Studio human-in-city
# flagship as a PATH-TRACED PHOTOREAL VIDEO.
#
# ⚠️  RUN THIS ONLY WHEN THE GPU IS FREE.  The path tracer is GPU-heavy. Do NOT
#     launch it while a LoRA train, mlx serve, another Electron/Playwright run,
#     or a Vite dev build is contending for the Mac's unified memory — it will
#     OOM. One heavy step at a time (hardware-calm rule).
#
# It (1) builds the frontend dist (the Electron spec loads frontend/dist), then
# (2) runs e2e/demo/demo-studio-flagship-city.spec.js HEADED on Mac-Electron,
# producing:
#     e2e/demo/shots/studio/flagship/human-city-photoreal.mp4        (deliverable)
#     e2e/demo/shots/studio/flagship/human-city-photoreal-hero.png   (thumbnail)
#     e2e/demo/shots/studio/flagship/pt-seq/frame-####.png           (raw frames)
#
# ── KNOBS (env vars; defaults = a cheap PREVIEW) ─────────────────────────────
#   FLAGSHIP_SPP      samples / frame      (default 32; final: 128–256)
#   FLAGSHIP_FRAMES   total frames         (default 24; final: 72–120)
#   FLAGSHIP_RES      720p|1080p|1440p|4k  (default 1080p; final: 4k)
#   FLAGSHIP_FPS      output frame-rate    (default 24)
#   FLAGSHIP_ENV      sky preset           (default daylight; also: golden, studio, overcast, noon)
#   FLAGSHIP_FSTOP    DOF f-stop           (default 3.2; lower = shallower bokeh)
#   FLAGSHIP_RASTER_PROOF=1  also drop 6 quick viewport-raster frames (fast sanity proof; NOT the deliverable)
#   SKIP_BUILD=1      reuse the existing frontend/dist (skip the vite build)
#
# ── BUDGET / EST. RENDER TIME (Mac Studio M4 Max, GPU otherwise idle) ────────
#   The per-frame cost ≈ (scene harvest + BVH bake) + spp × trace. The city +
#   skinned humanoid bakes per frame (the human is re-baked from the deformed
#   skeleton each frame). Rough wall-clock at 1080p:
#     PREVIEW  24f × 32spp  ≈  6–12 min   (~15–30 s/frame)
#     MID      48f × 96spp  ≈  30–55 min
#     FINAL    96f × 192spp @ 4k ≈ 3–6 h  (run overnight; 4k quadruples pixels)
#   Always start with the PREVIEW to validate motion + composition before a final.
#
# ── EXAMPLES ─────────────────────────────────────────────────────────────────
#   ./e2e/demo/render-flagship-photoreal.sh                       # cheap preview
#   FLAGSHIP_RASTER_PROOF=1 ./e2e/demo/render-flagship-photoreal.sh
#   FLAGSHIP_SPP=128 FLAGSHIP_FRAMES=72 FLAGSHIP_RES=1440p ./e2e/demo/render-flagship-photoreal.sh
#   FLAGSHIP_SPP=192 FLAGSHIP_FRAMES=96 FLAGSHIP_RES=4k FLAGSHIP_FSTOP=2.4 ./e2e/demo/render-flagship-photoreal.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Repo root = two levels up from this script (e2e/demo/ → repo root).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "── flagship photoreal render ──────────────────────────────────────────────"
echo "  spp=${FLAGSHIP_SPP:-32}  frames=${FLAGSHIP_FRAMES:-24}  res=${FLAGSHIP_RES:-1080p}  fps=${FLAGSHIP_FPS:-24}"
echo "  env=${FLAGSHIP_ENV:-daylight}  fStop=${FLAGSHIP_FSTOP:-3.2}  raster_proof=${FLAGSHIP_RASTER_PROOF:-0}"
echo "  root=$ROOT"

# Soft contention guard — warn (don't hard-fail) if heavy GPU/ML work looks live.
if pgrep -f "mlx_lm|lora|mlx_vlm|mlx.lm.server" >/dev/null 2>&1; then
  echo "  ⚠️  WARNING: an mlx/LoRA process appears to be running. Path tracing now may OOM."
  echo "      Free the GPU first, or set I_KNOW=1 to proceed anyway."
  [ "${I_KNOW:-0}" = "1" ] || { echo "      Aborting (set I_KNOW=1 to override)."; exit 2; }
fi

command -v ffmpeg >/dev/null 2>&1 || { echo "  ✗ ffmpeg not found on PATH (needed to stitch the mp4)."; exit 3; }

# 1) build the frontend dist (the Electron spec loads frontend/dist/index.html).
if [ "${SKIP_BUILD:-0}" = "1" ] && [ -f frontend/dist/index.html ]; then
  echo "  • SKIP_BUILD=1 → reusing existing frontend/dist"
else
  echo "  • building frontend dist (vite build)…"
  ( cd frontend && npm run build )
fi

# 2) run the flagship spec HEADED on Mac-Electron (knobs passed through as env).
echo "  • launching headed Electron path-traced render…"
FLAGSHIP_SPP="${FLAGSHIP_SPP:-32}" \
FLAGSHIP_FRAMES="${FLAGSHIP_FRAMES:-24}" \
FLAGSHIP_RES="${FLAGSHIP_RES:-1080p}" \
FLAGSHIP_FPS="${FLAGSHIP_FPS:-24}" \
FLAGSHIP_ENV="${FLAGSHIP_ENV:-daylight}" \
FLAGSHIP_FSTOP="${FLAGSHIP_FSTOP:-3.2}" \
FLAGSHIP_RASTER_PROOF="${FLAGSHIP_RASTER_PROOF:-0}" \
  npx playwright test e2e/demo/demo-studio-flagship-city.spec.js \
    --project=chromium --reporter=list --retries=0 --workers=1

OUT="$ROOT/e2e/demo/shots/studio/flagship/human-city-photoreal.mp4"
echo "──────────────────────────────────────────────────────────────────────────"
if [ -f "$OUT" ]; then
  echo "  ✓ deliverable: $OUT  ($(du -h "$OUT" | cut -f1))"
  echo "  ✓ hero still:  $ROOT/e2e/demo/shots/studio/flagship/human-city-photoreal-hero.png"
else
  echo "  ✗ deliverable not produced — check the Playwright output above."
  exit 1
fi
