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
// 15 Studio disciplines. Each entry maps to a workbench rail tab + a
// distinct toolbar group set + a right-panel content set. icons come
// from Icons.jsx (disc-* custom marks, no library).
const DISCIPLINES = [
  { id: 'model',  label: 'Model',   icon: 'disc-model'  },
  { id: 'sculpt', label: 'Sculpt',  icon: 'disc-sculpt' },
  { id: 'paint',  label: 'Paint',   icon: 'disc-paint'  },
  { id: 'shade',  label: 'Shade',   icon: 'disc-shade'  },
  { id: 'anim',   label: 'Anim',    icon: 'disc-anim'   },
  { id: 'rig',    label: 'Rig',     icon: 'disc-rig'    },
  { id: 'render', label: 'Render',  icon: 'disc-render' },
  { id: 'fx',     label: 'FX',      icon: 'disc-fx'     },
  { id: 'world',  label: 'World',   icon: 'disc-world'  },
  { id: 'nurbs',  label: 'NURBS',   icon: 'disc-nurbs'  },
  { id: 'phys',   label: 'Physics', icon: 'disc-phys'   },
  { id: 'audio',  label: 'Audio',   icon: 'disc-audio'  },
  { id: 'xr',     label: 'XR',      icon: 'disc-xr'     },
  { id: 'script', label: 'Script',  icon: 'disc-script' },
  { id: 'archie', label: 'Archie',  icon: 'disc-archie' },
];

// Toolbar groups per discipline. Each group is a labelled cluster of
// tools; tool ids map into Icons.jsx names so the glyph stays crisp.
const TOOLBAR = {
  model: [
    { label: 'Add',       tools: ['cube', 'sphere', 'plane', 'cylinder', 'cone', 'torus', 'icosahedron', 'text', 'curve', 'empty'] },
    { label: 'Transform', tools: ['select', 'move', 'rotate', 'scale'] },
    { label: 'Mesh',      tools: ['extrude', 'inset', 'subdivide', 'bevel', 'mirror'] },
    { label: 'View',      tools: ['eye', 'camera', 'light', 'material'] },
  ],
  sculpt: [
    { label: 'Brush',     tools: ['select', 'move', 'scale'] },
    { label: 'Smooth',    tools: ['subdivide', 'mirror'] },
    { label: 'View',      tools: ['eye', 'material'] },
  ],
  paint: [
    { label: 'Brush',     tools: ['select', 'move'] },
    { label: 'Layers',    tools: ['extrude', 'inset'] },
    { label: 'View',      tools: ['eye', 'material'] },
  ],
  shade: [
    { label: 'Materials', tools: ['material', 'eye'] },
    { label: 'Topology',  tools: ['cube', 'sphere'] },
  ],
  anim: [
    { label: 'Playback',  tools: ['play', 'pause'] },
    { label: 'Keys',      tools: ['extrude', 'inset'] },
    { label: 'View',      tools: ['eye', 'camera'] },
  ],
  rig: [
    { label: 'Bones',     tools: ['move', 'rotate'] },
    { label: 'Constraints', tools: ['mirror', 'extrude'] },
  ],
  render: [
    { label: 'Capture',   tools: ['camera', 'eye'] },
    { label: 'Light',     tools: ['light', 'material'] },
    { label: 'Output',    tools: ['settings'] },
  ],
  fx: [
    { label: 'Emitters',  tools: ['cube', 'sphere'] },
    { label: 'Forces',    tools: ['move', 'rotate'] },
  ],
  world: [
    { label: 'Terrain',   tools: ['plane', 'subdivide'] },
    { label: 'Light',     tools: ['light', 'material'] },
  ],
  nurbs: [
    { label: 'Curves',    tools: ['curve', 'cylinder'] },
    { label: 'Surfaces',  tools: ['extrude', 'subdivide'] },
  ],
  phys: [
    { label: 'Bodies',    tools: ['cube', 'sphere'] },
    { label: 'Sim',       tools: ['play', 'pause'] },
  ],
  audio: [
    { label: 'Source',    tools: ['cube'] },
    { label: 'Mix',       tools: ['play', 'pause'] },
  ],
  xr: [
    { label: 'Stage',     tools: ['cube', 'plane'] },
    { label: 'Hands',     tools: ['select', 'move'] },
  ],
  script: [
    { label: 'Run',       tools: ['play'] },
    { label: 'Debug',     tools: ['eye'] },
  ],
  archie: [
    { label: 'Thread',    tools: ['eye'] },
    { label: 'Tools',     tools: ['settings'] },
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
  const color = state === 'online' || state === 'streaming' ? 'var(--studio-accent, #1de9b6)' : '#3b424d';
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
        background: 'var(--studio-accent, #1de9b6)', color: '#0d1117',
        borderRadius: 8, padding: '0 4px', fontSize: 9, lineHeight: '13px',
        fontFamily: 'var(--studio-mono, ui-monospace)', minWidth: 13, textAlign: 'center',
        boxShadow: '0 0 0 1px var(--studio-bg, #0d1117)',
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
        background: 'var(--studio-bg, #0d1117)',
        border: '1px solid var(--studio-ink-mute, #1f2733)',
        borderRadius: 4, padding: '4px 0', minWidth: 160,
        boxShadow: '0 4px 16px rgba(0,0,0,0.55)',
        fontFamily: 'inherit', fontSize: 11,
        color: 'var(--studio-ink, #e6edf3)',
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div style={{
        padding: '4px 10px 6px',
        opacity: 0.55, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
        borderBottom: '1px solid var(--studio-ink-mute, #1f2733)', marginBottom: 4,
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
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--studio-accent, #1de9b6)'; e.currentTarget.style.color = 'var(--studio-bg, #0d1117)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--studio-ink, #e6edf3)'; }}
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
      {/* Centre dot. */}
      <div style={{
        position: 'absolute', left: -3, top: -3, width: 6, height: 6,
        borderRadius: 3, background: 'var(--studio-accent, #1de9b6)',
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
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--studio-accent, #1de9b6)'; e.currentTarget.style.color = 'var(--studio-bg, #0d1117)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--studio-bg-elev, #161b22)'; e.currentTarget.style.color = 'var(--studio-ink, #e6edf3)'; }}
            style={{
              position: 'absolute',
              left: x - 36, top: y - 12,
              width: 72, height: 24,
              background: 'var(--studio-bg-elev, #161b22)',
              color: 'var(--studio-ink, #e6edf3)',
              border: '1px solid var(--studio-ink-mute, #1f2733)',
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
        background: 'var(--studio-bg, #0d1117)',
        border: '1px solid var(--studio-ink-mute, #1f2733)',
        borderRadius: 4, padding: '4px 0', minWidth: 140,
        boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
        fontFamily: 'inherit', fontSize: 11,
        color: 'var(--studio-ink, #e6edf3)',
      }}
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          data-studio-v3-context-item={it.id}
          onClick={(e) => { e.stopPropagation(); it.call(); setPos(null); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--studio-accent, #1de9b6)'; e.currentTarget.style.color = 'var(--studio-bg, #0d1117)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--studio-ink, #e6edf3)'; }}
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
    try { return window.localStorage.getItem('studio.v3.accent') || '#1de9b6'; } catch (_) { return '#1de9b6'; }
  });
  // Slice 523 — apply accent to :root --studio-accent on mount + change.
  useEffect(() => {
    document.documentElement.style.setProperty('--studio-accent', accent);
    try { window.localStorage.setItem('studio.v3.accent', accent); } catch (_) {}
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
          background: 'var(--studio-bg, #0d1117)',
          border: '1px solid var(--studio-ink-mute, #1f2733)',
          borderRadius: 8, padding: '20px 24px',
          color: 'var(--studio-ink, #e6edf3)',
          fontFamily: 'inherit', fontSize: 12,
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.55)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
          <strong style={{ fontSize: 14, color: 'var(--studio-accent, #1de9b6)', letterSpacing: '0.04em' }}>Settings</strong>
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
                border: '1px solid var(--studio-ink-mute, #1f2733)',
                borderRadius: 3, cursor: 'pointer',
              }}
            />
            <span style={{ fontFamily: 'var(--studio-mono, ui-monospace)', fontSize: 11, opacity: 0.75 }}>{accent}</span>
            <button
              type="button"
              onClick={() => setAccent('#1de9b6')}
              style={{
                marginLeft: 'auto', padding: '2px 8px', fontSize: 10,
                background: 'transparent', border: '1px solid var(--studio-ink-mute, #1f2733)',
                color: 'var(--studio-ink, #e6edf3)', borderRadius: 3, cursor: 'pointer',
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
                  background: t === theme ? 'var(--studio-accent, #1de9b6)' : 'var(--studio-bg-elev, #161b22)',
                  color: t === theme ? 'var(--studio-bg, #0d1117)' : 'var(--studio-ink, #e6edf3)',
                  border: '1px solid var(--studio-ink-mute, #1f2733)',
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
                  background: s === shading ? 'var(--studio-accent, #1de9b6)' : 'var(--studio-bg-elev, #161b22)',
                  color: s === shading ? 'var(--studio-bg, #0d1117)' : 'var(--studio-ink, #e6edf3)',
                  border: '1px solid var(--studio-ink-mute, #1f2733)',
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
            style={{ width: 60, height: 28, padding: 0, border: '1px solid var(--studio-ink-mute, #1f2733)', borderRadius: 3, background: 'transparent' }}
          />
        </div>
        <button
          type="button"
          data-studio-v3-settings-close
          onClick={() => setOpen(false)}
          style={{
            display: 'block', marginLeft: 'auto',
            padding: '6px 14px',
            background: 'var(--studio-bg-elev, #161b22)',
            color: 'var(--studio-ink, #e6edf3)',
            border: '1px solid var(--studio-ink-mute, #1f2733)',
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
            background: 'var(--studio-accent, #1de9b6)',
            color: 'var(--studio-bg, #0d1117)',
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
              background: 'var(--studio-bg-elev, #1c1c20)',
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
              background: p === current ? 'var(--studio-accent, #1de9b6)' : 'var(--studio-bg-elev, #161b22)',
              color: p === current ? 'var(--studio-bg, #0d1117)' : 'var(--studio-ink, #e6edf3)',
              border: '1px solid var(--studio-ink-mute, #1f2733)',
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
          background: 'var(--studio-bg, #0d1117)',
          border: '1px solid var(--studio-ink-mute, #1f2733)',
          borderRadius: 6,
          boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
          fontFamily: 'inherit',
          color: 'var(--studio-ink, #e6edf3)',
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
            border: 'none', borderBottom: '1px solid var(--studio-ink-mute, #1f2733)',
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
                background: i === active ? 'var(--studio-bg-elev, #161b22)' : 'transparent',
                color: i === active ? 'var(--studio-accent, #1de9b6)' : 'var(--studio-ink, #e6edf3)',
                border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
                borderLeft: '3px solid ' + (i === active ? 'var(--studio-accent, #1de9b6)' : 'transparent'),
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
    ['Alt+1..9', 'Recall camera bookmark by index'],
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
          background: 'var(--studio-bg, #0d1117)',
          border: '1px solid var(--studio-ink-mute, #1f2733)',
          borderRadius: 8,
          padding: '20px 24px',
          color: 'var(--studio-ink, #e6edf3)',
          fontFamily: 'inherit', fontSize: 12,
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.55)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
          <strong style={{ fontSize: 14, color: 'var(--studio-accent, #1de9b6)', letterSpacing: '0.04em' }}>Keymap</strong>
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
            background: 'var(--studio-bg-elev, #161b22)',
            border: '1px solid var(--studio-ink-mute, #1f2733)',
            color: 'var(--studio-ink, #e6edf3)', borderRadius: 4,
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
                    color: 'var(--studio-accent, #1de9b6)', fontSize: 11,
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
        color: 'var(--studio-ink, #e6edf3)',
        border: '1px solid var(--studio-accent, #1de9b6)',
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
          background: 'var(--studio-accent, #1de9b6)',
          color: 'var(--studio-bg, #0d1117)',
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
          border: '1px solid var(--studio-ink-mute, #1f2733)',
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
        color: 'var(--studio-accent, #1de9b6)',
        border: '1px solid var(--studio-ink-mute, #1f2733)',
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
        border: '1px solid var(--studio-ink-mute, #1f2733)',
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
function AxisGizmo() {
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
        background: 'var(--studio-bg-elev, #161b22)',
        border: '1px solid var(--studio-accent, #1de9b6)',
        borderRadius: 8, padding: '18px 22px', minWidth: 340,
        boxShadow: '0 14px 40px rgba(0,0,0,0.6)',
      }}>
        <div style={{
          color: 'var(--studio-accent, #1de9b6)', fontWeight: 600, marginBottom: 10, fontSize: 13,
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
            width: '100%', background: 'var(--studio-bg, #0d1117)',
            border: '1px solid var(--studio-ink-mute, #1f2733)',
            color: 'var(--studio-ink, #e6edf3)', padding: '7px 10px',
            borderRadius: 4, fontFamily: 'var(--studio-mono, ui-monospace)',
            fontSize: 12, marginBottom: 12,
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              background: 'transparent', border: '1px solid var(--studio-ink-mute, #1f2733)',
              color: 'var(--studio-ink, #e6edf3)', padding: '5px 14px', borderRadius: 4,
              fontSize: 11, cursor: 'pointer',
            }}
          >Cancel</button>
          <button
            type="button"
            data-studio-v3-save-as-commit
            onClick={commit}
            style={{
              background: 'var(--studio-accent, #1de9b6)', border: 0, color: '#0d1117',
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
        background: 'rgba(29, 233, 182, 0.04)',
      }}
    >
      {rect && (
        <div
          data-studio-v3-marquee-rect
          style={{
            position: 'absolute', left: (rect.x), top: (rect.y),
            width: rect.w, height: rect.h,
            border: '1px dashed var(--studio-accent, #1de9b6)',
            background: 'rgba(29, 233, 182, 0.08)',
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
        background: 'var(--studio-bg-elev, #161b22)',
        border: '1px solid var(--studio-accent, #1de9b6)',
        borderRadius: 8, padding: '28px 32px', minWidth: 420, maxWidth: 520,
        boxShadow: '0 14px 40px rgba(0,0,0,0.6)',
        color: 'var(--studio-ink, #e6edf3)',
      }}>
        <div style={{
          fontSize: 18, fontWeight: 700, letterSpacing: '0.04em',
          color: 'var(--studio-accent, #1de9b6)', marginBottom: 4,
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
              background: 'var(--studio-accent, #1de9b6)', border: 0, color: '#0d1117',
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
        background: 'var(--studio-bg, #0d1117)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column',
        animation: 'studio-splash-fade 1.6s ease-in forwards',
      }}
    >
      <div style={{
        fontSize: 32, fontWeight: 700, letterSpacing: '0.06em',
        color: 'var(--studio-accent, #1de9b6)',
        textShadow: '0 0 24px rgba(29, 233, 182, 0.4)',
      }}>ArchDisc</div>
      <div style={{
        fontSize: 14, marginTop: 4, color: 'var(--studio-ink, #e6edf3)',
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
            ctx.fillStyle = (o.userData && o.userData.archdiscStudioLocked) ? '#ff7a59' : 'var(--studio-accent, #1de9b6)';
            ctx.fillStyle = (o.userData && o.userData.archdiscStudioLocked) ? '#ff7a59' : '#1de9b6';
            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fill();
          });
        } catch (_) {}
      }
      const vp = window.__archdiscViewport;
      if (vp && vp.camera) {
        const cp = vp.camera.position;
        ctx.fillStyle = '#e6edf3';
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
            background: 'var(--studio-bg-elev, #161b22)',
            borderLeft: `3px solid ${it.kind === 'warn' ? '#f1c40f' : 'var(--studio-accent, #1de9b6)'}`,
            color: 'var(--studio-ink, #e6edf3)',
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
        background: 'var(--studio-bg-elev, #161b22)',
        border: '1px solid var(--studio-accent, #1de9b6)',
        borderRadius: 8,
        padding: '14px 16px',
        color: 'var(--studio-ink, #e6edf3)',
        fontSize: 12,
        boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <span style={{ color: 'var(--studio-accent, #1de9b6)', fontWeight: 600, letterSpacing: '0.04em' }}>
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
            background: 'var(--studio-accent, #1de9b6)',
            border: 0, color: '#0d1117', fontSize: 11, fontWeight: 600,
            padding: '6px 14px', borderRadius: 4, cursor: 'pointer',
          }}
        >{step < TOUR_STEPS.length - 1 ? 'Next →' : 'Got it'}</button>
      </div>
    </div>
  );
}

function WelcomeCard() {
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
        border: '1px solid var(--studio-ink-mute, #1f2733)',
        borderRadius: 6,
        padding: '18px 22px',
        color: 'var(--studio-ink, #e6edf3)',
        fontFamily: 'inherit', fontSize: 12,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
        minWidth: 280, maxWidth: 360, textAlign: 'center',
      }}
    >
      <div style={{
        fontSize: 13, fontWeight: 600, marginBottom: 8,
        color: 'var(--studio-accent, #1de9b6)', letterSpacing: '0.03em',
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
          borderTop: '1px solid var(--studio-ink-mute, #1f2733)',
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
                background: 'transparent', border: '1px solid var(--studio-ink-mute, #1f2733)',
                color: 'var(--studio-ink, #e6edf3)', borderRadius: 3,
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
        {tab === 'inspector' && (
          <>
            <div className="studio-right-section">
              <div className="studio-right-section-title">Active</div>
              <div className="studio-right-row"><span>Discipline</span><strong style={{ textTransform: 'capitalize' }}>{activeWb}</strong></div>
              <div className="studio-right-row"><span>Mode</span><strong style={{ textTransform: 'capitalize' }}>{editMode}</strong></div>
            </div>
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
            {/* Slice 536 — Display toggles for overlays. */}
            <DisplaySection />
            {/* Slice 510 — Ambient + key intensity sliders. */}
            <LightingSection />
            {/* Slice 516 — Per-workbench Notes textarea. */}
            <NotesSection activeWb={activeWb} />
            {/* Slice 518 — Recent undo history list. */}
            <HistorySection />
            {/* Slice 542 — Renderer perf diagnostics. */}
            <PerformanceSection />
            {/* Slice 522 — Annotation list + delete. */}
            <AnnotationsSection />
            {/* Slice 538 — Reference image plate list. */}
            <ImagePlatesSection />
            {/* Slice 533 — Render section: custom-size PNG. */}
            <RenderSection />
            <div className="studio-right-section">
              <div className="studio-right-section-title">Edit selection</div>
              <SelectionRows />
            </div>
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
    background: 'var(--studio-bg-elev, #1c1c20)',
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
      <div className="studio-right-row"><span>Position</span></div>
      <div className="studio-right-row" style={{ gap: 4 }}>
        {numIn('position', 'x', m.position.x.toFixed(4))}
        {numIn('position', 'y', m.position.y.toFixed(4))}
        {numIn('position', 'z', m.position.z.toFixed(4))}
      </div>
      <div className="studio-right-row"><span>Rotation°</span></div>
      <div className="studio-right-row" style={{ gap: 4 }}>
        {numIn('rotation', 'x', (m.rotation.x * 180 / Math.PI).toFixed(2))}
        {numIn('rotation', 'y', (m.rotation.y * 180 / Math.PI).toFixed(2))}
        {numIn('rotation', 'z', (m.rotation.z * 180 / Math.PI).toFixed(2))}
      </div>
      <div className="studio-right-row"><span>Scale</span></div>
      <div className="studio-right-row" style={{ gap: 4 }}>
        {numIn('scale', 'x', m.scale.x.toFixed(4))}
        {numIn('scale', 'y', m.scale.y.toFixed(4))}
        {numIn('scale', 'z', m.scale.z.toFixed(4))}
      </div>
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
            background: 'var(--studio-bg-elev, #161b22)',
            color: 'var(--studio-ink, #e6edf3)',
            border: '1px solid var(--studio-ink-mute, #1f2733)',
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
            width: 60, background: 'var(--studio-bg, #0d1117)', border: '1px solid var(--studio-ink-mute, #1f2733)',
            color: 'var(--studio-ink, #e6edf3)', padding: '2px 6px', borderRadius: 3, fontFamily: 'var(--studio-mono, ui-monospace)',
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
            background: 'transparent', border: '1px solid var(--studio-ink-mute, #1f2733)',
            color: proj === 'ortho' ? 'var(--studio-accent, #1de9b6)' : 'var(--studio-ink, #e6edf3)',
            padding: '2px 8px', borderRadius: 3, fontSize: 11, cursor: 'pointer', textTransform: 'capitalize',
          }}
        >{proj}</button>
      </div>
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
            width: 64, background: 'var(--studio-bg, #0d1117)',
            border: '1px solid var(--studio-ink-mute, #1f2733)',
            color: 'var(--studio-ink, #e6edf3)', padding: '2px 6px', borderRadius: 3,
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
            width: 64, background: 'var(--studio-bg, #0d1117)',
            border: '1px solid var(--studio-ink-mute, #1f2733)',
            color: 'var(--studio-ink, #e6edf3)', padding: '2px 6px', borderRadius: 3,
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
              background: 'transparent', color: 'var(--studio-ink, #e6edf3)',
              border: '1px solid var(--studio-ink-mute, #1f2733)', borderRadius: 3, cursor: 'pointer',
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
          background: 'var(--studio-accent, #1de9b6)', border: 0, color: '#0d1117',
          fontWeight: 600, padding: '5px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
        }}
      >Render → PNG</button>
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
          <span style={{ flex: 1, color: 'var(--studio-ink, #e6edf3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
          <span style={{ flex: 1, color: 'var(--studio-ink, #e6edf3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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

// Slice 542 — Renderer / scene perf diagnostics. Polls renderer.info
// every second so the panel stays cheap.
function PerformanceSection() {
  const [info, setInfo] = useState({ calls: 0, tris: 0, points: 0, lines: 0, geom: 0, tex: 0, programs: 0 });
  useEffect(() => {
    const read = () => {
      const vp = window.__archdiscViewport;
      if (!vp || !vp.renderer || !vp.renderer.info) return;
      const r = vp.renderer.info;
      setInfo({
        calls: r.render.calls,
        tris: r.render.triangles,
        points: r.render.points,
        lines: r.render.lines,
        geom: r.memory.geometries,
        tex: r.memory.textures,
        programs: (r.programs && r.programs.length) || 0,
      });
    };
    const id = setInterval(read, 1000);
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
            borderLeft: i === 0 ? '2px solid var(--studio-accent, #1de9b6)' : '2px solid transparent',
          }}
        >
          <span style={{ color: i === 0 ? 'var(--studio-ink, #e6edf3)' : 'inherit' }}>{e.label || 'edit'}</span>
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
          background: 'var(--studio-bg-elev, #161b22)',
          border: '1px solid var(--studio-ink-mute, #1f2733)',
          color: 'var(--studio-ink, #e6edf3)', borderRadius: 3,
          fontFamily: 'inherit', fontSize: 11, resize: 'vertical',
          outline: 'none',
        }}
      />
    </div>
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
            background: 'var(--studio-bg, #0d1117)',
            border: '1px solid var(--studio-ink-mute, #1f2733)',
            color: 'var(--studio-ink, #e6edf3)', borderRadius: 3,
            fontFamily: 'inherit',
          }}
        />
        <button
          type="button"
          onClick={save}
          data-studio-v3-camera-bookmark-save
          style={{
            background: 'var(--studio-accent, #1de9b6)', border: 0, color: '#0d1117',
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
              background: 'var(--studio-bg-elev, #161b22)',
              color: 'var(--studio-ink, #e6edf3)',
              border: '1px solid var(--studio-ink-mute, #1f2733)',
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
    { id: 'grid', label: 'Grid', defaultOn: true, onChange: (v) => { if (window.__studioSetGridVisible) window.__studioSetGridVisible(v); } },
    { id: 'minimap', label: 'Minimap', defaultOn: true, onChange: (v) => { const el = document.querySelector('[data-studio-v3-minimap]'); if (el) el.style.display = v ? '' : 'none'; } },
    { id: 'watermark', label: 'Watermark', defaultOn: true, onChange: (v) => { const el = document.querySelector('[data-studio-v3-watermark]'); if (el) el.style.display = v ? '' : 'none'; } },
    { id: 'archie-status', label: 'Archie dot', defaultOn: true, onChange: (v) => { const el = document.querySelector('[data-studio-v3-archie-status]'); if (el) el.style.display = v ? '' : 'none'; } },
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
    </div>
  );
}

// Slice 508 — World section. Edits grid extent + canvas background tint.
function WorldSection() {
  const [grid, setGrid] = useState(1);
  const [bg, setBg] = useState('#0d1117');
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
            width: 64, background: 'var(--studio-bg, #0d1117)', border: '1px solid var(--studio-ink-mute, #1f2733)',
            color: 'var(--studio-ink, #e6edf3)', padding: '2px 6px', borderRadius: 3,
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
            width: 32, height: 18, padding: 0, border: '1px solid var(--studio-ink-mute, #1f2733)',
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
          width: 50, background: 'var(--studio-bg, #0d1117)', border: '1px solid var(--studio-ink-mute, #1f2733)',
          color: 'var(--studio-ink, #e6edf3)', padding: '2px 5px', borderRadius: 3,
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
            background: 'transparent', border: '1px solid var(--studio-ink-mute, #1f2733)',
            color: on ? 'var(--studio-accent, #1de9b6)' : 'var(--studio-ink, #e6edf3)',
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
              background: 'var(--studio-bg-elev, #161b22)',
              color: 'var(--studio-ink, #e6edf3)',
              border: '1px solid var(--studio-ink-mute, #1f2733)',
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
      setStats({
        v, t, area, bboxVolume,
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
          <span style={{ flex: 1 }}>Layer {i}</span>
          <button
            type="button"
            data-studio-v3-layer-solo={i}
            onClick={() => solo(i)}
            title="Isolate (solo)"
            style={{
              padding: '1px 6px', fontSize: 10,
              background: 'var(--studio-bg-elev, #161b22)',
              color: 'var(--studio-ink, #e6edf3)',
              border: '1px solid var(--studio-ink-mute, #1f2733)',
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
            background: 'var(--studio-bg-elev, #161b22)',
            color: 'var(--studio-ink, #e6edf3)',
            border: '1px solid var(--studio-ink-mute, #1f2733)',
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
            background: 'var(--studio-bg-elev, #1c1c20)',
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
              borderLeft: '2px solid ' + (active ? 'var(--studio-accent, #1de9b6)' : 'transparent'),
              paddingLeft: 6 + (it.depth || 0) * 12,
            }}
          >
            <span style={{
              flex: 1, textTransform: 'capitalize',
              color: it.kind === 'group' ? 'var(--studio-accent, #1de9b6)' : 'inherit',
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
                color: it.locked ? 'var(--studio-accent, #1de9b6)' : 'var(--studio-ink-mute)',
                border: '1px solid ' + (it.locked ? 'var(--studio-accent, #1de9b6)' : 'var(--studio-ink-mute)'),
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
        background: 'var(--studio-bg-elev, #161b22)',
        borderTop: '1px solid var(--studio-ink-mute, #1f2733)',
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
          background: 'var(--studio-accent, #1de9b6)',
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
        color: n > 0 ? 'var(--studio-accent, #1de9b6)' : 'var(--studio-ink-mute, #9aa6b2)',
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
        <path d={path} fill="none" stroke="var(--studio-accent, #1de9b6)" strokeWidth="1" strokeLinejoin="round" />
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
        color: on ? 'var(--studio-accent, #1de9b6)' : 'var(--studio-ink-mute, #9aa6b2)',
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
        color: depth > 0 ? 'var(--studio-accent, #1de9b6)' : 'var(--studio-ink-mute, #9aa6b2)',
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
        color: dirty ? 'var(--studio-accent, #1de9b6)' : 'var(--studio-ink-mute, #9aa6b2)',
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: 3,
        background: dirty ? 'var(--studio-accent, #1de9b6)' : 'transparent',
        border: '1px solid ' + (dirty ? 'var(--studio-accent, #1de9b6)' : 'var(--studio-ink-mute, #9aa6b2)'),
      }} />
      {dirty ? 'modified' : 'saved'}
    </span>
  );
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

function CommandBar({ onSubmit }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="studio-cmdbar" data-studio-v3-cmdbar>
      <span className="studio-cmdbar-glyph" title="Archie">◐</span>
      <input
        ref={ref}
        className="studio-cmdbar-input"
        data-studio-v3-cmdbar-input
        placeholder="Ask Archie — or type a Studio API: studioListSceneStats / studioExtrudeSelectedFaces 0.005"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.currentTarget.value.trim()) {
            const v = e.currentTarget.value.trim();
            e.currentTarget.value = '';
            onSubmit && onSubmit(v);
          }
        }}
      />
      <span className="studio-cmdbar-hint">
        <kbd>⌘K</kbd>
      </span>
    </div>
  );
}

// ─── ArchieThread (inline strip above cmdbar) ─────────────────────────────
// Slice 407 — replaces the right-side ArchieDock. Archie now lives ONLY
// at the bottom of the shell so its surface area matches Forge exactly.
// When there are messages the strip slides up above the cmdbar showing
// the most recent 8 entries; user can clear to collapse.
function ArchieThread({ thread, onClear }) {
  if (!thread.length) return null;
  return (
    <div className="studio-archie-thread" data-studio-v3-archie-thread>
      <div className="studio-archie-thread-head">
        <span className="studio-archie-thread-spark">◐</span>
        <span>Archie · {thread.length}</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="studio-archie-thread-clear"
          data-studio-v3-archie-clear
          onClick={onClear}
          title="Clear thread"
        ><Icon name="close" size={11} /></button>
      </div>
      <div className="studio-archie-thread-body">
        {thread.slice(-8).map((m, i) => (
          <div key={i} className="studio-archie-msg" data-role={m.role}>{m.text}</div>
        ))}
      </div>
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
        // Slice 429 — G/R/S set active transform tool (Blender muscle memory).
        // Honors text inputs.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const map = { g: 'move', r: 'rotate', s: 'scale' };
        setActiveTool(map[e.key]);
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

  const onCmdSubmit = (text) => {
    // Direct V3-API call path — any `studioFoo arg1 arg2` runs the API
    // and pushes the result. Thread strip auto-opens.
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
    setThread((t) => [...t, { role: 'user', text }, { role: 'archie', text: `(NL routing wired in a follow-up) — heard: "${text}"` }]);
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
            } else if (window.__studioToast) {
              window.__studioToast(`Skipped ${f.name} (unsupported)`, 'warn');
            }
          }
        }}
      >
        <ViewportWatermark />
        <ViewportMinimap />
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
      <ArchieThread thread={thread} onClear={() => setThread([])} />
      <CommandBar onSubmit={onCmdSubmit} />
      <OnboardingTour />
      <ToastBus />
      <MarqueeOverlay />
      <SaveAsModal />
      <AboutModal />
      <SplashScreen />
      <SectionCollapser />
      <DocTitle activeWb={activeWb} />
    </div>
  );
}

export default StudioShellV3;
