"""Sample one mid-duration thumbnail per video in Videos- Must Process/.

Output: tools/.video-thumbs/<basename>.jpg (kept out of git via top-level .gitignore).

Resolution capped at 640px wide to keep thumbnails small enough to skim
in bulk without overwhelming the reader. Run once per session; output
is idempotent.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import imageio.v3 as iio
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / "Videos- Must Process"
OUT_DIR = REPO_ROOT / "tools" / ".video-thumbs"
MAX_WIDTH = 480
FRAMES_PER_VIDEO = 8  # 12.5% / 25% / 37.5% / 50% / 62.5% / 75% / 87.5% / 95%

def main() -> int:
    if not SRC_DIR.exists():
        print(f"[err] source dir not found: {SRC_DIR}", file=sys.stderr)
        return 1
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    videos = sorted(SRC_DIR.glob("*.mp4"))
    if not videos:
        print(f"[warn] no .mp4 files in {SRC_DIR}", file=sys.stderr)
        return 0

    print(f"[info] sampling {len(videos)} videos -> {OUT_DIR}")

    fractions = [0.125, 0.25, 0.375, 0.50, 0.625, 0.75, 0.875, 0.95][:FRAMES_PER_VIDEO]
    for i, v in enumerate(videos, 1):
        try:
            meta = iio.immeta(v, plugin="pyav")
            duration = meta.get("duration") or 0
            fps = meta.get("fps") or 24
            total_frames = int(duration * fps) if duration else 0
        except Exception as e:
            print(f"  [{i:>3}/{len(videos)}] ERR (meta) {v.name}: {e}", file=sys.stderr)
            continue

        for fi, frac in enumerate(fractions):
            out_path = OUT_DIR / f"{v.stem}_f{fi}.jpg"
            if out_path.exists():
                continue
            target_idx = max(1, int(total_frames * frac)) if total_frames else (30 * (fi + 1))
            try:
                frame = iio.imread(v, index=target_idx, plugin="pyav")
            except Exception as e:
                try:
                    frame = iio.imread(v, index=0)
                except Exception as e2:
                    print(f"  [{i:>3}/{len(videos)}] f{fi} ERR {v.name}: {e2}", file=sys.stderr)
                    continue
            img = Image.fromarray(frame)
            if img.width > MAX_WIDTH:
                ratio = MAX_WIDTH / img.width
                img = img.resize((MAX_WIDTH, int(img.height * ratio)), Image.LANCZOS)
            img.save(out_path, "JPEG", quality=72)
        print(f"  [{i:>3}/{len(videos)}] {v.name} -> {FRAMES_PER_VIDEO} frames")

    print(f"[done] wrote thumbnails to {OUT_DIR}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
