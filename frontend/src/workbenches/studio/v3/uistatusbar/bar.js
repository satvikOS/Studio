// Slice 721 — Bottom status bar. Live-updates FPS, vertex+triangle
// counts, camera info, save state, selected mesh name. Pure DOM
// overlay — no React state, no setState. Mirrors Blender bottom
// header.

let _container = null;
let _items = {};
let _enabled = false;
let _interval = 0;

function _mount() {
  if (_container) return _container;
  const host = window.__archdiscViewport?.container?.parentElement || document.body;
  _container = document.createElement('div');
  _container.dataset.studioStatusBar = '1';
  _container.style.cssText = [
    'position:absolute',
    'bottom:0', 'left:0', 'right:0',
    'height:24px',
    'background:rgba(28,28,28,0.85)',
    'color:#cccccc',
    'font:11px Monaco, Consolas, monospace',
    'display:flex',
    'align-items:center',
    'padding:0 12px',
    'gap:14px',
    'pointer-events:none',
    'z-index:9999',
    'border-top:1px solid #444',
  ].join(';');
  host.appendChild(_container);
  // Build initial items.
  const slots = ['fps', 'verts', 'tris', 'camera', 'selection', 'time', 'save'];
  for (const s of slots) {
    const el = document.createElement('span');
    el.dataset.statusSlot = s;
    el.style.cssText = 'display:inline-block;min-width:80px';
    _container.appendChild(el);
    _items[s] = el;
  }
  return _container;
}

function _countSceneStats() {
  const scene = window.__archdiscScene;
  if (!scene) return { verts: 0, tris: 0, meshCount: 0 };
  let verts = 0, tris = 0, meshCount = 0;
  scene.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry) return;
    meshCount++;
    const pos = o.geometry.attributes.position;
    if (pos) verts += pos.count;
    const idx = o.geometry.index;
    if (idx) tris += idx.count / 3;
    else if (pos) tris += pos.count / 3;
  });
  return { verts, tris, meshCount };
}

function _fps() {
  const now = performance.now();
  if (!_fps._times) _fps._times = [];
  _fps._times.push(now);
  while (_fps._times[0] < now - 1000) _fps._times.shift();
  return _fps._times.length;
}

function _update() {
  if (!_enabled) return;
  if (!_container) _mount();
  const { verts, tris } = _countSceneStats();
  const cam = window.__archdiscViewport?.camera;
  const camStr = cam ? `cam(${cam.position.x.toFixed(1)}, ${cam.position.y.toFixed(1)}, ${cam.position.z.toFixed(1)})` : '—';
  const selUuid = window.__studioSelectedUuid;
  let selStr = '—';
  if (selUuid) {
    const o = window.__archdiscScene?.getObjectByProperty('uuid', selUuid);
    selStr = o?.name || '(unnamed)';
  }
  _items.fps.textContent = `FPS ${_fps()}`;
  _items.verts.textContent = `V ${verts}`;
  _items.tris.textContent = `T ${tris | 0}`;
  _items.camera.textContent = camStr;
  _items.selection.textContent = `Sel ${selStr.slice(0, 20)}`;
  _items.time.textContent = new Date().toLocaleTimeString();
  _items.save.textContent = window.__studioProjectDirty ? '● Modified' : '○ Saved';
}

export function enable() {
  if (_enabled) return { ok: true };
  _enabled = true;
  _mount();
  _interval = setInterval(_update, 250);
  return { ok: true };
}

export function disable() {
  _enabled = false;
  if (_interval) { clearInterval(_interval); _interval = 0; }
  if (_container && _container.parentElement) {
    _container.parentElement.removeChild(_container);
    _container = null; _items = {};
  }
  return { ok: true };
}

export function isEnabled() { return { ok: true, enabled: _enabled }; }
