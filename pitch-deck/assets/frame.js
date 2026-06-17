/* Minimal, airy footer (replaces the old engineering title-block chrome).
   Vibe-design framing: just a quiet index line. */
(function () {
  const sheet = document.querySelector('.sheet');
  if (!sheet) return;
  const d = sheet.dataset;
  const f = document.createElement('div');
  f.className = 'deck-footer';
  const l = document.createElement('span'); l.className = 'ft-l'; l.textContent = d.foot || 'ARCHDISC';
  const r = document.createElement('span'); r.className = 'ft-r';
  r.textContent = (d.sheet || '01') + ' / ' + (d.total || '09') + '   ·   CLAWCOMP × LINK VENTURES';
  f.appendChild(l); f.appendChild(r);
  sheet.appendChild(f);
  document.documentElement.setAttribute('data-frame-ready', '1');
})();
