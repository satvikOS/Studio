// ArchDisc Studio V3 — sample a material's diffuse map at a UV coord.
//
// Before dedup this lived in rt/pathtracer.js as _sampleMaterialTextureAtUV;
// rtgpu (and shaderptbridge once wave 8 lands) need the same primitive so
// it has been promoted to common/.

// Returns { r, g, b } in 0..1, or null when no sampleable texture exists.
// Handles CanvasTexture (from shader bake + texpaint), HTMLImageElement,
// and the texture's offset/repeat transform. Wraps UV to [0,1).
export function sampleMaterialTextureAtUV(material, u, v) {
  const m = Array.isArray(material) ? material[0] : material;
  if (!m || !m.map) return null;
  const tex = m.map;
  const img = tex.image;
  if (!img || !img.width || !img.height) return null;

  let uu = u, vv = v;
  if (tex.offset) { uu = uu + tex.offset.x; vv = vv + tex.offset.y; }
  if (tex.repeat) { uu *= tex.repeat.x;     vv *= tex.repeat.y; }
  uu = ((uu % 1) + 1) % 1;
  vv = ((vv % 1) + 1) % 1;

  try {
    let canvas;
    if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) {
      canvas = img;
    } else if ((typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement)
               || (img && img.tagName === 'IMG' && img.complete)) {
      canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
    } else {
      return null;
    }
    const px = Math.max(0, Math.min(canvas.width  - 1, Math.floor(uu * canvas.width)));
    const py = Math.max(0, Math.min(canvas.height - 1, Math.floor((1 - vv) * canvas.height)));
    const data = canvas.getContext('2d').getImageData(px, py, 1, 1).data;
    return { r: data[0] / 255, g: data[1] / 255, b: data[2] / 255 };
  } catch (_) {
    return null;
  }
}
