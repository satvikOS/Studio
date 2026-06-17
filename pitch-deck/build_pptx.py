#!/usr/bin/env python
"""Assemble render/*.png into a 16:9 PPTX, one full-bleed image per slide."""
import glob, os
from pptx import Presentation
from pptx.util import Emu

BD = os.path.expanduser('~/archdisc-deck')
EMU_W, EMU_H = 12192000, 6858000  # 13.333in x 7.5in (16:9)

prs = Presentation()
prs.slide_width = Emu(EMU_W)
prs.slide_height = Emu(EMU_H)
blank = prs.slide_layouts[6]

pngs = sorted(glob.glob(os.path.join(BD, 'render', '[01][0-9]-*.png')))
assert pngs, 'no slide PNGs found'
assert len(pngs) == 13, f'expected 13 slides, got {len(pngs)}: {[os.path.basename(p) for p in pngs]}'
for p in pngs:
    s = prs.slides.add_slide(blank)
    s.shapes.add_picture(p, Emu(0), Emu(0), width=Emu(EMU_W), height=Emu(EMU_H))

# document properties
cp = prs.core_properties
cp.title = 'ArchDisc — Investor Pitch'
cp.author = 'Satvik Adyanthaya · Jeff Munkondaya'
cp.comments = 'ClawComp · presented at Link Ventures'

out = os.path.join(BD, 'out', 'ArchDisc-LinkVentures.pptx')
prs.save(out)
print('saved', out, '·', len(pngs), 'slides ·', os.path.getsize(out)//1024, 'KB')
