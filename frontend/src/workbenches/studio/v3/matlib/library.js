// ArchDisc Studio V3 — KeyShot-scale procedural material library.
//
// 100+ MeshPhysicalMaterial recipes across ten categories. Each entry
// is a pure JSON-safe object so it can be cloned, serialised, fed to
// the offscreen thumbnail renderer, or dispatched at the active
// selection by id. Colours are hex ints (three's Color.set tolerates
// 0x… and strings). Roughness/metalness target physically-plausible
// values; clearcoat/transmission/ior/sheen are only set when relevant
// to keep the param surface minimal per recipe.
//
// id convention: '<category>-<slug>' — kebab-case, no spaces — so the
// auto-registered per-preset palette entry name is deterministic:
// __studioMatLib_<category>_<slug> after the safe-id transform.

// ─── Metals ──────────────────────────────────────────────────────────────
const METALS = [
  { id: 'metals-chrome',         name: 'Chrome',          category: 'Metals', params: { color: 0xffffff, metalness: 1.0, roughness: 0.05, clearcoat: 0.4 } },
  { id: 'metals-gold',           name: 'Gold',            category: 'Metals', params: { color: 0xffd24a, metalness: 1.0, roughness: 0.18 } },
  { id: 'metals-copper',         name: 'Copper',          category: 'Metals', params: { color: 0xb87333, metalness: 1.0, roughness: 0.28 } },
  { id: 'metals-brushed-steel',  name: 'Brushed Steel',   category: 'Metals', params: { color: 0xc4c8cc, metalness: 0.92, roughness: 0.48 } },
  { id: 'metals-anodised-blue',  name: 'Anodised Blue',   category: 'Metals', params: { color: 0x274d8f, metalness: 0.85, roughness: 0.32, clearcoat: 0.2 } },
  { id: 'metals-anodised-red',   name: 'Anodised Red',    category: 'Metals', params: { color: 0x8f2a2a, metalness: 0.85, roughness: 0.32, clearcoat: 0.2 } },
  { id: 'metals-anodised-black', name: 'Anodised Black',  category: 'Metals', params: { color: 0x111418, metalness: 0.85, roughness: 0.34, clearcoat: 0.2 } },
  { id: 'metals-titanium',       name: 'Titanium',        category: 'Metals', params: { color: 0x9ea3aa, metalness: 1.0, roughness: 0.35 } },
  { id: 'metals-aluminium',      name: 'Aluminium',       category: 'Metals', params: { color: 0xd0d4d8, metalness: 1.0, roughness: 0.42 } },
  { id: 'metals-bronze',         name: 'Bronze',          category: 'Metals', params: { color: 0x8a6a3a, metalness: 1.0, roughness: 0.34 } },
  { id: 'metals-iron',           name: 'Iron',            category: 'Metals', params: { color: 0x6e6e74, metalness: 1.0, roughness: 0.55 } },
  { id: 'metals-gunmetal',       name: 'Gunmetal',        category: 'Metals', params: { color: 0x4b4f55, metalness: 1.0, roughness: 0.4 } },
  { id: 'metals-platinum',       name: 'Platinum',        category: 'Metals', params: { color: 0xe5e4e2, metalness: 1.0, roughness: 0.2 } },
  { id: 'metals-rust',           name: 'Rust',            category: 'Metals', params: { color: 0x8a3a18, metalness: 0.4, roughness: 0.85 } },
  { id: 'metals-silver',         name: 'Silver',          category: 'Metals', params: { color: 0xf2f3f5, metalness: 1.0, roughness: 0.1 } },
];

// ─── Plastics ────────────────────────────────────────────────────────────
const PLASTICS = [
  { id: 'plastics-glossy-red',       name: 'Glossy Red',       category: 'Plastics', params: { color: 0xd11a1a, metalness: 0.0, roughness: 0.18, clearcoat: 0.8 } },
  { id: 'plastics-matte-white',      name: 'Matte White',      category: 'Plastics', params: { color: 0xf2f2f2, metalness: 0.0, roughness: 0.85 } },
  { id: 'plastics-abs',              name: 'ABS',              category: 'Plastics', params: { color: 0xdcdcdc, metalness: 0.0, roughness: 0.55 } },
  { id: 'plastics-petg',             name: 'PETG',             category: 'Plastics', params: { color: 0xe8eef2, metalness: 0.0, roughness: 0.35, clearcoat: 0.3, transmission: 0.2, ior: 1.55 } },
  { id: 'plastics-frosted',          name: 'Frosted Plastic',  category: 'Plastics', params: { color: 0xeef2f6, metalness: 0.0, roughness: 0.55, transmission: 0.45, ior: 1.5 } },
  { id: 'plastics-translucent-blue', name: 'Translucent Blue', category: 'Plastics', params: { color: 0x4a8fff, metalness: 0.0, roughness: 0.2, transmission: 0.6, ior: 1.45 } },
  { id: 'plastics-neon-green',       name: 'Neon Green',       category: 'Plastics', params: { color: 0x39ff14, metalness: 0.0, roughness: 0.32, emissive: 0x117a0a, emissiveIntensity: 0.55 } },
  { id: 'plastics-rubber-grip',      name: 'Rubber Grip',      category: 'Plastics', params: { color: 0x1c1c1c, metalness: 0.0, roughness: 0.95 } },
  { id: 'plastics-silicone',         name: 'Silicone',         category: 'Plastics', params: { color: 0xe9e7e3, metalness: 0.0, roughness: 0.6, transmission: 0.18, ior: 1.41 } },
  { id: 'plastics-latex',            name: 'Latex',            category: 'Plastics', params: { color: 0xf2e9da, metalness: 0.0, roughness: 0.75 } },
  { id: 'plastics-polycarbonate',    name: 'Polycarbonate',    category: 'Plastics', params: { color: 0xffffff, metalness: 0.0, roughness: 0.12, clearcoat: 0.6, transmission: 0.65, ior: 1.585 } },
  { id: 'plastics-nylon',            name: 'Nylon',            category: 'Plastics', params: { color: 0xeae2cf, metalness: 0.0, roughness: 0.65 } },
  { id: 'plastics-acrylic-clear',    name: 'Acrylic Clear',    category: 'Plastics', params: { color: 0xffffff, metalness: 0.0, roughness: 0.06, clearcoat: 0.5, transmission: 0.85, ior: 1.49 } },
  { id: 'plastics-pvc-grey',         name: 'PVC Grey',         category: 'Plastics', params: { color: 0xb8babf, metalness: 0.0, roughness: 0.5 } },
  { id: 'plastics-glossy-yellow',    name: 'Glossy Yellow',    category: 'Plastics', params: { color: 0xffd400, metalness: 0.0, roughness: 0.18, clearcoat: 0.8 } },
];

// ─── Glass ──────────────────────────────────────────────────────────────
const GLASS = [
  { id: 'glass-clear',       name: 'Clear Glass',      category: 'Glass', params: { color: 0xffffff, metalness: 0.0, roughness: 0.0, transmission: 1.0, ior: 1.52, clearcoat: 0.4 } },
  { id: 'glass-frosted',     name: 'Frosted Glass',    category: 'Glass', params: { color: 0xffffff, metalness: 0.0, roughness: 0.6,  transmission: 0.8, ior: 1.5 } },
  { id: 'glass-smoked',      name: 'Smoked Glass',     category: 'Glass', params: { color: 0x202428, metalness: 0.0, roughness: 0.05, transmission: 0.75, ior: 1.52 } },
  { id: 'glass-blue-tint',   name: 'Blue Tint Glass',  category: 'Glass', params: { color: 0xaad4ff, metalness: 0.0, roughness: 0.02, transmission: 0.9, ior: 1.52 } },
  { id: 'glass-green-tint',  name: 'Green Tint Glass', category: 'Glass', params: { color: 0xaee4c4, metalness: 0.0, roughness: 0.02, transmission: 0.9, ior: 1.52 } },
  { id: 'glass-opaque-white',name: 'Opaque White Glass',category: 'Glass',params: { color: 0xf6f6f6, metalness: 0.0, roughness: 0.35, transmission: 0.0, clearcoat: 0.3 } },
  { id: 'glass-bead',        name: 'Glass Bead',       category: 'Glass', params: { color: 0xfff5ee, metalness: 0.0, roughness: 0.0, transmission: 1.0, ior: 1.55, clearcoat: 0.8 } },
  { id: 'glass-block',       name: 'Glass Block',      category: 'Glass', params: { color: 0xe6f1f5, metalness: 0.0, roughness: 0.1,  transmission: 0.85, ior: 1.52 } },
  { id: 'glass-mirror',      name: 'Mirror',           category: 'Glass', params: { color: 0xffffff, metalness: 1.0, roughness: 0.0,  clearcoat: 1.0 } },
  { id: 'glass-two-way',     name: 'Two-Way Mirror',   category: 'Glass', params: { color: 0xdadddf, metalness: 0.85, roughness: 0.1, transmission: 0.45, ior: 1.5 } },
  { id: 'glass-amber',       name: 'Amber Glass',      category: 'Glass', params: { color: 0xc97c14, metalness: 0.0, roughness: 0.03, transmission: 0.85, ior: 1.52 } },
  { id: 'glass-rose',        name: 'Rose Glass',       category: 'Glass', params: { color: 0xf2b7b7, metalness: 0.0, roughness: 0.03, transmission: 0.85, ior: 1.52 } },
];

// ─── Wood ───────────────────────────────────────────────────────────────
const WOOD = [
  { id: 'wood-oak',             name: 'Oak',              category: 'Wood', params: { color: 0x9c7a4a, metalness: 0.0, roughness: 0.7 } },
  { id: 'wood-maple',           name: 'Maple',            category: 'Wood', params: { color: 0xd9b88a, metalness: 0.0, roughness: 0.55 } },
  { id: 'wood-walnut',          name: 'Walnut',           category: 'Wood', params: { color: 0x4a2e1e, metalness: 0.0, roughness: 0.65 } },
  { id: 'wood-cherry',          name: 'Cherry',           category: 'Wood', params: { color: 0x7a3826, metalness: 0.0, roughness: 0.55 } },
  { id: 'wood-bamboo',          name: 'Bamboo',           category: 'Wood', params: { color: 0xd4c08c, metalness: 0.0, roughness: 0.6 } },
  { id: 'wood-teak',            name: 'Teak',             category: 'Wood', params: { color: 0xa07041, metalness: 0.0, roughness: 0.65 } },
  { id: 'wood-mahogany',        name: 'Mahogany',         category: 'Wood', params: { color: 0x6a2f1e, metalness: 0.0, roughness: 0.5, clearcoat: 0.3 } },
  { id: 'wood-weathered-pine',  name: 'Weathered Pine',   category: 'Wood', params: { color: 0xa89a82, metalness: 0.0, roughness: 0.95 } },
  { id: 'wood-painted-white',   name: 'Painted White Wood',category: 'Wood',params:{ color: 0xf2efe7, metalness: 0.0, roughness: 0.55, clearcoat: 0.2 } },
  { id: 'wood-charred',         name: 'Charred Wood',     category: 'Wood', params: { color: 0x1a1715, metalness: 0.0, roughness: 0.85 } },
  { id: 'wood-distressed',      name: 'Distressed Wood',  category: 'Wood', params: { color: 0x6a5240, metalness: 0.0, roughness: 0.95 } },
  { id: 'wood-ebony',           name: 'Ebony',            category: 'Wood', params: { color: 0x1c1610, metalness: 0.0, roughness: 0.45, clearcoat: 0.45 } },
  { id: 'wood-birch',           name: 'Birch',            category: 'Wood', params: { color: 0xe5d2a8, metalness: 0.0, roughness: 0.55 } },
];

// ─── Concrete ───────────────────────────────────────────────────────────
const CONCRETE = [
  { id: 'concrete-raw',      name: 'Raw Concrete',      category: 'Concrete', params: { color: 0x9a9a98, metalness: 0.0, roughness: 0.95 } },
  { id: 'concrete-smooth',   name: 'Smooth Concrete',   category: 'Concrete', params: { color: 0xb2b2b0, metalness: 0.0, roughness: 0.8 } },
  { id: 'concrete-polished', name: 'Polished Concrete', category: 'Concrete', params: { color: 0xc0c0bd, metalness: 0.0, roughness: 0.32, clearcoat: 0.35 } },
  { id: 'concrete-stained',  name: 'Stained Concrete',  category: 'Concrete', params: { color: 0x6e6862, metalness: 0.0, roughness: 0.7 } },
  { id: 'concrete-mossy',    name: 'Mossy Concrete',    category: 'Concrete', params: { color: 0x6a7a5a, metalness: 0.0, roughness: 0.95 } },
  { id: 'concrete-painted',  name: 'Painted Concrete',  category: 'Concrete', params: { color: 0xd8d4cc, metalness: 0.0, roughness: 0.6 } },
  { id: 'concrete-dark',     name: 'Dark Concrete',     category: 'Concrete', params: { color: 0x4a4a48, metalness: 0.0, roughness: 0.9 } },
];

// ─── Stone ──────────────────────────────────────────────────────────────
const STONE = [
  { id: 'stone-marble',     name: 'White Marble',  category: 'Stone', params: { color: 0xe9e6df, metalness: 0.0, roughness: 0.2, clearcoat: 0.5 } },
  { id: 'stone-granite',    name: 'Granite',       category: 'Stone', params: { color: 0x504a48, metalness: 0.1, roughness: 0.55 } },
  { id: 'stone-slate',      name: 'Slate',         category: 'Stone', params: { color: 0x3a3a40, metalness: 0.0, roughness: 0.85 } },
  { id: 'stone-sandstone',  name: 'Sandstone',     category: 'Stone', params: { color: 0xc8a878, metalness: 0.0, roughness: 0.9 } },
  { id: 'stone-basalt',     name: 'Basalt',        category: 'Stone', params: { color: 0x1f1f22, metalness: 0.05, roughness: 0.85 } },
  { id: 'stone-travertine', name: 'Travertine',    category: 'Stone', params: { color: 0xd6c8a8, metalness: 0.0, roughness: 0.6 } },
  { id: 'stone-limestone',  name: 'Limestone',     category: 'Stone', params: { color: 0xd2cdb8, metalness: 0.0, roughness: 0.8 } },
  { id: 'stone-onyx',       name: 'Onyx',          category: 'Stone', params: { color: 0x161616, metalness: 0.0, roughness: 0.1,  clearcoat: 0.8 } },
];

// ─── Fabric ─────────────────────────────────────────────────────────────
const FABRIC = [
  { id: 'fabric-denim',  name: 'Denim',  category: 'Fabric', params: { color: 0x335a8a, metalness: 0.0, roughness: 0.92, sheen: 0.4, sheenColor: 0x4f7ab8 } },
  { id: 'fabric-canvas', name: 'Canvas', category: 'Fabric', params: { color: 0xc8b48a, metalness: 0.0, roughness: 0.95 } },
  { id: 'fabric-velvet', name: 'Velvet', category: 'Fabric', params: { color: 0x6e1e3a, metalness: 0.0, roughness: 1.0, sheen: 1.0, sheenColor: 0xff8aa5 } },
  { id: 'fabric-silk',   name: 'Silk',   category: 'Fabric', params: { color: 0xd9c9a8, metalness: 0.0, roughness: 0.35, sheen: 0.85, sheenColor: 0xfff0c2 } },
  { id: 'fabric-wool',   name: 'Wool',   category: 'Fabric', params: { color: 0x968878, metalness: 0.0, roughness: 0.95, sheen: 0.6, sheenColor: 0xb8a890 } },
  { id: 'fabric-linen',  name: 'Linen',  category: 'Fabric', params: { color: 0xddd0b8, metalness: 0.0, roughness: 0.95 } },
  { id: 'fabric-leather',name: 'Leather',category: 'Fabric', params: { color: 0x5a3520, metalness: 0.0, roughness: 0.5, clearcoat: 0.3 } },
  { id: 'fabric-suede',  name: 'Suede',  category: 'Fabric', params: { color: 0x806045, metalness: 0.0, roughness: 0.95, sheen: 0.5, sheenColor: 0xa08868 } },
  { id: 'fabric-felt',   name: 'Felt',   category: 'Fabric', params: { color: 0x8a4a6e, metalness: 0.0, roughness: 1.0, sheen: 0.7, sheenColor: 0xa05080 } },
  { id: 'fabric-corduroy',name:'Corduroy',category:'Fabric', params: { color: 0x6e5a40, metalness: 0.0, roughness: 0.9, sheen: 0.5, sheenColor: 0x8e7858 } },
  { id: 'fabric-tweed',  name: 'Tweed',  category: 'Fabric', params: { color: 0x6a5648, metalness: 0.0, roughness: 0.95, sheen: 0.45, sheenColor: 0x968070 } },
];

// ─── Ceramic ────────────────────────────────────────────────────────────
const CERAMIC = [
  { id: 'ceramic-porcelain',  name: 'Porcelain',      category: 'Ceramic', params: { color: 0xfafafa, metalness: 0.0, roughness: 0.18, clearcoat: 0.85 } },
  { id: 'ceramic-terracotta', name: 'Terracotta',     category: 'Ceramic', params: { color: 0xa84a2a, metalness: 0.0, roughness: 0.75 } },
  { id: 'ceramic-glazed-blue',name: 'Glazed Blue',    category: 'Ceramic', params: { color: 0x2266a8, metalness: 0.0, roughness: 0.15, clearcoat: 0.9 } },
  { id: 'ceramic-raku',       name: 'Raku',           category: 'Ceramic', params: { color: 0x2a2a30, metalness: 0.2, roughness: 0.6, clearcoat: 0.45 } },
  { id: 'ceramic-stoneware',  name: 'Stoneware',      category: 'Ceramic', params: { color: 0x8a7866, metalness: 0.0, roughness: 0.7 } },
  { id: 'ceramic-earthenware',name: 'Earthenware',    category: 'Ceramic', params: { color: 0xa67452, metalness: 0.0, roughness: 0.85 } },
];

// ─── Paint ──────────────────────────────────────────────────────────────
const PAINT = [
  { id: 'paint-matte-black',     name: 'Matte Black',      category: 'Paint', params: { color: 0x0a0a0a, metalness: 0.0, roughness: 0.9 } },
  { id: 'paint-satin-grey',      name: 'Satin Grey',       category: 'Paint', params: { color: 0x868a90, metalness: 0.0, roughness: 0.45 } },
  { id: 'paint-eggshell',        name: 'Eggshell',         category: 'Paint', params: { color: 0xf2eddf, metalness: 0.0, roughness: 0.65 } },
  { id: 'paint-gloss-red',       name: 'Gloss Red',        category: 'Paint', params: { color: 0xc60a0a, metalness: 0.0, roughness: 0.1,  clearcoat: 1.0 } },
  { id: 'paint-primer-grey',     name: 'Primer Grey',      category: 'Paint', params: { color: 0x9a9a98, metalness: 0.0, roughness: 0.95 } },
  { id: 'paint-automotive-clear',name: 'Automotive Clear', category: 'Paint', params: { color: 0xffffff, metalness: 0.0, roughness: 0.05, clearcoat: 1.0, transmission: 0.1, ior: 1.5 } },
  { id: 'paint-pearl-white',     name: 'Pearl White',      category: 'Paint', params: { color: 0xf7f4ee, metalness: 0.35, roughness: 0.25, clearcoat: 0.8 } },
  { id: 'paint-metallic-blue',   name: 'Metallic Blue',    category: 'Paint', params: { color: 0x1c4a82, metalness: 0.6, roughness: 0.32, clearcoat: 0.8 } },
  { id: 'paint-army-green',      name: 'Army Green',       category: 'Paint', params: { color: 0x3e4a2a, metalness: 0.0, roughness: 0.85 } },
  { id: 'paint-yellow-hi-vis',   name: 'Hi-Vis Yellow',    category: 'Paint', params: { color: 0xfff43a, metalness: 0.0, roughness: 0.55, emissive: 0x8a7e10, emissiveIntensity: 0.18 } },
  { id: 'paint-chalkboard',      name: 'Chalkboard',       category: 'Paint', params: { color: 0x1c2620, metalness: 0.0, roughness: 0.95 } },
];

// ─── Misc ───────────────────────────────────────────────────────────────
const MISC = [
  { id: 'misc-skin',      name: 'Skin',      category: 'Misc', params: { color: 0xe9b894, metalness: 0.0, roughness: 0.55, sheen: 0.25, sheenColor: 0xc88a6a, clearcoat: 0.15 } },
  { id: 'misc-water',     name: 'Water',     category: 'Misc', params: { color: 0xa8d8f5, metalness: 0.0, roughness: 0.0,  transmission: 1.0, ior: 1.333, clearcoat: 0.5 } },
  { id: 'misc-ice',       name: 'Ice',       category: 'Misc', params: { color: 0xcfe6f4, metalness: 0.0, roughness: 0.15, transmission: 0.85, ior: 1.31, clearcoat: 0.4 } },
  { id: 'misc-lava',      name: 'Lava',      category: 'Misc', params: { color: 0xff5410, metalness: 0.0, roughness: 0.7,  emissive: 0xff3a08, emissiveIntensity: 1.4 } },
  { id: 'misc-gold-leaf', name: 'Gold Leaf', category: 'Misc', params: { color: 0xffe27a, metalness: 1.0, roughness: 0.32 } },
  { id: 'misc-jade',      name: 'Jade',      category: 'Misc', params: { color: 0x4a8a6c, metalness: 0.0, roughness: 0.25, transmission: 0.45, ior: 1.66, clearcoat: 0.4 } },
  { id: 'misc-wax',       name: 'Wax',       category: 'Misc', params: { color: 0xe9c468, metalness: 0.0, roughness: 0.45, transmission: 0.35, ior: 1.44 } },
  { id: 'misc-bubble',    name: 'Bubble',    category: 'Misc', params: { color: 0xffffff, metalness: 0.0, roughness: 0.0, transmission: 1.0, ior: 1.0,  clearcoat: 1.0 } },
];

// ─── Aggregate library + helpers ─────────────────────────────────────────
export const RECIPES = [
  ...METALS, ...PLASTICS, ...GLASS, ...WOOD, ...CONCRETE,
  ...STONE, ...FABRIC, ...CERAMIC, ...PAINT, ...MISC,
];

// Categories in dropdown order. Match the visual grouping used by the
// browser sidebar; 'All' is synthesised at runtime.
export const CATEGORIES = [
  'Metals', 'Plastics', 'Glass', 'Wood', 'Concrete',
  'Stone', 'Fabric', 'Ceramic', 'Paint', 'Misc',
];

export function findRecipe(id) {
  if (!id) return null;
  for (const r of RECIPES) if (r.id === id) return r;
  return null;
}

export function recipesByCategory(cat) {
  if (!cat || cat === 'All') return RECIPES.slice();
  return RECIPES.filter((r) => r.category === cat);
}

export function countByCategory() {
  const m = {};
  for (const r of RECIPES) m[r.category] = (m[r.category] || 0) + 1;
  return m;
}

// Convert a recipe id into a function-name suffix safe for window.*.
// e.g. 'metals-anodised-blue' → 'metals_anodised_blue'.
export function safeIdSuffix(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_]+/g, '_');
}
