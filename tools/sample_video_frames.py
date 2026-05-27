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
MAX_WIDTH = 640

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

    for i, v in enumerate(videos, 1):
        out_path = OUT_DIR / f"{v.stem}.jpg"
        if out_path.exists():
            print(f"  [{i:>3}/{len(videos)}] skip (exists): {v.name}")
            continue
        try:
            # Probe to get total frame count; pick frame at 30% of duration.
            meta = iio.immeta(v, plugin="pyav")
            duration = meta.get("duration") or 0
            fps = meta.get("fps") or 24
            total_frames = int(duration * fps) if duration else 0
            target_idx = int(total_frames * 0.3) if total_frames else 30
            target_idx = max(target_idx, 1)

            frame = iio.imread(v, index=target_idx, plugin="pyav")
        except Exception as e:
            # Fallback: try without specifying plugin, use first frame.
            try:
                frame = iio.imread(v, index=0)
            except Exception as e2:
                print(f"  [{i:>3}/{len(videos)}] ERR {v.name}: {e} / {e2}", file=sys.stderr)
                continue

        img = Image.fromarray(frame)
        if img.width > MAX_WIDTH:
            ratio = MAX_WIDTH / img.width
            img = img.resize((MAX_WIDTH, int(img.height * ratio)), Image.LANCZOS)
        img.save(out_path, "JPEG", quality=78)
        print(f"  [{i:>3}/{len(videos)}] {v.name} -> {out_path.name} ({img.size[0]}x{img.size[1]})")

    print(f"[done] wrote thumbnails to {OUT_DIR}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
