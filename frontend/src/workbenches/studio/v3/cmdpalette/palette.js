// Slice 683 — Visible Command Palette overlay. Cmd/Ctrl+Shift+P
// opens it. Lists every command registered via __studioCommand
// Register (slice 668) — including every op shipped by the parity
// agents (edit/shader/rig/geomnodes/compositor/mograph/sculpt/
// texpaint/rt/anim/sim). Type to fuzzy-search, Enter to invoke.

let _host = null;
let _open = false;
let _query = '';
let _focusIdx = 0;
let _lastHits = [];

const STYLE = {
  host: 'position:fixed;inset:0;background:rgba(8,12,20,0.55);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding-top:12vh;font:14px/1.4 ui-sans-serif,system-ui',
  card: 'background:#0f141b;border:1px solid #2a3a52;border-radius:10px;box-shadow:0 16px 48px rgba(0,0,0,0.55);width:min(640px,90vw);max-height:64vh;display:flex;flex-direction:column;overflow:hidden',
  input: 'background:transparent;border:0;border-bottom:1px solid #1d2937;color:#ecf3fb;font:500 15px/1.6 ui-sans-serif,system-ui;padding:12px 14px;outline:none',
  list: 'overflow:auto;padding:6px 0;flex:1',
  row: 'padding:8px 14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;color:#cdd6e2',
  rowActive: 'background:#152234;color:#ecf3fb',
  cat: 'font:600 10px/1 ui-monospace,Menlo,monospace;color:#6e8aaa;background:#152234;padding:2px 6px;border-radius:4px;letter-spacing:0.05em;text-transform:uppercase',
  empty: 'padding:18px;color:#6e8aaa;text-align:center',
};

function _hits() {
  const q = _query.trim();
  if (!q) {
    if (!window.__studioCommandRegistry) return [];
    return Array.from(window.__studioCommandRegistry.values())
      .slice(0, 40)
      .map((c) => ({ name: c.name, category: c.category, description: c.description }));
  }
  const r = window.__studioCommandSearch?.(q, 40);
  return r?.hits || [];
}

function _render() {
  if (!_host) return;
  _lastHits = _hits();
  if (_focusIdx >= _lastHits.length) _focusIdx = Math.max(0, _lastHits.length - 1);
  const rows = _lastHits.map((h, i) => {
    const active = i === _focusIdx;
    const label = h.name.replace(/^__studio/, '');
    return (
      `<div data-row="${i}" style="${STYLE.row}${active ? ';' + STYLE.rowActive : ''}">` +
        `<span>${label}</span>` +
        `<span style="${STYLE.cat}">${h.category || ''}</span>` +
      '</div>'
    );
  }).join('');
  const empty = !_lastHits.length ? `<div style="${STYLE.empty}">no matches</div>` : '';
  _host.innerHTML =
    `<div data-studio-v3-cmdpalette style="${STYLE.host}">` +
      `<div style="${STYLE.card}">` +
        `<input data-cmdpalette-input value="${_query.replace(/"/g, '&quot;')}" placeholder="Search every Studio command…" style="${STYLE.input}" />` +
        `<div data-cmdpalette-list style="${STYLE.list}">${rows}${empty}</div>` +
      '</div>' +
    '</div>';
  const input = _host.querySelector('[data-cmdpalette-input]');
  if (input) {
    input.focus();
    input.setSelectionRange(_query.length, _query.length);
    input.addEventListener('input', (e) => {
      _query = e.target.value;
      _focusIdx = 0;
      _render();
    });
  }
  _host.querySelectorAll('[data-row]').forEach((el) => {
    el.addEventListener('mouseenter', () => { _focusIdx = Number(el.getAttribute('data-row')); _render(); });
    el.addEventListener('click', () => { _focusIdx = Number(el.getAttribute('data-row')); _invoke(); });
  });
}

function _ensureHost() {
  if (_host) return _host;
  _host = document.createElement('div');
  _host.setAttribute('data-studio-v3-cmdpalette-host', '');
  _host.style.display = 'none';
  document.body.appendChild(_host);
  return _host;
}

function _invoke() {
  const h = _lastHits[_focusIdx];
  if (!h) return;
  const r = window.__studioCommandInvoke?.(h.name);
  // toast result if available
  if (window.__studioToast) {
    if (r?.ok) window.__studioToast(`Ran ${h.name.replace(/^__studio/, '')}`, 'ok');
    else window.__studioToast(`${h.name}: ${r?.error || 'failed'}`, 'err');
  }
  close();
}

export function open() {
  _ensureHost();
  if (_open) return { ok: true };
  _open = true;
  _focusIdx = 0;
  _host.style.display = 'block';
  _render();
  return { ok: true };
}

export function close() {
  if (!_open) return { ok: true };
  _open = false;
  if (_host) _host.style.display = 'none';
  return { ok: true };
}

export function toggle() {
  return _open ? close() : open();
}

export function isOpen() { return _open; }

function _onKey(e) {
  // Cmd/Ctrl+Shift+P toggles
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
    e.preventDefault();
    toggle();
    return;
  }
  if (!_open) return;
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); _focusIdx = Math.min(_lastHits.length - 1, _focusIdx + 1); _render(); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); _focusIdx = Math.max(0, _focusIdx - 1); _render(); return; }
  if (e.key === 'Enter') { e.preventDefault(); _invoke(); return; }
}

export function install() {
  if (window.__studioCmdPaletteInstalled) return;
  window.__studioCmdPaletteInstalled = true;
  document.addEventListener('keydown', _onKey, true);

  window.__studioPaletteOpen = open;
  window.__studioPaletteClose = close;
  window.__studioPaletteToggle = toggle;
  window.__studioPaletteIsOpen = isOpen;

  if (window.__studioCommandRegister) {
    for (const [name, fn] of [
      ['__studioPaletteOpen', open],
      ['__studioPaletteClose', close],
      ['__studioPaletteToggle', toggle],
    ]) {
      window.__studioCommandRegister(name, fn, { category: 'system', description: 'Command palette UI' });
    }
  }
}
