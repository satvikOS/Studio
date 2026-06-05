// ArchDisc Studio V3 — sim-bake panel.
//
// Floating panel that lists every bakeable sim source in the scene with
// per-row duration / fps inputs and a "Bake" button. Cached bakes
// appear in a second list with a scrubber + play / pause controls so
// the user can preview the cache without re-simulating.
//
// Pure React. Reads / writes through the host's injected callbacks so
// the panel never reaches into module state directly.

import React, { useEffect, useState } from 'react';

const PANEL_W = 540;

function fmtBytes(b) {
  if (!Number.isFinite(b) || b <= 0) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BakePanel(props) {
  const {
    listSources,
    listBakes,
    onBake,
    onScrub,
    onPlay,
    onPause,
    onStop,
    onClearCache,
    onClearAll,
    onCloseRequest,
    getChannelFrame,
    cacheBytes,
  } = props || {};

  const [, force]   = useState(0);
  const tick = () => force((v) => (v + 1) | 0);

  const [duration, setDuration] = useState(2.0);
  const [fps, setFps]           = useState(30);
  const [pending, setPending]   = useState({});  // uuid → 'baking'

  // Re-render every 200 ms so play-head scrubbers track running playback
  // and the source list stays current after add/remove.
  useEffect(() => {
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, []);

  const sources = (typeof listSources === 'function' ? listSources() : []) || [];
  const bakes   = (typeof listBakes   === 'function' ? listBakes()   : []) || [];
  const bytes   = (typeof cacheBytes  === 'function' ? cacheBytes()  : { total: 0, perBake: [] });

  const buttonBase = {
    background: 'transparent', color: 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    padding: '4px 10px', borderRadius: 4,
    fontSize: 11, cursor: 'pointer',
  };
  const rowBase = {
    display: 'flex', alignItems: 'center', gap: 8,
  };

  const doBake = async (uuid) => {
    setPending((p) => ({ ...p, [uuid]: 'baking' }));
    try {
      if (typeof onBake === 'function') {
        await Promise.resolve(onBake(uuid, duration, fps));
      }
    } finally {
      setPending((p) => { const n = { ...p }; delete n[uuid]; return n; });
      tick();
    }
  };

  return (
    <div
      data-studio-v3-simbake-panel
      style={{
        position: 'fixed', right: 18, top: 80, zIndex: 9340,
        width: PANEL_W,
        background: 'var(--studio-bg-elev, #161b22)',
        color: 'var(--studio-ink, #e6edf3)',
        border: '1px solid rgba(154,166,178,0.25)',
        borderTop: '2px solid var(--studio-accent, #1de9b6)',
        borderRadius: 6,
        boxShadow: '0 16px 32px rgba(0,0,0,0.45)',
        fontFamily: 'inherit',
        fontSize: 12,
      }}
    >
      {/* ── Header ── */}
      <div
        data-studio-v3-simbake-header
        style={{
          ...rowBase,
          padding: '8px 10px',
          borderBottom: '1px solid rgba(154,166,178,0.18)',
        }}
      >
        <strong style={{
          color: 'var(--studio-accent, #1de9b6)',
          fontSize: 12, letterSpacing: '0.05em',
        }}>Sim bake</strong>
        <span style={{
          opacity: 0.6, fontSize: 11,
          fontFamily: 'var(--studio-mono, ui-monospace)',
        }}>
          {sources.length} src · {bakes.length} baked · {fmtBytes(bytes.total)}
        </span>
        <div style={{ flex: 1 }} />
        <button
          data-studio-v3-simbake-clearall
          onClick={() => { if (onClearAll) onClearAll(); tick(); }}
          style={buttonBase}
        >Clear all</button>
        <button
          data-studio-v3-simbake-close
          onClick={() => onCloseRequest && onCloseRequest()}
          style={buttonBase}
        >Close</button>
      </div>

      {/* ── Bake controls ── */}
      <div style={{ ...rowBase, padding: '8px 10px', borderBottom: '1px solid rgba(154,166,178,0.18)' }}>
        <label style={{ fontSize: 11, opacity: 0.75 }}>duration</label>
        <input
          data-studio-v3-simbake-duration
          type="number"
          min={0.05} max={120} step={0.1}
          value={duration}
          onChange={(e) => setDuration(Math.max(0.05, Math.min(120, Number(e.target.value) || 0.05)))}
          style={{
            width: 60, padding: '3px 6px', fontSize: 11,
            background: 'rgba(13,17,23,0.7)',
            color: 'inherit',
            border: '1px solid rgba(154,166,178,0.25)',
            borderRadius: 4,
          }}
        />
        <span style={{ fontSize: 11, opacity: 0.55 }}>s</span>
        <label style={{ fontSize: 11, opacity: 0.75, marginLeft: 8 }}>fps</label>
        <input
          data-studio-v3-simbake-fps
          type="number"
          min={1} max={240} step={1}
          value={fps}
          onChange={(e) => setFps(Math.max(1, Math.min(240, Number(e.target.value) || 1)))}
          style={{
            width: 50, padding: '3px 6px', fontSize: 11,
            background: 'rgba(13,17,23,0.7)',
            color: 'inherit',
            border: '1px solid rgba(154,166,178,0.25)',
            borderRadius: 4,
          }}
        />
        <div style={{ flex: 1 }} />
        <span style={{
          fontSize: 10, opacity: 0.55,
          fontFamily: 'var(--studio-mono, ui-monospace)',
        }}>
          ≈ {Math.round(duration * fps)} frames
        </span>
      </div>

      {/* ── Sources list ── */}
      <div
        data-studio-v3-simbake-sources
        style={{
          maxHeight: 140, overflow: 'auto',
          borderBottom: '1px solid rgba(154,166,178,0.18)',
          padding: '4px 0',
        }}
      >
        {sources.length === 0 && (
          <div style={{ padding: '10px 12px', opacity: 0.55, fontSize: 11 }}>
            No bakeable sims found. Spawn a cloth / fluid / soft body /
            particle system / hair, then re-open this panel.
          </div>
        )}
        {sources.map((s) => (
          <div
            data-studio-v3-simbake-source={s.uuid}
            key={s.uuid}
            style={{
              ...rowBase,
              padding: '4px 10px',
            }}
          >
            <span style={{
              minWidth: 60,
              fontSize: 10,
              opacity: 0.65,
              fontFamily: 'var(--studio-mono, ui-monospace)',
              textTransform: 'uppercase',
            }}>{s.kind}</span>
            <span style={{
              flex: 1, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontSize: 11,
            }}>{s.name}</span>
            <span style={{
              opacity: 0.55, fontSize: 10,
              fontFamily: 'var(--studio-mono, ui-monospace)',
            }}>{s.vertCount} v</span>
            <button
              data-studio-v3-simbake-do={s.uuid}
              onClick={() => doBake(s.uuid)}
              disabled={!!pending[s.uuid]}
              style={{ ...buttonBase, opacity: pending[s.uuid] ? 0.5 : 1 }}
            >{pending[s.uuid] ? 'Baking…' : 'Bake'}</button>
          </div>
        ))}
      </div>

      {/* ── Cached bakes ── */}
      <div
        data-studio-v3-simbake-bakes
        style={{
          maxHeight: 220, overflow: 'auto',
          padding: '4px 0',
        }}
      >
        {bakes.length === 0 && (
          <div style={{ padding: '10px 12px', opacity: 0.55, fontSize: 11 }}>
            No bakes cached yet.
          </div>
        )}
        {bakes.map((b) => {
          const liveFrame = (typeof getChannelFrame === 'function')
            ? getChannelFrame(b.uuid) : -1;
          const cur = liveFrame >= 0 ? liveFrame : 0;
          return (
            <div
              data-studio-v3-simbake-bake={b.uuid}
              key={b.uuid}
              style={{
                padding: '4px 10px',
                borderBottom: '1px dashed rgba(154,166,178,0.10)',
              }}
            >
              <div style={{ ...rowBase, marginBottom: 4 }}>
                <span style={{
                  minWidth: 60,
                  fontSize: 10,
                  opacity: 0.65,
                  fontFamily: 'var(--studio-mono, ui-monospace)',
                  textTransform: 'uppercase',
                }}>{b.kind}</span>
                <span style={{
                  flex: 1, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontSize: 11,
                }}>{b.name}</span>
                <span style={{
                  opacity: 0.55, fontSize: 10,
                  fontFamily: 'var(--studio-mono, ui-monospace)',
                }}>
                  {b.frames}f@{b.fps} · {fmtBytes(b.bytes)}
                </span>
                <button
                  data-studio-v3-simbake-play={b.uuid}
                  onClick={() => { if (onPlay) onPlay(b.uuid); tick(); }}
                  style={buttonBase}
                >Play</button>
                <button
                  data-studio-v3-simbake-pause={b.uuid}
                  onClick={() => { if (onPause) onPause(b.uuid); tick(); }}
                  style={buttonBase}
                >Pause</button>
                <button
                  data-studio-v3-simbake-stop={b.uuid}
                  onClick={() => { if (onStop) onStop(b.uuid); tick(); }}
                  style={buttonBase}
                >Stop</button>
                <button
                  data-studio-v3-simbake-clear={b.uuid}
                  onClick={() => { if (onClearCache) onClearCache(b.uuid); tick(); }}
                  style={{ ...buttonBase, padding: '2px 6px' }}
                >×</button>
              </div>
              <input
                data-studio-v3-simbake-scrub={b.uuid}
                type="range"
                min={0}
                max={Math.max(0, b.frames - 1)}
                step={1}
                value={cur}
                onChange={(e) => { if (onScrub) onScrub(b.uuid, Number(e.target.value)); tick(); }}
                style={{ width: '100%' }}
              />
              <div style={{
                ...rowBase,
                fontSize: 10, opacity: 0.55,
                fontFamily: 'var(--studio-mono, ui-monospace)',
              }}>
                <span>frame {cur} / {b.frames - 1}</span>
                <div style={{ flex: 1 }} />
                <span>{b.durationSec.toFixed(2)}s</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
