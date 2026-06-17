# ArchDisc — Investor Pitch (ClawComp × Link Ventures)

Bespoke **7-slide** pitch deck for the **ArchDisc platform** — two standalone apps
(**Studio** + **Forge**) driven by one unified, open-source AI model (**Archie**).

**Deliverable:** [`out/ArchDisc-LinkVentures.pptx`](out/ArchDisc-LinkVentures.pptx) — 16:9, 7 slides, with a **real demo video embedded** on slide 4 (plays in presentation mode).

## Slides
`01 Cover · 02 Vision · 03 Platform (Studio+Forge+Archie) · 04 Demo (▶ embedded) · 05 Why we win · 06 Business model · 07 Team + Ask`

## Design
A refined, dull-monochrome "engineering drawing set" (drafting border, zone ticks,
title block) — image-forward, minimal text. Color comes from the product logos and
the real Studio renders. Fonts: Space Grotesk · Geist · Geist Mono.

Product logos (`assets/logos/`): Studio = spectrum **S**, Forge = anvil + shining star,
Archie = bold wordmark. ClawComp + Link Ventures lockups are typographic stand-ins —
drop the real logo files in `assets/logos/` to swap them in.

## Rebuild
```bash
python3 -m venv .venv && ./.venv/bin/pip install python-pptx Pillow
./render.sh                         # slides/*.html -> render/*.png  (2x)
./.venv/bin/python build_pptx.py    # render/*.png + assets/demo.mp4 -> out/*.pptx
```

## To finalize before circulation
- Swap in real ClawComp + Link Ventures logos (`assets/logos/`).
- Replace the demo clip (`assets/demo.mp4`) with the best build recording.
- Confirm raise ($1.5M seed · SAFE), Jeff's role, and the market figures.
