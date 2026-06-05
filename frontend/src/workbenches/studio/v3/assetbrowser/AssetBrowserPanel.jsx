// ArchDisc Studio V3 — Asset Browser (Blender-3.0-style visual grid).
//
// Floating panel mounted to a body-attached host (so we never touch
// StudioShellV3.jsx). Wraps slice-666's asset CRUD localStorage layer +
// slice-671's __studioGenerateThumbnail. Pure React + canvas, no extra
// deps, no WASM.
//
// Layout:
//   ┌───────────────────────────────────────────────┐
//   │ Asset Browser  N assets        [Save] [Close]│
//   ├───────────────────────────────────────────────┤
//   │ Search ███████████  [All] [tagA] [tagB] …    │
//   ├───────────────────────────────────────────────┤
//   │ ▣ ▣ ▣ ▣  (96×96 tiles, draggable)             │
//   │ ▣ ▣ ▣ ▣                                       │
//   └───────────────────────────────────────────────┘
//
// Interactions per spec:
//   • drag tile → drop in viewport → instantiate at the cursor's
//     world position (raycast against scene meshes or ground plane).
//   • double-click tile → instantiate at scene origin.
//   • right-click tile → context menu: Apply / Retag / Delete.
//   • "Save Current Selection as Asset" button → wraps __studioAssetSave
//     then warms the thumbnail cache for the new entry.

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { ensureThumb, clearThumb, setThumb } from './thumbCache.js';

const TILE_PX = 96;

// ─── Style tokens (match matlib / contextmenu look-and-feel) ─────────────
const PANEL_STYLE = {
  position: 'fixed',
  top: '64px',
  right: '24px',
  width: '480px',
  maxHeight: 'calc(100vh - 96px)',
  zIndex: 9250,
  background: 'rgba(13,17,23,0.96)',
  border: '1px solid #2a3a52',
  borderRadius: '10px',
  boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
  color: '#cdd6e2',
  font: '12px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  backdropFilter: 'blur(8px)',
};

const HEADER_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 12px',
  borderBottom: '1px solid #1d2937',
  background: 'linear-gradient(180deg, #182030 0%, #131923 100%)',
  gap: '8px',
};

const TITLE_STYLE = { fontWeight: 600, letterSpacing: '0.04em', color: '#ecf3fb' };
const COUNT_STYLE = { color: '#6e8aaa', fontSize: '11px', marginLeft: '8px' };

const BUTTON_STYLE = {
  background: 'transparent',
  border: '1px solid #2a3a52',
  color: '#cdd6e2',
  borderRadius: '5px',
  padding: '4px 10px',
  cursor: 'pointer',
  font: 'inherit',
};

const PRIMARY_BUTTON_STYLE = {
  ...BUTTON_STYLE,
  background: 'linear-gradient(180deg, #1f3a5a 0%, #16273e 100%)',
  borderColor: '#3a5a8a',
  color: '#ecf3fb',
};

const TOOLBAR_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 12px',
  borderBottom: '1px solid #1d2937',
};

const SEARCH_STYLE = {
  flex: '1 1 auto',
  background: '#0d1218',
  border: '1px solid #2a3a52',
  color: '#cdd6e2',
  borderRadius: '6px',
  padding: '5px 8px',
  font: 'inherit',
};

const CHIPS_ROW_STYLE = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px',
  padding: '6px 12px 10px',
  borderBottom: '1px solid #1d2937',
};

const CHIP_STYLE = {
  background: '#0d1218',
  border: '1px solid #2a3a52',
  color: '#cdd6e2',
  borderRadius: '999px',
  padding: '3px 10px',
  cursor: 'pointer',
  font: '11px ui-sans-serif, system-ui',
  userSelect: 'none',
};

const CHIP_ACTIVE_STYLE = {
  ...CHIP_STYLE,
  background: 'linear-gradient(180deg, #1f3a5a 0%, #16273e 100%)',
  borderColor: '#3a5a8a',
  color: '#ecf3fb',
};

const GRID_STYLE = {
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_PX + 16}px, 1fr))`,
  gap: '10px',
  padding: '12px',
  overflow: 'auto',
  flex: '1 1 auto',
};

const TILE_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '6px 4px 8px',
  borderRadius: '8px',
  border: '1px solid #1d2937',
  background: '#0f141b',
  cursor: 'grab',
  transition: 'border-color 100ms ease, transform 100ms ease',
};

const THUMB_STYLE = {
  width: `${TILE_PX}px`,
  height: `${TILE_PX}px`,
  borderRadius: '6px',
  background: '#000',
  marginBottom: '6px',
  imageRendering: 'auto',
  display: 'block',
  objectFit: 'cover',
  pointerEvents: 'none',
};

const LABEL_STYLE = {
  fontSize: '11px',
  textAlign: 'center',
  color: '#cdd6e2',
  lineHeight: 1.2,
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  width: '100%',
};

const TAG_LABEL_STYLE = {
  fontSize: '9px',
  color: '#6e8aaa',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginTop: '2px',
};

const CTX_MENU_STYLE = {
  position: 'fixed',
  background: '#0f141b',
  border: '1px solid #2a3a52',
  borderRadius: '6px',
  boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
  font: '500 12px/1.4 ui-sans-serif,system-ui',
  color: '#cdd6e2',
  padding: '4px 0',
  minWidth: '160px',
  zIndex: 9260,
  userSelect: 'none',
};

const CTX_ROW_STYLE = {
  padding: '6px 14px',
  cursor: 'pointer',
};

// ─── Helpers ─────────────────────────────────────────────────────────────
function _readAssets() {
  if (typeof window === 'undefined') return [];
  try {
    const r = window.__studioAssetList && window.__studioAssetList();
    if (r && r.ok) return r.items || [];
  } catch (_) {}
  return [];
}

function _readTags() {
  if (typeof window === 'undefined') return [];
  try {
    const r = window.__studioAssetListTags && window.__studioAssetListTags();
    if (r && r.ok) return r.tags || [];
  } catch (_) {}
  return [];
}

// Raycast helper used by drop-to-instantiate. Mirrors the math in
// api.js's __studioMathClosestRayHit but adds a ground-plane fallback
// so dropping on empty space still spawns at a sane world position.
function _worldFromScreen(pixelX, pixelY) {
  if (typeof window === 'undefined') return [0, 0, 0];
  const vp = window.__archdiscViewport;
  if (!vp || !vp.camera || !vp.renderer) return [0, 0, 0];
  const dom = vp.renderer.domElement;
  const rect = dom.getBoundingClientRect();
  const w = rect.width || dom.clientWidth || 1;
  const h = rect.height || dom.clientHeight || 1;
  const x = ((pixelX - rect.left) / w) * 2 - 1;
  const y = -(((pixelY - rect.top) / h) * 2 - 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(x, y), vp.camera);
  const scene = window.__archdiscScene;
  if (scene) {
    const meshes = [];
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const ud = o.userData || {};
      if (ud.archdiscStudioGizmo || ud.archdiscStudioGrid || ud.archdiscStudioCameraHelper) return;
      meshes.push(o);
    });
    const hits = ray.intersectObjects(meshes, false);
    if (hits.length) {
      const p = hits[0].point;
      return [p.x, p.y, p.z];
    }
  }
  // Fallback — intersect the y=0 ground plane.
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  if (ray.ray.intersectPlane(plane, hit)) return [hit.x, hit.y, hit.z];
  return [0, 0, 0];
}

// ─── Thumbnail tile component ────────────────────────────────────────────
function Tile({ asset, onInstantiate, onContextMenu, refreshKey }) {
  const [url, setUrl] = useState(() => ensureThumb(asset.name, asset.tag));
  useEffect(() => {
    setUrl(ensureThumb(asset.name, asset.tag));
  }, [asset.name, asset.tag, refreshKey]);

  const handleDragStart = (e) => {
    e.dataTransfer.effectAllowed = 'copy';
    try {
      e.dataTransfer.setData('application/x-studio-asset', asset.name);
      e.dataTransfer.setData('text/plain', asset.name);
    } catch (_) {}
    e.currentTarget.style.opacity = '0.5';
    if (typeof window !== 'undefined') {
      window.__studioAssetBrowserDragging = asset.name;
    }
  };
  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = '1';
    if (typeof window !== 'undefined') {
      window.__studioAssetBrowserDragging = null;
    }
  };
  const handleDoubleClick = () => {
    onInstantiate(asset, null);
  };
  const handleContextMenu = (e) => {
    e.preventDefault();
    onContextMenu(asset, e.clientX, e.clientY);
  };

  return (
    <div
      style={TILE_STYLE}
      data-studio-v3-assetbrowser-tile={asset.name}
      data-studio-v3-assetbrowser-tag={asset.tag || ''}
      title={`${asset.name}${asset.tag ? ' — ' + asset.tag : ''}\nDrag to viewport, double-click for origin, right-click for actions.`}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3a5a8a'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#1d2937'; }}
    >
      <img
        src={url || ''}
        alt={asset.name}
        style={THUMB_STYLE}
        draggable={false}
        data-studio-v3-assetbrowser-thumb={asset.name}
      />
      <span style={LABEL_STYLE}>{asset.name}</span>
      {asset.tag && <span style={TAG_LABEL_STYLE}>{asset.tag}</span>}
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────
export default function AssetBrowserPanel({
  search, filter,
  onSearchChange, onFilterChange,
  onInstantiate, onSaveSelection, onDelete, onRetag, onRefreshThumbs,
  onCloseRequest, refreshKey,
}) {
  const assets = useMemo(() => _readAssets(), [refreshKey]);
  const tags = useMemo(() => _readTags(), [refreshKey]);

  const visible = useMemo(() => {
    let list = assets;
    if (filter) list = list.filter((a) => a.tag === filter);
    const q = String(search || '').trim().toLowerCase();
    if (q) {
      list = list.filter((a) =>
        a.name.toLowerCase().includes(q) ||
        (a.tag && a.tag.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [assets, filter, search]);

  // Drop-zone listeners — attached at window scope so the user can drop
  // anywhere outside the panel, not just on the canvas. Filtered by
  // payload type so we never hijack other drag sources.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onDragOver = (e) => {
      const types = e.dataTransfer && e.dataTransfer.types;
      if (!types) return;
      const matches = Array.from(types).includes('application/x-studio-asset')
        || (window.__studioAssetBrowserDragging != null);
      if (!matches) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (e) => {
      const name = (e.dataTransfer && e.dataTransfer.getData('application/x-studio-asset'))
        || window.__studioAssetBrowserDragging;
      if (!name) return;
      e.preventDefault();
      const world = _worldFromScreen(e.clientX, e.clientY);
      onInstantiate({ name }, world);
      window.__studioAssetBrowserDragging = null;
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [onInstantiate]);

  // ─── Right-click context menu ──────────────────────────────────────
  const [ctx, setCtx] = useState(null); // {asset, x, y} | null
  const openCtx = useCallback((asset, x, y) => setCtx({ asset, x, y }), []);
  const closeCtx = useCallback(() => setCtx(null), []);
  useEffect(() => {
    if (!ctx) return undefined;
    const close = (e) => {
      if (!e || !e.target || !e.target.closest('[data-studio-v3-assetbrowser-ctx]')) closeCtx();
    };
    window.addEventListener('mousedown', close, true);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCtx(); }, true);
    return () => {
      window.removeEventListener('mousedown', close, true);
    };
  }, [ctx, closeCtx]);

  // ─── Save Selection prompt — tiny inline form, no native prompt() ──
  const [savingOpen, setSavingOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveTag, setSaveTag] = useState('');
  const openSave = () => {
    setSavingOpen(true);
    setSaveName(`asset_${Date.now()}`);
    setSaveTag('');
  };
  const closeSave = () => setSavingOpen(false);
  const commitSave = () => {
    const r = onSaveSelection(saveName.trim(), saveTag.trim());
    if (r && r.ok) {
      closeSave();
    } else if (typeof window !== 'undefined' && window.__studioToast) {
      window.__studioToast((r && r.error) || 'Save failed — select a mesh first', 'err');
    }
  };

  return (
    <div data-studio-v3-assetbrowser-panel="" style={PANEL_STYLE}>
      <div style={HEADER_STYLE}>
        <span>
          <span style={TITLE_STYLE}>Asset Browser</span>
          <span style={COUNT_STYLE} data-studio-v3-assetbrowser-count="">
            {visible.length} of {assets.length}
          </span>
        </span>
        <span style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            style={PRIMARY_BUTTON_STYLE}
            data-studio-v3-assetbrowser-save=""
            onClick={openSave}
          >
            Save Selection
          </button>
          <button
            type="button"
            style={BUTTON_STYLE}
            data-studio-v3-assetbrowser-refresh=""
            onClick={() => onRefreshThumbs()}
          >
            Refresh
          </button>
          <button
            type="button"
            style={BUTTON_STYLE}
            data-studio-v3-assetbrowser-close=""
            onClick={() => onCloseRequest && onCloseRequest()}
          >
            Close
          </button>
        </span>
      </div>

      <div style={TOOLBAR_STYLE}>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search assets…"
          style={SEARCH_STYLE}
          data-studio-v3-assetbrowser-search=""
        />
      </div>

      <div style={CHIPS_ROW_STYLE} data-studio-v3-assetbrowser-chips="">
        <span
          style={filter ? CHIP_STYLE : CHIP_ACTIVE_STYLE}
          data-studio-v3-assetbrowser-chip="__all__"
          onClick={() => onFilterChange('')}
        >
          All
        </span>
        {tags.map((t) => (
          <span
            key={t}
            style={filter === t ? CHIP_ACTIVE_STYLE : CHIP_STYLE}
            data-studio-v3-assetbrowser-chip={t}
            onClick={() => onFilterChange(t)}
          >
            {t}
          </span>
        ))}
      </div>

      {savingOpen && (
        <div
          style={{
            padding: '10px 12px',
            borderBottom: '1px solid #1d2937',
            background: '#0d1218',
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
          }}
          data-studio-v3-assetbrowser-save-form=""
        >
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="name"
            style={{ ...SEARCH_STYLE, flex: '2 1 auto' }}
            data-studio-v3-assetbrowser-save-name=""
          />
          <input
            type="text"
            value={saveTag}
            onChange={(e) => setSaveTag(e.target.value)}
            placeholder="tag (optional)"
            style={{ ...SEARCH_STYLE, flex: '1 1 auto' }}
            data-studio-v3-assetbrowser-save-tag=""
          />
          <button
            type="button"
            style={PRIMARY_BUTTON_STYLE}
            data-studio-v3-assetbrowser-save-commit=""
            onClick={commitSave}
          >
            Save
          </button>
          <button
            type="button"
            style={BUTTON_STYLE}
            data-studio-v3-assetbrowser-save-cancel=""
            onClick={closeSave}
          >
            Cancel
          </button>
        </div>
      )}

      <div style={GRID_STYLE} data-studio-v3-assetbrowser-grid="">
        {visible.map((a) => (
          <Tile
            key={a.name}
            asset={a}
            onInstantiate={onInstantiate}
            onContextMenu={openCtx}
            refreshKey={refreshKey}
          />
        ))}
        {visible.length === 0 && (
          <div
            style={{ gridColumn: '1 / -1', padding: '24px', textAlign: 'center', color: '#6e8aaa' }}
            data-studio-v3-assetbrowser-empty=""
          >
            {assets.length === 0
              ? 'No assets saved yet — select a mesh and hit Save Selection.'
              : 'No matches for the current filter / search.'}
          </div>
        )}
      </div>

      {ctx && (
        <div
          style={{
            ...CTX_MENU_STYLE,
            left: Math.min(ctx.x, (window.innerWidth || 1280) - 180) + 'px',
            top: Math.min(ctx.y, (window.innerHeight || 800) - 140) + 'px',
          }}
          data-studio-v3-assetbrowser-ctx=""
        >
          <div
            style={CTX_ROW_STYLE}
            data-studio-v3-assetbrowser-ctx-apply=""
            onMouseEnter={(e) => { e.currentTarget.style.background = '#152234'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            onClick={() => { onInstantiate(ctx.asset, null); closeCtx(); }}
          >
            Apply (instantiate at origin)
          </div>
          <div
            style={CTX_ROW_STYLE}
            data-studio-v3-assetbrowser-ctx-retag=""
            onMouseEnter={(e) => { e.currentTarget.style.background = '#152234'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            onClick={() => {
              const next = window.prompt('New tag (blank to clear):', ctx.asset.tag || '');
              if (next !== null) onRetag(ctx.asset.name, next);
              closeCtx();
            }}
          >
            Retag…
          </div>
          <div
            style={{ ...CTX_ROW_STYLE, color: '#ff9a8a' }}
            data-studio-v3-assetbrowser-ctx-delete=""
            onMouseEnter={(e) => { e.currentTarget.style.background = '#3a1818'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            onClick={() => { onDelete(ctx.asset.name); closeCtx(); }}
          >
            Delete
          </div>
        </div>
      )}
    </div>
  );
}

// Re-exports so the installer's listVisible op can apply the exact same
// filter/search logic without duplicating the predicate.
export function filterAssets(assets, filter, search) {
  let list = assets;
  if (filter) list = list.filter((a) => a.tag === filter);
  const q = String(search || '').trim().toLowerCase();
  if (q) {
    list = list.filter((a) =>
      a.name.toLowerCase().includes(q) ||
      (a.tag && a.tag.toLowerCase().includes(q)),
    );
  }
  return list;
}

export { ensureThumb, clearThumb, setThumb };
