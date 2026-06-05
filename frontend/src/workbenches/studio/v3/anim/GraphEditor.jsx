// ArchDisc Studio V3 — Blender-style animation graph editor.
//
// SVG canvas with:
//   • Horizontal axis = time (seconds)
//   • Vertical axis   = value (units depend on the curve's property)
//   • Each key = a draggable dot.
//   • In/out tangent handles = smaller dots tethered to the key by a
//     thin line. Dragging a handle reshapes the bezier.
//   • A timeline cursor strip along the top mirrors the playback time
//     and lets the user scrub.
//
// The editor mounts into a body-attached <div> via React.createRoot so
// we don't need to touch StudioShellV3.jsx. The lifecycle is driven by
// index.js which passes:
//   • getCurves()    → live Map<uuid, curve>
//   • getActiveUuid()
//   • setActiveUuid(uuid)
//   • getTime() / setTime(t)
//   • play() / pause() / isPlaying()
//   • onMutate()                        called after any mutation so
//                                       the host re-syncs viewport
//   • onCloseRequest()
//
// Pure React + SVG + window globals. No npm deps.

import React, { useRef, useState } from 'react';
import { sample } from './curves.js';

const MARGIN_L = 56;
const MARGIN_R = 24;
const MARGIN_T = 70;
const MARGIN_B = 36;
const CURSOR_STRIP_H = 22;
const HANDLE_R = 3.5;
const KEY_R = 5.5;

// ─── Coord helpers ────────────────────────────────────────────────────

function makeProjection(viewBox, domain) {
  const { x, y, w, h } = viewBox;
  const { t0, t1, v0, v1 } = domain;
  const tw = Math.max(1e-6, t1 - t0);
  const vh = Math.max(1e-6, v1 - v0);
  const px = (t) => x + ((t - t0) / tw) * w;
  const py = (v) => y + h - ((v - v0) / vh) * h;
  const inv = (cx, cy) => ({
    t: t0 + ((cx - x) / w) * tw,
    v: v0 + ((y + h - cy) / h) * vh,
  });
  return { px, py, inv, x, y, w, h };
}

function autoDomain(curve, fallbackDur) {
  const dur = Math.max(0.5, fallbackDur || 0,
    curve && curve.keys && curve.keys.length ? curve.keys[curve.keys.length - 1].time : 0);
  let lo = 0, hi = 1;
  if (curve && curve.keys && curve.keys.length) {
    lo = Infinity; hi = -Infinity;
    for (const k of curve.keys) {
      if (k.value < lo) lo = k.value;
      if (k.value > hi) hi = k.value;
    }
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    const pad = 0.2 * (hi - lo);
    lo -= pad; hi += pad;
  }
  return { t0: 0, t1: dur, v0: lo, v1: hi };
}

function buildCurvePath(curve, proj, samples) {
  if (!curve || !curve.keys || curve.keys.length < 1) return '';
  if (curve.keys.length === 1) {
    const k = curve.keys[0];
    const p = { x: proj.px(k.time), y: proj.py(k.value) };
    return `M ${p.x - 6} ${p.y} L ${p.x + 6} ${p.y}`;
  }
  const t0 = curve.keys[0].time;
  const t1 = curve.keys[curve.keys.length - 1].time;
  const n = Math.max(16, samples || 96);
  let d = '';
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    const v = sample(curve, t);
    const x = proj.px(t);
    const y = proj.py(v);
    d += i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d;
}

// ─── Component ────────────────────────────────────────────────────────

export default function GraphEditor(props) {
  const {
    getCurves, getActiveUuid, setActiveUuid,
    getTime, setTime, play, pause, isPlaying,
    onMutate, onCloseRequest,
    addCurveForSelection,
    addKeyAtCursor,
    deleteSelectedKey,
    setInterp,
  } = props;

  const [, force] = useState(0);
  const tick = () => force((v) => v + 1);
  const svgRef = useRef(null);
  const dragRef = useRef(null);   // { kind, idx, which? }
  const [selectedKeyIdx, setSelectedKeyIdx] = useState(-1);

  const curves = getCurves();
  const activeUuid = getActiveUuid();
  const activeCurve = activeUuid ? curves.get(activeUuid) : null;
  const time = getTime();

  // Editor viewport (SVG user coords).
  const VB_W = 940;
  const VB_H = 540;
  const plot = {
    x: MARGIN_L, y: MARGIN_T,
    w: VB_W - MARGIN_L - MARGIN_R,
    h: VB_H - MARGIN_T - MARGIN_B,
  };
  const dur = (() => {
    let d = 1;
    curves.forEach((c) => {
      if (c.keys && c.keys.length) {
        const t = c.keys[c.keys.length - 1].time;
        if (t > d) d = t;
      }
    });
    return d;
  })();
  const domain = autoDomain(activeCurve, dur);
  const proj = makeProjection(plot, domain);

  // ─── Pointer math ──────────────────────────────────────────────────
  function svgCoord(e) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }

  // ─── Drag handlers ─────────────────────────────────────────────────
  const onMouseMove = (e) => {
    const d = dragRef.current;
    if (!d || !activeCurve) return;
    const { x, y } = svgCoord(e);
    if (d.kind === 'cursor') {
      const { t } = proj.inv(x, y);
      const tt = Math.max(0, Math.min(dur, t));
      setTime(tt);
      tick();
      return;
    }
    if (!activeCurve.keys[d.idx]) return;
    const k = activeCurve.keys[d.idx];
    if (d.kind === 'key') {
      const { t, v } = proj.inv(x, y);
      k.time = Math.max(0, t);
      k.value = v;
      // Keep keys ordered; remember the moved key by reference so we
      // can recompute its idx after the sort.
      activeCurve.keys.sort((a, b) => a.time - b.time);
      const newIdx = activeCurve.keys.indexOf(k);
      if (newIdx >= 0) setSelectedKeyIdx(newIdx);
      dragRef.current = { kind: 'key', idx: newIdx };
      if (onMutate) onMutate();
      tick();
      return;
    }
    if (d.kind === 'handle') {
      const { t, v } = proj.inv(x, y);
      const handle = d.which === 'in' ? k.inHandle : k.outHandle;
      handle.x = t - k.time;
      handle.y = v - k.value;
      if (onMutate) onMutate();
      tick();
      return;
    }
  };

  const onMouseUp = () => {
    dragRef.current = null;
  };

  // ─── Drawing ───────────────────────────────────────────────────────
  const gridTicks = (() => {
    const out = [];
    const step = pickStep(domain.t1 - domain.t0, 10);
    for (let t = 0; t <= dur + 1e-6; t += step) {
      out.push({ t, x: proj.px(t) });
    }
    return out;
  })();
  const vTicks = (() => {
    const out = [];
    const step = pickStep(domain.v1 - domain.v0, 6);
    const start = Math.ceil(domain.v0 / step) * step;
    for (let v = start; v <= domain.v1 + 1e-6; v += step) {
      out.push({ v, y: proj.py(v) });
    }
    return out;
  })();
  const cursorX = proj.px(Math.max(0, Math.min(dur, time)));

  const curvesArr = Array.from(curves.values());

  // ─── UI bits ───────────────────────────────────────────────────────
  const buttonBase = {
    background: 'transparent', color: 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    padding: '4px 8px', borderRadius: 4,
    fontSize: 11, cursor: 'pointer',
  };

  return (
    <div
      data-studio-v3-anim-graph-editor
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      style={{
        position: 'fixed', inset: 0, zIndex: 9320,
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
          Animation graph
        </strong>
        <span style={{
          opacity: 0.55, fontSize: 11,
          fontFamily: 'var(--studio-mono, ui-monospace)',
        }}>
          {curves.size} curves · t={time.toFixed(3)}s · dur={dur.toFixed(2)}s
        </span>
        <div style={{ flex: 1 }} />
        <button
          data-studio-v3-anim-play
          onClick={() => { isPlaying() ? pause() : play(); tick(); }}
          style={buttonBase}
        >{isPlaying() ? 'Pause' : 'Play'}</button>
        <button
          data-studio-v3-anim-add-curve
          onClick={() => { addCurveForSelection('position', 1); tick(); }}
          style={buttonBase}
        >+ Curve (sel.position.y)</button>
        <button
          data-studio-v3-anim-add-key
          onClick={() => { addKeyAtCursor(); tick(); }}
          style={buttonBase}
        >+ Key at cursor</button>
        <button
          data-studio-v3-anim-delete-key
          onClick={() => { deleteSelectedKey(selectedKeyIdx); setSelectedKeyIdx(-1); tick(); }}
          style={buttonBase}
        >- Key</button>
        <select
          data-studio-v3-anim-interp
          value={activeCurve && selectedKeyIdx >= 0 && activeCurve.keys[selectedKeyIdx] ? activeCurve.keys[selectedKeyIdx].interp : 'bezier'}
          onChange={(e) => { setInterp(selectedKeyIdx, e.target.value); tick(); }}
          style={{
            ...buttonBase,
            background: 'rgba(13,17,23,0.6)',
            cursor: 'default',
          }}
        >
          <option value="bezier">bezier</option>
          <option value="linear">linear</option>
          <option value="step">step</option>
        </select>
        <button
          data-studio-v3-anim-close
          onClick={() => onCloseRequest && onCloseRequest()}
          style={buttonBase}
        >Close (Esc)</button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Curve list sidebar */}
        <div
          data-studio-v3-anim-curve-list
          style={{
            width: 220, padding: '10px 12px',
            borderRight: '1px solid rgba(154,166,178,0.3)',
            background: 'var(--studio-bg-elev, #161b22)',
            overflowY: 'auto', fontSize: 11,
          }}
        >
          <div style={{
            color: 'var(--studio-accent, #1de9b6)',
            fontSize: 11, fontWeight: 600,
            letterSpacing: '0.04em', marginBottom: 8,
          }}>Curves</div>
          {curvesArr.length === 0 && (
            <div style={{ opacity: 0.55 }}>
              No curves. Select a mesh, then press <strong>+ Curve</strong>.
            </div>
          )}
          {curvesArr.map((c) => (
            <div
              key={c.uuid}
              data-studio-v3-anim-curve-row={c.uuid}
              onClick={() => { setActiveUuid(c.uuid); setSelectedKeyIdx(-1); tick(); }}
              style={{
                padding: '5px 7px', marginBottom: 4, cursor: 'pointer',
                borderRadius: 4,
                background: c.uuid === activeUuid ? 'rgba(29,233,182,0.12)' : 'transparent',
                border: c.uuid === activeUuid
                  ? '1px solid rgba(29,233,182,0.55)'
                  : '1px solid rgba(154,166,178,0.18)',
              }}
            >
              <div style={{ fontWeight: 600 }}>
                {c.property}.{'xyz'[c.channel] || c.channel}
              </div>
              <div style={{ opacity: 0.55, fontSize: 10, fontFamily: 'var(--studio-mono, ui-monospace)' }}>
                {c.keys.length} keys
              </div>
            </div>
          ))}
        </div>

        {/* SVG plot */}
        <svg
          ref={svgRef}
          data-studio-v3-anim-svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          style={{ flex: 1, background: 'rgba(13,17,23,0.4)' }}
        >
          {/* Plot background */}
          <rect
            x={plot.x} y={plot.y} width={plot.w} height={plot.h}
            fill="rgba(13,17,23,0.55)"
            stroke="rgba(154,166,178,0.25)" strokeWidth="0.6"
          />

          {/* Grid */}
          {gridTicks.map((g) => (
            <g key={`gx-${g.t}`}>
              <line
                x1={g.x} y1={plot.y} x2={g.x} y2={plot.y + plot.h}
                stroke="rgba(154,166,178,0.13)" strokeWidth="0.5"
              />
              <text
                x={g.x} y={plot.y + plot.h + 14}
                textAnchor="middle"
                fontSize="9"
                fill="rgba(230,237,243,0.55)"
                style={{ pointerEvents: 'none' }}
              >{g.t.toFixed(2)}s</text>
            </g>
          ))}
          {vTicks.map((vt) => (
            <g key={`gy-${vt.v}`}>
              <line
                x1={plot.x} y1={vt.y} x2={plot.x + plot.w} y2={vt.y}
                stroke="rgba(154,166,178,0.13)" strokeWidth="0.5"
              />
              <text
                x={plot.x - 6} y={vt.y + 3}
                textAnchor="end"
                fontSize="9"
                fill="rgba(230,237,243,0.55)"
                style={{ pointerEvents: 'none' }}
              >{vt.v.toFixed(2)}</text>
            </g>
          ))}

          {/* Other curves (de-emphasized) */}
          {curvesArr.map((c) => {
            if (c === activeCurve) return null;
            return (
              <path
                key={`bg-${c.uuid}`}
                data-studio-v3-anim-curve-bg={c.uuid}
                d={buildCurvePath(c, proj, 64)}
                stroke="rgba(154,166,178,0.35)" strokeWidth="1" fill="none"
              />
            );
          })}

          {/* Active curve */}
          {activeCurve && (
            <>
              <path
                data-studio-v3-anim-curve-fg={activeCurve.uuid}
                d={buildCurvePath(activeCurve, proj, 160)}
                stroke="var(--studio-accent, #1de9b6)"
                strokeWidth="1.6" fill="none"
              />
              {/* Per-key handle lines + tangent dots */}
              {activeCurve.keys.map((k, i) => {
                const px = proj.px(k.time);
                const py = proj.py(k.value);
                const inX = proj.px(k.time + (k.inHandle?.x || 0));
                const inY = proj.py(k.value + (k.inHandle?.y || 0));
                const outX = proj.px(k.time + (k.outHandle?.x || 0));
                const outY = proj.py(k.value + (k.outHandle?.y || 0));
                return (
                  <g key={`k-${i}`}>
                    <line x1={inX} y1={inY} x2={px} y2={py}
                      stroke="rgba(154,166,178,0.55)" strokeWidth="0.7" />
                    <line x1={px} y1={py} x2={outX} y2={outY}
                      stroke="rgba(154,166,178,0.55)" strokeWidth="0.7" />
                    <circle
                      data-studio-v3-anim-key={i}
                      cx={px} cy={py} r={KEY_R}
                      fill={i === selectedKeyIdx ? '#ffd13d' : 'var(--studio-accent, #1de9b6)'}
                      stroke="#0d1117" strokeWidth="1"
                      style={{ cursor: 'grab' }}
                      onMouseDown={(e) => {
                        e.preventDefault(); e.stopPropagation();
                        setSelectedKeyIdx(i);
                        dragRef.current = { kind: 'key', idx: i };
                        tick();
                      }}
                    />
                    <circle
                      data-studio-v3-anim-handle={`in-${i}`}
                      cx={inX} cy={inY} r={HANDLE_R}
                      fill="rgba(13,17,23,0.95)"
                      stroke="rgba(154,166,178,0.85)" strokeWidth="0.9"
                      style={{ cursor: 'grab' }}
                      onMouseDown={(e) => {
                        e.preventDefault(); e.stopPropagation();
                        setSelectedKeyIdx(i);
                        dragRef.current = { kind: 'handle', idx: i, which: 'in' };
                        tick();
                      }}
                    />
                    <circle
                      data-studio-v3-anim-handle={`out-${i}`}
                      cx={outX} cy={outY} r={HANDLE_R}
                      fill="rgba(13,17,23,0.95)"
                      stroke="rgba(154,166,178,0.85)" strokeWidth="0.9"
                      style={{ cursor: 'grab' }}
                      onMouseDown={(e) => {
                        e.preventDefault(); e.stopPropagation();
                        setSelectedKeyIdx(i);
                        dragRef.current = { kind: 'handle', idx: i, which: 'out' };
                        tick();
                      }}
                    />
                  </g>
                );
              })}
            </>
          )}

          {/* Timeline cursor strip (top of plot). Scrub by dragging. */}
          <rect
            data-studio-v3-anim-cursor-strip
            x={plot.x} y={plot.y - CURSOR_STRIP_H}
            width={plot.w} height={CURSOR_STRIP_H}
            fill="rgba(22,27,34,0.85)"
            stroke="rgba(154,166,178,0.25)" strokeWidth="0.5"
            style={{ cursor: 'ew-resize' }}
            onMouseDown={(e) => {
              e.preventDefault(); e.stopPropagation();
              const { x, y } = svgCoord(e);
              const { t } = proj.inv(x, y);
              setTime(Math.max(0, Math.min(dur, t)));
              dragRef.current = { kind: 'cursor' };
              tick();
            }}
          />
          {/* Tick labels in the strip */}
          {gridTicks.map((g) => (
            <line
              key={`gxs-${g.t}`}
              x1={g.x} y1={plot.y - CURSOR_STRIP_H + 4}
              x2={g.x} y2={plot.y - 4}
              stroke="rgba(154,166,178,0.35)" strokeWidth="0.5"
            />
          ))}

          {/* Playhead — single vertical line from cursor strip top to plot bottom */}
          <line
            data-studio-v3-anim-playhead
            x1={cursorX} y1={plot.y - CURSOR_STRIP_H}
            x2={cursorX} y2={plot.y + plot.h}
            stroke="#ffd13d" strokeWidth="1.4"
            style={{ pointerEvents: 'none' }}
          />
          <polygon
            points={`${cursorX - 5},${plot.y - CURSOR_STRIP_H + 2} ${cursorX + 5},${plot.y - CURSOR_STRIP_H + 2} ${cursorX},${plot.y - CURSOR_STRIP_H + 10}`}
            fill="#ffd13d"
            style={{ pointerEvents: 'none' }}
          />

          {/* Axis labels */}
          <text x={MARGIN_L} y={MARGIN_T - CURSOR_STRIP_H - 6}
            fontSize="10" fill="rgba(230,237,243,0.55)">value</text>
          <text x={VB_W - MARGIN_R} y={VB_H - 8}
            textAnchor="end" fontSize="10" fill="rgba(230,237,243,0.55)">time (s) →</text>
        </svg>
      </div>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────

/**
 * Pick a "nice" tick step for the given numeric range that yields
 * roughly `target` ticks total.
 */
function pickStep(range, target) {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const raw = range / Math.max(1, target);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  let step;
  if (norm < 1.5) step = 1;
  else if (norm < 3) step = 2;
  else if (norm < 7) step = 5;
  else step = 10;
  return step * pow;
}
