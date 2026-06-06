// Slice 725 — Maya marking menu (radial menu). On a long mouse-press
// at a viewport position, a radial pie of action buttons appears
// around the cursor; releasing the mouse on a wedge invokes that
// action. Distinct from slice-684 context menu (linear list).

let _menus = new Map();     // name → [items]
let _currentMenu = null;
let _overlay = null;
let _enabled = false;

export function defineMenu(name, items) {
  _menus.set(name, items);
  return { ok: true };
}

function _renderRadial(items, centerX, centerY) {
  if (_overlay) _overlay.remove();
  _overlay = document.createElement('div');
  _overlay.style.cssText = [
    'position:fixed', `left:${centerX - 120}px`, `top:${centerY - 120}px`,
    'width:240px', 'height:240px',
    'pointer-events:none',
    'z-index:9999',
  ].join(';');
  const cv = document.createElement('canvas');
  cv.width = 240; cv.height = 240;
  cv.style.position = 'absolute';
  _overlay.appendChild(cv);
  const ctx = cv.getContext('2d');
  const r = 100;
  const cx = 120, cy = 120;
  const sliceAngle = (Math.PI * 2) / items.length;
  for (let i = 0; i < items.length; i++) {
    const a0 = i * sliceAngle - Math.PI / 2;
    const a1 = (i + 1) * sliceAngle - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a1);
    ctx.closePath();
    ctx.fillStyle = `rgba(40, 45, 55, 0.92)`;
    ctx.fill();
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Label.
    const labelA = (a0 + a1) / 2;
    const labelR = r * 0.65;
    const lx = cx + Math.cos(labelA) * labelR;
    const ly = cy + Math.sin(labelA) * labelR;
    ctx.fillStyle = '#eee';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(items[i].label.slice(0, 12), lx, ly);
  }
  // Center.
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(20, 22, 28, 0.95)';
  ctx.fill();
  ctx.strokeStyle = '#888';
  ctx.stroke();
  document.body.appendChild(_overlay);
}

function _whichSlice(items, dx, dy) {
  const a = Math.atan2(dy, dx) + Math.PI / 2;
  const norm = (a + Math.PI * 2) % (Math.PI * 2);
  const sliceA = (Math.PI * 2) / items.length;
  return Math.floor(norm / sliceA);
}

function _onPointerDown(e) {
  if (!_enabled) return;
  if (!e.altKey && e.button !== 2) return;   // Alt+left or right-click trigger.
  const items = _menus.get(_currentMenu || 'default') || [];
  if (items.length === 0) return;
  const startX = e.clientX, startY = e.clientY;
  _renderRadial(items, startX, startY);
  function _onMove(ev) {
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    if (Math.hypot(dx, dy) > 30) {
      // Update slice highlight (just re-render — minor).
    }
  }
  function _onUp(ev) {
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    if (Math.hypot(dx, dy) > 30) {
      const idx = _whichSlice(items, dx, dy);
      const item = items[idx];
      if (item?.op) {
        try { window[item.op](...(item.args || [])); } catch (err) { console.warn(err); }
      }
    }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    window.removeEventListener('pointermove', _onMove);
    window.removeEventListener('pointerup', _onUp);
  }
  window.addEventListener('pointermove', _onMove);
  window.addEventListener('pointerup', _onUp);
  e.preventDefault();
}

function _onContextMenu(e) {
  if (_enabled && _menus.has(_currentMenu || 'default')) e.preventDefault();
}

export function enable(name) {
  _enabled = true;
  _currentMenu = name || 'default';
  window.addEventListener('pointerdown', _onPointerDown);
  window.addEventListener('contextmenu', _onContextMenu);
  return { ok: true };
}

export function disable() {
  _enabled = false;
  window.removeEventListener('pointerdown', _onPointerDown);
  window.removeEventListener('contextmenu', _onContextMenu);
  if (_overlay) { _overlay.remove(); _overlay = null; }
  return { ok: true };
}

export function listMenus() {
  return { ok: true, menus: Array.from(_menus.keys()) };
}

export function loadDefaults() {
  defineMenu('default', [
    { label: 'Translate', op: '__studioStudioTranslateMode' },
    { label: 'Rotate',    op: '__studioStudioRotateMode' },
    { label: 'Scale',     op: '__studioStudioScaleMode' },
    { label: 'Delete',    op: '__studioDelete' },
    { label: 'Duplicate', op: '__studioDuplicate' },
    { label: 'Hide',      op: '__studioHide' },
    { label: 'Group',     op: '__studioGroup' },
    { label: 'Center',    op: '__studioCenter' },
  ]);
  return { ok: true };
}
