// ArchDisc Studio V3 — Snap2 N-panel side widget.
//
// Floating right-side panel mirroring Blender's N-panel "Tool" tab
// snap section + the Transform Orientation popover + the Pivot Point
// popover. Pure React, no npm deps. Mounted into a body-attached host
// in index.js so we never touch StudioShellV3.jsx.
//
// Style language matches gp/GPPanel.jsx — dark surface, accent green
// strokes, monospace tabular numerics.

import React, { useEffect, useState } from 'react';

const PANEL_W = 268;
const ORIENT_KINDS = ['global', 'local', 'normal', 'gimbal', 'view', 'custom'];
const PIVOT_KINDS  = ['bbox', 'median', 'individual', 'active', 'cursor'];
const PIVOT_LABEL  = { bbox: 'BBox', median: 'Median', individual: 'Individual', active: 'Active', cursor: 'Cursor' };
const SNAP_KINDS   = ['vertex', 'edge', 'face', 'grid'];

export default function SnapPanel({
  getState,        // () → snap-during-drag state (on, snapRadius, kindMask, lastSnap)
  setLiveDrag,     // (bool)
  setRadius,       // (number)
  setKind,         // (kind:string, on:bool)
  getOrient,       // () → { kind, customAxes }
  setOrient,       // (kind)
  setCustomAxes,   // ([x,y,z])
  getPivot,        // () → { kind }
  setPivot,        // (kind)
  onCloseRequest,
}) {
  const [, force] = useState(0);
  const tick = () => force((v) => v + 1);
  useEffect(() => {
    const id = setInterval(tick, 400);
    return () => clearInterval(id);
  }, []);

  const s = getState();
  const orient = getOrient();
  const pivot = getPivot();
  const ax = (orient.customAxes && orient.customAxes.length === 3) ? orient.customAxes : [1, 0, 0];

  return (
    <div
      data-studio-v3-snap2-panel
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
          Snap / Transform
        </strong>
        <div style={{ flex: 1 }} />
        <button
          data-studio-v3-snap2-close
          onClick={() => onCloseRequest && onCloseRequest()}
          style={btn()}
        >×</button>
      </div>

      {/* Snap-during-drag */}
      <Section title="Snap during drag">
        <label style={row()}>
          <input
            data-studio-v3-snap2-live-toggle
            type="checkbox"
            checked={!!s.on}
            onChange={(e) => { setLiveDrag(e.target.checked); tick(); }}
            style={{ accentColor: 'var(--studio-accent, #1de9b6)' }}
          />
          <span style={{ flex: 1, fontSize: 11 }}>Live snap on drag</span>
          <span
            data-studio-v3-snap2-last-kind
            style={{
              fontSize: 9, fontFamily: 'var(--studio-mono, ui-monospace)',
              padding: '1px 6px', borderRadius: 3,
              background: s.lastSnap ? 'rgba(29,233,182,0.18)' : 'rgba(154,166,178,0.12)',
              color: s.lastSnap ? 'var(--studio-accent, #1de9b6)' : 'inherit',
              opacity: s.lastSnap ? 1 : 0.55,
            }}
          >{s.lastSnap ? s.lastSnap.kind : '—'}</span>
        </label>
        <div style={row()}>
          <span style={lbl()}>Radius</span>
          <input
            data-studio-v3-snap2-radius
            type="number" min={0.0001} max={5} step={0.001}
            value={s.snapRadius}
            onChange={(e) => { setRadius(+e.target.value); tick(); }}
            style={{ ...inp(), width: 80 }}
          />
          <span style={{ fontSize: 9, opacity: 0.55, fontFamily: 'var(--studio-mono, ui-monospace)' }}>m</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '2px 10px 8px' }}>
          {SNAP_KINDS.map((k) => (
            <button
              key={k}
              data-studio-v3-snap2-kind={k}
              onClick={() => { setKind(k, !s.kindMask[k]); tick(); }}
              style={{
                ...chip(),
                background: s.kindMask[k]
                  ? 'rgba(29,233,182,0.22)' : 'rgba(154,166,178,0.10)',
                color: s.kindMask[k] ? 'var(--studio-accent, #1de9b6)' : 'inherit',
                borderColor: s.kindMask[k] ? 'var(--studio-accent, #1de9b6)' : 'rgba(154,166,178,0.35)',
              }}
            >{k}</button>
          ))}
        </div>
      </Section>

      {/* Orientation */}
      <Section title="Transform orientation">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 10px 6px' }}>
          {ORIENT_KINDS.map((k) => (
            <label
              key={k}
              data-studio-v3-snap2-orient={k}
              style={{
                ...chip(),
                cursor: 'pointer',
                background: orient.kind === k
                  ? 'rgba(29,233,182,0.22)' : 'rgba(154,166,178,0.10)',
                color: orient.kind === k ? 'var(--studio-accent, #1de9b6)' : 'inherit',
                borderColor: orient.kind === k ? 'var(--studio-accent, #1de9b6)' : 'rgba(154,166,178,0.35)',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              <input
                type="radio"
                name="studio-v3-snap2-orient"
                checked={orient.kind === k}
                onChange={() => { setOrient(k); tick(); }}
                style={{ accentColor: 'var(--studio-accent, #1de9b6)', margin: 0, width: 11, height: 11 }}
              />
              {k}
            </label>
          ))}
        </div>
        {orient.kind === 'custom' && (
          <div style={{ display: 'flex', gap: 4, padding: '2px 10px 8px', alignItems: 'center' }}>
            <span style={lbl()}>Axis</span>
            {['x', 'y', 'z'].map((label, i) => (
              <input
                key={label}
                data-studio-v3-snap2-custom-axis={label}
                type="number" step={0.1}
                value={ax[i]}
                onChange={(e) => {
                  const next = ax.slice();
                  next[i] = +e.target.value;
                  setCustomAxes(next);
                  tick();
                }}
                style={{ ...inp(), width: 48 }}
              />
            ))}
          </div>
        )}
      </Section>

      {/* Pivot */}
      <Section title="Pivot point">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 10px 10px' }}>
          {PIVOT_KINDS.map((k) => (
            <label
              key={k}
              data-studio-v3-snap2-pivot={k}
              style={{
                ...chip(),
                cursor: 'pointer',
                background: pivot.kind === k
                  ? 'rgba(29,233,182,0.22)' : 'rgba(154,166,178,0.10)',
                color: pivot.kind === k ? 'var(--studio-accent, #1de9b6)' : 'inherit',
                borderColor: pivot.kind === k ? 'var(--studio-accent, #1de9b6)' : 'rgba(154,166,178,0.35)',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              <input
                type="radio"
                name="studio-v3-snap2-pivot"
                checked={pivot.kind === k}
                onChange={() => { setPivot(k); tick(); }}
                style={{ accentColor: 'var(--studio-accent, #1de9b6)', margin: 0, width: 11, height: 11 }}
              />
              {PIVOT_LABEL[k]}
            </label>
          ))}
        </div>
      </Section>

      {/* Status footer */}
      <div
        data-studio-v3-snap2-status
        style={{
          padding: '6px 12px',
          fontSize: 10, opacity: 0.55,
          fontFamily: 'var(--studio-mono, ui-monospace)',
          borderTop: '1px solid rgba(154,166,178,0.18)',
        }}
      >
        {s.dragging ? `drag · ${s.attachedUuid ? s.attachedUuid.slice(0, 6) : '—'}` : 'idle'}
        {s.lastSnap ? ` · ${s.lastSnap.distance.toFixed(4)}m` : ''}
      </div>
    </div>
  );
}

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
function lbl() {
  return { fontSize: 10, opacity: 0.6, minWidth: 40 };
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
    fontFamily: 'var(--studio-mono, ui-monospace)',
  };
}
function chip() {
  return {
    fontSize: 10,
    padding: '2px 8px',
    borderRadius: 11,
    border: '1px solid rgba(154,166,178,0.35)',
    background: 'rgba(154,166,178,0.10)',
    color: 'inherit',
    cursor: 'pointer',
    textTransform: 'capitalize',
  };
}
