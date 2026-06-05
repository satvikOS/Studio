// ArchDisc Studio V3 — Quad-view React overlay.
//
// Four absolutely-positioned label tiles + draggable splitters drawn on
// top of the renderer canvas. The overlay never owns rendering — that
// is handled by quadrender.js. The overlay only:
//
//   • shows pane labels (PERSP / TOP / FRONT / RIGHT)
//   • shows a "Maximize" / "Restore" button per pane
//   • hosts the vertical + horizontal splitter rails the user drags
//
// The host (multiview/index.js) mounts this into a body-attached host
// div positioned over the canvas. The overlay's bounding rect is sized
// from the canvas's `getBoundingClientRect()` every animation frame so
// it tracks resizes without a ResizeObserver dance.

import React, { useState, useEffect, useRef, useCallback } from 'react';

const LABELS = ['Perspective', 'Top', 'Front', 'Right'];
const SHORT  = ['PERSP', 'TOP', 'FRONT', 'RIGHT'];

// Pane order matches quadrender.js — TL/TR/BL/BR.
//
//   0 = top-left      1 = top-right
//   2 = bottom-left   3 = bottom-right

export default function QuadPanel({
  canvasRect,            // { x, y, w, h } in CSS pixels of the host
  horizontalRatio,       // 0..1 — vertical splitter x position
  verticalRatio,         // 0..1 — horizontal splitter y position
  maximizedIdx,          // -1 = quad layout, 0..3 = full-screen pane
  onSplitChange,         // (hR, vR) — called as user drags
  onMaximize,            // (idx) — toggle maximize for pane idx
  onClose,               // () — full disable
}) {
  const [drag, setDrag] = useState(null); // { axis: 'h'|'v', start: {x,y}, baseRatio }
  const rootRef = useRef(null);

  // Width/height — fall back to 800×600 so the overlay is still
  // testable before the canvas mounts.
  const rect = canvasRect || { x: 0, y: 0, w: 800, h: 600 };
  const xMid = Math.round(rect.w * Math.max(0.05, Math.min(0.95, horizontalRatio || 0.5)));
  const yMid = Math.round(rect.h * Math.max(0.05, Math.min(0.95, verticalRatio || 0.5)));

  // ─── Drag handlers ────────────────────────────────────────────────
  const onSplitterDown = useCallback((axis) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDrag({ axis, startX: e.clientX, startY: e.clientY });
  }, []);

  useEffect(() => {
    if (!drag) return undefined;
    const onMove = (e) => {
      const r = rootRef.current && rootRef.current.getBoundingClientRect();
      if (!r) return;
      if (drag.axis === 'v') {
        const x = e.clientX - r.left;
        const hR = Math.max(0.08, Math.min(0.92, x / Math.max(1, r.width)));
        onSplitChange(hR, undefined);
      } else {
        const y = e.clientY - r.top;
        const vR = Math.max(0.08, Math.min(0.92, y / Math.max(1, r.height)));
        onSplitChange(undefined, vR);
      }
    };
    const onUp = () => setDrag(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, onSplitChange]);

  // ─── Per-pane rect for label positioning ──────────────────────────
  const paneRects = (() => {
    if (maximizedIdx >= 0 && maximizedIdx < 4) {
      const arr = [
        { x: 0, y: 0, w: 0, h: 0 },
        { x: 0, y: 0, w: 0, h: 0 },
        { x: 0, y: 0, w: 0, h: 0 },
        { x: 0, y: 0, w: 0, h: 0 },
      ];
      arr[maximizedIdx] = { x: 0, y: 0, w: rect.w, h: rect.h };
      return arr;
    }
    return [
      { x: 0,    y: 0,    w: xMid,           h: yMid },
      { x: xMid, y: 0,    w: rect.w - xMid,  h: yMid },
      { x: 0,    y: yMid, w: xMid,           h: rect.h - yMid },
      { x: xMid, y: yMid, w: rect.w - xMid,  h: rect.h - yMid },
    ];
  })();

  // ─── Style helpers — keep look subtle so the 3D content reads. ────
  const labelStyle = (i, r) => ({
    position: 'absolute',
    left: r.x + 8,
    top: r.y + 8,
    width: r.w > 80 ? undefined : 0,
    height: r.w > 80 ? undefined : 0,
    opacity: r.w > 80 ? 1 : 0,
    pointerEvents: r.w > 80 ? 'auto' : 'none',
    background: 'rgba(15, 17, 22, 0.65)',
    color: '#e7eaee',
    font: '600 11px/1 ui-monospace, SFMono-Regular, monospace',
    letterSpacing: '0.06em',
    padding: '6px 8px',
    borderRadius: 4,
    border: '1px solid rgba(255,255,255,0.08)',
    boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    userSelect: 'none',
  });
  const btnStyle = {
    appearance: 'none',
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: '#cbd0d6',
    padding: '2px 6px',
    borderRadius: 3,
    font: '600 10px/1 ui-monospace, monospace',
    cursor: 'pointer',
    letterSpacing: '0.06em',
  };

  // Splitter rails are only visible / interactive in the 4-pane state.
  const showSplitters = maximizedIdx < 0;

  return (
    <div
      ref={rootRef}
      data-studio-v3-multiview
      style={{
        position: 'fixed',
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        // The overlay itself is click-through; only labels + splitters
        // (which set their own pointerEvents) capture mouse events.
        pointerEvents: 'none',
        zIndex: 50,
      }}
    >
      {/* ─── Pane labels + maximize buttons ───────────────────────── */}
      {paneRects.map((r, i) => (
        <div
          key={i}
          data-studio-v3-multiview-pane={String(i)}
          data-studio-v3-multiview-pane-key={SHORT[i].toLowerCase()}
          style={labelStyle(i, r)}
        >
          <span data-studio-v3-multiview-pane-label>{SHORT[i]}</span>
          <button
            type="button"
            data-studio-v3-multiview-maximize={String(i)}
            style={btnStyle}
            title={maximizedIdx === i ? `Restore ${LABELS[i]}` : `Maximize ${LABELS[i]}`}
            onClick={(e) => { e.stopPropagation(); onMaximize(i); }}
          >
            {maximizedIdx === i ? 'Restore' : 'Max'}
          </button>
        </div>
      ))}

      {/* ─── Close button (top-right of overlay) ─────────────────── */}
      <button
        type="button"
        data-studio-v3-multiview-close
        title="Disable quad view"
        style={{
          ...btnStyle,
          position: 'absolute',
          right: 8,
          top: 8,
          pointerEvents: 'auto',
          padding: '4px 8px',
        }}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        Exit Quad
      </button>

      {/* ─── Vertical splitter (drags horizontalRatio) ───────────── */}
      {showSplitters && (
        <div
          data-studio-v3-multiview-splitter="v"
          onMouseDown={onSplitterDown('v')}
          style={{
            position: 'absolute',
            left: xMid - 3,
            top: 0,
            width: 6,
            height: rect.h,
            cursor: 'ew-resize',
            background: drag && drag.axis === 'v'
              ? 'rgba(120, 170, 240, 0.35)'
              : 'rgba(255,255,255,0.04)',
            pointerEvents: 'auto',
          }}
        />
      )}

      {/* ─── Horizontal splitter (drags verticalRatio) ───────────── */}
      {showSplitters && (
        <div
          data-studio-v3-multiview-splitter="h"
          onMouseDown={onSplitterDown('h')}
          style={{
            position: 'absolute',
            left: 0,
            top: yMid - 3,
            width: rect.w,
            height: 6,
            cursor: 'ns-resize',
            background: drag && drag.axis === 'h'
              ? 'rgba(120, 170, 240, 0.35)'
              : 'rgba(255,255,255,0.04)',
            pointerEvents: 'auto',
          }}
        />
      )}
    </div>
  );
}
