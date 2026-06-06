# FORGE_UI_SPEC — authoritative Forge design reference for ArchDisc Studio

Source of truth copied from Forge: `~/archdisc-Mech/frontend/src/forge-v4/tokens.css`
(+ `BodyContextMenu.jsx`). Studio's V3 shell must match these EXACT values so
its layout, dimensions, color scheme (dark + light), and contrasts read 1:1
with Forge. When polishing Studio UI, port these tokens/geometry verbatim
(rename `--forge-*` → `--studio-*` only where Studio already uses that prefix;
keep the numeric/colour values identical).

## Color scheme — DARK (`[data-*-theme="dark"]`, default)
Canvas:   bg #000000 (OLED) · canvas-2 #0a0b0e (toolbar) · canvas-3 #14161b (panels)
Rail:     rail #06070a · rail-edge #1d2027
Surface:  surface #14161b · surface-2 #1c1f26 · overlay rgba(0,0,0,0.72)
Ink:      ink #ebecef · ink-2 #b0b4bd · ink-mute #757a85 · ink-faint #3d4250
Accent:   accent #ebecef (monochrome white) · hover #ffffff · press #c0c5cf
          accent-mute rgba(255,255,255,0.08) · accent-rim rgba(255,255,255,0.28)
Signal:   ok #5cc88f · warn #e1b250 · err #e26a6a
color-scheme: dark

## Color scheme — LIGHT (`[data-*-theme="light"]`)
Canvas:   bg #ebecee (greyish off-white) · canvas-2 #e1e3e7 · canvas-3 #d6d9de
Rail:     rail #ffffff · rail-edge #c8ccd2
Surface:  surface #ffffff · surface-2 #f3f4f6 · overlay rgba(40,42,48,0.32)
Ink:      ink #14161b · ink-2 #3e424c · ink-mute #7a7f8a · ink-faint #b8bcc4
Accent:   accent #14161b (deep graphite) · hover #000000 · press #2a2d34
          accent-mute rgba(20,22,27,0.07) · accent-rim rgba(20,22,27,0.20)
Signal:   ok #2d9b65 · warn #b8870a · err #c14545
color-scheme: light

RULE: single accent, used sparingly (focus rings, active workbench border,
brand spark, primary CTA, one accent line on the cmd bar). Everything else is
monochrome grey scale so the accent always reads as "now / important".

## Zone geometry (the 4-zone shell) — EXACT dimensions
- topbar height:      40px   (--forge-topbar-h)
- quick-access bar:   32px   (--forge-qat-h)
- toolbar height:     48px   (--forge-toolbar-h)
- status bar height:  26px   (--forge-statusbar-h)
- command bar height: 52px   (--forge-cmdbar-h)
- left workbench rail width:   72px  (--forge-wb-rail-w)
- right panel width:           340px (--forge-right-w)
- right panel collapsed width: 36px  (--forge-right-collapsed-w)
- archie dock width (open):    380px (--forge-archie-w)

App grid (`.forge-app`):
  rows:    topbar / qat / toolbar / 1fr / statusbar / cmdbar
  cols:    wb-rail(72) / 1fr / right(auto)
  areas:
    "topbar topbar topbar" / "qat qat qat" /
    "wb-rail toolbar right" / "wb-rail viewport right" /
    "wb-rail statusbar right" / "cmdbar cmdbar cmdbar"
  When archie open: cols → wb-rail 1fr archie(380).
  NO element overlaps another. The VIEWPORT is the 1fr center cell — it must
  fill exactly that cell (never covered by floating bars/toasts/rulers).

## Spacing ladder (4px grid) & corners
space 4 / 8 / 12 / 16 / 24 / 32 · radius 4px · radius-lg 8px · pill 999px
Tool grid: row-h 36px · tool button 32px · tool gap 3px
Motion: fast 90ms · base 160ms · glide 240ms — all cubic-bezier(.22,1,.36,1)

## Typography
font: 'Inter', -apple-system, system-ui, sans-serif · base 12px · line 1.4
mono: 'JetBrains Mono','SF Mono', monospace
- topbar menu: 12px, padding 4px 9px, radius 4px, ink-2 → ink on hover (bg surface)
- toolbar group label: 10px UPPERCASE, letter-spacing .08em, ink-mute, min-width 42px
- wb-rail tab: glyph 24px, label 9px UPPERCASE letter-spacing .05em; active = accent-mute
  bg + accent-rim border + 3px accent bar on the left edge (::before)
- right section header: 6px 10px, 10px UPPERCASE letter-spacing .06em, ink-mute,
  bg canvas, border-bottom rail-edge. Sections are flex 1 1 50%, border-bottom rail-edge.
- statusbar: 11px MONO, ink-mute, padding 0 16px, gap 24px; strong = ink-2
- cmdbar: glyph = accent; input 13px, placeholder ink-mute italic, caret accent;
  hint = 10px mono with <kbd> 1px rail-edge border on surface

## Context menu / right-click (from BodyContextMenu.jsx)
- position fixed, clamp: left min(x, innerWidth-200), top min(y, innerHeight-320)
- padding 4 · bg canvas-3 · 1px rail-edge border · radius 4px (var radius)
- box-shadow 0 16px 48px rgba(0,0,0,0.55) · min-width 200 · z-index 1500
- item: flex, gap 8, width 100%, padding 5px 10px, transparent bg, ink color,
  fontSize 12, radius 3; hover bg = surface; leading Icon 12px; trailing shortcut
  = 10px mono ink-mute
- divider: height 1, bg rail-edge, margin 4px 6px
- SUBMENU: same surface/border/shadow, opens to the side, same item metrics.

## Floating docks (tool dock / library / help / topology)
- tool param dock: left = wb-rail+8, top = topbar+qat+toolbar+8, width 260,
  bg canvas-3, 1px rail-edge, radius-lg 8, shadow 0 16px 48px rgba(0,0,0,.55), z 600
- library panel: width 280, z 700 · help drawer: width 360, z 1300 ·
  topology drawer: width 340, z 1280 (right slide-ins, top = topbar+qat)

## Scrollbars
8px, transparent track, thumb = rail-edge (hover ink-faint), radius 4.

## Viewport background
dark:  radial-gradient(ellipse at 50% 35%, #0d1015 0%, #000 70%)
light: radial-gradient(ellipse at 50% 35%, #fff 0%, #ebecee 70%)

## Parity checklist for Studio's shell
[ ] topbar 40 / qat 32 / toolbar 48 / statusbar 26 / cmdbar 52 heights match
[ ] left rail 72 / right panel 340 (collapsed 36) widths match
[ ] viewport fills the single 1fr center cell; nothing overlaps it
[ ] dark + light token values identical to above; theme toggle swaps cleanly
[ ] accent used sparingly (active tab/tool, focus, cmdbar line) — rest monochrome
[ ] right panel = grouped collapsible sections (header 10px UPPERCASE ink-mute),
    NOT a flat ungrouped button list
[ ] context menu + submenu: min-width 200, padding 4, item 5px 10px, shortcut mono
[ ] no duplicate/auto-injected bars (menubar, tab strip, status strip) — already fixed
[ ] no DevTools auto-open; no stray rulers/boxes over the viewport
