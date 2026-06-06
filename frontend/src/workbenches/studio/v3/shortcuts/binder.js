// Slice 721 — Keyboard shortcuts manager. Bind any __studio* op to a
// hotkey ("Cmd+B", "Shift+G", etc.). Listens on the window for keydown
// events; auto-resolves Cmd ↔ Ctrl per platform. Persists user bindings
// in localStorage. Mirrors Blender / Maya / Houdini keymap editor.

const _bindings = new Map();   // chordKey → { op, args, category }
let _installed = false;
const STORAGE_KEY = 'studio_shortcuts_v1';

function _normalizeChord(combo) {
  // Sort modifiers alphabetically: Alt, Cmd, Ctrl, Shift; then key.
  const parts = combo.split('+').map((s) => s.trim());
  const mods = [];
  let key = '';
  for (const p of parts) {
    if (['Alt', 'Cmd', 'Meta', 'Ctrl', 'Shift', 'Control', 'Option', 'Command'].includes(p)) {
      const m = p === 'Meta' || p === 'Command' ? 'Cmd' : p === 'Control' ? 'Ctrl' : p === 'Option' ? 'Alt' : p;
      if (!mods.includes(m)) mods.push(m);
    } else {
      key = p.toUpperCase();
    }
  }
  mods.sort();
  return mods.concat(key ? [key] : []).join('+');
}

function _eventChord(e) {
  const mods = [];
  if (e.altKey) mods.push('Alt');
  if (e.metaKey) mods.push('Cmd');
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.shiftKey) mods.push('Shift');
  mods.sort();
  // Normalize key: use code where useful.
  let key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (key === ' ') key = 'Space';
  return mods.concat([key]).join('+');
}

function _save() {
  const out = {};
  for (const [k, v] of _bindings.entries()) {
    out[k] = { op: v.op, args: v.args || null, category: v.category || null };
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(out)); } catch (_) {}
}

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    for (const k of Object.keys(obj)) {
      _bindings.set(k, obj[k]);
    }
  } catch (_) {}
}

function _attach() {
  if (_installed) return;
  _installed = true;
  _load();
  window.addEventListener('keydown', (e) => {
    // Skip if focused in editable area.
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
    const chord = _eventChord(e);
    const binding = _bindings.get(chord);
    if (binding) {
      e.preventDefault();
      const fn = window[binding.op];
      if (typeof fn === 'function') {
        try { fn(...(binding.args || [])); } catch (_) {}
      }
    }
  });
}

export function bind(combo, op, args, category) {
  _attach();
  const k = _normalizeChord(combo);
  _bindings.set(k, { op, args: args || null, category: category || null });
  _save();
  return { ok: true, chord: k };
}

export function unbind(combo) {
  _attach();
  const k = _normalizeChord(combo);
  const ok = _bindings.delete(k);
  _save();
  return { ok };
}

export function listBindings() {
  _attach();
  return {
    ok: true,
    bindings: Array.from(_bindings.entries()).map(([chord, b]) => ({
      chord, op: b.op, args: b.args, category: b.category,
    })),
  };
}

export function clearAll() {
  _attach();
  _bindings.clear();
  _save();
  return { ok: true };
}

export function loadDefaults() {
  _attach();
  // Blender-ish defaults.
  bind('G', '__studioStudioTranslateMode', null, 'edit');
  bind('R', '__studioStudioRotateMode', null, 'edit');
  bind('S', '__studioStudioScaleMode', null, 'edit');
  bind('Tab', '__studioToggleEditMode', null, 'edit');
  bind('Cmd+Z', '__studioUndo', null, 'edit');
  bind('Cmd+Shift+Z', '__studioRedo', null, 'edit');
  bind('Cmd+S', '__studioSaveProject', null, 'edit');
  bind('Cmd+Shift+P', '__studioCmdPaletteOpen', null, 'multiview');
  bind('F1', '__studioHelpOpen', null, 'multiview');
  bind('X', '__studioDelete', null, 'edit');
  bind('B', '__studioBoxSelect', null, 'edit');
  bind('A', '__studioSelectAll', null, 'edit');
  bind('Alt+A', '__studioSelectNone', null, 'edit');
  bind('Numpad1', '__studioCameraFront', null, 'multiview');
  bind('Numpad3', '__studioCameraSide', null, 'multiview');
  bind('Numpad7', '__studioCameraTop', null, 'multiview');
  bind('Numpad0', '__studioCameraView', null, 'multiview');
  bind('Cmd+I', '__studioInvertSelection', null, 'edit');
  return { ok: true, count: _bindings.size };
}
