import React, { useState, useEffect, useRef } from 'react';
import './tokens.css';
import { StudioMark, StudioWordmark } from './StudioLogo';
import { Icon } from './Icons';
import { spawnPrimitive } from './spawn';

// Expose for the slice 457 quick-add menu (and any future modal that
// needs to spawn without going through the toolbar React tree).
if (typeof window !== 'undefined') window.__spawnPrimitive = spawnPrimitive;
import Viewport3D from '../../../components/Viewport3D';
import { registerV3Api, unregisterV3Api } from './api';
import { registerEditOps, unregisterEditOps } from './editops';
import { registerCameraOps, unregisterCameraOps } from './cameraops';
import { registerModOps, unregisterModOps } from './modops';
import { registerLightingOps, unregisterLightingOps } from './lightingops';
import { registerAnimPhysOps, unregisterAnimPhysOps } from './animphysops';
import { registerPaintOps, unregisterPaintOps } from './paintops';
import { registerSurfOps, unregisterSurfOps } from './surfops';
import { registerAudioXROps, unregisterAudioXROps } from './audioxrops';
import { registerTerrainVoxOps, unregisterTerrainVoxOps } from './terrainvoxops';
import { registerRemeshOps, unregisterRemeshOps } from './remeshops';
import { registerScriptOps, unregisterScriptOps } from './scriptops';
import { registerMographOps, unregisterMographOps } from './mographops';
import { registerIOOps, unregisterIOOps } from './ioops';
import { registerRefSnapOps, unregisterRefSnapOps } from './refsnapops';
import { registerEditAuxOps, unregisterEditAuxOps } from './editauxops';
import { registerCursorOps, unregisterCursorOps } from './cursorops';
import { registerCameraViewOps, unregisterCameraViewOps } from './cameraviewops';
import { registerSelectionOps, unregisterSelectionOps } from './selectionops';
import { registerMarkerOps, unregisterMarkerOps } from './markerops';
import { registerUtilOps, unregisterUtilOps } from './utilops';
import { registerDisplayOps, unregisterDisplayOps } from './displayops';
// Slice 951 — Studio Tool Registry powers the discipline-aware <tools>
// block in Archie's system prompt. The local LoRAs (studio_v16/<disc>)
// were trained against this exact catalogue per [[archie-fleet-schema]];
// passing it verbatim is what makes Archie fluent in the platform.
import { toolsForDiscipline as _toolsForDiscipline } from '../../../ai/ToolRegistry';
// Slice 951q — close the perception loop. Every runArchie turn captures
// the live viewport, captions it via the local Qwen2.5-VL server on :8081,
// and injects the structured caption into Archie's next user message as
// <viewport_state>…</viewport_state>. The vision wrapper is optional:
// when the caption server is down or the canvas is unavailable, the
// capture skips silently and Archie runs blind (current behaviour).
import { captureAndCaption as _captureAndCaption } from '../../../ai/VisionPerception';
// Slice 951r — long-session memory (Phase A.4). Every runArchie turn
// fetches the top-K most-similar prior turns from the local SQLite
// store (memory_store_server on :8083) and injects them as
// <prior_context>…</prior_context> in the user message. After the
// dispatch, the turn is fire-and-forget remembered back into the store
// so future sessions inherit the context. window.__archieMemoryOff
// pins the legacy path for tests.
import { recallPriorTurns as _recallPriorTurns, rememberTurn as _rememberTurn } from '../../../ai/SessionMemoryClient';

// Slice 401 — V3 stops using V2. V3 owns its own Viewport3D mount + its
// own spawn / selection / undo / file-io implementations (built up in
// subsequent slices). The 206-strong V2 API surface gets ported into
// v3-native modules one batch at a time.

// ArchDisc Studio V3 — application shell.
//
// Mirrors the proven 7-zone CSS-grid architecture from Forge v4:
//   topbar · qat · wb-rail · toolbar · viewport · right · statusbar · cmdbar
//
// Why this layout: every zone has a fixed role and never overlaps another.
// The same shell holds every discipline — the workbench rail picks the
// active discipline, the toolbar swaps out per discipline, the right
// panel cycles through Inspector / Outliner / Layers per discipline.
// The always-on Archie command bar at the bottom is Studio's primary
// natural-language entry point and follows the user across every tool.
//
// Mounted behind ?v3=1 / localStorage.studioV3 — V2 stays default during
// the rollout so the 50+ e2e specs targeting V2 attrs keep passing.

function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

const STORE = 'studio.v3';
const lstor = {
  get: (k, d) => {
    if (typeof localStorage === 'undefined') return d;
    try { const r = localStorage.getItem(`${STORE}.${k}`); return r ? JSON.parse(r) : d; }
    catch { return d; }
  },
  set: (k, v) => {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(`${STORE}.${k}`, JSON.stringify(v)); } catch {}
  },
};

// ─── DISCIPLINES ─────────────────────────────────────────────────────────
// Slice 946 — Studio's canonical 9 disciplines after the Forge-mirror
// redesign. The previous 15-tab set fragmented attention; the 9 below
// match the Blender/Maya idiom and slot every tool into one obvious
// home. Folds:
//   NURBS  → Model (curves/surfaces sub-tools)
//   Paint  → Shade / UV (texture-paint stays as a UV tool)
//   Rig    → Animate (Rig group inside Animate toolbar)
//   FX     → Sim (forces + emitters)
//   World  → Layout
//   Physics → Sim
//   Audio  → Compose
//   XR     → Layout
//   Script → topbar action (not a tab)
//   Archie → footer console only (Slice B)
//
// The dropped disciplines' window.__studio* ops stay registered (see the
// register*Ops imports above) so existing Tool-Registry entries still
// resolve — only the visual tab list shrinks.
const DISCIPLINES = [
  { id: 'model',   label: 'Model',   icon: 'disc-model'   },
  { id: 'sculpt',  label: 'Sculpt',  icon: 'disc-sculpt'  },
  { id: 'uv',      label: 'UV',      icon: 'disc-uv'      },
  { id: 'shade',   label: 'Shade',   icon: 'disc-shade'   },
  { id: 'animate', label: 'Animate', icon: 'disc-animate' },
  { id: 'render',  label: 'Render',  icon: 'disc-render'  },
  { id: 'compose', label: 'Compose', icon: 'disc-compose' },
  { id: 'sim',     label: 'Sim',     icon: 'disc-sim'     },
  { id: 'layout',  label: 'Layout',  icon: 'disc-layout'  },
];

// Toolbar groups per discipline. Each group is a labelled cluster of
// tools; tool ids map into Icons.jsx names so the glyph stays crisp.
// Slice 946: group set rebuilt to give each canonical discipline a
// 3-6 column ribbon that fits at 1920px without horizontal overflow.
// Tool names re-use the existing Icons.jsx catalogue (no new icons
// introduced this slice — Slice D ships the bulk icon authoring).
const TOOLBAR = {
  model: [
    { label: 'Add',       tools: ['cube', 'sphere', 'plane', 'cylinder', 'cone', 'torus', 'icosahedron', 'text', 'curve', 'empty'] },
    { label: 'Transform', tools: ['select', 'move', 'rotate', 'scale'] },
    { label: 'Mesh',      tools: ['extrude', 'inset', 'subdivide', 'bevel', 'mirror'] },
    { label: 'NURBS',     tools: ['curve', 'cylinder', 'extrude', 'subdivide'] },
    { label: 'View',      tools: ['eye', 'camera', 'light', 'material'] },
  ],
  sculpt: [
    { label: 'Brush',     tools: ['select', 'move', 'scale', 'extrude'] },
    { label: 'Smooth',    tools: ['subdivide', 'inset', 'bevel'] },
    { label: 'Symmetry',  tools: ['mirror'] },
    { label: 'View',      tools: ['eye', 'material'] },
  ],
  uv: [
    { label: 'Unwrap',    tools: ['cube', 'sphere', 'plane', 'cylinder'] },
    { label: 'Edit',      tools: ['select', 'move', 'rotate', 'scale'] },
    { label: 'Paint',     tools: ['extrude', 'inset', 'material'] },
    { label: 'View',      tools: ['eye'] },
  ],
  shade: [
    { label: 'Materials', tools: ['material', 'eye'] },
    { label: 'Nodes',     tools: ['cube', 'sphere', 'curve'] },
    { label: 'Bake',      tools: ['extrude', 'inset', 'subdivide'] },
    { label: 'Preview',   tools: ['camera', 'light'] },
  ],
  animate: [
    { label: 'Playback',  tools: ['play', 'pause'] },
    { label: 'Keys',      tools: ['extrude', 'inset', 'bevel'] },
    { label: 'Rig',       tools: ['move', 'rotate', 'mirror'] },
    { label: 'Curves',    tools: ['curve', 'subdivide'] },
    { label: 'View',      tools: ['eye', 'camera'] },
  ],
  render: [
    { label: 'Capture',   tools: ['camera', 'eye', 'play'] },
    { label: 'Camera',    tools: ['camera', 'move', 'scale'] },
    { label: 'Light',     tools: ['light', 'material'] },
    { label: 'Engine',    tools: ['play', 'pause', 'eye'] },
    { label: 'Output',    tools: ['settings'] },
  ],
  compose: [
    { label: 'Inputs',    tools: ['cube', 'sphere', 'plane'] },
    { label: 'Filters',   tools: ['extrude', 'inset', 'subdivide', 'bevel'] },
    { label: 'Audio',     tools: ['curve', 'play', 'pause'] },
    { label: 'Output',    tools: ['settings'] },
  ],
  sim: [
    { label: 'Bodies',    tools: ['cube', 'sphere', 'torus'] },
    { label: 'Forces',    tools: ['move', 'rotate', 'scale'] },
    { label: 'Fluids',    tools: ['curve', 'subdivide', 'extrude'] },
    { label: 'Bake',      tools: ['play', 'pause'] },
  ],
  layout: [
    { label: 'Scene',     tools: ['cube', 'sphere', 'plane', 'cylinder', 'icosahedron'] },
    { label: 'Camera',    tools: ['camera', 'move'] },
    { label: 'Light',     tools: ['light', 'material'] },
    { label: 'XR',        tools: ['eye', 'select'] },
  ],
};

const EDIT_MODES = [
  { id: 'object', label: 'Object', icon: 'object-mode' },
  { id: 'vertex', label: 'Vertex', icon: 'vertex-mode' },
  { id: 'edge',   label: 'Edge',   icon: 'edge-mode'   },
  { id: 'face',   label: 'Face',   icon: 'face-mode'   },
  { id: 'sculpt', label: 'Sculpt', icon: 'sculpt-mode' },
];

const AXES = [
  { id: 'top',   label: 'T' },
  { id: 'front', label: 'F' },
  { id: 'side',  label: 'S' },
  { id: 'persp', label: 'P' },
];

// ─── TopBar ───────────────────────────────────────────────────────────────
// Slice 505 — Archie status dot. Pings localhost:8080 on mount + every
// 20 s; pulses teal when reachable, dims when not. Distinct ArchDisc
// brand signal — the Archie fleet is part of Studio's identity.
function ArchieStatusDot() {
  const [state, setState] = useState('unknown');
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 1500);
        const r = await fetch('http://localhost:8080/v1/models', { signal: ac.signal });
        clearTimeout(t);
        if (alive) setState(r.ok ? 'online' : 'offline');
      } catch (_) { if (alive) setState('offline'); }
    };
    ping();
    const id = setInterval(ping, 20_000);
    const onStream = () => setState('streaming');
    window.addEventListener('archie-stream-start', onStream);
    return () => { alive = false; clearInterval(id); window.removeEventListener('archie-stream-start', onStream); };
  }, []);
  const color = state === 'online' || state === 'streaming' ? 'var(--studio-accent, #ebecef)' : 'var(--studio-ink-faint, #3d4250)';
  return (
    <span
      data-studio-v3-archie-status
      data-studio-v3-archie-state={state}
      title={`Archie · ${state}`}
      style={{
        display: 'inline-flex', alignItems: 'center', marginLeft: 10, gap: 4,
      }}
    >
      <span
        style={{
          width: 7, height: 7, borderRadius: '50%', background: color,
          boxShadow: state === 'streaming' ? `0 0 8px ${color}` : 'none',
          animation: state === 'streaming' ? 'studio-pulse 1.2s ease-in-out infinite' : 'none',
        }}
      />
      <span style={{
        fontSize: 10, color: 'var(--studio-ink-mute, #9aa6b2)',
        letterSpacing: '0.05em', textTransform: 'uppercase',
      }}>Archie</span>
    </span>
  );
}

function TopBar({ onCycleTheme, theme }) {
  return (
    <div className="studio-topbar" data-studio-v3-topbar>
      <div className="studio-topbar-brand">
        <StudioMark size={18} ink="var(--studio-ink)" />
        <StudioWordmark size={12} color="var(--studio-ink)" />
        <ArchieStatusDot />
      </div>
      <div className="studio-topbar-menus">
        {['File', 'Edit', 'Select', 'View', 'Window', 'Help'].map((m) => (
          <button
            key={m}
            type="button"
            className="studio-topbar-menu"
            data-studio-v3-menu={m.toLowerCase()}
            onClick={() => {
              // Slice 509 — Help opens the About modal.
              if (m === 'Help') window.dispatchEvent(new CustomEvent('studio-about-open'));
              // Slice 550 — File menu opens a floating actions panel.
              else if (m === 'File') window.dispatchEvent(new CustomEvent('studio-file-menu-toggle'));
              // Slice 551 — Edit menu opens a floating actions panel.
              else if (m === 'Edit') window.dispatchEvent(new CustomEvent('studio-edit-menu-toggle'));
              // Slice 552 — Select menu.
              else if (m === 'Select') window.dispatchEvent(new CustomEvent('studio-select-menu-toggle'));
              // Slice 553 — View menu.
              else if (m === 'View') window.dispatchEvent(new CustomEvent('studio-view-menu-toggle'));
              // Slice 554 — Window menu.
              else if (m === 'Window') window.dispatchEvent(new CustomEvent('studio-window-menu-toggle'));
            }}
          >{m}</button>
        ))}
      </div>
      <div className="studio-topbar-spacer" />
      <button
        type="button"
        className="studio-topbar-menu"
        data-studio-v3-theme-toggle
        onClick={onCycleTheme}
        title="Toggle theme (Cmd+T)"
      >{theme === 'dark' ? 'Dark' : 'Light'}</button>
    </div>
  );
}

// ─── QuickAccessBar ───────────────────────────────────────────────────────
function QuickAccessBar({ onAction }) {
  // Slice 446 — Add export (GLTF) between save and undo. Tooltips spell
  // out the hotkey so users discover it.
  const items = [
    { id: 'new',      icon: 'empty',    label: 'New (clear scene)' },
    { id: 'open',     icon: 'tshelf',   label: 'Open · Cmd+O' },
    { id: 'save',     icon: 'check',    label: 'Save · Cmd+S' },
    { id: 'export',   icon: 'tshelf',   label: 'Export GLTF · Cmd+E' },
    null,
    { id: 'undo',     icon: 'undo',     label: 'Undo · Cmd+Z' },
    { id: 'redo',     icon: 'redo',     label: 'Redo · Cmd+Shift+Z' },
    null,
    { id: 'play',     icon: 'play',     label: 'Play · Space' },
    { id: 'pause',    icon: 'pause',    label: 'Pause · Space' },
    null,
    { id: 'settings', icon: 'settings', label: 'Settings' },
  ];
  return (
    <div className="studio-qat" data-studio-v3-qat>
      {items.map((it, i) => it ? (
        <button
          key={it.id}
          type="button"
          className="studio-qat-btn"
          data-studio-v3-qat-btn={it.id}
          title={it.label}
          onClick={() => onAction && onAction(it.id)}
        ><Icon name={it.icon} size={13} /></button>
      ) : (
        <span key={`s-${i}`} className="studio-qat-sep" />
      ))}
    </div>
  );
}

// Slice 528 — Live primitive-count badge per Add-group tool button.
// Polls the scene every 700 ms so manual adds, undo + Archie spawns all
// reflect.
function ToolKindBadge({ kind }) {
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    const read = () => {
      const s = window.__archdiscScene;
      if (!s) return;
      let c = 0;
      try {
        s.traverse((o) => {
          if (o.userData && o.userData.archdiscStudioPrimitive
              && o.userData.archdiscStudioPrimitiveKind === kind) c++;
        });
      } catch (_) {}
      setN(c);
    };
    const id = setInterval(read, 700);
    read();
    return () => clearInterval(id);
  }, [kind]);
  if (!n) return null;
  return (
    <span
      data-studio-v3-tool-badge={kind}
      data-studio-v3-tool-badge-count={n}
      style={{
        position: 'absolute', top: -3, right: -3,
        background: 'var(--studio-accent, #ebecef)', color: 'var(--studio-canvas, #000000)',
        borderRadius: 8, padding: '0 4px', fontSize: 9, lineHeight: '13px',
        fontFamily: 'var(--studio-mono, ui-monospace)', minWidth: 13, textAlign: 'center',
        boxShadow: '0 0 0 1px var(--studio-canvas, #000000)',
      }}
    >{n > 99 ? '99+' : n}</span>
  );
}

// ─── WorkbenchRail (left, 15 disciplines) ────────────────────────────────
function WorkbenchRail({ activeId, onSwitch }) {
  return (
    <div className="studio-wb-rail" data-studio-v3-wb-rail>
      {DISCIPLINES.map((d) => (
        <button
          key={d.id}
          type="button"
          className="studio-wb-tab"
          data-studio-v3-wb={d.id}
          data-active={d.id === activeId ? 'true' : 'false'}
          title={d.label}
          onClick={() => onSwitch(d.id)}
        >
          <span className="studio-wb-tab-glyph"><Icon name={d.icon} size={22} /></span>
          <span className="studio-wb-tab-label">{d.label}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Toolbar (per-discipline) ─────────────────────────────────────────────
// Primitive tools (cube/sphere/etc) spawn instantly on click; transform
// tools toggle into the active-tool slot; mesh ops run on the current
// selection; view tools are deferred to slice 396+. The discriminator is
// the GROUP label — Add groups always spawn, Transform groups always
// toggle. Keeps the click semantics predictable per discipline.
const PRIMITIVE_KINDS = new Set([
  'cube', 'sphere', 'plane', 'cylinder', 'cone', 'torus',
  'icosahedron', 'text', 'curve', 'empty',
]);
const TRANSFORM_TOOLS = new Set(['select', 'move', 'rotate', 'scale']);

function Toolbar({ wbId, activeTool, setTool, onInvoke }) {
  const groups = TOOLBAR[wbId] || TOOLBAR.model;
  return (
    <div className="studio-toolbar" data-studio-v3-toolbar>
      {groups.map((g, i) => (
        <div key={`${g.label}-${i}`} className="studio-toolbar-group" data-studio-v3-toolbar-group={g.label.toLowerCase()}>
          <span className="studio-toolbar-group-label">{g.label}</span>
          {g.tools.map((t) => {
            const isTransform = g.label === 'Transform' || TRANSFORM_TOOLS.has(t);
            const active = isTransform && t === activeTool;
            const isAddTool = g.label === 'Add';
            return (
              <button
                key={t}
                type="button"
                className="studio-tool"
                data-studio-v3-tool={t}
                data-studio-v3-tool-group={g.label.toLowerCase()}
                data-active={active ? 'true' : 'false'}
                title={t}
                onClick={() => {
                  if (isTransform) setTool(t);
                  else onInvoke && onInvoke(t, g.label.toLowerCase());
                }}
                style={{ position: 'relative' }}
              >
                <Icon name={t} size={16} />
                {isAddTool && <ToolKindBadge kind={t} />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── QuickAddMenu (slice 457) ─────────────────────────────────────────────
// Shift+A opens a Blender-style quick-add list at the cursor — pick a
// primitive to spawn it instantly. Esc / outside click / pick dismisses.
function QuickAddMenu() {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const onKey = (e) => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if ((e.key === 'A' || e.key === 'a') && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        // Position near the centre of the viewport.
        const vp = document.querySelector('[data-studio-v3-viewport]');
        if (vp) {
          const r = vp.getBoundingClientRect();
          setPos({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
        } else {
          setPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        }
      } else if (e.key === 'Escape' && pos) {
        setPos(null);
      }
    };
    const onDown = (e) => {
      if (!pos) return;
      const inside = e.target && e.target.closest && e.target.closest('[data-studio-v3-quick-add]');
      if (!inside) setPos(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [pos]);
  if (!pos) return null;
  const items = [
    'cube', 'sphere', 'plane', 'cylinder', 'cone', 'torus', 'icosahedron', 'empty',
  ];
  return (
    <div
      data-studio-v3-quick-add
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 9100,
        background: 'var(--studio-canvas-2, #0a0a0a)',
        border: '1px solid var(--studio-rail-edge, #1d2027)',
        borderRadius: 4, padding: '4px 0', minWidth: 160,
        boxShadow: '0 4px 16px rgba(0,0,0,0.55)',
        fontFamily: 'inherit', fontSize: 11,
        color: 'var(--studio-ink, #f0eee6)',
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div style={{
        padding: '4px 10px 6px',
        opacity: 0.55, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
        borderBottom: '1px solid var(--studio-rail-edge, #1d2027)', marginBottom: 4,
      }}>Add</div>
      {items.map((kind) => (
        <button
          key={kind}
          type="button"
          data-studio-v3-quick-add-item={kind}
          onClick={() => {
            const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
            if (s && window.__spawnPrimitive) {
              window.__spawnPrimitive(kind, s);
            } else if (s) {
              // Fallback: dispatch a synthetic toolbar click.
              const btn = document.querySelector(`[data-studio-v3-tool="${kind}"][data-studio-v3-tool-group="add"]`);
              if (btn) btn.click();
            }
            setPos(null);
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--studio-surface-2, #1f1f1f)'; e.currentTarget.style.color = 'var(--studio-ink, #f0eee6)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--studio-ink, #f0eee6)'; }}
          style={{
            display: 'block', width: '100%', padding: '4px 12px',
            background: 'transparent', color: 'inherit',
            border: 'none', cursor: 'pointer', textAlign: 'left',
            fontFamily: 'inherit', fontSize: 11, textTransform: 'capitalize',
          }}
        >{kind}</button>
      ))}
    </div>
  );
}

// ─── MarkingMenu (slice 456) ──────────────────────────────────────────────
// Shift+right-click in the viewport opens an 8-direction radial menu of
// common ops (Maya hotbox parity). The user can immediately click an
// item, or hover-out → menu closes on next mousedown.
function MarkingMenu() {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const onCtx = (e) => {
      // Only Shift+right-click in the viewport canvas.
      if (!e.shiftKey) return;
      const target = e.target;
      if (!target || !target.closest || !target.closest('[data-studio-v3-viewport]')) return;
      e.preventDefault();
      e.stopPropagation();
      setPos({ x: e.clientX, y: e.clientY });
    };
    const onClick = (e) => {
      if (!pos) return;
      const inside = e.target && e.target.closest && e.target.closest('[data-studio-v3-marking-menu]');
      if (!inside) setPos(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setPos(null); };
    window.addEventListener('contextmenu', onCtx, true);  // capture so it runs before ContextMenu
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('contextmenu', onCtx, true);
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [pos]);
  if (!pos) return null;
  // 8 cardinal directions; each holds a single op.
  const r = 64;
  const items = [
    { angle: -90, label: 'Frame',    call: () => window.__studioFitSelected && window.__studioFitSelected() },
    { angle: -45, label: 'Duplicate', call: () => {
      const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
      const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
      if (!sel || !s) return;
      const c = sel.clone();
      if (c.geometry) c.geometry = c.geometry.clone();
      if (c.material && c.material.clone) c.material = c.material.clone();
      c.position.set(sel.position.x + 0.02, sel.position.y, sel.position.z + 0.02);
      c.name = (sel.name || 'mesh') + '-copy';
      s.add(c);
      if (window.__studioSelectMesh) window.__studioSelectMesh(c);
    } },
    { angle: 0,   label: 'Move',     call: () => { const vp = window.__archdiscViewport; if (vp && vp.transformControls) vp.transformControls.setMode('translate'); } },
    { angle: 45,  label: 'Rotate',   call: () => { const vp = window.__archdiscViewport; if (vp && vp.transformControls) vp.transformControls.setMode('rotate'); } },
    { angle: 90,  label: 'Scale',    call: () => { const vp = window.__archdiscViewport; if (vp && vp.transformControls) vp.transformControls.setMode('scale'); } },
    { angle: 135, label: 'Hide',     call: () => { const sel = window.__studioSelectedMesh && window.__studioSelectedMesh(); if (sel) sel.visible = false; } },
    { angle: 180, label: 'Delete',   call: () => {
      const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
      const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
      if (sel && s) {
        if (window.__studioPushUndo) window.__studioPushUndo();
        if (sel.geometry) sel.geometry.dispose();
        if (sel.material && sel.material.dispose) sel.material.dispose();
        s.remove(sel);
        if (window.__studioDeselect) window.__studioDeselect();
      }
    } },
    { angle: -135, label: 'Select All', call: () => window.__studioSelectAll && window.__studioSelectAll() },
  ];
  return (
    <div
      data-studio-v3-marking-menu
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 9050,
        width: 0, height: 0, pointerEvents: 'none',
      }}
    >
      {/* Centre dot — monochrome warm-white per slice 946 (no accent). */}
      <div style={{
        position: 'absolute', left: -3, top: -3, width: 6, height: 6,
        borderRadius: 3, background: 'var(--studio-accent, #ebecef)',
      }} />
      {items.map((it) => {
        const rad = (it.angle * Math.PI) / 180;
        const x = Math.cos(rad) * r;
        const y = Math.sin(rad) * r;
        return (
          <button
            key={it.label}
            type="button"
            data-studio-v3-marking-item={it.label.toLowerCase().replace(/\s+/g, '-')}
            onClick={() => { it.call(); setPos(null); }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--studio-surface-2, #1f1f1f)'; e.currentTarget.style.color = 'var(--studio-ink, #f0eee6)'; e.currentTarget.style.borderColor = 'var(--studio-accent-rim, rgba(255,255,255,0.28))'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--studio-canvas-3, #14161b)'; e.currentTarget.style.color = 'var(--studio-ink, #f0eee6)'; e.currentTarget.style.borderColor = 'var(--studio-rail-edge, #1d2027)'; }}
            style={{
              position: 'absolute',
              left: x - 36, top: y - 12,
              width: 72, height: 24,
              background: 'var(--studio-canvas-3, #14161b)',
              color: 'var(--studio-ink, #f0eee6)',
              border: '1px solid var(--studio-rail-edge, #1d2027)',
              borderRadius: 12,
              fontSize: 10, cursor: 'pointer',
              pointerEvents: 'auto',
              boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
              padding: '0 6px', whiteSpace: 'nowrap',
              fontFamily: 'inherit',
            }}
          >{it.label}</button>
        );
      })}
    </div>
  );
}

// ─── ContextMenu (slice 447) ──────────────────────────────────────────────
// Right-click in the viewport opens a small floating list of common ops
// against the active mesh: Duplicate / Hide / Frame / Delete. Esc, click-
// outside, or pick-an-item dismisses. Studio teal accent on hover.
function ContextMenu() {
  const [pos, setPos] = useState(null); // { x, y } or null
  useEffect(() => {
    const onCtx = (e) => {
      // Only fire on viewport canvas right-clicks.
      const target = e.target;
      if (!target || !target.closest || !target.closest('[data-studio-v3-viewport]')) return;
      e.preventDefault();
      setPos({ x: e.clientX, y: e.clientY });
    };
    const onClick = (e) => {
      if (!pos) return;
      // Close on any outside click.
      const inside = e.target && e.target.closest && e.target.closest('[data-studio-v3-context-menu]');
      if (!inside) setPos(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setPos(null); };
    window.addEventListener('contextmenu', onCtx);
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [pos]);
  if (!pos) return null;
  const items = [
    { id: 'duplicate', label: 'Duplicate', hint: 'Shift+D', call: () => {
      const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
      const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
      if (!sel || !s) return;
      const clone = sel.clone();
      if (clone.geometry) clone.geometry = clone.geometry.clone();
      if (Array.isArray(clone.material)) clone.material = clone.material.map((m) => m.clone());
      else if (clone.material) clone.material = clone.material.clone();
      clone.position.set(sel.position.x + 0.02, sel.position.y, sel.position.z + 0.02);
      clone.userData = { ...sel.userData };
      clone.name = (sel.name || 'mesh') + '-copy';
      s.add(clone);
      if (window.__studioSelectMesh) window.__studioSelectMesh(clone);
    } },
    { id: 'hide', label: 'Hide', hint: 'H', call: () => {
      const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
      if (sel) sel.visible = false;
    } },
    { id: 'frame', label: 'Frame', hint: '.', call: () => {
      if (window.__studioFitSelected) window.__studioFitSelected();
    } },
    { id: 'delete', label: 'Delete', hint: 'X', call: () => {
      const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
      const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
      if (sel && s) {
        if (window.__studioPushUndo) window.__studioPushUndo();
        if (sel.geometry) sel.geometry.dispose();
        if (Array.isArray(sel.material)) sel.material.forEach((m) => m.dispose && m.dispose());
        else if (sel.material && sel.material.dispose) sel.material.dispose();
        s.remove(sel);
        if (window.__studioDeselect) window.__studioDeselect();
      }
    } },
  ];
  return (
    <div
      data-studio-v3-context-menu
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 8000,
        background: 'var(--studio-canvas, #000000)',
        border: '1px solid var(--studio-rail-edge, #1d2027)',
        borderRadius: 4, padding: '4px 0', minWidth: 140,
        boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
        fontFamily: 'inherit', fontSize: 11,
        color: 'var(--studio-ink, #f0eee6)',
      }}
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          data-studio-v3-context-item={it.id}
          onClick={(e) => { e.stopPropagation(); it.call(); setPos(null); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--studio-accent, #ebecef)'; e.currentTarget.style.color = 'var(--studio-canvas, #000000)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--studio-ink, #f0eee6)'; }}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            width: '100%', padding: '4px 10px',
            background: 'transparent', color: 'inherit',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11,
            textAlign: 'left',
          }}
        >
          <span>{it.label}</span>
          <code style={{ opacity: 0.6, fontSize: 10, fontFamily: 'var(--studio-mono, ui-monospace)' }}>{it.hint}</code>
        </button>
      ))}
    </div>
  );
}

// ─── SettingsModal (slice 454) ───────────────────────────────────────────
// Lightweight preferences panel surfaced via QAT settings or 'studio-
// settings-toggle' custom event. Theme + shading + bg color today;
// follow-up slices wire more.
function SettingsModal() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState('dark');
  const [bg, setBg] = useState('#000000');
  const [shading, setShading] = useState('solid');
  const [accent, setAccent] = useState(() => {
    // Forge is fully MONOCHROME — the accent is the monochrome token
    // (white in dark / graphite in light), never a chromatic colour. We
    // default to '' which means "inherit --studio-accent from tokens.css".
    // Migrate away the old teal default (#1de9b6 / #0fd4a6) that earlier
    // builds persisted so existing users also go monochrome.
    try {
      const v = window.localStorage.getItem('studio.v3.accent');
      if (!v || v === '#1de9b6' || v === '#0fd4a6') return '';
      return v;
    } catch (_) { return ''; }
  });
  // Slice 744 — apply a CUSTOM accent only when the user explicitly set one.
  // Empty string = inherit the monochrome token (Forge parity), so we clear
  // any prior inline override instead of forcing teal.
  useEffect(() => {
    if (accent) {
      document.documentElement.style.setProperty('--studio-accent', accent);
    } else {
      document.documentElement.style.removeProperty('--studio-accent');
    }
    try {
      if (accent) window.localStorage.setItem('studio.v3.accent', accent);
      else window.localStorage.removeItem('studio.v3.accent');
    } catch (_) {}
  }, [accent]);
  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e) => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('studio-settings-toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('studio-settings-toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    // Sync current state when opening.
    setTheme(document.documentElement.getAttribute('data-studio-theme') || 'dark');
    setBg(window.__studioBgColor || '#000000');
    setShading((window.__studioGetShadingMode && window.__studioGetShadingMode()) || 'solid');
  }, [open]);
  if (!open) return null;
  return (
    <div
      data-studio-v3-settings
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 9100,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          minWidth: 360, maxWidth: 480, width: '88vw',
          background: 'var(--studio-canvas, #000000)',
          border: '1px solid var(--studio-rail-edge, #1d2027)',
          borderRadius: 8, padding: '20px 24px',
          color: 'var(--studio-ink, #f0eee6)',
          fontFamily: 'inherit', fontSize: 12,
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.55)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
          <strong style={{ fontSize: 14, color: 'var(--studio-accent, #ebecef)', letterSpacing: '0.04em' }}>Settings</strong>
          <span style={{ opacity: 0.5, fontSize: 10, fontFamily: 'var(--studio-mono, ui-monospace)' }}>Esc to close</span>
        </div>
        {/* Slice 523 — accent color */}
        <div data-studio-v3-settings-section="accent" style={{ marginBottom: 12 }}>
          <div style={{ opacity: 0.55, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Accent</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="color"
              data-studio-v3-settings-accent
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              style={{
                width: 38, height: 24, padding: 0,
                background: 'transparent',
                border: '1px solid var(--studio-rail-edge, #1d2027)',
                borderRadius: 3, cursor: 'pointer',
              }}
            />
            <span style={{ fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 11, opacity: 0.75 }}>{accent}</span>
            <button
              type="button"
              onClick={() => setAccent('')}
              style={{
                marginLeft: 'auto', padding: '2px 8px', fontSize: 10,
                background: 'transparent', border: '1px solid var(--studio-rail-edge, #1d2027)',
                color: 'var(--studio-ink, #f0eee6)', borderRadius: 3, cursor: 'pointer',
              }}
            >Reset</button>
          </div>
        </div>
        {/* Theme */}
        <div data-studio-v3-settings-section="theme" style={{ marginBottom: 12 }}>
          <div style={{ opacity: 0.55, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Theme</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['dark', 'light'].map((t) => (
              <button
                key={t}
                type="button"
                data-studio-v3-settings-theme={t}
                data-active={t === theme ? 'true' : 'false'}
                onClick={() => {
                  setTheme(t);
                  document.documentElement.setAttribute('data-studio-theme', t);
                  try { window.localStorage.setItem('studio.v3.theme', t); } catch (_) {}
                }}
                style={{
                  flex: 1, padding: '4px 10px',
                  background: t === theme ? 'var(--studio-accent, #ebecef)' : 'var(--studio-canvas-3, #141414)',
                  color: t === theme ? 'var(--studio-canvas, #000000)' : 'var(--studio-ink, #f0eee6)',
                  border: '1px solid var(--studio-rail-edge, #1d2027)',
                  borderRadius: 3, cursor: 'pointer',
                  textTransform: 'capitalize', fontSize: 11,
                }}
              >{t}</button>
            ))}
          </div>
        </div>
        {/* Shading */}
        <div data-studio-v3-settings-section="shading" style={{ marginBottom: 12 }}>
          <div style={{ opacity: 0.55, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Shading (Z to cycle)</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['wire', 'solid', 'material', 'rendered'].map((s) => (
              <button
                key={s}
                type="button"
                data-studio-v3-settings-shading={s}
                data-active={s === shading ? 'true' : 'false'}
                onClick={() => {
                  setShading(s);
                  if (window.__studioSetShadingMode) window.__studioSetShadingMode(s);
                }}
                style={{
                  flex: 1, padding: '4px 10px',
                  background: s === shading ? 'var(--studio-accent, #ebecef)' : 'var(--studio-canvas-3, #141414)',
                  color: s === shading ? 'var(--studio-canvas, #000000)' : 'var(--studio-ink, #f0eee6)',
                  border: '1px solid var(--studio-rail-edge, #1d2027)',
                  borderRadius: 3, cursor: 'pointer',
                  textTransform: 'capitalize', fontSize: 11,
                }}
              >{s}</button>
            ))}
          </div>
        </div>
        {/* HDRI Environment — slice 468. */}
        <HDRIPickerRow />
        {/* Sun angle — slice 469. */}
        <SunAngleRow />
        {/* Render quality — slice 474. */}
        <RenderQualityRow />
        {/* Restore autosave — slice 475. */}
        <RestoreAutosaveRow />
        {/* Background color */}
        <div data-studio-v3-settings-section="bg" style={{ marginBottom: 16 }}>
          <div style={{ opacity: 0.55, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Background color</div>
          <input
            type="color"
            data-studio-v3-settings-bg
            value={bg}
            onChange={(e) => {
              const hex = e.target.value;
              setBg(hex);
              if (window.__studioSetBgColor) window.__studioSetBgColor(hex);
            }}
            style={{ width: 60, height: 28, padding: 0, border: '1px solid var(--studio-rail-edge, #1d2027)', borderRadius: 3, background: 'transparent' }}
          />
        </div>
        <button
          type="button"
          data-studio-v3-settings-close
          onClick={() => setOpen(false)}
          style={{
            display: 'block', marginLeft: 'auto',
            padding: '6px 14px',
            background: 'var(--studio-canvas-3, #141414)',
            color: 'var(--studio-ink, #f0eee6)',
            border: '1px solid var(--studio-rail-edge, #1d2027)',
            borderRadius: 3, cursor: 'pointer', fontSize: 11,
          }}
        >Done</button>
      </div>
    </div>
  );
}

// Slice 475 — Restore-last-autosave row for the Settings modal.
function RestoreAutosaveRow() {
  const [ts, setTs] = React.useState(0);
  React.useEffect(() => {
    const read = () => setTs(Number(window.localStorage.getItem('archdisc.studio.autosave.ts') || 0));
    read();
    const id = setInterval(read, 1000);
    return () => clearInterval(id);
  }, []);
  if (!ts) return null;
  const age = Math.round((Date.now() - ts) / 1000);
  return (
    <div data-studio-v3-settings-section="restore" style={{ marginBottom: 12 }}>
      <div style={{ opacity: 0.55, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Autosave</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, fontSize: 11, opacity: 0.75 }}>Last save: {age}s ago</span>
        <button
          type="button"
          data-studio-v3-settings-restore
          onClick={() => {
            if (window.__studioRestoreAutosave) {
              const r = window.__studioRestoreAutosave();
              if (r && r.ok) window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
            }
          }}
          style={{
            padding: '4px 12px', fontSize: 11,
            background: 'var(--studio-accent, #ebecef)',
            color: 'var(--studio-canvas, #000000)',
            border: 'none', borderRadius: 3, cursor: 'pointer',
            fontFamily: 'inherit', fontWeight: 600,
          }}
        >Restore</button>
      </div>
    </div>
  );
}

// Slice 474 — Render quality controls for the Settings modal.
function RenderQualityRow() {
  const [pr, setPr] = React.useState(() => (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const [sq, setSq] = React.useState('medium');
  if (!window.__studioSetPixelRatio && !window.__studioSetShadowQuality) return null;
  return (
    <div data-studio-v3-settings-section="render" style={{ marginBottom: 12 }}>
      <div style={{ opacity: 0.55, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Render quality</div>
      {window.__studioSetPixelRatio && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, marginBottom: 4 }}>
          <span style={{ width: 76, opacity: 0.7 }}>Pixel ratio</span>
          <input
            type="range" min="0.5" max="3" step="0.1"
            data-studio-v3-settings-pixel-ratio
            value={pr}
            onChange={(e) => { const v = parseFloat(e.target.value); setPr(v); window.__studioSetPixelRatio(v); }}
            style={{ flex: 1 }}
          />
          <span style={{ width: 28, textAlign: 'right', fontFamily: 'var(--studio-mono)', opacity: 0.7 }}>{pr.toFixed(1)}</span>
        </label>
      )}
      {window.__studioSetShadowQuality && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
          <span style={{ width: 76, opacity: 0.7 }}>Shadows</span>
          <select
            data-studio-v3-settings-shadow-quality
            value={sq}
            onChange={(e) => { setSq(e.target.value); window.__studioSetShadowQuality(e.target.value); }}
            style={{
              flex: 1, padding: '2px 4px', fontSize: 11,
              background: 'var(--studio-canvas-3, #1f1f1f)',
              color: 'var(--studio-ink, #dfe5ea)',
              border: '1px solid var(--studio-ink-mute, #2c2c30)',
              borderRadius: 2, fontFamily: 'inherit',
            }}
          >
            <option value="off">Off</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
      )}
    </div>
  );
}

// Slice 469 — Two-axis sun-angle slider for the Settings modal.
function SunAngleRow() {
  const [az, setAz] = React.useState(0);
  const [el, setEl] = React.useState(0.785);
  if (!window.__studioSetSunAngle) return null;
  const apply = (newAz, newEl) => {
    // V3 setSunAngle takes (azDeg, elDeg) — translate radians to degrees.
    window.__studioSetSunAngle(newAz * 180 / Math.PI, newEl * 180 / Math.PI);
  };
  return (
    <div data-studio-v3-settings-section="sun" style={{ marginBottom: 12 }}>
      <div style={{ opacity: 0.55, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Sun angle</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
          <span style={{ width: 64, opacity: 0.7 }}>Azimuth</span>
          <input
            type="range" min="0" max={Math.PI * 2} step="0.05"
            data-studio-v3-settings-sun-azimuth
            value={az}
            onChange={(e) => { const v = parseFloat(e.target.value); setAz(v); apply(v, el); }}
            style={{ flex: 1 }}
          />
          <span style={{ width: 36, textAlign: 'right', fontFamily: 'var(--studio-mono)', opacity: 0.7 }}>{(az * 180 / Math.PI).toFixed(0)}°</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
          <span style={{ width: 64, opacity: 0.7 }}>Elevation</span>
          <input
            type="range" min="0" max={Math.PI / 2} step="0.02"
            data-studio-v3-settings-sun-elevation
            value={el}
            onChange={(e) => { const v = parseFloat(e.target.value); setEl(v); apply(az, v); }}
            style={{ flex: 1 }}
          />
          <span style={{ width: 36, textAlign: 'right', fontFamily: 'var(--studio-mono)', opacity: 0.7 }}>{(el * 180 / Math.PI).toFixed(0)}°</span>
        </label>
      </div>
    </div>
  );
}

// Slice 468 — HDRI environment picker for the Settings modal.
function HDRIPickerRow() {
  const [presets, setPresets] = React.useState([]);
  const [current, setCurrent] = React.useState('off');
  React.useEffect(() => {
    if (window.__studioListHDRIPresets) {
      const r = window.__studioListHDRIPresets();
      const list = (r && (r.presets || r)) || [];
      setPresets(Array.isArray(list) ? list : []);
    }
    if (window.__studioHDRIPreset) setCurrent(window.__studioHDRIPreset);
  }, []);
  if (!presets.length) return null;
  return (
    <div data-studio-v3-settings-section="hdri" style={{ marginBottom: 12 }}>
      <div style={{ opacity: 0.55, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>HDRI environment</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            data-studio-v3-settings-hdri={p}
            data-active={p === current ? 'true' : 'false'}
            onClick={() => {
              if (window.__studioSetHDRIEnvironment) window.__studioSetHDRIEnvironment(p);
              setCurrent(p);
            }}
            style={{
              padding: '4px 10px', fontSize: 11,
              background: p === current ? 'var(--studio-accent, #ebecef)' : 'var(--studio-canvas-3, #141414)',
              color: p === current ? 'var(--studio-canvas, #000000)' : 'var(--studio-ink, #f0eee6)',
              border: '1px solid var(--studio-rail-edge, #1d2027)',
              borderRadius: 3, cursor: 'pointer',
              textTransform: 'capitalize', fontFamily: 'inherit',
            }}
          >{p}</button>
        ))}
      </div>
    </div>
  );
}

// ─── CommandPalette (slice 476) ───────────────────────────────────────────
// Cmd+K opens a fuzzy-filterable list of registered actions. Each item
// has a label + optional shortcut + handler. Arrow keys to navigate,
// Enter to fire, Esc to close. Studio teal accent on the focused row.
const COMMAND_PALETTE_ITEMS = [
  { id: 'spawn-cube',    label: 'Add cube',               hint: 'Shift+A',   call: () => window.__spawnPrimitive && window.__spawnPrimitive('cube', window.__archdiscScene) },
  { id: 'spawn-sphere',  label: 'Add sphere',                                call: () => window.__spawnPrimitive && window.__spawnPrimitive('sphere', window.__archdiscScene) },
  { id: 'spawn-plane',   label: 'Add plane',                                 call: () => window.__spawnPrimitive && window.__spawnPrimitive('plane', window.__archdiscScene) },
  { id: 'save',          label: 'Save scene',             hint: 'Cmd+S',     call: () => window.__studioDownloadScene && window.__studioDownloadScene() },
  { id: 'open',          label: 'Open scene file',        hint: 'Cmd+O',     call: () => window.__studioOpenSceneFile && window.__studioOpenSceneFile() },
  { id: 'export',        label: 'Export GLTF',            hint: 'Cmd+E',     call: () => window.__studioDownloadGLTF && window.__studioDownloadGLTF() },
  { id: 'export-png',    label: 'Export viewport PNG',    hint: 'Cmd+Shift+E', call: () => window.__studioExportViewportPNG && window.__studioExportViewportPNG() },
  { id: 'export-obj',    label: 'Export selected OBJ',                        call: () => window.__studioExportOBJ && window.__studioExportOBJ() },
  { id: 'export-stl',    label: 'Export selected STL',                        call: () => window.__studioExportSTL && window.__studioExportSTL() },
  { id: 'about',         label: 'About ArchDisc Studio',                     call: () => window.dispatchEvent(new CustomEvent('studio-about-open')) },
  { id: 'undo',          label: 'Undo',                   hint: 'Cmd+Z',     call: () => window.__studioUndo && window.__studioUndo() },
  { id: 'redo',          label: 'Redo',                   hint: 'Cmd+Shift+Z', call: () => window.__studioRedo && window.__studioRedo() },
  { id: 'select-all',    label: 'Select all',             hint: 'A',         call: () => window.__studioSelectAll && window.__studioSelectAll() },
  { id: 'deselect',      label: 'Deselect all',                              call: () => window.__studioDeselect && window.__studioDeselect() },
  { id: 'frame-selected', label: 'Frame selected',         hint: '.',         call: () => window.__studioFitSelected && window.__studioFitSelected() },
  { id: 'frame-all',     label: 'Frame all',                                 call: () => window.__studioFrameAll && window.__studioFrameAll() },
  { id: 'mode-object',   label: 'Mode: Object',           hint: 'Tab',       call: () => window.__studioSetEditMode && window.__studioSetEditMode('object') },
  { id: 'mode-vertex',   label: 'Mode: Vertex edit',      hint: '1',         call: () => window.__studioSetEditMode && window.__studioSetEditMode('vertex') },
  { id: 'mode-edge',     label: 'Mode: Edge edit',        hint: '2',         call: () => window.__studioSetEditMode && window.__studioSetEditMode('edge') },
  { id: 'mode-face',     label: 'Mode: Face edit',        hint: '3',         call: () => window.__studioSetEditMode && window.__studioSetEditMode('face') },
  { id: 'shade-wire',    label: 'Shading: wire',                             call: () => window.__studioSetShadingMode && window.__studioSetShadingMode('wire') },
  { id: 'shade-solid',   label: 'Shading: solid',                            call: () => window.__studioSetShadingMode && window.__studioSetShadingMode('solid') },
  { id: 'shade-mat',     label: 'Shading: material',      hint: 'Z',         call: () => window.__studioSetShadingMode && window.__studioSetShadingMode('material') },
  { id: 'shade-rend',    label: 'Shading: rendered',                         call: () => window.__studioSetShadingMode && window.__studioSetShadingMode('rendered') },
  { id: 'settings',      label: 'Open Settings',          hint: 'Cmd+,',     call: () => window.dispatchEvent(new CustomEvent('studio-settings-toggle')) },
  { id: 'cheatsheet',    label: 'Show keymap cheatsheet', hint: 'F1',        call: () => window.dispatchEvent(new CustomEvent('studio-cheatsheet-toggle')) },
];
function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = React.useRef(null);
  useEffect(() => {
    const onToggle = () => {
      setOpen((v) => {
        const next = !v;
        if (next) { setFilter(''); setActive(0); }
        return next;
      });
    };
    const onKey = (e) => {
      if (!open) return;
      if (e.key === 'Escape') { setOpen(false); e.preventDefault(); }
    };
    window.addEventListener('studio-command-palette-toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('studio-command-palette-toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);
  if (!open) return null;
  const f = filter.toLowerCase();
  // Slice 504 — Synthesise recent-file entries dynamically each open
  // so palette mirrors the latest localStorage state.
  const recent = (window.__studioListRecentFiles && window.__studioListRecentFiles()) || [];
  const recentItems = recent.map((it) => ({
    id: `open-recent-${it.name}`,
    label: `Open recent · ${it.name}`,
    hint: '',
    call: () => window.__studioOpenRecentFile && window.__studioOpenRecentFile(it.name),
  }));
  const items = [...COMMAND_PALETTE_ITEMS, ...recentItems].filter((it) => !f || it.label.toLowerCase().includes(f) || it.id.includes(f));
  const onKeyInside = (e) => {
    if (e.key === 'ArrowDown') { setActive((i) => Math.min(items.length - 1, i + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setActive((i) => Math.max(0, i - 1)); e.preventDefault(); }
    else if (e.key === 'Enter') {
      const it = items[active];
      if (it) { try { it.call(); } catch (_) {} }
      setOpen(false);
      e.preventDefault();
    }
  };
  return (
    <div
      data-studio-v3-command-palette
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 9200,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '60vw', maxWidth: 560,
          background: 'var(--studio-canvas, #000000)',
          border: '1px solid var(--studio-rail-edge, #1d2027)',
          borderRadius: 6,
          boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
          fontFamily: 'inherit',
          color: 'var(--studio-ink, #f0eee6)',
          overflow: 'hidden',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          data-studio-v3-command-palette-input
          value={filter}
          placeholder="Type a command…"
          onChange={(e) => { setFilter(e.target.value); setActive(0); }}
          onKeyDown={onKeyInside}
          style={{
            width: '100%', padding: '12px 14px',
            background: 'transparent', color: 'inherit',
            border: 'none', borderBottom: '1px solid var(--studio-rail-edge, #1d2027)',
            fontFamily: 'inherit', fontSize: 13, outline: 'none',
          }}
        />
        <div style={{ maxHeight: '50vh', overflowY: 'auto', padding: '4px 0' }}>
          {items.length === 0 && (
            <div style={{ padding: '12px 16px', opacity: 0.5, fontSize: 11 }}>No matching commands</div>
          )}
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              data-studio-v3-command-palette-item={it.id}
              data-active={i === active ? 'true' : 'false'}
              onMouseEnter={() => setActive(i)}
              onClick={() => { try { it.call(); } catch (_) {} setOpen(false); }}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                width: '100%', padding: '6px 16px', textAlign: 'left',
                background: i === active ? 'var(--studio-canvas-3, #141414)' : 'transparent',
                color: i === active ? 'var(--studio-accent, #ebecef)' : 'var(--studio-ink, #f0eee6)',
                border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
                borderLeft: '3px solid ' + (i === active ? 'var(--studio-accent, #ebecef)' : 'transparent'),
              }}
            >
              <span>{it.label}</span>
              {it.hint && (
                <code style={{ opacity: 0.55, fontSize: 10, fontFamily: 'var(--studio-mono, ui-monospace)' }}>{it.hint}</code>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── KeymapCheatsheet ────────────────────────────────────────────────────
// Slice 432 — F1 / ? overlay listing the V3 hotkeys. Listens to
// __studioToggleCheatSheet's event so other UI / the cmdbar can also
// open it.
const KEYMAP = [
  { section: 'Mode', rows: [
    ['Tab', 'Cycle edit mode (object → vert → edge → face → sculpt)'],
    ['1 / 2 / 3', 'Vert / Edge / Face (only in sub-object mode)'],
    ['Esc', 'Drop active tool back to Select'],
  ] },
  { section: 'Transform', rows: [
    ['G', 'Move tool'],
    ['R', 'Rotate tool'],
    ['S', 'Scale tool'],
    ['E', 'Extrude selected face (face mode)'],
    ['I', 'Inset selected face (face mode)'],
    ['W', 'Subdivide selected face (face mode)'],
    ['Y', 'Toggle transform gizmo visibility'],
  ] },
  { section: 'Selection', rows: [
    ['A', 'Toggle select-all / deselect-all'],
    ['Shift+A', 'Quick-add primitive menu'],
    ['Shift+D', 'Duplicate selected'],
    ['X / Delete', 'Delete selected mesh'],
    ['H', 'Hide selected'],
    ['Alt+H', 'Reveal everything'],
    ['N', 'Toggle sidebar (right panel)'],
  ] },
  { section: 'View / Cmd', rows: [
    ['1 / 3 / 7', 'Camera front / right / top (object mode)'],
    ['5', 'Toggle perspective / orthographic'],
    ['Z', 'Cycle shading: wire → solid → material → rendered'],
    ['+ / -', 'Dolly camera in / out'],
    ['Space', 'Play / pause animation'],
    ['← / →', 'Step animation frame ±1'],
    ['J / L', 'Jump to prev / next keyframe'],
    ['K', 'Insert keyframe at current frame'],
    ['.', 'Frame selected (fallback: frame all)'],
    ['Cmd+Z', 'Undo'],
    ['Cmd+Shift+Z', 'Redo'],
    ['Cmd+S', 'Save scene (download .studio.json)'],
    ['Cmd+Shift+S', 'Save scene as… (pick a name)'],
    ['Cmd+O', 'Open scene file'],
    ['Cmd+E', 'Export GLTF'],
    ['Cmd+Shift+E', 'Export viewport PNG'],
    ['Shift+H', 'Isolate selected (hide others)'],
    ['B', 'Box marquee select (drag a rectangle)'],
    ['M', 'Measure distance between 2 selected'],
    ['Cmd+Alt+A', 'Add text annotation at selection'],
    ['Cmd+L', 'Toggle transform lock on selection'],
    ['Cmd+R', 'Reset camera home'],
    ['Cmd+J', 'Join multi-selected meshes'],
    ['Cmd+] / Cmd+[', 'Cycle selection next / prev'],
    ['Cmd+.', 'Center orbit target on selection'],
    ['Alt+1..9', 'Recall camera bookmark by index'],
    ['Numpad 1/3/7', 'Front / Right / Top camera (Blender parity)'],
    ['Numpad 5', 'Toggle perspective / ortho'],
    ['T', 'Toggle camera turntable autorotate'],
    ['Shift+W/A/S/D', 'Fly camera forward / strafe'],
    ['/', 'Solo: isolate selection + frame · press again to restore'],
    ['Alt+G/R/S', 'Reset translate/rotate/scale'],
    ['Shift+;', 'Toggle transform snap (1 cm / 15° / 0.1)'],
    ['Cmd+,', 'Settings'],
    ['Cmd+K', 'Command palette'],
    ['Cmd+1/2/3', 'Right panel: Inspector / Outliner / Layers'],
    ['Cmd+P', 'Presentation mode (hide overlays)'],
    ['Cmd+G', 'Group selected primitives'],
    ['Cmd+Shift+G', 'Ungroup active group'],
    ['Cmd+F', 'Focus outliner filter'],
    ['Cmd+T', 'Toggle theme'],
    ['Cmd+/', 'Focus command bar'],
    ['F1 / ?', 'This cheatsheet'],
  ] },
];
function KeymapCheatsheet() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    const onToggle = (ev) => { if (ev && ev.detail) setOpen(!!ev.detail.open); };
    window.addEventListener('studio-cheatsheet-toggle', onToggle);
    const onKey = (e) => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if (e.key === 'F1' || (e.key === '?' && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
        // Mirror to the op event slot so other listeners can react.
        window.__studioCheatSheetOpen = !window.__studioCheatSheetOpen;
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('studio-cheatsheet-toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!open) return null;
  return (
    <div
      data-studio-v3-cheatsheet
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 540, width: '88vw',
          background: 'var(--studio-canvas, #000000)',
          border: '1px solid var(--studio-rail-edge, #1d2027)',
          borderRadius: 8,
          padding: '20px 24px',
          color: 'var(--studio-ink, #f0eee6)',
          fontFamily: 'inherit', fontSize: 12,
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.55)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
          <strong style={{ fontSize: 14, color: 'var(--studio-accent, #ebecef)', letterSpacing: '0.04em' }}>Keymap</strong>
          <span style={{ opacity: 0.6, fontSize: 11, fontFamily: 'var(--studio-mono, ui-monospace)' }}>F1 · ? · Esc</span>
        </div>
        <input
          type="text"
          data-studio-v3-cheatsheet-filter
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…  (e.g. ‘group’, ‘export’, ‘snap’)"
          style={{
            width: '100%', marginBottom: 14, padding: '6px 10px',
            background: 'var(--studio-canvas-3, #141414)',
            border: '1px solid var(--studio-rail-edge, #1d2027)',
            color: 'var(--studio-ink, #f0eee6)', borderRadius: 4,
            fontFamily: 'inherit', fontSize: 12, outline: 'none',
          }}
        />
        {KEYMAP.map((sec) => {
          const f = filter.toLowerCase();
          const rows = f
            ? sec.rows.filter(([k, d]) => k.toLowerCase().includes(f) || d.toLowerCase().includes(f))
            : sec.rows;
          if (!rows.length) return null;
          return (
            <div key={sec.section} data-studio-v3-cheatsheet-section={sec.section} style={{ marginBottom: 12 }}>
              <div style={{ opacity: 0.55, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{sec.section}</div>
              {rows.map(([key, desc]) => (
                <div key={key} data-studio-v3-cheatsheet-row style={{ display: 'flex', gap: 12, padding: '2px 0', alignItems: 'baseline' }}>
                  <code style={{
                    minWidth: 70, fontFamily: 'var(--studio-mono, ui-monospace)',
                    color: 'var(--studio-accent, #ebecef)', fontSize: 11,
                  }}>{key}</code>
                  <span style={{ opacity: 0.85 }}>{desc}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── AutosaveRestorePrompt (slice 466) ────────────────────────────────────
// On app load, if an autosave exists and the live scene is empty,
// show a small banner asking whether to restore. Restore calls
// __studioLoadScene with the localStorage JSON; Dismiss clears the
// banner (autosave still in storage). The banner self-hides if the
// user spawns anything in the meantime.
function AutosaveRestorePrompt() {
  // Slice 951f — disabled. Was a banner pinned to top-centre of the
  // viewport that overlapped the camera-drag drop-zone. The autosave
  // payload still survives in localStorage; the user can recover
  // explicitly via __studioAutosaveRestoreLatest() / a File menu entry
  // when that lands. Empty render keeps the component identity for any
  // existing <AutosaveRestorePrompt /> mount points.
  return null;
  // eslint-disable-next-line no-unreachable
  const [info, setInfo] = useState(null);
  useEffect(() => {
    // Defer one tick so V3 API + scene have mounted.
    const id = setTimeout(() => {
      try {
        const json = window.localStorage.getItem('archdisc.studio.autosave');
        const ts = Number(window.localStorage.getItem('archdisc.studio.autosave.ts') || 0);
        if (!json || !ts) return;
        let n = 0;
        if (window.__archdiscScene) {
          window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
        }
        // Only prompt if the live scene is empty (so we don't suggest
        // replacing the user's current work).
        if (n > 0) return;
        setInfo({
          ts,
          bytes: json.length,
          age: Math.round((Date.now() - ts) / 1000),
        });
      } catch (_) {}
    }, 500);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    if (!info) return;
    // Hide once the scene grows.
    const id = setInterval(() => {
      if (window.__archdiscScene) {
        let n = 0;
        window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
        if (n > 0) setInfo(null);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [info]);
  if (!info) return null;
  return (
    <div
      data-studio-v3-autosave-restore
      data-studio-v3-autosave-ts={info.ts}
      style={{
        position: 'absolute', top: 16, left: '50%',
        transform: 'translateX(-50%)', zIndex: 30,
        background: 'rgba(13, 17, 23, 0.92)',
        color: 'var(--studio-ink, #f0eee6)',
        border: '1px solid var(--studio-accent, #ebecef)',
        borderRadius: 4, padding: '8px 14px',
        fontFamily: 'inherit', fontSize: 11,
        boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}
    >
      <span>Autosave found · {(info.bytes / 1024).toFixed(1)} KB · {info.age}s ago</span>
      <button
        type="button"
        data-studio-v3-autosave-restore-btn
        onClick={() => {
          const json = window.localStorage.getItem('archdisc.studio.autosave');
          if (json && window.__studioLoadScene) {
            try { window.__studioLoadScene(json); } catch (_) {}
          }
          setInfo(null);
        }}
        style={{
          padding: '3px 10px', fontSize: 11,
          background: 'var(--studio-accent, #ebecef)',
          color: 'var(--studio-canvas, #000000)',
          border: 'none', borderRadius: 3, cursor: 'pointer',
          fontFamily: 'inherit', fontWeight: 600,
        }}
      >Restore</button>
      <button
        type="button"
        data-studio-v3-autosave-dismiss-btn
        onClick={() => setInfo(null)}
        style={{
          padding: '3px 10px', fontSize: 11,
          background: 'transparent',
          color: 'var(--studio-ink-mute, #9aa6b2)',
          border: '1px solid var(--studio-rail-edge, #1d2027)',
          borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
        }}
      >Dismiss</button>
    </div>
  );
}

// ─── AutosaveToast (slice 465) ───────────────────────────────────────────
// Brief floating toast shown when an autosave fires. Fades out after 2s.
function AutosaveToast() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    const onSaved = (ev) => {
      const d = ev.detail || {};
      setMsg(`Autosaved · ${d.primitives || 0} prim · ${((d.bytes || 0) / 1024).toFixed(1)} KB`);
      setTimeout(() => setMsg(null), 2200);
    };
    window.addEventListener('studio-autosaved', onSaved);
    return () => window.removeEventListener('studio-autosaved', onSaved);
  }, []);
  if (!msg) return null;
  return (
    <div
      data-studio-v3-autosave-toast
      style={{
        position: 'absolute', bottom: 60, right: 16, zIndex: 25,
        background: 'rgba(13, 17, 23, 0.92)',
        color: 'var(--studio-accent, #ebecef)',
        border: '1px solid var(--studio-rail-edge, #1d2027)',
        borderRadius: 4, padding: '6px 12px',
        fontFamily: 'inherit', fontSize: 11,
        pointerEvents: 'none',
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        letterSpacing: '0.03em',
      }}
    >{msg}</div>
  );
}

// Slice 479 — Presentation-mode hint banner. Reminds the user how to
// exit the clean viewport.
function PresentationBanner() {
  return (
    <div
      data-studio-v3-presentation-banner
      style={{
        position: 'absolute', top: 12, left: '50%',
        transform: 'translateX(-50%)', zIndex: 22,
        background: 'rgba(13, 17, 23, 0.85)',
        color: 'var(--studio-ink-mute, #9aa6b2)',
        border: '1px solid var(--studio-rail-edge, #1d2027)',
        borderRadius: 3, padding: '4px 12px',
        fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 10,
        pointerEvents: 'none',
        letterSpacing: '0.03em',
      }}
    >Presentation — Esc / Cmd+P to exit</div>
  );
}

// ─── AxisGizmo (slice 473) ───────────────────────────────────────────────
// Bottom-right corner SVG showing the live camera orientation as a
// 3-axis cross. Updates every animation frame; the X/Y/Z labels are
// coloured Blender-style red/green/blue. Click an axis label to snap
// the camera to that view.
//
// Slice 951i — REMOVED. The Forge-mirror viewport rewrite (slice 951g)
// added drei's <GizmoHelper> + <GizmoViewport> at bottom-right, which
// is the canonical Forge navigation cube. This legacy SVG was stacking
// underneath it producing a second smaller coloured gizmo the user
// asked to remove. The component identity stays so any holdover mount
// renders zero DOM.
function AxisGizmo() {
  return null;
  // eslint-disable-next-line no-unreachable
  const ref = React.useRef(null);
  React.useEffect(() => {
    let raf = 0;
    const tick = () => {
      const vp = window.__archdiscViewport;
      const cam = vp && vp.camera;
      const el = ref.current;
      if (cam && el) {
        // Build a 3x3 rotation matrix from the camera's matrixWorldInverse.
        // The basis vectors map world → screen.
        const m = cam.matrixWorldInverse.elements;
        // Each axis projected into camera space (column = world axis).
        const ax = { x: m[0],  y: m[1],  z: m[2]  };
        const ay = { x: m[4],  y: m[5],  z: m[6]  };
        const az = { x: m[8],  y: m[9],  z: m[10] };
        const lines = el.querySelectorAll('line');
        const labels = el.querySelectorAll('text');
        const r = 18;
        const set = (ln, lbl, ax3) => {
          const x = ax3.x * r;
          const y = -ax3.y * r;
          ln.setAttribute('x2', String(20 + x));
          ln.setAttribute('y2', String(20 + y));
          lbl.setAttribute('x', String(20 + x * 1.2));
          lbl.setAttribute('y', String(20 + y * 1.2 + 3));
        };
        if (lines[0]) set(lines[0], labels[0], ax);
        if (lines[1]) set(lines[1], labels[1], ay);
        if (lines[2]) set(lines[2], labels[2], az);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <svg
      ref={ref}
      data-studio-v3-axis-gizmo
      viewBox="0 0 40 40"
      style={{
        position: 'absolute', bottom: 28, right: 12, zIndex: 22,
        width: 40, height: 40, pointerEvents: 'auto',
        background: 'rgba(0,0,0,0.35)', borderRadius: 6,
      }}
    >
      <line x1="20" y1="20" x2="38" y2="20" stroke="#ff5e5e" strokeWidth="2" strokeLinecap="round" />
      <line x1="20" y1="20" x2="20" y2="2"  stroke="#5eff9c" strokeWidth="2" strokeLinecap="round" />
      <line x1="20" y1="20" x2="20" y2="38" stroke="#5e9cff" strokeWidth="2" strokeLinecap="round" />
      <text
        x="38" y="20"
        fontSize="8" fill="#ff5e5e" fontFamily="ui-monospace, monospace"
        style={{ cursor: 'pointer' }}
        onClick={() => window.__studioSetCameraAxis && window.__studioSetCameraAxis('side')}
      >X</text>
      <text
        x="20" y="2"
        fontSize="8" fill="#5eff9c" fontFamily="ui-monospace, monospace"
        style={{ cursor: 'pointer' }}
        onClick={() => window.__studioSetCameraAxis && window.__studioSetCameraAxis('top')}
      >Y</text>
      <text
        x="20" y="38"
        fontSize="8" fill="#5e9cff" fontFamily="ui-monospace, monospace"
        style={{ cursor: 'pointer' }}
        onClick={() => window.__studioSetCameraAxis && window.__studioSetCameraAxis('front')}
      >Z</text>
    </svg>
  );
}

// ─── ViewportStatsOverlay (slice 460) ─────────────────────────────────────
// Pinned to the viewport's bottom-left corner. Shows FPS · draw calls ·
// scene triangle total. Blender stats-overlay parity. Toggleable via
// the 'studio-toggle-stats' event so the settings modal can disable it.
function ViewportStatsOverlay() {
  const [visible, setVisible] = useState(true);
  const [stats, setStats] = useState({ fps: 0, calls: 0, tris: 0 });
  useEffect(() => {
    const onToggle = () => setVisible((v) => !v);
    window.addEventListener('studio-toggle-stats', onToggle);
    let frames = 0; let last = performance.now(); let raf = 0;
    let cachedTris = 0; let lastTriPoll = 0;
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - last >= 500) {
        const fps = Math.round((frames * 1000) / (now - last));
        const vp = window.__archdiscViewport;
        const calls = (vp && vp.renderer && vp.renderer.info) ? vp.renderer.info.render.calls : 0;
        // Total tris — poll the scene at most once per second.
        if (now - lastTriPoll >= 1000 && vp && vp.scene) {
          let tris = 0;
          vp.scene.traverse((o) => {
            if (!o.isMesh || !o.geometry) return;
            const g = o.geometry;
            const idx = g.index ? g.index.array.length : g.attributes.position && g.attributes.position.count;
            if (idx) tris += Math.floor(idx / 3);
          });
          cachedTris = tris;
          lastTriPoll = now;
        }
        setStats({ fps, calls, tris: cachedTris });
        frames = 0; last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('studio-toggle-stats', onToggle);
      cancelAnimationFrame(raf);
    };
  }, []);
  if (!visible) return null;
  return (
    <div
      data-studio-v3-viewport-stats
      data-studio-v3-stats-fps={stats.fps}
      data-studio-v3-stats-calls={stats.calls}
      data-studio-v3-stats-tris={stats.tris}
      style={{
        position: 'absolute', bottom: 28, left: 12, zIndex: 22,
        background: 'rgba(0, 0, 0, 0.55)',
        color: 'var(--studio-ink-mute, #9aa6b2)',
        padding: '4px 10px', borderRadius: 3,
        fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 10,
        pointerEvents: 'none',
        letterSpacing: '0.03em',
      }}
    >
      {stats.fps} fps · {stats.calls} calls · {stats.tris.toLocaleString()} tris
    </div>
  );
}

// ─── WelcomeCard ─────────────────────────────────────────────────────────
// Slice 427 — Centered card in the viewport while the scene has no
// Studio primitives. Studio teal title + brief muscle-memory hints.
// Fades out the moment the user spawns the first mesh.
// Slice 496 — Unified toast bus. Any op can dispatch a 'studio-toast'
// CustomEvent with { msg, kind } (kind: 'info' | 'ok' | 'warn').
// ToastBus stacks up to 4, auto-dismisses after 2.6 s.
// Slice 497 — Dynamic document.title shows active wb + dirty marker.
// Listens to studio-autosaved + polls __studioV3Dirty.
function DocTitle({ activeWb }) {
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const tick = () => setDirty(!!window.__studioV3Dirty);
    const id = setInterval(tick, 600);
    tick();
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const wb = activeWb ? activeWb[0].toUpperCase() + activeWb.slice(1) : 'Studio';
    document.title = `${dirty ? '• ' : ''}${wb} — ArchDisc Studio`;
  }, [activeWb, dirty]);
  return null;
}

// Slice 500 — Save-As modal. Cmd/Ctrl+Shift+S fires studio-save-as-open;
// modal captures a name input + commits via __studioDownloadScene(name).
function SaveAsModal() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('studio-scene');
  const inputRef = React.useRef(null);
  useEffect(() => {
    const onOpen = () => { setName('studio-scene'); setOpen(true); };
    window.addEventListener('studio-save-as-open', onOpen);
    return () => window.removeEventListener('studio-save-as-open', onOpen);
  }, []);
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [open]);
  if (!open) return null;
  const commit = () => {
    if (window.__studioDownloadScene) {
      const r = window.__studioDownloadScene(name || 'studio-scene');
      if (window.__studioToast) window.__studioToast(`Saved ${r || name}`, 'ok');
    }
    setOpen(false);
  };
  return (
    <div
      data-studio-v3-save-as
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(13, 17, 23, 0.55)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div style={{
        background: 'var(--studio-canvas-3, #141414)',
        border: '1px solid var(--studio-accent, #ebecef)',
        borderRadius: 8, padding: '18px 22px', minWidth: 340,
        boxShadow: '0 14px 40px rgba(0,0,0,0.6)',
      }}>
        <div style={{
          color: 'var(--studio-accent, #ebecef)', fontWeight: 600, marginBottom: 10, fontSize: 13,
        }}>Save scene as…</div>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
          }}
          data-studio-v3-save-as-input
          style={{
            width: '100%', background: 'var(--studio-canvas, #000000)',
            border: '1px solid var(--studio-rail-edge, #1d2027)',
            color: 'var(--studio-ink, #f0eee6)', padding: '7px 10px',
            borderRadius: 4, fontFamily: 'var(--studio-mono, ui-monospace)',
            fontSize: 12, marginBottom: 12,
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              background: 'transparent', border: '1px solid var(--studio-rail-edge, #1d2027)',
              color: 'var(--studio-ink, #f0eee6)', padding: '5px 14px', borderRadius: 4,
              fontSize: 11, cursor: 'pointer',
            }}
          >Cancel</button>
          <button
            type="button"
            data-studio-v3-save-as-commit
            onClick={commit}
            style={{
              background: 'var(--studio-accent, #ebecef)', border: 0, color: '#000000',
              fontWeight: 600, padding: '5px 14px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
            }}
          >Save</button>
        </div>
      </div>
    </div>
  );
}

// Slice 502 — Drag-rectangle marquee. B key arms the mode; mousedown
// on the viewport starts the drag; the overlay div renders a rectangle
// following the mouse; mouseup commits via __studioBoxSelect.
function MarqueeOverlay() {
  const [armed, setArmed] = useState(false);
  const [rect, setRect] = useState(null);
  useEffect(() => {
    const onArm = () => setArmed(true);
    window.addEventListener('studio-marquee-arm', onArm);
    return () => window.removeEventListener('studio-marquee-arm', onArm);
  }, []);
  useEffect(() => {
    if (!armed) return;
    let start = null;
    const onDown = (e) => {
      const main = document.querySelector('[data-studio-v3-viewport]');
      if (!main) return;
      const r = main.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      start = { x: e.clientX - r.left, y: e.clientY - r.top, mainRect: r };
      setRect({ x: start.x, y: start.y, w: 0, h: 0 });
      e.preventDefault();
      e.stopPropagation();
      const ctl = window.__archdiscViewport && window.__archdiscViewport.orbitControls;
      if (ctl) ctl.enabled = false;
    };
    const onMove = (e) => {
      if (!start) return;
      const x = e.clientX - start.mainRect.left;
      const y = e.clientY - start.mainRect.top;
      setRect({ x: Math.min(start.x, x), y: Math.min(start.y, y), w: Math.abs(x - start.x), h: Math.abs(y - start.y) });
    };
    const onUp = (e) => {
      if (!start) return;
      const x2 = e.clientX - start.mainRect.left;
      const y2 = e.clientY - start.mainRect.top;
      if (window.__studioBoxSelect) {
        const r = window.__studioBoxSelect(start.x, start.y, x2, y2);
        if (window.__studioToast && r && r.count != null) window.__studioToast(`Box select: ${r.count} hit${r.count === 1 ? '' : 's'}`, 'info');
      }
      start = null;
      setRect(null);
      setArmed(false);
      const ctl = window.__archdiscViewport && window.__archdiscViewport.orbitControls;
      if (ctl) ctl.enabled = true;
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { start = null; setRect(null); setArmed(false); const ctl = window.__archdiscViewport && window.__archdiscViewport.orbitControls; if (ctl) ctl.enabled = true; }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [armed]);
  if (!armed) return null;
  return (
    <div
      data-studio-v3-marquee-overlay
      data-studio-v3-marquee-armed="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        cursor: 'crosshair', pointerEvents: 'none',
        background: 'rgba(255, 255, 255, 0.04)',
      }}
    >
      {rect && (
        <div
          data-studio-v3-marquee-rect
          style={{
            position: 'absolute', left: (rect.x), top: (rect.y),
            width: rect.w, height: rect.h,
            border: '1px dashed var(--studio-accent, #ebecef)',
            background: 'rgba(255, 255, 255, 0.08)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

// Slice 509 — About modal. Branded splash with name, tagline, build
// version and a list of headline features. Opens on Help menu click +
// the "about" command in the palette.
function AboutModal() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (e) => {
      if (open && e.key === 'Escape') { setOpen(false); e.preventDefault(); }
    };
    window.addEventListener('studio-about-open', onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('studio-about-open', onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!open) return null;
  return (
    <div
      data-studio-v3-about
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(13,17,23,0.7)',
      }}
    >
      <div style={{
        background: 'var(--studio-canvas-3, #141414)',
        border: '1px solid var(--studio-accent, #ebecef)',
        borderRadius: 8, padding: '28px 32px', minWidth: 420, maxWidth: 520,
        boxShadow: '0 14px 40px rgba(0,0,0,0.6)',
        color: 'var(--studio-ink, #f0eee6)',
      }}>
        <div style={{
          fontSize: 18, fontWeight: 700, letterSpacing: '0.04em',
          color: 'var(--studio-accent, #ebecef)', marginBottom: 4,
        }}>ArchDisc Studio</div>
        <div style={{
          fontSize: 11, opacity: 0.65, marginBottom: 18, letterSpacing: '0.03em',
        }}>A native 3D content creation platform for engineering disciplines.</div>
        <div style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 18 }}>
          <div><strong>Build:</strong> archdisc · slice 509</div>
          <div><strong>Renderer:</strong> Three.js · WebGL 2</div>
          <div><strong>Archie:</strong> local LLM fleet at localhost:8080</div>
          <div><strong>Repo:</strong> github.com/satvikOS/archdisc-Studio</div>
        </div>
        <div style={{
          fontSize: 11, opacity: 0.7, marginBottom: 18,
          fontFamily: 'var(--studio-mono, ui-monospace)',
        }}>
          8 workbenches · 200+ ops · BVH raycast · OCCT-ready
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            data-studio-v3-about-close
            onClick={() => setOpen(false)}
            style={{
              background: 'var(--studio-accent, #ebecef)', border: 0, color: '#000000',
              fontWeight: 600, padding: '6px 18px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
            }}
          >Close</button>
        </div>
      </div>
    </div>
  );
}

// Slice 520 — Splash screen. Shows once per session (uses sessionStorage
// so reloads in the same Electron window don't re-show; close the window
// to see it again). Fades after 1.6 s.
function SplashScreen() {
  const [show, setShow] = useState(() => {
    try { return !window.sessionStorage.getItem('studio.v3.splash-shown'); } catch (_) { return false; }
  });
  useEffect(() => {
    if (!show) return;
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
    const t = setTimeout(() => setShow(false), 1600);
    return () => clearTimeout(t);
  }, [show]);
  if (!show) return null;
  return (
    <div
      data-studio-v3-splash
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: 'var(--studio-canvas, #000000)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column',
        animation: 'studio-splash-fade 1.6s ease-in forwards',
      }}
    >
      <div style={{
        fontSize: 32, fontWeight: 700, letterSpacing: '0.06em',
        color: 'var(--studio-accent, #ebecef)',
        textShadow: '0 0 24px rgba(255, 255, 255, 0.4)',
      }}>ArchDisc</div>
      <div style={{
        fontSize: 14, marginTop: 4, color: 'var(--studio-ink, #f0eee6)',
        letterSpacing: '0.18em', textTransform: 'uppercase',
      }}>Studio</div>
      <div style={{
        fontSize: 10, marginTop: 18,
        color: 'var(--studio-ink-mute, #9aa6b2)',
        fontFamily: 'var(--studio-mono, ui-monospace)',
      }}>3D content for engineering disciplines</div>
    </div>
  );
}

// Slice 532 — Bottom-left top-down minimap. Plots every archdisc primitive
// at its world X,Z scaled to a 120×120 canvas with the camera position +
// look ray as a fan. Provides spatial context in cluttered scenes.
function ViewportMinimap() {
  // Slice 951h — REMOVED. Per the user's screenshot the 120×120 canvas
  // sat over the viewport bottom-left and (a) blocked OrbitControls
  // drag/zoom in that region — the user could only orbit in the thin
  // strip BETWEEN the minimap and the right inspector, and (b) when
  // click-pan'd, fired the "Minimap pan → (x, z)" toast the user kept
  // seeing. Forge's viewport has no top-down minimap, so the rewrite
  // drops it too. The pan/Frame-All helpers stay reachable via the
  // bottom-right GizmoHelper axis cube.
  return null;
  // eslint-disable-next-line no-unreachable
  const ref = React.useRef(null);
  React.useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (t) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 100) return;
      last = t;
      const canvas = ref.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(13,17,23,0.6)';
      ctx.fillRect(0, 0, W, H);
      // Scale: assume primitives within ±2 m for the default scene.
      const SCALE = 18; // px per metre
      const cx = W / 2, cy = H / 2;
      // Grid crosshair.
      ctx.strokeStyle = 'rgba(154,166,178,0.18)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, cy); ctx.lineTo(W, cy);
      ctx.moveTo(cx, 0); ctx.lineTo(cx, H);
      ctx.stroke();
      const s = window.__archdiscScene;
      if (s) {
        try {
          s.traverse((o) => {
            if (!(o.userData && o.userData.archdiscStudioPrimitive)) return;
            const px = cx + o.position.x * SCALE;
            const py = cy + o.position.z * SCALE;
            // Slice 948 — outliner minimap dots are monochrome warm-white
            // for unlocked primitives, half-bright grey for locked. The
            // user reads the lock state via dot brightness, not hue.
            ctx.fillStyle = (o.userData && o.userData.archdiscStudioLocked) ? '#5a5a5a' : '#f0eee6';
            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fill();
          });
        } catch (_) {}
      }
      const vp = window.__archdiscViewport;
      if (vp && vp.camera) {
        const cp = vp.camera.position;
        ctx.fillStyle = '#f0eee6';
        ctx.beginPath();
        ctx.arc(cx + cp.x * SCALE, cy + cp.z * SCALE, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <canvas
      ref={ref}
      width={120}
      height={120}
      data-studio-v3-minimap
      onClick={(e) => {
        // Slice 543 — Click maps from canvas px back to world X / Z; pans
        // the orbit target there + a Frame All so the new region fills.
        const rect = e.currentTarget.getBoundingClientRect();
        const cx = rect.width / 2, cy = rect.height / 2;
        const SCALE = 18;
        const wx = (e.clientX - rect.left - cx) / SCALE;
        const wz = (e.clientY - rect.top - cy) / SCALE;
        const vp = window.__archdiscViewport;
        if (vp && vp.orbitControls && vp.orbitControls.target) {
          vp.orbitControls.target.set(wx, 0, wz);
          if (typeof vp.orbitControls.update === 'function') vp.orbitControls.update();
        }
        if (window.__studioToast) window.__studioToast(`Minimap pan → (${wx.toFixed(2)}, ${wz.toFixed(2)})`, 'info');
      }}
      style={{
        position: 'absolute', left: 10, bottom: 10, zIndex: 1,
        border: '1px solid rgba(154,166,178,0.25)',
        borderRadius: 4,
        cursor: 'crosshair',
      }}
    />
  );
}

// Slice 549 — Top-center floating chip displaying the latest measurement
// result for 6 seconds. Subscribes to studio-measure-result.
function MeasurementChip() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    let timer = 0;
    const onResult = (e) => {
      const d = e && e.detail;
      if (!d) return;
      setInfo(d);
      clearTimeout(timer);
      timer = setTimeout(() => setInfo(null), 6000);
    };
    window.addEventListener('studio-measure-result', onResult);
    return () => { window.removeEventListener('studio-measure-result', onResult); clearTimeout(timer); };
  }, []);
  if (!info) return null;
  return (
    <div
      data-studio-v3-measure-chip
      data-studio-v3-measure-mm={info.mm.toFixed(2)}
      style={{
        position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
        background: 'var(--studio-canvas-3, #141414)',
        border: '1px solid var(--studio-accent, #ebecef)',
        color: 'var(--studio-ink, #f0eee6)',
        padding: '6px 14px', borderRadius: 4, fontSize: 12, zIndex: 22,
        pointerEvents: 'none', fontFamily: 'var(--studio-mono, ui-monospace)',
        boxShadow: '0 6px 18px rgba(0, 0, 0, 0.45)',
      }}
    >
      <span style={{ color: 'var(--studio-accent, #ebecef)' }}>📏</span>
      {' '}
      {info.mm.toFixed(1)} mm
      <span style={{ opacity: 0.6, marginLeft: 8 }}>({info.distance.toFixed(4)} m)</span>
    </div>
  );
}

// Slice 578 — Quad-view split. Toggleable 2x2 overlay that refreshes
// 3 thumbnails (top, front, right) every 700 ms by temporarily moving
// the main camera, rendering, and restoring. The persp cell shows the
// live main canvas.
function QuadViewOverlay() {
  const [on, setOn] = useState(false);
  const refs = { top: React.useRef(null), front: React.useRef(null), right: React.useRef(null) };
  useEffect(() => {
    const onToggle = () => setOn((v) => !v);
    window.addEventListener('studio-quad-view-toggle', onToggle);
    return () => window.removeEventListener('studio-quad-view-toggle', onToggle);
  }, []);
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    const render = () => {
      const vp = window.__archdiscViewport;
      if (!vp || !vp.renderer || !vp.camera || !vp.scene) return;
      const cam = vp.camera, scene = vp.scene;
      const saved = { pos: cam.position.clone(), tgt: vp.orbitControls && vp.orbitControls.target ? vp.orbitControls.target.clone() : null };
      const angles = {
        top:   { p: [0, 0.4, 0.0001], t: [0, 0, 0] },
        front: { p: [0, 0, 0.4],      t: [0, 0, 0] },
        right: { p: [0.4, 0, 0],      t: [0, 0, 0] },
      };
      for (const k of Object.keys(angles)) {
        cam.position.set(angles[k].p[0], angles[k].p[1], angles[k].p[2]);
        if (vp.orbitControls && vp.orbitControls.target) vp.orbitControls.target.set(angles[k].t[0], angles[k].t[1], angles[k].t[2]);
        cam.lookAt(angles[k].t[0], angles[k].t[1], angles[k].t[2]);
        vp.renderer.render(scene, cam);
        const data = vp.renderer.domElement.toDataURL('image/jpeg', 0.7);
        const img = refs[k].current;
        if (img) img.src = data;
      }
      // Restore.
      cam.position.copy(saved.pos);
      if (saved.tgt && vp.orbitControls && vp.orbitControls.target) {
        vp.orbitControls.target.copy(saved.tgt);
        if (typeof vp.orbitControls.update === 'function') vp.orbitControls.update();
      }
      cam.lookAt(saved.tgt || { x: 0, y: 0, z: 0 });
      vp.renderer.render(scene, cam);
    };
    render();
    const id = setInterval(render, 700);
    return () => { clearInterval(id); cancelAnimationFrame(raf); };
  }, [on]);
  if (!on) return null;
  const cell = (label, key) => (
    <div
      data-studio-v3-quad-cell={key}
      style={{
        background: 'var(--studio-canvas, #000000)',
        border: '1px solid var(--studio-accent, #ebecef)',
        position: 'relative', overflow: 'hidden',
      }}
    >
      <img
        ref={refs[key]}
        alt={label}
        data-studio-v3-quad-img={key}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />
      <span style={{
        position: 'absolute', top: 4, left: 6, fontSize: 9, letterSpacing: '0.06em',
        color: 'var(--studio-accent, #ebecef)', textTransform: 'uppercase',
        fontFamily: 'var(--studio-mono, ui-monospace)',
      }}>{label}</span>
    </div>
  );
  return (
    <div
      data-studio-v3-quad-view
      style={{
        position: 'absolute', inset: 0, zIndex: 4, pointerEvents: 'none',
        display: 'grid', gridTemplate: '1fr 1fr / 1fr 1fr', gap: 2,
      }}
    >
      {cell('Top', 'top')}
      {cell('Front', 'front')}
      {cell('Right', 'right')}
      <div
        data-studio-v3-quad-cell="persp"
        style={{
          background: 'transparent',
          border: '1px solid var(--studio-accent, #ebecef)',
          position: 'relative', overflow: 'hidden',
        }}
      >
        <span style={{
          position: 'absolute', top: 4, left: 6, fontSize: 9, letterSpacing: '0.06em',
          color: 'var(--studio-accent, #ebecef)', textTransform: 'uppercase',
          fontFamily: 'var(--studio-mono, ui-monospace)',
        }}>Persp · live</span>
      </div>
    </div>
  );
}

// ─── UpdateNotification (slice 951h) ──────────────────────────────────────
// Surfaces electron-updater lifecycle events as a top-right banner.
// Subscribes to window.studioUpdater (set up by electron/preload.js)
// and shows three states: "Update v… available" / "Downloading … %" /
// "Update v… ready — restart to apply". Click the action button to
// trigger autoUpdater.quitAndInstall via IPC.
function UpdateNotification() {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.studioUpdater) return undefined;
    const off = window.studioUpdater.onUpdate((channel, payload) => {
      if (channel === 'update:available') {
        setState({ kind: 'available', version: (payload && payload.version) || '' });
      } else if (channel === 'update:progress') {
        setState({ kind: 'progress', percent: Math.round((payload && payload.percent) || 0) });
      } else if (channel === 'update:downloaded') {
        setState({ kind: 'downloaded', version: (payload && payload.version) || '' });
      } else if (channel === 'update:error') {
        setState({ kind: 'error', message: (payload && payload.message) || 'update error' });
        setTimeout(() => setState(null), 6000);
      }
    });
    return () => { if (typeof off === 'function') off(); };
  }, []);
  if (!state) return null;
  const restart = () => {
    if (window.studioUpdater && typeof window.studioUpdater.quitAndInstall === 'function') {
      window.studioUpdater.quitAndInstall();
    }
  };
  const label = state.kind === 'available'
    ? `New update v${state.version} available — downloading`
    : state.kind === 'progress'
    ? `Downloading update · ${state.percent}%`
    : state.kind === 'downloaded'
    ? `Update v${state.version} ready`
    : `Update error: ${state.message}`;
  const showButton = state.kind === 'downloaded';
  return (
    <div
      data-studio-v3-update-notification
      data-studio-v3-update-state={state.kind}
      style={{
        position: 'fixed', top: 44, right: 14, zIndex: 90,
        background: 'var(--studio-canvas-2, #0a0a0a)',
        border: '1px solid var(--studio-accent-rim, rgba(255,255,255,0.28))',
        borderRadius: 4,
        padding: '8px 12px',
        color: 'var(--studio-ink, #f0eee6)',
        fontFamily: 'var(--studio-font, system-ui)',
        fontSize: 11,
        display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
        minWidth: 280,
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: 3,
        background: state.kind === 'error' ? 'var(--studio-err, #d9d9d9)' : 'var(--studio-ink, #f0eee6)',
      }} />
      <span style={{ flex: 1 }}>{label}</span>
      {showButton && (
        <button
          type="button"
          data-studio-v3-update-restart
          onClick={restart}
          style={{
            padding: '3px 10px', fontSize: 10, fontFamily: 'inherit', fontWeight: 600,
            background: 'var(--studio-ink, #f0eee6)',
            color: 'var(--studio-canvas, #000000)',
            border: 'none', borderRadius: 3, cursor: 'pointer',
            letterSpacing: '0.04em', textTransform: 'uppercase',
          }}
        >Restart</button>
      )}
      <button
        type="button"
        data-studio-v3-update-dismiss
        onClick={() => setState(null)}
        title="Dismiss"
        style={{
          width: 18, height: 18, padding: 0, lineHeight: '14px',
          background: 'transparent', border: 'none',
          color: 'var(--studio-ink-mute, #777)',
          cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
        }}
      >×</button>
    </div>
  );
}

// Slice 519 — Subtle viewport brand watermark. Mounted as the first
// child of the <main> viewport so it floats over the canvas but stays
// below all overlays (HUD, menus, marquee).
function ViewportWatermark() {
  return (
    <div
      data-studio-v3-watermark
      style={{
        position: 'absolute', right: 10, bottom: 10, zIndex: 1,
        pointerEvents: 'none', userSelect: 'none',
        fontSize: 10, letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--studio-ink-mute, #9aa6b2)', opacity: 0.42,
        fontFamily: 'var(--studio-mono, ui-monospace)',
      }}
    >ArchDisc · Studio</div>
  );
}

// Slice 525 — Click any inspector section title to collapse the body.
// Persisted by title text. Uses a single delegated mousedown listener +
// CSS-display toggle so we don't need to wrap every section.
function SectionCollapser() {
  useEffect(() => {
    const KEY = 'studio.v3.collapsed-sections';
    const read = () => {
      try { return JSON.parse(window.localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; }
    };
    const write = (m) => { try { window.localStorage.setItem(KEY, JSON.stringify(m)); } catch (_) {} };
    const titleOf = (el) => (el.textContent || '').replace(/^▾\s*/, '').replace(/\s*·.*$/, '').trim();
    const apply = () => {
      const state = read();
      const titles = document.querySelectorAll('.studio-right-section-title');
      for (const t of titles) {
        const sec = t.parentElement;
        if (!sec) continue;
        const title = titleOf(t);
        const collapsed = !!state[title];
        sec.setAttribute('data-studio-v3-collapsed', collapsed ? 'true' : 'false');
        // Hide all non-title children.
        for (const c of sec.children) {
          if (c === t) continue;
          c.style.display = collapsed ? 'none' : '';
        }
        t.style.cursor = 'pointer';
        t.setAttribute('data-studio-v3-section-collapsible', title);
        // Add a chevron prefix once.
        if (!t.dataset.chevroned) {
          t.dataset.chevroned = '1';
          const chev = document.createElement('span');
          chev.dataset.studioV3SectionChevron = '1';
          chev.style.display = 'inline-block';
          chev.style.width = '10px';
          chev.style.transition = 'transform 120ms';
          chev.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
          chev.textContent = '▾';
          t.insertBefore(chev, t.firstChild);
        } else {
          const chev = t.querySelector('[data-studio-v3-section-chevron]');
          if (chev) chev.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
        }
      }
    };
    const onClick = (e) => {
      const t = e.target.closest && e.target.closest('.studio-right-section-title');
      if (!t) return;
      const title = titleOf(t);
      const state = read();
      state[title] = !state[title];
      write(state);
      apply();
    };
    document.addEventListener('mousedown', onClick);
    const id = setInterval(apply, 800); // re-apply after re-renders
    apply();
    return () => { document.removeEventListener('mousedown', onClick); clearInterval(id); };
  }, []);
  return null;
}

// Slice 550 — File menu as a floating panel docked under the File chip.
// Lists Save / Save As / Open / Export PNG / Export GLTF / OBJ / STL /
// Recent files (top 5). Esc dismisses.
function FileMenu() {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState([]);
  useEffect(() => {
    const onToggle = () => {
      setOpen((v) => !v);
      setRecent((window.__studioListRecentFiles && window.__studioListRecentFiles()) || []);
    };
    const onKey = (e) => { if (open && e.key === 'Escape') { setOpen(false); e.preventDefault(); } };
    const onClickOutside = (e) => {
      if (!open) return;
      if (e.target && e.target.closest && e.target.closest('[data-studio-v3-file-menu], [data-studio-v3-menu="file"]')) return;
      setOpen(false);
    };
    window.addEventListener('studio-file-menu-toggle', onToggle);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('studio-file-menu-toggle', onToggle);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClickOutside);
    };
  }, [open]);
  if (!open) return null;
  const actions = [
    { id: 'save',     label: 'Save scene',          hint: 'Cmd+S',       call: () => window.__studioDownloadScene && window.__studioDownloadScene() },
    { id: 'save-as',  label: 'Save scene as…',      hint: 'Cmd+Shift+S', call: () => window.dispatchEvent(new CustomEvent('studio-save-as-open')) },
    { id: 'open',     label: 'Open scene…',         hint: 'Cmd+O',       call: () => window.__studioOpenSceneFile && window.__studioOpenSceneFile() },
    { id: 'export-png',  label: 'Export viewport PNG', hint: 'Cmd+Shift+E', call: () => window.__studioExportViewportPNG && window.__studioExportViewportPNG() },
    { id: 'export-gltf', label: 'Export GLTF',         hint: 'Cmd+E',       call: () => window.__studioDownloadGLTF && window.__studioDownloadGLTF() },
    { id: 'export-obj',  label: 'Export OBJ',                              call: () => window.__studioExportOBJ && window.__studioExportOBJ() },
    { id: 'export-stl',  label: 'Export STL',                              call: () => window.__studioExportSTL && window.__studioExportSTL() },
  ];
  return (
    <div
      data-studio-v3-file-menu
      style={{
        position: 'fixed', top: 36, left: 96, zIndex: 9300,
        minWidth: 260,
        background: 'var(--studio-canvas-3, #141414)',
        border: '1px solid var(--studio-rail-edge, #1d2027)',
        borderRadius: 6,
        boxShadow: '0 20px 50px rgba(0,0,0,0.55)',
        color: 'var(--studio-ink, #f0eee6)',
        fontFamily: 'inherit', fontSize: 12,
        padding: '6px 0',
      }}
    >
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          data-studio-v3-file-action={a.id}
          onClick={() => { try { a.call(); } catch (_) {} setOpen(false); }}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            width: '100%', padding: '5px 14px', textAlign: 'left',
            background: 'transparent', border: 0,
            color: 'var(--studio-ink, #f0eee6)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span>{a.label}</span>
          <span style={{ opacity: 0.5, fontSize: 10, fontFamily: 'var(--studio-mono, ui-monospace)' }}>{a.hint || ''}</span>
        </button>
      ))}
      {recent.length > 0 && (
        <>
          <div style={{ borderTop: '1px solid var(--studio-rail-edge, #1d2027)', margin: '4px 0' }} />
          <div style={{
            padding: '4px 14px 2px', fontSize: 10, opacity: 0.55,
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>Recent</div>
          {recent.slice(0, 5).map((it) => (
            <button
              key={it.name}
              type="button"
              data-studio-v3-file-recent={it.name}
              onClick={() => { if (window.__studioOpenRecentFile) window.__studioOpenRecentFile(it.name); setOpen(false); }}
              style={{
                display: 'block', width: '100%', padding: '4px 14px', textAlign: 'left',
                background: 'transparent', border: 0,
                color: 'var(--studio-ink, #f0eee6)', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--studio-mono, ui-monospace)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >{it.name}</button>
          ))}
        </>
      )}
    </div>
  );
}

// Slice 551 — Edit menu mirrors the slice 550 pattern with undo / redo /
// duplicate / delete / select-all / invert / group / ungroup / lock.
function EditMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e) => { if (open && e.key === 'Escape') { setOpen(false); e.preventDefault(); } };
    const onClickOutside = (e) => {
      if (!open) return;
      if (e.target && e.target.closest && e.target.closest('[data-studio-v3-edit-menu], [data-studio-v3-menu="edit"]')) return;
      setOpen(false);
    };
    window.addEventListener('studio-edit-menu-toggle', onToggle);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('studio-edit-menu-toggle', onToggle);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClickOutside);
    };
  }, [open]);
  if (!open) return null;
  const actions = [
    { id: 'undo',       label: 'Undo',                 hint: 'Cmd+Z',         call: () => window.__studioUndo && window.__studioUndo() },
    { id: 'redo',       label: 'Redo',                 hint: 'Cmd+Shift+Z',   call: () => window.__studioRedo && window.__studioRedo() },
    { id: 'duplicate',  label: 'Duplicate selected',   hint: 'Shift+D',       call: () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', shiftKey: true })); } },
    { id: 'delete',     label: 'Delete selected',      hint: 'X / Delete',    call: () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' })); } },
    { id: 'select-all', label: 'Select all',           hint: 'A',             call: () => window.__studioSelectAll && window.__studioSelectAll() },
    { id: 'deselect',   label: 'Deselect',                                    call: () => window.__studioDeselect && window.__studioDeselect() },
    { id: 'group',      label: 'Group',                hint: 'Cmd+G',         call: () => window.__studioGroupSelected && window.__studioGroupSelected() },
    { id: 'ungroup',    label: 'Ungroup',              hint: 'Cmd+Shift+G',   call: () => window.__studioUngroupSelected && window.__studioUngroupSelected() },
    { id: 'lock',       label: 'Toggle lock',          hint: 'Cmd+L',         call: () => window.__studioToggleLockSelected && window.__studioToggleLockSelected() },
  ];
  return (
    <div
      data-studio-v3-edit-menu
      style={{
        position: 'fixed', top: 36, left: 158, zIndex: 9300,
        minWidth: 260,
        background: 'var(--studio-canvas-3, #141414)',
        border: '1px solid var(--studio-rail-edge, #1d2027)',
        borderRadius: 6,
        boxShadow: '0 20px 50px rgba(0,0,0,0.55)',
        color: 'var(--studio-ink, #f0eee6)',
        fontFamily: 'inherit', fontSize: 12,
        padding: '6px 0',
      }}
    >
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          data-studio-v3-edit-action={a.id}
          onClick={() => { try { a.call(); } catch (_) {} setOpen(false); }}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            width: '100%', padding: '5px 14px', textAlign: 'left',
            background: 'transparent', border: 0,
            color: 'var(--studio-ink, #f0eee6)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span>{a.label}</span>
          <span style={{ opacity: 0.5, fontSize: 10, fontFamily: 'var(--studio-mono, ui-monospace)' }}>{a.hint || ''}</span>
        </button>
      ))}
    </div>
  );
}

// Slice 552 — Select menu: all / deselect / invert / by-kind submenu.
function SelectMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e) => { if (open && e.key === 'Escape') { setOpen(false); e.preventDefault(); } };
    const onClickOutside = (e) => {
      if (!open) return;
      if (e.target && e.target.closest && e.target.closest('[data-studio-v3-select-menu], [data-studio-v3-menu="select"]')) return;
      setOpen(false);
    };
    window.addEventListener('studio-select-menu-toggle', onToggle);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('studio-select-menu-toggle', onToggle);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClickOutside);
    };
  }, [open]);
  if (!open) return null;
  const selectByKind = (kind) => {
    const s = window.__archdiscScene;
    if (!s) return;
    const set = [];
    s.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === kind) set.push(o);
    });
    window.__studioSelectedMeshesSet = set;
    if (set.length && window.__studioSelectMesh) window.__studioSelectMesh(set[set.length - 1]);
    if (window.__studioToast) window.__studioToast(`Selected ${set.length} ${kind}${set.length === 1 ? '' : 's'}`, 'info');
  };
  const actions = [
    { id: 'all',       label: 'Select all',       hint: 'A',        call: () => window.__studioSelectAll && window.__studioSelectAll() },
    { id: 'deselect',  label: 'Deselect all',                       call: () => { window.__studioSelectedMeshesSet = []; if (window.__studioDeselect) window.__studioDeselect(); } },
    { id: 'box',       label: 'Box marquee',      hint: 'B',        call: () => window.dispatchEvent(new CustomEvent('studio-marquee-arm')) },
    { id: 'cubes',     label: 'Cubes',                              call: () => selectByKind('cube') },
    { id: 'spheres',   label: 'Spheres',                            call: () => selectByKind('sphere') },
    { id: 'planes',    label: 'Planes',                             call: () => selectByKind('plane') },
    { id: 'groups',    label: 'Groups',                             call: () => selectByKind('group') },
  ];
  return (
    <div
      data-studio-v3-select-menu
      style={{
        position: 'fixed', top: 36, left: 220, zIndex: 9300,
        minWidth: 240,
        background: 'var(--studio-canvas-3, #141414)',
        border: '1px solid var(--studio-rail-edge, #1d2027)',
        borderRadius: 6,
        boxShadow: '0 20px 50px rgba(0,0,0,0.55)',
        color: 'var(--studio-ink, #f0eee6)',
        fontFamily: 'inherit', fontSize: 12,
        padding: '6px 0',
      }}
    >
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          data-studio-v3-select-action={a.id}
          onClick={() => { try { a.call(); } catch (_) {} setOpen(false); }}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            width: '100%', padding: '5px 14px', textAlign: 'left',
            background: 'transparent', border: 0,
            color: 'var(--studio-ink, #f0eee6)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span>{a.label}</span>
          <span style={{ opacity: 0.5, fontSize: 10, fontFamily: 'var(--studio-mono, ui-monospace)' }}>{a.hint || ''}</span>
        </button>
      ))}
    </div>
  );
}

// Slice 553 — View menu: framing, axis presets, projection toggle,
// presentation mode, cheatsheet.
function ViewMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e) => { if (open && e.key === 'Escape') { setOpen(false); e.preventDefault(); } };
    const onClickOutside = (e) => {
      if (!open) return;
      if (e.target && e.target.closest && e.target.closest('[data-studio-v3-view-menu], [data-studio-v3-menu="view"]')) return;
      setOpen(false);
    };
    window.addEventListener('studio-view-menu-toggle', onToggle);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('studio-view-menu-toggle', onToggle);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClickOutside);
    };
  }, [open]);
  if (!open) return null;
  const actions = [
    { id: 'frame-all',      label: 'Frame all',           call: () => window.__studioFrameAll && window.__studioFrameAll() },
    { id: 'frame-selected', label: 'Frame selected',     hint: '.', call: () => window.__studioFitSelected && window.__studioFitSelected() },
    { id: 'front',          label: 'Front (1)',          call: () => window.__studioSetCameraAxis && window.__studioSetCameraAxis('front') },
    { id: 'right',          label: 'Right (3)',          call: () => window.__studioSetCameraAxis && window.__studioSetCameraAxis('side') },
    { id: 'top',            label: 'Top (7)',            call: () => window.__studioSetCameraAxis && window.__studioSetCameraAxis('top') },
    { id: 'persp-ortho',    label: 'Toggle projection',  hint: '5', call: () => window.__studioToggleViewProjection && window.__studioToggleViewProjection() },
    { id: 'cheatsheet',     label: 'Cheatsheet',         hint: 'F1', call: () => window.dispatchEvent(new CustomEvent('studio-cheatsheet-toggle', { detail: { open: true } })) },
    { id: 'presentation',   label: 'Presentation mode',  hint: 'Cmd+P', call: () => window.dispatchEvent(new CustomEvent('studio-presentation-toggle')) },
  ];
  return (
    <div
      data-studio-v3-view-menu
      style={{
        position: 'fixed', top: 36, left: 280, zIndex: 9300,
        minWidth: 240,
        background: 'var(--studio-canvas-3, #141414)',
        border: '1px solid var(--studio-rail-edge, #1d2027)',
        borderRadius: 6,
        boxShadow: '0 20px 50px rgba(0,0,0,0.55)',
        color: 'var(--studio-ink, #f0eee6)',
        fontFamily: 'inherit', fontSize: 12,
        padding: '6px 0',
      }}
    >
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          data-studio-v3-view-action={a.id}
          onClick={() => { try { a.call(); } catch (_) {} setOpen(false); }}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            width: '100%', padding: '5px 14px', textAlign: 'left',
            background: 'transparent', border: 0,
            color: 'var(--studio-ink, #f0eee6)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span>{a.label}</span>
          <span style={{ opacity: 0.5, fontSize: 10, fontFamily: 'var(--studio-mono, ui-monospace)' }}>{a.hint || ''}</span>
        </button>
      ))}
    </div>
  );
}

// Slice 554 — Window menu: panel/overlay toggles + layout reset.
function WindowMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e) => { if (open && e.key === 'Escape') { setOpen(false); e.preventDefault(); } };
    const onClickOutside = (e) => {
      if (!open) return;
      if (e.target && e.target.closest && e.target.closest('[data-studio-v3-window-menu], [data-studio-v3-menu="window"]')) return;
      setOpen(false);
    };
    window.addEventListener('studio-window-menu-toggle', onToggle);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('studio-window-menu-toggle', onToggle);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClickOutside);
    };
  }, [open]);
  if (!open) return null;
  const resetLayout = () => {
    try {
      window.localStorage.removeItem('studio.v3.rightWidth');
      window.localStorage.removeItem('studio.v3.display-toggles');
      window.localStorage.removeItem('studio.v3.collapsed-sections');
    } catch (_) {}
    if (window.__studioToast) window.__studioToast('Layout reset — reload to apply', 'info');
  };
  const actions = [
    { id: 'panel-inspector', label: 'Right panel: Inspector', hint: 'Cmd+1', call: () => window.dispatchEvent(new CustomEvent('studio-right-tab-set', { detail: { tab: 'inspector' } })) },
    { id: 'panel-outliner',  label: 'Right panel: Outliner',  hint: 'Cmd+2', call: () => window.dispatchEvent(new CustomEvent('studio-right-tab-set', { detail: { tab: 'outliner' } })) },
    { id: 'panel-layers',    label: 'Right panel: Layers',    hint: 'Cmd+3', call: () => window.dispatchEvent(new CustomEvent('studio-right-tab-set', { detail: { tab: 'layers' } })) },
    { id: 'panel-toggle',    label: 'Toggle right panel',     hint: 'N',     call: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' })) },
    { id: 'cmd-palette',     label: 'Command palette',        hint: 'Cmd+K', call: () => window.dispatchEvent(new CustomEvent('studio-command-palette-toggle')) },
    { id: 'settings',        label: 'Settings',               hint: 'Cmd+,', call: () => window.dispatchEvent(new CustomEvent('studio-settings-toggle')) },
    { id: 'plugin-manager',  label: 'Plugin manager',                        call: () => window.dispatchEvent(new CustomEvent('studio-plugin-manager-toggle')) },
    { id: 'curve-editor',    label: 'Animation curves',     hint: 'Cmd+Shift+C', call: () => window.dispatchEvent(new CustomEvent('studio-curve-editor-toggle')) },
    { id: 'uv-editor',       label: 'UV editor',            hint: 'Cmd+Shift+U', call: () => window.dispatchEvent(new CustomEvent('studio-uv-editor-toggle')) },
    { id: 'asset-browser',   label: 'Asset browser',        hint: 'Cmd+Shift+A', call: () => window.dispatchEvent(new CustomEvent('studio-asset-browser-toggle')) },
    { id: 'quad-view',       label: 'Quad view',                                call: () => window.dispatchEvent(new CustomEvent('studio-quad-view-toggle')) },
    { id: 'render-queue',    label: 'Render queue',                             call: () => window.dispatchEvent(new CustomEvent('studio-render-queue-toggle')) },
    { id: 'script-editor',   label: 'Script editor',         hint: 'Cmd+Shift+J', call: () => window.dispatchEvent(new CustomEvent('studio-script-editor-toggle')) },
    { id: 'reset-layout',    label: 'Reset layout',                          call: resetLayout },
  ];
  return (
    <div
      data-studio-v3-window-menu
      style={{
        position: 'fixed', top: 36, left: 332, zIndex: 9300,
        minWidth: 260,
        background: 'var(--studio-canvas-3, #141414)',
        border: '1px solid var(--studio-rail-edge, #1d2027)',
        borderRadius: 6,
        boxShadow: '0 20px 50px rgba(0,0,0,0.55)',
        color: 'var(--studio-ink, #f0eee6)',
        fontFamily: 'inherit', fontSize: 12,
        padding: '6px 0',
      }}
    >
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          data-studio-v3-window-action={a.id}
          onClick={() => { try { a.call(); } catch (_) {} setOpen(false); }}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            width: '100%', padding: '5px 14px', textAlign: 'left',
            background: 'transparent', border: 0,
            color: 'var(--studio-ink, #f0eee6)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span>{a.label}</span>
          <span style={{ opacity: 0.5, fontSize: 10, fontFamily: 'var(--studio-mono, ui-monospace)' }}>{a.hint || ''}</span>
        </button>
      ))}
    </div>
  );
}

// Slice 558 — Keypress flash overlay. Renders the last chord for 1.2 s
// at viewport bottom-center. Gated by Display toggle 'keypress' (off by
// default — on demand for screencasts).
function KeypressFlash() {
  const KEY = 'studio.v3.display-toggles';
  const [enabled, setEnabled] = useState(() => {
    try {
      const obj = JSON.parse(window.localStorage.getItem(KEY) || '{}');
      return !!obj.keypress;
    } catch (_) { return false; }
  });
  const [text, setText] = useState('');
  useEffect(() => {
    const sync = () => {
      try {
        const obj = JSON.parse(window.localStorage.getItem(KEY) || '{}');
        setEnabled(!!obj.keypress);
      } catch (_) {}
    };
    const id = setInterval(sync, 800);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let timer = 0;
    const onKey = (e) => {
      const parts = [];
      if (e.metaKey || e.ctrlKey) parts.push('Cmd');
      if (e.shiftKey) parts.push('Shift');
      if (e.altKey) parts.push('Alt');
      let k = e.key;
      if (k === ' ') k = 'Space';
      else if (k.length === 1) k = k.toUpperCase();
      parts.push(k);
      setText(parts.join('+'));
      clearTimeout(timer);
      timer = setTimeout(() => setText(''), 1200);
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(timer); };
  }, [enabled]);
  if (!enabled || !text) return null;
  return (
    <div
      data-studio-v3-keypress
      data-studio-v3-keypress-text={text}
      style={{
        position: 'fixed', bottom: 64, left: '50%', transform: 'translateX(-50%)',
        zIndex: 9100, pointerEvents: 'none',
        background: 'var(--studio-canvas-3, #141414)',
        border: '1px solid var(--studio-accent, #ebecef)',
        color: 'var(--studio-ink, #f0eee6)',
        fontFamily: 'var(--studio-mono, ui-monospace)',
        fontSize: 13, padding: '6px 14px', borderRadius: 4,
        boxShadow: '0 6px 18px rgba(0, 0, 0, 0.5)',
      }}
    >{text}</div>
  );
}

// Slice 572 — Animation curve editor. Plots the active mesh's keyframed
// position values vs frame on a SVG; click empty grid to insert a key
// at the picked frame at the mesh's current position. Open with
// Cmd+Shift+C or studio-curve-editor-toggle event.
function CurveEditor() {
  const [open, setOpen] = useState(false);
  const [kfs, setKfs] = useState([]);
  const W = 520, H = 220, PAD = 28;
  const F_MAX = 60;
  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e) => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (open && e.key === 'Escape') { setOpen(false); e.preventDefault(); }
    };
    window.addEventListener('studio-curve-editor-toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('studio-curve-editor-toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const read = () => {
      const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
      if (!m || !window.__studioGetKeyframes) { setKfs([]); return; }
      const r = window.__studioGetKeyframes(m.uuid);
      setKfs((r && r.keyframes) || []);
    };
    const id = setInterval(read, 400);
    read();
    return () => clearInterval(id);
  }, [open]);
  if (!open) return null;
  // Y-range: position.x bounds across keyframes; fall back to ±0.1.
  let yMin = -0.1, yMax = 0.1;
  if (kfs.length) {
    yMin = Math.min(...kfs.map((k) => k.position[0]));
    yMax = Math.max(...kfs.map((k) => k.position[0]));
    if (yMin === yMax) { yMin -= 0.05; yMax += 0.05; }
  }
  const fxToPx = (f) => PAD + (f / F_MAX) * (W - PAD * 2);
  const yToPx  = (y) => PAD + (1 - (y - yMin) / (yMax - yMin)) * (H - PAD * 2);
  const pxToF = (px) => Math.round(((px - PAD) / (W - PAD * 2)) * F_MAX);
  const pts = kfs.map((k) => ({ f: k.frame, y: k.position[0] }));
  const path = pts.length ? pts.map((p, i) => (i === 0 ? 'M' : 'L') + fxToPx(p.f) + ' ' + yToPx(p.y)).join(' ') : '';
  const insertAt = (f) => {
    if (window.__studioSetFrame) window.__studioSetFrame(Math.max(0, Math.min(F_MAX, f)));
    if (window.__studioInsertKeyframeAt) window.__studioInsertKeyframeAt(Math.max(0, Math.min(F_MAX, f)));
    if (window.__studioToast) window.__studioToast(`Key @ frame ${f}`, 'info');
  };
  return (
    <div
      data-studio-v3-curve-editor
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9200,
        background: 'rgba(13,17,23,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--studio-canvas-3, #141414)',
          border: '1px solid var(--studio-accent, #ebecef)',
          borderRadius: 8, padding: '18px 22px',
          color: 'var(--studio-ink, #f0eee6)',
          fontFamily: 'inherit',
          boxShadow: '0 14px 40px rgba(0,0,0,0.55)',
        }}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: 10,
        }}>
          <strong style={{ color: 'var(--studio-accent, #ebecef)', fontSize: 13, letterSpacing: '0.04em' }}>Curve editor · position.x</strong>
          <span style={{ opacity: 0.55, fontSize: 11, fontFamily: 'var(--studio-mono, ui-monospace)' }}>{kfs.length} keys · Esc</span>
        </div>
        <svg
          width={W} height={H} viewBox={`0 0 ${W} ${H}`}
          data-studio-v3-curve-svg
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const f = pxToF(e.clientX - rect.left);
            insertAt(f);
          }}
          style={{ background: 'rgba(13,17,23,0.5)', borderRadius: 4, cursor: 'crosshair' }}
        >
          {/* Axes */}
          <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="rgba(154,166,178,0.25)" />
          <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="rgba(154,166,178,0.25)" />
          {/* Frame ticks */}
          {[0, 15, 30, 45, 60].map((f) => (
            <g key={f}>
              <line x1={fxToPx(f)} y1={H - PAD} x2={fxToPx(f)} y2={H - PAD + 4} stroke="rgba(154,166,178,0.5)" />
              <text x={fxToPx(f)} y={H - PAD + 14} fontSize="9" fill="rgba(154,166,178,0.8)" textAnchor="middle" fontFamily="ui-monospace, monospace">{f}</text>
            </g>
          ))}
          {/* Curve */}
          {path && <path d={path} stroke="var(--studio-accent, #ebecef)" strokeWidth="1.5" fill="none" />}
          {/* Keyframe dots */}
          {pts.map((p, i) => (
            <circle
              key={i}
              data-studio-v3-curve-key={p.f}
              cx={fxToPx(p.f)} cy={yToPx(p.y)} r="4"
              fill="var(--studio-accent, #ebecef)" stroke="#000000" strokeWidth="1"
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

// Slice 574 — Plugin manager modal. Open via studio-plugin-manager-toggle
// or Cmd+Shift+P (overriding the older "focus cmdbar" alias). Install /
// list / uninstall persistent userland plugins.
function PluginManager() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('window.__studioToast && window.__studioToast(\'hello from plugin\', \'info\');');
  const [list, setList] = useState([]);
  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e) => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if (open && e.key === 'Escape') { setOpen(false); e.preventDefault(); }
    };
    window.addEventListener('studio-plugin-manager-toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('studio-plugin-manager-toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useEffect(() => {
    if (open) setList((window.__studioListPlugins && window.__studioListPlugins()) || []);
  }, [open]);
  const refresh = () => setList((window.__studioListPlugins && window.__studioListPlugins()) || []);
  const install = () => {
    if (!name.trim()) return;
    if (window.__studioInstallPlugin) window.__studioInstallPlugin(name.trim(), code);
    setName('');
    refresh();
  };
  const uninstall = (n) => { if (window.__studioUninstallPlugin) window.__studioUninstallPlugin(n); refresh(); };
  if (!open) return null;
  return (
    <div
      data-studio-v3-plugin-manager
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9200,
        background: 'rgba(13,17,23,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--studio-canvas-3, #141414)',
          border: '1px solid var(--studio-accent, #ebecef)',
          borderRadius: 8, padding: '18px 22px', minWidth: 520, maxWidth: 640,
          color: 'var(--studio-ink, #f0eee6)', fontFamily: 'inherit',
        }}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: 12,
        }}>
          <strong style={{ color: 'var(--studio-accent, #ebecef)', fontSize: 13, letterSpacing: '0.04em' }}>Plugin manager</strong>
          <span style={{ opacity: 0.55, fontSize: 11, fontFamily: 'var(--studio-mono, ui-monospace)' }}>{list.length} installed · Esc</span>
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="plugin name (e.g. my-cube-spawner)"
          data-studio-v3-plugin-name
          style={{
            width: '100%', marginBottom: 6,
            padding: '6px 10px', background: 'var(--studio-canvas, #000000)',
            border: '1px solid var(--studio-rail-edge, #1d2027)',
            color: 'var(--studio-ink, #f0eee6)', borderRadius: 3,
            fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 11,
          }}
        />
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="// JS executed with (THREE, scene, viewport). Register window.__studio* here."
          data-studio-v3-plugin-code
          rows={5}
          style={{
            width: '100%', marginBottom: 10,
            padding: '6px 10px', background: 'var(--studio-canvas, #000000)',
            border: '1px solid var(--studio-rail-edge, #1d2027)',
            color: 'var(--studio-ink, #f0eee6)', borderRadius: 3,
            fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 11, resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <button
            type="button"
            onClick={install}
            data-studio-v3-plugin-install
            style={{
              background: 'var(--studio-accent, #ebecef)', border: 0, color: '#000000',
              fontWeight: 600, padding: '6px 18px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
            }}
          >Install</button>
        </div>
        <div style={{ borderTop: '1px solid var(--studio-rail-edge, #1d2027)', paddingTop: 12 }}>
          {list.length === 0 && <div style={{ opacity: 0.5, fontSize: 11 }}>No plugins installed.</div>}
          {list.map((p) => (
            <div
              key={p.name}
              data-studio-v3-plugin-row={p.name}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '4px 0', fontSize: 11,
                borderBottom: '1px dotted var(--studio-rail-edge, #1d2027)',
              }}
            >
              <span style={{ fontFamily: 'var(--studio-mono, ui-monospace)' }}>{p.name}</span>
              <button
                type="button"
                data-studio-v3-plugin-uninstall={p.name}
                onClick={() => uninstall(p.name)}
                style={{
                  padding: '2px 8px', fontSize: 10,
                  background: 'transparent', color: 'var(--studio-ink-mute, #9aa6b2)',
                  border: '1px solid var(--studio-rail-edge, #1d2027)', borderRadius: 2, cursor: 'pointer',
                }}
              >remove</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Slice 575 — UV editor modal. Plots the active mesh's geometry.uv
// attribute as vertices + edges in the unit square. Open via
// studio-uv-editor-toggle or Cmd+Shift+U.
function UVEditor() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ verts: [], edges: [] });
  const S = 380;
  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e) => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (open && e.key === 'Escape') { setOpen(false); e.preventDefault(); }
    };
    window.addEventListener('studio-uv-editor-toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('studio-uv-editor-toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const read = () => {
      const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
      if (!m || !m.geometry || !m.geometry.attributes || !m.geometry.attributes.uv) {
        setData({ verts: [], edges: [] });
        return;
      }
      const uv = m.geometry.attributes.uv;
      const verts = [];
      for (let i = 0; i < uv.count; i++) verts.push({ u: uv.getX(i), v: uv.getY(i) });
      const idx = m.geometry.index ? m.geometry.index.array : null;
      const edges = [];
      const t = idx ? Math.floor(idx.length / 3) : Math.floor(uv.count / 3);
      const cap = Math.min(t, 800);
      for (let i = 0; i < cap; i++) {
        const i0 = idx ? idx[i * 3]     : i * 3;
        const i1 = idx ? idx[i * 3 + 1] : i * 3 + 1;
        const i2 = idx ? idx[i * 3 + 2] : i * 3 + 2;
        edges.push([i0, i1], [i1, i2], [i2, i0]);
      }
      setData({ verts, edges });
    };
    const id = setInterval(read, 600);
    read();
    return () => clearInterval(id);
  }, [open]);
  if (!open) return null;
  const px = (u) => Math.round(u * S);
  const py = (v) => Math.round((1 - v) * S);
  return (
    <div
      data-studio-v3-uv-editor
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9200,
        background: 'rgba(13,17,23,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--studio-canvas-3, #141414)',
          border: '1px solid var(--studio-accent, #ebecef)',
          borderRadius: 8, padding: '18px 22px',
          color: 'var(--studio-ink, #f0eee6)', fontFamily: 'inherit',
        }}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: 10,
        }}>
          <strong style={{ color: 'var(--studio-accent, #ebecef)', fontSize: 13, letterSpacing: '0.04em' }}>UV editor</strong>
          <span style={{ opacity: 0.55, fontSize: 11, fontFamily: 'var(--studio-mono, ui-monospace)' }}>{data.verts.length} verts · Esc</span>
        </div>
        <svg
          width={S} height={S} viewBox={`0 0 ${S} ${S}`}
          data-studio-v3-uv-svg
          style={{ background: 'rgba(13,17,23,0.55)', borderRadius: 4 }}
        >
          {/* Frame */}
          <rect x="0" y="0" width={S} height={S} fill="none" stroke="rgba(154,166,178,0.3)" />
          {/* Triangle edges */}
          {data.edges.map(([a, b], i) => (
            <line
              key={i}
              x1={px(data.verts[a].u)} y1={py(data.verts[a].v)}
              x2={px(data.verts[b].u)} y2={py(data.verts[b].v)}
              stroke="rgba(255, 255, 255, 0.45)" strokeWidth="0.7"
            />
          ))}
          {/* UV vertices */}
          {data.verts.map((p, i) => (
            <circle
              key={i}
              data-studio-v3-uv-vert={i}
              cx={px(p.u)} cy={py(p.v)} r="2"
              fill="var(--studio-accent, #ebecef)"
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

// Slice 577 — Asset browser. Grid of primitive tiles + recent files +
// reference plates. Open via studio-asset-browser-toggle or Cmd+Shift+A
// (overrides quick-add menu's bare Shift+A — different chord).
function AssetBrowser() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('primitives');
  const [recent, setRecent] = useState([]);
  const [plates, setPlates] = useState([]);
  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e) => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (open && e.key === 'Escape') { setOpen(false); e.preventDefault(); }
    };
    window.addEventListener('studio-asset-browser-toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('studio-asset-browser-toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    setRecent((window.__studioListRecentFiles && window.__studioListRecentFiles()) || []);
    setPlates((window.__studioListImagePlates && window.__studioListImagePlates()) || []);
  }, [open, tab]);
  if (!open) return null;
  const PRIM_KINDS = ['cube', 'sphere', 'plane', 'cylinder', 'cone', 'torus', 'icosahedron', 'text', 'curve', 'empty'];
  const spawn = (kind) => {
    if (window.__spawnPrimitive && window.__archdiscScene) window.__spawnPrimitive(kind, window.__archdiscScene);
    if (window.__studioToast) window.__studioToast(`Added ${kind}`, 'ok');
  };
  const tile = (label, onClick, key) => (
    <button
      key={key}
      type="button"
      data-studio-v3-asset-tile={key}
      onClick={onClick}
      style={{
        width: 90, height: 90,
        background: 'var(--studio-canvas, #000000)',
        border: '1px solid var(--studio-rail-edge, #1d2027)',
        color: 'var(--studio-ink, #f0eee6)', borderRadius: 4, cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 11,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', textTransform: 'capitalize',
        whiteSpace: 'normal', overflow: 'hidden', textOverflow: 'ellipsis',
        padding: 6,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--studio-accent, #ebecef)'; e.currentTarget.style.color = 'var(--studio-accent, #ebecef)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--studio-rail-edge, #1d2027)'; e.currentTarget.style.color = 'var(--studio-ink, #f0eee6)'; }}
    >{label}</button>
  );
  return (
    <div
      data-studio-v3-asset-browser
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9200,
        background: 'rgba(13,17,23,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--studio-canvas-3, #141414)',
          border: '1px solid var(--studio-accent, #ebecef)',
          borderRadius: 8, padding: '18px 22px',
          color: 'var(--studio-ink, #f0eee6)', fontFamily: 'inherit',
          minWidth: 540, maxWidth: 720,
        }}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: 14,
        }}>
          <strong style={{ color: 'var(--studio-accent, #ebecef)', fontSize: 13, letterSpacing: '0.04em' }}>Asset browser</strong>
          <span style={{ opacity: 0.55, fontSize: 11, fontFamily: 'var(--studio-mono, ui-monospace)' }}>Esc to close</span>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {['primitives', 'recent', 'plates'].map((t) => (
            <button
              key={t}
              type="button"
              data-studio-v3-asset-tab={t}
              data-active={t === tab ? 'true' : 'false'}
              onClick={() => setTab(t)}
              style={{
                padding: '4px 12px',
                background: t === tab ? 'var(--studio-accent, #ebecef)' : 'var(--studio-canvas, #000000)',
                color: t === tab ? '#000000' : 'var(--studio-ink, #f0eee6)',
                border: '1px solid var(--studio-rail-edge, #1d2027)',
                borderRadius: 3, fontSize: 11, fontFamily: 'inherit',
                cursor: 'pointer', textTransform: 'capitalize',
              }}
            >{t}</button>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
          {tab === 'primitives' && PRIM_KINDS.map((k) => tile(k, () => spawn(k), k))}
          {tab === 'recent' && recent.length === 0 && (
            <div style={{ opacity: 0.5, fontSize: 11 }}>No recent files.</div>
          )}
          {tab === 'recent' && recent.map((r) => tile(r.name.split('-')[0], () => window.__studioOpenRecentFile && window.__studioOpenRecentFile(r.name), r.name))}
          {tab === 'plates' && plates.length === 0 && (
            <div style={{ opacity: 0.5, fontSize: 11 }}>No reference plates yet — drop an image on the viewport.</div>
          )}
          {tab === 'plates' && plates.map((p) => tile(p.name, () => window.__studioSelectMesh && (() => {
            let m = null;
            window.__archdiscScene.traverse((o) => { if (o.uuid === p.uuid) m = o; });
            if (m) window.__studioSelectMesh(m);
          })(), p.uuid))}
        </div>
      </div>
    </div>
  );
}

// Slice 580 — Render queue modal. Add current camera; add all camera
// bookmarks; clear; render all. Toggle via studio-render-queue-toggle.
function RenderQueueModal() {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState([]);
  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onChange = () => setJobs((window.__studioListRenderQueue && window.__studioListRenderQueue()) || []);
    const onKey = (e) => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if (open && e.key === 'Escape') { setOpen(false); e.preventDefault(); }
    };
    window.addEventListener('studio-render-queue-toggle', onToggle);
    window.addEventListener('studio-render-queue-changed', onChange);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('studio-render-queue-toggle', onToggle);
      window.removeEventListener('studio-render-queue-changed', onChange);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useEffect(() => { if (open) setJobs((window.__studioListRenderQueue && window.__studioListRenderQueue()) || []); }, [open]);
  if (!open) return null;
  const addCurrent = () => {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.camera) return;
    const p = [vp.camera.position.x, vp.camera.position.y, vp.camera.position.z];
    const t = vp.orbitControls && vp.orbitControls.target ? [vp.orbitControls.target.x, vp.orbitControls.target.y, vp.orbitControls.target.z] : [0, 0, 0];
    if (window.__studioEnqueueRender) window.__studioEnqueueRender({ name: `current-${jobs.length + 1}`, position: p, target: t });
  };
  return (
    <div
      data-studio-v3-render-queue
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9200,
        background: 'rgba(13,17,23,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--studio-canvas-3, #141414)',
          border: '1px solid var(--studio-accent, #ebecef)',
          borderRadius: 8, padding: '18px 22px', minWidth: 480, maxWidth: 600,
          color: 'var(--studio-ink, #f0eee6)', fontFamily: 'inherit',
        }}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: 12,
        }}>
          <strong style={{ color: 'var(--studio-accent, #ebecef)', fontSize: 13, letterSpacing: '0.04em' }}>Render queue · {jobs.length}</strong>
          <span style={{ opacity: 0.55, fontSize: 11, fontFamily: 'var(--studio-mono, ui-monospace)' }}>Esc</span>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          <button type="button" data-studio-v3-render-queue-add-current onClick={addCurrent}
            style={btnStyle}
          >+ Current camera</button>
          <button type="button" data-studio-v3-render-queue-add-bookmarks onClick={() => window.__studioEnqueueCameraBookmarks && window.__studioEnqueueCameraBookmarks()}
            style={btnStyle}
          >+ All bookmarks</button>
          <button type="button" data-studio-v3-render-queue-clear onClick={() => window.__studioClearRenderQueue && window.__studioClearRenderQueue()}
            style={btnStyle}
          >Clear</button>
          <button type="button" data-studio-v3-render-queue-run onClick={() => window.__studioRunRenderQueue && window.__studioRunRenderQueue()}
            style={{ ...btnStyle, background: 'var(--studio-accent, #ebecef)', color: '#000000', fontWeight: 600 }}
          >Render all</button>
        </div>
        <div style={{ borderTop: '1px solid var(--studio-rail-edge, #1d2027)', paddingTop: 8 }}>
          {jobs.length === 0 && <div style={{ opacity: 0.5, fontSize: 11 }}>Queue empty.</div>}
          {jobs.map((j, i) => (
            <div
              key={i}
              data-studio-v3-render-queue-row={i}
              style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '4px 0', fontSize: 11,
                borderBottom: '1px dotted var(--studio-rail-edge, #1d2027)',
              }}
            >
              <span style={{ fontFamily: 'var(--studio-mono, ui-monospace)' }}>{j.name}</span>
              <span style={{ opacity: 0.6, fontFamily: 'var(--studio-mono, ui-monospace)' }}>{j.w}×{j.h}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
const btnStyle = {
  padding: '4px 12px', fontSize: 11,
  background: 'var(--studio-canvas, #000000)',
  color: 'var(--studio-ink, #f0eee6)',
  border: '1px solid var(--studio-rail-edge, #1d2027)',
  borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
};

// Slice 584 — One-shot script editor. Different from PluginManager
// because nothing persists. Run via Cmd+Shift+J or
// studio-script-editor-toggle. Output is shown below the textarea
// (last 6 results).
function ScriptEditor() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('return window.__studioListPlugins ? window.__studioListPlugins().length : 0;');
  const [log, setLog] = useState([]);
  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e) => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (open && e.key === 'Escape') { setOpen(false); e.preventDefault(); }
    };
    window.addEventListener('studio-script-editor-toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('studio-script-editor-toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!open) return null;
  const run = () => {
    let result;
    try {
      // eslint-disable-next-line no-new-func
      result = new Function('THREE', 'scene', 'viewport', code)(
        window.__archdiscTHREE,
        window.__archdiscScene,
        window.__archdiscViewport,
      );
    } catch (e) {
      result = `Error: ${e.message}`;
    }
    setLog((cur) => [{ ts: Date.now(), result: String(result) }, ...cur].slice(0, 6));
  };
  return (
    <div
      data-studio-v3-script-editor
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9200,
        background: 'rgba(13,17,23,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--studio-canvas-3, #141414)',
          border: '1px solid var(--studio-accent, #ebecef)',
          borderRadius: 8, padding: '18px 22px', minWidth: 560, maxWidth: 720,
          color: 'var(--studio-ink, #f0eee6)', fontFamily: 'inherit',
        }}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: 10,
        }}>
          <strong style={{ color: 'var(--studio-accent, #ebecef)', fontSize: 13, letterSpacing: '0.04em' }}>Script editor</strong>
          <span style={{ opacity: 0.55, fontSize: 11, fontFamily: 'var(--studio-mono, ui-monospace)' }}>Cmd+Shift+J · Esc</span>
        </div>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          data-studio-v3-script-code
          rows={8}
          spellCheck={false}
          style={{
            width: '100%', marginBottom: 10,
            padding: '6px 10px', background: 'var(--studio-canvas, #000000)',
            border: '1px solid var(--studio-rail-edge, #1d2027)',
            color: 'var(--studio-ink, #f0eee6)', borderRadius: 3,
            fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 12, resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button
            type="button"
            data-studio-v3-script-run
            onClick={run}
            style={{
              background: 'var(--studio-accent, #ebecef)', border: 0, color: '#000000',
              fontWeight: 600, padding: '6px 18px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
            }}
          >Run</button>
        </div>
        <div data-studio-v3-script-output style={{
          fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 11,
          background: 'var(--studio-canvas, #000000)',
          border: '1px solid var(--studio-rail-edge, #1d2027)',
          borderRadius: 3, padding: '6px 10px',
          maxHeight: 160, overflowY: 'auto',
        }}>
          {log.length === 0 && <div style={{ opacity: 0.4 }}>No output yet — Run to evaluate.</div>}
          {log.map((l, i) => (
            <div
              key={i}
              data-studio-v3-script-result={i}
              style={{
                padding: '3px 0',
                borderBottom: i < log.length - 1 ? '1px dotted var(--studio-rail-edge, #1d2027)' : 'none',
              }}
            >{l.result}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ToastBus() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let nextId = 1;
    const onToast = (ev) => {
      const d = ev && ev.detail;
      if (!d || !d.msg) return;
      const id = nextId++;
      setItems((cur) => [...cur.slice(-3), { id, msg: d.msg, kind: d.kind || 'info' }]);
      setTimeout(() => setItems((cur) => cur.filter((it) => it.id !== id)), 2600);
    };
    window.addEventListener('studio-toast', onToast);
    window.__studioToast = (msg, kind = 'info') => {
      window.dispatchEvent(new CustomEvent('studio-toast', { detail: { msg, kind } }));
    };
    return () => {
      window.removeEventListener('studio-toast', onToast);
      try { delete window.__studioToast; } catch (_) {}
    };
  }, []);
  if (!items.length) return null;
  return (
    <div
      data-studio-v3-toast-bus
      data-studio-v3-toast-count={items.length}
      style={{
        position: 'fixed', top: 64, right: 16, zIndex: 9998,
        display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'none',
      }}
    >
      {items.map((it) => (
        <div
          key={it.id}
          data-studio-v3-toast
          data-studio-v3-toast-kind={it.kind}
          style={{
            background: 'var(--studio-canvas-3, #141414)',
            borderLeft: `3px solid ${it.kind === 'warn' ? '#f1c40f' : 'var(--studio-accent, #ebecef)'}`,
            color: 'var(--studio-ink, #f0eee6)',
            fontSize: 11.5,
            padding: '6px 12px',
            borderRadius: 4,
            boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
            minWidth: 180,
          }}
        >{it.msg}</div>
      ))}
    </div>
  );
}

// Slice 494 — First-launch onboarding tour. 4 numbered cards positioned
// near the relevant UI region. Skippable; persisted in localStorage.
const TOUR_KEY = 'studio.v3.tour-seen';
const TOUR_STEPS = [
  {
    title: 'Toolbar',
    text: 'Add primitives (cube, sphere, plane…) and pick a workbench from the left.',
    anchor: { top: 56, left: 18 },
    arrow: 'left',
  },
  {
    title: 'Viewport',
    text: 'Click to select · Drag to orbit · Scroll to zoom · G/R/S to move/rotate/scale.',
    anchor: { top: '40%', left: '50%' },
    arrow: 'top',
  },
  {
    title: 'Inspector',
    text: 'Edit transform, materials, layers. Cmd+1/2/3 cycles tabs · drag the left edge to resize.',
    anchor: { top: 56, right: 18 },
    arrow: 'right',
  },
  {
    title: 'Command bar',
    text: 'Cmd+/ to focus · Cmd+K for the palette · Shift+? for the full cheatsheet.',
    anchor: { bottom: 56, left: '50%' },
    arrow: 'bottom',
  },
];

function OnboardingTour() {
  const [seen, setSeen] = useState(() => {
    try { return Boolean(window.localStorage.getItem(TOUR_KEY)); } catch (_) { return true; }
  });
  const [step, setStep] = useState(0);
  if (seen) return null;
  const cur = TOUR_STEPS[step];
  const done = () => {
    try { window.localStorage.setItem(TOUR_KEY, '1'); } catch (_) {}
    setSeen(true);
  };
  const next = () => {
    if (step < TOUR_STEPS.length - 1) setStep(step + 1);
    else done();
  };
  const pos = { position: 'fixed', zIndex: 9999, maxWidth: 320 };
  if (cur.anchor.top != null) pos.top = cur.anchor.top;
  if (cur.anchor.left != null) pos.left = cur.anchor.left;
  if (cur.anchor.right != null) pos.right = cur.anchor.right;
  if (cur.anchor.bottom != null) pos.bottom = cur.anchor.bottom;
  if (typeof pos.left === 'string' && pos.left.endsWith('%')) pos.transform = 'translateX(-50%)';
  return (
    <div
      data-studio-v3-tour
      data-studio-v3-tour-step={step}
      style={{
        ...pos,
        background: 'var(--studio-canvas-3, #141414)',
        border: '1px solid var(--studio-accent, #ebecef)',
        borderRadius: 8,
        padding: '14px 16px',
        color: 'var(--studio-ink, #f0eee6)',
        fontSize: 12,
        boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <span style={{ color: 'var(--studio-accent, #ebecef)', fontWeight: 600, letterSpacing: '0.04em' }}>
          {step + 1}/{TOUR_STEPS.length} · {cur.title}
        </span>
        <button
          type="button"
          data-studio-v3-tour-skip
          onClick={done}
          style={{
            background: 'transparent', border: 0, color: 'var(--studio-ink-mute, #9aa6b2)',
            fontSize: 11, cursor: 'pointer', padding: 0,
          }}
        >skip</button>
      </div>
      <div style={{ marginBottom: 12, lineHeight: 1.45 }}>{cur.text}</div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          data-studio-v3-tour-next
          onClick={next}
          style={{
            background: 'var(--studio-accent, #ebecef)',
            border: 0, color: '#000000', fontSize: 11, fontWeight: 600,
            padding: '6px 14px', borderRadius: 4, cursor: 'pointer',
          }}
        >{step < TOUR_STEPS.length - 1 ? 'Next →' : 'Got it'}</button>
      </div>
    </div>
  );
}

function WelcomeCard() {
  // Slice 951f — removed per user request. The card centred on the
  // viewport blocked OrbitControls drag/zoom interactions (its DOM
  // node intercepted pointer events even though all it advertised was
  // help text), so "can't move or zoom" was actually "can't grab the
  // viewport because a div is sitting on top of it." Returning null
  // here keeps the component identity stable for any code that still
  // mounts <WelcomeCard /> in the shell but renders zero DOM.
  return null;
  // eslint-disable-next-line no-unreachable
  const [empty, setEmpty] = useState(true);
  const [recent, setRecent] = useState([]);
  useEffect(() => {
    const tick = () => {
      let n = 0;
      const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
      if (s) {
        try { s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; }); } catch (_) {}
      }
      setEmpty(n === 0);
      if (n === 0) {
        const list = (window.__studioListRecentFiles && window.__studioListRecentFiles()) || [];
        setRecent(list.slice(0, 3));
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, []);
  if (!empty) return null;
  return (
    <div
      data-studio-v3-welcome
      style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)', zIndex: 21,
        background: 'rgba(13, 17, 23, 0.78)',
        border: '1px solid var(--studio-rail-edge, #1d2027)',
        borderRadius: 6,
        padding: '18px 22px',
        color: 'var(--studio-ink, #f0eee6)',
        fontFamily: 'inherit', fontSize: 12,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
        minWidth: 280, maxWidth: 360, textAlign: 'center',
      }}
    >
      <div style={{
        fontSize: 13, fontWeight: 600, marginBottom: 8,
        color: 'var(--studio-accent, #ebecef)', letterSpacing: '0.03em',
      }}>ArchDisc Studio</div>
      <div style={{ marginBottom: 10, opacity: 0.8 }}>
        Pick a primitive in the toolbar to start.
      </div>
      <div style={{ fontSize: 11, opacity: 0.55, fontFamily: 'var(--studio-mono, ui-monospace)', marginBottom: recent.length ? 14 : 0 }}>
        Tab — edit mode<br />
        1 · 2 · 3 — vert · edge · face<br />
        Cmd+/ — focus command bar
      </div>
      {recent.length > 0 && (
        <div data-studio-v3-welcome-recent style={{
          borderTop: '1px solid var(--studio-rail-edge, #1d2027)',
          paddingTop: 10, textAlign: 'left',
        }}>
          <div style={{
            fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
            color: 'var(--studio-ink-mute, #9aa6b2)', marginBottom: 6,
          }}>Recent</div>
          {recent.map((it) => (
            <button
              key={it.name}
              type="button"
              data-studio-v3-welcome-recent-item={it.name}
              onClick={() => {
                if (window.__studioOpenRecentFile) window.__studioOpenRecentFile(it.name);
              }}
              style={{
                display: 'block', width: '100%', marginBottom: 3,
                padding: '4px 6px',
                background: 'transparent', border: '1px solid var(--studio-rail-edge, #1d2027)',
                color: 'var(--studio-ink, #f0eee6)', borderRadius: 3,
                cursor: 'pointer', fontSize: 10, fontFamily: 'var(--studio-mono, ui-monospace)',
                textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >{it.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Viewport HUD (edit-mode chips + axis chips + sub-object sel count) ──
function ViewportHUD({ editMode, setEditMode, axis, setAxis }) {
  // Slice 426 — Live count of selected verts/edges/faces. Only renders
  // in sub-object modes; reads __studioGetEditSelection on pick events.
  const [counts, setCounts] = useState({ vertices: 0, edges: 0, faces: 0 });
  useEffect(() => {
    const readSel = () => {
      if (window.__studioGetEditSelection) {
        const s = window.__studioGetEditSelection();
        setCounts({ vertices: s.vertices.length, edges: s.edges.length, faces: s.faces.length });
      }
    };
    const refresh = () => { queueMicrotask(readSel); };
    window.addEventListener('studio-pick', refresh);
    window.addEventListener('studio-edit-mode-changed', refresh);
    readSel();
    return () => {
      window.removeEventListener('studio-pick', refresh);
      window.removeEventListener('studio-edit-mode-changed', refresh);
    };
  }, []);
  const subMode = editMode === 'vertex' || editMode === 'edge' || editMode === 'face';
  return (
    <>
      <div className="studio-vp-hud" data-studio-v3-vp-hud>
        {EDIT_MODES.map((em, i) => (
          <React.Fragment key={em.id}>
            <button
              type="button"
              className="studio-vp-hud-btn"
              data-studio-v3-edit-mode={em.id}
              data-active={em.id === editMode ? 'true' : 'false'}
              title={em.label}
              onClick={() => setEditMode(em.id)}
            >
              <Icon name={em.icon} size={11} />
              <span>{em.label}</span>
            </button>
            {i === 0 && <span className="studio-vp-hud-sep" />}
          </React.Fragment>
        ))}
        {subMode && (
          <span
            className="studio-vp-hud-counts"
            data-studio-v3-edit-counts
            data-studio-v3-edit-v={counts.vertices}
            data-studio-v3-edit-e={counts.edges}
            data-studio-v3-edit-f={counts.faces}
            title={`Selected — verts ${counts.vertices} · edges ${counts.edges} · faces ${counts.faces}`}
            style={{
              marginLeft: 8, padding: '2px 8px',
              background: 'var(--studio-bg-elev)', border: '1px solid var(--studio-ink-mute)',
              borderRadius: 3, color: 'var(--studio-accent)',
              fontSize: 10, fontFamily: 'var(--studio-mono)',
              letterSpacing: '0.04em',
            }}
          >
            v{counts.vertices} · e{counts.edges} · f{counts.faces}
          </span>
        )}
      </div>
      <div className="studio-vp-axes" data-studio-v3-vp-axes>
        {AXES.map((ax) => (
          <button
            key={ax.id}
            type="button"
            className="studio-vp-axis"
            data-studio-v3-axis={ax.id}
            data-active={ax.id === axis ? 'true' : 'false'}
            title={`View · ${ax.id}`}
            onClick={() => setAxis(ax.id)}
          >{ax.label}</button>
        ))}
      </div>
    </>
  );
}

// ─── RightPanel (Inspector / Outliner / Layers) ──────────────────────────
function RightPanel({ collapsed, onToggle, activeWb, editMode, selection }) {
  const [tab, setTab] = useState('inspector');
  // Slice 478 — react to studio-right-tab-set from the Cmd+1/2/3 hotkey.
  useEffect(() => {
    const onSet = (ev) => { if (ev && ev.detail && ev.detail.tab) setTab(ev.detail.tab); };
    window.addEventListener('studio-right-tab-set', onSet);
    return () => window.removeEventListener('studio-right-tab-set', onSet);
  }, []);
  // Slice 493 — drag-to-resize splitter on the panel's left edge.
  // Width persists across reloads via localStorage.
  const RIGHT_W_KEY = 'studio.v3.rightWidth';
  const RIGHT_W_MIN = 220, RIGHT_W_MAX = 640;
  const [width, setWidth] = useState(() => {
    const raw = typeof window !== 'undefined' ? Number(window.localStorage.getItem(RIGHT_W_KEY)) : 0;
    return Number.isFinite(raw) && raw >= RIGHT_W_MIN && raw <= RIGHT_W_MAX ? raw : 280;
  });
  const dragRef = React.useRef(null);
  const onDragStart = (e) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: width };
    const onMove = (ev) => {
      const dx = ev.clientX - dragRef.current.startX;
      const next = Math.min(RIGHT_W_MAX, Math.max(RIGHT_W_MIN, dragRef.current.startW - dx));
      setWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  useEffect(() => { try { window.localStorage.setItem(RIGHT_W_KEY, String(width)); } catch (_) {} }, [width]);
  if (collapsed) {
    return (
      <aside className="studio-right" data-studio-v3-right data-collapsed="true">
        <div className="studio-right-collapsed">
          <button
            type="button"
            className="studio-right-collapsed-btn"
            data-studio-v3-right-expand
            onClick={onToggle}
            title="Expand inspector"
          ><Icon name="npanel" size={14} /></button>
        </div>
      </aside>
    );
  }
  return (
    <aside
      className="studio-right"
      data-studio-v3-right
      data-collapsed="false"
      style={{ width, flex: `0 0 ${width}px`, position: 'relative' }}
    >
      <div
        data-studio-v3-right-resize
        onMouseDown={onDragStart}
        title="Drag to resize"
        style={{
          position: 'absolute', left: -3, top: 0, bottom: 0, width: 6,
          cursor: 'ew-resize', zIndex: 5,
        }}
      />
      <div className="studio-right-tabs" data-studio-v3-right-tabs>
        {['inspector', 'outliner', 'layers'].map((t) => (
          <button
            key={t}
            type="button"
            className="studio-right-tab"
            data-studio-v3-right-tab={t}
            data-active={t === tab ? 'true' : 'false'}
            onClick={() => setTab(t)}
          >{t}</button>
        ))}
        <button
          type="button"
          className="studio-right-tab"
          data-studio-v3-right-collapse
          title="Collapse"
          onClick={onToggle}
          style={{ flex: '0 0 32px' }}
        ><Icon name="close" size={11} /></button>
      </div>
      <div className="studio-right-body" data-studio-v3-right-body={tab}>
        {tab === 'inspector' && <InspectorFilter />}
        {tab === 'inspector' && (
          <>
            <div className="studio-right-section">
              <div className="studio-right-section-title">Active</div>
              <div className="studio-right-row"><span>Discipline</span><strong style={{ textTransform: 'capitalize' }}>{activeWb}</strong></div>
              <div className="studio-right-row"><span>Mode</span><strong style={{ textTransform: 'capitalize' }}>{editMode}</strong></div>
            </div>
            {/* Slice 566 — Rename row works whether the React selection
                prop is set or not, polling __studioSelectedMesh directly. */}
            <RenameSection />
            <ObjectPropsSection />
            <ConstraintsSection />
            {selection && (
              <div className="studio-right-section" data-studio-v3-inspector-selection>
                <div className="studio-right-section-title">Selected · {selection.type || 'object'}</div>
                {selection.name && (
                  <div className="studio-right-row"><span>Name</span><strong>{selection.name}</strong></div>
                )}
                {selection.position && (
                  <>
                    <div className="studio-right-row"><span>X</span><strong style={{ fontFamily: 'var(--studio-mono)' }}>{selection.position.x}</strong></div>
                    <div className="studio-right-row"><span>Y</span><strong style={{ fontFamily: 'var(--studio-mono)' }}>{selection.position.y}</strong></div>
                    <div className="studio-right-row"><span>Z</span><strong style={{ fontFamily: 'var(--studio-mono)' }}>{selection.position.z}</strong></div>
                  </>
                )}
              </div>
            )}
            {/* Slice 458 — Detailed stats for the active mesh. */}
            <MeshStatsRows />
            {/* Slice 459 — Editable transform XYZ inputs. */}
            <TransformRows />
            {/* Slice 472 — Origin / pivot quick actions. */}
            <PivotActions />
            {/* Slice 565 — Geometry maintenance tools. */}
            <GeometryTools />
            {/* Slice 594 — Modifier history. */}
            <ModifierStackSection />
            {/* Slice 461 — Material properties. */}
            <MaterialRows />
            {/* Slice 498 — Camera FOV + projection. */}
            <CameraSection />
            {/* Slice 517 — Camera bookmarks. */}
            <CameraBookmarksSection />
            {/* Slice 499 — Snap step inputs (translate / rotate / scale). */}
            <SnapSection />
            {/* Slice 508 — World grid + background. */}
            <WorldSection />
            {/* Slice 604 — Fog. */}
            <FogSection />
            {/* Slice 605 — Sky gradient. */}
            <SkyGradientSection />
            {/* Slice 536 — Display toggles for overlays. */}
            <DisplaySection />
            {/* Slice 510 — Ambient + key intensity sliders. */}
            <LightingSection />
            {/* Slice 562 — Stage mood presets. */}
            <StagePresets />
            {/* Slice 516 — Per-workbench Notes textarea. */}
            <NotesSection activeWb={activeWb} />
            {/* Slice 518 — Recent undo history list. */}
            <HistorySection />
            {/* Slice 542 — Renderer perf diagnostics. */}
            <PerformanceSection />
            {/* Slice 593 — Animation summary + actions. */}
            <AnimationSection />
            {/* Slice 522 — Annotation list + delete. */}
            <AnnotationsSection />
            {/* Slice 538 — Reference image plate list. */}
            <ImagePlatesSection />
            {/* Slice 559 — Tags. */}
            <TagsSection />
            {/* Slice 592 — Selection sets. */}
            <SelectionSetsSection />
            {/* Slice 533 — Render section: custom-size PNG. */}
            <RenderSection />
            <div className="studio-right-section">
              <div className="studio-right-section-title">Edit selection</div>
              <SelectionRows />
            </div>
            {editMode === 'sculpt' && <SculptBrushPanel />}
            <VertexPaintPanel />
            {/* Slice 433 — Edit Tools buttons surface the slice 388/389/390/
                386/387 edit-mode ops as one-click actions in V3 inspector.
                Only shown in a sub-object mode. */}
            {(editMode === 'vertex' || editMode === 'edge' || editMode === 'face') && (
              <div className="studio-right-section" data-studio-v3-edit-tools>
                <div className="studio-right-section-title">Edit tools</div>
                {[
                  { id: 'extrude',   label: 'Extrude  0.005',  call: () => window.__studioExtrudeSelectedFaces && window.__studioExtrudeSelectedFaces(0.005) },
                  { id: 'inset',     label: 'Inset  0.3',      call: () => window.__studioInsetSelectedFaces && window.__studioInsetSelectedFaces(0.3) },
                  { id: 'subdivide', label: 'Subdivide  1→4',  call: () => window.__studioSubdivideSelectedFaces && window.__studioSubdivideSelectedFaces() },
                  { id: 'invert',    label: 'Invert',          call: () => window.__studioInvertEditSelection && window.__studioInvertEditSelection(editMode) },
                  { id: 'all',       label: 'Select All',      call: () => window.__studioSelectAllEdit && window.__studioSelectAllEdit(editMode) },
                  { id: 'clear',     label: 'Clear',           call: () => window.__studioClearEditSelection && window.__studioClearEditSelection() },
                ].map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    data-studio-v3-edit-tool={b.id}
                    onClick={b.call}
                    style={{
                      display: 'block', width: '100%', marginBottom: 3,
                      padding: '3px 8px', textAlign: 'left',
                      background: 'var(--studio-bg-elev)',
                      color: 'var(--studio-ink)',
                      border: '1px solid var(--studio-ink-mute)',
                      borderRadius: 3, cursor: 'pointer',
                      fontSize: 11, fontFamily: 'inherit',
                    }}
                  >{b.label}</button>
                ))}
              </div>
            )}
          </>
        )}
        {tab === 'outliner' && <OutlinerRows />}
        {tab === 'layers' && <LayersRows />}
      </div>
    </aside>
  );
}

function SelectionRows() {
  const [s, setS] = useState({ vertices: 0, edges: 0, faces: 0 });
  useEffect(() => {
    const read = () => {
      if (window.__studioGetEditSelection) {
        const sel = window.__studioGetEditSelection();
        setS({ vertices: sel.vertices.length, edges: sel.edges.length, faces: sel.faces.length });
      }
    };
    const id = setInterval(read, 400);
    read();
    return () => clearInterval(id);
  }, []);
  return (
    <>
      <div className="studio-right-row"><span>Vertices</span><strong>{s.vertices}</strong></div>
      <div className="studio-right-row"><span>Edges</span><strong>{s.edges}</strong></div>
      <div className="studio-right-row"><span>Faces</span><strong>{s.faces}</strong></div>
    </>
  );
}

function TransformRows() {
  // Read the active mesh once per second and reflect into editable
  // numeric inputs. The inputs use defaultValue + onBlur/Enter to
  // commit so typing doesn't churn parent state on every keystroke.
  const [version, setVersion] = useState(0);
  const meshRef = React.useRef(null);
  useEffect(() => {
    const id = setInterval(() => {
      const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
      const cur = meshRef.current;
      if ((cur && cur.uuid) !== (m && m.uuid)) {
        meshRef.current = m;
        setVersion((v) => v + 1);
      }
    }, 500);
    return () => clearInterval(id);
  }, []);
  const m = meshRef.current;
  if (!m) return null;
  const inStyle = {
    width: 60, padding: '2px 4px', fontSize: 11,
    fontFamily: 'var(--studio-mono, ui-monospace)',
    background: 'var(--studio-canvas-3, #1f1f1f)',
    color: 'var(--studio-ink, #dfe5ea)',
    border: '1px solid var(--studio-ink-mute, #2c2c30)',
    borderRadius: 2,
  };
  const commit = (kind, axis, raw) => {
    const v = Number(raw); if (!Number.isFinite(v)) return;
    if (kind === 'position') m.position[axis] = v;
    else if (kind === 'rotation') m.rotation[axis] = v * Math.PI / 180;
    else if (kind === 'scale') m.scale[axis] = Math.max(0.001, v);
    m.updateMatrixWorld(true);
  };
  const numIn = (kind, axis, value) => (
    <input
      type="number"
      step="0.01"
      data-studio-v3-transform={`${kind}-${axis}`}
      defaultValue={value}
      onBlur={(e) => commit(kind, axis, e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { commit(kind, axis, e.currentTarget.value); e.currentTarget.blur(); } }}
      style={inStyle}
    />
  );
  return (
    <div className="studio-right-section" data-studio-v3-transform-rows key={version}>
      <div className="studio-right-section-title">Transform</div>
      {/* Slice 564 — Each row gets a Reset chip that drives __studioResetTransform. */}
      <TransformLabelRow label="Position" kind="g" />
      <div className="studio-right-row" style={{ gap: 4 }}>
        {numIn('position', 'x', m.position.x.toFixed(4))}
        {numIn('position', 'y', m.position.y.toFixed(4))}
        {numIn('position', 'z', m.position.z.toFixed(4))}
      </div>
      <TransformLabelRow label="Rotation°" kind="r" />
      <div className="studio-right-row" style={{ gap: 4 }}>
        {numIn('rotation', 'x', (m.rotation.x * 180 / Math.PI).toFixed(2))}
        {numIn('rotation', 'y', (m.rotation.y * 180 / Math.PI).toFixed(2))}
        {numIn('rotation', 'z', (m.rotation.z * 180 / Math.PI).toFixed(2))}
      </div>
      <TransformLabelRow label="Scale" kind="s" />
      <div className="studio-right-row" style={{ gap: 4 }}>
        {numIn('scale', 'x', m.scale.x.toFixed(4))}
        {numIn('scale', 'y', m.scale.y.toFixed(4))}
        {numIn('scale', 'z', m.scale.z.toFixed(4))}
      </div>
      {/* Slice 618 — Quaternion readout (read-only). */}
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Quat</span>
        <strong
          data-studio-v3-quaternion
          style={{ fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 10, opacity: 0.85 }}
        >{[m.quaternion.x, m.quaternion.y, m.quaternion.z, m.quaternion.w].map((n) => n.toFixed(3)).join(', ')}</strong>
      </div>
    </div>
  );
}

// Slice 576 — Vertex paint inspector panel. Color picker + flood-fill +
// rainbow + init. Renders only when a selection exists.
function VertexPaintPanel() {
  const [hex, setHex] = useState('#ff7a59');
  const [uuid, setUuid] = useState(null);
  useEffect(() => {
    const t = setInterval(() => {
      const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
      setUuid(m ? m.uuid : null);
    }, 500);
    return () => clearInterval(t);
  }, []);
  if (!uuid) return null;
  return (
    <div className="studio-right-section" data-studio-v3-vertex-paint>
      <div className="studio-right-section-title">Vertex paint</div>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Color</span>
        <input
          type="color"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          data-studio-v3-vpaint-color
          style={{ width: 40, height: 22, padding: 0, border: '1px solid var(--studio-ink-mute)', borderRadius: 2, background: 'transparent', cursor: 'pointer' }}
        />
      </div>
      <button
        type="button"
        data-studio-v3-vpaint-flood
        onClick={() => window.__studioVertexPaintFloodFill && window.__studioVertexPaintFloodFill(hex)}
        style={{
          display: 'block', width: '100%', marginBottom: 3,
          padding: '3px 8px', textAlign: 'left',
          background: 'var(--studio-canvas-3, #141414)',
          color: 'var(--studio-ink, #f0eee6)',
          border: '1px solid var(--studio-rail-edge, #1d2027)',
          borderRadius: 3, cursor: 'pointer',
          fontSize: 11, fontFamily: 'inherit',
        }}
      >Flood fill</button>
      <button
        type="button"
        data-studio-v3-vpaint-rainbow
        onClick={() => window.__studioVertexPaintRandom && window.__studioVertexPaintRandom()}
        style={{
          display: 'block', width: '100%',
          padding: '3px 8px', textAlign: 'left',
          background: 'var(--studio-canvas-3, #141414)',
          color: 'var(--studio-ink, #f0eee6)',
          border: '1px solid var(--studio-rail-edge, #1d2027)',
          borderRadius: 3, cursor: 'pointer',
          fontSize: 11, fontFamily: 'inherit',
        }}
      >Rainbow vertices</button>
    </div>
  );
}

// Slice 573 — Sculpt brush panel. Shown only in sculpt edit mode.
function SculptBrushPanel() {
  const [brush, setBrush] = useState(() => (window.__studioGetSculptBrush && window.__studioGetSculptBrush()) || { kind: 'draw', size: 0.04, strength: 0.3, falloff: 0.6 });
  useEffect(() => {
    const onChange = (e) => { if (e && e.detail) setBrush(e.detail); };
    window.addEventListener('studio-sculpt-brush-changed', onChange);
    return () => window.removeEventListener('studio-sculpt-brush-changed', onChange);
  }, []);
  const update = (patch) => {
    if (window.__studioSetSculptBrush) window.__studioSetSculptBrush(patch);
    setBrush((b) => ({ ...b, ...patch }));
  };
  const kinds = ['draw', 'inflate', 'pinch', 'smooth', 'crease', 'flatten'];
  return (
    <div className="studio-right-section" data-studio-v3-sculpt-brush>
      <div className="studio-right-section-title">Sculpt brush</div>
      <div className="studio-right-row" style={{ flexWrap: 'wrap', gap: 4 }}>
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            data-studio-v3-sculpt-brush-kind={k}
            data-active={brush.kind === k ? 'true' : 'false'}
            onClick={() => update({ kind: k })}
            style={{
              flex: '1 1 calc(33% - 4px)', minWidth: 56,
              padding: '3px 4px', fontSize: 10,
              background: brush.kind === k ? 'var(--studio-accent, #ebecef)' : 'var(--studio-canvas-3, #141414)',
              color: brush.kind === k ? '#000000' : 'var(--studio-ink, #f0eee6)',
              border: '1px solid var(--studio-rail-edge, #1d2027)',
              borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
              textTransform: 'capitalize', fontWeight: brush.kind === k ? 600 : 400,
            }}
          >{k}</button>
        ))}
      </div>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Size (m)</span>
        <input
          type="range" min="0.005" max="0.5" step="0.005"
          value={brush.size}
          onChange={(e) => update({ size: Number(e.target.value) })}
          data-studio-v3-sculpt-brush-size
          style={{ flex: 1, marginLeft: 8 }}
        />
        <span style={{ width: 38, textAlign: 'right', fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 10, color: 'var(--studio-ink-mute, #9aa6b2)' }}>{brush.size.toFixed(3)}</span>
      </div>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Strength</span>
        <input
          type="range" min="0" max="1" step="0.01"
          value={brush.strength}
          onChange={(e) => update({ strength: Number(e.target.value) })}
          data-studio-v3-sculpt-brush-strength
          style={{ flex: 1, marginLeft: 8 }}
        />
        <span style={{ width: 34, textAlign: 'right', fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 10, color: 'var(--studio-ink-mute, #9aa6b2)' }}>{brush.strength.toFixed(2)}</span>
      </div>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Falloff</span>
        <input
          type="range" min="0" max="1" step="0.01"
          value={brush.falloff}
          onChange={(e) => update({ falloff: Number(e.target.value) })}
          data-studio-v3-sculpt-brush-falloff
          style={{ flex: 1, marginLeft: 8 }}
        />
        <span style={{ width: 34, textAlign: 'right', fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 10, color: 'var(--studio-ink-mute, #9aa6b2)' }}>{brush.falloff.toFixed(2)}</span>
      </div>
    </div>
  );
}

// Slice 594 — Modifier history viewer (read-only). Reads userData.modifiers
// from the active selection. Each row shows label + params. Clear button.
function ModifierStackSection() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const read = () => {
      const list = (window.__studioListModifiers && window.__studioListModifiers()) || [];
      setItems(list.slice().reverse());
    };
    const id = setInterval(read, 500);
    read();
    return () => clearInterval(id);
  }, []);
  if (!items.length) return null;
  return (
    <div className="studio-right-section" data-studio-v3-modifier-stack>
      <div className="studio-right-section-title">Modifiers · {items.length}</div>
      {items.map((m, i) => (
        <div
          key={i}
          data-studio-v3-modifier-row={i}
          style={{
            display: 'flex', justifyContent: 'space-between',
            padding: '3px 6px', fontSize: 11,
            borderLeft: '2px solid var(--studio-accent, #ebecef)',
          }}
        >
          <span style={{ color: 'var(--studio-ink, #f0eee6)' }}>{m.label}</span>
          {m.params && (
            <span style={{ opacity: 0.55, fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 10 }}>
              {Object.entries(m.params).map(([k, v]) => `${k}=${v}`).join(' · ')}
            </span>
          )}
        </div>
      ))}
      <button
        type="button"
        data-studio-v3-modifier-clear
        onClick={() => window.__studioClearModifiers && window.__studioClearModifiers()}
        style={{
          width: '100%', marginTop: 6, padding: '3px 8px',
          background: 'transparent', color: 'var(--studio-ink-mute, #9aa6b2)',
          border: '1px solid var(--studio-rail-edge, #1d2027)', borderRadius: 3,
          fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
        }}
      >Clear history</button>
    </div>
  );
}

// Slice 565 — Per-mesh geometry maintenance helpers.
function GeometryTools() {
  const actions = [
    { id: 'normals',     label: 'Compute vertex normals',  call: () => window.__studioComputeVertexNormals && window.__studioComputeVertexNormals() },
    { id: 'weld-fine',   label: 'Weld vertices (1e-4)',    call: () => window.__studioWeldVertices && window.__studioWeldVertices(1e-4) },
    { id: 'weld-coarse', label: 'Weld vertices (1e-3)',    call: () => window.__studioWeldVertices && window.__studioWeldVertices(1e-3) },
    { id: 'aabb',        label: 'Toggle AABB box',         call: () => window.__studioToggleAABB && window.__studioToggleAABB() },
    { id: 'apply-matrix',label: 'Apply matrix (bake xf)',  call: () => window.__studioApplyMatrix && window.__studioApplyMatrix() },
    { id: 'mirror-x',    label: 'Mirror X',                call: () => window.__studioMirrorAcrossAxis && window.__studioMirrorAcrossAxis('x') },
    { id: 'mirror-y',    label: 'Mirror Y',                call: () => window.__studioMirrorAcrossAxis && window.__studioMirrorAcrossAxis('y') },
    { id: 'mirror-z',    label: 'Mirror Z',                call: () => window.__studioMirrorAcrossAxis && window.__studioMirrorAcrossAxis('z') },
    { id: 'csg-union',   label: 'CSG: union',              call: () => window.__studioBoolean && window.__studioBoolean('union') },
    { id: 'csg-sub',     label: 'CSG: subtract',           call: () => window.__studioBoolean && window.__studioBoolean('subtract') },
    { id: 'csg-int',     label: 'CSG: intersect',          call: () => window.__studioBoolean && window.__studioBoolean('intersect') },
    { id: 'particles-1k', label: 'Particles · 1000',       call: () => window.__studioAddParticles && window.__studioAddParticles(1000, 0.06) },
    { id: 'particles-5k', label: 'Particles · 5000',       call: () => window.__studioAddParticles && window.__studioAddParticles(5000, 0.06) },
    { id: 'simplify-50', label: 'Simplify · keep 50%',     call: () => window.__studioSimplifyMesh && window.__studioSimplifyMesh(0.5) },
    { id: 'simplify-25', label: 'Simplify · keep 25%',     call: () => window.__studioSimplifyMesh && window.__studioSimplifyMesh(0.25) },
    { id: 'tessellate',  label: 'Tessellate ×1',           call: () => window.__studioTessellate && window.__studioTessellate(1) },
    { id: 'noise-low',   label: 'Noise · 1 mm',            call: () => window.__studioDisplaceNoise && window.__studioDisplaceNoise(0.001) },
    { id: 'noise-med',   label: 'Noise · 5 mm',            call: () => window.__studioDisplaceNoise && window.__studioDisplaceNoise(0.005) },
    { id: 'twist-30',    label: 'Twist 30°',               call: () => window.__studioTwistY && window.__studioTwistY(30) },
    { id: 'twist-60',    label: 'Twist 60°',               call: () => window.__studioTwistY && window.__studioTwistY(60) },
    { id: 'bend-30',     label: 'Bend 30°',                call: () => window.__studioBendYZ && window.__studioBendYZ(30) },
    { id: 'bend-60',     label: 'Bend 60°',                call: () => window.__studioBendYZ && window.__studioBendYZ(60) },
    { id: 'taper-half',  label: 'Taper · top × 0.5',       call: () => window.__studioTaperY && window.__studioTaperY(0.5) },
    { id: 'taper-2',     label: 'Taper · top × 2.0',       call: () => window.__studioTaperY && window.__studioTaperY(2.0) },
    { id: 'array-x',     label: 'Array ×5 along X',        call: () => window.__studioCloneAlongAxis && window.__studioCloneAlongAxis('x', 5, 0.05) },
    { id: 'array-y',     label: 'Array ×5 along Y',        call: () => window.__studioCloneAlongAxis && window.__studioCloneAlongAxis('y', 5, 0.05) },
    { id: 'array-z',     label: 'Array ×5 along Z',        call: () => window.__studioCloneAlongAxis && window.__studioCloneAlongAxis('z', 5, 0.05) },
    { id: 'scatter',     label: 'Random scatter ×10',      call: () => window.__studioRandomScatter && window.__studioRandomScatter(10, 0.1) },
    { id: 'polyline-sample', label: 'Sample polyline',     call: () => window.__studioAddPolyline && window.__studioAddPolyline([[0,0,0],[0.05,0.05,0],[0.1,0.02,0.05],[0.15,0.08,-0.03]]) },
    { id: 'instance-50', label: 'Instance · 50 scatter',   call: () => window.__studioScatterInstances && window.__studioScatterInstances(50, 0.3) },
    { id: 'instance-200', label: 'Instance · 200 scatter', call: () => window.__studioScatterInstances && window.__studioScatterInstances(200, 0.5) },
    { id: 'instance-recolor', label: 'Instance · rainbow',  call: () => window.__studioInstanceRecolor && window.__studioInstanceRecolor() },
  ];
  return (
    <div className="studio-right-section" data-studio-v3-geometry-tools>
      <div className="studio-right-section-title">Geometry</div>
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          data-studio-v3-geom-action={a.id}
          onClick={a.call}
          style={{
            display: 'block', width: '100%', marginBottom: 3,
            padding: '3px 8px', textAlign: 'left',
            background: 'var(--studio-canvas-3, #141414)',
            color: 'var(--studio-ink, #f0eee6)',
            border: '1px solid var(--studio-rail-edge, #1d2027)',
            borderRadius: 3, cursor: 'pointer',
            fontSize: 11, fontFamily: 'inherit',
          }}
        >{a.label}</button>
      ))}
    </div>
  );
}

// Slice 585 — Constraints section. Lists possible targets in the scene
// and lets the user wire / unwire a look-at constraint on the active
// selection.
function ConstraintsSection() {
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(null);
  const [target, setTarget] = useState('');
  useEffect(() => {
    const read = () => {
      const s = window.__archdiscScene;
      const arr = [];
      if (s) {
        s.traverse((o) => {
          if (o.userData && o.userData.archdiscStudioPrimitive) {
            arr.push({ uuid: o.uuid, name: o.name || o.userData.archdiscStudioPrimitiveKind || 'mesh' });
          }
        });
      }
      setItems(arr);
      const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
      setActive(m);
      setTarget((m && m.userData && m.userData.archdiscStudioLookAtUuid) || '');
    };
    const id = setInterval(read, 500);
    read();
    return () => clearInterval(id);
  }, []);
  if (!active) return null;
  const others = items.filter((it) => it.uuid !== active.uuid);
  const set = (val) => {
    setTarget(val);
    if (window.__studioSetLookAt) window.__studioSetLookAt(active.uuid, val || null);
  };
  return (
    <div className="studio-right-section" data-studio-v3-constraints>
      <div className="studio-right-section-title">Constraints</div>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Look at</span>
        <select
          value={target}
          onChange={(e) => set(e.target.value)}
          data-studio-v3-lookat-target
          style={{
            flex: 1, marginLeft: 8, padding: '2px 6px',
            background: 'var(--studio-canvas, #000000)',
            border: '1px solid var(--studio-rail-edge, #1d2027)',
            color: 'var(--studio-ink, #f0eee6)', borderRadius: 3,
            fontFamily: 'inherit', fontSize: 11,
          }}
        >
          <option value="">(none)</option>
          {others.map((o) => (
            <option key={o.uuid} value={o.uuid}>{o.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// Slice 583 — Object section: castShadow / receiveShadow / visible
// toggles bound to the active selection. Polls every 500 ms.
function ObjectPropsSection() {
  const [state, setState] = useState(null);
  useEffect(() => {
    const read = () => {
      const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
      setState(m ? { uuid: m.uuid, cast: !!m.castShadow, receive: !!m.receiveShadow, visible: m.visible !== false } : null);
    };
    const id = setInterval(read, 500);
    read();
    return () => clearInterval(id);
  }, []);
  if (!state) return null;
  const toggle = (key) => {
    const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!m) return;
    if (key === 'cast') m.castShadow = !m.castShadow;
    else if (key === 'receive') m.receiveShadow = !m.receiveShadow;
    else if (key === 'visible') m.visible = !m.visible;
    setState({ uuid: m.uuid, cast: !!m.castShadow, receive: !!m.receiveShadow, visible: m.visible !== false });
  };
  const row = (k, label, val) => (
    <div className="studio-right-row" style={{ alignItems: 'center' }}>
      <span>{label}</span>
      <input
        type="checkbox"
        data-studio-v3-object-prop={k}
        checked={val}
        onChange={() => toggle(k)}
      />
    </div>
  );
  return (
    <div className="studio-right-section" data-studio-v3-object-props>
      <div className="studio-right-section-title">Object</div>
      {row('visible', 'Visible', state.visible)}
      {row('cast', 'Cast shadow', state.cast)}
      {row('receive', 'Receive shadow', state.receive)}
    </div>
  );
}

// Slice 566 — Rename section polls __studioSelectedMesh directly so the
// input is always available when a mesh is selected. F2 focuses it.
function RenameSection() {
  const [val, setVal] = useState('');
  const [uuid, setUuid] = useState(null);
  useEffect(() => {
    const read = () => {
      const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
      const id = m ? m.uuid : null;
      setUuid((cur) => {
        if (cur !== id) {
          setVal((m && m.name) || '');
        }
        return id;
      });
    };
    const t = setInterval(read, 500);
    read();
    return () => clearInterval(t);
  }, []);
  if (!uuid) return null;
  const commit = (next) => {
    const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (m) { m.name = next || 'mesh'; }
  };
  return (
    <div className="studio-right-section" data-studio-v3-rename-section>
      <div className="studio-right-section-title">Rename</div>
      <div className="studio-right-row" style={{ alignItems: 'center', gap: 4 }}>
        <span>Name</span>
        <input
          type="text"
          data-studio-v3-rename-input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { commit(e.currentTarget.value); e.currentTarget.blur(); } }}
          style={{
            flex: 1, padding: '2px 6px', fontSize: 11,
            background: 'var(--studio-canvas, #000000)',
            border: '1px solid var(--studio-rail-edge, #1d2027)',
            color: 'var(--studio-ink, #f0eee6)', borderRadius: 3,
            fontFamily: 'var(--studio-mono, ui-monospace)',
          }}
        />
      </div>
    </div>
  );
}

// Slice 564 — Transform component label + reset chip helper.
function TransformLabelRow({ label, kind }) {
  return (
    <div className="studio-right-row" style={{ alignItems: 'center' }}>
      <span>{label}</span>
      <button
        type="button"
        data-studio-v3-transform-reset={kind}
        onClick={() => window.__studioResetTransform && window.__studioResetTransform(kind)}
        title={`Reset ${label.toLowerCase()}`}
        style={{
          padding: '0 6px', fontSize: 9, letterSpacing: '0.05em',
          background: 'transparent', color: 'var(--studio-ink-mute, #9aa6b2)',
          border: '1px solid var(--studio-rail-edge, #1d2027)', borderRadius: 2,
          cursor: 'pointer', textTransform: 'uppercase',
        }}
      >reset</button>
    </div>
  );
}

// Slice 472 — Origin / pivot / transform-bake quick actions.
function PivotActions() {
  const actions = [
    { id: 'center',     label: 'Center at origin',  call: () => window.__studioCenterAtOrigin && window.__studioCenterAtOrigin() },
    { id: 'ground',     label: 'Align to ground',   call: () => window.__studioAlignToGround && window.__studioAlignToGround() },
    { id: 'recenter',   label: 'Recenter pivot',    call: () => window.__studioRecenterPivot && window.__studioRecenterPivot() },
    { id: 'apply',      label: 'Apply transforms',  call: () => window.__studioApplyTransforms && window.__studioApplyTransforms() },
  ];
  return (
    <div className="studio-right-section" data-studio-v3-pivot-actions>
      <div className="studio-right-section-title">Origin · pivot</div>
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          data-studio-v3-pivot-action={a.id}
          onClick={a.call}
          style={{
            display: 'block', width: '100%', marginBottom: 3,
            padding: '3px 8px', textAlign: 'left',
            background: 'var(--studio-canvas-3, #141414)',
            color: 'var(--studio-ink, #f0eee6)',
            border: '1px solid var(--studio-rail-edge, #1d2027)',
            borderRadius: 3, cursor: 'pointer',
            fontSize: 11, fontFamily: 'inherit',
          }}
        >{a.label}</button>
      ))}
    </div>
  );
}

// Slice 498 — Camera inspector section. Edits FOV (perspective only)
// and toggles ortho/persp via existing cameraviewops.
function CameraSection() {
  const [fov, setFov] = useState(50);
  const [proj, setProj] = useState('persp');
  useEffect(() => {
    const read = () => {
      const vp = window.__archdiscViewport;
      if (vp && vp.camera && typeof vp.camera.fov === 'number') setFov(Math.round(vp.camera.fov));
      setProj(window.__studioViewProjection === 'ortho' ? 'ortho' : 'persp');
    };
    const id = setInterval(read, 600);
    read();
    return () => clearInterval(id);
  }, []);
  const onFov = (e) => {
    const v = Number(e.target.value);
    setFov(v);
    if (window.__studioSetFov) window.__studioSetFov(v);
  };
  const toggle = () => {
    if (window.__studioToggleViewProjection) {
      const r = window.__studioToggleViewProjection();
      if (r && r.projection) setProj(r.projection);
    }
  };
  return (
    <div className="studio-right-section" data-studio-v3-camera-section>
      <div className="studio-right-section-title">Camera</div>
      <div className="studio-right-row">
        <span>FOV</span>
        <input
          type="number"
          min="10"
          max="170"
          step="1"
          value={fov}
          onChange={onFov}
          data-studio-v3-camera-fov
          style={{
            width: 60, background: 'var(--studio-canvas, #000000)', border: '1px solid var(--studio-rail-edge, #1d2027)',
            color: 'var(--studio-ink, #f0eee6)', padding: '2px 6px', borderRadius: 3, fontFamily: 'var(--studio-mono, ui-monospace)',
            fontSize: 11, textAlign: 'right',
          }}
        />
      </div>
      <div className="studio-right-row">
        <span>Projection</span>
        <button
          type="button"
          data-studio-v3-camera-proj
          data-studio-v3-camera-proj-value={proj}
          onClick={toggle}
          style={{
            background: 'transparent', border: '1px solid var(--studio-rail-edge, #1d2027)',
            color: proj === 'ortho' ? 'var(--studio-accent, #ebecef)' : 'var(--studio-ink, #f0eee6)',
            padding: '2px 8px', borderRadius: 3, fontSize: 11, cursor: 'pointer', textTransform: 'capitalize',
          }}
        >{proj}</button>
      </div>
      <CameraSpeedRows />
      <CameraFollowRow />
      <CameraCoordsRow />
    </div>
  );
}

// Slice 533 — Render section. Width / height inputs + a render button
// that calls __studioExportViewportPNG with explicit dimensions.
function RenderSection() {
  const [w, setW] = useState(1920);
  const [h, setH] = useState(1080);
  const render = () => {
    if (window.__studioExportViewportPNG) window.__studioExportViewportPNG('render', w, h);
  };
  return (
    <div className="studio-right-section" data-studio-v3-render-section>
      <div className="studio-right-section-title">Render</div>
      <div className="studio-right-row" style={{ gap: 4 }}>
        <span>Size</span>
        <input
          type="number" min="64" max="8192" step="1"
          value={w}
          onChange={(e) => setW(Number(e.target.value))}
          data-studio-v3-render-w
          style={{
            width: 64, background: 'var(--studio-canvas, #000000)',
            border: '1px solid var(--studio-rail-edge, #1d2027)',
            color: 'var(--studio-ink, #f0eee6)', padding: '2px 6px', borderRadius: 3,
            fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 11, textAlign: 'right',
          }}
        />
        <span style={{ color: 'var(--studio-ink-mute, #9aa6b2)' }}>×</span>
        <input
          type="number" min="64" max="8192" step="1"
          value={h}
          onChange={(e) => setH(Number(e.target.value))}
          data-studio-v3-render-h
          style={{
            width: 64, background: 'var(--studio-canvas, #000000)',
            border: '1px solid var(--studio-rail-edge, #1d2027)',
            color: 'var(--studio-ink, #f0eee6)', padding: '2px 6px', borderRadius: 3,
            fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 11, textAlign: 'right',
          }}
        />
      </div>
      <div className="studio-right-row" style={{ gap: 4, marginTop: 4 }}>
        {[[1280,720,'720p'],[1920,1080,'1080p'],[3840,2160,'4K']].map(([pw,ph,lbl]) => (
          <button
            key={lbl}
            type="button"
            data-studio-v3-render-preset={lbl}
            onClick={() => { setW(pw); setH(ph); }}
            style={{
              flex: 1, padding: '2px 4px', fontSize: 10,
              background: 'transparent', color: 'var(--studio-ink, #f0eee6)',
              border: '1px solid var(--studio-rail-edge, #1d2027)', borderRadius: 3, cursor: 'pointer',
            }}
          >{lbl}</button>
        ))}
      </div>
      <button
        type="button"
        onClick={render}
        data-studio-v3-render-go
        style={{
          width: '100%', marginTop: 6,
          background: 'var(--studio-accent, #ebecef)', border: 0, color: '#000000',
          fontWeight: 600, padding: '5px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
        }}
      >Render → PNG</button>
    </div>
  );
}

// Slice 592 — Selection sets section. Save the active multi-select
// under a name; recall later. Stored on window.__studioSelectionSets.
function SelectionSetsSection() {
  const [draft, setDraft] = useState('');
  const [all, setAll] = useState([]);
  useEffect(() => {
    const read = () => {
      const list = (window.__studioListSelectionSets && window.__studioListSelectionSets()) || [];
      setAll(list);
    };
    const id = setInterval(read, 600);
    read();
    return () => clearInterval(id);
  }, []);
  const save = () => {
    const n = draft.trim() || `set-${all.length + 1}`;
    if (window.__studioSaveSelectionSet) window.__studioSaveSelectionSet(n);
    setDraft('');
  };
  const recall = (n) => { if (window.__studioRecallSelectionSet) window.__studioRecallSelectionSet(n); };
  return (
    <div className="studio-right-section" data-studio-v3-selection-sets>
      <div className="studio-right-section-title">Selection sets · {all.length}</div>
      <div className="studio-right-row" style={{ gap: 4 }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          placeholder={`set-${all.length + 1}`}
          data-studio-v3-selection-set-draft
          style={{
            flex: 1, padding: '2px 6px', fontSize: 11,
            background: 'var(--studio-canvas, #000000)',
            border: '1px solid var(--studio-rail-edge, #1d2027)',
            color: 'var(--studio-ink, #f0eee6)', borderRadius: 3, fontFamily: 'inherit',
          }}
        />
        <button
          type="button"
          onClick={save}
          data-studio-v3-selection-set-save
          style={{
            background: 'var(--studio-accent, #ebecef)', border: 0, color: '#000000',
            fontWeight: 600, padding: '2px 10px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
          }}
        >+</button>
      </div>
      {all.map((n) => (
        <button
          key={n}
          type="button"
          data-studio-v3-selection-set={n}
          onClick={() => recall(n)}
          style={{
            display: 'block', width: '100%', marginTop: 3,
            padding: '3px 8px', textAlign: 'left',
            background: 'var(--studio-canvas-3, #141414)',
            color: 'var(--studio-ink, #f0eee6)',
            border: '1px solid var(--studio-rail-edge, #1d2027)',
            borderRadius: 3, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
          }}
        >{n}</button>
      ))}
    </div>
  );
}

// Slice 559 — Tags section. Input adds a tag to the selection; list
// shows every tag in the scene with click-to-select.
function TagsSection() {
  const [draft, setDraft] = useState('');
  const [all, setAll] = useState([]);
  const [, force] = useState(0);
  useEffect(() => {
    const read = () => {
      const list = (window.__studioListTags && window.__studioListTags()) || [];
      setAll(list);
    };
    const id = setInterval(read, 800);
    read();
    return () => clearInterval(id);
  }, []);
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    if (window.__studioAddTag) window.__studioAddTag(t);
    setDraft('');
    force((v) => v + 1);
  };
  const pick = (t) => { if (window.__studioSelectByTag) window.__studioSelectByTag(t); };
  return (
    <div className="studio-right-section" data-studio-v3-tags-section>
      <div className="studio-right-section-title">Tags · {all.length}</div>
      <div className="studio-right-row" style={{ gap: 4 }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder="tag…"
          data-studio-v3-tag-draft
          style={{
            flex: 1, padding: '2px 6px', fontSize: 11,
            background: 'var(--studio-canvas, #000000)',
            border: '1px solid var(--studio-rail-edge, #1d2027)',
            color: 'var(--studio-ink, #f0eee6)', borderRadius: 3,
            fontFamily: 'inherit',
          }}
        />
        <button
          type="button"
          onClick={add}
          data-studio-v3-tag-add
          style={{
            background: 'var(--studio-accent, #ebecef)', border: 0, color: '#000000',
            fontWeight: 600, padding: '2px 10px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
          }}
        >+</button>
      </div>
      <div className="studio-right-row" style={{ flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
        {all.map((t) => (
          <button
            key={t}
            type="button"
            data-studio-v3-tag={t}
            onClick={() => pick(t)}
            style={{
              background: 'var(--studio-canvas-3, #141414)',
              color: 'var(--studio-accent, #ebecef)',
              border: '1px solid var(--studio-rail-edge, #1d2027)',
              borderRadius: 3, padding: '1px 8px', fontSize: 10,
              cursor: 'pointer', fontFamily: 'var(--studio-mono, ui-monospace)',
            }}
          >#{t}</button>
        ))}
      </div>
    </div>
  );
}

// Slice 538 — Image plates section. Lists every archdiscStudioImagePlate
// mesh with a delete chip and a click-to-select.
function ImagePlatesSection() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const read = () => {
      const list = (window.__studioListImagePlates && window.__studioListImagePlates()) || [];
      setItems(list);
    };
    const id = setInterval(read, 700);
    read();
    return () => clearInterval(id);
  }, []);
  const select = (uuid) => {
    const s = window.__archdiscScene;
    if (!s) return;
    let m = null;
    s.traverse((o) => { if (o.uuid === uuid) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  };
  const del = (uuid) => {
    const s = window.__archdiscScene;
    if (!s) return;
    let m = null;
    s.traverse((o) => { if (o.uuid === uuid) m = o; });
    if (m) {
      if (m.material && m.material.map && m.material.map.dispose) m.material.map.dispose();
      if (m.material && m.material.dispose) m.material.dispose();
      if (m.geometry && m.geometry.dispose) m.geometry.dispose();
      s.remove(m);
    }
  };
  if (!items.length) return null;
  return (
    <div className="studio-right-section" data-studio-v3-image-plates-section>
      <div className="studio-right-section-title">Reference plates · {items.length}</div>
      {items.map((it) => (
        <div
          key={it.uuid}
          data-studio-v3-image-plate-row={it.uuid}
          style={{
            display: 'flex', justifyContent: 'space-between',
            padding: '2px 6px', fontSize: 11, alignItems: 'center', gap: 6,
            cursor: 'pointer',
          }}
          onClick={() => select(it.uuid)}
        >
          <span style={{ flex: 1, color: 'var(--studio-ink, #f0eee6)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {it.name}
          </span>
          <button
            type="button"
            data-studio-v3-image-plate-delete={it.uuid}
            onClick={(e) => { e.stopPropagation(); del(it.uuid); }}
            title="Delete plate"
            style={{
              padding: '0 4px', fontSize: 10,
              background: 'transparent', color: 'var(--studio-ink-mute)',
              border: '1px solid var(--studio-ink-mute)', borderRadius: 2, cursor: 'pointer',
            }}
          >×</button>
        </div>
      ))}
    </div>
  );
}

// Slice 522 — Annotations section. Lists annotation sprites with their
// text + delete action. Polls every 700 ms.
function AnnotationsSection() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const read = () => {
      const list = (window.__studioListAnnotations && window.__studioListAnnotations()) || [];
      setItems(list);
    };
    const id = setInterval(read, 700);
    read();
    return () => clearInterval(id);
  }, []);
  const del = (uuid) => {
    const s = window.__archdiscScene;
    if (!s) return;
    let m = null;
    s.traverse((o) => { if (o.uuid === uuid) m = o; });
    if (m) {
      if (m.material && m.material.map && m.material.map.dispose) m.material.map.dispose();
      if (m.material && m.material.dispose) m.material.dispose();
      s.remove(m);
    }
  };
  if (!items.length) return null;
  return (
    <div className="studio-right-section" data-studio-v3-annotations-section>
      <div className="studio-right-section-title">Annotations · {items.length}</div>
      {items.map((it) => (
        <div
          key={it.uuid}
          data-studio-v3-annotation-row={it.uuid}
          style={{
            display: 'flex', justifyContent: 'space-between',
            padding: '2px 6px', fontSize: 11, alignItems: 'center', gap: 6,
          }}
        >
          <span style={{ flex: 1, color: 'var(--studio-ink, #f0eee6)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {it.text}
          </span>
          <button
            type="button"
            data-studio-v3-annotation-delete={it.uuid}
            onClick={() => del(it.uuid)}
            title="Delete annotation"
            style={{
              padding: '0 4px', fontSize: 10,
              background: 'transparent', color: 'var(--studio-ink-mute)',
              border: '1px solid var(--studio-ink-mute)', borderRadius: 2, cursor: 'pointer',
            }}
          >×</button>
        </div>
      ))}
    </div>
  );
}

// Slice 546 — Inspector top filter. Hides sections whose title doesn't
// match the typed query. Lives outside the conditional sections so its
// state persists while typing.
function InspectorFilter() {
  const [q, setQ] = useState('');
  useEffect(() => {
    const f = q.toLowerCase().trim();
    const sections = document.querySelectorAll('[data-studio-v3-right] .studio-right-section');
    for (const sec of sections) {
      if (sec.hasAttribute('data-studio-v3-filter-bar')) continue;
      const titleEl = sec.querySelector('.studio-right-section-title');
      const title = (titleEl ? titleEl.textContent : '').toLowerCase();
      const match = !f || title.includes(f);
      sec.style.display = match ? '' : 'none';
    }
  }, [q]);
  return (
    <div
      className="studio-right-section"
      data-studio-v3-filter-bar
      style={{ padding: 6 }}
    >
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }}
        placeholder="Filter sections… (e.g. ‘snap’, ‘lighting’)"
        data-studio-v3-inspector-filter
        style={{
          width: '100%', padding: '4px 8px',
          background: 'var(--studio-canvas, #000000)',
          border: '1px solid var(--studio-rail-edge, #1d2027)',
          color: 'var(--studio-ink, #f0eee6)', borderRadius: 3,
          fontFamily: 'inherit', fontSize: 11, outline: 'none',
        }}
      />
    </div>
  );
}

// Slice 593 — Animation panel: current frame, keyframe count for the
// selection, +/- step buttons, insert keyframe.
function AnimationSection() {
  const [info, setInfo] = useState({ frame: 0, keyframes: 0 });
  useEffect(() => {
    const read = () => {
      const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
      let kfs = 0;
      if (m && window.__studioGetKeyframes) {
        const r = window.__studioGetKeyframes(m.uuid);
        kfs = (r && r.keyframes && r.keyframes.length) || 0;
      }
      const f = (window.__studioGetFrame && window.__studioGetFrame()) || 0;
      setInfo({ frame: f, keyframes: kfs });
    };
    const id = setInterval(read, 400);
    read();
    return () => clearInterval(id);
  }, []);
  const step = (d) => { if (window.__studioSetFrame) window.__studioSetFrame(Math.max(0, info.frame + d)); };
  const insert = () => { if (window.__studioInsertKeyframeAt) window.__studioInsertKeyframeAt(info.frame); };
  return (
    <div className="studio-right-section" data-studio-v3-animation-section>
      <div className="studio-right-section-title">Animation</div>
      <div className="studio-right-row" style={{ fontSize: 11 }}>
        <span>Frame</span>
        <strong data-studio-v3-anim-frame style={{ fontFamily: 'var(--studio-mono, ui-monospace)' }}>{info.frame}</strong>
      </div>
      <div className="studio-right-row" style={{ fontSize: 11 }}>
        <span>Keyframes</span>
        <strong data-studio-v3-anim-keyframes style={{ fontFamily: 'var(--studio-mono, ui-monospace)' }}>{info.keyframes}</strong>
      </div>
      <div className="studio-right-row" style={{ gap: 4, marginTop: 4 }}>
        <button type="button" data-studio-v3-anim-step-back onClick={() => step(-1)} style={animBtn}>−</button>
        <button type="button" data-studio-v3-anim-step-fwd  onClick={() => step(1)}  style={animBtn}>+</button>
        <button type="button" data-studio-v3-anim-insert     onClick={insert}        style={{ ...animBtn, flex: 2, background: 'var(--studio-accent, #ebecef)', color: '#000000', fontWeight: 600 }}>Insert key</button>
      </div>
    </div>
  );
}
const animBtn = {
  flex: 1, padding: '3px 6px', fontSize: 11,
  background: 'var(--studio-canvas-3, #141414)',
  color: 'var(--studio-ink, #f0eee6)',
  border: '1px solid var(--studio-rail-edge, #1d2027)',
  borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
};

// Slice 542 — Renderer / scene perf diagnostics. Polls renderer.info
// every second so the panel stays cheap.
function PerformanceSection() {
  const [info, setInfo] = useState({ calls: 0, tris: 0, points: 0, lines: 0, geom: 0, tex: 0, programs: 0, sceneKb: 0 });
  useEffect(() => {
    const read = () => {
      const vp = window.__archdiscViewport;
      if (!vp || !vp.renderer || !vp.renderer.info) return;
      const r = vp.renderer.info;
      let sceneKb = 0;
      try {
        const json = window.__studioSaveScene && window.__studioSaveScene();
        if (json) sceneKb = Math.round(json.length / 102.4) / 10;
      } catch (_) {}
      setInfo({
        calls: r.render.calls,
        tris: r.render.triangles,
        points: r.render.points,
        lines: r.render.lines,
        geom: r.memory.geometries,
        tex: r.memory.textures,
        programs: (r.programs && r.programs.length) || 0,
        sceneKb,
      });
    };
    const id = setInterval(read, 1500);
    read();
    return () => clearInterval(id);
  }, []);
  const Row = ({ k, v }) => (
    <div className="studio-right-row" style={{ fontSize: 11 }}>
      <span>{k}</span>
      <strong style={{ fontFamily: 'var(--studio-mono, ui-monospace)' }} data-studio-v3-perf-row={k}>{v}</strong>
    </div>
  );
  return (
    <div className="studio-right-section" data-studio-v3-performance-section>
      <div className="studio-right-section-title">Performance</div>
      <Row k="calls" v={info.calls} />
      <Row k="triangles" v={info.tris} />
      <Row k="lines" v={info.lines} />
      <Row k="points" v={info.points} />
      <Row k="geometries" v={info.geom} />
      <Row k="textures" v={info.tex} />
      <Row k="programs" v={info.programs} />
      <Row k="scene KB" v={info.sceneKb} />
    </div>
  );
}

// Slice 518 — History section. Reads the labels side-array kept by
// pushUndo and renders the most recent 8 entries.
function HistorySection() {
  const [entries, setEntries] = useState([]);
  useEffect(() => {
    const read = () => {
      const list = (window.__studioListUndoHistory && window.__studioListUndoHistory()) || [];
      setEntries(list.slice(-8).reverse());
    };
    const id = setInterval(read, 700);
    read();
    return () => clearInterval(id);
  }, []);
  if (!entries.length) return null;
  return (
    <div className="studio-right-section" data-studio-v3-history-section>
      <div className="studio-right-section-title">History · {entries.length}</div>
      {entries.map((e, i) => (
        <div
          key={i}
          data-studio-v3-history-entry={i}
          style={{
            display: 'flex', justifyContent: 'space-between',
            padding: '2px 6px', fontSize: 11, color: 'var(--studio-ink-mute, #9aa6b2)',
            borderLeft: i === 0 ? '2px solid var(--studio-accent, #ebecef)' : '2px solid transparent',
          }}
        >
          <span style={{ color: i === 0 ? 'var(--studio-ink, #f0eee6)' : 'inherit' }}>{e.label || 'edit'}</span>
          <span style={{ fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 10 }}>
            {((Date.now() - e.ts) / 1000).toFixed(0)}s
          </span>
        </div>
      ))}
    </div>
  );
}

// Slice 516 — Per-workbench Notes textarea. Saves debounced 300 ms after
// the user stops typing; restored on workbench switch.
function NotesSection({ activeWb }) {
  const key = `studio.v3.notes.${activeWb || 'general'}`;
  const [text, setText] = useState(() => {
    try { return window.localStorage.getItem(key) || ''; } catch (_) { return ''; }
  });
  // Reset when workbench changes.
  useEffect(() => {
    try { setText(window.localStorage.getItem(key) || ''); } catch (_) {}
  }, [key]);
  useEffect(() => {
    const t = setTimeout(() => {
      try { window.localStorage.setItem(key, text); } catch (_) {}
    }, 300);
    return () => clearTimeout(t);
  }, [key, text]);
  return (
    <div className="studio-right-section" data-studio-v3-notes-section data-studio-v3-notes-wb={activeWb || ''}>
      <div className="studio-right-section-title">Notes · {activeWb || 'general'}</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Sketch ideas, todos, intents — saved per workbench."
        data-studio-v3-notes-input
        style={{
          width: '100%', minHeight: 70, padding: '6px 8px',
          background: 'var(--studio-canvas-3, #141414)',
          border: '1px solid var(--studio-rail-edge, #1d2027)',
          color: 'var(--studio-ink, #f0eee6)', borderRadius: 3,
          fontFamily: 'inherit', fontSize: 11, resize: 'vertical',
          outline: 'none',
        }}
      />
    </div>
  );
}

// Slice 615 — Camera position + orbit target readout.
function CameraCoordsRow() {
  const [info, setInfo] = React.useState({ p: [0, 0, 0], t: [0, 0, 0] });
  React.useEffect(() => {
    const id = setInterval(() => {
      const vp = window.__archdiscViewport;
      if (!vp || !vp.camera) return;
      const tt = vp.orbitControls && vp.orbitControls.target;
      setInfo({
        p: [vp.camera.position.x, vp.camera.position.y, vp.camera.position.z],
        t: tt ? [tt.x, tt.y, tt.z] : [0, 0, 0],
      });
    }, 500);
    return () => clearInterval(id);
  }, []);
  const fmt = (v) => v.map((n) => n.toFixed(3)).join(', ');
  return (
    <>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Pos</span>
        <strong data-studio-v3-camera-pos style={{ fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 10 }}>{fmt(info.p)}</strong>
      </div>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Tgt</span>
        <strong data-studio-v3-camera-tgt style={{ fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 10 }}>{fmt(info.t)}</strong>
      </div>
    </>
  );
}

// Slice 590 — Camera follow toggle row inside the Camera section.
function CameraFollowRow() {
  const [on, setOn] = React.useState(!!window.__studioCameraFollowOn);
  React.useEffect(() => {
    const id = setInterval(() => setOn(!!window.__studioCameraFollowOn), 500);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="studio-right-row" style={{ alignItems: 'center' }}>
      <span>Follow selection</span>
      <button
        type="button"
        data-studio-v3-camera-follow
        data-studio-v3-camera-follow-on={on ? 'true' : 'false'}
        onClick={() => { window.__studioToggleCameraFollow && window.__studioToggleCameraFollow(); setOn(!on); }}
        style={{
          background: 'transparent', border: '1px solid var(--studio-rail-edge, #1d2027)',
          color: on ? 'var(--studio-accent, #ebecef)' : 'var(--studio-ink, #f0eee6)',
          padding: '2px 8px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
        }}
      >{on ? 'on' : 'off'}</button>
    </div>
  );
}

// Slice 547 — Orbit + zoom speed sliders driving OrbitControls.
function CameraSpeedRows() {
  const [rotate, setRotate] = useState(0.8);
  const [zoom, setZoom] = useState(1.2);
  useEffect(() => {
    const c = window.__archdiscViewport && window.__archdiscViewport.orbitControls;
    if (c) {
      setRotate(c.rotateSpeed);
      setZoom(c.zoomSpeed);
    }
  }, []);
  const onRot = (e) => {
    const v = Number(e.target.value);
    setRotate(v);
    const c = window.__archdiscViewport && window.__archdiscViewport.orbitControls;
    if (c) c.rotateSpeed = v;
  };
  const onZoom = (e) => {
    const v = Number(e.target.value);
    setZoom(v);
    const c = window.__archdiscViewport && window.__archdiscViewport.orbitControls;
    if (c) c.zoomSpeed = v;
  };
  return (
    <>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Orbit speed</span>
        <input
          type="range" min="0.1" max="3" step="0.1"
          value={rotate}
          onChange={onRot}
          data-studio-v3-camera-rotate-speed
          style={{ flex: 1, marginLeft: 8 }}
        />
        <span style={{ width: 30, textAlign: 'right', fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 10, color: 'var(--studio-ink-mute, #9aa6b2)' }}>{rotate.toFixed(1)}</span>
      </div>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Zoom speed</span>
        <input
          type="range" min="0.1" max="3" step="0.1"
          value={zoom}
          onChange={onZoom}
          data-studio-v3-camera-zoom-speed
          style={{ flex: 1, marginLeft: 8 }}
        />
        <span style={{ width: 30, textAlign: 'right', fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 10, color: 'var(--studio-ink-mute, #9aa6b2)' }}>{zoom.toFixed(1)}</span>
      </div>
    </>
  );
}

// Slice 517 — Camera bookmarks UI. Lists existing bookmarks, lets the
// user save the current camera under a typed name, and click any row
// to restore.
function CameraBookmarksSection() {
  const [names, setNames] = useState([]);
  const [draft, setDraft] = useState('');
  const [, force] = useState(0);
  useEffect(() => {
    const read = () => {
      const list = (window.__studioListCameraBookmarks && window.__studioListCameraBookmarks()) || [];
      setNames(list);
    };
    const id = setInterval(read, 800);
    read();
    return () => clearInterval(id);
  }, []);
  const save = () => {
    const n = (draft || `cam-${names.length + 1}`).trim();
    if (!n) return;
    if (window.__studioBookmarkCamera) window.__studioBookmarkCamera(n);
    if (window.__studioToast) window.__studioToast(`Bookmarked camera "${n}"`, 'ok');
    setDraft('');
    force((v) => v + 1);
  };
  const restore = (n) => {
    if (window.__studioRestoreCameraBookmark) window.__studioRestoreCameraBookmark(n);
  };
  return (
    <div className="studio-right-section" data-studio-v3-camera-bookmarks>
      <div className="studio-right-section-title">Cameras · {names.length}</div>
      <div className="studio-right-row" style={{ gap: 4 }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          placeholder={`cam-${names.length + 1}`}
          data-studio-v3-camera-bookmark-draft
          style={{
            flex: 1, padding: '2px 6px', fontSize: 11,
            background: 'var(--studio-canvas, #000000)',
            border: '1px solid var(--studio-rail-edge, #1d2027)',
            color: 'var(--studio-ink, #f0eee6)', borderRadius: 3,
            fontFamily: 'inherit',
          }}
        />
        <button
          type="button"
          onClick={save}
          data-studio-v3-camera-bookmark-save
          style={{
            background: 'var(--studio-accent, #ebecef)', border: 0, color: '#000000',
            fontWeight: 600, padding: '2px 10px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
          }}
        >+</button>
      </div>
      {names.map((n) => (
        <div
          key={n}
          style={{ display: 'flex', gap: 4, marginTop: 3 }}
        >
          <button
            type="button"
            data-studio-v3-camera-bookmark={n}
            onClick={() => restore(n)}
            style={{
              flex: 1, padding: '3px 8px', textAlign: 'left',
              background: 'var(--studio-canvas-3, #141414)',
              color: 'var(--studio-ink, #f0eee6)',
              border: '1px solid var(--studio-rail-edge, #1d2027)',
              borderRadius: 3, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
            }}
          >{n}</button>
          <button
            type="button"
            data-studio-v3-camera-bookmark-delete={n}
            onClick={() => {
              if (window.__studioDeleteCameraBookmark) window.__studioDeleteCameraBookmark(n);
              force((v) => v + 1);
            }}
            title="Delete bookmark"
            style={{
              padding: '0 6px', fontSize: 10,
              background: 'transparent', color: 'var(--studio-ink-mute)',
              border: '1px solid var(--studio-ink-mute)', borderRadius: 2, cursor: 'pointer',
            }}
          >×</button>
        </div>
      ))}
    </div>
  );
}

// Slice 536 — Display toggles. Checkbox each for grid, axes, minimap,
// watermark; persisted to localStorage. Sets data-attrs on the viewport
// so CSS can hide overlays declaratively.
function DisplaySection() {
  const items = [
    { id: 'grid', label: 'Grid', defaultOn: false, onChange: (v) => { if (window.__studioSetGridVisible) window.__studioSetGridVisible(v); } },
    { id: 'minimap', label: 'Minimap', defaultOn: true, onChange: (v) => { const el = document.querySelector('[data-studio-v3-minimap]'); if (el) el.style.display = v ? '' : 'none'; } },
    { id: 'watermark', label: 'Watermark', defaultOn: true, onChange: (v) => { const el = document.querySelector('[data-studio-v3-watermark]'); if (el) el.style.display = v ? '' : 'none'; } },
    { id: 'archie-status', label: 'Archie dot', defaultOn: true, onChange: (v) => { const el = document.querySelector('[data-studio-v3-archie-status]'); if (el) el.style.display = v ? '' : 'none'; } },
    { id: 'keypress', label: 'Keypress flash', defaultOn: false, onChange: () => {} },
    { id: 'ground', label: 'Shadow ground', defaultOn: false, onChange: (v) => { if (window.__studioSetGroundVisible) window.__studioSetGroundVisible(v); } },
    { id: 'safe-area', label: 'Safe area', defaultOn: false, onChange: (v) => {
      let el = document.querySelector('[data-studio-v3-safe-area]');
      if (v) {
        if (!el) {
          const vp = document.querySelector('[data-studio-v3-viewport]');
          if (!vp) return;
          el = document.createElement('div');
          el.setAttribute('data-studio-v3-safe-area', '');
          el.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;';
          const box = (pct, color) => {
            const b = document.createElement('div');
            const inset = `${pct}%`;
            b.style.cssText = `position:absolute;top:${inset};right:${inset};bottom:${inset};left:${inset};border:1px dashed ${color};`;
            return b;
          };
          el.appendChild(box(5, 'rgba(255,200,100,0.5)'));   // action safe
          el.appendChild(box(10, 'rgba(255,80,80,0.5)'));    // title safe
          vp.appendChild(el);
        }
      } else if (el) { el.parentNode.removeChild(el); }
    } },
    { id: 'letterbox', label: 'Cinema bars', defaultOn: false, onChange: (v) => {
      let el = document.querySelector('[data-studio-v3-letterbox]');
      if (v) {
        if (!el) {
          const vp = document.querySelector('[data-studio-v3-viewport]');
          if (!vp) return;
          el = document.createElement('div');
          el.setAttribute('data-studio-v3-letterbox', '');
          el.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;';
          const bar = (pos) => {
            const b = document.createElement('div');
            b.style.cssText = `position:absolute;left:0;right:0;${pos}:0;height:12%;background:#000;`;
            return b;
          };
          el.appendChild(bar('top'));
          el.appendChild(bar('bottom'));
          vp.appendChild(el);
        }
      } else if (el) { el.parentNode.removeChild(el); }
    } },
    { id: 'world-axes', label: 'World axes', defaultOn: false, onChange: (v) => {
      const already = !!window.__studioWorldAxesHelper;
      if (v && !already) window.__studioToggleWorldAxes && window.__studioToggleWorldAxes();
      else if (!v && already) window.__studioToggleWorldAxes && window.__studioToggleWorldAxes();
    } },
  ];
  const [state, setState] = useState(() => {
    try {
      const raw = window.localStorage.getItem('studio.v3.display-toggles');
      const parsed = raw ? JSON.parse(raw) : null;
      const init = {};
      for (const it of items) init[it.id] = parsed && it.id in parsed ? !!parsed[it.id] : it.defaultOn;
      return init;
    } catch (_) {
      const init = {};
      for (const it of items) init[it.id] = it.defaultOn;
      return init;
    }
  });
  useEffect(() => {
    try { window.localStorage.setItem('studio.v3.display-toggles', JSON.stringify(state)); } catch (_) {}
    for (const it of items) {
      try { it.onChange(state[it.id]); } catch (_) {}
    }
  }, [state]);
  return (
    <div className="studio-right-section" data-studio-v3-display-section>
      <div className="studio-right-section-title">Display</div>
      {items.map((it) => (
        <div key={it.id} className="studio-right-row" style={{ alignItems: 'center' }}>
          <span>{it.label}</span>
          <input
            type="checkbox"
            data-studio-v3-display-toggle={it.id}
            checked={!!state[it.id]}
            onChange={(e) => setState((s) => ({ ...s, [it.id]: e.target.checked }))}
          />
        </div>
      ))}
    </div>
  );
}

// Slice 510 — Lighting section. Live ambient + key (sun) intensity
// sliders feeding the lightingops setters.
function LightingSection() {
  const [amb, setAmb] = useState(0.5);
  const [key, setKey] = useState(1.0);
  useEffect(() => {
    const read = () => {
      const a = window.__studioGetAmbientIntensity && window.__studioGetAmbientIntensity();
      const k = window.__studioGetKeyIntensity && window.__studioGetKeyIntensity();
      if (typeof a === 'number') setAmb(Number(a.toFixed(2)));
      if (typeof k === 'number') setKey(Number(k.toFixed(2)));
    };
    const id = setInterval(read, 800);
    read();
    return () => clearInterval(id);
  }, []);
  const onAmb = (e) => {
    const v = Number(e.target.value);
    setAmb(v);
    if (window.__studioSetAmbientIntensity) window.__studioSetAmbientIntensity(v);
  };
  const onKey = (e) => {
    const v = Number(e.target.value);
    setKey(v);
    if (window.__studioSetKeyIntensity) window.__studioSetKeyIntensity(v);
  };
  // Slice 540 — Sun direction (azimuth / elevation) sliders.
  const [az, setAz] = useState(45);
  const [el, setEl] = useState(45);
  const onAz = (e) => { const v = Number(e.target.value); setAz(v); if (window.__studioSetSunAngle) window.__studioSetSunAngle(v, el); };
  const onEl = (e) => { const v = Number(e.target.value); setEl(v); if (window.__studioSetSunAngle) window.__studioSetSunAngle(az, v); };
  return (
    <div className="studio-right-section" data-studio-v3-lighting-section>
      <div className="studio-right-section-title">Lighting</div>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Ambient</span>
        <input
          type="range"
          min="0" max="3" step="0.05"
          value={amb}
          onChange={onAmb}
          data-studio-v3-light-ambient
          style={{ flex: 1, marginLeft: 8 }}
        />
        <span style={{ width: 36, textAlign: 'right', fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 10, color: 'var(--studio-ink-mute, #9aa6b2)' }}>{amb.toFixed(2)}</span>
      </div>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Key</span>
        <input
          type="range"
          min="0" max="5" step="0.05"
          value={key}
          onChange={onKey}
          data-studio-v3-light-key
          style={{ flex: 1, marginLeft: 8 }}
        />
        <span style={{ width: 36, textAlign: 'right', fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 10, color: 'var(--studio-ink-mute, #9aa6b2)' }}>{key.toFixed(2)}</span>
      </div>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Azimuth</span>
        <input
          type="range"
          min="-180" max="180" step="1"
          value={az}
          onChange={onAz}
          data-studio-v3-light-azimuth
          style={{ flex: 1, marginLeft: 8 }}
        />
        <span style={{ width: 36, textAlign: 'right', fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 10, color: 'var(--studio-ink-mute, #9aa6b2)' }}>{az}°</span>
      </div>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Elevation</span>
        <input
          type="range"
          min="-90" max="90" step="1"
          value={el}
          onChange={onEl}
          data-studio-v3-light-elevation
          style={{ flex: 1, marginLeft: 8 }}
        />
        <span style={{ width: 36, textAlign: 'right', fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 10, color: 'var(--studio-ink-mute, #9aa6b2)' }}>{el}°</span>
      </div>
      <HDRIRow />
      <ToneMappingRows />
      <PostFXSection />
    </div>
  );
}

// Slice 562 — Stage mood presets. One click applies HDRI + bg + sun angle
// + ambient/key intensities matching the mood.
function StagePresets() {
  const apply = (preset) => {
    if (window.__studioSetHDRIEnvironment) window.__studioSetHDRIEnvironment(preset.hdri);
    const vp = window.__archdiscViewport;
    if (vp && vp.scene && vp.scene.background && vp.scene.background.set) vp.scene.background.set(preset.bg);
    if (window.__studioSetAmbientIntensity) window.__studioSetAmbientIntensity(preset.amb);
    if (window.__studioSetKeyIntensity) window.__studioSetKeyIntensity(preset.key);
    if (window.__studioSetSunAngle) window.__studioSetSunAngle(preset.az, preset.el);
    if (window.__studioToast) window.__studioToast(`Stage: ${preset.id}`, 'ok');
  };
  const presets = [
    { id: 'workshop',  hdri: 'studio',  bg: '#1a1d22', amb: 0.6, key: 1.2, az: 35,  el: 50 },
    { id: 'showroom',  hdri: 'neutral', bg: '#000000', amb: 0.8, key: 1.8, az: 25,  el: 70 },
    { id: 'sunset',    hdri: 'sunset',  bg: '#241010', amb: 0.4, key: 2.6, az: -50, el: 12 },
    { id: 'night',     hdri: 'off',     bg: '#04060a', amb: 0.15, key: 0.8, az: 90, el: 30 },
  ];
  return (
    <div className="studio-right-section" data-studio-v3-stage-presets>
      <div className="studio-right-section-title">Stage presets</div>
      <div className="studio-right-row" style={{ flexWrap: 'wrap', gap: 4 }}>
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            data-studio-v3-stage-preset={p.id}
            onClick={() => apply(p)}
            style={{
              flex: '1 1 calc(50% - 4px)', minWidth: 80,
              padding: '4px 6px', fontSize: 11,
              background: 'var(--studio-canvas-3, #141414)',
              color: 'var(--studio-ink, #f0eee6)',
              border: '1px solid var(--studio-rail-edge, #1d2027)',
              borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
              textTransform: 'capitalize',
            }}
          >{p.id}</button>
        ))}
      </div>
    </div>
  );
}

// Slice 611 — Post FX panel: Outline / SSAO / Bloom / FXAA toggle chips.
function PostFXSection() {
  const items = [
    { id: 'outline', label: 'Outline', toggle: () => window.__studioToggleOutlinePass && window.__studioToggleOutlinePass(), check: () => !!(window.__archdiscViewport && window.__archdiscViewport.__studioOutlinePass) },
    { id: 'ssao',    label: 'SSAO',    toggle: () => window.__studioToggleSSAO && window.__studioToggleSSAO(),       check: () => { const c = window.__archdiscViewport && window.__archdiscViewport.__studioComposer; return c && c.passes.some((p) => p.constructor.name === 'SSAOPass'); } },
    { id: 'bloom',   label: 'Bloom',   toggle: () => window.__studioToggleBloom && window.__studioToggleBloom(),     check: () => { const c = window.__archdiscViewport && window.__archdiscViewport.__studioComposer; return c && c.passes.some((p) => p.constructor.name === 'UnrealBloomPass'); } },
    { id: 'fxaa',    label: 'FXAA',    toggle: () => window.__studioToggleFXAA && window.__studioToggleFXAA(),       check: () => { const c = window.__archdiscViewport && window.__archdiscViewport.__studioComposer; return c && c.passes.some((p) => p.material && p.material.uniforms && 'resolution' in p.material.uniforms); } },
  ];
  const [state, setState] = useState({});
  useEffect(() => {
    const read = () => { const s = {}; for (const it of items) s[it.id] = !!it.check(); setState(s); };
    const id = setInterval(read, 600);
    read();
    return () => clearInterval(id);
  }, []);
  return (
    <div className="studio-right-section" data-studio-v3-postfx-section>
      <div className="studio-right-section-title">Post FX</div>
      <div className="studio-right-row" style={{ flexWrap: 'wrap', gap: 4 }}>
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            data-studio-v3-postfx={it.id}
            data-studio-v3-postfx-on={state[it.id] ? 'true' : 'false'}
            onClick={() => Promise.resolve(it.toggle()).then(() => setTimeout(() => setState((s) => ({ ...s, [it.id]: !s[it.id] })), 50))}
            style={{
              flex: '1 1 calc(50% - 4px)', minWidth: 70,
              padding: '4px 8px', fontSize: 11,
              background: state[it.id] ? 'var(--studio-accent, #ebecef)' : 'var(--studio-canvas-3, #141414)',
              color: state[it.id] ? '#000000' : 'var(--studio-ink, #f0eee6)',
              border: '1px solid var(--studio-rail-edge, #1d2027)',
              borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
              fontWeight: state[it.id] ? 600 : 400,
            }}
          >{it.label}</button>
        ))}
      </div>
    </div>
  );
}

// Slice 603 — Tone mapping + exposure controls.
function ToneMappingRows() {
  const [name, setName] = useState('aces');
  const [exp, setExp] = useState(1);
  const presets = ['none', 'linear', 'reinhard', 'cineon', 'aces', 'neutral'];
  useEffect(() => {
    if (window.__studioGetExposure) setExp(window.__studioGetExposure());
  }, []);
  const onName = (e) => {
    setName(e.target.value);
    if (window.__studioSetToneMapping) window.__studioSetToneMapping(e.target.value);
  };
  const onExp = (e) => {
    const v = Number(e.target.value);
    setExp(v);
    if (window.__studioSetExposure) window.__studioSetExposure(v);
  };
  return (
    <>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Tone</span>
        <select
          value={name}
          onChange={onName}
          data-studio-v3-tone-mapping
          style={{
            flex: 1, marginLeft: 8, padding: '2px 6px',
            background: 'var(--studio-canvas, #000000)',
            border: '1px solid var(--studio-rail-edge, #1d2027)',
            color: 'var(--studio-ink, #f0eee6)', borderRadius: 3,
            fontFamily: 'inherit', fontSize: 11,
          }}
        >
          {presets.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Exposure</span>
        <input
          type="range" min="0" max="4" step="0.05"
          value={exp}
          onChange={onExp}
          data-studio-v3-exposure
          style={{ flex: 1, marginLeft: 8 }}
        />
        <span style={{ width: 30, textAlign: 'right', fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 10, color: 'var(--studio-ink-mute, #9aa6b2)' }}>{exp.toFixed(2)}</span>
      </div>
    </>
  );
}

// Slice 561 — HDRI preset dropdown driving __studioSetHDRIEnvironment.
function HDRIRow() {
  const [presets, setPresets] = useState(['off', 'studio', 'sunset', 'neutral']);
  const [cur, setCur] = useState('off');
  useEffect(() => {
    const r = window.__studioListHDRIPresets && window.__studioListHDRIPresets();
    if (r && Array.isArray(r.presets)) setPresets(r.presets);
  }, []);
  const onChange = (e) => {
    setCur(e.target.value);
    if (window.__studioSetHDRIEnvironment) window.__studioSetHDRIEnvironment(e.target.value);
  };
  return (
    <div className="studio-right-row" style={{ alignItems: 'center' }}>
      <span>HDRI</span>
      <select
        value={cur}
        onChange={onChange}
        data-studio-v3-hdri-preset
        style={{
          flex: 1, marginLeft: 8, padding: '2px 6px',
          background: 'var(--studio-canvas, #000000)',
          border: '1px solid var(--studio-rail-edge, #1d2027)',
          color: 'var(--studio-ink, #f0eee6)', borderRadius: 3,
          fontFamily: 'inherit', fontSize: 11,
        }}
      >
        {presets.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
    </div>
  );
}

// Slice 605 — Sky gradient: top + bottom colours, single apply button.
function SkyGradientSection() {
  const [top, setTop] = useState('#1a2438');
  const [bot, setBot] = useState('#000000');
  const apply = () => { if (window.__studioSetSkyGradient) window.__studioSetSkyGradient(top, bot); };
  const clear = () => { if (window.__studioClearSkyGradient) window.__studioClearSkyGradient('#000000'); };
  return (
    <div className="studio-right-section" data-studio-v3-sky-gradient>
      <div className="studio-right-section-title">Sky gradient</div>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Top</span>
        <input
          type="color"
          value={top}
          onChange={(e) => setTop(e.target.value)}
          data-studio-v3-sky-top
          style={{ width: 40, height: 22, padding: 0, border: '1px solid var(--studio-ink-mute)', borderRadius: 2, background: 'transparent', cursor: 'pointer' }}
        />
      </div>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Bottom</span>
        <input
          type="color"
          value={bot}
          onChange={(e) => setBot(e.target.value)}
          data-studio-v3-sky-bottom
          style={{ width: 40, height: 22, padding: 0, border: '1px solid var(--studio-ink-mute)', borderRadius: 2, background: 'transparent', cursor: 'pointer' }}
        />
      </div>
      <div className="studio-right-row" style={{ gap: 4, marginTop: 4 }}>
        <button
          type="button"
          onClick={apply}
          data-studio-v3-sky-apply
          style={{
            flex: 1, padding: '3px', background: 'var(--studio-accent, #ebecef)',
            color: '#000000', fontWeight: 600, border: 0, borderRadius: 3,
            fontSize: 11, cursor: 'pointer',
          }}
        >Apply</button>
        <button
          type="button"
          onClick={clear}
          data-studio-v3-sky-clear
          style={{
            flex: 1, padding: '3px', background: 'transparent',
            color: 'var(--studio-ink, #f0eee6)',
            border: '1px solid var(--studio-rail-edge, #1d2027)',
            borderRadius: 3, fontSize: 11, cursor: 'pointer',
          }}
        >Solid</button>
      </div>
    </div>
  );
}

// Slice 604 — Fog section: color picker + near/far sliders + on/off button.
function FogSection() {
  const [on, setOn] = useState(false);
  const [hex, setHex] = useState('#000000');
  const [near, setNear] = useState(0.5);
  const [far, setFar] = useState(5);
  useEffect(() => {
    const f = window.__studioGetFog && window.__studioGetFog();
    if (f) { setOn(true); setHex(f.color); setNear(f.near); setFar(f.far); }
  }, []);
  const toggle = () => {
    if (on) {
      if (window.__studioSetFog) window.__studioSetFog(null);
      setOn(false);
    } else {
      if (window.__studioSetFog) window.__studioSetFog(hex, near, far);
      setOn(true);
    }
  };
  const sync = (h, n, f) => { if (on && window.__studioSetFog) window.__studioSetFog(h, n, f); };
  return (
    <div className="studio-right-section" data-studio-v3-fog-section>
      <div className="studio-right-section-title">Fog</div>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Enabled</span>
        <button
          type="button"
          data-studio-v3-fog-enable
          data-studio-v3-fog-on={on ? 'true' : 'false'}
          onClick={toggle}
          style={{
            background: 'transparent', border: '1px solid var(--studio-rail-edge, #1d2027)',
            color: on ? 'var(--studio-accent, #ebecef)' : 'var(--studio-ink, #f0eee6)',
            padding: '2px 8px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
          }}
        >{on ? 'on' : 'off'}</button>
      </div>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Color</span>
        <input
          type="color"
          value={hex}
          onChange={(e) => { setHex(e.target.value); sync(e.target.value, near, far); }}
          data-studio-v3-fog-color
          style={{ width: 40, height: 22, padding: 0, border: '1px solid var(--studio-ink-mute)', borderRadius: 2, background: 'transparent', cursor: 'pointer' }}
        />
      </div>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Near</span>
        <input
          type="range" min="0.05" max="5" step="0.05"
          value={near}
          onChange={(e) => { const v = Number(e.target.value); setNear(v); sync(hex, v, far); }}
          data-studio-v3-fog-near
          style={{ flex: 1, marginLeft: 8 }}
        />
        <span style={{ width: 30, textAlign: 'right', fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 10, color: 'var(--studio-ink-mute, #9aa6b2)' }}>{near.toFixed(2)}</span>
      </div>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Far</span>
        <input
          type="range" min="0.5" max="50" step="0.5"
          value={far}
          onChange={(e) => { const v = Number(e.target.value); setFar(v); sync(hex, near, v); }}
          data-studio-v3-fog-far
          style={{ flex: 1, marginLeft: 8 }}
        />
        <span style={{ width: 30, textAlign: 'right', fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 10, color: 'var(--studio-ink-mute, #9aa6b2)' }}>{far.toFixed(1)}</span>
      </div>
    </div>
  );
}

// Slice 508 — World section. Edits grid extent + canvas background tint.
function WorldSection() {
  const [grid, setGrid] = useState(1);
  const [bg, setBg] = useState('#000000');
  useEffect(() => {
    const read = () => {
      if (typeof window.__studioGridSize === 'number') setGrid(window.__studioGridSize);
      const vp = window.__archdiscViewport;
      if (vp && vp.scene && vp.scene.background && vp.scene.background.getHexString) {
        setBg('#' + vp.scene.background.getHexString());
      }
    };
    const id = setInterval(read, 800);
    read();
    return () => clearInterval(id);
  }, []);
  const onGrid = (e) => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v) || v <= 0) return;
    setGrid(v);
    if (window.__studioSetGridSize) window.__studioSetGridSize(v, 20);
  };
  const onBg = (e) => {
    const v = e.target.value;
    setBg(v);
    const vp = window.__archdiscViewport;
    if (vp && vp.scene) {
      const THREE = window.__archdiscTHREE || null;
      if (THREE && vp.scene.background && vp.scene.background.set) {
        vp.scene.background.set(v);
      } else if (vp.scene.background && vp.scene.background.setHex) {
        vp.scene.background.setHex(parseInt(v.slice(1), 16));
      }
    }
  };
  return (
    <div className="studio-right-section" data-studio-v3-world-section>
      <div className="studio-right-section-title">World</div>
      <div className="studio-right-row">
        <span>Grid size (m)</span>
        <input
          type="number"
          min="0.05"
          max="100"
          step="0.05"
          value={grid}
          onChange={onGrid}
          data-studio-v3-world-grid
          style={{
            width: 64, background: 'var(--studio-canvas, #000000)', border: '1px solid var(--studio-rail-edge, #1d2027)',
            color: 'var(--studio-ink, #f0eee6)', padding: '2px 6px', borderRadius: 3,
            fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 11, textAlign: 'right',
          }}
        />
      </div>
      <div className="studio-right-row">
        <span>Background</span>
        <input
          type="color"
          value={bg}
          onChange={onBg}
          data-studio-v3-world-bg
          style={{
            width: 32, height: 18, padding: 0, border: '1px solid var(--studio-rail-edge, #1d2027)',
            borderRadius: 3, cursor: 'pointer', background: 'transparent',
          }}
        />
      </div>
    </div>
  );
}

// Slice 499 — Snap section. Live-bound step inputs for translate
// (mm), rotate (deg), scale (×), plus an on/off toggle that mirrors
// the status-bar SnapIndicator.
function SnapSection() {
  const [on, setOn] = useState(false);
  const [t, setT] = useState(10);   // mm
  const [r, setR] = useState(15);   // deg
  const [s, setS] = useState(0.1);  // ×
  useEffect(() => {
    const read = () => {
      const snap = window.__studioGetSnap && window.__studioGetSnap();
      if (!snap) return;
      setOn(!!snap.on);
      setT(Math.round(snap.t * 1000));     // m → mm
      setR(Math.round((snap.r * 180) / Math.PI));
      setS(Number(snap.s.toFixed(3)));
    };
    const id = setInterval(read, 600);
    read();
    return () => clearInterval(id);
  }, []);
  const setTrans = (mm) => { setT(mm); if (window.__studioSetTranslationSnap) window.__studioSetTranslationSnap(mm / 1000); };
  const setRot   = (deg) => { setR(deg); if (window.__studioSetRotationSnap) window.__studioSetRotationSnap((deg * Math.PI) / 180); };
  const setScl   = (x) => { setS(x); if (window.__studioSetScaleSnap) window.__studioSetScaleSnap(x); };
  const cell = (val, onChange, min, max, step, suffix, attr) => (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3 }}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={val}
        onChange={(e) => onChange(Number(e.target.value))}
        data-studio-v3-snap-step={attr}
        style={{
          width: 50, background: 'var(--studio-canvas, #000000)', border: '1px solid var(--studio-rail-edge, #1d2027)',
          color: 'var(--studio-ink, #f0eee6)', padding: '2px 5px', borderRadius: 3,
          fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 11, textAlign: 'right',
        }}
      />
      <span style={{ color: 'var(--studio-ink-mute, #9aa6b2)', fontSize: 10 }}>{suffix}</span>
    </span>
  );
  return (
    <div className="studio-right-section" data-studio-v3-snap-section>
      <div className="studio-right-section-title">Snap</div>
      <div className="studio-right-row">
        <span>Enabled</span>
        <button
          type="button"
          data-studio-v3-snap-enable
          data-studio-v3-snap-on={on ? 'true' : 'false'}
          onClick={() => window.__studioToggleSnap && window.__studioToggleSnap()}
          style={{
            background: 'transparent', border: '1px solid var(--studio-rail-edge, #1d2027)',
            color: on ? 'var(--studio-accent, #ebecef)' : 'var(--studio-ink, #f0eee6)',
            padding: '2px 8px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
          }}
        >{on ? 'on' : 'off'}</button>
      </div>
      <div className="studio-right-row"><span>Translate</span>{cell(t, setTrans, 1, 1000, 1, 'mm', 'translate')}</div>
      <div className="studio-right-row"><span>Rotate</span>{cell(r, setRot, 1, 90, 1, '°', 'rotate')}</div>
      <div className="studio-right-row"><span>Scale</span>{cell(s, setScl, 0.01, 1, 0.01, '×', 'scale')}</div>
    </div>
  );
}

function MaterialRows() {
  const [version, setVersion] = useState(0);
  const meshRef = React.useRef(null);
  useEffect(() => {
    const id = setInterval(() => {
      const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
      const cur = meshRef.current;
      if ((cur && cur.uuid) !== (m && m.uuid)) {
        meshRef.current = m;
        setVersion((v) => v + 1);
      }
    }, 500);
    return () => clearInterval(id);
  }, []);
  const m = meshRef.current;
  if (!m || !m.material) return null;
  const mat = Array.isArray(m.material) ? m.material[0] : m.material;
  const hex = mat.color ? '#' + mat.color.getHexString() : '#888888';
  const isStd = typeof mat.metalness === 'number';
  return (
    <div className="studio-right-section" data-studio-v3-material-rows key={version}>
      <div className="studio-right-section-title">Material</div>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Color</span>
        <input
          type="color"
          data-studio-v3-material-color
          defaultValue={hex}
          onChange={(e) => {
            if (mat.color) mat.color.set(e.target.value);
            mat.needsUpdate = true;
          }}
          style={{ width: 40, height: 22, padding: 0, border: '1px solid var(--studio-ink-mute)', borderRadius: 2, background: 'transparent', cursor: 'pointer' }}
        />
      </div>
      {/* Slice 601 — Texture map upload. */}
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Texture map</span>
        <input
          type="file"
          accept="image/*"
          data-studio-v3-material-texture
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = () => { if (window.__studioApplyTextureMap) window.__studioApplyTextureMap(r.result, f.name); };
            r.readAsDataURL(f);
          }}
          style={{ flex: 1, fontSize: 10, color: 'var(--studio-ink-mute)' }}
        />
      </div>
      {/* Slice 602 — Normal map upload. */}
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Normal map</span>
        <input
          type="file"
          accept="image/*"
          data-studio-v3-material-normal
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = () => { if (window.__studioApplyNormalMap) window.__studioApplyNormalMap(r.result, f.name); };
            r.readAsDataURL(f);
          }}
          style={{ flex: 1, fontSize: 10, color: 'var(--studio-ink-mute)' }}
        />
      </div>
      {isStd && (
        <>
          <div className="studio-right-row" style={{ alignItems: 'center' }}>
            <span>Metalness</span>
            <input
              type="range" min="0" max="1" step="0.01"
              data-studio-v3-material-metalness
              defaultValue={mat.metalness}
              onInput={(e) => { mat.metalness = parseFloat(e.target.value); mat.needsUpdate = true; }}
              style={{ width: 90 }}
            />
          </div>
          <div className="studio-right-row" style={{ alignItems: 'center' }}>
            <span>Roughness</span>
            <input
              type="range" min="0" max="1" step="0.01"
              data-studio-v3-material-roughness
              defaultValue={mat.roughness}
              onInput={(e) => { mat.roughness = parseFloat(e.target.value); mat.needsUpdate = true; }}
              style={{ width: 90 }}
            />
          </div>
        </>
      )}
      {/* Slice 530 — Emissive color + intensity. */}
      {isStd && (
        <>
          <div className="studio-right-row" style={{ alignItems: 'center' }}>
            <span>Emissive</span>
            <input
              type="color"
              data-studio-v3-material-emissive
              defaultValue={mat.emissive ? '#' + mat.emissive.getHexString() : '#000000'}
              onChange={(e) => {
                if (mat.emissive) mat.emissive.set(e.target.value);
                else mat.emissive = new (window.__archdiscTHREE ? window.__archdiscTHREE.Color : Object)(e.target.value);
                mat.needsUpdate = true;
              }}
              style={{ width: 40, height: 22, padding: 0, border: '1px solid var(--studio-ink-mute)', borderRadius: 2, background: 'transparent', cursor: 'pointer' }}
            />
          </div>
          <div className="studio-right-row" style={{ alignItems: 'center' }}>
            <span>Glow</span>
            <input
              type="range" min="0" max="3" step="0.05"
              data-studio-v3-material-emissive-intensity
              defaultValue={typeof mat.emissiveIntensity === 'number' ? mat.emissiveIntensity : 1}
              onInput={(e) => { mat.emissiveIntensity = parseFloat(e.target.value); mat.needsUpdate = true; }}
              style={{ width: 90 }}
            />
          </div>
        </>
      )}
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Opacity</span>
        <input
          type="range" min="0" max="1" step="0.01"
          data-studio-v3-material-opacity
          defaultValue={typeof mat.opacity === 'number' ? mat.opacity : 1}
          onInput={(e) => {
            const v = parseFloat(e.target.value);
            mat.opacity = v;
            mat.transparent = v < 1;
            mat.needsUpdate = true;
          }}
          style={{ width: 90 }}
        />
      </div>
      <div className="studio-right-row" style={{ alignItems: 'center' }}>
        <span>Wireframe</span>
        <input
          type="checkbox"
          data-studio-v3-material-wireframe
          defaultChecked={!!mat.wireframe}
          onChange={(e) => { mat.wireframe = !!e.target.checked; mat.needsUpdate = true; }}
        />
      </div>
      {/* Slice 467 — Smart material preset buttons. Lazy-list the
          available presets from __studioListSmartMaterials so the row
          stays consistent with whatever V3 lightingops offers. */}
      <SmartMaterialPresets onApply={() => setVersion((v) => v + 1)} />
    </div>
  );
}

function SmartMaterialPresets({ onApply }) {
  const [presets, setPresets] = React.useState([]);
  React.useEffect(() => {
    if (window.__studioListSmartMaterials) {
      const r = window.__studioListSmartMaterials();
      if (r && r.ok) setPresets(r.presets || []);
    }
  }, []);
  if (!presets.length) return null;
  return (
    <>
      <div className="studio-right-row" style={{ marginTop: 6 }}>
        <span style={{ opacity: 0.55, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Smart materials</span>
      </div>
      <div className="studio-right-row" style={{ flexWrap: 'wrap', gap: 4 }}>
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            data-studio-v3-smart-material={p}
            onClick={() => {
              if (window.__studioApplySmartMaterial) window.__studioApplySmartMaterial(p);
              if (onApply) onApply();
            }}
            style={{
              padding: '3px 8px', fontSize: 10,
              background: 'var(--studio-canvas-3, #141414)',
              color: 'var(--studio-ink, #f0eee6)',
              border: '1px solid var(--studio-rail-edge, #1d2027)',
              borderRadius: 3, cursor: 'pointer',
              fontFamily: 'inherit', textTransform: 'capitalize',
            }}
          >{p}</button>
        ))}
      </div>
    </>
  );
}

function MeshStatsRows() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    const read = () => {
      const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
      if (!m || !m.geometry || !m.geometry.attributes || !m.geometry.attributes.position) {
        setStats(null);
        return;
      }
      const g = m.geometry;
      const pos = g.attributes.position;
      const v = pos.count;
      const idx = g.index ? g.index.array : null;
      const t = idx ? Math.floor(idx.length / 3) : Math.floor(v / 3);
      // Surface area (sum of triangle areas) + AABB volume — skip above
      // 20k tris to keep the inspector cheap.
      let area = 0;
      let bboxVolume = 0;
      if (t <= 20000) {
        const a = pos.array;
        const tmp = (x1, y1, z1, x2, y2, z2, x3, y3, z3) => {
          const ux = x2 - x1, uy = y2 - y1, uz = z2 - z1;
          const vx = x3 - x1, vy = y3 - y1, vz = z3 - z1;
          const cx = uy * vz - uz * vy;
          const cy = uz * vx - ux * vz;
          const cz = ux * vy - uy * vx;
          return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
        };
        for (let i = 0; i < t; i++) {
          const i0 = idx ? idx[i * 3] : i * 3;
          const i1 = idx ? idx[i * 3 + 1] : i * 3 + 1;
          const i2 = idx ? idx[i * 3 + 2] : i * 3 + 2;
          area += tmp(a[i0 * 3], a[i0 * 3 + 1], a[i0 * 3 + 2],
                      a[i1 * 3], a[i1 * 3 + 1], a[i1 * 3 + 2],
                      a[i2 * 3], a[i2 * 3 + 1], a[i2 * 3 + 2]);
        }
        if (!g.boundingBox) g.computeBoundingBox();
        if (g.boundingBox) {
          const bb = g.boundingBox;
          bboxVolume = (bb.max.x - bb.min.x) * (bb.max.y - bb.min.y) * (bb.max.z - bb.min.z);
        }
      }
      // Slice 545 — AABB dimensions (world-space, with mesh scale).
      let dims = null;
      if (g.boundingBox) {
        const bb = g.boundingBox;
        const sx = m.scale.x, sy = m.scale.y, sz = m.scale.z;
        dims = {
          w: (bb.max.x - bb.min.x) * sx,
          h: (bb.max.y - bb.min.y) * sy,
          d: (bb.max.z - bb.min.z) * sz,
        };
      }
      setStats({
        v, t, area, bboxVolume, dims,
        kind: m.userData && m.userData.archdiscStudioPrimitiveKind || 'mesh',
      });
    };
    const id = setInterval(read, 1000);
    read();
    return () => clearInterval(id);
  }, []);
  if (!stats) return null;
  return (
    <div className="studio-right-section" data-studio-v3-mesh-stats>
      <div className="studio-right-section-title">Mesh stats</div>
      <div className="studio-right-row"><span>Kind</span><strong style={{ textTransform: 'capitalize' }}>{stats.kind}</strong></div>
      <div className="studio-right-row"><span>Vertices</span><strong>{stats.v.toLocaleString()}</strong></div>
      <div className="studio-right-row"><span>Triangles</span><strong>{stats.t.toLocaleString()}</strong></div>
      {stats.area > 0 && (
        <div className="studio-right-row"><span>Surface area</span><strong style={{ fontFamily: 'var(--studio-mono)' }}>{stats.area.toFixed(4)}</strong></div>
      )}
      {stats.bboxVolume > 0 && (
        <div className="studio-right-row"><span>AABB volume</span><strong style={{ fontFamily: 'var(--studio-mono)' }}>{stats.bboxVolume.toFixed(6)}</strong></div>
      )}
      {stats.dims && (
        <div className="studio-right-row" data-studio-v3-mesh-dims>
          <span>Dimensions (m)</span>
          <strong style={{ fontFamily: 'var(--studio-mono)' }}>
            {stats.dims.w.toFixed(3)} × {stats.dims.h.toFixed(3)} × {stats.dims.d.toFixed(3)}
          </strong>
        </div>
      )}
      {stats.bboxVolume > 0 && (
        <>
          {/* Slice 595 — Estimated mass at common densities (kg). */}
          {[['Steel', 7850], ['Aluminum', 2700], ['Plastic', 1100]].map(([name, dens]) => (
            <div
              key={name}
              className="studio-right-row"
              data-studio-v3-mesh-mass={name.toLowerCase()}
            >
              <span>Mass · {name}</span>
              <strong style={{ fontFamily: 'var(--studio-mono)' }}>
                {(stats.bboxVolume * dens).toFixed(3)} kg
              </strong>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ─── LayersRows (slice 462) ──────────────────────────────────────────────
// 8 view layers (Three.Object3D.layers mask) with visibility + isolate
// toggles. Camera layers default to all 8 visible; each row's eye-toggle
// flips camera.layers.toggle(i), and the solo button isolates that
// layer (camera.layers.set(i) + remember prior set so unsolo restores).
function LayersRows() {
  const [version, setVersion] = useState(0);
  const priorMask = React.useRef(null);
  const refresh = () => setVersion((v) => v + 1);
  // Slice 544 — Layer rename persisted to localStorage so users can label
  // their semantic groupings (e.g., "blockout", "ref", "lights").
  const NAMES_KEY = 'studio.v3.layer-names';
  const [names, setNames] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem(NAMES_KEY) || '{}'); } catch (_) { return {}; }
  });
  const rename = (i, val) => {
    const next = { ...names, [i]: val };
    setNames(next);
    try { window.localStorage.setItem(NAMES_KEY, JSON.stringify(next)); } catch (_) {}
  };
  const cam = () => {
    const vp = window.__archdiscViewport;
    return vp && vp.camera;
  };
  const isLayerOn = (i) => {
    const c = cam(); if (!c) return false;
    return (c.layers.mask & (1 << i)) !== 0;
  };
  const toggle = (i) => {
    const c = cam(); if (!c) return;
    c.layers.toggle(i);
    refresh();
  };
  const solo = (i) => {
    const c = cam(); if (!c) return;
    if (priorMask.current == null) priorMask.current = c.layers.mask;
    c.layers.set(i);
    refresh();
  };
  const unsolo = () => {
    const c = cam(); if (!c) return;
    if (priorMask.current != null) {
      c.layers.mask = priorMask.current;
      priorMask.current = null;
    } else {
      c.layers.enableAll();
    }
    refresh();
  };
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push(i);
  return (
    <div className="studio-right-section" data-studio-v3-layers key={version}>
      <div className="studio-right-section-title">View layers</div>
      {rows.map((i) => (
        <div
          key={i}
          className="studio-right-row"
          data-studio-v3-layer={i}
          data-studio-v3-layer-on={isLayerOn(i) ? 'true' : 'false'}
          style={{ alignItems: 'center', gap: 6 }}
        >
          <input
            type="checkbox"
            data-studio-v3-layer-toggle={i}
            checked={isLayerOn(i)}
            onChange={() => toggle(i)}
            title={`Toggle layer ${i}`}
          />
          <input
            type="text"
            data-studio-v3-layer-name={i}
            defaultValue={names[i] || `Layer ${i}`}
            onBlur={(e) => rename(i, e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { rename(i, e.currentTarget.value); e.currentTarget.blur(); } }}
            style={{
              flex: 1, padding: '1px 4px', fontSize: 11,
              background: 'transparent',
              border: '1px solid transparent',
              color: 'var(--studio-ink, #f0eee6)', fontFamily: 'inherit',
              minWidth: 0,
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--studio-rail-edge, #1d2027)'; }}
            onMouseLeave={(e) => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderColor = 'transparent'; }}
          />
          <button
            type="button"
            data-studio-v3-layer-solo={i}
            onClick={() => solo(i)}
            title="Isolate (solo)"
            style={{
              padding: '1px 6px', fontSize: 10,
              background: 'var(--studio-canvas-3, #141414)',
              color: 'var(--studio-ink, #f0eee6)',
              border: '1px solid var(--studio-rail-edge, #1d2027)',
              borderRadius: 2, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >solo</button>
        </div>
      ))}
      <div className="studio-right-row" style={{ marginTop: 6 }}>
        <button
          type="button"
          data-studio-v3-layer-unsolo
          onClick={unsolo}
          style={{
            padding: '4px 10px', fontSize: 11,
            background: 'var(--studio-canvas-3, #141414)',
            color: 'var(--studio-ink, #f0eee6)',
            border: '1px solid var(--studio-rail-edge, #1d2027)',
            borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >Reveal all layers</button>
      </div>
    </div>
  );
}

function OutlinerRows() {
  const [items, setItems] = useState([]);
  // Slice 463 — search filter, persisted across re-renders via window so
  // the user's filter survives outliner unmount/mount cycles.
  const [filter, setFilter] = useState(() => (typeof window !== 'undefined' && window.__studioV3OutlinerFilter) || '');
  useEffect(() => { if (typeof window !== 'undefined') window.__studioV3OutlinerFilter = filter; }, [filter]);
  useEffect(() => {
    const read = () => {
      // Slice 507 — Tree-aware traversal: depth is the number of archdisc-
      // group ancestors. Groups appear with their children indented under
      // them in scene-graph order.
      const out = [];
      const s = window.__archdiscScene;
      if (!s) { setItems(out); return; }
      const walk = (node, depth) => {
        if (!node) return;
        if (node.userData && node.userData.archdiscStudioPrimitive) {
          out.push({
            uuid: node.uuid,
            name: node.name || (node.userData && node.userData.archdiscStudioPrimitiveKind) || 'mesh',
            depth,
            kind: (node.userData && node.userData.archdiscStudioPrimitiveKind) || 'mesh',
            locked: !!node.userData.archdiscStudioLocked,
          });
        }
        const childDepth = node.userData && node.userData.archdiscStudioPrimitiveKind === 'group' ? depth + 1 : depth;
        if (node.children) for (const c of node.children) walk(c, childDepth);
      };
      try { for (const c of s.children) walk(c, 0); } catch (_) {}
      setItems(out);
    };
    const id = setInterval(read, 600);
    read();
    return () => clearInterval(id);
  }, []);
  const visible = filter
    ? items.filter((it) => it.name.toLowerCase().includes(filter.toLowerCase()))
    : items;
  if (!items.length) {
    return (
      <div className="studio-right-section">
        <div className="studio-right-section-title">Scene</div>
        <div className="studio-right-row" style={{ color: 'var(--studio-ink-mute)', fontStyle: 'italic' }}>
          Empty — add a primitive from the toolbar.
        </div>
      </div>
    );
  }
  // Slice 443 — Click an outliner row to select the matching mesh.
  // Tracks the active uuid for a visual highlight (border-left).
  const [activeUuid, setActiveUuid] = useState(null);
  useEffect(() => {
    const read = () => {
      const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
      setActiveUuid(m ? m.uuid : null);
    };
    const id = setInterval(read, 400);
    read();
    return () => clearInterval(id);
  }, []);
  const onPick = (uuid) => {
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    if (!s) return;
    let m = null;
    s.traverse((o) => { if (o.uuid === uuid) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  };
  // Slice 477 — per-row delete + visibility helpers.
  const deleteMesh = (uuid) => {
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    if (!s) return;
    let m = null;
    s.traverse((o) => { if (o.uuid === uuid) m = o; });
    if (!m) return;
    if (window.__studioPushUndo) window.__studioPushUndo();
    if (m.geometry) m.geometry.dispose();
    if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose && mat.dispose());
    else if (m.material && m.material.dispose) m.material.dispose();
    s.remove(m);
    if (window.__studioDeselect) window.__studioDeselect();
  };
  const toggleVis = (uuid) => {
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    if (!s) return;
    let m = null;
    s.traverse((o) => { if (o.uuid === uuid) m = o; });
    if (m) m.visible = !m.visible;
  };
  return (
    <div className="studio-right-section">
      <div className="studio-right-section-title">Scene · {items.length}{filter && ` · ${visible.length} match`}</div>
      <div className="studio-right-row" style={{ marginBottom: 4 }}>
        <input
          type="text"
          data-studio-v3-outliner-filter
          value={filter}
          placeholder="Filter…"
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setFilter(''); }}
          style={{
            flex: 1, padding: '2px 6px', fontSize: 11,
            background: 'var(--studio-canvas-3, #1f1f1f)',
            color: 'var(--studio-ink, #dfe5ea)',
            border: '1px solid var(--studio-ink-mute, #2c2c30)',
            borderRadius: 2, fontFamily: 'inherit',
          }}
        />
      </div>
      {visible.map((it) => {
        const active = it.uuid === activeUuid;
        return (
          <div
            key={it.uuid}
            className="studio-right-row"
            data-studio-v3-outliner-item={it.uuid}
            data-studio-v3-outliner-active={active ? 'true' : 'false'}
            data-studio-v3-outliner-depth={it.depth || 0}
            onClick={(e) => { if (e.target.tagName !== 'BUTTON') onPick(it.uuid); }}
            style={{
              cursor: 'pointer', alignItems: 'center', gap: 4,
              borderLeft: '2px solid ' + (active ? 'var(--studio-accent, #ebecef)' : 'transparent'),
              paddingLeft: 6 + (it.depth || 0) * 12,
            }}
          >
            <span style={{
              flex: 1, textTransform: 'capitalize',
              color: it.kind === 'group' ? 'var(--studio-accent, #ebecef)' : 'inherit',
              fontWeight: it.kind === 'group' ? 600 : 400,
            }}>{it.kind === 'group' ? '▸ ' : ''}{it.name}</span>
            <button
              type="button"
              data-studio-v3-outliner-lock={it.uuid}
              data-studio-v3-outliner-locked={it.locked ? 'true' : 'false'}
              title={it.locked ? 'Unlock transform' : 'Lock transform'}
              onClick={(e) => {
                e.stopPropagation();
                const s = window.__archdiscScene;
                let m = null;
                s.traverse((o) => { if (o.uuid === it.uuid) m = o; });
                if (!m) return;
                const prev = window.__studioSelectedMeshesSet;
                window.__studioSelectedMeshesSet = [m];
                if (window.__studioToggleLockSelected) window.__studioToggleLockSelected();
                window.__studioSelectedMeshesSet = prev;
              }}
              style={{
                padding: '0 4px', fontSize: 10,
                background: 'transparent',
                color: it.locked ? 'var(--studio-accent, #ebecef)' : 'var(--studio-ink-mute)',
                border: '1px solid ' + (it.locked ? 'var(--studio-accent, #ebecef)' : 'var(--studio-ink-mute)'),
                borderRadius: 2, cursor: 'pointer',
              }}
            >{it.locked ? '🔒' : '🔓'}</button>
            <button
              type="button"
              data-studio-v3-outliner-visibility={it.uuid}
              title="Toggle visibility"
              onClick={(e) => { e.stopPropagation(); toggleVis(it.uuid); }}
              style={{
                padding: '0 4px', fontSize: 10,
                background: 'transparent', color: 'var(--studio-ink-mute)',
                border: '1px solid var(--studio-ink-mute)', borderRadius: 2, cursor: 'pointer',
              }}
            >👁</button>
            <button
              type="button"
              data-studio-v3-outliner-delete={it.uuid}
              title="Delete"
              onClick={(e) => { e.stopPropagation(); deleteMesh(it.uuid); }}
              style={{
                padding: '0 4px', fontSize: 10,
                background: 'transparent', color: 'var(--studio-ink-mute)',
                border: '1px solid var(--studio-ink-mute)', borderRadius: 2, cursor: 'pointer',
              }}
            >×</button>
          </div>
        );
      })}
    </div>
  );
}

// ─── TimelineStrip (slice 444) ───────────────────────────────────────────
// Compact horizontal timeline showing frame 0..maxFrame, a teal marker
// for the current frame, and amber dots for the active mesh's keyframes.
// Click anywhere on the strip to scrub the frame; double-click clears
// the keyframes display by jumping back to frame 0.
function TimelineStrip() {
  // Slice 951h — hidden unless the active discipline actually uses
  // animation. The user's screenshot showed the 0/10/20/30/40/50/60
  // tick labels stacked above MODEL on the discipline rail (the strip
  // was overflowing its slot in the shell grid) — pure noise outside
  // the Animate tab. Returning null in non-animation disciplines keeps
  // the component identity for callers but renders zero DOM.
  if (typeof window !== 'undefined') {
    try {
      const wb = (window.__studioActiveWb && window.__studioActiveWb()) || null;
      if (wb && wb !== 'animate' && wb !== 'anim') return null;
    } catch (_) {}
    // If we can't detect the active wb at all, default to hidden — the
    // user opens animation explicitly when they need it.
    return null;
  }
  return null;
  // eslint-disable-next-line no-unreachable
  const [frame, setFrame] = useState(0);
  const [maxFrame, setMaxFrame] = useState(60);
  const [keyframes, setKeyframes] = useState([]);
  const stripRef = React.useRef(null);
  useEffect(() => {
    const onFrame = (ev) => { if (ev && ev.detail && typeof ev.detail.frame === 'number') setFrame(ev.detail.frame); };
    window.addEventListener('studio-frame-changed', onFrame);
    let raf = 0;
    const tick = () => {
      if (window.__studioGetFrame) {
        const f = window.__studioGetFrame();
        if (f !== frame) setFrame(f);
        if (f > maxFrame - 5) setMaxFrame(Math.max(maxFrame, f + 30));
      }
      // Pull keyframes for the active mesh (cheap — < 200 typical).
      const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
      if (m && window.__studioGetKeyframes) {
        const r = window.__studioGetKeyframes(m.uuid);
        const kfs = (r && r.keyframes) || [];
        const frames = kfs.map((k) => k.frame);
        // Only update if changed (skip React churn).
        if (frames.length !== keyframes.length || frames.some((f, i) => f !== keyframes[i])) {
          setKeyframes(frames);
        }
      } else if (keyframes.length) {
        setKeyframes([]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('studio-frame-changed', onFrame);
      cancelAnimationFrame(raf);
    };
  }, [frame, maxFrame, keyframes]);
  const scrubTo = (e) => {
    const el = stripRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = Math.max(0, Math.min(1, x / rect.width));
    const f = Math.round(t * maxFrame);
    if (window.__studioSetFrame) window.__studioSetFrame(f);
  };
  const markerPct = (frame / maxFrame) * 100;
  return (
    <div
      ref={stripRef}
      data-studio-v3-timeline
      data-studio-v3-frame={frame}
      data-studio-v3-max-frame={maxFrame}
      onClick={scrubTo}
      onDoubleClick={() => window.__studioSetFrame && window.__studioSetFrame(0)}
      title={`Frame ${frame} / ${maxFrame} — click to scrub`}
      style={{
        position: 'relative',
        height: 18,
        background: 'var(--studio-canvas-3, #141414)',
        borderTop: '1px solid var(--studio-rail-edge, #1d2027)',
        cursor: 'crosshair',
        fontFamily: 'var(--studio-mono, ui-monospace)',
        fontSize: 9,
        color: 'var(--studio-ink-mute, #9aa6b2)',
        userSelect: 'none',
      }}
    >
      {/* Major ticks every 10 frames. */}
      {Array.from({ length: Math.floor(maxFrame / 10) + 1 }).map((_, i) => {
        const f = i * 10;
        const pct = (f / maxFrame) * 100;
        return (
          <span
            key={f}
            style={{
              position: 'absolute', left: `${pct}%`, top: 0, bottom: 0,
              width: 1, background: 'rgba(255,255,255,0.06)',
            }}
          >
            <span style={{ position: 'absolute', left: 3, top: 2, fontSize: 8 }}>{f}</span>
          </span>
        );
      })}
      {/* Keyframe dots. */}
      {keyframes.map((f, i) => (
        <span
          key={`kf-${i}-${f}`}
          data-studio-v3-keyframe={f}
          style={{
            position: 'absolute',
            left: `${(f / maxFrame) * 100}%`,
            top: 6, width: 4, height: 6,
            transform: 'translateX(-2px)',
            background: '#ffcc55',
            borderRadius: 1,
          }}
        />
      ))}
      {/* Current-frame marker. */}
      <span
        data-studio-v3-timeline-marker
        style={{
          position: 'absolute',
          left: `${markerPct}%`, top: 0, bottom: 0,
          width: 2,
          transform: 'translateX(-1px)',
          background: 'var(--studio-accent, #ebecef)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

// ─── StatusBar ───────────────────────────────────────────────────────────
function StatusBar({ wb, editMode }) {
  const [fps, setFps] = useState(0);
  const [calls, setCalls] = useState(0);
  const [primCount, setPrimCount] = useState(0);
  // Slice 425 — selected-mesh V / T pinned to the right of primitive count.
  // Polls once per second to keep the strip cheap.
  const [meshStats, setMeshStats] = useState(null);
  // Slice 453 — current animation frame display.
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    let lastSel = 0;
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        const vp = window.__archdiscViewport;
        if (vp && vp.renderer && vp.renderer.info) setCalls(vp.renderer.info.render.calls);
        let n = 0;
        if (window.__archdiscScene) {
          try { window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; }); } catch (_) {}
        }
        setPrimCount(n);
        frames = 0; last = now;
      }
      // Frame cheap to read every tick — int compare gates re-render.
      const f = (window.__studioGetFrame && window.__studioGetFrame()) || 0;
      if (f !== frame) setFrame(f);
      if (now - lastSel >= 1000) {
        lastSel = now;
        const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
        if (!m || !m.geometry || !m.geometry.attributes || !m.geometry.attributes.position) {
          setMeshStats(null);
        } else {
          const v = m.geometry.attributes.position.count;
          const t = m.geometry.index ? Math.floor(m.geometry.index.array.length / 3) : Math.floor(v / 3);
          setMeshStats({ v, t });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frame]);
  return (
    <div className="studio-statusbar" data-studio-v3-statusbar>
      <span data-studio-v3-status="brand"><strong>Studio</strong></span>
      <span data-studio-v3-status="wb" style={{ textTransform: 'capitalize' }}>{wb}</span>
      <span data-studio-v3-status="mode" style={{ textTransform: 'capitalize' }}>{editMode}</span>
      <span data-studio-v3-status="frame" data-studio-v3-frame={frame}>f {frame}</span>
      <ShadingModeIndicator />
      <span data-studio-v3-status="primitives">{primCount} prim</span>
      <SceneTotals />
      <SelectedCount />
      {meshStats && (
        <span data-studio-v3-status="mesh" data-studio-v3-mesh-v={meshStats.v} data-studio-v3-mesh-t={meshStats.t}>
          v {meshStats.v} · t {meshStats.t}
        </span>
      )}
      <span className="studio-statusbar-spacer" />
      <span data-studio-v3-status="fps">{fps} fps</span>
      <FpsSparkline fps={fps} />
      <span data-studio-v3-status="calls">{calls} calls</span>
      <span data-studio-v3-status="units">mm</span>
      <SnapIndicator />
      <UndoDepth />
      <DirtyDot />
      <span data-studio-v3-status="ready"><span className="studio-statusbar-dot" />ready</span>
    </div>
  );
}

// Slice 470 — dirty-state indicator. Watches studio-autosaved (the
// scene was just persisted) + a synthesised dirty signal from common
// mutations. Implementation: poll the scene snapshot every 2s,
// compare to the last persisted snapshot length; if mismatch, mark dirty.
// Slice 480 — status bar shading-mode indicator (click to cycle, same
// as bare Z hotkey). Reads __studioGetShadingMode every second.
function ShadingModeIndicator() {
  const [mode, setMode] = React.useState('solid');
  React.useEffect(() => {
    const read = () => {
      if (window.__studioGetShadingMode) setMode(window.__studioGetShadingMode() || 'solid');
    };
    read();
    const id = setInterval(read, 1000);
    return () => clearInterval(id);
  }, []);
  const cycle = ['wire', 'solid', 'material', 'rendered'];
  const next = cycle[(cycle.indexOf(mode) + 1) % cycle.length];
  return (
    <button
      type="button"
      data-studio-v3-status="shading"
      data-studio-v3-shading-mode={mode}
      onClick={() => {
        if (window.__studioSetShadingMode) window.__studioSetShadingMode(next);
        setMode(next);
      }}
      title={`Shading: ${mode} — click to cycle to ${next} (Z)`}
      style={{
        padding: '0 6px', background: 'transparent', color: 'inherit',
        border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        textTransform: 'capitalize',
      }}
    >· {mode}</button>
  );
}

function SelectedCount() {
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    const read = () => {
      const set = Array.isArray(window.__studioSelectedMeshesSet) ? window.__studioSelectedMeshesSet : [];
      if (set.length > 0) setN(set.length);
      else setN(window.__studioSelectedMesh && window.__studioSelectedMesh() ? 1 : 0);
    };
    const id = setInterval(read, 400);
    read();
    return () => clearInterval(id);
  }, []);
  return (
    <span
      data-studio-v3-status="selected-count"
      data-studio-v3-selected-count={n}
      title={`${n} selected`}
      style={{
        color: n > 0 ? 'var(--studio-accent, #ebecef)' : 'var(--studio-ink-mute, #9aa6b2)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >sel:{n}</span>
  );
}

function SceneTotals() {
  const [tot, setTot] = React.useState({ v: 0, t: 0 });
  React.useEffect(() => {
    const read = () => {
      const s = window.__archdiscScene;
      if (!s) return;
      let v = 0, t = 0;
      try {
        s.traverse((o) => {
          if (!(o.userData && o.userData.archdiscStudioPrimitive)) return;
          const g = o.geometry;
          if (!g || !g.attributes || !g.attributes.position) return;
          v += g.attributes.position.count;
          t += g.index ? Math.floor(g.index.array.length / 3) : Math.floor(g.attributes.position.count / 3);
        });
      } catch (_) {}
      setTot({ v, t });
    };
    const id = setInterval(read, 1500);
    read();
    return () => clearInterval(id);
  }, []);
  const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  return (
    <span
      data-studio-v3-status="scene-totals"
      data-studio-v3-scene-v={tot.v}
      data-studio-v3-scene-t={tot.t}
      title={`Scene totals: ${tot.v} vertices · ${tot.t} triangles`}
      style={{ color: 'var(--studio-ink-mute, #9aa6b2)', fontVariantNumeric: 'tabular-nums' }}
    >Σv {fmt(tot.v)} · Σt {fmt(tot.t)}</span>
  );
}

// Slice 495 — Rolling 60-sample FPS sparkline. Re-uses the StatusBar's
// existing fps state so we don't add another rAF loop; we just buffer.
function FpsSparkline({ fps }) {
  const W = 80, H = 14;
  const N = 60;
  const ref = React.useRef([]);
  const [, force] = React.useState(0);
  React.useEffect(() => {
    if (fps == null) return;
    const arr = ref.current;
    arr.push(fps);
    if (arr.length > N) arr.splice(0, arr.length - N);
    force((n) => n + 1);
  }, [fps]);
  const arr = ref.current;
  let path = '';
  if (arr.length > 1) {
    const max = Math.max(60, ...arr); // cap baseline at 60 fps for shape
    const step = W / (N - 1);
    for (let i = 0; i < arr.length; i++) {
      const x = i * step;
      const y = H - (arr[i] / max) * H;
      path += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
    }
  }
  return (
    <span
      data-studio-v3-status="fps-spark"
      data-studio-v3-spark-samples={arr.length}
      title={`FPS samples: ${arr.length} · last ${fps}`}
      style={{ display: 'inline-flex', alignItems: 'center' }}
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <path d={path} fill="none" stroke="var(--studio-accent, #ebecef)" strokeWidth="1" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function SnapIndicator() {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    const read = () => {
      const fn = window.__studioGetSnap;
      if (typeof fn === 'function') setOn(!!fn().on);
    };
    const ev = (e) => { if (e && e.detail) setOn(!!e.detail.snap); };
    window.addEventListener('studio-snap-toggle', ev);
    const id = setInterval(read, 500);
    read();
    return () => { window.removeEventListener('studio-snap-toggle', ev); clearInterval(id); };
  }, []);
  return (
    <span
      data-studio-v3-status="snap"
      data-studio-v3-snap-on={on ? 'true' : 'false'}
      title={`Transform snap ${on ? 'ON' : 'OFF'} — Shift+; to toggle`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        color: on ? 'var(--studio-accent, #ebecef)' : 'var(--studio-ink-mute, #9aa6b2)',
      }}
    >snap:{on ? 'on' : 'off'}</span>
  );
}

function UndoDepth() {
  const [depth, setDepth] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => {
      const fn = window.__studioUndoStackLen;
      if (typeof fn === 'function') setDepth(fn() | 0);
    }, 500);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      data-studio-v3-status="undo-depth"
      data-studio-v3-undo-depth={String(depth)}
      title={`Undo stack: ${depth} step(s) — Cmd+Z to undo`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        color: depth > 0 ? 'var(--studio-accent, #ebecef)' : 'var(--studio-ink-mute, #9aa6b2)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >u:{depth}</span>
  );
}

function DirtyDot() {
  const [dirty, setDirty] = React.useState(false);
  React.useEffect(() => {
    let lastSaved = 0;
    const onSaved = () => { lastSaved = Date.now(); setDirty(false); window.__studioV3Dirty = false; };
    window.addEventListener('studio-autosaved', onSaved);
    const id = setInterval(() => {
      // Anything in the scene + nothing autosaved in the past 30s → dirty.
      const s = window.__archdiscScene;
      if (!s) return;
      let n = 0;
      s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
      if (n > 0 && (Date.now() - lastSaved) > 30_000) {
        setDirty(true);
        window.__studioV3Dirty = true;
      }
    }, 2000);
    return () => {
      window.removeEventListener('studio-autosaved', onSaved);
      clearInterval(id);
    };
  }, []);
  return (
    <span
      data-studio-v3-status="dirty"
      data-studio-v3-dirty={dirty ? 'true' : 'false'}
      title={dirty ? 'Unsaved changes — Cmd+S to save' : 'All changes saved'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        color: dirty ? 'var(--studio-accent, #ebecef)' : 'var(--studio-ink-mute, #9aa6b2)',
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: 3,
        background: dirty ? 'var(--studio-accent, #ebecef)' : 'transparent',
        border: '1px solid ' + (dirty ? 'var(--studio-accent, #ebecef)' : 'var(--studio-ink-mute, #9aa6b2)'),
      }} />
      {dirty ? 'modified' : 'saved'}
    </span>
  );
}

// ─── Archie wiring (slice 948) ────────────────────────────────────────────
// Real call into the local Archie fleet at localhost:8080. Posts an
// OpenAI-compatible /v1/chat/completions request with a per-request
// `adapters` field set to `foundational_studio` per the 2-brain serve
// config in [[archdisc-models-state-2026-06-07]]. The reply is parsed
// for <tool_call> tags conforming to the Studio Tool Registry contract
// from slice 184 ([[archie-fleet-schema]]); each tool call dispatches
// against the V3 surface using DOM clicks on data-studio-v3-* hooks
// (which already wire to React handlers — no setState from here per
// [[feedback-studio-window-api-no-setstate]]).
//
// E2E tests set window.__studioArchieMock = (text) => mockedResponse to
// bypass the real fetch with a deterministic synthetic plan.
const ARCHIE_BASE_URL = 'http://localhost:8080';

// Slice 951 — Studio's V3 discipline ids (model / sculpt / uv / shade /
// animate / render / compose / sim / layout, post-slice-946 redesign)
// map onto the trained-corpus discipline names the studio_v16 LoRAs use.
// The model expects "Active discipline: <trained_name>" in the system
// prompt and the matching adapter at `adapters/archie/studio_v16/<name>`.
const STUDIO_TO_TRAINED_DISCIPLINE = {
  // Canonical 9 (post-slice-946 redesign)
  model:   'modeling',
  sculpt:  'sculpting',
  uv:      'uv-texture',
  shade:   'uv-texture',
  animate: 'animation',
  render:  'rendering',
  compose: 'compositing',
  sim:     'vfx-sim',
  layout:  'modeling',
  // Legacy folded disciplines kept reachable so any code still firing on
  // the old ids resolves to a sensible adapter.
  paint:  'uv-texture',
  rig:    'rigging',
  fx:     'vfx-sim',
  world:  'modeling',
  nurbs:  'modeling',
  phys:   'vfx-sim',
  audio:  'compositing',
  xr:     'modeling',
  script: 'modeling',
  archie: 'modeling',
};

function _archieAdapterPath(activeWb) {
  const d = STUDIO_TO_TRAINED_DISCIPLINE[activeWb] || 'modeling';
  return `adapters/archie/studio_v16/${d}`;
}

// The EXACT system prompt template the foundational + studio_v16 LoRAs
// were trained against. Verbatim from data/studio/*/train.jsonl (one
// sample inspected on 2026-06-07). The model emits garbage if any of:
// the identity paragraph, the rule block (R1-R6), the literal
// "Output: <think>...</think>..." line, the Active-discipline line, or
// the <tools>...</tools> JSON catalogue is missing or shape-different.
function _buildArchieSystemPrompt(activeWb) {
  const trainedDisc = STUDIO_TO_TRAINED_DISCIPLINE[activeWb] || 'modeling';
  let toolsArr = [];
  try {
    toolsArr = _toolsForDiscipline(trainedDisc).map((t) => ({
      name:        t.id,
      description: t.description,
      exec_type:   t.exec && t.exec.type,
    }));
  } catch (_) { toolsArr = []; }
  // Tool serialization mirrors the training data shape: JSON array on a
  // single line, double-quoted keys, no trailing whitespace.
  const toolsJson = JSON.stringify(toolsArr);
  return (
    "You are Archie, the autonomous build engine for ArchDisc Studio and ArchDisc Mech.\n\n"
    + "Mission: enable PRECISE DESIGN, PREDICTIVE SIMULATION, and AUTOMATED MANUFACTURING within a unified digital workflow that spans 3D content (Studio) and mechanical CAD/CAM/CAE (Mech). Take a natural-language project request and emit a plan the PlanExecutor can dispatch step-by-step, building every component from scratch via the platform's primitives. You interact with the platform exactly the way a human user would — clicking discipline tabs, spawning primitives, applying ribbon actions, typing knob values.\n\n"
    + "Three responsibilities, every plan: (1) Precision — dimensions/materials/tolerances from published standards (R7). (2) Predictive simulation — surface Simulate-tab analyses (Linear Static, Modal, Thermal, Fatigue) for any load-bearing/heat-shedding/dynamic claim. (3) Automated manufacturing — surface Manufacture-tab steps (CAM, GD&T, Ra spec) with real cutting parameters when the part is shippable. Applies to Studio too: even a stylised prop respects real proportions.\n\n"
    + "Strict rules — non-negotiable:\n"
    + "  R1. Every tool_call.name MUST exist in the <tools> block. Never invent ids.\n"
    + "  R2. Switch to the correct discipline tab BEFORE invoking any discipline-specific action.\n"
    + "  R3. Every component is built from scratch. No pre-built imports, no precalculated geometry.\n"
    + "  R4. Plans for 10k-300k-component projects MUST use pattern/array primitives and hierarchical decomposition.\n"
    + "  R5. Coherent geometry only: scale > 0, valid normals, closed manifolds, G0/G1/G2 continuity preserved.\n"
    + "  R6. If a request cannot be satisfied with the available tools, emit a single <clarify> block.\n\n"
    + "Output: <think>...</think>\\n<plan>{goal,scene,bodies,expect}</plan>\\n<tool_call>...</tool_call>...\n\n"
    + `Active discipline: ${trainedDisc}\n\n`
    + `<tools>\n${toolsJson}\n</tools>`
  );
}

function _unwrapThink(text) {
  if (!text || typeof text !== 'string') return text;
  const closeIdx = text.search(/<\/think>/i);
  if (closeIdx >= 0) {
    const after = text.slice(closeIdx).replace(/^<\/think>\s*/i, '');
    if (after && /(<plan>|<tool_call>|<clarify>)/i.test(after)) return after;
  }
  const openIdx = text.search(/<think>/i);
  if (openIdx >= 0) {
    return text.replace(/<think>/gi, '').replace(/<\/think>/gi, '');
  }
  return text;
}

function _extractToolCalls(unwrapped) {
  const calls = [];
  const src = String(unwrapped || '');
  for (const m of src.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/gi)) {
    try {
      const obj = JSON.parse(m[1].trim());
      if (obj && typeof obj.name === 'string') calls.push(obj);
    } catch (_) { /* drop malformed tags */ }
  }
  return calls;
}

// Slice 951 — When the model emits a <plan> block but no <tool_call>
// tags, synthesize dispatchable calls from the plan structure. Mirrors
// PlannerProviders.archie._synthFromPlan but inlined so the wiring is
// self-contained. The model's training format is:
//   <plan>{"goal":...,"scene":{...,"discipline":"<name>"},
//          "bodies":[{"prim":"cube","transform":{...},
//                     "ops":["extrude"],
//                     "material":{...}}],
//          "expect":{...}}</plan>
function _extractPlan(unwrapped) {
  const src = String(unwrapped || '');
  const planMatch = src.match(/<plan>\s*([\s\S]*?)\s*<\/plan>/i);
  if (planMatch) {
    try { return JSON.parse(planMatch[1].trim()); } catch (_) {}
  }
  // Fallback: a bare {"goal":...} object embedded in the text.
  const jStart = src.indexOf('{"goal"');
  if (jStart >= 0) {
    let depth = 0;
    for (let i = jStart; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(src.slice(jStart, i + 1)); } catch (_) { break; }
        }
      }
    }
  }
  return null;
}

function _synthFromPlan(plan, activeWb) {
  const calls = [];
  if (!plan) return calls;
  const disc = (plan.scene && plan.scene.discipline)
    || STUDIO_TO_TRAINED_DISCIPLINE[activeWb]
    || 'modeling';
  calls.push({ name: 'click-discipline', arguments: { id: disc } });
  const bodies = Array.isArray(plan.bodies) ? plan.bodies : [];
  for (const body of bodies) {
    const prim = body && (body.prim || body.primitive);
    if (!prim) continue;
    calls.push({ name: 'click-primitive', arguments: { id: prim } });
    if (Array.isArray(body.ops)) {
      for (const op of body.ops) calls.push({ name: 'click-action', arguments: { id: op } });
    }
  }
  return calls;
}

// Slice 951l — humanize the raw model reply for chat display. The user
// asked for the overlay to read naturally instead of dumping XML-ish
// <plan> / <tool_call> tags. When calls ARE dispatched, we lead with
// a natural summary of what just happened (the user cares about what
// got built, not what the model rambled) and only fall back to the
// stripped prose when no dispatch landed. The dispatch itself runs
// against the raw output; this only changes the chat-window text.
function _humanizeReply(rawReply, dispatchedCalls) {
  // When dispatch produced calls, the truthful answer is "here's what I
  // just did". That reads as a natural assistant turn ("Switched to
  // Modeling, added a cube and four cylinders.") regardless of how
  // disjointed the underlying model prose was.
  if (Array.isArray(dispatchedCalls) && dispatchedCalls.length > 0) {
    const summary = _summariseDispatch(dispatchedCalls);
    if (summary) return summary;
  }
  let s = String(rawReply || '').trim();
  // 1. Drop protocol envelopes — <think>, <plan>, <tool_call>, <clarify>
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  s = s.replace(/<plan>[\s\S]*?<\/plan>/gi, '');
  s = s.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
  s = s.replace(/<clarify>[\s\S]*?<\/clarify>/gi, '');
  // 2. Drop "Step-by-Step" and "Final Plan" markdown headers — they
  //    bleed protocol energy into the chat window.
  s = s.replace(/^[#*\-_\s]*step[- ]?by[- ]?step[\s\S]*?$/gim, '');
  s = s.replace(/^[#*\-_\s]*final plan[\s\S]*?$/gim, '');
  // 3. Collapse remaining markdown bullets / numbered lists / bold into
  //    plain text — one bullet per sentence.
  s = s.replace(/^\s*[*\-+•]\s+/gm, '');
  s = s.replace(/^\s*\d+[.)]\s+/gm, '');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/_([^_\n]+)_/g, '$1');
  s = s.replace(/`([^`\n]+)`/g, '$1');
  // 4. Squash whitespace.
  s = s.replace(/[\t ]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  // 5. If nothing useful remains, synthesise a friendly line from the
  //    dispatched calls so the chat window never reads as silent or
  //    fragmentary.
  if (!s || s.length < 12) {
    const summary = _summariseDispatch(dispatchedCalls);
    return summary || 'On it.';
  }
  // 6. Cap length — long prose reads as a wall.
  if (s.length > 500) s = s.slice(0, 500).replace(/\s+\S*$/, '') + '…';
  return s;
}

// Helper: turn a list of tool calls into a one-line natural summary
// (e.g. "Switched to Modeling, spawned a cube and 4 cylinders.").
const _PRIMITIVE_LABEL = {
  cube: 'cube', sphere: 'sphere', plane: 'plane', cylinder: 'cylinder',
  cone: 'cone', torus: 'torus', icosahedron: 'icosahedron',
  text: 'text body', curve: 'curve', empty: 'empty group',
};
function _summariseDispatch(calls) {
  if (!Array.isArray(calls) || calls.length === 0) return '';
  const primCount = {};
  let discipline = null;
  const actions = [];
  for (const c of calls) {
    const name = (c && c.name) || '';
    const id = (c && c.arguments && c.arguments.id) || '';
    if (name === 'click-discipline' && id) discipline = id.replace('-', ' ');
    else if (name === 'click-primitive' && id) primCount[id] = (primCount[id] || 0) + 1;
    else if (name === 'click-action' && id) actions.push(id.replace(/-/g, ' '));
  }
  const parts = [];
  if (discipline) parts.push(`Switched to the ${discipline} discipline`);
  for (const id of Object.keys(primCount)) {
    const n = primCount[id];
    const label = _PRIMITIVE_LABEL[id] || id;
    parts.push(n === 1 ? `spawned a ${label}` : `spawned ${n} ${label}s`);
  }
  for (const a of actions.slice(0, 3)) parts.push(`applied ${a}`);
  if (parts.length === 0) return '';
  // Capitalise the first letter; join with ", " + a final " and ".
  const head = parts[0][0].toUpperCase() + parts[0].slice(1);
  if (parts.length === 1) return head + '.';
  const last = parts[parts.length - 1];
  const middle = parts.slice(1, -1).join(', ');
  return middle
    ? `${head}, ${middle}, and ${last}.`
    : `${head} and ${last}.`;
}

// Natural label for a tool message in the chat window. Was raw
// `click-primitive({"id":"cube"}) → spawn cube`; now reads "Added a
// cube." / "Switched to the modeling discipline." per the user's
// "make output natural" request.
function _humanizeCall(call, result) {
  const name = (call && call.name) || '';
  const args = (call && call.arguments) || {};
  const id = args.id || '';
  const ok = result && result.ok;
  if (!ok) {
    return `Couldn't ${name.replace(/-/g, ' ')}${id ? ` "${id}"` : ''}${result && result.summary ? ' — ' + result.summary : ''}.`;
  }
  if (name === 'click-discipline') return `Switched to the ${id.replace('-', ' ')} discipline.`;
  if (name === 'click-primitive') {
    const label = _PRIMITIVE_LABEL[id] || id;
    return `Added a ${label}.`;
  }
  if (name === 'click-action') return `Applied ${id.replace(/-/g, ' ')}.`;
  if (name === 'set-param') return `Set ${args.group || ''}.${args.knob || ''} = ${JSON.stringify(args.value)}.`;
  if (name === 'fn') return `Called ${args.name || 'op'}.`;
  return `${name}${id ? ' ' + id : ''}.`;
}

// Slice 951j — three-stage dispatch synthesis when the model emits
// prose instead of clean <tool_call> tags. Stages:
//
//   A. _quotedClicksFallback — parse `Click "<id>"` / `click "<id>"`
//      mentions from the model's prose (training examples used quoted
//      tool ids in their step-by-step prose, so the LoRAs keep
//      emitting that shape). Extracts both primitive ids AND
//      discipline names.
//   B. _recipeFallback — composite-shape recipes for common nouns
//      ("coffee table" → top cube + 4 legs; "chair" → seat + back +
//      4 legs; "snowman" → 3 stacked spheres). Lets prompts like
//      "model a beautiful coffee table" actually drive the platform
//      even when neither the model nor the user mention primitive
//      ids by name.
//   C. _keywordFallback — bare primitive-id scan over the user's
//      original prompt (the slice-951b fallback, kept as last resort).
//
// Each stage returns [] if it doesn't recognise anything. onCmdSubmit
// chains them so the first stage that produces ≥1 call wins.

const _PRIMITIVE_IDS = [
  'cube','sphere','plane','cylinder','cone','torus','icosahedron','text','curve','empty',
];
// Common noun → primitive id. Tracks the way users describe parts of
// composite shapes (a "leg" is a cylinder, a "top" is a cube, etc.)
// so the recipe + keyword stages can map mentions to real primitives.
const _NOUN_TO_PRIMITIVE = {
  ball: 'sphere', orb: 'sphere', head: 'sphere',
  block: 'cube', box: 'cube', body: 'cube', slab: 'cube', top: 'cube',
  leg: 'cylinder', post: 'cylinder', shaft: 'cylinder', trunk: 'cylinder',
  pillar: 'cylinder', column: 'cylinder', pedestal: 'cylinder',
  pipe: 'cylinder', rod: 'cylinder', stem: 'cylinder',
  roof: 'cone', spike: 'cone', tip: 'cone', nose: 'cone', tip: 'cone',
  ring: 'torus', donut: 'torus', collar: 'torus',
  ground: 'plane', floor: 'plane', wall: 'plane', surface: 'plane',
  panel: 'plane', sheet: 'plane',
  rock: 'icosahedron', crystal: 'icosahedron', gem: 'icosahedron',
};
const _DISCIPLINE_IDS = new Set([
  'model','modeling','sculpt','sculpting','uv','uv-texture','shade','animate',
  'animation','rig','rigging','render','rendering','compose','compositing',
  'sim','vfx-sim','layout',
]);

function _quotedClicksFallback(reply) {
  if (!reply) return [];
  const src = String(reply);
  const calls = [];
  // Match: Click "<id>"  /  click "<id>"  /  Click '<id>'
  const re = /\bclick(?:ing)?\s+["'`]([a-z0-9_\-:]+)["'`]/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    const raw = m[1].toLowerCase().trim();
    // Strip namespace prefixes the trained corpus uses
    // (e.g. "discipline:modeling" → "modeling").
    const bare = raw.includes(':') ? raw.split(':').pop() : raw;
    if (_DISCIPLINE_IDS.has(bare)) {
      calls.push({ name: 'click-discipline', arguments: { id: bare } });
    } else if (_PRIMITIVE_IDS.includes(bare)) {
      calls.push({ name: 'click-primitive', arguments: { id: bare } });
    } else if (_NOUN_TO_PRIMITIVE[bare]) {
      calls.push({ name: 'click-primitive', arguments: { id: _NOUN_TO_PRIMITIVE[bare] } });
    }
    // Other tokens (e.g. "material-editor") aren't dispatchable here;
    // dropped silently so they don't poison the call list.
  }
  return calls;
}

// Slice 951k — composite-shape recipes REMOVED per user feedback:
//   "wait a sec have you hard coded these prompts? to make shapes,
//   meshes, primitives? i dont want that. i want Archie to be
//   imaginative and dynamic and create in the same level as 20 year
//   old 3d designer veteran"
//
// The hardcoded `_RECIPES` table was a lookup not an AI — every "coffee
// table" produced an identical top + 4 legs, regardless of style or
// context. The platform should be driven by the model's actual creative
// plan, not by client-side templating. We keep the parsers that
// EXTRACT structure from whatever the model emits (tool_call tags,
// JSON plan, quoted clicks in prose, primitive keywords in either
// user prompt or reply) but stop substituting hardcoded compositions
// for the model's missing imagination.
//
// The real fix is upstream — better LoRA fluency on the trained
// <plan>/<tool_call> format, richer training data covering creative
// composition + ops + materials, and ideally migrating to a proper
// tool-use API so the model picks from a schema instead of producing
// free-form tags. Until those land, requests the LoRA can't articulate
// fall through to the conversational message asking the user to name
// the parts — that's an honest failure, not a templated one.

// Last-resort keyword scan: any primitive id mentioned in either the
// user prompt OR the model reply. Now also handles common-noun aliases
// so "make a ball" spawns a sphere, "give me a leg" spawns a cylinder,
// etc.
function _keywordFallback(userText, reply) {
  const src = String((userText || '') + ' ' + (reply || '')).toLowerCase();
  const calls = [];
  const seen = new Set();
  // Primitive ids first (most specific).
  for (const id of _PRIMITIVE_IDS) {
    const re = new RegExp(`\\b${id}\\b`, 'i');
    if (re.test(src) && !seen.has(id)) {
      calls.push({ name: 'click-primitive', arguments: { id } });
      seen.add(id);
    }
  }
  // Then noun aliases the user might have used instead of a real id.
  for (const noun of Object.keys(_NOUN_TO_PRIMITIVE)) {
    const id = _NOUN_TO_PRIMITIVE[noun];
    if (seen.has(id)) continue;
    const re = new RegExp(`\\b${noun}\\b`, 'i');
    if (re.test(src)) {
      calls.push({ name: 'click-primitive', arguments: { id } });
      seen.add(id);
    }
  }
  return calls;
}

// Slice 951o — second-pass decomposer. When the first model call
// produces 0 dispatchable tool_calls (typical for complex prompts like
// "build a coffee table" — the LoRA emits prose with fake primitive
// names), fire a SECOND call with a tight, focused prompt that asks
// the model to decompose the user's request into a flat list of
// registered primitive ids. The model still does the decomposition —
// no client-side noun→primitive lookup. The second call uses a fresh
// minimal system prompt to bypass the "step-by-step explanation"
// prior that hijacks the first call.
async function _runDecomposerPass(userText) {
  if (typeof window !== 'undefined' && typeof window.__studioArchieMock === 'function') {
    return [];  // Mocks bypass the decomposer
  }
  const primIds = ['cube','sphere','plane','cylinder','cone','torus','icosahedron','text','curve'];
  const sys =
    'You are a 3D-modeling primitive decomposer. The user describes an object; you list which Studio primitives compose it.\n\n'
    + 'Available primitive ids (use ONLY these): ' + primIds.join(', ') + '\n\n'
    + 'Reply with ONLY a single JSON array of primitive ids in build order. No prose, no markdown, no explanation.\n\n'
    + 'Format: ["<id>", "<id>", "<id>"]\n\n'
    + 'Examples:\n'
    + '  "snowman" -> ["sphere", "sphere", "sphere"]\n'
    + '  "umbrella" -> ["cone", "cylinder"]\n'
    + '  "candle" -> ["cylinder", "cone"]';
  const body = {
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: userText },
    ],
    // Slice 951p — R1-distill emits its full chain of thought into the
    // `reasoning` field BEFORE producing `content`. 200 max_tokens cut
    // off mid-thought so content came back empty. Verified at runtime:
    // "coffee table" needs ~440 completion tokens (390 reasoning + 50
    // content). 1500 gives headroom for complex prompts ("forest with
    // 25 assets" reasons longer) without making the UI hang.
    max_tokens: 1500,
    temperature: 0.1,
  };
  const ac = new AbortController();
  const tmo = setTimeout(() => ac.abort(), 90_000);
  try {
    const res = await fetch(`${ARCHIE_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) return [];
    const json = await res.json();
    const m = json && json.choices && json.choices[0] && json.choices[0].message;
    // Slice 951p — prefer message.content (the model's final answer)
    // over message.reasoning (the chain of thought, which often
    // contains candidate arrays the model rejected). Live verified:
    // 'small house' reasoning had [cone, cylinder] as a candidate but
    // content had [cube, cube, cone, cube] — the parser was picking
    // the reasoning candidate. Now content's the priority; we look
    // for the LAST array in content (the final answer after any
    // revision), and only fall back to reasoning if content is empty.
    const content = (m && m.content) || '';
    const reasoning = (m && m.reasoning) || '';
    let arrayMatch = null;
    // All array matches in content, take the last (final answer).
    const contentMatches = [...content.matchAll(/\[[\s\S]*?\]/g)];
    if (contentMatches.length > 0) arrayMatch = contentMatches[contentMatches.length - 1];
    if (!arrayMatch) {
      const reasoningMatches = [...reasoning.matchAll(/\[[\s\S]*?\]/g)];
      if (reasoningMatches.length > 0) arrayMatch = reasoningMatches[reasoningMatches.length - 1];
    }
    if (!arrayMatch) return [];
    let arr;
    try { arr = JSON.parse(arrayMatch[0]); } catch (_) { return []; }
    if (!Array.isArray(arr)) return [];
    const calls = [];
    for (const id of arr) {
      const norm = String(id || '').trim().toLowerCase();
      if (primIds.includes(norm)) {
        calls.push({ name: 'click-primitive', arguments: { id: norm } });
      }
    }
    return calls;
  } catch (_) {
    return [];
  } finally {
    clearTimeout(tmo);
  }
}

async function runArchie(text, activeWb, opts = {}) {
  // Slice 951s — optional streaming. If the caller passes onToken, we
  // request SSE from mlx_lm.server, parse each delta as it arrives, and
  // call onToken({ delta_content, delta_reasoning, acc }) so the UI can
  // render tokens in real time. Without onToken we keep the legacy
  // single-shot path so existing callers/tests are unchanged.
  const onToken = typeof opts.onToken === 'function' ? opts.onToken : null;
  if (typeof window !== 'undefined' && typeof window.__studioArchieMock === 'function') {
    const fake = await Promise.resolve(window.__studioArchieMock(text));
    return _unwrapThink(String(fake || ''));
  }
  // Slice 951q — viewport perception. Capture the live canvas, caption it
  // via the local VL server, and prepend the caption to the user message
  // as <viewport_state>. Bounded by a short timeout: a slow VL response
  // must not stall the chat dispatch, so we cap at 4 s and fall through to
  // a blind run if vision is down. An explicit window opt-out
  // (window.__studioArchieVisionOff) lets tests pin the legacy path.
  let _viewportCaption = '';
  if (typeof window !== 'undefined' && !window.__studioArchieVisionOff) {
    const _vp = window.__archdiscViewport;
    const _canvas = _vp && _vp.renderer && _vp.renderer.domElement;
    if (_canvas && typeof _canvas.toBlob === 'function') {
      // Three.js WebGLRenderer defaults to preserveDrawingBuffer=false, so
      // a stale framebuffer read returns a blank PNG. Force a synchronous
      // render of the live scene + camera immediately before toBlob so
      // the VL server sees the actual viewport, not garbage.
      try {
        if (_vp.scene && _vp.camera && _vp.renderer && _vp.renderer.render) {
          _vp.renderer.render(_vp.scene, _vp.camera);
        }
      } catch (_) { /* render hint best-effort */ }
      const _visionAc = new AbortController();
      const _visionTmo = setTimeout(() => _visionAc.abort(), 4000);
      try {
        _viewportCaption = await _captureAndCaption({ canvas: _canvas, signal: _visionAc.signal });
      } catch (_) { /* vision optional — silent */ }
      finally { clearTimeout(_visionTmo); }
    }
  }
  // Slice 951r — recall prior turns from the long-session memory store.
  // Bounded by the helper's own timeout so a slow recall doesn't stall
  // the chat dispatch. Order matters: priors first (background), then
  // viewport state (what's on screen NOW), then the user's new prompt.
  let _priorContext = '';
  try { _priorContext = await _recallPriorTurns(text, { app: 'studio' }); }
  catch (_) { /* memory optional */ }
  const _userContent = [
    _priorContext,
    _viewportCaption ? `<viewport_state>${_viewportCaption}</viewport_state>` : '',
    text,
  ].filter(Boolean).join('\n\n');
  const url = `${ARCHIE_BASE_URL}/v1/chat/completions`;
  // Slice 951m — one-shot format anchor. The base R1-distill model's
  // "Step-by-Step Explanation" prior overpowers the LoRA's trained
  // <tool_call> emission even with the verbatim training system prompt:
  // probes show <plan> tags but zero <tool_call> tags for environment-
  // scale prompts. One in-context assistant turn showing the EXACT
  // protocol shape (think → plan JSON → tool_call series, no prose
  // outside the tags) is enough to lock format induction without
  // teaching specific shapes. The example uses a single-primitive
  // request so it can't accidentally template a complex build — the
  // model has to generalise from format only.
  const body = {
    messages: [
      { role: 'system', content: _buildArchieSystemPrompt(activeWb) },
      { role: 'user',   content: 'sanity check — spawn one cube' },
      { role: 'assistant', content: '<think>Single primitive. Switch discipline first.</think>\n<plan>{"goal":"sanity check","scene":{"app":"studio","discipline":"modeling"},"expect":{"bodies":1}}</plan>\n<tool_call>{"name":"click-discipline","arguments":{"id":"modeling"}}</tool_call>\n<tool_call>{"name":"click-primitive","arguments":{"id":"cube"}}</tool_call>' },
      { role: 'user',   content: _userContent },
    ],
    // DeepSeek-R1 distill emits a thinking block first (<think>…</think>)
    // before the <plan>/<tool_call> tags. 8/64 token budgets cut off
    // mid-thought so the content field came back empty. 768 covers a
    // realistic Studio plan with a brief thought + a handful of
    // tool_calls in series.
    max_tokens: 768,
    temperature: 0.15,
    // Slice 951 — discipline-aware LoRA routing per
    // [[archdisc-models-state-2026-06-07]]'s 2-brain serve config. The
    // studio_v16 adapters are the per-discipline LoRAs trained on
    // data/studio/<disc>/train.jsonl; each one is fluent in its
    // discipline's tool catalogue. Falls back to modeling for any
    // unmapped active discipline.
    adapters: _archieAdapterPath(activeWb),
    stream: !!onToken,
  };
  const ac = new AbortController();
  // 60 s timeout: first-call model load + 768-token generation can take
  // ~25-45 s; 60 s gives headroom without hanging the UI forever.
  const tmo = setTimeout(() => ac.abort(), 60_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Archie ${res.status}: ${t.slice(0, 200)}`);
    }
    // Slice 951s — streaming path. mlx_lm.server emits OpenAI-compat
    // SSE: each line `data: {json}\n` with a final `data: [DONE]`.
    // We accumulate content + reasoning into the same {reasoning,
    // content} shape the legacy path returns so _unwrapThink and the
    // downstream tag extractor handle both branches identically.
    let json;
    if (onToken) {
      let accReason = '';
      let accContent = '';
      const reader = res.body && typeof res.body.getReader === 'function'
        ? res.body.getReader() : null;
      if (!reader) {
        // Defensive: response body unreadable. Fall through to non-stream parse.
        json = await res.json();
      } else {
        const decoder = new TextDecoder('utf-8');
        let buf = '';
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line || !line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            let chunk;
            try { chunk = JSON.parse(payload); } catch (_) { continue; }
            const delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
            if (!delta) continue;
            const dReason  = typeof delta.reasoning === 'string' ? delta.reasoning : '';
            const dContent = typeof delta.content   === 'string' ? delta.content   : '';
            if (dReason)  accReason  += dReason;
            if (dContent) accContent += dContent;
            try { onToken({ delta_content: dContent, delta_reasoning: dReason, acc_content: accContent, acc_reasoning: accReason }); }
            catch (_) { /* downstream UI errors must not stop the stream */ }
          }
        }
        json = { choices: [{ message: { reasoning: accReason, content: accContent } }] };
      }
    } else {
      json = await res.json();
    }
    // mlx_lm.server with R1-distill returns either {content: "..."} or
    // {reasoning: "...", content: "..."} depending on how the chat
    // template split the response. Concatenate whichever fields exist
    // so the planner sees the FULL token stream — _unwrapThink + the
    // tag extractor handle the rest.
    const m = json && json.choices && json.choices[0] && json.choices[0].message;
    let raw = '';
    if (m) {
      if (typeof m.reasoning === 'string' && m.reasoning) raw += '<think>' + m.reasoning + '</think>';
      if (typeof m.content === 'string' && m.content) raw += m.content;
    }
    const _final = _unwrapThink(raw);
    // Slice 951r — fire-and-forget remember the turn (user prompt +
    // unwrapped assistant content) so future sessions can recall it.
    // _rememberTurn never awaits — a slow store cannot block the UI.
    _rememberTurn({ app: 'studio', user_text: text, assistant_summary: _final });
    return _final;
  } finally {
    clearTimeout(tmo);
  }
}

// Trained-corpus discipline names map back to Studio's V3 ids so a
// `click-discipline` with id="uv-texture" finds the V3 "uv" tab.
const TRAINED_TO_STUDIO_DISCIPLINE = {
  modeling:    'model',
  sculpting:   'sculpt',
  'uv-texture':'uv',
  rigging:     'animate',  // rig tools surface inside the Animate tab
  animation:   'animate',
  'vfx-sim':   'sim',
  rendering:   'render',
  compositing: 'compose',
};

async function executeToolCall(call) {
  const name = String(call && call.name || '').toLowerCase();
  const args = (call && call.arguments) || {};
  if (name === 'click-discipline') {
    const rawId = String(args.id || '');
    // Accept BOTH the V3 short id ("model") and the trained-corpus long
    // id ("modeling") — Archie was trained to emit the long form.
    const id = TRAINED_TO_STUDIO_DISCIPLINE[rawId] || rawId;
    const el = document.querySelector(`[data-studio-v3-wb="${id}"]`);
    if (!el) return { ok: false, summary: `unknown discipline "${rawId}"` };
    el.click();
    return { ok: true, summary: `switched to ${id}` };
  }
  if (name === 'click-primitive') {
    const id = String(args.id || '');
    const el = document.querySelector(`[data-studio-v3-tool="${id}"][data-studio-v3-tool-group="add"]`);
    if (el) { el.click(); return { ok: true, summary: `spawn ${id}` }; }
    // Fallback: spawn directly via the slice 457 helper (covers scenes
    // not in the Model discipline).
    const scene = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    if (scene && typeof window.__spawnPrimitive === 'function') {
      window.__spawnPrimitive(id, scene);
      return { ok: true, summary: `spawn ${id} (direct)` };
    }
    return { ok: false, summary: `no add-button for "${id}"` };
  }
  if (name === 'click-action') {
    const id = String(args.id || '');
    const el = document.querySelector(`[data-studio-v3-tool="${id}"]`);
    if (!el) return { ok: false, summary: `unknown action "${id}"` };
    el.click();
    return { ok: true, summary: `action ${id}` };
  }
  if (name === 'fn') {
    const fname = String(args.name || '');
    const fargs = Array.isArray(args.args) ? args.args : [];
    const fn = typeof window !== 'undefined' ? window[fname] : undefined;
    if (typeof fn !== 'function') return { ok: false, summary: `no window.${fname}` };
    try {
      const r = fn(...fargs);
      return { ok: true, summary: `${fname}(${fargs.map((a) => JSON.stringify(a)).join(', ')}) → ${JSON.stringify(r)}` };
    } catch (err) {
      return { ok: false, summary: `${fname} threw: ${String(err && err.message || err)}` };
    }
  }
  if (name === 'set-param') {
    const group = String(args.group || '');
    const knob  = String(args.knob  || '');
    const value = args.value;
    // Studio's V2 surface persists knob state via `data-studio-<group>`
    // attributes on a single element; the V3 ribbon mirrors that. We
    // mutate the attribute and dispatch a synthetic CustomEvent so any
    // listener (the active tool's React onChange, the ops layer) can
    // react without us reaching into setState.
    const el = document.querySelector(`[data-studio-${group}]`);
    if (!el) return { ok: false, summary: `no [data-studio-${group}]` };
    el.setAttribute(`data-studio-${group}`, knob);
    el.dispatchEvent(new CustomEvent('studio-set-param', { detail: { group, knob, value } }));
    return { ok: true, summary: `${group}/${knob} = ${JSON.stringify(value)}` };
  }
  return { ok: false, summary: `unknown tool "${name}"` };
}

// ─── CommandBar (always-on Archie input) ──────────────────────────────────
// Slice 398 — direct-call mode: any cmdbar string that matches the shape
// `studioFoo arg1 arg2 ...` (V2 window-API style) invokes the matching
// window.__studioFoo(...args) with JSON-parsed numeric / boolean / array
// args, and pushes the result back into the dock as a tool message. NL
// queries fall through to the (future) Archie router. This is how "no
// V2 capability is missed" stays provable — the user can hit any of
// V2's 206 APIs by typing the name.
function callDirectIfPossible(input) {
  const m = input.match(/^\s*(?:\/)?(studio[A-Za-z]+)\s*(.*)$/);
  if (!m) return null;
  const fname = '__' + m[1];
  const fn = window[fname];
  if (typeof fn !== 'function') return { ok: false, fname, error: `${fname} is not a function` };
  const rest = m[2].trim();
  let args = [];
  if (rest.length) {
    try {
      args = JSON.parse(`[${rest}]`);
    } catch (_) {
      args = rest.split(/\s+/).map((s) => {
        const n = Number(s);
        if (!Number.isNaN(n) && s.trim() !== '') return n;
        if (s === 'true') return true;
        if (s === 'false') return false;
        if (s === 'null') return null;
        return s;
      });
    }
  }
  try {
    const result = fn(...args);
    return { ok: true, fname, args, result };
  } catch (err) {
    return { ok: false, fname, args, error: String(err) };
  }
}

// ─── CommandBar (slice 947) ───────────────────────────────────────────────
// Footer Archie console strip. Always-on; focus/submit/Cmd+K all open
// the floating ArchieChatOverlay so the user has a single mental model:
// the cmdbar is the write surface, the overlay is the read surface.
// A small thread-count chip surfaces when there's a conversation but
// the overlay is closed, so the user can re-open with one click.
function CommandBar({ onSubmit, archieOpen, onOpen, threadCount }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
        onOpen && onOpen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpen]);
  return (
    <div className="studio-cmdbar" data-studio-v3-cmdbar>
      <span className="studio-cmdbar-glyph" title="Archie">◐</span>
      <input
        ref={ref}
        className="studio-cmdbar-input"
        data-studio-v3-cmdbar-input
        placeholder="Ask Archie — or type a Studio API: studioListSceneStats / studioExtrudeSelectedFaces 0.005"
        onFocus={() => onOpen && onOpen()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.currentTarget.value.trim()) {
            const v = e.currentTarget.value.trim();
            e.currentTarget.value = '';
            onSubmit && onSubmit(v);
            onOpen && onOpen();
          }
        }}
      />
      {threadCount > 0 && !archieOpen && (
        <button
          type="button"
          className="studio-cmdbar-chip"
          data-studio-v3-cmdbar-chip
          onClick={() => onOpen && onOpen()}
          title={`${threadCount} message${threadCount === 1 ? '' : 's'} in Archie thread — click to open`}
        >
          {threadCount} <span style={{ opacity: 0.55, marginLeft: 4 }}>▴</span>
        </button>
      )}
      <span className="studio-cmdbar-hint">
        {archieOpen ? <kbd>ESC</kbd> : <kbd>⌘K</kbd>}
      </span>
    </div>
  );
}

// ─── ArchieChatOverlay (slice 947) ────────────────────────────────────────
// Replaces the slice-407 inline `ArchieThread` strip with a proper
// floating chat window anchored to the bottom-right of the shell. Stays
// hidden until the user opens it (cmdbar focus / submit / Cmd+K / chip
// click). Closes on Esc / X / the cmdbar's own toggle.
//
// The overlay is read-only — composing happens in the cmdbar — so it
// never steals focus from the active tool. Messages auto-scroll to the
// latest entry. Three roles render with distinct hairline-left tones
// (user / archie / tool) so the conversation reads even in pure
// monochrome.
function ArchieChatOverlay({ open, expanded, thread, onClose, onToggleExpanded, onClear }) {
  const bodyRef = useRef(null);
  useEffect(() => {
    if (open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [thread, open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Don't poach Esc when a modal / menu / editor that owns Esc is
      // active. Close only when Esc isn't going to do something useful
      // elsewhere (no text-input focus inside a modal, no menu open).
      const ae = document.activeElement;
      const inCmd = ae && ae.closest && (
        ae.closest('[data-studio-v3-cmdbar]') ||
        ae.closest('[data-studio-v3-archie-overlay]')
      );
      const elsewhere = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable) && !inCmd;
      if (elsewhere) return;
      e.preventDefault();
      onClose && onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className={`studio-archie-overlay${expanded ? ' studio-archie-overlay-expanded' : ''}`}
      data-studio-v3-archie-overlay
      data-archie-expanded={expanded ? 'true' : 'false'}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <header className="studio-archie-overlay-head">
        <span className="studio-archie-overlay-glyph" aria-hidden="true">◐</span>
        <span className="studio-archie-overlay-title">Archie</span>
        <span className="studio-archie-overlay-count" data-studio-v3-archie-count>{thread.length}</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="studio-archie-overlay-btn"
          data-studio-v3-archie-clear
          onClick={onClear}
          title="Clear thread"
        ><Icon name="clear" size={12} /></button>
        <button
          type="button"
          className="studio-archie-overlay-btn"
          data-studio-v3-archie-expand
          onClick={onToggleExpanded}
          title={expanded ? 'Collapse' : 'Expand'}
        ><Icon name={expanded ? 'collapse' : 'expand'} size={12} /></button>
        <button
          type="button"
          className="studio-archie-overlay-btn"
          data-studio-v3-archie-close
          onClick={onClose}
          title="Close (Esc)"
        ><Icon name="close" size={12} /></button>
      </header>
      <div className="studio-archie-overlay-body" data-studio-v3-archie-body ref={bodyRef}>
        {thread.length === 0 ? (
          <div className="studio-archie-overlay-empty" data-studio-v3-archie-empty>
            <div style={{ fontSize: 13, color: 'var(--studio-ink)', marginBottom: 6, fontWeight: 500 }}>
              Drive Studio with words.
            </div>
            <div>
              Try: <code>create a unit cube</code>, <code>frame the scene</code>, or any{' '}
              <code>studioFoo arg</code> direct call.
            </div>
          </div>
        ) : (
          thread.map((m, i) => (
            <div key={i} className="studio-archie-overlay-msg" data-role={m.role} data-studio-v3-archie-msg>
              <span className="studio-archie-overlay-msg-role">{m.role}</span>
              <span className="studio-archie-overlay-msg-text">{m.text}</span>
            </div>
          ))
        )}
      </div>
      <footer className="studio-archie-overlay-foot">
        <span>Compose in the bar below.</span>
        <span>
          <kbd>Esc</kbd> close · <kbd>⌘K</kbd> focus
        </span>
      </footer>
    </div>
  );
}

// ─── Top-level shell ──────────────────────────────────────────────────────
export function StudioShellV3({ mode = 'dark' }) {
  const [theme, setTheme] = useState(() => lstor.get('theme', mode));
  const [activeWb, setActiveWb] = useState(() => lstor.get('wb', 'model'));
  const [activeTool, setActiveTool] = useState('select');
  const [editMode, setEditMode] = useState('object');
  // Slice 523 — Apply the user's accent color on root mount so it's
  // not gated on opening SettingsModal.
  useEffect(() => {
    try {
      const a = window.localStorage.getItem('studio.v3.accent');
      if (a) document.documentElement.style.setProperty('--studio-accent', a);
    } catch (_) {}
  }, []);
  // Slice 426 — Keep React editMode in sync with window.__studioEditModeRef.
  // Without this, programmatic window.__studioSetEditMode() doesn't update
  // the HUD chip / counts badge until the user clicks a chip.
  useEffect(() => {
    const onChange = (ev) => { if (ev && ev.detail && ev.detail.mode) setEditMode(ev.detail.mode); };
    window.addEventListener('studio-edit-mode-changed', onChange);
    return () => window.removeEventListener('studio-edit-mode-changed', onChange);
  }, []);
  const [axis, setAxis] = useState('persp');
  // Slice 396 — selected-object summary surfaced from Viewport3D so the
  // status bar + inspector can read it without owning the raycaster.
  const [selection, setSelection] = useState(null);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [thread, setThread] = useState([]);
  // Slice 947 — Archie chat overlay. The strip stays at the foot
  // (CommandBar), the floating overlay shows the conversation. Auto-
  // opens whenever a message is pushed to the thread so the user sees
  // tool results without hunting for the chip.
  const [archieOpen, setArchieOpen] = useState(false);
  const [archieExpanded, setArchieExpanded] = useState(false);
  // Slice 479 — Presentation mode (clean viewport with overlays hidden).
  const [present, setPresent] = useState(false);
  useEffect(() => {
    const onToggle = () => setPresent((v) => !v);
    const onEsc = (e) => { if (e.key === 'Escape' && present) setPresent(false); };
    window.addEventListener('studio-presentation-toggle', onToggle);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('studio-presentation-toggle', onToggle);
      window.removeEventListener('keydown', onEsc);
    };
  }, [present]);
  // Slice 407 — Archie's side dock removed; thread strip lives above the
  // cmdbar instead, only visible when there are messages. Cmd+/ now
  // focuses the cmdbar input (most useful alias of the old toggle).

  // Slice 401 — register V3's native window.__studio* API surface on
  // mount; unregister on unmount so re-mounts don't leak.
  useEffect(() => {
    registerV3Api();
    registerEditOps();
    registerCameraOps();
    registerModOps();
    registerLightingOps();
    registerAnimPhysOps();
    registerPaintOps();
    registerSurfOps();
    registerAudioXROps();
    registerTerrainVoxOps();
    registerRemeshOps();
    registerScriptOps();
    registerMographOps();
    registerIOOps();
    registerRefSnapOps();
    registerEditAuxOps();
    registerCursorOps();
    registerCameraViewOps();
    registerSelectionOps();
    registerMarkerOps();
    registerUtilOps();
    registerDisplayOps();
    return () => {
      unregisterDisplayOps();
      unregisterUtilOps();
      unregisterMarkerOps();
      unregisterSelectionOps();
      unregisterCameraViewOps();
      unregisterCursorOps();
      unregisterEditAuxOps();
      unregisterRefSnapOps();
      unregisterIOOps();
      unregisterMographOps();
      unregisterScriptOps();
      unregisterRemeshOps();
      unregisterTerrainVoxOps();
      unregisterAudioXROps();
      unregisterSurfOps();
      unregisterPaintOps();
      unregisterAnimPhysOps(); unregisterLightingOps(); unregisterModOps();
      unregisterCameraOps(); unregisterEditOps(); unregisterV3Api();
    };
  }, []);

  // Theme → document attribute so tokens.css applies the right palette.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-studio-theme', theme);
    lstor.set('theme', theme);
  }, [theme]);
  useEffect(() => { lstor.set('wb', activeWb); }, [activeWb]);

  // Mirror edit-mode to the V2 window API so existing e2e specs + the
  // V2 click router keep working while V3 stabilises.
  useEffect(() => {
    if (window.__studioSetEditMode && window.__studioGetEditMode &&
        window.__studioGetEditMode() !== editMode) {
      window.__studioSetEditMode(editMode);
    }
  }, [editMode]);

  // Slice 471 — beforeunload prompt when the scene has unsaved changes.
  // Reads the dirty signal from window.__studioV3Dirty (set by the
  // DirtyDot component) and asks the browser to confirm.
  useEffect(() => {
    const onUnload = (e) => {
      if (window.__studioV3Dirty) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes — save before leaving?';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  // Slice 465 — Autosave the scene to localStorage every 30s. Only saves
  // when at least one primitive exists. Fires 'studio-autosaved' so any
  // UI can flash a notification.
  useEffect(() => {
    const tick = () => {
      try {
        let n = 0;
        const s = window.__archdiscScene;
        if (s) s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
        if (!n) return;
        const json = window.__studioSaveScene && window.__studioSaveScene();
        if (!json) return;
        window.localStorage.setItem('archdisc.studio.autosave', json);
        const ts = Date.now();
        window.localStorage.setItem('archdisc.studio.autosave.ts', String(ts));
        window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts, bytes: json.length, primitives: n } }));
      } catch (_) {}
    };
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  // Cmd+T cycle theme; Cmd+/ toggle dock; Esc clears active tool;
  // X deletes the selected mesh (Blender X / Maya Backspace parity).
  useEffect(() => {
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 't') {
        e.preventDefault();
        setTheme((t) => t === 'dark' ? 'light' : 'dark');
      } else if (meta && !e.shiftKey && e.key.toLowerCase() === 'z') {
        // Slice 437 — Cmd/Ctrl+Z = undo. Honors text input.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioUndo) window.__studioUndo();
        e.preventDefault();
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 'z') {
        // Cmd/Ctrl+Shift+Z = redo.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioRedo) window.__studioRedo();
        e.preventDefault();
      } else if (meta && !e.shiftKey && e.key.toLowerCase() === 's') {
        // Slice 438 — Cmd/Ctrl+S downloads the scene as JSON.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioDownloadScene) window.__studioDownloadScene();
        e.preventDefault();
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 's') {
        // Slice 500 — Cmd/Ctrl+Shift+S prompts for a name then downloads.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('studio-save-as-open'));
      } else if (meta && !e.shiftKey && e.key.toLowerCase() === 'o') {
        // Slice 439 — Cmd/Ctrl+O opens a .studio.json file picker.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioOpenSceneFile) window.__studioOpenSceneFile();
        e.preventDefault();
      } else if (meta && !e.shiftKey && e.key.toLowerCase() === 'e') {
        // Slice 445 — Cmd/Ctrl+E exports the scene as GLTF (download).
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioDownloadGLTF) window.__studioDownloadGLTF();
        e.preventDefault();
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 'e') {
        // Slice 488 — Cmd/Ctrl+Shift+E exports the viewport as PNG (download).
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioExportViewportPNG) window.__studioExportViewportPNG();
        e.preventDefault();
      } else if (meta && e.key === ',') {
        // Slice 455 — Cmd/Ctrl+, opens Settings (macOS standard).
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        window.dispatchEvent(new CustomEvent('studio-settings-toggle'));
        e.preventDefault();
      } else if (meta && e.key.toLowerCase() === 'k') {
        // Slice 476 — Cmd/Ctrl+K opens the command palette.
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('studio-command-palette-toggle'));
      } else if (meta && e.key.toLowerCase() === 'p') {
        // Slice 479 — Cmd/Ctrl+P toggles presentation mode (hide overlays).
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('studio-presentation-toggle'));
      } else if (meta && !e.shiftKey && e.key.toLowerCase() === 'g') {
        // Slice 485 — Cmd/Ctrl+G groups the multi-select set.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        e.preventDefault();
        if (window.__studioGroupSelected) window.__studioGroupSelected('group');
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 'g') {
        // Slice 487 — Cmd/Ctrl+Shift+G ungroups the active group.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        e.preventDefault();
        if (window.__studioUngroupSelected) window.__studioUngroupSelected();
      } else if (meta && !e.shiftKey && (e.key === '1' || e.key === '2' || e.key === '3')) {
        // Slice 478 — Cmd+1/2/3 switches right-panel tab to
        // inspector / outliner / layers.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const map = { '1': 'inspector', '2': 'outliner', '3': 'layers' };
        setRightCollapsed(false);
        window.dispatchEvent(new CustomEvent('studio-right-tab-set', { detail: { tab: map[e.key] } }));
        e.preventDefault();
      } else if (meta && !e.shiftKey && e.key.toLowerCase() === 'f') {
        // Slice 464 — Cmd/Ctrl+F focuses the outliner filter (standard
        // search shortcut). Auto-expands the right panel + switches to
        // outliner tab if needed.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        e.preventDefault();
        setRightCollapsed(false);
        // Defer one tick so React renders the outliner if it just
        // switched in.
        requestAnimationFrame(() => {
          // Switch to outliner tab — find the active tab button + click.
          const ob = document.querySelector('[data-studio-v3-right-tab="outliner"]');
          if (ob && ob.getAttribute('data-active') !== 'true') ob.click();
          requestAnimationFrame(() => {
            const inp = document.querySelector('[data-studio-v3-outliner-filter]');
            if (inp) { inp.focus(); inp.select && inp.select(); }
          });
        });
      } else if (meta && e.key === '/') {
        e.preventDefault();
        // No dock in V3 — focus the cmdbar input as the most useful alias.
        const inp = document.querySelector('[data-studio-v3-cmdbar-input]');
        if (inp) inp.focus();
      } else if (meta && !e.shiftKey && !e.altKey && e.key === '.') {
        // Slice 614 — Cmd+. moves the orbit target to the active mesh's
        // world center without changing camera position. Cleaner than Frame
        // selected when you want to keep your current angle.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        e.preventDefault();
        const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
        const vp = window.__archdiscViewport;
        if (m && vp && vp.orbitControls && vp.orbitControls.target) {
          const wp = new (window.__archdiscTHREE || {}).Vector3 ? new window.__archdiscTHREE.Vector3() : null;
          if (wp && typeof m.getWorldPosition === 'function') {
            m.getWorldPosition(wp);
            vp.orbitControls.target.set(wp.x, wp.y, wp.z);
            if (typeof vp.orbitControls.update === 'function') vp.orbitControls.update();
          } else {
            vp.orbitControls.target.set(m.position.x, m.position.y, m.position.z);
            if (typeof vp.orbitControls.update === 'function') vp.orbitControls.update();
          }
          if (window.__studioToast) window.__studioToast('Orbit centered on selection', 'info');
        }
      } else if (!meta && !e.shiftKey && !e.altKey && e.key === '/') {
        // Slice 524 — bare / toggles solo: isolate selection + fit.
        // Press again to reveal all and frame everything.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        e.preventDefault();
        if (!window.__studioV3Solo) {
          if (window.__studioHideUnselected) window.__studioHideUnselected();
          if (window.__studioFitSelected) window.__studioFitSelected();
          window.__studioV3Solo = true;
          if (window.__studioToast) window.__studioToast('Solo on', 'info');
        } else {
          if (window.__studioRevealAll) window.__studioRevealAll();
          if (window.__studioFrameAll) window.__studioFrameAll();
          window.__studioV3Solo = false;
          if (window.__studioToast) window.__studioToast('Solo off', 'info');
        }
      } else if (!meta && e.key === 'Escape') {
        setActiveTool('select');
      } else if (!meta && !e.shiftKey && !e.altKey && e.key === 'Tab') {
        // Slice 428 — Blender Tab cycle: object → vertex → edge → face → sculpt → object.
        // Honors text inputs by checking the focused element.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        e.preventDefault();
        const cycle = ['object', 'vertex', 'edge', 'face', 'sculpt'];
        const cur = window.__studioGetEditMode && window.__studioGetEditMode();
        const i = cycle.indexOf(cur);
        const next = cycle[(i + 1) % cycle.length];
        if (window.__studioSetEditMode) window.__studioSetEditMode(next);
      } else if (!meta && !e.shiftKey && !e.altKey && e.key === '5') {
        // Slice 450 — 5 toggles perspective / ortho projection.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioToggleViewProjection) window.__studioToggleViewProjection();
        e.preventDefault();
      } else if (!meta && !e.altKey && (e.key === '+' || e.key === '=' || e.key === '-')) {
        // Slice 452 — Numpad +/- dolly the camera in / out (Blender parity).
        // '=' on US layouts is the unshifted +, so treat it as +.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const v = window.__archdiscViewport;
        if (!v || !v.camera) return;
        const ctrl = v.orbitControls || v.controls;
        if (!ctrl) return;
        const target = ctrl.target;
        const dir = v.camera.position.clone().sub(target);
        const k = (e.key === '-') ? 1.12 : 0.89;
        dir.multiplyScalar(k);
        v.camera.position.copy(target).add(dir);
        if (typeof ctrl.update === 'function') ctrl.update();
        e.preventDefault();
      } else if (!meta && !e.shiftKey && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
        // Slice 451 — Z cycles wire → solid → material → rendered → wire …
        // (Blender Z parity). Cmd/Ctrl+Z is undo; we only fire bare z.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const cycle = ['wire', 'solid', 'material', 'rendered'];
        const cur = (window.__studioGetShadingMode && window.__studioGetShadingMode()) || 'solid';
        const next = cycle[(cycle.indexOf(cur) + 1) % cycle.length];
        if (window.__studioSetShadingMode) window.__studioSetShadingMode(next);
        e.preventDefault();
      } else if (!meta && !e.shiftKey && (e.code === 'Numpad1' || e.code === 'Numpad3' || e.code === 'Numpad7' || e.code === 'Numpad5' || e.code === 'NumpadDecimal' || e.code === 'NumpadDivide')) {
        // Slice 555/622 — Numpad-1/3/7 = front/right/top (Blender parity);
        // Numpad-5 toggles persp/ortho. Ctrl+Numpad-1/3/7 flips to
        // back/left/bottom. Numpad-. centres orbit on selection.
        // Numpad-/ toggles local/isolate view.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const ctrl = e.ctrlKey || e.metaKey;
        if (e.code === 'Numpad1' && window.__studioSetCameraAxis) window.__studioSetCameraAxis(ctrl ? 'back' : 'front');
        else if (e.code === 'Numpad3' && window.__studioSetCameraAxis) window.__studioSetCameraAxis(ctrl ? 'left' : 'side');
        else if (e.code === 'Numpad7' && window.__studioSetCameraAxis) window.__studioSetCameraAxis(ctrl ? 'bottom' : 'top');
        else if (e.code === 'Numpad5' && window.__studioToggleViewProjection) window.__studioToggleViewProjection();
        else if (e.code === 'NumpadDecimal' && window.__studioFrameSelection) window.__studioFrameSelection();
        else if (e.code === 'NumpadDivide' && window.__studioToggleIsolateSelection) window.__studioToggleIsolateSelection();
        e.preventDefault();
      } else if (!meta && !e.shiftKey && e.altKey && e.key >= '1' && e.key <= '9') {
        // Slice 537 — Alt+1..9 recalls camera bookmark by index. Bookmark
        // names are arbitrary; we sort then pick the Nth.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const names = (window.__studioListCameraBookmarks && window.__studioListCameraBookmarks()) || [];
        const sorted = names.slice().sort();
        const idx = Number(e.key) - 1;
        if (sorted[idx] && window.__studioRestoreCameraBookmark) {
          window.__studioRestoreCameraBookmark(sorted[idx]);
          if (window.__studioToast) window.__studioToast(`Camera: ${sorted[idx]}`, 'info');
        }
        e.preventDefault();
      } else if (!meta && !e.shiftKey && !e.altKey && (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '7')) {
        // 1/2/3 flip vert/edge/face — ONLY when already in a sub-object
        // mode (avoids stealing the numpad-1/3 camera views in object mode).
        // In object mode 1/3/7 set the canonical camera axis (Blender
        // numpad-1 front, numpad-3 right, numpad-7 top).
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const cur = window.__studioGetEditMode && window.__studioGetEditMode();
        if (cur === 'vertex' || cur === 'edge' || cur === 'face') {
          if (e.key === '7') return; // no edit-mode handler for 7
          const map = { '1': 'vertex', '2': 'edge', '3': 'face' };
          if (window.__studioSetEditMode) window.__studioSetEditMode(map[e.key]);
          e.preventDefault();
        } else {
          // Object mode → camera axis preset (Blender numpad parity).
          if (e.key === '2') return; // no axis for 2
          const axisMap = { '1': 'front', '3': 'side', '7': 'top' };
          if (window.__studioSetCameraAxis) window.__studioSetCameraAxis(axisMap[e.key]);
          setAxis(axisMap[e.key]);
          e.preventDefault();
        }
      } else if (!meta && !e.shiftKey && !e.altKey && (e.key === 'e' || e.key === 'E')) {
        // Slice 481 — E extrudes selected faces in edit mode (Blender E).
        // No-op outside face mode so it doesn't clobber other actions.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const cur = window.__studioGetEditMode && window.__studioGetEditMode();
        if (cur !== 'face') return;
        if (window.__studioExtrudeSelectedFaces) window.__studioExtrudeSelectedFaces(0.005);
        e.preventDefault();
      } else if (!meta && !e.shiftKey && !e.altKey && (e.key === 'i' || e.key === 'I')) {
        // Slice 482 — I insets selected faces (Blender I parity).
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const cur = window.__studioGetEditMode && window.__studioGetEditMode();
        if (cur !== 'face') return;
        if (window.__studioInsetSelectedFaces) window.__studioInsetSelectedFaces(0.3);
        e.preventDefault();
      } else if (!meta && !e.shiftKey && !e.altKey && (e.key === 'w' || e.key === 'W')) {
        // Slice 482 — W subdivides selected faces (Blender W > Subdivide).
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const cur = window.__studioGetEditMode && window.__studioGetEditMode();
        if (cur !== 'face') return;
        if (window.__studioSubdivideSelectedFaces) window.__studioSubdivideSelectedFaces();
        e.preventDefault();
      } else if (!meta && !e.shiftKey && !e.altKey && (e.key === 'g' || e.key === 'r' || e.key === 's')) {
        // Slice 429 / 600 — G / R / S set the active transform tool and
        // arm Blender-style modal mode: subsequent mousemove drives the
        // transform, X/Y/Z lock to an axis, Enter commits, Esc reverts.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const map = { g: 'move', r: 'rotate', s: 'scale' };
        setActiveTool(map[e.key]);
        if (window.__studioStartModalTransform) window.__studioStartModalTransform(map[e.key]);
        e.preventDefault();
      } else if (!meta && e.shiftKey && (e.key === ';' || e.key === ':')) {
        // Slice 491 — Shift+; toggles transform snap (translation 1 cm,
        // rotation 15°, scale 0.1). Status badge tracks the state.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioToggleSnap) window.__studioToggleSnap();
        e.preventDefault();
      } else if (!meta && !e.shiftKey && e.altKey && (e.key === 'g' || e.key === 'r' || e.key === 's')) {
        // Slice 490 — Alt+G / Alt+R / Alt+S clear translation / rotation /
        // scale on the active selection (Blender parity).
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioResetTransform) window.__studioResetTransform(e.key);
        e.preventDefault();
      } else if (!meta && !e.shiftKey && (e.key === 'h' || e.key === 'H')) {
        // Slice 430 — H hides selected, Alt+H reveals all (Blender H parity).
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (e.altKey) {
          if (window.__studioRevealAll) window.__studioRevealAll();
        } else {
          const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
          if (sel) sel.visible = false;
        }
        e.preventDefault();
      } else if (!meta && !e.shiftKey && !e.altKey && e.key === 'F2') {
        // Slice 566 — F2 focuses the inspector rename input (Blender F2 parity).
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const inp = document.querySelector('[data-studio-v3-rename-input]');
        if (inp) { inp.focus(); if (inp.select) inp.select(); }
        e.preventDefault();
      } else if (!meta && e.shiftKey && !e.altKey && (e.key === 'W' || e.key === 'w' || e.key === 'A' || e.key === 'a' || e.key === 'S' || e.key === 's' || e.key === 'D' || e.key === 'd')) {
        // Slice 600 — Shift+WASD flies the camera in forward / strafe.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioFly) window.__studioFly(e.key.toLowerCase(), 0.05);
        e.preventDefault();
      } else if (!meta && !e.shiftKey && !e.altKey && (e.key === 't' || e.key === 'T')) {
        // Slice 557 — Bare T toggles camera turntable autorotate.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioToggleTurntable) window.__studioToggleTurntable();
        e.preventDefault();
      } else if (meta && !e.shiftKey && !e.altKey && (e.key === 'j' || e.key === 'J')) {
        // Slice 569 — Cmd/Ctrl+J joins multi-selected meshes.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioJoinSelected) window.__studioJoinSelected();
        e.preventDefault();
      } else if (meta && !e.shiftKey && !e.altKey && (e.key === ']' || e.key === '[')) {
        // Slice 612 — Cmd+] / Cmd+[ cycle selection through visible
        // archdisc primitives in scene-graph order.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        e.preventDefault();
        const s = window.__archdiscScene;
        if (!s) return;
        const list = [];
        s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive && o.visible !== false) list.push(o); });
        if (!list.length) return;
        const cur = window.__studioSelectedMesh && window.__studioSelectedMesh();
        const idx = cur ? list.findIndex((m) => m.uuid === cur.uuid) : -1;
        const next = e.key === ']'
          ? (idx + 1) % list.length
          : (idx <= 0 ? list.length - 1 : idx - 1);
        if (window.__studioSelectMesh) window.__studioSelectMesh(list[next]);
        if (window.__studioToast) window.__studioToast(`${next + 1}/${list.length}: ${list[next].name || 'mesh'}`, 'info');
      } else if (meta && !e.shiftKey && !e.altKey && (e.key === 'r' || e.key === 'R')) {
        // Slice 556 — Cmd+R resets the camera home.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioResetCamera) window.__studioResetCamera();
        e.preventDefault();
      } else if (meta && !e.shiftKey && !e.altKey && (e.key === 'l' || e.key === 'L')) {
        // Slice 529 — Cmd/Ctrl+L toggles transform lock on selection.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioToggleLockSelected) window.__studioToggleLockSelected();
        e.preventDefault();
      } else if (meta && e.altKey && (e.key === 'a' || e.key === 'A')) {
        // Slice 521 — Cmd/Ctrl+Alt+A drops a text annotation at the
        // active selection.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioAddAnnotation) {
          const r = window.__studioAddAnnotation('note ' + ((window.__studioListAnnotations && window.__studioListAnnotations().length) + 1));
          if (r && r.ok && window.__studioToast) window.__studioToast(`Annotation: ${r.text}`, 'info');
        }
        e.preventDefault();
      } else if (!meta && !e.shiftKey && !e.altKey && (e.key === 'm' || e.key === 'M')) {
        // Slice 512 — M measures distance between the 2 most recently
        // selected primitives.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioMeasureSelected) window.__studioMeasureSelected();
        e.preventDefault();
      } else if (!meta && !e.shiftKey && !e.altKey && (e.key === 'b' || e.key === 'B')) {
        // Slice 502 — B arms the drag-rectangle marquee select (Blender B parity).
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        window.dispatchEvent(new CustomEvent('studio-marquee-arm'));
        e.preventDefault();
      } else if (!meta && e.shiftKey && (e.key === 'h' || e.key === 'H')) {
        // Slice 489 — Shift+H hides everything except the selected primitive
        // (isolate-selected). Re-press unhides via Alt+H or Reveal All.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioHideUnselected) window.__studioHideUnselected();
        e.preventDefault();
      } else if (!meta && !e.altKey && !e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        // Slice 431 — A toggles select-all ↔ deselect-all (Blender A parity).
        // Bare A only; Shift+A is the slice 457 quick-add menu.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const set = (window.__studioSelectedMeshes && window.__studioSelectedMeshes()) || [];
        if (set.length === 0) {
          if (window.__studioSelectAll) window.__studioSelectAll();
        } else {
          if (window.__studioDeselect) window.__studioDeselect();
        }
        e.preventDefault();
      } else if (!meta && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        // Slice 434/511 — Shift+D duplicates the multi-select set (falling
        // back to the active mesh when no set exists).
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
        const set = Array.isArray(window.__studioSelectedMeshesSet) && window.__studioSelectedMeshesSet.length
          ? window.__studioSelectedMeshesSet.slice()
          : (window.__studioSelectedMesh && window.__studioSelectedMesh() ? [window.__studioSelectedMesh()] : []);
        if (s && set.length) {
          if (window.__studioPushUndo) window.__studioPushUndo();
          const clones = [];
          for (const sel of set) {
            const clone = sel.clone();
            if (clone.geometry) clone.geometry = clone.geometry.clone();
            if (Array.isArray(clone.material)) clone.material = clone.material.map((m) => m.clone());
            else if (clone.material) clone.material = clone.material.clone();
            clone.position.set(sel.position.x + 0.02, sel.position.y, sel.position.z + 0.02);
            clone.userData = { ...sel.userData };
            clone.name = (sel.name || 'mesh') + '-copy';
            s.add(clone);
            clones.push(clone);
          }
          window.__studioSelectedMeshesSet = clones;
          if (window.__studioSelectMesh && clones.length) window.__studioSelectMesh(clones[clones.length - 1]);
          if (window.__studioToast) window.__studioToast(`Duplicated ${clones.length}`, 'ok');
        }
        e.preventDefault();
      } else if (!meta && !e.shiftKey && !e.altKey && e.key === ' ') {
        // Slice 440 — Space toggles animation play/pause (Blender Space).
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioToggleAnimating) window.__studioToggleAnimating();
        e.preventDefault();
      } else if (!meta && !e.shiftKey && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        // Slice 441 — ← / → step the active animation frame by 1.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const f = (window.__studioGetFrame && window.__studioGetFrame()) || 0;
        const next = e.key === 'ArrowRight' ? f + 1 : Math.max(0, f - 1);
        if (window.__studioSetFrame) window.__studioSetFrame(next);
        e.preventDefault();
      } else if (!meta && !e.shiftKey && !e.altKey && (e.key === 'y' || e.key === 'Y')) {
        // Slice 484 — Y toggles the transform gizmo visibility.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const vp = window.__archdiscViewport;
        if (vp && vp.transformControls) {
          vp.transformControls.visible = !vp.transformControls.visible;
          window.__studioGizmoVisible = vp.transformControls.visible;
        }
        e.preventDefault();
      } else if (!meta && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        // Slice 442 — K inserts a keyframe at the current frame (Blender K).
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioInsertKeyframeAt && window.__studioGetFrame) {
          window.__studioInsertKeyframeAt(window.__studioGetFrame());
        }
        e.preventDefault();
      } else if (!meta && !e.shiftKey && !e.altKey && (e.key === 'j' || e.key === 'J' || e.key === 'l' || e.key === 'L')) {
        // Slice 483 — J / L jump to previous / next keyframe of the
        // active mesh.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const mesh = window.__studioSelectedMesh && window.__studioSelectedMesh();
        if (!mesh || !window.__studioGetKeyframes || !window.__studioSetFrame) return;
        const r = window.__studioGetKeyframes(mesh.uuid);
        const kfs = (r && r.keyframes) || [];
        if (!kfs.length) return;
        const cur = (window.__studioGetFrame && window.__studioGetFrame()) || 0;
        const sorted = kfs.map((k) => k.frame).sort((a, b) => a - b);
        let next = cur;
        if (e.key === 'j' || e.key === 'J') {
          // Previous keyframe (strictly less than current).
          const prevs = sorted.filter((f) => f < cur);
          if (prevs.length) next = prevs[prevs.length - 1];
        } else {
          // Next keyframe.
          const nexts = sorted.filter((f) => f > cur);
          if (nexts.length) next = nexts[0];
        }
        window.__studioSetFrame(next);
        e.preventDefault();
      } else if (!meta && !e.shiftKey && !e.altKey && (e.key === 'n' || e.key === 'N')) {
        // Slice 448 — N toggles the right panel (Blender N sidebar).
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        setRightCollapsed((v) => !v);
        e.preventDefault();
      } else if (!meta && !e.shiftKey && !e.altKey && e.key === '.') {
        // Slice 435 — '.' frames the selected mesh in the viewport
        // (Blender Numpad-. parity). Falls back to FrameAll if nothing
        // is selected.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
        if (sel && window.__studioFitSelected) window.__studioFitSelected();
        else if (window.__studioFrameAll) window.__studioFrameAll();
        e.preventDefault();
      }
      // Slice 436 — X / Delete remove the active mesh from the scene
      // (Blender X / Maya Backspace parity). V3 owns this directly now —
      // the prior V2 headless-mount delegation is gone in V3-only mode.
      else if (!meta && !e.shiftKey && !e.altKey && (e.key === 'x' || e.key === 'X' || e.key === 'Delete' || e.key === 'Backspace')) {
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
        // Slice 514 — Delete the whole multi-select set; fall back to active.
        const set = Array.isArray(window.__studioSelectedMeshesSet) && window.__studioSelectedMeshesSet.length
          ? window.__studioSelectedMeshesSet.slice()
          : (window.__studioSelectedMesh && window.__studioSelectedMesh() ? [window.__studioSelectedMesh()] : []);
        if (s && set.length) {
          if (window.__studioPushUndo) window.__studioPushUndo();
          const vp = window.__archdiscViewport;
          for (const sel of set) {
            if (sel.geometry) sel.geometry.dispose();
            if (Array.isArray(sel.material)) sel.material.forEach((m) => m.dispose && m.dispose());
            else if (sel.material && sel.material.dispose) sel.material.dispose();
            (sel.parent || s).remove(sel);
            if (vp && vp.transformControls && vp.transformControls.object === sel) vp.transformControls.detach();
          }
          window.__studioSelectedMeshesSet = [];
          if (window.__studioDeselect) window.__studioDeselect();
          if (window.__studioToast) window.__studioToast(`Deleted ${set.length}`, 'ok');
        }
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Slice 396 — drive the Viewport3D gizmo from the active Transform tool.
  useEffect(() => {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.transformControls) return;
    if (activeTool === 'select') {
      vp.transformControls.detach();
    } else if (activeTool === 'move' || activeTool === 'rotate' || activeTool === 'scale') {
      try {
        vp.transformControls.setMode(activeTool === 'move' ? 'translate' : activeTool);
        const sel = vp.getSelected && vp.getSelected();
        if (sel && !vp.transformControls.object) vp.transformControls.attach(sel);
      } catch (_) {}
    }
  }, [activeTool]);

  const onCmdSubmit = async (text) => {
    // Direct V3-API call path — any `studioFoo arg1 arg2` invokes the
    // existing window.__studio* op directly and pushes the result. No
    // model round-trip. Best for power users who already know the API.
    const direct = callDirectIfPossible(text);
    if (direct) {
      setThread((t) => [
        ...t,
        { role: 'user', text },
        direct.ok
          ? { role: 'tool', text: `${direct.fname}(${(direct.args || []).map(JSON.stringify).join(', ')}) → ${JSON.stringify(direct.result)}` }
          : { role: 'tool', text: `${direct.fname}: ${direct.error}` },
      ]);
      return;
    }
    // NL routing — push the user message + a pending Archie placeholder,
    // then call the local Archie fleet at localhost:8080 with the
    // foundational_studio adapter. The reply replaces the placeholder;
    // any <tool_call> tags in the reply are extracted and dispatched
    // against the V3 surface.
    setThread((t) => [
      ...t,
      { role: 'user', text },
      { role: 'archie', text: '…thinking…', pending: true },
    ]);
    try {
      // Slice 951s — stream tokens into the pending overlay message so
      // the user sees Archie compose its reply in real time. The
      // post-stream dispatch logic below is unchanged — _extractToolCalls
      // operates on the full final text returned by runArchie.
      const _streamUpdate = (acc) => {
        setThread((t) => {
          const last = t[t.length - 1];
          if (!last || last.role !== 'archie' || !last.pending) return t;
          // Strip <think>…</think> from the visible stream so the user
          // doesn't see the chain-of-thought — show only emerging
          // content. Empty after strip means stay on the placeholder.
          const visible = (acc || '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
          return [...t.slice(0, -1), { ...last, text: visible || '…thinking…' }];
        });
      };
      const reply = await runArchie(text, activeWb, {
        onToken: ({ acc_content }) => _streamUpdate(acc_content),
      });
      // Slice 951l — defer the Archie chat message until AFTER we've
      // synthesized the tool calls, so we can humanize the reply with
      // the dispatch summary baked in.
      // Slice 951 — three-tier dispatch resolution. The studio_v16
      // LoRAs aren't fully fluent on the <tool_call> tag shape yet, so
      // we fall back gracefully:
      //   1. Literal <tool_call> tags (preferred — model-emitted)
      //   2. <plan>{...}</plan> JSON → synthesize click-discipline +
      //      click-primitive + click-action calls from the plan fields
      //   3. Keyword scan of the original user prompt for primitive ids
      //      (last-resort demo-safety net)
      // Slice 951k — four-tier dispatch (recipe tier from 951j removed).
      // All four tiers EXTRACT structure from real model output:
      //   1. Literal <tool_call> tags from the model
      //   2. <plan>{...}</plan> JSON → click-discipline + per-body
      //      click-primitive + click-action synth (drives a proper
      //      build sequence from the model's stated intent)
      //   3. Quoted-clicks scan of the model's prose (`Click "cube"`)
      //      — the trained corpus prose used this shape so the LoRAs
      //      keep emitting it. Extracts whatever the model actually
      //      named, not what we guessed about its intent.
      //   4. Keyword scan over user prompt + reply for primitive ids
      //      AND common-noun aliases (ball→sphere, leg→cylinder, …)
      //      — minimal "the user said the word cylinder so spawn one"
      //      safety net, not a recipe.
      let calls = _extractToolCalls(reply);
      let dispatchSource = 'tool_calls';
      if (calls.length === 0) {
        const plan = _extractPlan(reply);
        const synth = _synthFromPlan(plan, activeWb);
        if (synth.length > 0) { calls = synth; dispatchSource = 'plan'; }
      }
      if (calls.length === 0) {
        const quoted = _quotedClicksFallback(reply);
        if (quoted.length > 0) { calls = quoted; dispatchSource = 'quoted-clicks'; }
      }
      if (calls.length === 0) {
        // Slice 951o — model-driven second-pass decomposer.
        const decomp = await _runDecomposerPass(text);
        if (decomp.length > 0) {
          const trainedDisc = STUDIO_TO_TRAINED_DISCIPLINE[activeWb] || 'modeling';
          calls = [
            { name: 'click-discipline', arguments: { id: trainedDisc } },
            ...decomp,
          ];
          dispatchSource = 'decomposer';
        }
      }
      if (calls.length === 0) {
        const kw = _keywordFallback(text, reply);
        if (kw.length > 0) {
          const trainedDisc = STUDIO_TO_TRAINED_DISCIPLINE[activeWb] || 'modeling';
          calls = [
            { name: 'click-discipline', arguments: { id: trainedDisc } },
            ...kw,
          ];
          dispatchSource = 'keyword';
        }
      }
      // Slice 951l — replace the "…thinking…" placeholder with a
      // humanized version of the reply (tags stripped, markdown
      // collapsed, dispatch summary appended when the raw text is
      // empty or just protocol). The DISPATCH below still runs against
      // the raw reply; only the chat-window text changes.
      const humanized = calls.length
        ? _humanizeReply(reply, calls)
        : (reply && reply.trim()
            ? _humanizeReply(reply, [])
            : "I couldn't make sense of that — try naming the parts you want (e.g. \"a cube tabletop and four cylinder legs\") or refining what you mean.");
      setThread((t) => {
        const next = t.slice();
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i] && next[i].pending) {
            next[i] = { role: 'archie', text: humanized };
            return next;
          }
        }
        next.push({ role: 'archie', text: humanized });
        return next;
      });
      for (const call of calls) {
        // eslint-disable-next-line no-await-in-loop
        const result = await executeToolCall(call);
        setThread((t) => [
          ...t,
          {
            role: 'tool',
            text: _humanizeCall(call, result),
          },
        ]);
      }
    } catch (err) {
      setThread((t) => {
        const next = t.slice();
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i] && next[i].pending) {
            next[i] = { role: 'tool', text: `archie call failed: ${String(err && err.message || err)}` };
            return next;
          }
        }
        next.push({ role: 'tool', text: `archie call failed: ${String(err && err.message || err)}` });
        return next;
      });
    }
  };

  // Slice 400/407 — QAT actions call V3 APIs and push a tool-message
  // into the thread strip (which auto-shows above the cmdbar).
  const onQatAction = (id) => {
    const pushTool = (text) => setThread((t) => [...t, { role: 'tool', text }]);
    if (id === 'undo') {
      const r = window.__studioUndo && window.__studioUndo();
      pushTool(`__studioUndo → ${JSON.stringify(r)}`);
    } else if (id === 'redo') {
      const r = window.__studioRedo && window.__studioRedo();
      pushTool(`__studioRedo → ${JSON.stringify(r)}`);
    } else if (id === 'play') {
      const r = window.__studioToggleAnimating && window.__studioToggleAnimating();
      pushTool(`__studioToggleAnimating → ${JSON.stringify(r)}`);
    } else if (id === 'pause') {
      const r = window.__studioToggleAnimating && window.__studioToggleAnimating();
      pushTool(`__studioToggleAnimating → ${JSON.stringify(r)}`);
    } else if (id === 'save') {
      const json = window.__studioSaveScene && window.__studioSaveScene();
      pushTool(`__studioSaveScene → ${json ? json.length + ' bytes' : 'null'}`);
      // Drop the JSON into a downloadable blob so the user can persist it.
      if (json) {
        try {
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `studio-scene-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (_) {}
      }
    } else if (id === 'open') {
      // Trigger a file picker; on pick, call __studioLoadScene with the
      // file's JSON text.
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'application/json,.json';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        const text = await f.text();
        const r = window.__studioLoadScene && window.__studioLoadScene(text);
        pushTool(`__studioLoadScene("${f.name}") → ${JSON.stringify(r)}`);
      };
      inp.click();
    } else if (id === 'new') {
      // Slice 446 — New = clear every Studio primitive from the scene
      // (RevealAll was unrelated). Push undo first so the user can
      // recover via Cmd+Z.
      if (window.__studioPushUndo) window.__studioPushUndo();
      const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
      let n = 0;
      if (s) {
        const doomed = [];
        s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) doomed.push(o); });
        for (const o of doomed) {
          s.remove(o);
          if (o.geometry) o.geometry.dispose();
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose && m.dispose());
          else if (o.material && o.material.dispose) o.material.dispose();
          n++;
        }
        if (window.__studioDeselect) window.__studioDeselect();
      }
      pushTool(`new — cleared ${n} primitive${n === 1 ? '' : 's'}`);
    } else if (id === 'export') {
      // Slice 446 — Export GLTF (mirrors Cmd+E from slice 445).
      if (window.__studioDownloadGLTF) window.__studioDownloadGLTF();
      pushTool('__studioDownloadGLTF triggered');
    } else if (id === 'settings') {
      window.dispatchEvent(new CustomEvent('studio-settings-toggle'));
      pushTool('Settings opened');
    }
  };

  return (
    <div
      className="studio-app"
      data-studio-v3-shell
      data-studio-v3-mode={theme}
      data-studio-v3-presentation={present ? 'true' : 'false'}
      style={present ? { '--present-hide': 'none' } : undefined}
    >
      <TopBar
        theme={theme}
        onCycleTheme={() => setTheme((t) => t === 'dark' ? 'light' : 'dark')}
      />
      <QuickAccessBar onAction={onQatAction} />
      <WorkbenchRail
        activeId={activeWb}
        onSwitch={(id) => { setActiveWb(id); setActiveTool('select'); }}
      />
      <Toolbar
        wbId={activeWb}
        activeTool={activeTool}
        setTool={setActiveTool}
        onInvoke={(toolId, group) => {
          // Add group → spawn primitive into the live scene.
          if (group === 'add' && PRIMITIVE_KINDS.has(toolId)) {
            const scene = window.__archdiscScene;
            if (scene) spawnPrimitive(toolId, scene);
            return;
          }
          // Mesh ops → call into the slice 388/389/390 window APIs if
          // V2 is mounted alongside (won't be in v3-only mode yet, but
          // future slices port these into V3).
          if (group === 'mesh') {
            const m = toolId;
            if (m === 'extrude' && window.__studioExtrudeSelectedFaces) window.__studioExtrudeSelectedFaces(0.005);
            else if (m === 'inset' && window.__studioInsetSelectedFaces) window.__studioInsetSelectedFaces(0.3);
            else if (m === 'subdivide' && window.__studioSubdivideSelectedFaces) window.__studioSubdivideSelectedFaces();
            return;
          }
          // Other groups — placeholder; surfaced in slice 396+.
        }}
      />
      <main
        className="studio-viewport studio-viewport-canvas"
        data-studio-v3-viewport
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
        onDrop={(e) => {
          e.preventDefault();
          const files = Array.from(e.dataTransfer.files || []);
          for (const f of files) {
            const reader = new FileReader();
            if (f.type.startsWith('image/')) {
              reader.onload = () => {
                if (window.__studioAddImagePlate) window.__studioAddImagePlate(reader.result);
              };
              reader.readAsDataURL(f);
            } else if (f.name.endsWith('.studio.json') || f.name.endsWith('.json')) {
              reader.onload = () => {
                if (window.__studioLoadScene) {
                  const r = window.__studioLoadScene(reader.result);
                  if (window.__studioToast) window.__studioToast(r && r.ok ? `Loaded ${f.name}` : `Failed: ${(r && r.error) || 'unknown'}`, r && r.ok ? 'ok' : 'warn');
                }
              };
              reader.readAsText(f);
            } else if (f.name.endsWith('.ply')) {
              // Slice 591 — PLY import.
              reader.onload = async () => {
                if (window.__studioImportPLY) {
                  const r = await window.__studioImportPLY(reader.result, f.name);
                  if (window.__studioToast) window.__studioToast(r && r.ok ? `Imported ${f.name}` : `PLY failed: ${r && r.error}`, r && r.ok ? 'ok' : 'warn');
                }
              };
              reader.readAsArrayBuffer(f);
            } else if (f.name.endsWith('.stl')) {
              // Slice 589 — STL import.
              reader.onload = async () => {
                if (window.__studioImportSTL) {
                  const r = await window.__studioImportSTL(reader.result, f.name);
                  if (window.__studioToast) window.__studioToast(r && r.ok ? `Imported ${f.name}` : `STL failed: ${r && r.error}`, r && r.ok ? 'ok' : 'warn');
                }
              };
              reader.readAsArrayBuffer(f);
            } else if (f.name.endsWith('.obj')) {
              // Slice 589 — OBJ import.
              reader.onload = async () => {
                if (window.__studioImportOBJ) {
                  const r = await window.__studioImportOBJ(reader.result, f.name);
                  if (window.__studioToast) window.__studioToast(r && r.ok ? `Imported ${f.name}` : `OBJ failed: ${r && r.error}`, r && r.ok ? 'ok' : 'warn');
                }
              };
              reader.readAsText(f);
            } else if (f.name.endsWith('.glb') || f.name.endsWith('.gltf')) {
              // Slice 588 — Lazy-import three's GLTFLoader and add the
              // parsed scene under window.__archdiscScene.
              reader.onload = async () => {
                try {
                  const mod = await import('three/examples/jsm/loaders/GLTFLoader.js');
                  const loader = new mod.GLTFLoader();
                  loader.parse(reader.result, '', (gltf) => {
                    if (gltf.scene && window.__archdiscScene) {
                      gltf.scene.userData = { ...gltf.scene.userData, archdiscStudioPrimitive: true, archdiscStudioPrimitiveKind: 'gltf', archdiscStudioGltfSource: f.name };
                      window.__archdiscScene.add(gltf.scene);
                      if (window.__studioToast) window.__studioToast(`Imported ${f.name}`, 'ok');
                    }
                  }, (err) => {
                    if (window.__studioToast) window.__studioToast(`GLTF parse failed: ${err.message || err}`, 'warn');
                  });
                } catch (err) {
                  if (window.__studioToast) window.__studioToast(`GLTF import error: ${err.message}`, 'warn');
                }
              };
              reader.readAsArrayBuffer(f);
            } else if (window.__studioToast) {
              window.__studioToast(`Skipped ${f.name} (unsupported)`, 'warn');
            }
          }
        }}
      >
        <ViewportWatermark />
        <ViewportMinimap />
        <MeasurementChip />
        <QuadViewOverlay />
        {/* V3's own Viewport3D — owns the scene + camera + gizmo +
            raycaster. No V2 dependency. */}
        <Viewport3D
          canvasId="render-canvas-studio-v3"
          domain="studio"
          onSelectionChange={(s) => setSelection(s)}
        />
        <ViewportHUD
          editMode={editMode}
          setEditMode={setEditMode}
          axis={axis}
          setAxis={(a) => { setAxis(a); if (window.__studioSetCameraAxis) window.__studioSetCameraAxis(a); }}
        />
        {!present && <WelcomeCard />}
        <KeymapCheatsheet />
        <ContextMenu />
        <MarkingMenu />
        <QuickAddMenu />
        <CommandPalette />
        <SettingsModal />
        {!present && <ViewportStatsOverlay />}
        {!present && <AxisGizmo />}
        {!present && <AutosaveToast />}
        {!present && <AutosaveRestorePrompt />}
        {present && <PresentationBanner />}
      </main>
      {/* Slice 407 — right side is always the RightPanel now. Archie no
          longer overlays this slot; it lives only at the bottom. */}
      <RightPanel
        collapsed={rightCollapsed}
        onToggle={() => setRightCollapsed((v) => !v)}
        activeWb={activeWb}
        editMode={editMode}
        selection={selection}
      />
      <TimelineStrip />
      <StatusBar wb={activeWb} editMode={editMode} />
      <ArchieChatOverlay
        open={archieOpen}
        expanded={archieExpanded}
        thread={thread}
        onClose={() => setArchieOpen(false)}
        onToggleExpanded={() => setArchieExpanded((v) => !v)}
        onClear={() => { setThread([]); }}
      />
      <CommandBar
        onSubmit={onCmdSubmit}
        archieOpen={archieOpen}
        onOpen={() => setArchieOpen(true)}
        threadCount={thread.length}
      />
      <OnboardingTour />
      <ToastBus />
      <UpdateNotification />
      <MarqueeOverlay />
      <KeypressFlash />
      <SaveAsModal />
      <AboutModal />
      <CurveEditor />
      <PluginManager />
      <UVEditor />
      <AssetBrowser />
      <RenderQueueModal />
      <ScriptEditor />
      <FileMenu />
      <EditMenu />
      <SelectMenu />
      <ViewMenu />
      <WindowMenu />
      <SplashScreen />
      <SectionCollapser />
      <DocTitle activeWb={activeWb} />
    </div>
  );
}

export default StudioShellV3;
