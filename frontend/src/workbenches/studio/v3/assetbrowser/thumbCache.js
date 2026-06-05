// ArchDisc Studio V3 — Asset Browser thumbnail cache.
//
// In-module Map keyed by asset name → dataURL string. The browser panel
// pulls from here for every 96×96 tile so re-renders cost ~zero GPU
// time after the warm-up sweep. We prefer slice-671's
// __studioGenerateThumbnail (which renders the *live* mesh, not the
// serialised snapshot) when an instance with matching
// userData.archdiscStudioAssetName is already in the scene; otherwise
// we fall back to a deterministic solid-colour placeholder derived from
// the asset name + tag so the grid never shows broken tiles.
//
// Pure JS, no extra deps, no WASM, no new npm packages.

const _cache = new Map(); // name → dataURL
const _placeholderCache = new Map(); // name → dataURL

const PLACEHOLDER_PX = 96;

// FNV-1a 32-bit hash so identical names map to identical colours every
// page-load (no flicker on reload). Matches the pattern in api.js
// _fingerprint so the asset browser feels visually consistent with the
// versions panel.
function _hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function _hueFor(name) {
  return (_hash(String(name)) % 360);
}

function _placeholderDataUrl(name, tag) {
  const key = `${name}|${tag || ''}`;
  if (_placeholderCache.has(key)) return _placeholderCache.get(key);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = PLACEHOLDER_PX; canvas.height = PLACEHOLDER_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const hue = _hueFor(name);
  // Diagonal two-stop gradient — gives every placeholder a unique-ish
  // visual without ever looking generic-grey.
  const grad = ctx.createLinearGradient(0, 0, PLACEHOLDER_PX, PLACEHOLDER_PX);
  grad.addColorStop(0, `hsl(${hue}, 55%, 42%)`);
  grad.addColorStop(1, `hsl(${(hue + 32) % 360}, 60%, 22%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, PLACEHOLDER_PX, PLACEHOLDER_PX);
  // First-letter glyph so the user can scan-read while thumbs are warming.
  const letter = (String(name).trim()[0] || '?').toUpperCase();
  ctx.font = 'bold 44px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 4;
  ctx.fillStyle = '#f4f8ff';
  ctx.fillText(letter, PLACEHOLDER_PX / 2, PLACEHOLDER_PX / 2 + 2);
  // Tag chip in bottom-left if present.
  if (tag) {
    ctx.shadowBlur = 0;
    ctx.font = '600 9px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const tagText = String(tag).slice(0, 12).toUpperCase();
    const tw = ctx.measureText(tagText).width + 8;
    ctx.fillStyle = 'rgba(13,17,23,0.78)';
    ctx.fillRect(4, PLACEHOLDER_PX - 16, tw, 12);
    ctx.fillStyle = '#cdd6e2';
    ctx.fillText(tagText, 8, PLACEHOLDER_PX - 6);
  }
  const url = canvas.toDataURL('image/png');
  _placeholderCache.set(key, url);
  return url;
}

// Walk the scene looking for a live instance the user already
// dropped — its uuid is what slice-671 keys its cache by.
function _findLiveInstanceUuid(name) {
  if (typeof window === 'undefined') return null;
  const scene = window.__archdiscScene;
  if (!scene) return null;
  let found = null;
  scene.traverse((o) => {
    if (found) return;
    if (!o.isMesh) return;
    const ud = o.userData || {};
    if (ud.archdiscStudioAssetName === name) found = o;
  });
  return found ? found.uuid : null;
}

export function getThumb(name) {
  return _cache.get(name) || null;
}

export function setThumb(name, dataUrl) {
  if (!name || !dataUrl) return;
  _cache.set(name, dataUrl);
}

// Best-effort generate — prefers the slice-671 live renderer, then a
// deterministic placeholder. Always returns a non-null dataURL string
// when document is available so the browser never shows a broken-image
// icon.
export function ensureThumb(name, tag) {
  const cached = _cache.get(name);
  if (cached) return cached;
  if (typeof window !== 'undefined' && typeof window.__studioGenerateThumbnail === 'function') {
    const uuid = _findLiveInstanceUuid(name);
    if (uuid) {
      try {
        const r = window.__studioGenerateThumbnail(uuid, PLACEHOLDER_PX, PLACEHOLDER_PX);
        if (r && r.ok && r.dataUrl) {
          _cache.set(name, r.dataUrl);
          return r.dataUrl;
        }
      } catch (_) { /* fall through */ }
    }
  }
  const ph = _placeholderDataUrl(name, tag);
  if (ph) _cache.set(name, ph);
  return ph;
}

export function clearThumb(name) {
  if (!name) return;
  _cache.delete(name);
}

export function clearAllThumbs() {
  _cache.clear();
}

export function thumbCount() {
  return _cache.size;
}

export function listThumbNames() {
  return Array.from(_cache.keys());
}
