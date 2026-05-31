import React, { useState, useEffect } from 'react';
import { tokens, edgeLight, accentRing } from './theme';
import { StudioMark, StudioWordmark } from './StudioLogo';
import { Icon } from './Icons';

// ArchDisc Studio V3 — top-level shell.
//
// Topology (keeps V2 mental model but refreshed placements):
//
//   ┌──────────────────────────────────────────────────────────────────┐
//   │  HeaderBar   logo · discipline tabs · spacer · workspace · u/r   │
//   ├──┬───────────────────────────────────────────────────────┬───────┤
//   │  │  ViewportHeader  mode pill · tools · stats · axes     │       │
//   │  │  ──────────────────────────────────────────────────   │       │
//   │  │                                                       │       │
//   │RB│           CANVAS (Three.js viewport)                  │ NPnl  │
//   │  │                                                       │       │
//   │  │  ViewportFooter   coords · fps · frame · archie portal│       │
//   ├──┴───────────────────────────────────────────────────────┴───────┤
//   │  StatusBar   discipline · primitives · lights · selection · time │
//   └──────────────────────────────────────────────────────────────────┘
//
// Differences from V2:
//   • No big top-strip menubar — collapsed into the HeaderBar.
//   • Discipline tabs are inline at the top (icon + label, refreshed
//     custom-authored marks from Icons.jsx) — not a separate side rail.
//   • The viewport gets its own dedicated header/footer strip so the
//     canvas owns the central real estate.
//   • Left rail is a slim icon-only column (primary tool palette), not a
//     wide button strip — gives the viewport ~30% more horizontal space.
//   • N-panel collapses to a 24px rail (preserves access without
//     stealing room).
//   • All chrome uses theme.js tokens so a single light/dark flip works.
//
// The shell mounts INSIDE the existing WorkbenchStudio.jsx behind a
// `?v3=1` URL flag — V2 stays the default; subsequent slices migrate
// V2 pieces into V3 then delete V2.

const DISCIPLINES = [
  { id: 'model',  label: 'Model',  icon: 'disc-model' },
  { id: 'sculpt', label: 'Sculpt', icon: 'disc-sculpt' },
  { id: 'paint',  label: 'Paint',  icon: 'disc-paint' },
  { id: 'shade',  label: 'Shade',  icon: 'disc-shade' },
  { id: 'anim',   label: 'Anim',   icon: 'disc-anim' },
  { id: 'rig',    label: 'Rig',    icon: 'disc-rig' },
  { id: 'render', label: 'Render', icon: 'disc-render' },
  { id: 'fx',     label: 'FX',     icon: 'disc-fx' },
  { id: 'world',  label: 'World',  icon: 'disc-world' },
  { id: 'nurbs',  label: 'NURBS',  icon: 'disc-nurbs' },
  { id: 'phys',   label: 'Physics',icon: 'disc-phys' },
  { id: 'audio',  label: 'Audio',  icon: 'disc-audio' },
  { id: 'xr',     label: 'XR',     icon: 'disc-xr' },
  { id: 'script', label: 'Script', icon: 'disc-script' },
  { id: 'archie', label: 'Archie', icon: 'disc-archie' },
];

const TOOLS = [
  { id: 'select', label: 'Select', icon: 'select' },
  { id: 'move',   label: 'Move',   icon: 'move' },
  { id: 'rotate', label: 'Rotate', icon: 'rotate' },
  { id: 'scale',  label: 'Scale',  icon: 'scale' },
];

const EDIT_MODES = [
  { id: 'object', label: 'Object', icon: 'object-mode' },
  { id: 'vertex', label: 'Vertex', icon: 'vertex-mode' },
  { id: 'edge',   label: 'Edge',   icon: 'edge-mode' },
  { id: 'face',   label: 'Face',   icon: 'face-mode' },
  { id: 'sculpt', label: 'Sculpt', icon: 'sculpt-mode' },
];

// ─── HeaderBar ────────────────────────────────────────────────────────────
function HeaderBar({ t, discipline, setDiscipline }) {
  return (
    <div
      data-studio-v3-header
      style={{
        height: 40,
        background: t['ink-1'],
        borderBottom: `1px solid ${t['ink-4']}`,
        display: 'flex',
        alignItems: 'stretch',
        flexShrink: 0,
        boxShadow: edgeLight(t),
        position: 'relative',
        zIndex: t.z.header,
      }}
    >
      {/* Logo lockup */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px', borderRight: `1px solid ${t['ink-4']}` }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <StudioMark size={20} ink={t['fg-1']} />
          <StudioWordmark size={13} color={t['fg-1']} />
        </div>
      </div>
      {/* Discipline tabs — inline, horizontally scrollable on narrow screens */}
      <div
        data-studio-v3-discipline-rail
        style={{
          display: 'flex',
          alignItems: 'stretch',
          flex: 1,
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        {DISCIPLINES.map((d) => {
          const active = d.id === discipline;
          return (
            <button
              key={d.id}
              type="button"
              data-studio-v3-discipline={d.id}
              data-studio-v3-discipline-active={active ? '1' : '0'}
              onClick={() => setDiscipline(d.id)}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${active ? t.base : 'transparent'}`,
                color: active ? t['fg-1'] : t['fg-2'],
                padding: '0 14px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontFamily: t.font.sans,
                fontSize: 11,
                fontWeight: active ? 600 : 500,
                letterSpacing: '0.02em',
                cursor: 'pointer',
                transition: `color ${t.motion.fast.duration}ms ${t.motion.fast.easing}, border-color ${t.motion.fast.duration}ms ${t.motion.fast.easing}`,
                whiteSpace: 'nowrap',
              }}
            >
              <Icon name={d.icon} size={16} color={active ? t.base : t['fg-2']} />
              {d.label}
            </button>
          );
        })}
      </div>
      {/* Right-side utility cluster */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px', borderLeft: `1px solid ${t['ink-4']}` }}>
        <HeaderIconBtn t={t} icon="undo" label="Undo" />
        <HeaderIconBtn t={t} icon="redo" label="Redo" />
        <div style={{ width: 1, height: 18, background: t['ink-4'], margin: '0 6px' }} />
        <HeaderIconBtn t={t} icon="settings" label="Settings" />
      </div>
    </div>
  );
}

function HeaderIconBtn({ t, icon, label, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      title={label}
      data-studio-v3-header-btn={icon}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 26, height: 26,
        background: hover ? t['ink-3'] : 'transparent',
        border: `1px solid ${hover ? t['ink-4'] : 'transparent'}`,
        borderRadius: t.radius.chip,
        color: t['fg-2'],
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
        transition: `all ${t.motion.fast.duration}ms ${t.motion.fast.easing}`,
      }}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

// ─── ToolRail ─────────────────────────────────────────────────────────────
function ToolRail({ t, tool, setTool }) {
  return (
    <div
      data-studio-v3-tool-rail
      style={{
        width: 36,
        background: t['ink-1'],
        borderRight: `1px solid ${t['ink-4']}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '8px 0',
        gap: 2,
        flexShrink: 0,
        zIndex: t.z.ribbon,
      }}
    >
      {TOOLS.map((tl) => {
        const active = tl.id === tool;
        return (
          <button
            key={tl.id}
            type="button"
            data-studio-v3-tool={tl.id}
            data-studio-v3-tool-active={active ? '1' : '0'}
            title={tl.label}
            onClick={() => setTool(tl.id)}
            style={{
              width: 28, height: 28,
              background: active ? t.base : 'transparent',
              border: `1px solid ${active ? t.base : 'transparent'}`,
              borderRadius: t.radius.chip,
              color: active ? t['ink-0'] : t['fg-2'],
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              transition: `all ${t.motion.fast.duration}ms ${t.motion.fast.easing}`,
            }}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = t['ink-3']; }}
            onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
          >
            <Icon name={tl.icon} size={16} />
          </button>
        );
      })}
    </div>
  );
}

// ─── ViewportHeader (mode pill + axes) ──────────────────────────────────
function ViewportHeader({ t, editMode, setEditMode }) {
  return (
    <div
      data-studio-v3-viewport-header
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        height: 30,
        background: `linear-gradient(180deg, ${t['ink-1']} 0%, rgba(8,9,11,0.4) 100%)`,
        borderBottom: `1px solid ${t['ink-4']}`,
        display: 'flex', alignItems: 'center',
        gap: 8, padding: '0 12px',
        zIndex: 22,
        fontFamily: t.font.sans, fontSize: 11, color: t['fg-2'],
      }}
    >
      <span style={{ opacity: 0.6, fontWeight: 500 }}>Viewport</span>
      <span style={{ opacity: 0.3 }}>·</span>
      <div style={{ display: 'flex', gap: 1 }}>
        {EDIT_MODES.map((em) => {
          const active = em.id === editMode;
          return (
            <button
              key={em.id}
              type="button"
              data-studio-v3-edit-mode={em.id}
              data-studio-v3-edit-mode-active={active ? '1' : '0'}
              title={em.label}
              onClick={() => setEditMode(em.id)}
              style={{
                background: active ? t.base : 'transparent',
                color: active ? t['ink-0'] : t['fg-2'],
                border: `1px solid ${active ? t.base : t['ink-4']}`,
                borderRadius: t.radius.chip,
                padding: '2px 8px', cursor: 'pointer',
                fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
                textTransform: 'uppercase',
                fontFamily: t.font.sans,
                display: 'inline-flex', alignItems: 'center', gap: 4,
                transition: `all ${t.motion.fast.duration}ms ${t.motion.fast.easing}`,
              }}
            >
              <Icon name={em.icon} size={11} />
              {em.label}
            </button>
          );
        })}
      </div>
      <span style={{ flex: 1 }} />
      {/* Axis chips — top/front/side/persp */}
      <div style={{ display: 'flex', gap: 0 }}>
        {['T', 'F', 'S', 'P'].map((ax) => (
          <button
            key={ax}
            type="button"
            data-studio-v3-axis={ax.toLowerCase()}
            style={{
              width: 22, height: 20,
              background: 'transparent', color: t['fg-2'],
              border: `1px solid ${t['ink-4']}`, borderRadius: 0,
              fontFamily: t.font.mono, fontSize: 10, fontWeight: 600,
              cursor: 'pointer',
              transition: `all ${t.motion.fast.duration}ms ${t.motion.fast.easing}`,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = t['ink-3']; e.currentTarget.style.color = t['fg-1']; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = t['fg-2']; }}
          >{ax}</button>
        ))}
      </div>
    </div>
  );
}

// ─── NPanel rail (collapsed sidebar) ──────────────────────────────────────
function NPanelRail({ t, onExpand }) {
  return (
    <div
      data-studio-v3-npanel-rail
      style={{
        width: 28,
        background: t['ink-1'],
        borderLeft: `1px solid ${t['ink-4']}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '8px 0',
        flexShrink: 0,
        zIndex: t.z.npanel,
      }}
    >
      <button
        type="button"
        data-studio-v3-npanel-expand
        title="Open N-panel"
        onClick={onExpand}
        style={{
          width: 22, height: 22,
          background: 'transparent', color: t['fg-2'],
          border: 'none', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Icon name="npanel" size={14} />
      </button>
    </div>
  );
}

// ─── NPanel (expanded sidebar) ────────────────────────────────────────────
function NPanel({ t, onCollapse, discipline, editMode }) {
  return (
    <div
      data-studio-v3-npanel
      style={{
        width: 260,
        background: t['ink-1'],
        borderLeft: `1px solid ${t['ink-4']}`,
        display: 'flex', flexDirection: 'column',
        flexShrink: 0,
        zIndex: t.z.npanel,
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 30, padding: '0 12px', borderBottom: `1px solid ${t['ink-4']}`,
        fontFamily: t.font.sans, fontSize: 11, fontWeight: 600, color: t['fg-1'],
        letterSpacing: '0.04em', textTransform: 'uppercase',
      }}>
        <span>Inspector</span>
        <button
          type="button"
          data-studio-v3-npanel-collapse
          onClick={onCollapse}
          style={{
            width: 18, height: 18,
            background: 'transparent', border: 'none',
            color: t['fg-2'], cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        ><Icon name="close" size={12} /></button>
      </div>
      <div style={{ flex: 1, padding: 12, overflowY: 'auto', fontFamily: t.font.sans, fontSize: 11, color: t['fg-2'] }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: t['fg-3'], marginBottom: 6 }}>Discipline</div>
          <div style={{ color: t['fg-1'], fontSize: 12, fontWeight: 500, textTransform: 'capitalize' }}>{discipline}</div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: t['fg-3'], marginBottom: 6 }}>Edit mode</div>
          <div style={{ color: t['fg-1'], fontSize: 12, fontWeight: 500, textTransform: 'capitalize' }}>{editMode}</div>
        </div>
        <div style={{ marginBottom: 14, color: t['fg-3'], fontSize: 10, fontStyle: 'italic' }}>
          Discipline-specific inspectors load in slice 394+.
        </div>
      </div>
    </div>
  );
}

// ─── StatusBar ────────────────────────────────────────────────────────────
function StatusBar({ t, discipline, editMode }) {
  return (
    <div
      data-studio-v3-status-bar
      style={{
        height: 24,
        background: t['ink-1'],
        borderTop: `1px solid ${t['ink-4']}`,
        display: 'flex', alignItems: 'center',
        gap: 16, padding: '0 12px',
        fontFamily: t.font.mono, fontSize: 10, color: t['fg-2'],
        flexShrink: 0,
        boxShadow: edgeLight(t),
        zIndex: t.z.status,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <StudioMark size={12} ink={t['fg-1']} />
        <span style={{ color: t['fg-1'], fontWeight: 600, letterSpacing: '0.05em' }}>STUDIO</span>
      </span>
      <span data-studio-v3-status="discipline" style={{ textTransform: 'capitalize' }}>{discipline}</span>
      <span data-studio-v3-status="mode" style={{ textTransform: 'capitalize' }}>· {editMode}</span>
      <span style={{ flex: 1 }} />
      <span data-studio-v3-status="ready" style={{ color: t.base }}>● ready</span>
    </div>
  );
}

// ─── Top-level shell ──────────────────────────────────────────────────────
export function StudioShellV3({ mode = 'dark' }) {
  const t = tokens(mode);
  const [discipline, setDiscipline] = useState('model');
  const [tool, setTool] = useState('select');
  const [editMode, setEditMode] = useState('object');
  const [npanelOpen, setNpanelOpen] = useState(true);

  // Mirror to existing V2 window APIs so the e2e suite keeps working.
  useEffect(() => {
    if (window.__studioSetEditMode && editMode && window.__studioGetEditMode && window.__studioGetEditMode() !== editMode) {
      window.__studioSetEditMode(editMode);
    }
  }, [editMode]);

  return (
    <div
      data-studio-v3-shell
      data-studio-v3-mode={mode}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: t['ink-0'],
        color: t['fg-1'],
        fontFamily: t.font.sans,
        fontSize: 12,
        overflow: 'hidden',
      }}
    >
      <HeaderBar t={t} discipline={discipline} setDiscipline={setDiscipline} />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <ToolRail t={t} tool={tool} setTool={setTool} />
        <main
          data-studio-v3-viewport
          style={{ flex: 1, position: 'relative', background: t['ink-0'], minWidth: 0 }}
        >
          <ViewportHeader t={t} editMode={editMode} setEditMode={setEditMode} />
          {/* Viewport canvas mounts here. V2 renderer still owns this surface
              during the rollout; later slices wire it through V3 directly. */}
          <div style={{ position: 'absolute', inset: 0, top: 30, pointerEvents: 'none' }}>
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              color: t['fg-3'], fontFamily: t.font.mono, fontSize: 10,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              opacity: 0.4,
              pointerEvents: 'none',
            }}>v3 shell · viewport surface owned by canvas</div>
          </div>
        </main>
        {npanelOpen
          ? <NPanel t={t} onCollapse={() => setNpanelOpen(false)} discipline={discipline} editMode={editMode} />
          : <NPanelRail t={t} onExpand={() => setNpanelOpen(true)} />
        }
      </div>
      <StatusBar t={t} discipline={discipline} editMode={editMode} />
    </div>
  );
}

export default StudioShellV3;
