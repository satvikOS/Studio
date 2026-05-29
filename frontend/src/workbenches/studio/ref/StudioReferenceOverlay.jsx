import React, { useEffect, useRef } from 'react';

/*
 * Studio reference overlay — a small player anchored in the top-left of the
 * viewport that shows a reference video (or image) in real time, so the user
 * can build alongside an authoritative reference and visually compare frame by
 * frame. The Archie loop also reads it: each iteration's screenshot can be
 * cross-checked against the overlay's current reference image.
 */
const isVideo = (u) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u || '');

export default function StudioReferenceOverlay({ url, visible = true, size = 260, opacity = 0.95, label = 'Reference' }) {
  const vRef = useRef(null);
  useEffect(() => {
    const v = vRef.current; if (!v) return;
    v.muted = true; const p = v.play && v.play(); if (p && p.catch) p.catch(() => { /* autoplay may be deferred */ });
  }, [url]);
  if (!visible || !url) return null;
  return (
    <div data-studio-reference-overlay data-studio-reference-url={url}
      style={{ position: 'absolute', top: 8, left: 8, width: size, height: size, zIndex: 35, border: '1px solid #2a2a2a', background: '#000', opacity, pointerEvents: 'none', overflow: 'hidden', boxShadow: '0 2px 6px rgba(0,0,0,0.5)' }}>
      {isVideo(url)
        ? <video ref={vRef} src={url} muted loop autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        : <img src={url} alt="reference" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '2px 6px', fontSize: 10, color: '#cfcfcf', background: 'rgba(0,0,0,0.62)', letterSpacing: 0.5, textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}
