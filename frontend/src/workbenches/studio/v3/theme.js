// ArchDisc Studio V3 — Design Tokens.
//
// Two modes: 'dark' (OLED, true black, warm-white text) and 'light' (warm
// drafting-paper off-white, near-black ink). Accent is a slightly deeper
// teal than V2 — less neon, more professional. All tokens flow through a
// single `tokens(mode)` accessor so components don't reach into the
// constants directly — that lets us add a third theme (e.g. 'hi-contrast')
// later without touching every component.
//
// Convention: comparable tokens share the same suffix across modes
// (--ink-0 ↔ --paper-0) so a single CSS variable swap flips the theme.

export const PALETTE = {
  dark: {
    // Surfaces.
    'ink-0': '#000000',  // true OLED base — viewport bg, app bg
    'ink-1': '#08090b',  // panels (ribbon, N-panel, status bar)
    'ink-2': '#12141a',  // raised surfaces (cards, popovers)
    'ink-3': '#1c1f28',  // hover / dropdown surface
    'ink-4': '#2a2e3a',  // borders, dividers
    // Foreground.
    'fg-1':  '#f0eee6',  // primary text (warm white, not cold #ffffff)
    'fg-2':  '#a8aab2',  // secondary text
    'fg-3':  '#5a5d68',  // tertiary / disabled
    // Edge-light for OLED elevation (shadows vanish on #000).
    'edge-top':    'rgba(255, 255, 255, 0.06)',
    'edge-bottom': 'rgba(0, 0, 0, 0.50)',
  },
  light: {
    'ink-0': '#f5f4ef',  // warm drafting paper, NOT cold #fafafa
    'ink-1': '#ebe9e1',
    'ink-2': '#d8d5cb',
    'ink-3': '#cdc9bb',
    'ink-4': '#b6b1a3',
    'fg-1':  '#1a1c22',
    'fg-2':  '#4a4d57',
    'fg-3':  '#8a8b91',
    'edge-top':    'rgba(255, 255, 255, 0.85)',
    'edge-bottom': 'rgba(0, 0, 0, 0.10)',
  },
};

export const ACCENT = {
  base:    '#0fd4a6',  // primary teal — slightly deeper than V2's #1de9b6
  pressed: '#08a987',
  glow:    'rgba(15, 212, 166, 0.18)',
  // Semantic colours — same across themes; they're meant to read at-a-glance.
  danger:  '#ff4b6b',
  warn:    '#f6c14a',
  info:    '#5da9ff',
  success: '#0fd4a6',
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
