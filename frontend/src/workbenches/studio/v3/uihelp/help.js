// Slice 724 — UI Help panel (F1). Searchable docs side panel that
// enumerates every registered op via slice-695 common/registry,
// shows name, category, description, and a "Try" button that calls
// the op with no args. Pure DOM overlay; no React state.

let _panel = null;
let _enabled = false;

function _mount() {
  if (_panel) return _panel;
  const host = window.__archdiscViewport?.container?.parentElement || document.body;
  _panel = document.createElement('div');
  _panel.dataset.studioHelp = '1';
  _panel.style.cssText = [
    'position:absolute', 'top:32px', 'right:8px', 'bottom:32px', 'width:380px',
    'background:rgba(28,28,32,0.95)', 'color:#cccccc',
    'font:12px Monaco, Consolas, monospace',
    'border:1px solid #444', 'border-radius:6px',
    'box-shadow:0 6px 18px rgba(0,0,0,0.5)',
    'display:flex', 'flex-direction:column',
    'z-index:9998', 'pointer-events:auto', 'overflow:hidden',
  ].join(';');
  // Header.
  const header = document.createElement('div');
  header.textContent = 'Studio Help (F1)';
  header.style.cssText = 'padding:8px 12px;background:#202028;border-bottom:1px solid #444;font-weight:bold';
  _panel.appendChild(header);
  // Search.
  const search = document.createElement('input');
  search.placeholder = 'Search ops…';
  search.style.cssText = 'margin:8px;padding:6px 10px;background:#0f1014;border:1px solid #444;color:#ddd;font:12px Monaco';
  _panel.appendChild(search);
  // List container.
  const list = document.createElement('div');
  list.style.cssText = 'flex:1;overflow-y:auto;padding:0 8px 8px 8px';
  _panel.appendChild(list);
  // Refresh handler.
  function _refresh() {
    const q = search.value.toLowerCase();
    list.innerHTML = '';
    if (typeof window.__studioRegistryListAll !== 'function') {
      list.innerHTML = '<div style="padding:8px;color:#888">No registry installed.</div>';
      return;
    }
    const all = window.__studioRegistryListAll();
    if (!all?.ok) return;
    const matched = all.ops.filter((op) =>
      !q || op.name.toLowerCase().includes(q) || (op.description || '').toLowerCase().includes(q));
    for (const op of matched.slice(0, 80)) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:8px;border-bottom:1px solid #333';
      const opName = document.createElement('div');
      opName.textContent = op.name;
      opName.style.cssText = 'color:#eee;font-weight:bold';
      const desc = document.createElement('div');
      desc.textContent = op.description || `(category: ${op.category})`;
      desc.style.cssText = 'color:#888;font-size:11px;margin-top:3px';
      const btn = document.createElement('button');
      btn.textContent = 'Try';
      btn.style.cssText = 'margin-top:6px;padding:4px 10px;background:#3a5fc0;color:#fff;border:none;border-radius:3px;cursor:pointer;font:11px Monaco';
      btn.addEventListener('click', () => {
        try { window[op.name](); }
        catch (e) { console.warn(`${op.name} threw`, e); }
      });
      row.appendChild(opName);
      row.appendChild(desc);
      row.appendChild(btn);
      list.appendChild(row);
    }
    if (matched.length === 0) {
      list.innerHTML = '<div style="padding:8px;color:#888">No matches.</div>';
    }
  }
  search.addEventListener('input', _refresh);
  // Close button.
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = 'position:absolute;top:6px;right:8px;background:transparent;color:#888;border:0;font:14px Monaco;cursor:pointer';
  closeBtn.addEventListener('click', () => disable());
  _panel.appendChild(closeBtn);
  host.appendChild(_panel);
  _refresh();
  // Initial focus.
  setTimeout(() => search.focus(), 100);
  return _panel;
}

export function enable() {
  _enabled = true;
  _mount();
  return { ok: true };
}

export function disable() {
  _enabled = false;
  if (_panel?.parentElement) _panel.parentElement.removeChild(_panel);
  _panel = null;
  return { ok: true };
}

export function toggle() {
  if (_enabled) return disable();
  return enable();
}

export function isEnabled() { return { ok: true, enabled: _enabled }; }
