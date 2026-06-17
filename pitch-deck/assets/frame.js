/* Builds the drawing-sheet chrome (border, zone ticks, title block) from
   data-* attributes on .sheet, so each slide file holds only its content. */
(function () {
  const sheet = document.querySelector('.sheet');
  if (!sheet) return;
  const d = sheet.dataset;

  // --- border frame (double rule) ---
  const frame = document.createElement('div');
  frame.className = 'border-frame';
  sheet.appendChild(frame);

  // --- zone ticks + labels (drawing margin) ---
  const zones = document.createElement('div');
  zones.className = 'zones';
  zones.style.overflow = 'visible';
  const W = 1280 - 52, H = 720 - 52;            // inner border box (inset 26 each side)
  const cols = 8, rows = 5;
  const letters = 'ABCDEFGH';
  for (let i = 0; i < cols; i++) {
    const x = (i + 0.5) * (W / cols);
    const lab = document.createElement('div');
    lab.className = 'zone col'; lab.style.left = x + 'px'; lab.style.top = '-16px';
    lab.textContent = (i + 1);
    zones.appendChild(lab);
    if (i > 0) addTick(i * (W / cols), 0, false);
  }
  for (let j = 0; j < rows; j++) {
    const y = (j + 0.5) * (H / rows);
    const lab = document.createElement('div');
    lab.className = 'zone row'; lab.style.top = y + 'px'; lab.style.left = '-15px';
    lab.textContent = letters[j];
    zones.appendChild(lab);
    if (j > 0) addTick(0, j * (H / rows), true);
  }
  function addTick(x, y, horizontal) {
    const t = document.createElement('div'); t.className = 'ztick';
    if (horizontal) { t.style.left = '-3px'; t.style.top = (y - 0.5) + 'px'; t.style.width = '6px'; t.style.height = '1px'; }
    else { t.style.top = '-3px'; t.style.left = (x - 0.5) + 'px'; t.style.height = '6px'; t.style.width = '1px'; }
    zones.appendChild(t);
  }
  sheet.appendChild(zones);

  // --- title block ---
  const tb = document.createElement('div');
  tb.className = 'titleblock';
  const cells = [
    ['PROJECT', d.project || 'ARCHDISC PLATFORM', true],
    ['SHEET', (d.sheet || '01') + ' / ' + (d.total || '07'), false],
    ['SCALE', d.scale || 'NTS', false],
    ['REV', d.rev || 'A', false],
    ['DRAWN BY', d.drawn || 'ARCHIE', false],
    ['ISSUED', d.client || 'CLAWCOMP', false],
  ];
  for (const [k, v, isDisp] of cells) {
    const c = document.createElement('div'); c.className = 'tb-cell';
    const kk = document.createElement('div'); kk.className = 'tb-k'; kk.textContent = k;
    const vv = document.createElement('div'); vv.className = 'tb-v' + (isDisp ? ' disp' : ''); vv.textContent = v;
    c.appendChild(kk); c.appendChild(vv); tb.appendChild(c);
  }
  sheet.appendChild(tb);

  // signal for the renderer
  document.documentElement.setAttribute('data-frame-ready', '1');
})();
