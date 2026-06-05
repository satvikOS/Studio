// ArchDisc Studio V3 — Material Browser (floating panel).
//
// Pure React + three.js. A single 64×64 offscreen WebGLRenderer renders
// each recipe to a preview sphere on first paint, then we cache the
// dataURL keyed by recipe id. Subsequent renders pull from cache, so
// scrolling 100+ tiles costs ~zero GPU time after the warm-up sweep.
//
// Category dropdown filters in-place. Clicking a tile dispatches
// applyRecipe(id) which the index.js installer wires to the registry.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RECIPES, CATEGORIES, recipesByCategory } from './library.js';
import { writeRecipeParams } from './applyToSelection.js';

const THUMB_PX = 64;

// ─── Offscreen renderer + cache ──────────────────────────────────────────
let _renderer = null;
let _scene = null;
let _camera = null;
let _mesh = null;
let _disposed = false;
const _cache = new Map(); // recipe id → dataURL

function _initRenderer() {
  if (_renderer || typeof document === 'undefined' || _disposed) return;
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_PX; canvas.height = THUMB_PX;
  try {
    _renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch (_) { _renderer = null; return; }
  _renderer.setSize(THUMB_PX, THUMB_PX, false);
  _renderer.setPixelRatio(1);
  _renderer.setClearColor(0x12161c, 1);
  _renderer.outputColorSpace = THREE.SRGBColorSpace;

  _scene = new THREE.Scene();
  // Three-point lighting tuned for tiny spheres on a dark backdrop.
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(2, 2.5, 3);
  const fill = new THREE.DirectionalLight(0xa8c0d8, 0.6); fill.position.set(-2, 0.5, 1.5);
  const rim = new THREE.DirectionalLight(0xfff2d4, 0.8); rim.position.set(0, -1.5, -2);
  const amb = new THREE.AmbientLight(0xffffff, 0.35);
  _scene.add(key); _scene.add(fill); _scene.add(rim); _scene.add(amb);

  _camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  _camera.position.set(0, 0, 4.2);
  _camera.lookAt(0, 0, 0);

  const geo = new THREE.SphereGeometry(1.0, 48, 32);
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff });
  _mesh = new THREE.Mesh(geo, mat);
  _scene.add(_mesh);
}

export function renderThumbnail(recipe) {
  if (!recipe) return null;
  if (_cache.has(recipe.id)) return _cache.get(recipe.id);
  _initRenderer();
  if (!_renderer) return null;
  writeRecipeParams(_mesh.material, recipe.params);
  try {
    _renderer.render(_scene, _camera);
    const url = _renderer.domElement.toDataURL('image/png');
    _cache.set(recipe.id, url);
    return url;
  } catch (_) {
    return null;
  }
}

export function disposeThumbnailer() {
  _disposed = true;
  _cache.clear();
  try { _mesh && _mesh.geometry && _mesh.geometry.dispose(); } catch (_) {}
  try { _mesh && _mesh.material && _mesh.material.dispose(); } catch (_) {}
  try { _renderer && _renderer.dispose(); } catch (_) {}
  _mesh = null; _scene = null; _camera = null; _renderer = null;
}

// ─── Browser panel ───────────────────────────────────────────────────────
const PANEL_STYLE = {
  position: 'fixed',
  top: '64px',
  right: '24px',
  width: '460px',
  maxHeight: 'calc(100vh - 96px)',
  zIndex: 9200,
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
};

const TITLE_STYLE = { fontWeight: 600, letterSpacing: '0.04em', color: '#ecf3fb' };
const COUNT_STYLE = { color: '#6e8aaa', fontSize: '11px', marginLeft: '8px' };

const TOOLBAR_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 12px',
  borderBottom: '1px solid #1d2937',
};

const SELECT_STYLE = {
  flex: '1 1 auto',
  background: '#0d1218',
  border: '1px solid #2a3a52',
  color: '#cdd6e2',
  borderRadius: '6px',
  padding: '5px 8px',
  font: 'inherit',
};

const SEARCH_STYLE = { ...SELECT_STYLE, flex: '2 1 auto' };

const GRID_STYLE = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
  gap: '8px',
  padding: '10px',
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
  cursor: 'pointer',
  transition: 'border-color 100ms ease, transform 100ms ease',
};

const THUMB_STYLE = {
  width: `${THUMB_PX}px`,
  height: `${THUMB_PX}px`,
  borderRadius: '50%',
  background: '#000',
  marginBottom: '6px',
  imageRendering: 'auto',
  display: 'block',
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

const CAT_TAG_STYLE = {
  fontSize: '9px',
  color: '#6e8aaa',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginTop: '2px',
};

const CLOSE_BTN_STYLE = {
  background: 'transparent',
  border: '1px solid #2a3a52',
  color: '#cdd6e2',
  borderRadius: '5px',
  padding: '3px 9px',
  cursor: 'pointer',
  font: 'inherit',
};

function Thumb({ recipe }) {
  const [url, setUrl] = useState(() => renderThumbnail(recipe));
  useEffect(() => {
    if (url) return;
    // Defer second attempt one frame in case the renderer wasn't ready
    // (e.g. WebGL context lost during a hot-reload). raf > setTimeout to
    // skip the flicker.
    let raf = requestAnimationFrame(() => setUrl(renderThumbnail(recipe)));
    return () => cancelAnimationFrame(raf);
  }, [recipe.id, url]);
  return (
    <img
      src={url || ''}
      alt={recipe.name}
      style={THUMB_STYLE}
      draggable={false}
      data-studio-v3-matlib-thumb={recipe.id}
    />
  );
}

export default function MaterialBrowser({ onApply, onCloseRequest }) {
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const visible = useMemo(() => {
    const base = recipesByCategory(category);
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((r) =>
      r.name.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q),
    );
  }, [category, search]);

  // Warm the cache for the visible window once mounted so the first
  // scroll-down doesn't stutter. Capped at 24 tiles per pass.
  const warmedRef = useRef(false);
  useEffect(() => {
    if (warmedRef.current) return;
    warmedRef.current = true;
    const slice = visible.slice(0, 24);
    let i = 0;
    const tick = () => {
      const r = slice[i++];
      if (!r) return;
      renderThumbnail(r);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [visible]);

  return (
    <div data-studio-v3-matlib-browser="" style={PANEL_STYLE}>
      <div style={HEADER_STYLE}>
        <span>
          <span style={TITLE_STYLE}>Material Browser</span>
          <span style={COUNT_STYLE}>{RECIPES.length} presets</span>
        </span>
        <button
          type="button"
          style={CLOSE_BTN_STYLE}
          onClick={() => onCloseRequest && onCloseRequest()}
          data-studio-v3-matlib-close=""
        >
          Close
        </button>
      </div>
      <div style={TOOLBAR_STYLE}>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={SELECT_STYLE}
          data-studio-v3-matlib-cat=""
        >
          <option value="All">All ({RECIPES.length})</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          style={SEARCH_STYLE}
          data-studio-v3-matlib-search=""
        />
      </div>
      <div style={GRID_STYLE} data-studio-v3-matlib-grid="">
        {visible.map((r) => (
          <div
            key={r.id}
            style={TILE_STYLE}
            data-studio-v3-matlib-tile={r.id}
            title={`${r.name} (${r.category})`}
            onClick={() => onApply && onApply(r.id)}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3a5a8a'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#1d2937'; }}
          >
            <Thumb recipe={r} />
            <span style={LABEL_STYLE}>{r.name}</span>
            <span style={CAT_TAG_STYLE}>{r.category}</span>
          </div>
        ))}
        {visible.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '24px', textAlign: 'center', color: '#6e8aaa' }}>
            No matches.
          </div>
        )}
      </div>
    </div>
  );
}
