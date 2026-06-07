// ArchDisc Studio V3 — Design Tokens.
//
// Slice 946 — fully monochrome rebuild. The Studio shell now ships pure
// OLED-black + matte-black + dark-gray with ZERO chromatic accent. State
// (hover / active / selected) is conveyed by brightness shifts + 1px
// hairlines at rgba(255,255,255,0.08) per the Q3 design lock-in. Light
// mode mirrors the same scale inverted to warm-paper greyscale.
//
// Two modes: 'dark' (OLED true black, warm-white text) and 'light'
// (warm drafting-paper off-white, near-black ink). All tokens flow
// through a single `tokens(mode)` accessor so components don't reach
// into the constants directly.
//
// Convention: comparable tokens share the same suffix across modes
// (--ink-0 ↔ --paper-0) so a single CSS variable swap flips the theme.

export const PALETTE = {
  dark: {
    // Surfaces — pure greyscale ladder from OLED to dark gray.
    'ink-0': '#000000',  // OLED — viewport bg, app bg
    'ink-1': '#0a0a0a',  // matte black — topbar, statusbar, cmdbar
    'ink-2': '#141414',  // raised — right panel, ribbon body, hover ground
    'ink-3': '#1f1f1f',  // hover / dropdown surface
    'ink-4': '#2a2a2a',  // selected / pressed
    // Foreground.
    'fg-1':  '#f0eee6',  // primary text (warm white, not cold #ffffff)
    'fg-2':  '#a8a8a8',  // secondary text
    'fg-3':  '#5a5a5a',  // tertiary / disabled
    // Hairlines — Q3 lock-in.
    'edge-top':    'rgba(255, 255, 255, 0.08)',  // selected/active hairline
    'edge-bottom': 'rgba(0, 0, 0, 0.50)',
  },
  light: {
    'ink-0': '#f5f4ef',  // warm drafting paper, NOT cold #fafafa
    'ink-1': '#ebe9e1',
    'ink-2': '#d8d5cb',
    'ink-3': '#cdc9bb',
    'ink-4': '#b6b1a3',
    'fg-1':  '#1a1a1a',
    'fg-2':  '#4a4a4a',
    'fg-3':  '#8a8a8a',
    'edge-top':    'rgba(20, 20, 20, 0.08)',
    'edge-bottom': 'rgba(0, 0, 0, 0.10)',
  },
};

// Slice 946 — ACCENT is now monochrome. `base` resolves to the active
// theme's primary ink; brand identity carries through mark + wordmark
// + typography alone, never via hue. Semantic signal colors (danger/
// warn/info/success) stay desaturated greys so the OLED palette holds
// even under errors — functional indicators without chromatic noise.
export const ACCENT = {
  base:    '#ebecef',  // warm white — "now / active" reads via this on dark
  pressed: '#c0c5cf',
  glow:    'rgba(235, 236, 239, 0.10)',
  // Semantic signals — grey-tinted, never saturated. Error/warn stay
  // legible without breaking the "no accent color" rule.
  danger:  '#d9d9d9',
  warn:    '#bdbdbd',
  info:    '#a0a0a0',
  success: '#e8e8e8',
};

// Spacing — 6/12 hybrid on a 4-px grid. Use space[N] for inline values;
// the gap between adjacent values shrinks at small sizes so chrome can
// pack dense without breaking the rhythm.
export const SPACE = [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 48, 64];

// Font stacks. Geist Sans + JetBrains Mono are both free; if either fails
// to load the fallback chain still reads cleanly. NO Inter — too generic
// across modern AI UI; we want Studio to feel like a tool, not a SaaS.
export const FONT = {
  // Chrome, body, display.
  sans: '"Geist Sans", "Geist", -apple-system, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif',
  // Data, coordinates, numeric inputs, code.
  mono: '"JetBrains Mono", "JetBrains Mono Variable", ui-monospace, SFMono-Regular, "Menlo", monospace',
};

// Type scale (px). Tabular figures everywhere a number appears.
export const TYPE = {
  micro:   { size: 10, lineHeight: 14, weight: 500, tracking: '0.04em' },
  caption: { size: 11, lineHeight: 16, weight: 500, tracking: '0.02em' },
  body:    { size: 12, lineHeight: 18, weight: 400, tracking: '0' },
  bodyMd:  { size: 13, lineHeight: 20, weight: 500, tracking: '0' },
  heading: { size: 14, lineHeight: 20, weight: 600, tracking: '0.01em' },
  display: { size: 18, lineHeight: 24, weight: 600, tracking: '0.01em' },
};

// Radius — minimal everywhere. 1px terminal nodes, 3px chips, 6px cards,
// 10px modals. Anything larger feels Apple-like and softens the engineer
// vibe we want.
export const RADIUS = { node: 1, chip: 3, card: 6, modal: 10 };

// Motion. 120ms for state changes (hover, focus); 220ms for layout
// changes (panel open / close); 0ms for tool clicks (instant = pro).
// Viewport canvas never animates. prefers-reduced-motion respected by
// the component layer.
export const MOTION = {
  fast:   { duration: 120, easing: 'cubic-bezier(.4, .0, .2, 1)' },   // ease-out-quad
  layout: { duration: 220, easing: 'cubic-bezier(.2, .7, .1, 1)' },   // soft overshoot
  none:   { duration: 0,   easing: 'linear' },
};

// Z-layer stack — keep all UI overlays well above the viewport canvas (0)
// and below the OS title bar (Electron ~100).
export const Z = {
  viewport:  1,
  ribbon:    10,
  npanel:    10,
  header:    20,
  status:    20,
  overlay:   30,
  popover:   40,
  modal:     50,
  toast:     60,
  cmdPalette: 70,
};

// One-call accessor for theme-aware style objects.
export function tokens(mode = 'dark') {
  const p = PALETTE[mode] || PALETTE.dark;
  return {
    ...p,
    ...ACCENT,
    font: FONT,
    type: TYPE,
    radius: RADIUS,
    motion: MOTION,
    space: SPACE,
    z: Z,
    mode,
  };
}

// Edge-light border helper (OLED elevation).
export function edgeLight(t) {
  return `inset 0 1px 0 ${t['edge-top']}, inset 0 -1px 0 ${t['edge-bottom']}`;
}

// Accent-glow ring helper (hover / active replacement for shadows).
export function accentRing(opacity = 0.5) {
  const rgba = ACCENT.glow.replace(/0\.\d+/, String(opacity));
  return `0 0 0 1px ${rgba}`;
}
