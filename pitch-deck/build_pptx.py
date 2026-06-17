#!/usr/bin/env python
"""Assemble render/*.png into a 16:9 PPTX (full-bleed), embedding the demo video."""
import glob, os
from PIL import Image
from pptx import Presentation
from pptx.util import Emu

BD = os.path.expanduser('~/archdisc-deck')
EMU_W, EMU_H = 12192000, 6858000      # 13.333in x 7.5in (16:9)
PXEMU = EMU_W // 1280                  # 9525 EMU per logical px (1280x720 authoring grid)

prs = Presentation()
prs.slide_width = Emu(EMU_W); prs.slide_height = Emu(EMU_H)
blank = prs.slide_layouts[6]

pngs = sorted(glob.glob(os.path.join(BD, 'render', '0[0-9]-*.png')))
assert len(pngs) == 9, f'expected 9 slides, got {len(pngs)}: {[os.path.basename(p) for p in pngs]}'

# demo video frame rect in logical px (must match .vframe in 04-demo.html)
VF = dict(left=260, top=190, w=760, h=428)
VIDEO = os.path.join(BD, 'assets', 'demo.mp4')

for p in pngs:
    s = prs.slides.add_slide(blank)
    s.shapes.add_picture(p, Emu(0), Emu(0), width=Emu(EMU_W), height=Emu(EMU_H))
    if os.path.basename(p).startswith('04-demo') and os.path.exists(VIDEO):
        # poster = crop of the rendered slide at the frame rect (render is 2x)
        poster = os.path.join(BD, 'render', '_demo_poster.png')
        im = Image.open(p); sx = im.width / 1280.0
        box = (int(VF['left']*sx), int(VF['top']*sx),
               int((VF['left']+VF['w'])*sx), int((VF['top']+VF['h'])*sx))
        im.crop(box).save(poster)
        s.shapes.add_movie(VIDEO,
            Emu(VF['left']*PXEMU), Emu(VF['top']*PXEMU),
            Emu(VF['w']*PXEMU), Emu(VF['h']*PXEMU),
            poster_frame_image=poster, mime_type='video/mp4')

cp = prs.core_properties
cp.title = 'ArchDisc — Investor Pitch'
cp.author = 'Satvik Adyanthaya · Jeff Munkondaya'
cp.comments = 'ClawComp x Link Ventures'

out = os.path.join(BD, 'out', 'ArchDisc-LinkVentures.pptx')
prs.save(out)
print('saved', out, '·', len(pngs), 'slides ·', os.path.getsize(out)//1024, 'KB · video embedded')
