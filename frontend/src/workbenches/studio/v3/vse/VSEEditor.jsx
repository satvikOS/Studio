// ArchDisc Studio V3 — VSE editor floating panel.
//
// A Blender-VSE-style horizontal timeline overlay. Rows = channels;
// each strip is a draggable block whose left edge maps to startTime
// and width to (endTime − startTime). A scrub bar above lets the user
// pick any time in [0, duration]; the preview canvas to the right
// shows the composed frame at that time.
//
// Mounted into a body-attached host by vse/index.js so we don't have
// to touch StudioShellV3.jsx.

import React, { useEffect, useMemo, useRef, useState } from 'react';

const CHANNEL_H = 28;
const RULER_H = 24;
const PX_PER_SEC = 80;             // initial zoom; user can scrub freely
const MIN_DURATION = 5;            // ensure the ruler always shows a useful range
const COLOURS = {
  image:        'rgba(99, 179, 237, 0.85)',  // sky-blue
  viewport:     'rgba(29, 233, 182, 0.85)',  // studio accent
  colorcorrect: 'rgba(246, 173, 85, 0.85)',  // amber
};
const TEXT_DARK = '#0d1117';

function fmtTime(t) {
  if (!Number.isFinite(t)) return '0.00s';
  return `${t.toFixed(2)}s`;
}

export default function VSEEditor({
  listStrips, getState, getTime, setTime,
  play, pause, isPlaying, setSpeed,
  addStrip, removeStrip, setStripTime, setStripChannel, setStripParams,
  composeAt, onCloseRequest, exportSequence,
}) {
  const [, force] = useState(0);
  const tick = () => force((v) => v + 1);
  const [selectedId, setSelectedId] = useState(null);
  const previewCanvasRef = useRef(null);
  const tracksRef = useRef(null);
  const dragRef = useRef(null);
  const rafRef = useRef(0);
  const [previewUrl, setPreviewUrl] = useState(null);

  // Force a re-render every animation frame while playing so the
  // playhead + preview reflect the moving time. Same pattern as
  // anim/index.js pumpRender().
  useEffect(() => {
    let alive = true;
    const step = () => {
      if (!alive) return;
      if (isPlaying()) {
        tick();
        // Repaint preview at current time.
        const c = previewCanvasRef.current;
        if (c) {
          const r = composeAt(getTime(), { canvas: c, width: c.width, height: c.height });
          if (r && r.dataUrl) setPreviewUrl(r.dataUrl);
        }
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { alive = false; cancelAnimationFrame(rafRef.current); };
  }, [composeAt, getTime, isPlaying]);

  // On mount, paint once.
  useEffect(() => {
    const c = previewCanvasRef.current;
    if (c) {
      const r = composeAt(getTime(), { canvas: c, width: c.width, height: c.height });
      if (r && r.dataUrl) setPreviewUrl(r.dataUrl);
    }
  }, [composeAt, getTime]);

  const repaintPreview = () => {
    const c = previewCanvasRef.current;
    if (!c) return;
    const r = composeAt(getTime(), { canvas: c, width: c.width, height: c.height });
    if (r && r.dataUrl) setPreviewUrl(r.dataUrl);
  };

  const state = getState();
  const strips = listStrips();
  const duration = Math.max(MIN_DURATION, state.duration || 0);
  // Discover max channel so we always have an extra empty row to drop into.
  const maxChannel = strips.reduce((m, s) => Math.max(m, s.channel), 0);
  const rowCount = Math.max(4, maxChannel + 1);
  const totalWidth = Math.max(640, Math.ceil(duration * PX_PER_SEC) + 80);

  const onAddImage = () => {
    // Default seed: a 1-pixel transparent PNG; the user can swap
    // the dataURL via the props panel.
    const url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZqK6QYAAAAASUVORK5CYII=';
    const r = addStrip('image', 1, getTime(), getTime() + 2, { dataUrl: url });
    if (r && r.uuid) setSelectedId(r.uuid);
    repaintPreview();
    tick();
  };
  const onAddViewport = () => {
    const r = addStrip('viewport', 2, getTime(), getTime() + 2, {});
    if (r && r.uuid) setSelectedId(r.uuid);
    repaintPreview();
    tick();
  };
  const onAddColorCorrect = () => {
    const r = addStrip('colorcorrect', 3, getTime(), getTime() + 2, {
      gain: 1.2, gamma: 1.1, contrast: 1.1, tint: [1, 1, 1],
    });
    if (r && r.uuid) setSelectedId(r.uuid);
    repaintPreview();
    tick();
  };
  const onRemove = () => {
    if (!selectedId) return;
    removeStrip(selectedId);
    setSelectedId(null);
    repaintPreview();
    tick();
  };

  // ─── Strip drag: move along time axis ──────────────────────────
  const startStripDrag = (e, strip, mode) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(strip.uuid);
    const rect = tracksRef.current.getBoundingClientRect();
    dragRef.current = {
      mode,                                     // 'move' | 'resize-left' | 'resize-right'
      uuid: strip.uuid,
      startMouseX: e.clientX - rect.left,
      origStart: strip.startTime,
      origEnd:   strip.endTime,
      origChannel: strip.channel,
      rect,
    };
  };

  const onTracksMouseMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const rect = tracksRef.current.getBoundingClientRect();
    const dx = (e.clientX - rect.left) - d.startMouseX;
    const dt = dx / PX_PER_SEC;
    const dyRow = Math.round(((e.clientY - rect.top - RULER_H) / CHANNEL_H));
    if (d.mode === 'move') {
      const newStart = Math.max(0, d.origStart + dt);
      const newEnd = newStart + (d.origEnd - d.origStart);
      setStripTime(d.uuid, newStart, newEnd);
      // Channel snap by row: top row in the tracks area is the HIGHEST
      // channel so user feels like dragging up = layer above.
      const desiredChannel = Math.max(1, rowCount - dyRow);
      if (desiredChannel !== d.origChannel) {
        setStripChannel(d.uuid, desiredChannel);
      }
    } else if (d.mode === 'resize-left') {
      const newStart = Math.max(0, Math.min(d.origEnd - 0.05, d.origStart + dt));
      setStripTime(d.uuid, newStart, d.origEnd);
    } else if (d.mode === 'resize-right') {
      const newEnd = Math.max(d.origStart + 0.05, d.origEnd + dt);
      setStripTime(d.uuid, d.origStart, newEnd);
    }
    tick();
    repaintPreview();
  };
  const onTracksMouseUp = () => { dragRef.current = null; };

  // ─── Ruler click → scrub ───────────────────────────────────────
  const onRulerClick = (e) => {
    const rect = tracksRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = Math.max(0, x / PX_PER_SEC);
    setTime(t);
    repaintPreview();
    tick();
  };

  const selected = useMemo(
    () => (selectedId ? strips.find((s) => s.uuid === selectedId) : null),
    [selectedId, strips],
  );

  const setSelectedParam = (key, value) => {
    if (!selected) return;
    const p = { ...selected.params, [key]: value };
    setStripParams(selected.uuid, p);
    repaintPreview();
    tick();
  };

  const onExport = async () => {
    if (!selected && strips.length === 0) return;
    const dur = duration;
    const r = exportSequence(12, dur);
    if (r && r.frames) {
      // eslint-disable-next-line no-console
      console.log('[VSE] exported', r.count, 'frames at', r.fps, 'fps');
    }
  };

  // Layout: header strip / tracks strip / preview pane.
  return (
    <div
      data-studio-v3-vse-editor
      style={{
        position: 'fixed',
        left: 16, right: 16, bottom: 16,
        height: 360,
        zIndex: 9250,
        background: 'rgba(13,17,23,0.94)',
        border: '1px solid rgba(29,233,182,0.5)',
        borderRadius: 6,
        color: 'var(--studio-ink, #e6edf3)',
        fontFamily: 'inherit',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 16px 64px rgba(0,0,0,0.55)',
        overflow: 'hidden',
      }}
    >
      {/* Header / transport */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 14px',
        background: 'var(--studio-bg-elev, #161b22)',
        borderBottom: '1px solid rgba(29,233,182,0.4)',
      }}>
        <strong style={{
          color: 'var(--studio-accent, #1de9b6)',
          fontSize: 12, letterSpacing: '0.05em',
        }}>VSE — Sequencer</strong>
        <span style={{
          opacity: 0.55, fontSize: 11,
          fontFamily: 'var(--studio-mono, ui-monospace)',
        }}>{strips.length} strips · {fmtTime(state.time)} / {fmtTime(duration)}</span>
        <div style={{ flex: 1 }} />
        <button
          data-studio-v3-vse-add="image"
          onClick={onAddImage}
          style={btnStyle()}
        >+ Image</button>
        <button
          data-studio-v3-vse-add="viewport"
          onClick={onAddViewport}
          style={btnStyle()}
        >+ Viewport</button>
        <button
          data-studio-v3-vse-add="colorcorrect"
          onClick={onAddColorCorrect}
          style={btnStyle()}
        >+ Color</button>
        <span style={{ width: 12 }} />
        <button
          data-studio-v3-vse-play
          onClick={() => { isPlaying() ? pause() : play(); tick(); }}
          style={btnStyle(true)}
        >{isPlaying() ? 'Pause' : 'Play'}</button>
        <button
          data-studio-v3-vse-stop
          onClick={() => { pause(); setTime(0); repaintPreview(); tick(); }}
          style={btnStyle()}
        >Stop</button>
        <button
          data-studio-v3-vse-export
          onClick={onExport}
          style={btnStyle()}
        >Export</button>
        <button
          data-studio-v3-vse-close
          onClick={() => onCloseRequest && onCloseRequest()}
          style={btnStyle()}
        >Close (Esc)</button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Tracks / ruler */}
        <div
          data-studio-v3-vse-tracks
          ref={tracksRef}
          onMouseMove={onTracksMouseMove}
          onMouseUp={onTracksMouseUp}
          onMouseLeave={onTracksMouseUp}
          style={{
            flex: 1, minWidth: 0, position: 'relative',
            overflow: 'auto',
            background: 'rgba(13,17,23,0.5)',
          }}
        >
          <div style={{ position: 'relative', width: totalWidth, height: RULER_H + rowCount * CHANNEL_H }}>
            {/* Ruler */}
            <div
              data-studio-v3-vse-ruler
              onClick={onRulerClick}
              style={{
                position: 'absolute', left: 0, top: 0, width: totalWidth, height: RULER_H,
                background: 'rgba(22,27,34,0.85)',
                borderBottom: '1px solid rgba(154,166,178,0.35)',
                cursor: 'text',
                userSelect: 'none',
              }}
            >
              {Array.from({ length: Math.ceil(duration) + 1 }).map((_, i) => (
                <div key={i} style={{
                  position: 'absolute', left: i * PX_PER_SEC, top: 0,
                  height: RULER_H,
                  borderLeft: '1px solid rgba(154,166,178,0.35)',
                  paddingLeft: 4, fontSize: 10,
                  color: 'rgba(230,237,243,0.6)',
                  fontFamily: 'var(--studio-mono, ui-monospace)',
                }}>{i}s</div>
              ))}
            </div>
            {/* Channel rows (drawn top-down → display channel = rowCount-rowIdx) */}
            {Array.from({ length: rowCount }).map((_, rowIdx) => {
              const channel = rowCount - rowIdx;
              return (
                <div
                  key={rowIdx}
                  data-studio-v3-vse-row={channel}
                  style={{
                    position: 'absolute', left: 0, top: RULER_H + rowIdx * CHANNEL_H,
                    width: totalWidth, height: CHANNEL_H,
                    background: rowIdx % 2 ? 'rgba(22,27,34,0.35)' : 'rgba(13,17,23,0.55)',
                    borderTop: '1px solid rgba(154,166,178,0.15)',
                  }}
                >
                  <span style={{
                    position: 'absolute', left: 4, top: 2,
                    fontSize: 9, opacity: 0.45,
                    fontFamily: 'var(--studio-mono, ui-monospace)',
                  }}>ch{channel}</span>
                </div>
              );
            })}
            {/* Strips */}
            {strips.map((s) => {
              const rowIdx = rowCount - s.channel;
              const top = RULER_H + rowIdx * CHANNEL_H + 2;
              const left = Math.round(s.startTime * PX_PER_SEC);
              const w = Math.max(8, Math.round((s.endTime - s.startTime) * PX_PER_SEC));
              const selected = s.uuid === selectedId;
              return (
                <div
                  key={s.uuid}
                  data-studio-v3-vse-strip={s.uuid}
                  data-studio-v3-vse-strip-kind={s.kind}
                  onMouseDown={(e) => startStripDrag(e, s, 'move')}
                  onClick={(e) => { e.stopPropagation(); setSelectedId(s.uuid); }}
                  style={{
                    position: 'absolute', left, top,
                    width: w, height: CHANNEL_H - 4,
                    background: COLOURS[s.kind] || '#888',
                    border: selected ? '2px solid #fff' : '1px solid rgba(0,0,0,0.4)',
                    borderRadius: 3,
                    color: TEXT_DARK,
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: 'move',
                    overflow: 'hidden',
                    paddingLeft: 6,
                    paddingRight: 6,
                    display: 'flex', alignItems: 'center',
                    userSelect: 'none',
                  }}
                >
                  <span style={{ pointerEvents: 'none' }}>{s.kind}</span>
                  <div
                    onMouseDown={(e) => startStripDrag(e, s, 'resize-left')}
                    style={{
                      position: 'absolute', left: 0, top: 0, width: 4, height: '100%',
                      cursor: 'ew-resize', background: 'rgba(0,0,0,0.25)',
                    }}
                  />
                  <div
                    onMouseDown={(e) => startStripDrag(e, s, 'resize-right')}
                    style={{
                      position: 'absolute', right: 0, top: 0, width: 4, height: '100%',
                      cursor: 'ew-resize', background: 'rgba(0,0,0,0.25)',
                    }}
                  />
                </div>
              );
            })}
            {/* Playhead */}
            <div
              data-studio-v3-vse-playhead
              style={{
                position: 'absolute',
                left: Math.round(state.time * PX_PER_SEC),
                top: 0,
                width: 1,
                height: RULER_H + rowCount * CHANNEL_H,
                background: 'var(--studio-accent, #1de9b6)',
                pointerEvents: 'none',
                boxShadow: '0 0 4px rgba(29,233,182,0.85)',
              }}
            />
          </div>
        </div>

        {/* Preview + props */}
        <div
          data-studio-v3-vse-preview-pane
          style={{
            width: 360,
            borderLeft: '1px solid rgba(154,166,178,0.3)',
            background: 'var(--studio-bg-elev, #161b22)',
            display: 'flex', flexDirection: 'column',
            padding: 10,
            gap: 8,
            overflowY: 'auto',
          }}
        >
          <div style={{ fontSize: 11, opacity: 0.55, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            preview
          </div>
          <canvas
            data-studio-v3-vse-preview
            ref={previewCanvasRef}
            width={320} height={180}
            style={{
              width: 320, height: 180,
              background: '#000',
              border: '1px solid rgba(154,166,178,0.35)',
              borderRadius: 4,
              imageRendering: 'pixelated',
            }}
          />
          {selected ? (
            <div data-studio-v3-vse-props style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{
                fontSize: 11, opacity: 0.55,
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>{selected.kind} strip</div>
              <div style={{ fontSize: 10, opacity: 0.7 }}>
                ch{selected.channel} · {fmtTime(selected.startTime)} → {fmtTime(selected.endTime)}
              </div>
              {selected.kind === 'colorcorrect' && (
                <>
                  <NumRow label="gain"     value={selected.params.gain}     onChange={(v) => setSelectedParam('gain', v)} />
                  <NumRow label="gamma"    value={selected.params.gamma}    onChange={(v) => setSelectedParam('gamma', v)} />
                  <NumRow label="contrast" value={selected.params.contrast} onChange={(v) => setSelectedParam('contrast', v)} />
                </>
              )}
              {selected.kind === 'viewport' && (
                <>
                  <NumRow label="width"  value={selected.params.width}  onChange={(v) => setSelectedParam('width', v)} />
                  <NumRow label="height" value={selected.params.height} onChange={(v) => setSelectedParam('height', v)} />
                </>
              )}
              {selected.kind === 'image' && (
                <div style={{ fontSize: 10, opacity: 0.7 }}>dataURL: {(selected.params.dataUrl || '').slice(0, 32)}…</div>
              )}
              <button
                data-studio-v3-vse-remove
                onClick={onRemove}
                style={{
                  marginTop: 4, padding: '4px 10px',
                  background: 'rgba(229,57,53,0.18)', color: '#ff7361',
                  border: '1px solid rgba(229,57,53,0.45)', borderRadius: 4,
                  fontSize: 11, cursor: 'pointer',
                }}
              >Remove strip</button>
            </div>
          ) : (
            <div style={{ fontSize: 11, opacity: 0.55 }}>
              Drop a strip from the toolbar above. Click a strip to edit.
              Drag the body to move, drag either edge to resize.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function btnStyle(primary) {
  return {
    background: primary ? 'var(--studio-accent, #1de9b6)' : 'transparent',
    color: primary ? '#0d1117' : 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    padding: '4px 10px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: primary ? 600 : 400,
    cursor: 'pointer',
  };
}

function NumRow({ label, value, onChange }) {
  return (
    <div style={{ fontSize: 11 }}>
      <label style={{ display: 'block', opacity: 0.6, marginBottom: 2 }}>{label}</label>
      <input
        data-studio-v3-vse-param={label}
        type="number"
        step="0.05"
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        style={{
          width: '100%', padding: 3,
          background: 'rgba(13,17,23,0.6)', color: 'inherit',
          border: '1px solid rgba(154,166,178,0.3)', borderRadius: 3,
          fontFamily: 'var(--studio-mono, ui-monospace)',
        }}
      />
    </div>
  );
}
