// Curated Studio demo recipes (Monday investor demo, task #61).
//
// Architecture (locked): Archie's BRAIN produces the plan; the APP
// executes via Archie's human-like tool interactions; each stage is
// VISUALLY VERIFIED (scene-graph go/no-go + screenshot) before the demo
// proceeds — zero on-stage mistakes.
//
// 2026-06-15: driven by the scene-composition adapter (hermes_studio/modeling
// = modeling-scenes iter-2000) under its byte-matched simple system. That
// adapter reliably COMPOSES a rich, human-scale, off-origin scene from the
// 9 primitives (click-primitive + set-selection scale/position). It does NOT
// emit the fn-staging (lights/materials/camera) — so the go/no-go bars are
// COMPOSITION bars (prims + off-origin), and the render stage frames the
// camera + lights the build deterministically (a render pipeline stages the
// shot; Archie composes it). Prompts are the 6 trained scene layouts.

export const STUDIO_RECIPES = [
  {
    id: 'scandi-living-room',
    title: 'Scandinavian living-room hero shot (golden hour)',
    ref: 'V-505/staged DoD-1',
    plan: 'Compose sofa+table+rug+lamp+chairs at human scale, off-origin layout; '
        + 'render stage frames a 3/4 hero camera + golden-hour rig.',
    prompt: 'build me a hero shot of a Scandinavian living room in golden-hour light',
    expect: (s) => s.prims >= 10 && s.offOrigin >= 5,
    shot: 'living-room',
  },
  {
    id: 'bedroom-minimalist',
    title: 'Modern minimalist bedroom (warm accent)',
    ref: 'staged DoD-4',
    plan: 'Platform bed + nightstands + lamp + rug, human-scale off-origin; '
        + 'render stage warm-keys + frames the hero camera.',
    prompt: 'modern minimalist bedroom, platform bed, warm accent light',
    expect: (s) => s.prims >= 8 && s.offOrigin >= 4,
    shot: 'bedroom',
  },
  {
    id: 'product-pedestal',
    title: 'Hero product shot on a pedestal (high-key)',
    ref: 'V-825-class product viz',
    plan: 'Pedestal + hero object + backdrop sweep; render stage high-key rig + close camera.',
    prompt: 'hero product shot on a pedestal, studio lighting, high-key',
    expect: (s) => s.prims >= 8,
    shot: 'product',
  },
  {
    id: 'cafe-interior',
    title: 'Cozy cafe interior (warm pendants)',
    ref: 'staged interior',
    plan: 'Counter + tables + chairs + pendants, human-scale off-origin; render stage warm pendants.',
    prompt: 'cozy neighborhood cafe interior, warm pendant lighting',
    expect: (s) => s.prims >= 10 && s.offOrigin >= 5,
    shot: 'cafe',
  },
  // NOTE: forest/environment-scale (50 trees) dropped from the LIVE set —
  // the scene adapter scatters trees over a wide radius at small scale, so
  // bbox framing shrinks them to dots (an empty-looking hero). Interior /
  // product blockouts compose + frame reliably; environment scale needs the
  // furniture/scatter asset builders (roadmap P1) before it reads on stage.
];
