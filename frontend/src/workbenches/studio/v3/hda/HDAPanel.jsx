// ArchDisc Studio V3 — HDA library panel.
//
// Floating React panel mounted to a body-attached host (so we don't
// touch StudioShellV3.jsx). Lists every HDA in localStorage with:
//
//   • [Instantiate] button — runs window.__studioHDAInstantiate
//   • [Export] button       — copies the JSON to clipboard / logs it
//   • [Delete] button       — confirms then removes the entry
//   • Param chips           — `exposed[]` from the asset's metadata so
//                             the user knows what they can override
//
// Header has:
//   • Title + count
//   • [Import…] file picker (drops the chosen JSON into localStorage)
//   • [Close] button
//
// Styled to match assetbrowser / matlib panels (slice 688 / 692).
// Pure native — no extra libs beyond React + the slice's own
// hda library/asset modules.

import React, { useCallback, useEffect, useState } from 'react';

const PANEL_STYLE = {
  position: 'fixed',
  top: '72px',
  right: '24px',
  width: '420px',
  maxHeight: 'calc(100vh - 96px)',
  zIndex: 9300,
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

const DANGER_BUTTON_STYLE = {
  ...BUTTON_STYLE,
  borderColor: '#5a2a36',
  color: '#ffb0bf',
};

const LIST_STYLE = {
  overflowY: 'auto',
  padding: '8px 6px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const ROW_STYLE = {
  border: '1px solid #1d2937',
  background: '#10151c',
  borderRadius: '8px',
  padding: '8px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const NAME_ROW_STYLE = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const NAME_STYLE = { fontWeight: 600, color: '#ecf3fb' };
const META_STYLE = { color: '#6e8aaa', fontSize: '11px' };
const ACTIONS_STYLE = { display: 'flex', gap: '4px' };

const CHIP_STYLE = {
  display: 'inline-block',
  background: '#1a2331',
  border: '1px solid #2a3a52',
  borderRadius: '4px',
  padding: '1px 6px',
  marginRight: '4px',
  color: '#9ab3cf',
  fontSize: '10px',
};

const EMPTY_STYLE = {
  padding: '24px 12px',
  textAlign: 'center',
  color: '#6e8aaa',
};

// ─── Component ──────────────────────────────────────────────────────────

export default function HDAPanel(props) {
  const {
    listFn, deleteFn, exportFn, importFn, instantiateFn,
    onCloseRequest, refreshKey,
  } = props;

  const [items, setItems] = useState([]);
  const [confirmDel, setConfirmDel] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (typeof listFn !== 'function') { setItems([]); return; }
    const r = listFn();
    setItems((r && r.ok && Array.isArray(r.hdas)) ? r.hdas : []);
  }, [listFn]);

  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  // ─── Handlers ─────────────────────────────────────────────────────────
  const handleInstantiate = useCallback((name) => {
    if (typeof instantiateFn !== 'function') return;
    setBusy(true);
    Promise.resolve(instantiateFn(name)).then(() => {
      setBusy(false);
    }).catch(() => setBusy(false));
  }, [instantiateFn]);

  const handleExport = useCallback((name) => {
    if (typeof exportFn !== 'function') return;
    const r = exportFn(name);
    if (!r || !r.ok) return;
    // Try clipboard first; if unavailable, dump to console + offer a
    // data-URL link via window.prompt as a last resort.
    const json = r.json;
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).catch(() => { /* swallow */ });
    } else {
      // eslint-disable-next-line no-console
      console.log('[hda] export', name, json);
    }
  }, [exportFn]);

  const handleDelete = useCallback((name) => {
    if (typeof deleteFn !== 'function') return;
    deleteFn(name);
    setConfirmDel(null);
    refresh();
  }, [deleteFn, refresh]);

  const handleImportFile = useCallback((evt) => {
    const file = evt.target.files && evt.target.files[0];
    if (!file || typeof importFn !== 'function') return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const txt = String(e.target.result || '');
        const r = importFn(txt);
        if (r && r.ok) refresh();
      } catch (_) { /* swallow */ }
    };
    reader.readAsText(file);
    // Reset the input so re-picking the same file re-triggers.
    evt.target.value = '';
  }, [importFn, refresh]);

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div style={PANEL_STYLE} data-studio-v3-hda-panel>
      <div style={HEADER_STYLE}>
        <div>
          <span style={TITLE_STYLE}>HDA Library</span>
          <span style={COUNT_STYLE}>{items.length} asset{items.length === 1 ? '' : 's'}</span>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <label style={{ ...PRIMARY_BUTTON_STYLE, cursor: 'pointer' }}>
            Import…
            <input
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={handleImportFile}
              data-studio-v3-hda-import
            />
          </label>
          <button
            type="button"
            onClick={onCloseRequest}
            style={BUTTON_STYLE}
            data-studio-v3-hda-close
          >Close</button>
        </div>
      </div>

      <div style={LIST_STYLE}>
        {items.length === 0 ? (
          <div style={EMPTY_STYLE} data-studio-v3-hda-empty>
            No HDAs yet. Pack a sub-graph via <code>__studioHDAPack</code>.
          </div>
        ) : items.map((it) => (
          <div key={it.name} style={ROW_STYLE} data-studio-v3-hda-row data-name={it.name}>
            <div style={NAME_ROW_STYLE}>
              <span style={NAME_STYLE}>{it.name}</span>
              <span style={META_STYLE}>
                {it.nodeCount}n · {it.wireCount}w
              </span>
            </div>
            <div>
              {(it.exposed || []).map((k) => (
                <span key={k} style={CHIP_STYLE}>{k}</span>
              ))}
              {(!it.exposed || it.exposed.length === 0) && (
                <span style={{ ...META_STYLE, fontStyle: 'italic' }}>no exposed params</span>
              )}
            </div>
            <div style={ACTIONS_STYLE}>
              <button
                type="button"
                style={PRIMARY_BUTTON_STYLE}
                disabled={busy}
                onClick={() => handleInstantiate(it.name)}
                data-studio-v3-hda-instantiate
              >Instantiate</button>
              <button
                type="button"
                style={BUTTON_STYLE}
                onClick={() => handleExport(it.name)}
                data-studio-v3-hda-export
              >Export</button>
              {confirmDel === it.name ? (
                <>
                  <button
                    type="button"
                    style={DANGER_BUTTON_STYLE}
                    onClick={() => handleDelete(it.name)}
                    data-studio-v3-hda-delete-confirm
                  >Confirm Delete</button>
                  <button
                    type="button"
                    style={BUTTON_STYLE}
                    onClick={() => setConfirmDel(null)}
                  >Cancel</button>
                </>
              ) : (
                <button
                  type="button"
                  style={DANGER_BUTTON_STYLE}
                  onClick={() => setConfirmDel(it.name)}
                  data-studio-v3-hda-delete
                >Delete</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
