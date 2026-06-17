# ArchDisc — Pitch Deck (ClawComp × Link Ventures)

A **9-slide**, warm "vibe-design" pitch for the **ArchDisc platform** — two standalone
apps (**Studio** + **Forge**) driven by one unified AI model (**Archie**).

**Deliverable:** [`out/ArchDisc-LinkVentures.pptx`](out/ArchDisc-LinkVentures.pptx) — 16:9, 9 slides, with a **real demo video embedded** on slide 4 (plays in presentation mode).

## Slides
`01 Cover · 02 Vision · 03 Platform (triangular Studio·Forge·Archie) · 04 Demo (▶) ·
05 Why we win · 06 Business model · 07 Go-to-market · 08 Team + Ask · 09 Dream-quote`

## Design
Warm, sun-faded earth palette; atmospheric, irregular art-direction with real 3D
renders bleeding in faded off the side of each sheet; airy footer (no rigid grid).
Fonts: Space Grotesk · Geist · Geist Mono.

Logos (`assets/logos/`): **Studio** = smushed muted spectrum-S; **Forge** = strong
anvil + sharp asymmetrical star (top-centre); **Archie** = bold wordmark.
ClawComp + Link Ventures are typographic stand-ins — drop the real logo files in
`assets/logos/` to swap them in.

## Business model
Free **to use** (not open source) — like Vercel / GitHub: free for individuals,
students and dreamers; "let's talk" for studios & enterprises.

## Rebuild
```bash
python3 -m venv .venv && ./.venv/bin/pip install python-pptx Pillow
./render.sh                         # slides/*.html -> render/*.png  (2x)
./.venv/bin/python build_pptx.py    # render/*.png + assets/demo.mp4 -> out/*.pptx
```

## To finalize
- Swap in real ClawComp + Link Ventures logos (`assets/logos/`).
- Replace the demo clip (`assets/demo.mp4`) with the best build recording.
- Confirm the raise ($1.5M seed · SAFE), Jeff's role, and the market figure.
