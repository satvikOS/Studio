# ArchDisc — Pitch Deck (ClawComp × Link Ventures)

A **9-slide**, warm "vibe-design" pitch for the **ArchDisc platform**. Two apps,
**Studio** (3D creation) and **Forge** (mechanical CAD), driven by one model, **Archie**.

**Deliverable:** [`out/ArchDisc-LinkVentures.pptx`](out/ArchDisc-LinkVentures.pptx) — 16:9, 9 slides, with a real demo video embedded on slide 4 (plays in presentation mode).

## Slides
`01 Cover · 02 Problem · 03 Platform · 04 Demo · 05 Why we win · 06 Stack · 07 Business model · 08 Go to market · 09 Closing`

## Design
Warm, sun-faded earth palette. Atmospheric, irregular art direction with original
abstract generated art (`assets/abstract/`, made by `assets/abstract.html`) bleeding
in faded off the side of each sheet. Large type, few words.
Fonts Space Grotesk, Geist, Geist Mono.

Logos (`assets/logos/`): Studio is a muted spectrum S, Forge is a bulky anvil with a
bright white spark, Archie is a heavy wordmark with a period. ClawComp and Link
Ventures are typographic stand-ins (drop the real files in to swap them).

## Business model
Proprietary, free to use. Like GitHub and Vercel. Free for individuals, students and
hobbyists, who can build anything with it but cannot change the source. Paid for
studios and enterprises.

## Stack (real, pulled from the repos)
Studio React, Three.js, GPU path tracer, Manifold, Electron. Forge OCCT 7.9.3 kernel,
native C++, planegcs. Archie MLX on Apple Silicon, DeepSeek R1 Distill 7B, Qwen2.5 VL,
Hermes 3, 14 LoRA adapters, trained on a curated mix plus millions of synthetic samples.

## Rebuild
```bash
python3 -m venv .venv && ./.venv/bin/pip install python-pptx Pillow
./render.sh
./.venv/bin/python build_pptx.py
```
