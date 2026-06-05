// ArchDisc Studio V3 — minimal ASL script editor.
//
// A floating panel rendered into a body-attached host so we don't have
// to modify StudioShellV3.jsx (per slice constraint). Three columns:
//
//   ┌──────────────────────────────────────────────────────────┐
//   │ ASL editor                          [examples ▼] [Close] │
//   ├──────────────────────────────────────────────────────────┤
//   │  ┌─ textarea ────────────────────┐  ┌─ status ─────────┐ │
//   │  │ y = pos.y;                    │  │ Parses OK · idle │ │
//   │  │ pos.x = pos.x * cos(y);       │  │ Touched: 642     │ │
//   │  │ pos.z = pos.x * sin(y);       │  │ Run on selection │ │
//   │  └───────────────────────────────┘  └──────────────────┘ │
//   └──────────────────────────────────────────────────────────┘
//
// The Run button calls `runOnSelection` from runner.js. Errors render
// with line / column so users can find typos quickly.

import React, { useEffect, useMemo, useState } from 'react';
import { parseScript, runOnSelection, EXAMPLES, EXAMPLE_NAMES } from './runner.js';

export default function Editor({ initialScript, onCloseRequest }) {
  const [text, setText] = useState(initialScript || EXAMPLES['twist-y']);
  const [status, setStatus] = useState({ kind: 'idle', msg: 'ready' });

  // Live parse on every keystroke (debounced) — surfaces syntax errors
  // before the user clicks Run.
  useEffect(() => {
    const h = setTimeout(() => {
      const r = parseScript(text);
      if (r.ok) {
        setStatus((s) =>
          s.kind === 'idle' || s.kind === 'parse-ok' || s.kind === 'parse-err'
            ? { kind: 'parse-ok', msg: 'parses OK' }
            : s,
        );
      } else {
        setStatus({
          kind: 'parse-err',
          msg: `parse error: ${r.error} (line ${r.line}, col ${r.col})`,
        });
      }
    }, 120);
    return () => clearTimeout(h);
  }, [text]);

  const onRun = () => {
    const r = runOnSelection(text);
    if (r.ok) {
      setStatus({ kind: 'run-ok', msg: `ran on ${r.touched} vertices` });
    } else {
      const where = (r.line && r.col) ? ` (line ${r.line}, col ${r.col})` : '';
      setStatus({ kind: 'run-err', msg: `runtime: ${r.error}${where}` });
    }
  };

  const onPickExample = (name) => {
    if (!name || !EXAMPLES[name]) return;
    setText(EXAMPLES[name]);
  };

  const statusColor = useMemo(() => {
    switch (status.kind) {
      case 'parse-err':
      case 'run-err': return '#ff7361';
      case 'run-ok':  return 'var(--studio-accent, #1de9b6)';
      default:        return 'rgba(230,237,243,0.65)';
    }
  }, [status.kind]);

  return (
    <div
      data-studio-v3-vex-editor
      style={{
        position: 'fixed', top: 80, right: 24, width: 520, maxHeight: '70vh', zIndex: 9320,
        background: 'var(--studio-bg-elev, #161b22)',
        border: '1px solid rgba(154,166,178,0.4)',
        borderRadius: 8,
        boxShadow: '0 12px 36px rgba(0,0,0,0.45)',
        color: 'var(--studio-ink, #e6edf3)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        fontFamily: 'inherit',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 14px',
        borderBottom: '1px solid rgba(154,166,178,0.25)',
      }}>
        <strong style={{
          color: 'var(--studio-accent, #1de9b6)', fontSize: 12, letterSpacing: '0.06em',
        }}>
          ASL
        </strong>
        <span style={{
          opacity: 0.6, fontSize: 11,
          fontFamily: 'var(--studio-mono, ui-monospace, Menlo, monospace)',
        }}>per-vertex script</span>
        <div style={{ flex: 1 }} />
        <select
          data-studio-v3-vex-examples
          onChange={(e) => onPickExample(e.target.value)}
          defaultValue=""
          style={{
            background: 'rgba(13,17,23,0.6)', color: 'inherit',
            border: '1px solid rgba(154,166,178,0.3)', borderRadius: 4,
            padding: '3px 6px', fontSize: 11,
          }}
        >
          <option value="" disabled>load example…</option>
          {EXAMPLE_NAMES.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <button
          data-studio-v3-vex-close
          onClick={() => onCloseRequest && onCloseRequest()}
          style={{
            background: 'transparent', color: 'inherit',
            border: '1px solid rgba(154,166,178,0.35)',
            padding: '3px 9px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
          }}
        >Close</button>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <textarea
          data-studio-v3-vex-textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          style={{
            flex: 1, minHeight: 180, resize: 'vertical',
            padding: 10, fontSize: 12, lineHeight: 1.45,
            background: 'rgba(13,17,23,0.7)', color: 'inherit',
            border: 'none', borderBottom: '1px solid rgba(154,166,178,0.2)',
            fontFamily: 'var(--studio-mono, ui-monospace, Menlo, monospace)',
            outline: 'none',
          }}
        />

        {/* Status row */}
        <div
          data-studio-v3-vex-status
          style={{
            padding: '7px 12px', fontSize: 11,
            color: statusColor,
            fontFamily: 'var(--studio-mono, ui-monospace, Menlo, monospace)',
            background: 'rgba(13,17,23,0.45)',
          }}
        >{status.msg}</div>

        {/* Action row */}
        <div style={{
          padding: 10, display: 'flex', gap: 8, justifyContent: 'flex-end',
          background: 'rgba(13,17,23,0.55)',
        }}>
          <button
            data-studio-v3-vex-run
            onClick={onRun}
            style={{
              background: 'var(--studio-accent, #1de9b6)', color: '#0d1117',
              border: 'none', padding: '5px 14px', borderRadius: 4,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >Run on selection</button>
        </div>
      </div>
    </div>
  );
}
