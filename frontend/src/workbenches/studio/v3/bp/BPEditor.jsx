// ArchDisc Studio V3 — Blueprints SVG editor.
//
// Mirrors shader/ShaderEditor.jsx but with two socket flavours:
//   • Exec sockets — yellow filled triangle, on the top row of the node.
//   • Data sockets — round, coloured by type (see TYPE_COLOR in nodes.js).
//
// Wires distinguish themselves visually:
//   • Exec wires render thicker, bright yellow.
//   • Data wires render thinner, in the source socket's type colour.
//
// Mounted into a body-attached <div data-studio-v3-bp-editor> via React
// createRoot from index.js, so we don't have to touch StudioShellV3.jsx.

import React, { useRef, useState } from 'react';
import { NODE_KINDS, TYPE_COLOR, listKinds, isExecSlot } from './nodes.js';

const NODE_W = 190;
const HEADER_H = 28;
const ROW_H = 20;

function nodeHeight(def) {
  // First row is the exec row (one exec in + one exec out at most).
  const dataIn = def.inputs.filter((s) => !isExecSlot(s)).length;
  const dataOut = def.outputs.filter((s) => !isExecSlot(s)).length;
  const rows = Math.max(dataIn, dataOut);
  return HEADER_H + 28 + rows * ROW_H + 10;
}

// (Exec slots live on the top row; data slots stack below.)
function socketCoords(node, def, kind, slot) {
  const slots = kind === 'input' ? def.inputs : def.outputs;
  const dataSlots = slots.filter((s) => !isExecSlot(s));
  const execSlots = slots.filter((s) => isExecSlot(s));
  if (isExecSlot(slot)) {
    const idx = execSlots.findIndex((s) => s.name === slot.name);
    const x = kind === 'output' ? node.x + NODE_W : node.x;
    const y = node.y + HEADER_H + 14 + idx * ROW_H;
    return { x, y, exec: true };
  }
  const idx = dataSlots.findIndex((s) => s.name === slot.name);
  const x = kind === 'output' ? node.x + NODE_W : node.x;
  const y = node.y + HEADER_H + 14 + (execSlots.length) * ROW_H + 4 + idx * ROW_H;
  return { x, y, exec: false };
}

function wirePath(a, b) {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

// Yellow triangle (exec) glyph.
function ExecGlyph({ x, y, kind, filled }) {
  // Pointing right; mirror for input pins by reversing path.
  const w = 6, h = 7;
  const path = kind === 'output'
    ? `M ${x - w} ${y - h} L ${x + w} ${y} L ${x - w} ${y + h} Z`
    : `M ${x - w} ${y - h} L ${x + w} ${y} L ${x - w} ${y + h} Z`;
  return (
    <path
      d={path}
      fill={filled ? '#f5c542' : 'rgba(13,17,23,0.95)'}
      stroke="#f5c542"
      strokeWidth="1.2"
    />
  );
}

export default function BPEditor({ getGraph, onCloseRequest, onRunStart, onRunStop, isRunning }) {
  const [, force] = useState(0);
  const tick = () => force((v) => v + 1);
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const [selectedId, setSelectedId] = useState(null);

  const graph = getGraph();

  const handleMouseMove = (e) => {
    if (!dragRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const d = dragRef.current;
    if (d.kind === 'node') {
      const node = graph.nodes.get(d.id);
      if (node) { node.x = x - d.ox; node.y = y - d.oy; tick(); }
    } else if (d.kind === 'wire') {
      d.x = x; d.y = y; tick();
    }
  };

  const handleMouseUp = (e) => {
    const d = dragRef.current;
    if (d && d.kind === 'wire') {
      const rect = svgRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // Hit-test every input socket; find the closest within 10px.
      let best = null; let bestDist = 999;
      for (const n of graph.nodes.values()) {
        const def = NODE_KINDS[n.kind];
        for (const slot of def.inputs) {
          const p = socketCoords(n, def, 'input', slot);
          const dist = Math.hypot(p.x - x, p.y - y);
          if (dist < 12 && dist < bestDist && n.id !== d.srcId) {
            best = { node: n, slot };
            bestDist = dist;
          }
        }
      }
      if (best) {
        const wantExec = d.srcExec;
        const isExecIn = isExecSlot(best.slot);
        if (wantExec && isExecIn && window.__studioBPConnectExec) {
          window.__studioBPConnectExec(d.srcId, d.srcOut, best.node.id, best.slot.name);
        } else if (!wantExec && !isExecIn && window.__studioBPConnectData) {
          window.__studioBPConnectData(d.srcId, d.srcOut, best.node.id, best.slot.name);
        }
      }
    }
    dragRef.current = null;
    tick();
  };

  const startNodeDrag = (e, node) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    dragRef.current = { kind: 'node', id: node.id, ox: x - node.x, oy: y - node.y };
    setSelectedId(node.id);
  };

  const startWireDrag = (e, node, slot) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    dragRef.current = {
      kind: 'wire',
      srcId: node.id,
      srcOut: slot.name,
      srcExec: isExecSlot(slot),
      srcType: slot.type,
      x, y,
    };
  };

  const addKind = (kind) => {
    if (window.__studioBPNodeAdd) {
      const r = window.__studioBPNodeAdd(kind, {});
      if (r && r.uuid) setSelectedId(r.uuid);
      tick();
    }
  };

  const removeSelected = () => {
    if (!selectedId) return;
    if (window.__studioBPNodeRemove) window.__studioBPNodeRemove(selectedId);
    setSelectedId(null);
    tick();
  };

  const selected = selectedId ? graph.nodes.get(selectedId) : null;
  const selectedDef = selected ? NODE_KINDS[selected.kind] : null;

  const setParam = (key, value) => {
    if (!selected) return;
    selected.params = { ...selected.params, [key]: value };
    tick();
  };

  const renderParamInput = (key, value) => {
    if (typeof value === 'number') {
      return (
        <input
          data-studio-v3-bp-param={key}
          type="number" step="0.01" value={value}
          onChange={(e) => setParam(key, Number(e.target.value))}
          style={inputStyle}
        />
      );
    }
    if (typeof value === 'boolean') {
      return (
        <input
          data-studio-v3-bp-param={key}
          type="checkbox" checked={value}
          onChange={(e) => setParam(key, e.target.checked)}
        />
      );
    }
    if (Array.isArray(value) && value.length === 3 && typeof value[0] === 'number') {
      return (
        <div style={{ display: 'flex', gap: 4 }}>
          {value.map((v, i) => (
            <input
              key={i}
              data-studio-v3-bp-param={`${key}.${i}`}
              type="number" step="0.01" value={v}
              onChange={(e) => {
                const next = value.slice();
                next[i] = Number(e.target.value);
                setParam(key, next);
              }}
              style={{ ...inputStyle, width: '32%' }}
            />
          ))}
        </div>
      );
    }
    return (
      <input
        data-studio-v3-bp-param={key}
        value={value == null ? '' : String(value)}
        onChange={(e) => setParam(key, e.target.value)}
        style={inputStyle}
      />
    );
  };

  return (
    <div
      data-studio-v3-bp-editor
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{
        position: 'fixed', inset: 0, zIndex: 9400,
        background: 'rgba(13,17,23,0.82)',
        display: 'flex', flexDirection: 'column',
        color: 'var(--studio-ink, #e6edf3)', fontFamily: 'inherit',
      }}
    >
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '10px 16px',
        background: 'var(--studio-bg-elev, #161b22)',
        borderBottom: '1px solid var(--studio-accent, #1de9b6)',
      }}>
        <strong style={{ color: 'var(--studio-accent, #1de9b6)', fontSize: 13, letterSpacing: '0.04em' }}>
          Blueprints
        </strong>
        <span style={{ opacity: 0.55, fontSize: 11, fontFamily: 'var(--studio-mono, ui-monospace)' }}>
          {graph.nodes.size} nodes · {graph.wires.filter((w) => w.kind === 'exec').length} exec · {graph.wires.filter((w) => w.kind === 'data').length} data
        </span>
        <div style={{ flex: 1 }} />
        {listKinds().map((k) => {
          const def = NODE_KINDS[k];
          return (
            <button
              key={k}
              data-studio-v3-bp-add={k}
              onClick={() => addKind(k)}
              style={{
                background: def.category === 'event' ? 'rgba(229, 87, 197, 0.18)'
                  : def.category === 'action' ? 'rgba(245, 197, 66, 0.18)'
                  : 'rgba(122, 208, 109, 0.18)',
                color: 'inherit',
                border: '1px solid rgba(154,166,178,0.35)',
                padding: '3px 7px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
              }}
            >+ {def.title}</button>
          );
        })}
        <button
          data-studio-v3-bp-run
          onClick={() => (isRunning ? onRunStop && onRunStop() : onRunStart && onRunStart())}
          style={{
            background: isRunning ? 'rgba(229,57,53,0.65)' : 'var(--studio-accent, #1de9b6)',
            color: '#0d1117',
            border: 'none', padding: '4px 12px', borderRadius: 4,
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}
        >{isRunning ? 'Stop' : 'Run'}</button>
        <button
          data-studio-v3-bp-close
          onClick={() => onCloseRequest && onCloseRequest()}
          style={{
            background: 'transparent', color: 'inherit',
            border: '1px solid rgba(154,166,178,0.35)',
            padding: '4px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
          }}
        >Close (Esc)</button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Graph canvas */}
        <svg
          ref={svgRef}
          data-studio-v3-bp-svg
          style={{ flex: 1, background: 'rgba(13,17,23,0.35)' }}
          onClick={() => setSelectedId(null)}
        >
          {/* Background grid for orientation */}
          <defs>
            <pattern id="bp-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(154,166,178,0.08)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#bp-grid)" />

          {/* Wires */}
          {graph.wires.map((w, i) => {
            const src = graph.nodes.get(w.srcId);
            const dst = graph.nodes.get(w.dstId);
            if (!src || !dst) return null;
            const sdef = NODE_KINDS[src.kind];
            const ddef = NODE_KINDS[dst.kind];
            const sslot = sdef.outputs.find((o) => o.name === w.srcOut);
            const dslot = ddef.inputs.find((o) => o.name === w.dstIn);
            if (!sslot || !dslot) return null;
            const a = socketCoords(src, sdef, 'output', sslot);
            const b = socketCoords(dst, ddef, 'input', dslot);
            const isExec = w.kind === 'exec';
            const stroke = isExec ? TYPE_COLOR.exec : (TYPE_COLOR[sslot.type] || TYPE_COLOR.any);
            return (
              <path
                key={i}
                data-studio-v3-bp-wire={`${w.kind}:${w.srcId}:${w.srcOut}->${w.dstId}:${w.dstIn}`}
                data-studio-v3-bp-wire-kind={w.kind}
                d={wirePath(a, b)}
                stroke={stroke}
                strokeWidth={isExec ? 2.2 : 1.4}
                fill="none"
                opacity={isExec ? 0.9 : 0.75}
              />
            );
          })}

          {/* Drag-wire preview */}
          {dragRef.current && dragRef.current.kind === 'wire' && (() => {
            const src = graph.nodes.get(dragRef.current.srcId);
            if (!src) return null;
            const sdef = NODE_KINDS[src.kind];
            const sslot = sdef.outputs.find((o) => o.name === dragRef.current.srcOut);
            if (!sslot) return null;
            const a = socketCoords(src, sdef, 'output', sslot);
            const color = dragRef.current.srcExec
              ? TYPE_COLOR.exec
              : (TYPE_COLOR[dragRef.current.srcType] || TYPE_COLOR.any);
            return (
              <path
                d={wirePath(a, { x: dragRef.current.x, y: dragRef.current.y })}
                stroke={color}
                strokeWidth={dragRef.current.srcExec ? 2.2 : 1.4}
                fill="none"
                strokeDasharray="4 3"
                opacity="0.8"
              />
            );
          })()}

          {/* Nodes */}
          {Array.from(graph.nodes.values()).map((n) => {
            const def = NODE_KINDS[n.kind];
            const h = nodeHeight(def);
            const isSel = n.id === selectedId;
            const headerColor =
              def.category === 'event'  ? '#e557c5' :
              def.category === 'action' ? '#f5c542' :
              '#7ad06d';
            return (
              <g
                key={n.id}
                data-studio-v3-bp-node={n.id}
                data-studio-v3-bp-node-kind={n.kind}
                onClick={(e) => { e.stopPropagation(); setSelectedId(n.id); }}
                onMouseDown={(e) => startNodeDrag(e, n)}
              >
                <rect
                  x={n.x} y={n.y} width={NODE_W} height={h} rx={6}
                  fill="rgba(22,27,34,0.94)"
                  stroke={isSel ? 'var(--studio-accent, #1de9b6)' : 'rgba(154,166,178,0.55)'}
                  strokeWidth={isSel ? 1.6 : 0.8}
                />
                <rect
                  x={n.x} y={n.y} width={NODE_W} height={HEADER_H} rx={6}
                  fill={headerColor}
                  opacity="0.22"
                />
                <text
                  x={n.x + 10} y={n.y + 18}
                  fill={headerColor} fontSize="12" fontWeight="700"
                  style={{ pointerEvents: 'none' }}
                >{def.title}</text>

                {/* Input sockets */}
                {def.inputs.map((slot) => {
                  const p = socketCoords(n, def, 'input', slot);
                  const color = isExecSlot(slot) ? TYPE_COLOR.exec : (TYPE_COLOR[slot.type] || TYPE_COLOR.any);
                  return (
                    <g
                      key={`in-${slot.name}`}
                      data-studio-v3-bp-sock-in={slot.name}
                      data-studio-v3-bp-sock-kind={isExecSlot(slot) ? 'exec' : 'data'}
                    >
                      {isExecSlot(slot)
                        ? <ExecGlyph x={p.x} y={p.y} kind="input" filled={false} />
                        : <circle cx={p.x} cy={p.y} r={5} fill="rgba(13,17,23,0.95)" stroke={color} strokeWidth="1.4" />}
                      <text
                        x={p.x + 11} y={p.y + 3}
                        fill="rgba(230,237,243,0.82)" fontSize="10"
                        style={{ pointerEvents: 'none' }}
                      >{slot.name}</text>
                    </g>
                  );
                })}

                {/* Output sockets */}
                {def.outputs.map((slot) => {
                  const p = socketCoords(n, def, 'output', slot);
                  const color = isExecSlot(slot) ? TYPE_COLOR.exec : (TYPE_COLOR[slot.type] || TYPE_COLOR.any);
                  return (
                    <g
                      key={`out-${slot.name}`}
                      data-studio-v3-bp-sock-out={slot.name}
                      data-studio-v3-bp-sock-kind={isExecSlot(slot) ? 'exec' : 'data'}
                      onMouseDown={(e) => startWireDrag(e, n, slot)}
                      style={{ cursor: 'crosshair' }}
                    >
                      {isExecSlot(slot)
                        ? <ExecGlyph x={p.x} y={p.y} kind="output" filled />
                        : <circle cx={p.x} cy={p.y} r={5} fill={color} stroke={color} strokeWidth="1.4" />}
                      <text
                        x={p.x - 11} y={p.y + 3}
                        fill="rgba(230,237,243,0.82)" fontSize="10" textAnchor="end"
                        style={{ pointerEvents: 'none' }}
                      >{slot.name}</text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>

        {/* Props panel */}
        <div
          data-studio-v3-bp-props
          style={{
            width: 280, padding: 14,
            borderLeft: '1px solid rgba(154,166,178,0.3)',
            background: 'var(--studio-bg-elev, #161b22)',
            overflowY: 'auto',
          }}
        >
          {selected && selectedDef ? (
            <div>
              <div style={{
                color: 'var(--studio-accent, #1de9b6)', fontSize: 12,
                fontWeight: 700, marginBottom: 10, letterSpacing: '0.04em',
              }}>{selectedDef.title} · {selectedDef.category}</div>
              {Object.entries(selected.params).length === 0 && (
                <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 12 }}>
                  This node has no editable params.
                </div>
              )}
              {Object.entries(selected.params).map(([key, value]) => (
                <div key={key} style={{ marginBottom: 9, fontSize: 11 }}>
                  <label style={{ display: 'block', opacity: 0.7, marginBottom: 3 }}>{key}</label>
                  {renderParamInput(key, value)}
                </div>
              ))}
              <button
                data-studio-v3-bp-remove
                onClick={removeSelected}
                style={{
                  marginTop: 10, padding: '4px 10px',
                  background: 'rgba(229,57,53,0.22)', color: '#ff7361',
                  border: '1px solid rgba(229,57,53,0.5)', borderRadius: 4,
                  fontSize: 11, cursor: 'pointer',
                }}
              >Remove node</button>
            </div>
          ) : (
            <div style={{ opacity: 0.6, fontSize: 11, lineHeight: 1.5 }}>
              Select a node to edit its parameters.
              <br /><br />
              <strong style={{ color: TYPE_COLOR.exec }}>Yellow triangles</strong> are exec
              wires (control flow). Round pins are data wires, coloured by type.
              <br /><br />
              Drag any output socket onto a matching input to connect.
              Press <strong>Run</strong> to arm OnStart / OnTick / OnKeyDown.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: 3,
  background: 'rgba(13,17,23,0.6)', color: 'inherit',
  border: '1px solid rgba(154,166,178,0.3)', borderRadius: 3,
  fontFamily: 'inherit', fontSize: 11,
};
