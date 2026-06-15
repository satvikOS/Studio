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
