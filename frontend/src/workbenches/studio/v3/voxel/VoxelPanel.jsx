// ArchDisc Studio V3 — VoxelPanel side widget.
//
// MagicaVoxel-style side panel:
//   • palette grid (16 cols × 4 rows of swatches; click → set active,
//     right-click → open native colour picker to overwrite the slot)
//   • active palette index readout + hex value
//   • size inputs (sx, sy, sz) + "Create / Reset" button
//   • cell-size slider
//   • paint mode toggle (when ON the dragger raycasts the canvas)
//   • Clear / Export OBJ / Export PLY / Save JSON / Load JSON buttons
//
// Style language matches snap2/SnapPanel.jsx (dark surface, accent
// stroke, monospace numerics).

import React, { useEffect, useRef, useState } from 'react';

const PANEL_W = 296;

export default function VoxelPanel(props) {
  const {
    getActiveIdx, setActive, getPalette, setPaletteEntry,
    getDims, createVolume, clearVolume,
    getPaintEnabled, setPaintEnabled,
    getCellSize, setCellSize,
    exportObj, exportJson, importJson,
    getStats,
    onCloseRequest,
  } = props;

  const [, force] = useState(0);
  const tick = () => force((v) => v + 1);
  const fileRef = useRef(null);

  useEffect(() => {
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, []);

  const palette = getPalette();
  const activeIdx = getActiveIdx();
  const dims = getDims();
  const cellSize = getCellSize();
  const paint = getPaintEnabled();
  const stats = getStats();
  const activeRGB = palette[activeIdx] || [0, 0, 0];

  // Per-row swatch chunks for a 16x4 grid.
  const rows = [];
  for (let r = 0; r < 4; r++) {
    const row = [];
    for (let c = 0; c < 16; c++) {
      const i = 1 + r * 16 + c;
      row.push(i);
    }
    rows.push(row);
  }

  function rgbToHex([r, g, b]) {
    const f = (v) => Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16).padStart(2, '0');
    return `#${f(r)}${f(g)}${f(b)}`;
  }

  function handleSwatchClick(i) {
    setActive(i);
    tick();
  }

  function handleSwatchAlt(i, e) {
    e.preventDefault();
    // Spawn an offscreen <input type="color"> so we get the native picker.
    const input = document.createElement('input');
    input.type = 'color';
    input.value = rgbToHex(palette[i] || [1, 1, 1]);
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      setPaletteEntry(i, input.value);
      document.body.removeChild(input);
      tick();
    });
    setTimeout(() => input.click(), 0);
  }

  function handleCreate() {
    createVolume(dims.sizeX, dims.sizeY, dims.sizeZ, cellSize);
    tick();
  }

  function handleDimChange(axis, val) {
    const n = Math.max(1, Math.min(128, Math.round(+val) || 1));
    const next = { ...dims };
    next[axis] = n;
    // Live update — only takes effect when the user clicks "Create".
    // We persist the desired dims in a small local state on the panel.
    panelDimState.sizeX = next.sizeX;
    panelDimState.sizeY = next.sizeY;
    panelDimState.sizeZ = next.sizeZ;
    tick();
  }

  function handleExportObj() {
    const r = exportObj();
    if (!r || !r.ok || !r.text) return;
    triggerDownload(r.text, 'voxel.obj', 'text/plain');
  }

  function handleExportJson() {
    const r = exportJson();
    if (!r || !r.ok || !r.json) return;
    triggerDownload(JSON.stringify(r.json, null, 2), 'voxel.json', 'application/json');
  }

  function handleLoadJsonClick() {
    if (fileRef.current) fileRef.current.click();
  }
  function handleLoadJsonChange(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const j = JSON.parse(String(reader.result || '{}'));
        importJson(j);
        tick();
      } catch (_) { /* swallow */ }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <div
      data-studio-v3-voxel-panel
      style={{
        position: 'fixed',
        top: 70, right: 14,
        width: PANEL_W,
        maxHeight: 'calc(100vh - 100px)',
        zIndex: 9400,
        background: 'var(--studio-bg-elev, #161b22)',
        border: '1px solid rgba(154,166,178,0.35)',
        borderRadius: 6,
        color: 'var(--studio-ink, #e6edf3)',
        fontFamily: 'inherit',
        display: 'flex', flexDirection: 'column',
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
          Voxel Editor
        </strong>
        <div style={{ flex: 1 }} />
        <button
          data-studio-v3-voxel-close
          onClick={() => onCloseRequest && onCloseRequest()}
          style={btn()}
        >×</button>
      </div>

      <Section title="Palette · 64 colours">
        <div style={{ padding: '4px 10px', display: 'grid', gap: 2 }}>
          {rows.map((row, r) => (
            <div key={r} style={{ display: 'grid', gridTemplateColumns: 'repeat(16, 1fr)', gap: 2 }}>
              {row.map((i) => {
                const c = palette[i] || [0, 0, 0];
                const active = i === activeIdx;
                return (
                  <button
                    key={i}
                    data-studio-v3-voxel-swatch={i}
                    onClick={() => handleSwatchClick(i)}
                    onContextMenu={(e) => handleSwatchAlt(i, e)}
                    title={`Index ${i} · ${rgbToHex(c)}\nLeft-click: activate · Right-click: edit`}
                    style={{
                      width: '100%',
                      aspectRatio: '1 / 1',
                      background: `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`,
                      border: active
                        ? '2px solid var(--studio-accent, #1de9b6)'
                        : '1px solid rgba(0,0,0,0.5)',
                      borderRadius: 2,
                      cursor: 'pointer',
                      padding: 0,
                      boxShadow: active ? '0 0 6px rgba(29,233,182,0.6)' : 'none',
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div style={{
          padding: '4px 10px 8px', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={lbl()}>Active</span>
          <span
            data-studio-v3-voxel-active-idx
            style={{
              ...inp(), padding: '2px 6px', minWidth: 28, textAlign: 'center',
            }}
          >{activeIdx}</span>
          <span
            data-studio-v3-voxel-active-hex
            style={{
              ...inp(), padding: '2px 6px', flex: 1, textAlign: 'center',
              color: 'var(--studio-accent, #1de9b6)',
            }}
          >{rgbToHex(activeRGB)}</span>
        </div>
      </Section>

      <Section title="Volume">
        <div style={row()}>
          <span style={lbl()}>Size</span>
          {['sizeX', 'sizeY', 'sizeZ'].map((axis) => (
            <input
              key={axis}
              data-studio-v3-voxel-size={axis}
              type="number" min={1} max={128}
              defaultValue={panelDimState[axis] != null ? panelDimState[axis] : dims[axis]}
              onChange={(e) => handleDimChange(axis, e.target.value)}
              style={{ ...inp(), width: 52 }}
            />
          ))}
        </div>
        <div style={row()}>
          <span style={lbl()}>Cell</span>
          <input
            data-studio-v3-voxel-cell-size
            type="number" min={0.001} step={0.01}
            value={cellSize}
            onChange={(e) => { setCellSize(+e.target.value || 0.1); tick(); }}
            style={{ ...inp(), width: 80 }}
          />
          <span style={{ fontSize: 9, opacity: 0.55, fontFamily: 'var(--studio-mono, ui-monospace)' }}>m</span>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: '4px 10px 8px' }}>
          <button
            data-studio-v3-voxel-create
            onClick={handleCreate}
            style={{ ...btn(), flex: 1 }}
          >Create / Reset volume</button>
        </div>
      </Section>

      <Section title="Paint">
        <label style={row()}>
          <input
            data-studio-v3-voxel-paint-toggle
            type="checkbox"
            checked={!!paint}
            onChange={(e) => { setPaintEnabled(e.target.checked); tick(); }}
            style={{ accentColor: 'var(--studio-accent, #1de9b6)' }}
          />
          <span style={{ flex: 1, fontSize: 11 }}>Enable paint (click = add · shift+click = remove)</span>
        </label>
        <div style={{ display: 'flex', gap: 4, padding: '4px 10px 8px' }}>
          <button
            data-studio-v3-voxel-clear
            onClick={() => { clearVolume(); tick(); }}
            style={{ ...btn(), flex: 1 }}
          >Clear volume</button>
        </div>
      </Section>

      <Section title="Export / Import">
        <div style={{ display: 'flex', gap: 4, padding: '4px 10px' }}>
          <button data-studio-v3-voxel-export-obj
            onClick={handleExportObj} style={{ ...btn(), flex: 1 }}>OBJ</button>
          <button data-studio-v3-voxel-export-json
            onClick={handleExportJson} style={{ ...btn(), flex: 1 }}>Save JSON</button>
          <button data-studio-v3-voxel-import-json
            onClick={handleLoadJsonClick} style={{ ...btn(), flex: 1 }}>Load JSON</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleLoadJsonChange}
          />
        </div>
      </Section>

      <div
        data-studio-v3-voxel-status
        style={{
          padding: '6px 12px',
          fontSize: 10, opacity: 0.6,
          fontFamily: 'var(--studio-mono, ui-monospace)',
          borderTop: '1px solid rgba(154,166,178,0.18)',
        }}
      >
        {stats.voxels} voxels · {stats.verts} verts · {stats.sizeX}×{stats.sizeY}×{stats.sizeZ}
      </div>
    </div>
  );
}

// Persisted between renders so the size inputs keep the user's typed
// numbers without reverting to the live volume's actual dims.
const panelDimState = { sizeX: null, sizeY: null, sizeZ: null };

function Section({ title, children }) {
  return (
    <div style={{ borderBottom: '1px solid rgba(154,166,178,0.18)' }}>
      <div style={{
        padding: '6px 12px 2px',
        fontSize: 9, letterSpacing: '0.08em',
        textTransform: 'uppercase', opacity: 0.6,
      }}>{title}</div>
      {children}
    </div>
  );
}

function row() {
  return { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px' };
}
function lbl() { return { fontSize: 10, opacity: 0.6, minWidth: 36 }; }
function btn() {
  return {
    background: 'transparent', color: 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    padding: '4px 8px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
  };
}
function inp() {
  return {
    background: 'rgba(13,17,23,0.6)', color: 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    padding: '2px 4px', borderRadius: 3, fontSize: 11,
    fontFamily: 'var(--studio-mono, ui-monospace)',
  };
}

function triggerDownload(text, filename, mime) {
  try {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (_) { /* swallow — tests use the JSON return path */ }
}
