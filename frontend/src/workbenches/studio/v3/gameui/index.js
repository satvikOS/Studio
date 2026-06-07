// ArchDisc Studio V3 — game UI / HUD overlay (slice 845).
// DOM-overlay HUD: health bars, score, minimap, dialog boxes.
// Mounted onto the document body above the canvas.

import { registerOps } from '../common/registry.js';
let _installed = false;
let _root = null;
const _widgets = new Map();
function _ensureRoot() {
  if (_root || typeof document === 'undefined') return _root;
  _root = document.createElement('div');
  _root.id = 'archdisc-game-hud';
  Object.assign(_root.style, {
    position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '9999',
    fontFamily: 'monospace', color: 'white', textShadow: '0 1px 2px #000',
  });
  document.body.appendChild(_root);
  return _root;
}
function _addText({ id, text, pos = ['10px', '10px'], size = 16, color = 'white' }) {
  _ensureRoot(); const el = document.createElement('div');
  el.id = `hud_${id}`;
  Object.assign(el.style, { position: 'absolute', left: pos[0], top: pos[1], fontSize: size + 'px', color });
  el.textContent = text;
  _root.appendChild(el); _widgets.set(id, el);
  return { ok: true, id };
}
function _addBar({ id, pos = ['10px', '40px'], width = 200, value = 1, color = '#3c3' }) {
  _ensureRoot(); const wrap = document.createElement('div');
  wrap.id = `hud_${id}`;
  Object.assign(wrap.style, { position: 'absolute', left: pos[0], top: pos[1], width: width + 'px', height: '12px', background: 'rgba(0,0,0,0.5)', border: '1px solid #fff' });
  const fill = document.createElement('div');
  Object.assign(fill.style, { height: '100%', width: (value * 100) + '%', background: color, transition: 'width 0.1s' });
  wrap.appendChild(fill);
  _root.appendChild(wrap); _widgets.set(id, { wrap, fill });
  return { ok: true, id };
}
function _setBar({ id, value }) {
  const w = _widgets.get(id); if (!w?.fill) return { ok: false };
  w.fill.style.width = Math.max(0, Math.min(1, value)) * 100 + '%';
  return { ok: true };
}
function _setText({ id, text }) {
  const w = _widgets.get(id); if (!w || !w.tagName) return { ok: false };
  w.textContent = text; return { ok: true };
}
function _remove({ id }) {
  const w = _widgets.get(id); if (!w) return { ok: false };
  const node = w.tagName ? w : w.wrap; node.remove();
  _widgets.delete(id); return { ok: true };
}
function _clear() { _widgets.forEach((w) => (w.tagName ? w : w.wrap).remove()); _widgets.clear(); return { ok: true }; }
export function installGameUI() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioHUDText: _addText,
    __studioHUDBar: _addBar,
    __studioHUDSetBar: _setBar,
    __studioHUDSetText: _setText,
    __studioHUDRemove: _remove,
    __studioHUDClear: _clear,
    __studioHUDList: () => ({ ok: true, ids: [..._widgets.keys()] }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'game', 'Game UI / HUD overlay');
  return { ok: true };
}
export default installGameUI;
