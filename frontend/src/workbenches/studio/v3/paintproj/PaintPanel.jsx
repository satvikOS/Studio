// ArchDisc Studio V3 — Projection painting side panel.
//
// Brush controls (size / color / opacity / hardness), a paint-mode
// toggle, an image projector ("Project from camera" → file input), and
// a clear button. Mounted via a body-attached host in index.js so we
// don't have to modify StudioShellV3.jsx.
//
// We rely on the floating-chip overlay rules from the UIUX v2 memory:
// the panel is a single docked surface (top-right) with a header strip,
// not a scattered chip cloud.

import React, { useEffect, useRef, useState } from 'react';

const PANEL_W = 296;

function _meshLabel(mesh) {
  if (!mesh) return 'no selection';
  const k = mesh.userData && mesh.userData.archdiscStudioPrimitiveKind;
  return k ? `${k} · ${mesh.uuid.slice(0, 6)}` : `mesh · ${mesh.uuid.slice(0, 6)}`;
}

export default function PaintPanel({
  getSelectedMesh,
  getBrush, onSetBrush,
  isActive,
  onEnterPaintMode, onExitPaintMode,
  onProjectImage, onClear,
  onCloseRequest,
}) {
  const [, force] = useState(0);
  const tick = () => force((v) => v + 1);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  // Cheap polling — the panel is a thin reflection of dragger state and
  // we don't want a full event bus just for size / colour echoes.
  useEffect(() => {
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, []);

  const mesh = getSelectedMesh ? getSelectedMesh() : null;
  const brush = getBrush ? getBrush() : { size: 28, color: '#ff5577', opacity: 0.9, hardness: 0.5 };
  const active = isActive ? !!isActive() : false;

  const onPickFile = () => { if (fileRef.current) fileRef.current.click(); };
  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setBusy(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(new Error('FileReader failed'));
        fr.readAsDataURL(f);
      });
      if (onProjectImage) await onProjectImage(dataUrl);
    } catch (_) { /* swallow — UX feedback would go here */ }
    setBusy(false);
    // Allow re-selecting the same file later.
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div
      data-studio-v3-paintproj-panel
      style={{
        position: 'fixed',
        top: 70, right: 14,
        width: PANEL_W,
        maxHeight: 'calc(100vh - 100px)',
        zIndex: 9350,
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
      {/* Header */}
      <div style={{
        padding: '8px 12px',
        background: 'rgba(13,17,23,0.6)',
        borderBottom: '1px solid rgba(29,233,182,0.45)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <strong style={{ color: 'var(--studio-accent, #1de9b6)', fontSize: 12, letterSpacing: '0.05em' }}>
          Projection paint
        </strong>
        <span style={{ opacity: 0.55, fontSize: 10, fontFamily: 'var(--studio-mono, ui-monospace)' }}>
          {_meshLabel(mesh)}
        </span>
        <div style={{ flex: 1 }} />
        <button
          data-studio-v3-paintproj-close
          type="button"
          onClick={() => onCloseRequest && onCloseRequest()}
          style={{
            background: 'transparent', color: 'inherit',
            border: '1px solid rgba(154,166,178,0.4)',
            borderRadius: 3, padding: '2px 7px', cursor: 'pointer', fontSize: 11,
          }}
        >×</button>
      </div>

      {/* Mode toggle */}
      <div style={{ padding: '10px 12px', display: 'flex', gap: 8 }}>
        <button
          data-studio-v3-paintproj-toggle
          type="button"
          onClick={() => (active ? onExitPaintMode && onExitPaintMode() : onEnterPaintMode && onEnterPaintMode())}
          style={{
            flex: 1,
            background: active ? 'var(--studio-accent, #1de9b6)' : 'rgba(154,166,178,0.12)',
            color: active ? '#0d1117' : 'inherit',
            border: '1px solid ' + (active ? 'var(--studio-accent, #1de9b6)' : 'rgba(154,166,178,0.4)'),
            borderRadius: 4, padding: '6px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
          }}
        >{active ? 'Painting · click to exit' : 'Enter paint mode'}</button>
        <button
          data-studio-v3-paintproj-clear
          type="button"
          onClick={() => onClear && onClear()}
          style={{
            background: 'transparent', color: 'inherit',
            border: '1px solid rgba(154,166,178,0.4)',
            borderRadius: 4, padding: '6px 10px', cursor: 'pointer', fontSize: 12,
          }}
        >Clear</button>
      </div>

      {/* Brush controls */}
      <div style={{ padding: '4px 12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Row label="Color">
          <input
            data-studio-v3-paintproj-color
            type="color"
            value={brush.color}
            onChange={(e) => onSetBrush && onSetBrush({ color: e.target.value })}
            style={{ width: 36, height: 22, padding: 0, border: '1px solid rgba(154,166,178,0.4)', background: 'transparent' }}
          />
          <span style={{ fontSize: 11, fontFamily: 'var(--studio-mono, ui-monospace)', opacity: 0.8 }}>{brush.color}</span>
        </Row>
        <Row label={`Size · ${Math.round(brush.size)}`}>
          <input
            data-studio-v3-paintproj-size
            type="range" min={1} max={200} step={1}
            value={brush.size}
            onChange={(e) => onSetBrush && onSetBrush({ size: Number(e.target.value) })}
            style={{ flex: 1 }}
          />
        </Row>
        <Row label={`Opacity · ${brush.opacity.toFixed(2)}`}>
          <input
            data-studio-v3-paintproj-opacity
            type="range" min={0} max={1} step={0.01}
            value={brush.opacity}
            onChange={(e) => onSetBrush && onSetBrush({ opacity: Number(e.target.value) })}
            style={{ flex: 1 }}
          />
        </Row>
        <Row label={`Hardness · ${brush.hardness.toFixed(2)}`}>
          <input
            data-studio-v3-paintproj-hardness
            type="range" min={0} max={1} step={0.01}
            value={brush.hardness}
            onChange={(e) => onSetBrush && onSetBrush({ hardness: Number(e.target.value) })}
            style={{ flex: 1 }}
          />
        </Row>
      </div>

      {/* Image projection */}
      <div style={{
        padding: '10px 12px', borderTop: '1px solid rgba(154,166,178,0.2)',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <span style={{ fontSize: 11, opacity: 0.7 }}>
          Project a 2D image onto the selected mesh from the current camera angle.
        </span>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
        <button
          data-studio-v3-paintproj-projectbtn
          type="button"
          disabled={busy}
          onClick={onPickFile}
          style={{
            background: 'rgba(29,233,182,0.18)',
            border: '1px solid var(--studio-accent, #1de9b6)',
            color: 'var(--studio-ink, #e6edf3)',
            borderRadius: 4, padding: '6px 10px', cursor: busy ? 'progress' : 'pointer',
            fontSize: 12, fontWeight: 600,
          }}
        >{busy ? 'Projecting…' : 'Project from camera…'}</button>
      </div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, width: 96, opacity: 0.85 }}>{label}</span>
      {children}
    </div>
  );
}
