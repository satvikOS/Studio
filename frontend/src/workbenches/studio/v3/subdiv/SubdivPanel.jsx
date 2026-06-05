// ArchDisc Studio V3 — Subdivision-Surface side panel.
//
// Right-edge side panel (Blender N-panel style) for the Plasticity-
// style subdiv toolkit. Mounted body-attached by index.js so we never
// touch StudioShellV3.jsx. Pure React, no npm deps.
//
// Sections:
//   • Subdiv (Wrap / Unwrap / level slider / Apply / Show cage)
//   • Creases (list of edge keys + per-row weight + Remove)
//   • Status footer with cage / smooth vert counts.

import React, { useEffect, useState } from 'react';

const PANEL_W = 280;

export default function SubdivPanel({
  getSelectedMesh,
  getStatus,
  onWrap,
  onUnwrap,
  onSetLevel,
  onApply,
  onShowCage,
  listCreases,
  setEdgeCrease,
  removeCrease,
  clearCreases,
  onCloseRequest,
}) {
  const [, force] = useState(0);
  const tick = () => force((v) => v + 1);
  useEffect(() => {
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, []);

  const mesh = getSelectedMesh();
  const status = getStatus();
  const wrapped = status && status.wrapped;
  const creases = listCreases() || { count: 0, creases: [] };

  return (
    <div
      data-studio-v3-subdiv-panel
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
      <div
        style={{
          padding: '8px 12px',
          background: 'rgba(13,17,23,0.6)',
          borderBottom: '1px solid rgba(29,233,182,0.45)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <strong
          style={{
            color: 'var(--studio-accent, #1de9b6)',
            fontSize: 12,
            letterSpacing: '0.05em',
          }}
        >
          Subdivision Surface
        </strong>
        <div style={{ flex: 1 }} />
        <button
          data-studio-v3-subdiv-close
          onClick={() => onCloseRequest && onCloseRequest()}
          style={btn()}
        >
          ×
        </button>
      </div>

      {/* Selection summary */}
      <div
        data-studio-v3-subdiv-target
        style={{
          padding: '5px 12px',
          fontSize: 10,
          opacity: 0.65,
          fontFamily: 'var(--studio-mono, ui-monospace)',
          borderBottom: '1px solid rgba(154,166,178,0.18)',
        }}
      >
        {mesh ? `mesh · ${mesh.uuid.slice(0, 6)}` : 'no selection'}
      </div>

      {/* Wrap controls */}
      <Section title="Subdivide">
        <div style={row()}>
          <button
            data-studio-v3-subdiv-wrap
            disabled={!mesh}
            onClick={() => {
              onWrap(status && status.levels ? status.levels : 2);
              tick();
            }}
            style={{ ...btnPrimary(), opacity: mesh ? 1 : 0.4 }}
          >
            {wrapped ? 'Re-wrap' : 'Wrap'}
          </button>
          <button
            data-studio-v3-subdiv-unwrap
            disabled={!wrapped}
            onClick={() => { onUnwrap(); tick(); }}
            style={{ ...btn(), opacity: wrapped ? 1 : 0.4 }}
          >
            Unwrap
          </button>
        </div>
        <div style={row()}>
          <span style={lbl()}>Level</span>
          <input
            data-studio-v3-subdiv-level
            type="range"
            min={0}
            max={4}
            step={1}
            value={status && Number.isFinite(status.levels) ? status.levels : 2}
            onChange={(e) => { onSetLevel(+e.target.value); tick(); }}
            disabled={!wrapped}
            style={{ flex: 1, accentColor: 'var(--studio-accent, #1de9b6)' }}
          />
          <span
            data-studio-v3-subdiv-level-value
            style={{
              minWidth: 18,
              textAlign: 'right',
              fontFamily: 'var(--studio-mono, ui-monospace)',
              fontSize: 11,
            }}
          >
            {status && Number.isFinite(status.levels) ? status.levels : 2}
          </span>
        </div>
        <div style={row()}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, flex: 1 }}>
            <input
              data-studio-v3-subdiv-show-cage
              type="checkbox"
              checked={!!(status && status.cageShown)}
              onChange={(e) => { onShowCage(e.target.checked); tick(); }}
              disabled={!wrapped}
              style={{ accentColor: 'var(--studio-accent, #1de9b6)' }}
            />
            Show cage
          </label>
          <button
            data-studio-v3-subdiv-apply
            disabled={!wrapped}
            onClick={() => { onApply(); tick(); }}
            style={{ ...btn(), opacity: wrapped ? 1 : 0.4 }}
          >
            Apply
          </button>
        </div>
      </Section>

      {/* Creases */}
      <Section title={`Creases (${creases.count})`}>
        <div
          data-studio-v3-subdiv-crease-list
          style={{
            maxHeight: 160,
            overflowY: 'auto',
            padding: '2px 8px 6px',
          }}
        >
          {creases.count === 0 && (
            <div style={{ fontSize: 10, opacity: 0.55, padding: '4px 4px 6px' }}>
              No creases set. Use{' '}
              <code style={mono()}>__studioSubdivSetEdgeCrease(uuid,i,j,w)</code>.
            </div>
          )}
          {(creases.creases || []).map((cr) => (
            <div
              key={cr.key}
              data-studio-v3-subdiv-crease-row={cr.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 0',
                borderTop: '1px dashed rgba(154,166,178,0.10)',
              }}
            >
              <span
                style={{
                  ...mono(),
                  fontSize: 10,
                  flex: 1,
                  opacity: 0.85,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {cr.i}↔{cr.j}
              </span>
              <input
                data-studio-v3-subdiv-crease-weight={cr.key}
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={cr.weight}
                onChange={(e) => {
                  setEdgeCrease(cr.i, cr.j, +e.target.value);
                  tick();
                }}
                style={{ ...inp(), width: 56 }}
              />
              <button
                data-studio-v3-subdiv-crease-remove={cr.key}
                onClick={() => { removeCrease(cr.i, cr.j); tick(); }}
                style={{ ...btn(), padding: '1px 6px', fontSize: 10 }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {creases.count > 0 && (
          <div style={{ padding: '0 10px 8px' }}>
            <button
              data-studio-v3-subdiv-crease-clear
              onClick={() => { clearCreases(); tick(); }}
              style={btn()}
            >
              Clear all
            </button>
          </div>
        )}
      </Section>

      {/* Status footer */}
      <div
        data-studio-v3-subdiv-status
        style={{
          padding: '6px 12px',
          fontSize: 10,
          opacity: 0.55,
          fontFamily: 'var(--studio-mono, ui-monospace)',
          borderTop: '1px solid rgba(154,166,178,0.18)',
        }}
      >
        {wrapped
          ? `cage ${status.cageVerts} · smooth ${status.smoothVerts} · lvl ${status.levels}`
          : 'not wrapped'}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ borderBottom: '1px solid rgba(154,166,178,0.18)' }}>
      <div
        style={{
          padding: '6px 12px 2px',
          fontSize: 9,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          opacity: 0.6,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function row() {
  return { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px' };
}
function lbl() {
  return { fontSize: 10, opacity: 0.6, minWidth: 36 };
}
function btn() {
  return {
    background: 'transparent',
    color: 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    padding: '3px 8px',
    borderRadius: 3,
    fontSize: 11,
    cursor: 'pointer',
  };
}
function btnPrimary() {
  return {
    ...btn(),
    background: 'rgba(29,233,182,0.22)',
    borderColor: 'var(--studio-accent, #1de9b6)',
    color: 'var(--studio-accent, #1de9b6)',
  };
}
function inp() {
  return {
    background: 'rgba(13,17,23,0.6)',
    color: 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    padding: '2px 4px',
    borderRadius: 3,
    fontSize: 11,
    fontFamily: 'var(--studio-mono, ui-monospace)',
  };
}
function mono() {
  return { fontFamily: 'var(--studio-mono, ui-monospace)' };
}
