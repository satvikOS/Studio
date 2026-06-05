// Slice 697 — Cycles full BRDF: read full PBR material context per mesh.
// Used by sceneAugment.js to build per-tri BRDF DataTextures alongside
// the slice-693 rtgpu albedo soup.

export function packExtendedMaterial(mesh) {
  if (!mesh) return null;
  const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!m) return null;
  const emissive = m.emissive ? { r: m.emissive.r, g: m.emissive.g, b: m.emissive.b } : { r: 0, g: 0, b: 0 };
  return {
    roughness: typeof m.roughness === 'number' ? m.roughness : 0.5,
    metalness: typeof m.metalness === 'number' ? m.metalness : 0,
    emissive: [emissive.r, emissive.g, emissive.b],
    emissiveIntensity: typeof m.emissiveIntensity === 'number' ? m.emissiveIntensity : 1,
    transmission: typeof m.transmission === 'number' ? m.transmission : 0,
    ior: typeof m.ior === 'number' ? m.ior : 1.5,
    hasNormalMap: !!m.normalMap,
  };
}
