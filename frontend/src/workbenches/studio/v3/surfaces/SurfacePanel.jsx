// ArchDisc Studio V3 — surface-op control panel.
//
// Right-rail floating panel for Plasticity-style surface ops:
// fillet / chamfer / offset / shell / unfold / stitch.
//
// The panel doesn't dive into mesh picking UI — it shows the active
// selection's uuid, lets the user type parameters, and dispatches the
// op via the window.__studioSurface* surface. For ops that need an edge
// or face selection (fillet / chamfer / unfold), the user supplies the
// edgeKey / face-index list as text. This is the same convention V3
// uses elsewhere where a real face/edge-picking gizmo isn't shipped
// yet (modstack/, subdiv/).
//
// Style language matches the V3 dark theme (snap2/SnapPanel reference).

import React, { useEffect, useState } from 'react';

const PANEL_W = 296;
const OPS = [
  { id: 'fillet',  label: 'Fillet edge'  },
  { id: 'chamfer', label: 'Chamfer edge' },
  { id: 'offset',  label: 'Offset surface' },
  { id: 'shell',   label: 'Shell' },
  { id: 'unfold',  label: 'Unfold strip' },
  { id: 'stitch',  label: 'Stitch loops' },
];

const ACCENT = 'var(--studio-accent, #1de9b6)';

function btn(disabled) {
  return {
    background: disabled ? 'rgba(154,166,178,0.10)' : 'transparent',
    color: 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    padding: '3px 8px', borderRadius: 3, fontSize: 11,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
  };
}
function input() {
  return {
    flex: 1, fontSize: 11,
    fontFamily: 'var(--studio-mono, ui-monospace)',
    background: 'rgba(13,17,23,0.45)',
    color: 'inherit',
    border: '1px solid rgba(154,166,178,0.25)',
    borderRadius: 3,
    padding: '2px 6px',
  };
}
function row() {
  return { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px' };
}
function lbl() {
  return { fontSize: 10, opacity: 0.6, minWidth: 64 };
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

export default function SurfacePanel({
  getSelectedUuid,
  apply,
  onCloseRequest,
  pinSelectionB,
  pinnedB,
}) {
  const [op, setOp] = useState('fillet');
  const [edgeKey, setEdgeKey] = useState('0_1');
  const [radius, setRadius] = useState(0.05);
  const [segments, setSegments] = useState(4);
  const [distance, setDistance] = useState(0.05);
  const [thickness, setThickness] = useState(0.05);
  const [faceList, setFaceList] = useState('0,1,2');
  const [lastResult, setLastResult] = useState(null);
  const [, force] = useState(0);
  const tick = () => force((v) => v + 1);

  useEffect(() => {
    const id = setInterval(tick, 600);
    return () => clearInterval(id);
  }, []);

  const uuid = getSelectedUuid() || '';
  const runOp = async () => {
    let r;
    if (op === 'fillet')       r = await apply('fillet',  { uuid, edgeKey, radius: +radius, segments: +segments });
    else if (op === 'chamfer') r = await apply('chamfer', { uuid, edgeKey, distance: +distance });
    else if (op === 'offset')  r = await apply('offset',  { uuid, distance: +distance });
    else if (op === 'shell')   r = await apply('shell',   { uuid, thickness: +thickness });
    else if (op === 'unfold')  r = await apply('unfold',  { uuid, faceIndices: faceList.split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n)) });
    else if (op === 'stitch')  r = await apply('stitch',  { uuidA: uuid, uuidB: pinnedB });
    setLastResult(r);
    tick();
  };

  return (
    <div
      data-studio-v3-surface-panel
      style={{
        position: 'fixed',
        top: 70, right: 14,
        width: PANEL_W,
        zIndex: 9420,
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
        borderBottom: `1px solid ${ACCENT}55`,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <strong style={{ color: ACCENT, fontSize: 12, letterSpacing: '0.05em' }}>
          SURFACE OPS
        </strong>
        <div style={{ flex: 1 }} />
        <button
          data-studio-v3-surface-close
          onClick={() => onCloseRequest && onCloseRequest()}
          style={btn(false)}
        >×</button>
      </div>

      {/* Op picker */}
      <Section title="Operation">
        <div style={{ ...row(), flexWrap: 'wrap' }}>
          {OPS.map((o) => (
            <button
              key={o.id}
              data-studio-v3-surface-op={o.id}
              onClick={() => { setOp(o.id); tick(); }}
              style={{
                ...btn(false),
                background: op === o.id ? `${ACCENT}22` : 'transparent',
                borderColor: op === o.id ? ACCENT : 'rgba(154,166,178,0.35)',
                marginBottom: 4,
              }}
            >{o.label}</button>
          ))}
        </div>
      </Section>

      {/* Selection state */}
      <Section title="Selection">
        <div style={row()}>
          <span style={lbl()}>Mesh A</span>
          <span
            data-studio-v3-surface-uuid
            style={{
              fontSize: 9, fontFamily: 'var(--studio-mono, ui-monospace)',
              opacity: uuid ? 1 : 0.5, flex: 1,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >{uuid ? uuid.slice(0, 18) + '…' : '(no selection)'}</span>
        </div>
        {op === 'stitch' && (
          <div style={row()}>
            <span style={lbl()}>Mesh B</span>
            <span
              data-studio-v3-surface-uuid-b
              style={{
                fontSize: 9, fontFamily: 'var(--studio-mono, ui-monospace)',
                opacity: pinnedB ? 1 : 0.5, flex: 1,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >{pinnedB ? pinnedB.slice(0, 18) + '…' : '(pin one)'}</span>
            <button
              data-studio-v3-surface-pin-b
              onClick={() => { pinSelectionB(); tick(); }}
              style={btn(false)}
            >Pin B</button>
          </div>
        )}
      </Section>

      {/* Per-op params */}
      {(op === 'fillet' || op === 'chamfer') && (
        <Section title="Edge">
          <div style={row()}>
            <span style={lbl()}>edgeKey</span>
            <input
              data-studio-v3-surface-edgekey
              style={input()}
              value={edgeKey}
              onChange={(e) => setEdgeKey(e.target.value)}
              placeholder="va_vb"
            />
          </div>
        </Section>
      )}

      {op === 'fillet' && (
        <Section title="Fillet params">
          <div style={row()}>
            <span style={lbl()}>radius</span>
            <input
              data-studio-v3-surface-radius
              type="number" step="0.01"
              style={input()}
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
            />
          </div>
          <div style={row()}>
            <span style={lbl()}>segments</span>
            <input
              data-studio-v3-surface-segments
              type="number" step="1" min="1" max="32"
              style={input()}
              value={segments}
              onChange={(e) => setSegments(e.target.value)}
            />
          </div>
        </Section>
      )}

      {(op === 'chamfer' || op === 'offset') && (
        <Section title={op === 'offset' ? 'Offset' : 'Chamfer'}>
          <div style={row()}>
            <span style={lbl()}>distance</span>
            <input
              data-studio-v3-surface-distance
              type="number" step="0.01"
              style={input()}
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
            />
          </div>
        </Section>
      )}

      {op === 'shell' && (
        <Section title="Shell">
          <div style={row()}>
            <span style={lbl()}>thickness</span>
            <input
              data-studio-v3-surface-thickness
              type="number" step="0.01"
              style={input()}
              value={thickness}
              onChange={(e) => setThickness(e.target.value)}
            />
          </div>
        </Section>
      )}

      {op === 'unfold' && (
        <Section title="Unfold strip">
          <div style={row()}>
            <span style={lbl()}>faces</span>
            <input
              data-studio-v3-surface-faces
              style={input()}
              value={faceList}
              onChange={(e) => setFaceList(e.target.value)}
              placeholder="0,1,2,3"
            />
          </div>
        </Section>
      )}

      {/* Apply */}
      <div style={{
        padding: '8px 12px',
        display: 'flex', alignItems: 'center', gap: 8,
        borderTop: '1px solid rgba(154,166,178,0.18)',
      }}>
        <button
          data-studio-v3-surface-apply
          onClick={runOp}
          disabled={!uuid || (op === 'stitch' && !pinnedB)}
          style={{
            ...btn(!uuid || (op === 'stitch' && !pinnedB)),
            background: ACCENT + '22', borderColor: ACCENT, color: ACCENT,
            padding: '4px 12px', fontWeight: 600,
          }}
        >Apply {op}</button>
        <div style={{ flex: 1 }} />
        <span
          data-studio-v3-surface-status
          style={{
            fontSize: 9, opacity: 0.7,
            fontFamily: 'var(--studio-mono, ui-monospace)',
          }}
        >
          {lastResult
            ? (lastResult.ok ? `ok · tris=${lastResult.tris ?? lastResult.faceCount ?? lastResult.addedTris ?? '?'}` : `err: ${lastResult.error}`)
            : 'idle'}
        </span>
      </div>
    </div>
  );
}
