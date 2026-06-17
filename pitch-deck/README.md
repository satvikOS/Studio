# ArchDisc — Investor Pitch (ClawComp × Link Ventures)

Bespoke 13-slide pitch deck for the **ArchDisc platform** — two standalone apps
(**Studio** + **Forge**) driven by one unified, open-source AI model (**Archie**).

**Deliverable:** [`out/ArchDisc-LinkVentures.pptx`](out/ArchDisc-LinkVentures.pptx) — 16:9, 13 slides.

## Design
An "engineering drawing set": every slide is a drafting sheet (border, zone ticks,
title block), with dimension lines, tool-call traces, an exploded BOM, and a moat
matrix. Strictly monochrome, dulled for eye comfort (paper `#e6e5e1` / charcoal ink).
Fonts: Space Grotesk (display) · Geist (body) · Geist Mono (instrument).

## Slides
`01 Cover · 02 Vision · 03 Why-now · 04 Market · 05 Platform · 06 Forge ·
07 Studio · 08 Archie · 09 Moats · 10 Business model · 11 Traction · 12 Team · 13 The Ask`

## Rebuild
Slides are hand-authored HTML rendered to PNG via headless Chrome, then assembled
into the `.pptx` with python-pptx.

```bash
python3 -m venv .venv && ./.venv/bin/pip install python-pptx Pillow
./render.sh              # slides/*.html -> render/*.png  (2x, 2560x1440)
./.venv/bin/python build_pptx.py   # render/*.png -> out/ArchDisc-LinkVentures.pptx
```

## To finalize before circulation
- Raise figure / instrument (Sheet 13) — currently `$1.5M seed · SAFE`.
- Jeff's role + background (Sheet 12).
- Validate market figures with sourced reports (Sheet 04).
