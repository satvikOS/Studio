// ArchDisc Studio V3 — minimal Blender-style NLA editor side panel.
//
// Renders an ordered stack of strips with:
//   • A vertical list of tracks (one per (mesh, property) pair)
//   • Each track is a horizontal timeline ribbon with a draggable
//     block per strip (rect from startTime → endTime, scaled to the
//     visible timeline window)
//   • Click a block to focus it; the table below lets the user retune
//     start / end / blend.
//
// Mounted into a body-attached <div> via React.createRoot from the
// installer in index.js. The host passes:
//   • getStrips()      → current strip list
//   • getDrivers()     → current driver list (for sidebar context)
//   • onStripUpdate(uuid, patch)
//   • onStripDelete(uuid)
//   • onClose()
//
// Pure React + SVG. No npm deps.

import React, { useRef, useState } from 'react';

const VB_W = 940;
const VB_H = 520;
const HEADER_H = 70;
const TRACK_H = 36;
const TRACK_PAD = 8;
const SIDEBAR_W = 240;

function pickTimelineWindow(strips) {
  let hi = 4;
  for (const s of strips) if (s.endTime > hi) hi = s.endTime + 1;
  return { t0: 0, t1: hi };
}

function colorForBlend(blend) {
  if (blend === 'add') return '#7be38c';
  if (blend === 'mul') return '#ffd13d';
  return '#1de9b6';
}

export default function NLAEditor(props) {
  const {
    getStrips, getDrivers,
    onStripUpdate, onStripDelete,
    onClose,
  } = props;

  const [, force] = useState(0);
  const tick = () => force((v) => v + 1);
  const dragRef = useRef(null);

  const strips = getStrips ? getStrips() : [];
  const drivers = getDrivers ? getDrivers() : [];

  // Group strips into tracks keyed by (mesh, property).
  const trackKeys = [];
  const trackMap = new Map();
  for (const s of strips) {
    const key = `${s.targetMeshUuid}|${s.property}`;
    if (!trackMap.has(key)) {
      trackMap.set(key, { key, meshUuid: s.targetMeshUuid, property: s.property, strips: [] });
      trackKeys.push(key);
    }
    trackMap.get(key).strips.push(s);
  }
  const tracks = trackKeys.map((k) => trackMap.get(k));

  const win = pickTimelineWindow(strips);
  const plotX = SIDEBAR_W + 12;
  const plotW = VB_W - plotX - 12;
  const plotY = HEADER_H + 8;

  const tToX = (t) => plotX + ((t - win.t0) / Math.max(1e-6, win.t1 - win.t0)) * plotW;
  const xToT = (x) => win.t0 + ((x - plotX) / plotW) * (win.t1 - win.t0);

  const onMouseMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const svg = document.querySelector('[data-studio-v3-animadv-nla-svg]');
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const local = pt.matrixTransform(ctm.inverse());
    const t = xToT(local.x);
    if (d.kind === 'move') {
      const dt = t - d.anchorT;
      const newStart = Math.max(0, d.origStart + dt);
      const newEnd = Math.max(newStart + 0.05, d.origEnd + dt);
      onStripUpdate(d.uuid, { startTime: newStart, endTime: newEnd });
    } else if (d.kind === 'resize-l') {
      const newStart = Math.max(0, Math.min(d.origEnd - 0.05, t));
      onStripUpdate(d.uuid, { startTime: newStart });
    } else if (d.kind === 'resize-r') {
      const newEnd = Math.max(d.origStart + 0.05, t);
      onStripUpdate(d.uuid, { endTime: newEnd });
    }
    tick();
  };
  const onMouseUp = () => { dragRef.current = null; };

  // ─── UI ────────────────────────────────────────────────────────────
  const buttonBase = {
    background: 'transparent', color: 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    padding: '4px 8px', borderRadius: 4,
    fontSize: 11, cursor: 'pointer',
  };

  return (
    <div
      data-studio-v3-animadv-nla-editor
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      style={{
        position: 'fixed', inset: 0, zIndex: 9325,
        background: 'rgba(13,17,23,0.78)',
        color: 'var(--studio-ink, #e6edf3)',
        fontFamily: 'inherit',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 16px',
        background: 'var(--studio-bg-elev, #161b22)',
        borderBottom: '1px solid var(--studio-accent, #1de9b6)',
      }}>
        <strong style={{
          color: 'var(--studio-accent, #1de9b6)',
          fontSize: 13, letterSpacing: '0.04em',
        }}>
          NLA — Non-Linear Animation
        </strong>
        <span
          data-studio-v3-animadv-nla-stats
          style={{
            opacity: 0.55, fontSize: 11,
            fontFamily: 'var(--studio-mono, ui-monospace)',
          }}
        >
          {strips.length} strips · {tracks.length} tracks · {drivers.length} drivers
        </span>
        <div style={{ flex: 1 }} />
        <button
          data-studio-v3-animadv-nla-close
          onClick={() => onClose && onClose()}
          style={buttonBase}
        >Close (Esc)</button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Sidebar list */}
        <div
          data-studio-v3-animadv-nla-list
          style={{
            width: SIDEBAR_W, padding: '10px 12px',
            borderRight: '1px solid rgba(154,166,178,0.3)',
            background: 'var(--studio-bg-elev, #161b22)',
            overflowY: 'auto', fontSize: 11,
          }}
        >
          <div style={{
            color: 'var(--studio-accent, #1de9b6)',
            fontSize: 11, fontWeight: 600,
            letterSpacing: '0.04em', marginBottom: 8,
          }}>Strips</div>
          {!strips.length && (
            <div style={{ opacity: 0.55 }}>
              No strips. Add via <code>__studioAnimAdvNLAStripAdd</code>.
            </div>
          )}
          {strips.map((s) => (
            <div
              key={s.uuid}
              data-studio-v3-animadv-nla-row={s.uuid}
              style={{
                padding: '6px 7px', marginBottom: 4,
                borderRadius: 4,
                border: '1px solid rgba(154,166,178,0.25)',
                background: 'rgba(13,17,23,0.55)',
              }}
            >
              <div style={{ fontWeight: 600 }}>
                {s.property}
              </div>
              <div style={{
                opacity: 0.55, fontSize: 10,
                fontFamily: 'var(--studio-mono, ui-monospace)',
              }}>
                {s.startTime.toFixed(2)}s → {s.endTime.toFixed(2)}s · {s.duration.toFixed(2)}s · {s.blend}
              </div>
              <div style={{ marginTop: 4, display: 'flex', gap: 4 }}>
                <select
                  data-studio-v3-animadv-nla-blend={s.uuid}
                  value={s.blend}
                  onChange={(e) => { onStripUpdate(s.uuid, { blend: e.target.value }); tick(); }}
                  style={{
                    ...buttonBase, flex: 1,
                    background: 'rgba(13,17,23,0.6)', cursor: 'default',
                  }}
                >
                  <option value="replace">replace</option>
                  <option value="add">add</option>
                  <option value="mul">mul</option>
                </select>
                <button
                  data-studio-v3-animadv-nla-delete={s.uuid}
                  onClick={() => { onStripDelete(s.uuid); tick(); }}
                  style={buttonBase}
                >×</button>
              </div>
            </div>
          ))}
        </div>

        {/* Timeline */}
        <svg
          data-studio-v3-animadv-nla-svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          style={{ flex: 1, background: 'rgba(13,17,23,0.4)' }}
        >
          {/* time-axis gridlines */}
          {(() => {
            const ticks = [];
            const span = win.t1 - win.t0;
            const step = span >= 20 ? 5 : (span >= 10 ? 2 : 1);
            for (let t = Math.ceil(win.t0); t <= win.t1; t += step) {
              const x = tToX(t);
              ticks.push(
                <g key={`tg-${t}`}>
                  <line x1={x} y1={plotY - 6} x2={x} y2={VB_H - 12}
                    stroke="rgba(154,166,178,0.15)" strokeWidth="0.5" />
                  <text x={x} y={plotY - 10} textAnchor="middle"
                    fontSize="9" fill="rgba(230,237,243,0.55)">{t}s</text>
                </g>
              );
            }
            return ticks;
          })()}

          {/* tracks */}
          {tracks.map((tr, i) => {
            const y = plotY + i * (TRACK_H + TRACK_PAD);
            return (
              <g key={tr.key} data-studio-v3-animadv-nla-track={tr.key}>
                <rect x={plotX} y={y} width={plotW} height={TRACK_H}
                  fill="rgba(13,17,23,0.55)" stroke="rgba(154,166,178,0.2)" strokeWidth="0.5" />
                <text x={plotX - 10} y={y + TRACK_H / 2 + 3}
                  textAnchor="end" fontSize="10" fill="rgba(230,237,243,0.65)">
                  {tr.property}
                </text>
                {tr.strips.map((s) => {
                  const sx = tToX(s.startTime);
                  const ex = tToX(s.endTime);
                  const w = Math.max(8, ex - sx);
                  const col = colorForBlend(s.blend);
                  return (
                    <g key={s.uuid}>
                      <rect
                        data-studio-v3-animadv-nla-block={s.uuid}
                        x={sx} y={y + 2} width={w} height={TRACK_H - 4}
                        fill={`${col}28`}
                        stroke={col} strokeWidth="1.4"
                        rx="3"
                        style={{ cursor: 'move' }}
                        onMouseDown={(e) => {
                          e.preventDefault(); e.stopPropagation();
                          const svg = e.currentTarget.ownerSVGElement;
                          const pt = svg.createSVGPoint();
                          pt.x = e.clientX; pt.y = e.clientY;
                          const ctm = svg.getScreenCTM();
                          const local = pt.matrixTransform(ctm.inverse());
                          dragRef.current = {
                            kind: 'move',
                            uuid: s.uuid,
                            anchorT: xToT(local.x),
                            origStart: s.startTime,
                            origEnd: s.endTime,
                          };
                        }}
                      />
                      {/* left resize handle */}
                      <rect
                        data-studio-v3-animadv-nla-resize-l={s.uuid}
                        x={sx} y={y + 2} width={4} height={TRACK_H - 4}
                        fill={col}
                        style={{ cursor: 'ew-resize' }}
                        onMouseDown={(e) => {
                          e.preventDefault(); e.stopPropagation();
                          dragRef.current = {
                            kind: 'resize-l',
                            uuid: s.uuid,
                            origStart: s.startTime,
                            origEnd: s.endTime,
                          };
                        }}
                      />
                      {/* right resize handle */}
                      <rect
                        data-studio-v3-animadv-nla-resize-r={s.uuid}
                        x={ex - 4} y={y + 2} width={4} height={TRACK_H - 4}
                        fill={col}
                        style={{ cursor: 'ew-resize' }}
                        onMouseDown={(e) => {
                          e.preventDefault(); e.stopPropagation();
                          dragRef.current = {
                            kind: 'resize-r',
                            uuid: s.uuid,
                            origStart: s.startTime,
                            origEnd: s.endTime,
                          };
                        }}
                      />
                      <text x={sx + 6} y={y + TRACK_H / 2 + 3}
                        fontSize="10" fill="#0d1117" style={{ pointerEvents: 'none' }}>
                        {s.blend}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* Drivers list (bottom band) */}
          {drivers.length > 0 && (
            <g>
              <text x={plotX} y={VB_H - 50}
                fontSize="10" fill="rgba(230,237,243,0.55)">
                Drivers ({drivers.length})
              </text>
              {drivers.slice(0, 4).map((d, i) => (
                <text
                  key={d.uuid}
                  data-studio-v3-animadv-driver-row={d.uuid}
                  x={plotX} y={VB_H - 34 + i * 10}
                  fontSize="9"
                  fontFamily="var(--studio-mono, ui-monospace)"
                  fill="rgba(230,237,243,0.45)"
                >
                  {d.targetProperty} = {d.expression}  ({d.enabled ? 'on' : 'off'})
                </text>
              ))}
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
