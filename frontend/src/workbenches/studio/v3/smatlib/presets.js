// ArchDisc Studio V3 — Substance Painter SMART MATERIAL LIBRARY presets
// (slice 769).
//
// 35 PBR preset entries grouped into seven categories matching the
// Substance Painter "Smart Materials" shelf taxonomy:
//   metals (10)  — gold/copper/aluminum/iron/steel/bronze/titanium/
//                  chrome/nickel/brass
//   woods (4)    — oak/walnut/pine/mahogany
//   plastics (4) — matte/glossy/silicone/rubber
//   fabrics (6)  — linen/cotton/silk/wool/velvet/denim
//   ceramics (4) — porcelain/terracotta/glazed/raw
//   stones (4)   — marble/granite/sandstone/slate
//   glass (3)    — clear/frosted/tinted
//
// Each entry is `{name, category, baseColor, roughness, metalness,
// ior, clearcoat, normalScale, color, emissive}`. `baseColor` is a hex
// integer (0x…) — the same Color() input format three.js accepts. The
// optional `color` mirror is included for callers that want a quick
// numeric handle without re-reading baseColor (the spec lists both).
// Substance-style values:
//   • Metals:   roughness ≤ 0.40, metalness 1.0
//   • Woods:    roughness 0.70-0.90, metalness 0.0
//   • Plastics: roughness 0.20-0.80 (depending on glossy/matte)
//   • Fabrics:  roughness 0.80-1.00, slight normalScale variation
//   • Ceramics: roughness 0.05-0.60 (porcelain glaze → raw clay)
//   • Stones:   roughness 0.40-0.80
//   • Glass:    roughness 0-0.05, ior 1.5, transmissive
//
// `clearcoat` is set only where the real Substance preset would apply a
// clearcoat lobe (chrome, porcelain glaze, glazed ceramic, silk, glass).
// `ior` is set for transmissive materials (glass) and a couple of high-
// refraction non-metals; metals leave it undefined since metalness=1 is
// already a full-Fresnel mirror.
// `normalScale` non-1.0 is used for fabrics + raw ceramics + stones to
// indicate the typical Substance "Detail Normal" amplitude — applyPreset
// reads it but only the MeshPhysicalMaterial path will honour it if a
// normal map is also bound. It's stored in the table either way so the
// preview op can surface it.

export const SMART_PRESETS = [
  // ─── Metals ────────────────────────────────────────────────────────────
  {
    name: 'gold',
    category: 'metals',
    baseColor: 0xffd24a, color: 0xffd24a,
    roughness: 0.18, metalness: 1.0,
    ior: undefined, clearcoat: 0, normalScale: 1.0, emissive: 0x000000,
  },
  {
    name: 'copper',
    category: 'metals',
    baseColor: 0xb87333, color: 0xb87333,
    roughness: 0.28, metalness: 1.0,
    ior: undefined, clearcoat: 0, normalScale: 1.0, emissive: 0x000000,
  },
  {
    name: 'aluminum',
    category: 'metals',
    baseColor: 0xd0d4d8, color: 0xd0d4d8,
    roughness: 0.40, metalness: 1.0,
    ior: undefined, clearcoat: 0, normalScale: 1.0, emissive: 0x000000,
  },
  {
    name: 'iron',
    category: 'metals',
    baseColor: 0x6e6e74, color: 0x6e6e74,
    roughness: 0.38, metalness: 1.0,
    ior: undefined, clearcoat: 0, normalScale: 1.0, emissive: 0x000000,
  },
  {
    name: 'steel',
    category: 'metals',
    baseColor: 0xc4c8cc, color: 0xc4c8cc,
    roughness: 0.32, metalness: 1.0,
    ior: undefined, clearcoat: 0, normalScale: 1.0, emissive: 0x000000,
  },
  {
    name: 'bronze',
    category: 'metals',
    baseColor: 0x8a6a3a, color: 0x8a6a3a,
    roughness: 0.34, metalness: 1.0,
    ior: undefined, clearcoat: 0, normalScale: 1.0, emissive: 0x000000,
  },
  {
    name: 'titanium',
    category: 'metals',
    baseColor: 0x9ea3aa, color: 0x9ea3aa,
    roughness: 0.35, metalness: 1.0,
    ior: undefined, clearcoat: 0, normalScale: 1.0, emissive: 0x000000,
  },
  {
    name: 'chrome',
    category: 'metals',
    baseColor: 0xffffff, color: 0xffffff,
    roughness: 0.05, metalness: 1.0,
    ior: undefined, clearcoat: 0.4, normalScale: 1.0, emissive: 0x000000,
  },
  {
    name: 'nickel',
    category: 'metals',
    baseColor: 0xb8b4a8, color: 0xb8b4a8,
    roughness: 0.22, metalness: 1.0,
    ior: undefined, clearcoat: 0, normalScale: 1.0, emissive: 0x000000,
  },
  {
    name: 'brass',
    category: 'metals',
    baseColor: 0xc8a44a, color: 0xc8a44a,
    roughness: 0.30, metalness: 1.0,
    ior: undefined, clearcoat: 0, normalScale: 1.0, emissive: 0x000000,
  },

  // ─── Woods ─────────────────────────────────────────────────────────────
  {
    name: 'oak',
    category: 'woods',
    baseColor: 0x9c7a4a, color: 0x9c7a4a,
    roughness: 0.75, metalness: 0.0,
    ior: undefined, clearcoat: 0, normalScale: 1.0, emissive: 0x000000,
  },
  {
    name: 'walnut',
    category: 'woods',
    baseColor: 0x4a2e1e, color: 0x4a2e1e,
    roughness: 0.70, metalness: 0.0,
    ior: undefined, clearcoat: 0, normalScale: 1.0, emissive: 0x000000,
  },
  {
    name: 'pine',
    category: 'woods',
    baseColor: 0xd9b88a, color: 0xd9b88a,
    roughness: 0.85, metalness: 0.0,
    ior: undefined, clearcoat: 0, normalScale: 1.0, emissive: 0x000000,
  },
  {
    name: 'mahogany',
    category: 'woods',
    baseColor: 0x6a2f1e, color: 0x6a2f1e,
    roughness: 0.55, metalness: 0.0,
    ior: undefined, clearcoat: 0.3, normalScale: 1.0, emissive: 0x000000,
  },

  // ─── Plastics ──────────────────────────────────────────────────────────
  {
    name: 'matte_plastic',
    category: 'plastics',
    baseColor: 0xf2f2f2, color: 0xf2f2f2,
    roughness: 0.80, metalness: 0.0,
    ior: undefined, clearcoat: 0, normalScale: 1.0, emissive: 0x000000,
  },
  {
    name: 'glossy_plastic',
    category: 'plastics',
    baseColor: 0xd11a1a, color: 0xd11a1a,
    roughness: 0.20, metalness: 0.0,
    ior: undefined, clearcoat: 0.8, normalScale: 1.0, emissive: 0x000000,
  },
  {
    name: 'silicone',
    category: 'plastics',
    baseColor: 0xe9e7e3, color: 0xe9e7e3,
    roughness: 0.60, metalness: 0.0,
    ior: 1.41, clearcoat: 0, normalScale: 1.0, emissive: 0x000000,
  },
  {
    name: 'rubber',
    category: 'plastics',
    baseColor: 0x1c1c1c, color: 0x1c1c1c,
    roughness: 0.80, metalness: 0.0,
    ior: undefined, clearcoat: 0, normalScale: 1.0, emissive: 0x000000,
  },

  // ─── Fabrics ───────────────────────────────────────────────────────────
  {
    name: 'linen',
    category: 'fabrics',
    baseColor: 0xddd0b8, color: 0xddd0b8,
    roughness: 0.95, metalness: 0.0,
    ior: undefined, clearcoat: 0, normalScale: 1.2, emissive: 0x000000,
  },
  {
    name: 'cotton',
    category: 'fabrics',
    baseColor: 0xf2efe5, color: 0xf2efe5,
    roughness: 0.92, metalness: 0.0,
    ior: undefined, clearcoat: 0, normalScale: 1.1, emissive: 0x000000,
  },
  {
    name: 'silk',
    category: 'fabrics',
    baseColor: 0xd9c9a8, color: 0xd9c9a8,
    roughness: 0.80, metalness: 0.0,
    ior: undefined, clearcoat: 0.4, normalScale: 1.0, emissive: 0x000000,
  },
  {
    name: 'wool',
    category: 'fabrics',
    baseColor: 0x968878, color: 0x968878,
    roughness: 0.98, metalness: 0.0,
    ior: undefined, clearcoat: 0, normalScale: 1.4, emissive: 0x000000,
  },
  {
    name: 'velvet',
    category: 'fabrics',
    baseColor: 0x6e1e3a, color: 0x6e1e3a,
    roughness: 1.00, metalness: 0.0,
    ior: undefined, clearcoat: 0, normalScale: 1.3, emissive: 0x000000,
  },
  {
    name: 'denim',
    category: 'fabrics',
    baseColor: 0x335a8a, color: 0x335a8a,
    roughness: 0.92, metalness: 0.0,
    ior: undefined, clearcoat: 0, normalScale: 1.2, emissive: 0x000000,
  },

  // ─── Ceramics ──────────────────────────────────────────────────────────
  {
    name: 'porcelain',
    category: 'ceramics',
    baseColor: 0xfafafa, color: 0xfafafa,
    roughness: 0.08, metalness: 0.0,
    ior: 1.50, clearcoat: 0.85, normalScale: 1.0, emissive: 0x000000,
  },
  {
    name: 'terracotta',
    category: 'ceramics',
    baseColor: 0xa84a2a, color: 0xa84a2a,
    roughness: 0.60, metalness: 0.0,
    ior: undefined, clearcoat: 0, normalScale: 1.2, emissive: 0x000000,
  },
  {
    name: 'glazed_ceramic',
    category: 'ceramics',
    baseColor: 0x2266a8, color: 0x2266a8,
    roughness: 0.10, metalness: 0.0,
    ior: 1.50, clearcoat: 0.90, normalScale: 1.0, emissive: 0x000000,
  },
  {
    name: 'raw_ceramic',
    category: 'ceramics',
    baseColor: 0x8a7866, color: 0x8a7866,
    roughness: 0.55, metalness: 0.0,
    ior: undefined, clearcoat: 0, normalScale: 1.3, emissive: 0x000000,
  },

  // ─── Stones ────────────────────────────────────────────────────────────
  {
    name: 'marble',
    category: 'stones',
    baseColor: 0xe9e6df, color: 0xe9e6df,
    roughness: 0.40, metalness: 0.0,
    ior: undefined, clearcoat: 0.5, normalScale: 1.0, emissive: 0x000000,
  },
  {
    name: 'granite',
    category: 'stones',
    baseColor: 0x504a48, color: 0x504a48,
    roughness: 0.55, metalness: 0.1,
    ior: undefined, clearcoat: 0, normalScale: 1.1, emissive: 0x000000,
  },
  {
    name: 'sandstone',
    category: 'stones',
    baseColor: 0xc8a878, color: 0xc8a878,
    roughness: 0.80, metalness: 0.0,
    ior: undefined, clearcoat: 0, normalScale: 1.2, emissive: 0x000000,
  },
  {
    name: 'slate',
    category: 'stones',
    baseColor: 0x3a3a40, color: 0x3a3a40,
    roughness: 0.70, metalness: 0.0,
    ior: undefined, clearcoat: 0, normalScale: 1.1, emissive: 0x000000,
  },

  // ─── Glass ─────────────────────────────────────────────────────────────
  {
    name: 'clear_glass',
    category: 'glass',
    baseColor: 0xffffff, color: 0xffffff,
    roughness: 0.0, metalness: 0.0,
    ior: 1.50, clearcoat: 0.4, normalScale: 1.0, emissive: 0x000000,
    transmission: 1.0,
  },
  {
    name: 'frosted_glass',
    category: 'glass',
    baseColor: 0xffffff, color: 0xffffff,
    roughness: 0.05, metalness: 0.0,
    ior: 1.50, clearcoat: 0, normalScale: 1.0, emissive: 0x000000,
    transmission: 0.85,
  },
  {
    name: 'tinted_glass',
    category: 'glass',
    baseColor: 0xaad4ff, color: 0xaad4ff,
    roughness: 0.02, metalness: 0.0,
    ior: 1.50, clearcoat: 0.3, normalScale: 1.0, emissive: 0x000000,
    transmission: 0.9,
  },
];

// Sanity: assert (in dev) we hit the 30+ minimum the slice brief calls
// for. Cheap — runs once at module load. Catches regressions if a
// future edit accidentally drops half the table.
if (SMART_PRESETS.length < 30) {
  // eslint-disable-next-line no-console
  console.warn(`[smatlib] preset table dropped below 30 entries (= ${SMART_PRESETS.length})`);
}

// ─── Indexed views ───────────────────────────────────────────────────────
const _byName = new Map(SMART_PRESETS.map((p) => [p.name, p]));
const _byCategory = (() => {
  const m = new Map();
  for (const p of SMART_PRESETS) {
    if (!m.has(p.category)) m.set(p.category, []);
    m.get(p.category).push(p);
  }
  return m;
})();

export const SMART_CATEGORIES = Array.from(_byCategory.keys());

export function findPreset(name) {
  if (!name) return null;
  return _byName.get(String(name)) || null;
}

export function presetsByCategory(category) {
  if (!category) return SMART_PRESETS.slice();
  return (_byCategory.get(String(category)) || []).slice();
}

export function presetCount() {
  return SMART_PRESETS.length;
}
