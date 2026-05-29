import React, { useRef, useCallback } from 'react';

/*
 * Studio Sequencer / Timeline track editor (Unreal Sequencer / Unity Timeline /
 * Blender Dope Sheet & Timeline / Cinema 4D timeline). A bottom-docked,
 * monotone-OLED track view over the existing keyframe engine: a frame ruler, a
 * draggable playhead/scrubber, one TRACK per animated object showing its
 * keyframe diamonds, and transport controls (play / set-key / clear). Scrubbing
 * drives the parent's currentFrame, which interpolates every keyed transform
 * (position / rotation / scale) live in the viewport.
 *
 * This replaces the inherited blue, sceneManager-coupled, display-only
 * TimelineEditor with a native Studio component wired to the real scene.
 */
export default function StudioSequencer({
  open, onClose,
  frames = 240,
  currentFrame = 0,
  onScrub,
  playing = false,
  onPlayPause,
  tracks = [],
  onSetKey,
  onClear,
}) {
  const laneRef = useRef(null);
  const draggingRef = useRef(false);

  const frameFromClientX = useCallback((clientX) => {
    const el = laneRef.current; if (!el) return 0;
    const r = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return Math.round(pct * frames);
  }, [frames]);

  const onLaneDown = (e) => { draggingRef.current = true; onScrub && onScrub(frameFromClientX(e.clientX)); };
  const onLaneMove = (e) => { if (draggingRef.current) onScrub && onScrub(frameFromClientX(e.clientX)); };
  const endDrag = () => { draggingRef.current = false; };

  if (!open) return null;
  const pf = (f) => `${(f / frames) * 100}%`;
  const ticks = []; for (let f = 0; f <= frames; f += 30) ticks.push(f);

  return (
    <div data-studio-sequencer="editor" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 208, zIndex: 55, background: 'rgba(0,0,0,0.95)', borderTop: '1px solid #222', color: '#dcdcdc', fontSize: 12, display: 'flex', flexDirection: 'column' }}>
      {/* transport bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: '#0c0c0c', borderBottom: '1px solid #1c1c1c' }}>
        <strong style={{ letterSpacing: 0.5 }}>Sequencer</strong>
        <span style={{ opacity: 0.5 }}>Unreal Sequencer / Unity Timeline / Blender Dope Sheet</span>
        <button data-studio-seq-action="play" onClick={onPlayPause} style={btn(true)}>{playing ? 'Pause' : 'Play'}</button>
        <span data-studio-seq-frame style={{ fontFamily: 'monospace', minWidth: 70 }}>{Math.round(currentFrame)} / {frames}</span>
        <input data-studio-seq-scrub type="range" min={0} max={frames} value={Math.round(currentFrame)} onChange={(e) => onScrub && onScrub(Number(e.target.value))} style={{ flex: 1, accentColor: '#888' }} />
        <button data-studio-seq-action="setkey" onClick={onSetKey} style={btn()}>Set Key</button>
        <button data-studio-seq-action="clear" onClick={onClear} style={btn()}>Clear</button>
        <button data-studio-seq-action="close" onClick={onClose} style={btn()}>Close</button>
      </div>
      {/* body: names | lanes */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: 180, background: '#0a0a0a', borderRight: '1px solid #1c1c1c', overflowY: 'auto' }}>
          <div style={{ height: 22, borderBottom: '1px solid #1c1c1c', padding: '0 8px', display: 'flex', alignItems: 'center', opacity: 0.5, textTransform: 'uppercase', fontSize: 10 }}>Tracks</div>
          {tracks.length === 0
            ? <div style={{ padding: 14, opacity: 0.4, fontSize: 11 }}>No keyed objects — Set Key to add a track</div>
            : tracks.map((t) => (
              <div key={t.uuid} data-studio-seq-track={t.uuid} style={{ height: 26, borderBottom: '1px solid #161616', padding: '0 8px', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
            ))}
        </div>
        <div ref={laneRef} onPointerDown={onLaneDown} onPointerMove={onLaneMove} onPointerUp={endDrag} onPointerLeave={endDrag}
          style={{ flex: 1, position: 'relative', background: '#111', cursor: 'ew-resize', overflow: 'hidden' }}>
          {/* ruler */}
          <div style={{ height: 22, borderBottom: '1px solid #1c1c1c', position: 'relative' }}>
            {ticks.map((f) => (
              <div key={f} style={{ position: 'absolute', left: pf(f), top: 0, height: '100%', borderLeft: '1px solid #242424', paddingLeft: 3 }}>
                <span style={{ fontSize: 9, opacity: 0.5 }}>{f}</span>
              </div>
            ))}
          </div>
          {/* track lanes */}
          {tracks.map((t) => (
            <div key={t.uuid} style={{ height: 26, borderBottom: '1px solid #161616', position: 'relative' }}>
              {t.frames.map((f) => (
                <div key={f} data-studio-seq-key={`${t.uuid}:${f}`} title={`frame ${f}`} style={{ position: 'absolute', left: pf(f), top: '50%', width: 9, height: 9, marginLeft: -5, transform: 'translateY(-50%) rotate(45deg)', background: '#cfcfcf', border: '1px solid #000' }} />
              ))}
            </div>
          ))}
          {/* playhead */}
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: pf(currentFrame), width: 2, marginLeft: -1, background: '#e6e6e6', pointerEvents: 'none' }}>
            <div style={{ width: 9, height: 9, marginLeft: -4, background: '#e6e6e6' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

const btn = (primary) => ({ background: primary ? '#2a2a2a' : '#161616', color: '#dcdcdc', border: '1px solid #333', borderRadius: 3, padding: '3px 9px', fontSize: 11, cursor: 'pointer' });
