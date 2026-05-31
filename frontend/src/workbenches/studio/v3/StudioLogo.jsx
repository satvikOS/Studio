import React from 'react';
import { ACCENT } from './theme';

// ArchDisc Studio mark — a layered ring with a single accent slice cut on
// the upper-right at 60° (12 o'clock to 2 o'clock). The two concentric
// rings nod to the "disc" half of ArchDisc; the slice is the brand's
// signature — a sliver of light that distinguishes the mark from every
// other ring-based logo (Maya / Substance / etc. are all solid circles
// or stylised glyphs). Two stroke widths (outer 1.5, inner 1.0) keep the
// mark legible at 16px.
//
// Sized via the `size` prop; defaults to 20 (chrome). Always renders
// crisp because it's a single inline SVG path, no rasterisation.

// Slice 399 — V3 went fully monochrome. The mark no longer carries an
// accent hue; the slice cut now uses the same ink as the rings, just
// at a thicker stroke so it still reads as the brand's signature.
export function StudioMark({ size = 20, ink = 'currentColor', strokeWidth = 1.5, accent }) {
  const sliceColor = accent || ink;
  const r1 = 9.5;      // outer ring radius (centre 12, viewBox 24)
  const r2 = 5.5;      // inner ring radius
  const cx = 12, cy = 12;
  // Slice — an arc from 12 o'clock to 2 o'clock on the outer ring, drawn
  // as a separate path so it can be coloured independently.
  const a0 = -Math.PI / 2;                  // start angle = 12 o'clock
  const a1 = a0 + (Math.PI / 3);            // end angle = +60° = ~2 o'clock
  const x0 = cx + r1 * Math.cos(a0);
  const y0 = cy + r1 * Math.sin(a0);
  const x1 = cx + r1 * Math.cos(a1);
  const y1 = cy + r1 * Math.sin(a1);
  // largeArc=0, sweep=1 → short arc clockwise.
  const slice = `M ${x0.toFixed(3)} ${y0.toFixed(3)} A ${r1} ${r1} 0 0 1 ${x1.toFixed(3)} ${y1.toFixed(3)}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="ArchDisc Studio mark"
      role="img"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {/* Outer ring */}
      <circle cx={cx} cy={cy} r={r1} stroke={ink} strokeWidth={strokeWidth} strokeOpacity={0.85} />
      {/* Inner ring */}
      <circle cx={cx} cy={cy} r={r2} stroke={ink} strokeWidth={strokeWidth - 0.5} strokeOpacity={0.55} />
      {/* Slice — same ink as the rings, just heavier so it still reads
          as the brand's signature without colour. */}
      <path d={slice} stroke={sliceColor} strokeWidth={strokeWidth + 0.7} strokeLinecap="square" />
      {/* Centre point — anchors the eye */}
      <circle cx={cx} cy={cy} r={0.9} fill={sliceColor} />
    </svg>
  );
}

// Wordmark — Studio in Geist Sans Medium with +1% tracking. Falls back to
// the system stack from theme.js if Geist isn't loaded yet.
export function StudioWordmark({ size = 13, color = 'currentColor', weight = 600 }) {
  return (
    <span
      data-studio-wordmark
      style={{
        fontFamily: '"Geist Sans", "Geist", -apple-system, "SF Pro Text", system-ui, sans-serif',
        fontSize: `${size}px`,
        fontWeight: weight,
        letterSpacing: '0.01em',
        color,
        lineHeight: 1,
        display: 'inline-block',
        verticalAlign: 'middle',
      }}
    >Studio</span>
  );
}

// Lockup — mark + wordmark, evenly spaced, vertically centred.
export function StudioLogo({ size = 20, ink = 'currentColor', tone = 'dark' }) {
  const wordColor = tone === 'dark' ? '#f0eee6' : '#1a1c22';
  return (
    <div
      data-studio-logo
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        userSelect: 'none',
      }}
    >
      <StudioMark size={size} ink={ink} />
      <StudioWordmark size={Math.round(size * 0.7)} color={wordColor} />
    </div>
  );
}
