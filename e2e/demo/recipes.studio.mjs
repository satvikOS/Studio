// Curated Studio demo recipes (Monday investor demo, task #61).
//
// Architecture: Archie's BRAIN plans the scene (the prompt → its tool-call
// intent in the thread); the app's PARAMETRIC FURNITURE LIBRARY realizes
// detailed, asymmetric, materialed geometry (window.__studioComposeScene) —
// the same asset-library pattern that makes Forge's parts production-grade.
// Then the GPU PATH TRACER (window.__studioRunPathTracedRender) shades it
// photorealistically (PBR materials + IBL + ACES). Geometry is deterministic,
// so it does NOT depend on serve stability.
//
// Each recipe: { id, title, ref, plan, prompt, layout, seed }.

export const STUDIO_RECIPES = [
  {
    id: 'scandi-living-room',
    title: 'Scandinavian living room (golden hour)',
    ref: 'V-505 / staged DoD-1',
    plan: 'Sofa + coffee table + two armchairs + floor lamp + bookshelf + plant on a rug; '
        + 'fabric/wood/leather materials; golden-hour IBL; 3/4 hero.',
    prompt: 'build me a hero shot of a Scandinavian living room in golden-hour light',
    layout: 'living-room', seed: 0xA11CE, env: 'golden',
  },
  {
    id: 'bedroom-minimalist',
    title: 'Modern minimalist bedroom (warm)',
    ref: 'staged DoD-4',
    plan: 'Platform bed + headboard + duvet + pillows, two nightstands, lamp, plant, shelf; '
        + 'linen/walnut materials; warm IBL.',
    prompt: 'modern minimalist bedroom, platform bed, warm accent light',
    layout: 'bedroom', seed: 0xB3D, env: 'warm',
  },
  {
    id: 'product-pedestal',
    title: 'Hero product shot on a pedestal (studio)',
    ref: 'V-825 product viz',
    plan: 'Marble pedestal + polished hero object + backdrop sweep; studio softbox IBL; close hero.',
    prompt: 'hero product shot on a pedestal, studio lighting, high-key',
    layout: 'product', seed: 0x9E12, env: 'studio',
  },
  {
    id: 'cafe-interior',
    title: 'Cozy cafe interior (warm pendants)',
    ref: 'staged interior',
    plan: 'Counter with marble top + three cafe tables with chairs + brass pendants + plant; '
        + 'walnut/marble/brass materials; warm IBL.',
    prompt: 'cozy neighborhood cafe interior, warm pendant lighting',
    layout: 'cafe', seed: 0xCAFE, env: 'warm',
  },
];
