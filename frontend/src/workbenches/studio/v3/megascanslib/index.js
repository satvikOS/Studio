// ArchDisc Studio V3 — Megascans/Quixel/Polyhaven asset library (slice 941).
// Streaming bulk-importer + manifest parser + LOD chain + atlas packer.
// Distinct from slice-771 v3/assetlib/ (which is the in-app procedural catalog).
import { registerOps } from '../common/registry.js';

let _installed = false;
const _assets = new Map();
const _atlasPages = [];

function _normaliseManifest(raw, kind) {
  if (kind === 'quixel') {
    return {
      id: raw.id || raw.assetId,
      name: raw.name || raw.semanticTags?.name || raw.id,
      type: (raw.assetType || 'surface').toLowerCase(),
      tags: raw.tags || raw.semanticTags?.tags || [],
      tier: raw.tier || 1,
      lods: (raw.meshes || []).map((m, i) => ({ level: i, meshUrl: m.uri, lodFactor: m.tris / (raw.meshes[0]?.tris || 1) })),
      maps: Object.fromEntries((raw.components || []).map((c) => [c.type, c.uri])),
      mapResolutions: raw.resolutions || ['2K'],
      previewUrl: raw.previewImage,
    };
  }
  if (kind === 'polyhaven') {
    return {
      id: raw.id,
      name: raw.name,
      type: raw.type || 'surface',
      tags: raw.tags || [],
      tier: 1,
      lods: [{ level: 0, meshUrl: raw.mesh, lodFactor: 1 }],
      maps: { albedo: raw.maps?.diff, normal: raw.maps?.nor, roughness: raw.maps?.rough, displacement: raw.maps?.disp },
      mapResolutions: raw.resolutions || ['1K', '2K', '4K'],
      previewUrl: raw.thumbnail,
    };
  }
  return { id: raw.id, name: raw.name, type: 'unknown', tags: [], tier: 1, lods: [], maps: {} };
}

function _detectKind(raw) {
  if (raw.assetType || raw.semanticTags || raw.components) return 'quixel';
  if (raw.maps && raw.type) return 'polyhaven';
  return 'generic';
}

async function _bulkImport({ rootDir, mapRes = '2K', lodFilter, onProgress } = {}) {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  let listing = [];
  if (window.electronAPI?.scanDir) listing = await window.electronAPI.scanDir(rootDir);
  else return { ok: false, error: 'no electronAPI.scanDir' };
  const manifests = listing.filter((p) => /\.(json|yaml|yml)$/i.test(p));
  let imported = 0;
  for (const mp of manifests) {
    let raw;
    try {
      const txt = await window.electronAPI.readFile(mp);
      raw = mp.endsWith('.json') ? JSON.parse(txt) : null;
    } catch { continue; }
    if (!raw) continue;
    const kind = _detectKind(raw);
    const desc = _normaliseManifest(raw, kind);
    desc.activeLOD = lodFilter != null ? Math.min(lodFilter, desc.lods.length - 1) : 0;
    desc.activeMapRes = mapRes;
    _assets.set(desc.id, desc);
    imported++;
    if (onProgress && imported % 5 === 0) onProgress({ done: imported, total: manifests.length });
    if (imported % 5 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return { ok: true, imported, total: manifests.length };
}

function _packAtlas(assetIds, atlasSize = 8192) {
  const page = { size: atlasSize, rects: [], assets: [] };
  let x = 0, y = 0, rowH = 0;
  for (const id of assetIds) {
    const a = _assets.get(id);
    if (!a) continue;
    const w = 1024, h = 1024;
    if (x + w > atlasSize) { x = 0; y += rowH; rowH = 0; }
    if (y + h > atlasSize) break;
    page.rects.push({ id, x, y, w, h });
    page.assets.push(id);
    x += w + 4; rowH = Math.max(rowH, h);
  }
  _atlasPages.push(page);
  return page;
}

export function installMegascansLib() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioMegascansImport: _bulkImport,
    __studioMegascansSearch: ({ tags, tier, type } = {}) => {
      const matches = [];
      for (const a of _assets.values()) {
        if (tags && !tags.every((t) => a.tags.includes(t))) continue;
        if (tier != null && a.tier !== tier) continue;
        if (type && a.type !== type) continue;
        matches.push(a);
      }
      return { ok: true, results: matches, count: matches.length };
    },
    __studioMegascansGet: ({ assetId }) => { const a = _assets.get(assetId); return a ? { ok: true, asset: a } : { ok: false }; },
    __studioMegascansDrop: async ({ assetId, position = [0, 0, 0] }) => {
      const a = _assets.get(assetId);
      if (!a) return { ok: false, error: 'no asset' };
      const lod = a.lods[a.activeLOD || 0];
      if (!lod) return { ok: false, error: 'no LOD' };
      const r = await fetch(lod.meshUrl).then((r) => r.text()).catch(() => null);
      return { ok: !!r, assetId, droppedAt: position, lodLevel: a.activeLOD || 0, sizeBytes: r?.length || 0 };
    },
    __studioMegascansPackAtlas: ({ assetIds, atlasSize = 8192 }) => ({ ok: true, page: _packAtlas(assetIds, atlasSize) }),
    __studioMegascansList: () => ({ ok: true, count: _assets.size, ids: [..._assets.keys()].slice(0, 100) }),
    __studioMegascansGetStats: () => ({ ok: true, assetCount: _assets.size, atlasPages: _atlasPages.length }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'ingest', 'Megascans/Quixel/Polyhaven asset library importer');
  return { ok: true };
}
export default installMegascansLib;
