// ArchDisc Studio V3 — shared body-attached React panel host.
//
// Every editor / side-panel module had its own copy of this six-line
// pattern (≈18 modules):
//
//   _host = document.createElement('div');
//   _host.setAttribute('data-studio-v3-<slug>-host', '');
//   document.body.appendChild(_host);
//   _root = createRoot(_host);
//   ...later: _root.render(<Panel ... />);
//   ...later: _root.render(null) on close, _root.unmount() on dispose.
//
// mountPanel(slug) returns a stable handle so the call-site keeps
// fine-grained control over render() timing — we don't try to abstract
// the panel's data flow.

import { createRoot } from 'react-dom/client';

const _hosts = new Map(); // slug → { host, root }

// Lazily attach a body-anchored <div data-studio-v3-${slug}-host>. Safe
// to call repeatedly — returns the same record for the same slug.
//
// Returns { host, root, render(el), unmount() }. `render(null)` is
// honoured so callers can hide the editor without tearing the root down.
export function mountPanel(slug) {
  if (typeof document === 'undefined') return null;
  if (_hosts.has(slug)) return _hosts.get(slug);
  const host = document.createElement('div');
  host.setAttribute(`data-studio-v3-${slug}-host`, '');
  document.body.appendChild(host);
  const root = createRoot(host);
  const rec = {
    host,
    root,
    render(el) { root.render(el || null); },
    unmount() {
      try { root.unmount(); } catch (_) {}
      if (host && host.parentNode) host.parentNode.removeChild(host);
      _hosts.delete(slug);
    },
  };
  _hosts.set(slug, rec);
  return rec;
}

// Tear down a panel host by slug. Safe to call when the slug is unknown.
export function unmountPanel(slug) {
  const rec = _hosts.get(slug);
  if (!rec) return false;
  rec.unmount();
  return true;
}

// Test / debug helper.
export function getMountedSlugs() { return Array.from(_hosts.keys()); }
