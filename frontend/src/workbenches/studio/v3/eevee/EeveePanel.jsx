// ArchDisc Studio V3 — EEVEE viewport-pass side panel.
//
// Floating right-side panel: toggles for SSGI + SSR, slider for SSGI
// intensity, slider for SSR max distance, and a "Reset to defaults"
// button. Polls renderer.getState() every 400 ms so it stays in sync
// with op calls coming in from the agent / cmd palette.
//
// Style language matches snap2/SnapPanel.jsx — dark surface, accent green
// strokes, monospace tabular numerics. Mounted into a body-attached host
// from index.js so we never touch StudioShellV3.jsx.

import React, { useEffect, useState } from 'react';

const PANEL_W = 268;

export default function EeveePanel({
  getState,
  toggleSSGI,
  toggleSSR,
  setIntensity,
  setSSRMaxDistance,
  resetDefaults,
  onCloseRequest,
}) {
  const [, force] = useState(0);
  const tick = () => force((v) => v + 1);

  useEffect(() => {
    const id = setInterval(tick, 400);
    return () => clearInterval(id);
  }, []);

  const s = getState() || {};
  const ssgiOn = !!s.ssgi;
  const ssrOn  = !!s.ssr;
  const intensity   = typeof s.intensity   === 'number' ? s.intensity   : 1.0;
  const ssrDistance = typeof s.ssrDistance === 'number' ? s.ssrDistance : 0.5;

  return (
    <div
      data-studio-v3-eevee-panel
      style={{
        position: 'fixed',
        top: 70, right: 14,
        width: PANEL_W,
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
          EEVEE viewport
        </strong>
        <div style={{ flex: 1 }} />
        <button
          data-studio-v3-eevee-close
          onClick={() => onCloseRequest && onCloseRequest()}
          style={btn()}
        >×</button>
      </div>

      {/* SSGI */}
      <Section title="Screen-space GI">
        <label style={row()}>
          <input
            data-studio-v3-eevee-ssgi-toggle
            type="checkbox"
            checked={ssgiOn}
            onChange={async () => { await toggleSSGI(); tick(); }}
            style={{ accentColor: 'var(--studio-accent, #1de9b6)' }}
          />
          <span style={{ flex: 1, fontSize: 11 }}>SSGI</span>
          <span
            data-studio-v3-eevee-ssgi-state
            style={chipBadge(ssgiOn)}
          >{ssgiOn ? 'on' : 'off'}</span>
        </label>
        <div style={row()}>
          <span style={lbl()}>Intensity</span>
          <input
            data-studio-v3-eevee-intensity
            type="range"
            min={0} max={2} step={0.05}
            value={intensity}
            onChange={(e) => { setIntensity(+e.target.value); tick(); }}
            style={{ flex: 1, accentColor: 'var(--studio-accent, #1de9b6)' }}
          />
          <span style={num()}>{intensity.toFixed(2)}</span>
        </div>
      </Section>

      {/* SSR */}
      <Section title="Screen-space reflections">
        <label style={row()}>
          <input
            data-studio-v3-eevee-ssr-toggle
            type="checkbox"
            checked={ssrOn}
            onChange={async () => { await toggleSSR(); tick(); }}
            style={{ accentColor: 'var(--studio-accent, #1de9b6)' }}
          />
          <span style={{ flex: 1, fontSize: 11 }}>SSR</span>
          <span
            data-studio-v3-eevee-ssr-state
            style={chipBadge(ssrOn)}
          >{ssrOn ? 'on' : 'off'}</span>
        </label>
        <div style={row()}>
          <span style={lbl()}>Max dist</span>
          <input
            data-studio-v3-eevee-ssr-dist
            type="range"
            min={0.05} max={2.0} step={0.01}
            value={ssrDistance}
            onChange={(e) => { setSSRMaxDistance(+e.target.value); tick(); }}
            style={{ flex: 1, accentColor: 'var(--studio-accent, #1de9b6)' }}
          />
          <span style={num()}>{ssrDistance.toFixed(2)}</span>
        </div>
      </Section>

      {/* Footer / actions */}
      <div style={{
        padding: '8px 12px',
        display: 'flex', alignItems: 'center', gap: 6,
        borderTop: '1px solid rgba(154,166,178,0.18)',
      }}>
        <button
          data-studio-v3-eevee-reset
          onClick={() => { resetDefaults(); tick(); }}
          style={btn()}
        >Reset to defaults</button>
        <div style={{ flex: 1 }} />
        <span
          data-studio-v3-eevee-passcount
          style={{
            fontSize: 9, opacity: 0.55,
            fontFamily: 'var(--studio-mono, ui-monospace)',
          }}
        >{(s.composerPassCount || 0)} passes</span>
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
  return { fontSize: 10, opacity: 0.6, minWidth: 56 };
}
function num() {
  return {
    fontSize: 10, opacity: 0.85,
    fontFamily: 'var(--studio-mono, ui-monospace)',
    minWidth: 36, textAlign: 'right',
  };
}
function btn() {
  return {
    background: 'transparent', color: 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    padding: '3px 8px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
  };
}
function chipBadge(on) {
  return {
    fontSize: 9, fontFamily: 'var(--studio-mono, ui-monospace)',
    padding: '1px 6px', borderRadius: 3,
    background: on ? 'rgba(29,233,182,0.18)' : 'rgba(154,166,178,0.12)',
    color: on ? 'var(--studio-accent, #1de9b6)' : 'inherit',
    opacity: on ? 1 : 0.55,
  };
}
