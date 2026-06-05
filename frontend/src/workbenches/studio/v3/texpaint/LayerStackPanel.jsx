// ArchDisc Studio V3 — texture paint side panel.
//
// Renders the active material's layer stack. Each row is draggable
// (HTML5 native dragstart / dragover / drop) so the user can re-order
// the stack visually. Eye / lock toggles + opacity slider per row.
//
// Mounted as a floating right-side panel via a body-attached host so
// we don't touch StudioShellV3.jsx. Closed via Esc or the X button.

import React, { useEffect, useState } from 'react';
import { BLENDS } from './layerstack.js';

const PANEL_W = 312;

function _meshLabel(mesh) {
  if (!mesh) return 'no selection';
  const k = mesh.userData && mesh.userData.archdiscStudioPrimitiveKind;
  return k ? `${k} · ${mesh.uuid.slice(0, 6)}` : `mesh · ${mesh.uuid.slice(0, 6)}`;
}

export default function LayerStackPanel({
  getSelectedMesh,
  listLayers,
  onAddFill, onAddPaint, onAddGenerator,
  onDelete, onReorder, onToggleEnabled, onToggleLocked,
  onSetOpacity, onSetBlend,
  onBake, onApplySmart, onMaskGen,
  smartNames, maskKinds,
  onCloseRequest,
}) {
  const [, force] = useState(0);
  const tick = () => force((v) => v + 1);
  const [dragFrom, setDragFrom] = useState(null);

  // Cheap polling refresh so the panel reacts to programmatic op calls
  // (smart material apply, mask gen, etc.) without us having to wire an
  // event bus through every code path.
  useEffect(() => {
    const id = setInterval(tick, 600);
    return () => clearInterval(id);
  }, []);

  const mesh = getSelectedMesh();
  const data = listLayers();
  const layers = data.layers || [];

  return (
    <div
      data-studio-v3-texpaint-panel
      style={{
        position: 'fixed',
        top: 70, right: 14,
        width: PANEL_W,
        maxHeight: 'calc(100vh - 100px)',
        zIndex: 9300,
        background: 'var(--studio-bg-elev, #161b22)',
        border: '1px solid rgba(154,166,178,0.35)',
        borderRadius: 6,
        color: 'var(--studio-ink, #e6edf3)',
        fontFamily: 'inherit',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 12px 28px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{
        padding: '8px 12px',
        background: 'rgba(13,17,23,0.6)',
        borderBottom: '1px solid rgba(29,233,182,0.45)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <strong style={{ color: 'var(--studio-accent, #1de9b6)', fontSize: 12, letterSpacing: '0.05em' }}>
          Texture layers
        </strong>
        <span style={{ opacity: 0.55, fontSize: 10, fontFamily: 'var(--studio-mono, ui-monospace)' }}>
          {_meshLabel(mesh)} · {data.count} {data.count === 1 ? 'layer' : 'layers'}
        </span>
        <div style={{ flex: 1 }} />
        <button
          data-studio-v3-texpaint-close
          onClick={() => onCloseRequest && onCloseRequest()}
          style={{
            background: 'transparent', color: 'inherit',
            border: '1px solid rgba(154,166,178,0.35)',
            padding: '2px 6px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
          }}
        >×</button>
      </div>

      <div style={{
        display: 'flex', gap: 4, padding: '8px 10px',
        borderBottom: '1px solid rgba(154,166,178,0.2)',
      }}>
        <button
          data-studio-v3-texpaint-add="fill"
          onClick={() => { onAddFill(); tick(); }}
          style={btnStyle()}
        >+ Fill</button>
        <button
          data-studio-v3-texpaint-add="paint"
          onClick={() => { onAddPaint(); tick(); }}
          style={btnStyle()}
        >+ Paint</button>
        <select
          data-studio-v3-texpaint-add-generator
          defaultValue=""
          onChange={(e) => { if (e.target.value) { onAddGenerator(e.target.value); e.target.value=''; tick(); } }}
          style={{ ...selStyle(), flex: 1 }}
        >
          <option value="">+ Mask gen…</option>
          {(maskKinds || []).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>

      <div style={{
        display: 'flex', gap: 4, padding: '4px 10px 8px',
        borderBottom: '1px solid rgba(154,166,178,0.2)',
      }}>
        <select
          data-studio-v3-texpaint-smart
          defaultValue=""
          onChange={(e) => { if (e.target.value) { onApplySmart(e.target.value); e.target.value=''; tick(); } }}
          style={{ ...selStyle(), flex: 1 }}
        >
          <option value="">Smart material…</option>
          {(smartNames || []).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button
          data-studio-v3-texpaint-bake
          onClick={() => { onBake(); tick(); }}
          style={{ ...btnStyle(), background: 'var(--studio-accent, #1de9b6)', color: '#0d1117', fontWeight: 600 }}
        >Bake</button>
      </div>

      {layers.length === 0 ? (
        <div style={{ padding: 18, fontSize: 11, opacity: 0.55 }}>
          No layers yet. Add a fill, a paint layer, or apply a smart material.
        </div>
      ) : (
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {/* Display top-of-stack first so it matches typical DCC layer panels. */}
          {layers.slice().reverse().map((l) => (
            <div
              key={l.uuid}
              data-studio-v3-texpaint-row={l.uuid}
              data-studio-v3-texpaint-row-kind={l.kind}
              draggable
              onDragStart={() => setDragFrom(l.uuid)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragFrom && dragFrom !== l.uuid) {
                  onReorder(dragFrom, l.uuid);
                  tick();
                }
                setDragFrom(null);
              }}
              style={{
                padding: '6px 10px',
                borderBottom: '1px solid rgba(154,166,178,0.15)',
                opacity: l.enabled ? 1 : 0.4,
                background: dragFrom === l.uuid ? 'rgba(29,233,182,0.08)' : 'transparent',
                display: 'flex', flexDirection: 'column', gap: 4,
                cursor: 'grab',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <button
                  data-studio-v3-texpaint-eye={l.uuid}
                  onClick={() => { onToggleEnabled(l.uuid); tick(); }}
                  title={l.enabled ? 'Hide' : 'Show'}
                  style={iconBtn()}
                >{l.enabled ? '◉' : '○'}</button>
                <button
                  data-studio-v3-texpaint-lock={l.uuid}
                  onClick={() => { onToggleLocked(l.uuid); tick(); }}
                  title={l.locked ? 'Unlock' : 'Lock'}
                  style={iconBtn()}
                >{l.locked ? '🔒' : '🔓'}</button>
                <span style={{ flex: 1, fontWeight: 500, color: 'var(--studio-accent, #1de9b6)' }}>
                  {l.name || l.kind}
                </span>
                <span style={{ fontSize: 9, opacity: 0.6, fontFamily: 'var(--studio-mono, ui-monospace)' }}>
                  {l.kind}
                </span>
                <button
                  data-studio-v3-texpaint-del={l.uuid}
                  onClick={() => { onDelete(l.uuid); tick(); }}
                  title="Delete"
                  style={{ ...iconBtn(), color: '#ff7361' }}
                >×</button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
                <select
                  data-studio-v3-texpaint-blend={l.uuid}
                  value={l.blend}
                  onChange={(e) => { onSetBlend(l.uuid, e.target.value); tick(); }}
                  style={selStyle()}
                >
                  {BLENDS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
                <input
                  data-studio-v3-texpaint-opacity={l.uuid}
                  type="range" min={0} max={1} step={0.01}
                  value={l.opacity}
                  onChange={(e) => { onSetOpacity(l.uuid, +e.target.value); tick(); }}
                  style={{ flex: 1, accentColor: 'var(--studio-accent, #1de9b6)' }}
                />
                <span style={{ width: 26, textAlign: 'right', fontFamily: 'var(--studio-mono, ui-monospace)' }}>
                  {Math.round(l.opacity * 100)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function btnStyle() {
  return {
    background: 'transparent', color: 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    padding: '3px 8px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
  };
}

function selStyle() {
  return {
    background: 'rgba(13,17,23,0.6)', color: 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    padding: '2px 4px', borderRadius: 3, fontSize: 11,
  };
}

function iconBtn() {
  return {
    background: 'transparent', color: 'inherit',
    border: 'none', padding: 0, width: 18, height: 18,
    fontSize: 12, cursor: 'pointer', lineHeight: 1,
  };
}
