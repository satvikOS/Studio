// Slice 685 — Top menu bar. A floating, always-visible strip near
// the top edge of the viewport that groups every registered
// __studio* op (via slice-668 __studioCommandRegister) by category
// → hover for submenu → click to invoke. Backs task #33 (UI/UX:
// surface every op in menus / ribbons / sidebars — not flat list).

const HOST_ATTR = 'data-studio-v3-menubar';

const CAT_LABELS = {
  system: 'File',
  edit: 'Edit',
  geomnodes: 'Geometry',
  shader: 'Shader',
  texpaint: 'Material',
  sculpt: 'Sculpt',
  rig: 'Rig',
  anim: 'Animation',
  animadv: 'Animation',
  gp: 'GreasePencil',
  bp: 'Blueprints',
  vex: 'Script',
  mograph: 'MoGraph',
  fx: 'FX',
  sim: 'Sim',
  rt: 'Render',
  compositor: 'Render',
  auto: 'All',
  user: 'User',
};

// Order of menus left-to-right.
const MENU_ORDER = [
  'File', 'Edit', 'Geometry', 'Shader', 'Material', 'Sculpt',
  'Rig', 'Animation', 'GreasePencil', 'MoGraph', 'FX', 'Sim',
  'Render', 'Script', 'Blueprints', 'All',
];

const STYLE = {
  bar: 'position:fixed;top:0;left:0;right:0;z-index:9100;display:flex;align-items:stretch;height:30px;padding:0 6px;background:rgba(13,17,23,0.94);border-bottom:1px solid #1d2937;backdrop-filter:blur(6px);font:500 12px/1 ui-sans-serif,system-ui;color:#cdd6e2;user-select:none',
  menu: 'position:relative;padding:0 12px;display:flex;align-items:center;cursor:pointer;letter-spacing:0.02em',
  menuOpen: 'background:#152234;color:#ecf3fb',
  pop: 'position:absolute;top:100%;left:0;background:#0f141b;border:1px solid #2a3a52;border-radius:6px;box-shadow:0 16px 48px rgba(0,0,0,0.55);min-width:260px;max-height:60vh;overflow:auto;padding:6px 0',
  row: 'padding:7px 14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-weight:500;color:#cdd6e2',
  rowHover: 'background:#152234;color:#ecf3fb',
  emptyRow: 'padding:10px 14px;color:#6e8aaa;font-style:italic',
  cat: 'font:600 9px/1 ui-monospace,Menlo,monospace;color:#6e8aaa;background:#1d2937;padding:2px 5px;border-radius:3px;text-transform:uppercase;letter-spacing:0.05em',
};

let _host = null;
let _open = null; // menu name currently open

function _allOps() {
  if (!window.__studioCommandRegistry) return [];
  return Array.from(window.__studioCommandRegistry.values());
}

function _opsByMenu() {
  const map = new Map();
  for (const m of MENU_ORDER) map.set(m, []);
  for (const op of _allOps()) {
    const menu = CAT_LABELS[op.category] || 'All';
    if (!map.has(menu)) map.set(menu, []);
    // de-dupe by op name across categories that map to the same menu
    if (!map.get(menu).find((o) => o.name === op.name)) map.get(menu).push(op);
  }
  return map;
}

function _ensureHost() {
  if (_host) return _host;
  _host = document.createElement('div');
  _host.setAttribute(HOST_ATTR, '');
  document.body.appendChild(_host);
  document.addEventListener('click', (e) => {
    if (!_host.contains(e.target)) _close();
  }, true);
  return _host;
}

function _render() {
  if (!_host) return;
  const byMenu = _opsByMenu();
  const menus = MENU_ORDER.filter((m) => (byMenu.get(m) || []).length > 0);
  const open = _open && byMenu.has(_open) && byMenu.get(_open).length > 0 ? _open : null;

  let bar = `<div style="${STYLE.bar}">`;
  for (const m of menus) {
    const isOpen = m === open;
    bar += `<div data-menu="${m}" style="${STYLE.menu}${isOpen ? ';' + STYLE.menuOpen : ''}">${m}`;
    if (isOpen) {
      const ops = byMenu.get(m);
      bar += `<div data-pop style="${STYLE.pop}">`;
      if (!ops.length) bar += `<div style="${STYLE.emptyRow}">(empty)</div>`;
      for (const op of ops.slice(0, 60)) {
        const label = op.name.replace(/^__studio/, '').replace(/^Edit|^Shader|^Rig|^Geom|^Comp|^MoGraph|^Sculpt|^TexPaint|^RT|^Anim|^AnimAdv|^Sim|^GP|^FX|^Vex|^BP|^Palette/, '');
        bar += `<div data-op="${op.name}" style="${STYLE.row}">` +
          `<span>${label || op.name.replace(/^__studio/, '')}</span>` +
          `<span style="${STYLE.cat}">${op.category || ''}</span>` +
        '</div>';
      }
      bar += '</div>';
    }
    bar += '</div>';
  }
  bar += '</div>';
  _host.innerHTML = bar;

  _host.querySelectorAll('[data-menu]').forEach((el) => {
    el.addEventListener('mouseenter', () => {
      if (_open) { _open = el.getAttribute('data-menu'); _render(); }
    });
    el.addEventListener('click', (e) => {
      const name = el.getAttribute('data-menu');
      _open = _open === name ? null : name;
      _render();
      e.stopPropagation();
    });
  });
  _host.querySelectorAll('[data-op]').forEach((el) => {
    el.addEventListener('mouseenter', () => { el.style.cssText = STYLE.row + ';' + STYLE.rowHover; });
    el.addEventListener('mouseleave', () => { el.style.cssText = STYLE.row; });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const opName = el.getAttribute('data-op');
      _close();
      try {
        const r = window.__studioCommandInvoke?.(opName);
        if (window.__studioToast && r?.ok === false && r?.error) window.__studioToast(`${opName}: ${r.error}`, 'err');
      } catch (e) {
        if (window.__studioToast) window.__studioToast(`${opName}: ${e.message}`, 'err');
      }
    });
  });
}

function _close() { if (_open) { _open = null; _render(); } }

export function show() { _ensureHost(); _render(); return { ok: true }; }
export function hide() { if (_host) _host.innerHTML = ''; _open = null; return { ok: true }; }
export function refresh() { if (_host) _render(); return { ok: true }; }

export function install() {
  if (window.__studioMenuBarInstalled) return;
  window.__studioMenuBarInstalled = true;
  // Wait a beat for autoloads to register, then mount + start auto-refreshing.
  setTimeout(() => {
    show();
    // Periodically re-render so newly registered ops appear (e.g.,
    // late dynamic-imports). Cheap — only touches DOM when count changed.
    let prevCount = 0;
    setInterval(() => {
      const n = window.__studioCommandRegistry?.size || 0;
      if (n !== prevCount) { prevCount = n; _render(); }
    }, 1500);
  }, 800);

  window.__studioMenuBarShow = show;
  window.__studioMenuBarHide = hide;
  window.__studioMenuBarRefresh = refresh;

  if (window.__studioCommandRegister) {
    for (const [name, fn] of [
      ['__studioMenuBarShow', show],
      ['__studioMenuBarHide', hide],
      ['__studioMenuBarRefresh', refresh],
    ]) {
      window.__studioCommandRegister(name, fn, { category: 'system', description: 'Top menu bar' });
    }
  }
}
