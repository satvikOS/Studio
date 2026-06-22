// PBR material registry — capability roadmap pillar 2 (materials/texture).
//
// Named PBR presets Archie assigns via a `set-material {target, materialId}`
// tool: the handler writes mesh.userData.material = MATERIALS[id], and the
// renderers (Studio rtgpu/raster, Forge three-gpu-pathtracer harvest) read
// userData.material to build the MeshPhysicalMaterial. This is what lifts a
// render from flat clay to "real". SCAFFOLD: registry + assignment spec;
// procedural textures + UV are the W3-4 follow-up. Mirror in Forge as
// forge-v4/materialRegistry.js (same ids) for cross-app consistency.

export const MATERIALS = {
  'oak-worn':         { color: 0xb39468, metalness: 0.0, roughness: 0.72 },
  'steel-anisotropic':{ color: 0xa8acb4, metalness: 0.9, roughness: 0.34 },
  'velvet':           { color: 0x5a4a6a, metalness: 0.0, roughness: 0.9 },
  'terracotta':       { color: 0xc4663f, metalness: 0.0, roughness: 0.82 },
  'steel-brushed':   { color: 0xc9ced6, metalness: 0.92, roughness: 0.28, clearcoat: 0.1 },
  'steel-polished':  { color: 0xd2d6dc, metalness: 0.95, roughness: 0.12 },
  'aluminium':       { color: 0xc6c2bb, metalness: 0.88, roughness: 0.38 },
  'brass':           { color: 0xb9975b, metalness: 0.9, roughness: 0.3 },
  'gold-polished':   { color: 0xd4af37, metalness: 0.98, roughness: 0.08 },
  'copper':          { color: 0xb87333, metalness: 0.9, roughness: 0.25 },
  'cast-iron':       { color: 0x3a3d42, metalness: 0.6, roughness: 0.7 },
  'wood-oak':        { color: 0xc8a571, metalness: 0.0, roughness: 0.55, clearcoat: 0.2 },
  'wood-walnut':     { color: 0x6b4a2f, metalness: 0.0, roughness: 0.5, clearcoat: 0.2 },
  'fabric-grey':     { color: 0x8a8d92, metalness: 0.0, roughness: 0.85 },
  'fabric-linen':    { color: 0xd8d2c4, metalness: 0.0, roughness: 0.9 },
  'leather-tan':     { color: 0x8b5a2b, metalness: 0.0, roughness: 0.6, clearcoat: 0.3 },
  'marble-white':    { color: 0xeceae4, metalness: 0.0, roughness: 0.18, clearcoat: 0.5 },
  'concrete':        { color: 0x9a9a98, metalness: 0.0, roughness: 0.9 },
  'plastic-matte':   { color: 0x2c2f33, metalness: 0.0, roughness: 0.6 },
  'glass-clear':     { color: 0xeaf2f5, metalness: 0.0, roughness: 0.02, transmission: 0.9, ior: 1.5 },
  'ceramic-white':   { color: 0xf2f0ec, metalness: 0.0, roughness: 0.25, clearcoat: 0.6 },
  'rubber-black':    { color: 0x1a1a1c, metalness: 0.0, roughness: 0.95 },
  // ── ENVIRONMENT / city materials (real CC0 PBR sets, color comes from the
  //    scanned albedo at render time → these base specs only set roughness/metal).
  'asphalt':         { color: 0x3a3b3d, metalness: 0.0, roughness: 0.95 },
  'facade':          { color: 0x9c8b7a, metalness: 0.0, roughness: 0.85 },
  'sidewalk':        { color: 0xb6b3ad, metalness: 0.0, roughness: 0.88 },
  'grass':           { color: 0x4a5d35, metalness: 0.0, roughness: 0.95 },
  // ── AUTOMOTIVE materials (vehicleBuilder.js / flagship sports car) ──────────
  // car-paint: a metallic basecoat under a smooth clearcoat — the defining
  // automotive look. Medium-low base roughness + a hard, near-mirror clearcoat
  // (clearcoatRoughness low) so the path tracer lays a crisp reflection streak
  // over a deep metallic flake colour. The PT honours clearcoat on
  // MeshPhysicalMaterial (see PathTracedRender.physMatFrom).
  'car-paint':       {
    color: 0x8a1620, metalness: 0.85, roughness: 0.38,
    clearcoat: 1.0, clearcoatRoughness: 0.06, specularIntensity: 1.0,
  },
  // chrome: a polished mirror metal for trim / grille slats / exhaust tips.
  'chrome':          { color: 0xeef0f3, metalness: 1.0, roughness: 0.045 },
  // glass / rubber convenience aliases so a builder can tag the human-readable
  // name from the brief and still resolve a full physical spec (the tinted car
  // greenhouse glass + the matte tyre rubber).
  'glass':           { color: 0x12161a, metalness: 0.0, roughness: 0.04, transmission: 0.78, ior: 1.5 },
  'rubber':          { color: 0x121214, metalness: 0.0, roughness: 0.92 },
  // SKIN — subsurface APPROXIMATION inside the MeshPhysicalMaterial system. A
  // warm dermal base (slightly desaturated so the real albedo scan supplies the
  // hue), zero metalness, medium-low roughness (oily highlight on cheeks/nose
  // without going wet), then the SSS cues: a small transmission + finite
  // thickness so thin parts (ears, fingers, nostrils) bleed warm light, a warm
  // attenuation tint for that red-through-flesh look, a soft peach SHEEN for the
  // diffuse fresnel "fuzz" at grazing angles (vellus hair / soft skin rolloff),
  // and a faint clearcoat for the surface oil/sweat layer. `isSkin` flags the
  // renderers to also load the real 4K skin texture set (albedo/normal/rough).
  'skin-warm':       {
    color: 0xe6b89c, metalness: 0.0, roughness: 0.46,
    clearcoat: 0.12, clearcoatRoughness: 0.42,
    transmission: 0.12, thickness: 0.5, ior: 1.4,
    attenuationColor: 0xff5a3c, attenuationDistance: 0.42,
    sheen: 0.55, sheenColor: 0xffb89c, sheenRoughness: 0.65,
    specularIntensity: 0.5,
    isSkin: true,
  },
  // HAIR — a strand/clump material for the parametric hairstyle (groomed
  // character ref Video-350). Hair is a dielectric keratin fibre: a low-
  // saturation base (the real albedo/tint scan supplies the true colour), zero
  // metalness, a MEDIUM-LOW roughness so the path tracer lays the characteristic
  // hair SPECULAR band (the bright lengthwise highlight), and a strong warm
  // SHEEN for the soft secondary scatter glow along the fibre at grazing angles.
  // A faint transmission lets light bleed through thin clumps at the tips, and a
  // light clearcoat gives the groomed/oiled gloss. `isHair` flags the renderers
  // to (a) keep the bright fibre specular, (b) load the real hair albedo/normal/
  // roughness set when present (negative-cached if absent → falls back to this
  // base spec). Used by the strand-clump shells the humanoid builder emits in the
  // 'hair' region.
  'hair-strand':     {
    color: 0x3a2a1e, metalness: 0.0, roughness: 0.32,
    clearcoat: 0.25, clearcoatRoughness: 0.28,
    transmission: 0.06, thickness: 0.02, ior: 1.55,
    sheen: 0.85, sheenColor: 0xc9a878, sheenRoughness: 0.4,
    specularIntensity: 0.85,
    isHair: true,
  },
};

export const MATERIAL_IDS = Object.keys(MATERIALS);

// Resolve a material id (with sensible fuzzy fallback by keyword) → spec.
export function resolveMaterial(id) {
  if (!id) return MATERIALS['plastic-matte'];
  if (MATERIALS[id]) return MATERIALS[id];
  const k = String(id).toLowerCase();
  const hit = MATERIAL_IDS.find((m) => k.includes(m.split('-')[0]));
  return MATERIALS[hit] || MATERIALS['plastic-matte'];
}

// Tool spec Archie calls; handler writes userData.material then the renderer
// rebuilds the mesh's MeshPhysicalMaterial from the preset.
export const SET_MATERIAL_TOOL = {
  name: 'set-material',
  description: 'Assign a PBR material to the selected/target body.',
  parameters: { materialId: 'one of MATERIAL_IDS (steel-brushed, wood-oak, marble-white, fabric-linen, glass-clear, …)' },
};
