// ArchDisc Studio V3 — Grease Pencil side panel.
//
// Floating right-side panel showing:
//   • Layer list (eye / opacity / name / delete / set-active)
//   • Add-layer button + add-frame button
//   • Current timeline cursor + transport buttons (play / pause)
//   • Brush snapshot — thickness + colour for the next stroke
//
// Mounts into a body-attached host via React.createRoot in index.js so
// we never touch StudioShellV3.jsx.
//
// Style language mirrors texpaint/LayerStackPanel.jsx — dark surface,
// accent green strokes, monospace tabular numerics. Pure React; no
// npm deps.

import React, { useEffect, useState } from 'react';

const PANEL_W = 304;

export default function GPPanel({
  getLayers,
  getActiveUuid,
  setActive,
  addLayer,
  deleteLayer,
  toggleVisible,
  setOpacity,
  addFrame,
  deleteFrame,
  getTime,
  setTime,
  play,
  pause,
  isPlaying,
  getDuration,
  getStrokeCount,
  getBrush,
  setBrushThickness,
  setBrushColor,
  onCloseRequest,
}) {
  const [, force] = useState(0);
  const tick = () => force((v) => v + 1);

  // Cheap polling refresh so the panel reacts to programmatic op
  // calls (stroke add, frame add, transport changes) without us
  // wiring an event bus.
  useEffect(() => {
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, []);

  const data = getLayers();
  const layers = data.layers || [];
  const activeUuid = getActiveUuid();
  const time = getTime();
  const dur = getDuration();
  const playing = isPlaying();
  const strokeCount = getStrokeCount();
  const brush = getBrush();

  return (
    <div
      data-studio-v3-gp-panel
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
          Grease Pencil
        </strong>
        <span style={{ opacity: 0.55, fontSize: 10, fontFamily: 'var(--studio-mono, ui-monospace)' }}>
          {layers.length} {layers.length === 1 ? 'layer' : 'layers'} · {strokeCount} strokes
        </span>
        <div style={{ flex: 1 }} />
        <button
          data-studio-v3-gp-close
          onClick={() => onCloseRequest && onCloseRequest()}
          style={btn()}
        >×</button>
      </div>

      {/* Transport */}
      <div style={{
        display: 'flex', gap: 4, padding: '8px 10px', alignItems: 'center',
        borderBottom: '1px solid rgba(154,166,178,0.2)',
      }}>
        <button
          data-studio-v3-gp-play
          onClick={() => { play(); tick(); }}
          disabled={playing}
          style={{ ...btn(), opacity: playing ? 0.4 : 1 }}
        >▶ Play</button>
        <button
          data-studio-v3-gp-pause
          onClick={() => { pause(); tick(); }}
          disabled={!playing}
          style={{ ...btn(), opacity: playing ? 1 : 0.4 }}
        >⏸ Pause</button>
        <input
          data-studio-v3-gp-scrub
          type="range"
          min={0} max={Math.max(dur, 0.001)} step={0.01}
          value={time}
          onChange={(e) => { setTime(+e.target.value); tick(); }}
          style={{ flex: 1, accentColor: 'var(--studio-accent, #1de9b6)' }}
        />
        <span
          data-studio-v3-gp-time
          style={{ fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 10, width: 48, textAlign: 'right' }}
        >
          {time.toFixed(2)}s
        </span>
      </div>

      {/* Brush */}
      <div style={{
        display: 'flex', gap: 6, padding: '6px 10px 8px', alignItems: 'center',
        borderBottom: '1px solid rgba(154,166,178,0.2)',
      }}>
        <span style={{ fontSize: 10, opacity: 0.65 }}>Brush</span>
        <input
          data-studio-v3-gp-brush-color
          type="color"
          value={brush.color}
          onChange={(e) => { setBrushColor(e.target.value); tick(); }}
          style={{
            width: 24, height: 22, padding: 0, border: '1px solid rgba(154,166,178,0.35)',
            borderRadius: 3, background: 'transparent', cursor: 'pointer',
          }}
        />
        <input
          data-studio-v3-gp-brush-thickness
          type="number"
          min={0.0001} max={0.1} step={0.001}
          value={brush.thickness}
          onChange={(e) => { setBrushThickness(+e.target.value); tick(); }}
          style={{ ...inp(), width: 60 }}
        />
        <span style={{ fontSize: 9, opacity: 0.55, fontFamily: 'var(--studio-mono, ui-monospace)' }}>m</span>
      </div>

      {/* Add buttons */}
      <div style={{
        display: 'flex', gap: 4, padding: '6px 10px 8px',
        borderBottom: '1px solid rgba(154,166,178,0.2)',
      }}>
        <button
          data-studio-v3-gp-add-layer
          onClick={() => { addLayer(); tick(); }}
          style={btn()}
        >+ Layer</button>
        <button
          data-studio-v3-gp-add-frame
          onClick={() => { addFrame(activeUuid, time); tick(); }}
          disabled={!activeUuid}
          style={{ ...btn(), opacity: activeUuid ? 1 : 0.4 }}
        >+ Frame@{time.toFixed(2)}s</button>
      </div>

      {/* Layer rows */}
      {layers.length === 0 ? (
        <div style={{ padding: 18, fontSize: 11, opacity: 0.55 }}>
          No layers yet. Add a layer to start drawing.
        </div>
      ) : (
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {layers.slice().reverse().map((l) => (
            <div
              key={l.uuid}
              data-studio-v3-gp-row={l.uuid}
              onClick={() => { setActive(l.uuid); tick(); }}
              style={{
                padding: '6px 10px',
                borderBottom: '1px solid rgba(154,166,178,0.15)',
                opacity: l.visible ? 1 : 0.4,
                background: l.uuid === activeUuid ? 'rgba(29,233,182,0.08)' : 'transparent',
                display: 'flex', flexDirection: 'column', gap: 4,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <button
                  data-studio-v3-gp-eye={l.uuid}
                  onClick={(e) => { e.stopPropagation(); toggleVisible(l.uuid); tick(); }}
                  title={l.visible ? 'Hide' : 'Show'}
                  style={iconBtn()}
                >{l.visible ? '◉' : '○'}</button>
                <span style={{
                  flex: 1, fontWeight: 500,
                  color: l.uuid === activeUuid ? 'var(--studio-accent, #1de9b6)' : 'inherit',
                }}>{l.name}</span>
                <span style={{ fontSize: 9, opacity: 0.55, fontFamily: 'var(--studio-mono, ui-monospace)' }}>
                  {l.frameCount}f
                </span>
                <button
                  data-studio-v3-gp-del={l.uuid}
                  onClick={(e) => { e.stopPropagation(); deleteLayer(l.uuid); tick(); }}
                  title="Delete layer"
                  style={{ ...iconBtn(), color: '#ff7361' }}
                >×</button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
                <span style={{ opacity: 0.55, fontSize: 9 }}>α</span>
                <input
                  data-studio-v3-gp-opacity={l.uuid}
                  type="range" min={0} max={1} step={0.01}
                  value={l.opacity}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => { setOpacity(l.uuid, +e.target.value); tick(); }}
                  style={{ flex: 1, accentColor: 'var(--studio-accent, #1de9b6)' }}
                />
                <span style={{ width: 26, textAlign: 'right', fontFamily: 'var(--studio-mono, ui-monospace)' }}>
                  {Math.round(l.opacity * 100)}
                </span>
              </div>
              {l.frameTimes && l.frameTimes.length > 0 && (
                <div
                  data-studio-v3-gp-frames={l.uuid}
                  style={{ display: 'flex', gap: 3, flexWrap: 'wrap', fontSize: 9 }}
                >
                  {l.frameTimes.map((ft) => (
                    <button
                      key={ft}
                      data-studio-v3-gp-frame={`${l.uuid}:${ft}`}
                      onClick={(e) => { e.stopPropagation(); setTime(ft); tick(); }}
                      onDoubleClick={(e) => { e.stopPropagation(); deleteFrame(l.uuid, ft); tick(); }}
                      title={`Jump to ${ft.toFixed(2)}s · double-click to delete`}
                      style={{
                        ...iconBtn(),
                        padding: '0 4px', minWidth: 30, height: 16,
                        background: Math.abs(ft - time) < 0.05
                          ? 'rgba(29,233,182,0.18)' : 'rgba(154,166,178,0.12)',
                        border: '1px solid rgba(154,166,178,0.25)',
                        borderRadius: 3, color: 'inherit',
                        fontFamily: 'var(--studio-mono, ui-monospace)',
                      }}
                    >{ft.toFixed(2)}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function btn() {
  return {
    background: 'transparent', color: 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    padding: '3px 8px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
  };
}

function inp() {
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
