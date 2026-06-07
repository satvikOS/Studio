import React from 'react';

// ArchDisc Studio V3 — custom SVG icon system.
//
// Every icon is hand-authored as a single inline SVG path. ViewBox is
// 24×24, stroke 1.5px, square caps + joins (engineering precision; no
// Apple-roundness). One colour drives every stroke; opacity drives state
// (1 = active, 0.65 = idle, 0.35 = disabled). Filled variants are
// reserved for active toggle chips (call with `filled`).
//
// Convention: every icon component takes (size, color, strokeWidth,
// filled). Defaults are size=16, color='currentColor', strokeWidth=1.5,
// filled=false. ALL icons render `data-studio-icon={NAME}` so e2e tests
// can locate them deterministically.
//
// To add a new icon: copy an existing one, change the NAME prop, swap
// the <path>. Keep stroke 1.5, viewBox 24, no fills unless `filled`.

const wrap = (name, children, props = {}) => {
  const { size = 16, color = 'currentColor', strokeWidth = 1.5, filled = false, ...rest } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? color : 'none'}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      xmlns="http://www.w3.org/2000/svg"
      data-studio-icon={name}
      style={{ display: 'block', flexShrink: 0 }}
      {...rest}
    >
      {children}
    </svg>
  );
};

// ─── PRIMITIVES (10) ─────────────────────────────────────────────────────
export const IconCube     = (p) => wrap('cube', <>
  <path d="M12 3.5 4 7.5v9l8 4 8-4v-9z" />
  <path d="M4 7.5 12 11.5 20 7.5" />
  <path d="M12 11.5 V20.5" />
</>, p);
export const IconSphere   = (p) => wrap('sphere', <>
  <circle cx="12" cy="12" r="8" />
  <ellipse cx="12" cy="12" rx="8" ry="3" />
  <path d="M12 4 V20" />
</>, p);
export const IconPlane    = (p) => wrap('plane', <>
  <path d="M3 15 L21 15 L17 9 L7 9 Z" />
</>, p);
export const IconCylinder = (p) => wrap('cylinder', <>
  <ellipse cx="12" cy="6" rx="6" ry="2" />
  <path d="M6 6 V18" /><path d="M18 6 V18" />
  <ellipse cx="12" cy="18" rx="6" ry="2" />
</>, p);
export const IconCone     = (p) => wrap('cone', <>
  <path d="M12 4 L19 19 L5 19 Z" />
  <ellipse cx="12" cy="19" rx="7" ry="1.5" />
</>, p);
export const IconTorus    = (p) => wrap('torus', <>
  <ellipse cx="12" cy="12" rx="8" ry="4" />
  <ellipse cx="12" cy="12" rx="4" ry="1.6" />
</>, p);
export const IconIcosahedron = (p) => wrap('icosahedron', <>
  <path d="M12 3 L20 9 L17 18 L7 18 L4 9 Z" />
  <path d="M12 3 L17 18 M12 3 L7 18 M4 9 L20 9" />
</>, p);
export const IconText     = (p) => wrap('text', <>
  <path d="M6 7 V5 H18 V7" />
  <path d="M12 5 V19" />
  <path d="M9 19 H15" />
</>, p);
export const IconCurve    = (p) => wrap('curve', <>
  <path d="M4 18 C 8 18, 8 6, 12 6 S 16 18, 20 18" />
  <circle cx="4" cy="18" r="1.4" fill="currentColor" />
  <circle cx="20" cy="18" r="1.4" fill="currentColor" />
</>, p);
export const IconEmpty    = (p) => wrap('empty', <>
  <path d="M12 4 V20 M4 12 H20 M6.5 6.5 L17.5 17.5 M17.5 6.5 L6.5 17.5" strokeOpacity="0.6" />
</>, p);

// ─── TRANSFORM TOOLS (5) ──────────────────────────────────────────────────
export const IconSelect   = (p) => wrap('select', <>
  <path d="M5 3 L5 18 L9.5 14.5 L12 20 L14 19 L11.5 13.5 L17 13 Z" />
</>, p);
export const IconMove     = (p) => wrap('move', <>
  <path d="M12 3 V21 M3 12 H21 M12 3 L9 6 M12 3 L15 6 M12 21 L9 18 M12 21 L15 18 M3 12 L6 9 M3 12 L6 15 M21 12 L18 9 M21 12 L18 15" />
</>, p);
export const IconRotate   = (p) => wrap('rotate', <>
  <path d="M20 12 a 8 8 0 1 1 -3.5 -6.6" />
  <path d="M20 4 V9 H15" />
</>, p);
export const IconScale    = (p) => wrap('scale', <>
  <path d="M5 19 L19 5" />
  <path d="M5 19 L5 13 M5 19 L11 19" />
  <path d="M19 5 L19 11 M19 5 L13 5" />
</>, p);
export const IconTransform = (p) => wrap('transform', <>
  <rect x="4" y="4" width="16" height="16" />
  <path d="M4 4 L20 20 M20 4 L4 20" strokeOpacity="0.4" />
  <circle cx="12" cy="12" r="1.4" fill="currentColor" />
</>, p);

// ─── EDIT MODES (5) ──────────────────────────────────────────────────────
export const IconObjectMode = (p) => wrap('object-mode', <>
  <rect x="4" y="4" width="16" height="16" />
</>, p);
export const IconVertexMode = (p) => wrap('vertex-mode', <>
  <rect x="4" y="4" width="16" height="16" strokeOpacity="0.45" />
  <circle cx="4" cy="4" r="1.6" fill="currentColor" />
  <circle cx="20" cy="4" r="1.6" fill="currentColor" />
  <circle cx="4" cy="20" r="1.6" fill="currentColor" />
  <circle cx="20" cy="20" r="1.6" fill="currentColor" />
</>, p);
export const IconEdgeMode   = (p) => wrap('edge-mode', <>
  <rect x="4" y="4" width="16" height="16" strokeOpacity="0.45" />
  <path d="M4 4 L20 4" strokeWidth="2.5" />
</>, p);
export const IconFaceMode   = (p) => wrap('face-mode', <>
  <rect x="4" y="4" width="16" height="16" strokeOpacity="0.45" />
  <rect x="7" y="7" width="10" height="10" fill="currentColor" fillOpacity="0.4" />
</>, p);
export const IconSculptMode = (p) => wrap('sculpt-mode', <>
  <circle cx="12" cy="12" r="6" />
  <circle cx="12" cy="12" r="9" strokeOpacity="0.4" strokeDasharray="2 2" />
</>, p);

// ─── MESH OPS (5) ────────────────────────────────────────────────────────
export const IconExtrude  = (p) => wrap('extrude', <>
  <rect x="3.5" y="11" width="7" height="9" strokeOpacity="0.5" />
  <rect x="13.5" y="4" width="7" height="9" />
  <path d="M10.5 13.5 L13.5 10.5 M10.5 19.5 L13.5 16.5" strokeOpacity="0.45" />
</>, p);
export const IconInset    = (p) => wrap('inset', <>
  <rect x="3" y="3" width="18" height="18" />
  <rect x="8" y="8" width="8" height="8" strokeOpacity="0.55" />
</>, p);
export const IconSubdivide = (p) => wrap('subdivide', <>
  <rect x="4" y="4" width="16" height="16" />
  <path d="M4 12 H20 M12 4 V20" />
</>, p);
export const IconBevel    = (p) => wrap('bevel', <>
  <path d="M4 20 L4 8 L8 4 L20 4" />
  <path d="M4 20 L20 20 L20 4" strokeOpacity="0.55" />
</>, p);
export const IconMirror   = (p) => wrap('mirror', <>
  <path d="M12 3 V21" strokeDasharray="2 2" />
  <path d="M4 8 L4 16 L10 16 L10 8 Z" />
  <path d="M20 8 L20 16 L14 16 L14 8 Z" strokeOpacity="0.55" />
</>, p);

// ─── VIEW (4) ─────────────────────────────────────────────────────────────
export const IconCamera = (p) => wrap('camera', <>
  <rect x="3" y="7" width="14" height="11" />
  <path d="M17 11 L21 8 L21 17 L17 14 Z" />
</>, p);
export const IconLight  = (p) => wrap('light', <>
  <path d="M9 14 A4 4 0 1 1 15 14" />
  <path d="M10 14 V18 H14 V14" />
  <path d="M12 3 V5 M19 12 H21 M3 12 H5 M17 7 L18.5 5.5 M5.5 5.5 L7 7" strokeOpacity="0.6" />
</>, p);
export const IconMaterial = (p) => wrap('material', <>
  <circle cx="12" cy="12" r="8" />
  <path d="M12 4 A8 8 0 0 1 12 20" fill="currentColor" fillOpacity="0.35" />
</>, p);
export const IconEye = (p) => wrap('eye', <>
  <path d="M2.5 12 C 6 5, 18 5, 21.5 12 C 18 19, 6 19, 2.5 12 Z" />
  <circle cx="12" cy="12" r="3" />
</>, p);

// ─── ACTIONS (4) ──────────────────────────────────────────────────────────
export const IconUndo = (p) => wrap('undo', <>
  <path d="M9 7 L4 12 L9 17" />
  <path d="M4 12 H14 a5 5 0 0 1 5 5 V19" />
</>, p);
export const IconRedo = (p) => wrap('redo', <>
  <path d="M15 7 L20 12 L15 17" />
  <path d="M20 12 H10 a5 5 0 0 0 -5 5 V19" />
</>, p);
export const IconPlay = (p) => wrap('play', <>
  <path d="M6 4 L20 12 L6 20 Z" />
</>, p);
export const IconPause = (p) => wrap('pause', <>
  <rect x="6" y="4" width="4" height="16" />
  <rect x="14" y="4" width="4" height="16" />
</>, p);

// ─── DISCIPLINES (8 placeholders, will grow to 15) ───────────────────────
// One glyph per discipline tab. Each glyph riffs on the discipline's
// classic affordance — a polygon mesh for Model, a sculpting fingerprint
// for Sculpt, a wave for Animate, a frame for Render, etc.
export const IconDiscModel    = (p) => wrap('disc-model', <>
  <path d="M12 3 L21 8 L21 16 L12 21 L3 16 L3 8 Z" />
  <path d="M3 8 L12 13 L21 8 M12 13 V21" strokeOpacity="0.55" />
</>, p);
export const IconDiscSculpt   = (p) => wrap('disc-sculpt', <>
  <path d="M4 16 C 6 12, 8 10, 12 10 S 18 12, 20 16" />
  <path d="M4 16 C 6 18, 8 19, 12 19 S 18 18, 20 16" strokeOpacity="0.55" />
  <circle cx="12" cy="14" r="1.4" fill="currentColor" />
</>, p);
export const IconDiscPaint    = (p) => wrap('disc-paint', <>
  <path d="M4 16 L13 7 L17 11 L8 20 Z" />
  <path d="M13 7 L17 3 L20 6 L17 11" />
</>, p);
export const IconDiscAnim     = (p) => wrap('disc-anim', <>
  <path d="M3 18 C 6 18, 6 6, 12 6 S 18 18, 21 18" />
  <circle cx="3" cy="18" r="1.4" fill="currentColor" />
  <circle cx="12" cy="6" r="1.4" fill="currentColor" />
  <circle cx="21" cy="18" r="1.4" fill="currentColor" />
</>, p);
export const IconDiscRender   = (p) => wrap('disc-render', <>
  <rect x="3" y="5" width="18" height="14" />
  <path d="M3 5 L21 19 M21 5 L3 19" strokeOpacity="0.35" />
  <circle cx="12" cy="12" r="3" fill="currentColor" fillOpacity="0.4" />
</>, p);
export const IconDiscShade    = (p) => wrap('disc-shade', <>
  <circle cx="9" cy="9" r="4" />
  <circle cx="15" cy="15" r="4" />
  <path d="M9 5 L15 11 M9 13 L15 19" strokeOpacity="0.45" />
</>, p);
export const IconDiscFX       = (p) => wrap('disc-fx', <>
  <path d="M12 3 V8 M12 16 V21 M3 12 H8 M16 12 H21" />
  <path d="M6 6 L9 9 M15 15 L18 18 M6 18 L9 15 M15 9 L18 6" strokeOpacity="0.55" />
  <circle cx="12" cy="12" r="1.5" fill="currentColor" />
</>, p);
export const IconDiscWorld    = (p) => wrap('disc-world', <>
  <circle cx="12" cy="12" r="9" />
  <ellipse cx="12" cy="12" rx="9" ry="3.5" />
  <path d="M12 3 V21" />
</>, p);
export const IconDiscNurbs    = (p) => wrap('disc-nurbs', <>
  <path d="M4 20 C 6 6, 12 6, 12 12 S 18 18, 20 4" />
  <circle cx="4" cy="20" r="1.4" />
  <circle cx="12" cy="12" r="1.4" />
  <circle cx="20" cy="4" r="1.4" />
</>, p);
export const IconDiscRig      = (p) => wrap('disc-rig', <>
  <circle cx="12" cy="6" r="2.5" />
  <path d="M12 8.5 V14 M9 11 L15 11 M12 14 L8 20 M12 14 L16 20" />
</>, p);
export const IconDiscPhys     = (p) => wrap('disc-phys', <>
  <circle cx="8" cy="14" r="4" />
  <circle cx="16" cy="10" r="3" />
  <path d="M11 12 L13 12" />
</>, p);
export const IconDiscAudio    = (p) => wrap('disc-audio', <>
  <path d="M5 9 V15 H8 L13 19 V5 L8 9 Z" />
  <path d="M16 9 C 18 11, 18 13, 16 15" />
  <path d="M18 7 C 21 10, 21 14, 18 17" strokeOpacity="0.55" />
</>, p);
export const IconDiscXR       = (p) => wrap('disc-xr', <>
  <rect x="3" y="8" width="18" height="9" rx="1" />
  <circle cx="8" cy="12.5" r="2" />
  <circle cx="16" cy="12.5" r="2" />
</>, p);
export const IconDiscScript   = (p) => wrap('disc-script', <>
  <path d="M8 6 L4 12 L8 18" />
  <path d="M16 6 L20 12 L16 18" />
  <path d="M14 4 L10 20" strokeOpacity="0.55" />
</>, p);
export const IconDiscArchie   = (p) => wrap('disc-archie', <>
  <circle cx="12" cy="12" r="9" />
  <circle cx="12" cy="12" r="4.5" />
  <circle cx="12" cy="12" r="1.6" fill="currentColor" />
</>, p);

// Slice 946 — canonical 9-discipline set adds UV / Compose / Sim / Layout
// glyphs and aliases `disc-anim` → `disc-animate`. Each glyph reads from
// across the room: UV is the flattened parametric grid, Compose is the
// node-stack with a connection wire, Sim is three particles tracing a
// motion path, Layout is a stage with three placed primitives.
export const IconDiscUV       = (p) => wrap('disc-uv', <>
  <rect x="3" y="3" width="18" height="18" />
  <path d="M3 9 H21 M3 15 H21 M9 3 V21 M15 3 V21" strokeOpacity="0.45" />
  <path d="M3 3 L9 9 M15 15 L21 21" strokeOpacity="0.3" />
</>, p);
export const IconDiscCompose  = (p) => wrap('disc-compose', <>
  <rect x="3" y="3" width="13" height="13" />
  <rect x="8" y="8" width="13" height="13" />
  <circle cx="3" cy="3" r="1.5" fill="currentColor" />
  <circle cx="21" cy="21" r="1.5" fill="currentColor" />
  <path d="M3 3 L21 21" strokeOpacity="0.3" />
</>, p);
export const IconDiscSim      = (p) => wrap('disc-sim', <>
  <circle cx="5" cy="6" r="1.6" fill="currentColor" />
  <circle cx="12" cy="12" r="1.6" fill="currentColor" />
  <circle cx="19" cy="18" r="1.6" fill="currentColor" />
  <path d="M5 6 C 9 10, 8 14, 12 12 S 16 16, 19 18" strokeOpacity="0.55" />
  <path d="M3 12 H21" strokeOpacity="0.2" />
</>, p);
export const IconDiscLayout   = (p) => wrap('disc-layout', <>
  <path d="M3 20 H21" />
  <path d="M3 20 L7 14 L17 14 L21 20" strokeOpacity="0.4" />
  <rect x="5" y="9" width="4" height="5" />
  <circle cx="12" cy="11" r="2.5" />
  <rect x="15" y="11" width="3" height="3" />
</>, p);
// Alias so old `disc-anim` references continue to resolve while the new
// `disc-animate` is the canonical 9-discipline name.
export const IconDiscAnimate  = IconDiscAnim;

// ─── PANEL CHROME (5) ────────────────────────────────────────────────────
export const IconNPanel = (p) => wrap('npanel', <>
  <rect x="3" y="4" width="18" height="16" />
  <path d="M15 4 V20" />
  <path d="M17 8 H19 M17 11 H19 M17 14 H19" strokeOpacity="0.6" />
</>, p);
export const IconTShelf = (p) => wrap('tshelf', <>
  <rect x="3" y="4" width="18" height="16" />
  <path d="M9 4 V20" />
  <rect x="5" y="6" width="2" height="2" />
  <rect x="5" y="10" width="2" height="2" />
  <rect x="5" y="14" width="2" height="2" />
</>, p);
export const IconSettings = (p) => wrap('settings', <>
  <circle cx="12" cy="12" r="3" />
  <path d="M12 2 V5 M12 19 V22 M22 12 H19 M5 12 H2 M19 5 L17 7 M7 17 L5 19 M19 19 L17 17 M7 7 L5 5" />
</>, p);
export const IconClose = (p) => wrap('close', <>
  <path d="M6 6 L18 18 M18 6 L6 18" />
</>, p);
export const IconCheck = (p) => wrap('check', <>
  <path d="M5 13 L10 18 L19 7" />
</>, p);

// ─── INDEX (for dynamic lookup) ─────────────────────────────────────────
export const ICONS = {
  // primitives
  cube: IconCube, sphere: IconSphere, plane: IconPlane, cylinder: IconCylinder,
  cone: IconCone, torus: IconTorus, icosahedron: IconIcosahedron, text: IconText,
  curve: IconCurve, empty: IconEmpty,
  // transform
  select: IconSelect, move: IconMove, rotate: IconRotate, scale: IconScale, transform: IconTransform,
  // edit modes
  'object-mode': IconObjectMode, 'vertex-mode': IconVertexMode,
  'edge-mode': IconEdgeMode, 'face-mode': IconFaceMode, 'sculpt-mode': IconSculptMode,
  // mesh ops
  extrude: IconExtrude, inset: IconInset, subdivide: IconSubdivide,
  bevel: IconBevel, mirror: IconMirror,
  // view
  camera: IconCamera, light: IconLight, material: IconMaterial, eye: IconEye,
  // actions
  undo: IconUndo, redo: IconRedo, play: IconPlay, pause: IconPause,
  // disciplines — slice 946: canonical 9 (model/sculpt/uv/shade/animate/
  // render/compose/sim/layout) + legacy folds kept reachable for the
  // ops layer (paint/fx/world/nurbs/rig/phys/audio/xr/script/archie).
  'disc-model': IconDiscModel, 'disc-sculpt': IconDiscSculpt,
  'disc-uv': IconDiscUV, 'disc-shade': IconDiscShade,
  'disc-animate': IconDiscAnimate, 'disc-render': IconDiscRender,
  'disc-compose': IconDiscCompose, 'disc-sim': IconDiscSim,
  'disc-layout': IconDiscLayout,
  // legacy folded — still reachable for ops layer / Tool Registry; not
  // exposed as their own tabs after the 15 → 9 consolidation.
  'disc-paint': IconDiscPaint, 'disc-anim': IconDiscAnim,
  'disc-fx': IconDiscFX, 'disc-world': IconDiscWorld, 'disc-nurbs': IconDiscNurbs,
  'disc-rig': IconDiscRig, 'disc-phys': IconDiscPhys, 'disc-audio': IconDiscAudio,
  'disc-xr': IconDiscXR, 'disc-script': IconDiscScript, 'disc-archie': IconDiscArchie,
  // chrome
  npanel: IconNPanel, tshelf: IconTShelf, settings: IconSettings,
  close: IconClose, check: IconCheck,
};

// Dynamic icon picker — render by string name. Useful for data-driven
// menus where the icon name comes from a config / Archie tool spec.
export function Icon({ name, ...rest }) {
  const Cmp = ICONS[name];
  if (!Cmp) {
    // Fallback: hollow square so we can spot missing names in the UI.
    return wrap(`missing-${name}`, <rect x="4" y="4" width="16" height="16" strokeOpacity="0.4" />, rest);
  }
  return <Cmp {...rest} />;
}
