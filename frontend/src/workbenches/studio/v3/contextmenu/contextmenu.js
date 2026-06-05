// Slice 687 — Right-click context menu on the viewport. Lists
// selection-relevant ops (delete, duplicate, hide/show, isolate,
// frame, then category submenus from the command registry).
// Backs task #33 (UI/UX: surface every op in menus / sidebars /
// right-click — not flat list).

const STYLE = {
  menu: 'position:fixed;background:#0f141b;border:1px solid #2a3a52;border-radius:6px;box-shadow:0 16px 48px rgba(0,0,0,0.55);font:500 12px/1.4 ui-sans-serif,system-ui;color:#cdd6e2;padding:6px 0;min-width:220px;z-index:9300;user-select:none',
  row: 'padding:6px 14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center',
  rowHover: 'background:#152234;color:#ecf3fb',
  sep: 'height:1px;background:#1d2937;margin:4px 0',
  cat: 'font:600 9px/1 ui-monospace,Menlo,monospace;color:#6e8aaa;background:#1d2937;padding:1px 4px;border-radius:3px;text-transform:uppercase;letter-spacing:0.05em',
  group: 'padding:4px 14px 2px 14px;font:600 10px/1.4 ui-monospace,Menlo,monospace;color:#6e8aaa;text-transform:uppercase;letter-spacing:0.05em',
};

let _host = null;

const PRIMARY_OPS = [
  { label: 'Frame Selection',        op: '__studioFrameSelection' },
  { label: 'Duplicate',              op: '__studioClipboardDuplicateSelected' },
  { label: 'Delete',                 op: '__studioDeleteSelected' },
  { label: 'Hide',                   op: '__studioSelectionSetVisible', args: [false] },
  { label: 'Isolate',                op: '__studioToggleIsolateSelection' },
  { label: 'Center Origin',          op: '__studioCenterOrigin' },
];

const CATEGORY_GROUPS = ['edit', 'sculpt', 'texpaint', 'shader', 'rig', 'anim', 'mograph', 'fx', 'sim', 'rt', 'bp', 'vex'];

function _ensureHost() {
  if (_host) return _host;
  _host = document.createElement('div');
  _host.setAttribute('data-studio-v3-contextmenu-host', '');
  document.body.appendChild(_host);
  document.addEventListener('mousedown', (e) => {
    if (_host.firstChild && !_host.contains(e.target)) close();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }, true);
  return _host;
}

function _invokeAt(op, args) {
  if (!op) return;
  const r = window.__studioCommandInvoke?.(op, ...(args || []))
    ?? (typeof window[op] === 'function' ? { ok: true, result: window[op](...(args || [])) } : null);
  if (!r) {
    if (window.__studioToast) window.__studioToast(`${op}: not registered`, 'err');
    return;
  }
  if (window.__studioToast && r?.ok === false && r?.error) {
    window.__studioToast(`${op}: ${r.error}`, 'err');
  }
}

function _buildMenuHtml(x, y) {
  let h = `<div data-studio-v3-contextmenu style="${STYLE.menu};left:${x}px;top:${y}px">`;
  // Primary section
  for (const item of PRIMARY_OPS) {
    h += `<div data-op="${item.op}" data-args='${JSON.stringify(item.args || [])}' style="${STYLE.row}">` +
      `<span>${item.label}</span>` +
    '</div>';
  }
  h += `<div style="${STYLE.sep}"></div>`;
  // Category groups — top 4 from each
  if (window.__studioCommandRegistry) {
    for (const cat of CATEGORY_GROUPS) {
      const ops = Array.from(window.__studioCommandRegistry.values()).filter((c) => c.category === cat);
      if (!ops.length) continue;
      h += `<div style="${STYLE.group}">${cat}</div>`;
      for (const op of ops.slice(0, 4)) {
        const label = op.name.replace(/^__studio[A-Za-z]+?(?=[A-Z])/, '').replace(/^_/, '') || op.name.replace(/^__studio/, '');
        h += `<div data-op="${op.name}" data-args="[]" style="${STYLE.row}">` +
          `<span>${label}</span>` +
          `<span style="${STYLE.cat}">${cat}</span>` +
        '</div>';
      }
    }
  }
  h += '</div>';
  return h;
}

export function show(x, y) {
  _ensureHost();
  // Clamp to viewport
  const px = Math.min(x, (window.innerWidth || 1280) - 240);
  const py = Math.min(y, (window.innerHeight || 800) - 360);
  _host.innerHTML = _buildMenuHtml(px, py);
  _host.querySelectorAll('[data-op]').forEach((el) => {
    el.addEventListener('mouseenter', () => { el.style.cssText = STYLE.row + ';' + STYLE.rowHover; });
    el.addEventListener('mouseleave', () => { el.style.cssText = STYLE.row; });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const op = el.getAttribute('data-op');
      let args = [];
      try { args = JSON.parse(el.getAttribute('data-args') || '[]'); } catch (_) {}
      close();
      _invokeAt(op, args);
    });
  });
  return { ok: true };
}

export function close() {
  if (_host) _host.innerHTML = '';
  return { ok: true };
}

export function install() {
  if (window.__studioContextMenuInstalled) return;
  window.__studioContextMenuInstalled = true;
  document.addEventListener('contextmenu', (e) => {
    const vp = document.querySelector('.studio-viewport, [data-studio-v3-viewport]');
    if (!vp) return;
    if (!vp.contains(e.target)) return;
    e.preventDefault();
    show(e.clientX, e.clientY);
  }, true);

  window.__studioContextMenuShow = show;
  window.__studioContextMenuClose = close;

  if (window.__studioCommandRegister) {
    window.__studioCommandRegister('__studioContextMenuShow', show, {
      category: 'system', description: 'Show context menu',
    });
  }
}
