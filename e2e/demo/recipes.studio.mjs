// Curated Studio demo recipes (Monday investor demo, task #61).
//
// Architecture (locked): Archie's BRAIN produces the plan; the APP
// executes via Archie's human-like tool interactions; each stage is
// VISUALLY VERIFIED (scene-graph go/no-go + screenshot) before the demo
// proceeds — zero on-stage mistakes. These map MUST references to flows
// the promoted staged adapter executes RELIABLY (the "loop airtight,
// curated set, grow" scope). Add references here as the loop proves them.
//
// Each recipe stage: { prompt, expect(stats)->bool, shot }. `expect`
// reads the live scene snapshot {prims,lights,physMats,offOrigin,camMoved}
// and is the deterministic go/no-go. Bars are minimums, not exact, so a
// richer build still passes. `plan` is the spec Archie should articulate
// first (shown to investors as "the brain").

export const STUDIO_RECIPES = [
  {
    id: 'scandi-living-room',
    title: 'Scandinavian living-room hero shot (golden hour)',
    ref: 'V-505/staged DoD-1',
    plan: 'Blockout sofa+table+rug+lamp → off-origin composition → physical '
        + 'materials (wood/plastic/velvet/chrome) → golden-hour 3-light rig '
        + '→ frame camera. Pass discipline: blockout → material → light → camera.',
    prompt: 'build me a hero shot of a Scandinavian living room in golden-hour light',
    expect: (s) => s.prims >= 10 && s.offOrigin >= 8 && s.physMats >= 8 && s.lightsDelta >= 1 && s.camMoved,
    shot: 'living-room',
  },
  {
    id: 'kitchen-archviz',
    title: 'Kitchen arch-viz — surprise on the cabinet hardware',
    ref: 'staged DoD-7',
    plan: 'NKBA counters @915mm, base run + uppers + island, copper hardware '
        + 'surprise, key+fill lighting, framed camera.',
    prompt: "I'm doing arch-viz of a kitchen. Build it. Surprise me on the cabinet hardware.",
    expect: (s) => s.prims >= 10 && s.offOrigin >= 8 && s.physMats >= 8 && s.lightsDelta >= 1 && s.camMoved,
    shot: 'kitchen',
  },
  {
    id: 'cassette-deck',
    title: 'Cassette deck — product viz (VU meters, brushed faceplate)',
    ref: 'V-825-class product viz',
    plan: 'Faceplate + VU dials + transport buttons + tape window, brushed-'
        + 'aluminium/glass/rubber materials, product-shot lighting, close camera.',
    prompt: 'design a cassette deck — VU meters, transport buttons, hairline brushed-aluminium faceplate',
    expect: (s) => s.prims >= 9 && s.physMats >= 8 && s.lightsDelta >= 1 && s.camMoved,
    shot: 'cassette-deck',
  },
  {
    id: 'forest-dawn',
    title: 'Forest at dawn — environment scale (50 trees, wolf)',
    ref: 'V-164/V-229 environment scale',
    plan: 'Template pine → scatter ~50 instances → hero trees framing → wolf '
        + 'silhouette → dawn fog + backlight → low camera.',
    prompt: 'forest scene, 50 trees, dawn, with a wolf in the foreground silhouetted',
    expect: (s) => s.prims >= 20 && s.offOrigin >= 15 && s.lightsDelta >= 1 && s.camMoved,
    shot: 'forest-dawn',
  },
];
