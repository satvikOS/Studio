// ArchDisc Studio V3 — Mari side panel.
//
// Renders:
//   • channel toggles (eye + colour swatch) for diffuse, roughness,
//     metallic, normal, height, emissive,
//   • UDIM tile preview grid for whichever UDIMs the active mesh has
//     touched (per active channel),
//   • "Apply to material" button that runs compositeAndApply().
//
// Mounted as a floating right-side panel via the shared body-attached
// host so StudioShellV3.jsx stays untouched.

import React, { useEffect, useState } from 'react';

const PANEL_W = 332;

function _meshLabel(mesh) {
  if (!mesh) return 'no selection';
  const k = mesh.userData && mesh.userData.archdiscStudioPrimitiveKind;
  return k ? `${k} · ${mesh.uuid.slice(0, 6)}` : `mesh · ${mesh.uuid.slice(0, 6)}`;
}

export default function MariPanel({
  getSelectedMesh,
  listChannels,
  listUDIMs,
  getChannelTextureDataUrl,
  onSetChannelEnabled,
  onSetChannelColor,
  onCompositeAndApply,
  onClearTile,
  onPaintSampleStroke,
  onCloseRequest,
}) {
  const [, force] = useState(0);
  const tick = () => force((v) => v + 1);
  const [activeChannel, setActiveChannel] = useState('diffuse');

  // Cheap polling so the panel reacts to programmatic ops without
  // wiring an event bus through every module.
  useEffect(() => {
    const id = setInterval(tick, 600);
    return () => clearInterval(id);
  }, []);

  const mesh = getSelectedMesh();
  const channels = listChannels ? listChannels() : [];
  const udims = listUDIMs ? listUDIMs() : { count: 0, udims: [] };

  return (
    <div
      data-studio-v3-mari-panel
      style={{
        position: 'fixed',
        top: 70, right: 14,
        width: PANEL_W,
        maxHeight: 'calc(100vh - 100px)',
        zIndex: 9310,
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
        borderBottom: '1px solid rgba(255,165,0,0.55)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <strong style={{ color: '#ffa500', fontSize: 12, letterSpacing: '0.05em' }}>
          Mari · UDIM
        </strong>
        <span style={{ opacity: 0.55, fontSize: 10, fontFamily: 'var(--studio-mono, ui-monospace)' }}>
          {_meshLabel(mesh)} · {udims.count} {udims.count === 1 ? 'tile' : 'tiles'}
        </span>
        <div style={{ flex: 1 }} />
        <button
          data-studio-v3-mari-close
          onClick={() => onCloseRequest && onCloseRequest()}
          style={{
            background: 'transparent', color: 'inherit',
            border: '1px solid rgba(154,166,178,0.35)',
            padding: '2px 6px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
          }}
        >×</button>
      </div>

      <div style={{
        padding: '8px 10px',
        borderBottom: '1px solid rgba(154,166,178,0.2)',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <div style={{ fontSize: 10, opacity: 0.55, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Channels
        </div>
        {channels.map((c) => (
          <div
            key={c.name}
            data-studio-v3-mari-channel={c.name}
            data-studio-v3-mari-channel-enabled={c.enabled ? '1' : '0'}
            onClick={() => { setActiveChannel(c.name); tick(); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
              padding: '4px 6px', borderRadius: 3, cursor: 'pointer',
              background: activeChannel === c.name ? 'rgba(255,165,0,0.12)' : 'transparent',
            }}
          >
            <button
              data-studio-v3-mari-eye={c.name}
              onClick={(e) => { e.stopPropagation(); onSetChannelEnabled(c.name, !c.enabled); tick(); }}
              title={c.enabled ? 'Disarm channel' : 'Arm channel'}
              style={iconBtn()}
            >{c.enabled ? '◉' : '○'}</button>
            <span style={{ width: 70, color: c.enabled ? '#ffa500' : 'inherit', fontWeight: c.enabled ? 600 : 400 }}>
              {c.name}
            </span>
            <input
              type="color"
              data-studio-v3-mari-color={c.name}
              value={c.color}
              onChange={(e) => { onSetChannelColor(c.name, e.target.value); tick(); }}
              style={{ width: 26, height: 18, background: '#0c0c0c', border: '1px solid #2a2a2a', borderRadius: 2, padding: 0 }}
            />
            <span style={{ flex: 1, fontSize: 9, opacity: 0.6, fontFamily: 'var(--studio-mono, ui-monospace)' }}>
              {c.matSlot}
            </span>
            <span style={{ fontSize: 9, opacity: 0.55 }}>
              {c.tileCount}
            </span>
          </div>
        ))}
      </div>

      <div style={{
        padding: '8px 10px',
        borderBottom: '1px solid rgba(154,166,178,0.2)',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ fontSize: 10, opacity: 0.55, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            UDIM tiles · {activeChannel}
          </div>
          <div style={{ flex: 1 }} />
          <button
            data-studio-v3-mari-sample-stroke
            onClick={() => { onPaintSampleStroke && onPaintSampleStroke(); tick(); }}
            style={btnStyle()}
            title="Run a sample stroke into every armed channel for visual debug"
          >Sample stroke</button>
        </div>
        {udims.udims.length === 0 ? (
          <div style={{ padding: 8, fontSize: 11, opacity: 0.55 }}>
            No UDIM tiles touched yet. Paint with the brush — tiles
            appear here as soon as a UV outside [0,1) is sampled.
          </div>
        ) : (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6,
          }}>
            {udims.udims.map((u) => {
              const url = getChannelTextureDataUrl ? getChannelTextureDataUrl(activeChannel, u.udim) : null;
              return (
                <div
                  key={u.udim}
                  data-studio-v3-mari-tile={u.udim}
                  style={{
                    background: '#0d1117',
                    border: '1px solid rgba(154,166,178,0.3)',
                    borderRadius: 4,
                    padding: 4,
                    display: 'flex', flexDirection: 'column', gap: 2,
                    alignItems: 'center',
                  }}
                >
                  <div style={{ fontSize: 9, fontFamily: 'var(--studio-mono, ui-monospace)', opacity: 0.7 }}>
                    {u.udim}
                  </div>
                  <div style={{
                    width: '100%', aspectRatio: '1 / 1',
                    backgroundImage: url ? `url(${url})` : 'none',
                    backgroundSize: 'cover',
                    backgroundColor: url ? 'transparent' : '#1f242c',
                    borderRadius: 2,
                  }} />
                  <div style={{ fontSize: 8, opacity: 0.5, fontFamily: 'var(--studio-mono, ui-monospace)' }}>
                    [{u.tileX},{u.tileY}]
                  </div>
                  <button
                    data-studio-v3-mari-clear-tile={u.udim}
                    onClick={() => { onClearTile && onClearTile(u.udim); tick(); }}
                    style={{ ...btnStyle(), padding: '1px 4px', fontSize: 9 }}
                  >clear</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ padding: '8px 10px', display: 'flex', gap: 6 }}>
        <button
          data-studio-v3-mari-apply
          onClick={() => { onCompositeAndApply(); tick(); }}
          style={{
            ...btnStyle(),
            flex: 1,
            background: '#ffa500', color: '#0d1117', fontWeight: 600,
            border: '1px solid #ffa500',
          }}
        >Apply to material</button>
      </div>
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

function iconBtn() {
  return {
    background: 'transparent', color: 'inherit',
    border: 'none', padding: 0, width: 18, height: 18,
    fontSize: 12, cursor: 'pointer', lineHeight: 1,
  };
}
