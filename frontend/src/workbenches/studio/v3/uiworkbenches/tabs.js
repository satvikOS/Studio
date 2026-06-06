// Slice 726 — Workbench tab strip. Horizontal tabs at the top of the
// viewport that switch between curated subsets of registered ops:
// Modeling (edit/csg/modstack), Sculpt (sculpt/sculptbrushes/vex/
// implicitsculpt), Animation (anim/animadv/rig/casphys/caslayers/
// castrajectory), Render (rt/matlib/texpaint), Simulation (sim/fx/
// mograph/dops), Compositor (compositor/vse/vsefx).

let _strip = null;
let _enabled = false;
let _currentTab = 'Modeling';

const TABS = [
  { label: 'Modeling',    cats: ['edit', 'editmore', 'csg', 'modstack', 'sketch', 'sketchwidget', 'sketchdoc', 'arch'] },
  { label: 'Sculpt',      cats: ['sculpt', 'sculptbrushes', 'vex'] },
  { label: 'Animation',   cats: ['anim', 'animadv', 'rig'] },
  { label: 'Render',      cats: ['rt', 'matlib', 'texpaint'] },
  { label: 'Simulation',  cats: ['sim', 'fx', 'mograph'] },
  { label: 'Compositing', cats: ['compositor', 'vse', 'gp'] },
  { label: 'BP / Visual', cats: ['bp'] },
  { label: 'View',        cats: ['multiview', 'outliner', 'assetbrowser', 'audio'] },
  { label: 'Geo Nodes',   cats: ['geomnodes', 'geomdeep', 'shader', 'shaderdeep', 'vector'] },
];

function _mount() {
  if (_strip) return _strip;
  const host = window.__archdiscViewport?.container?.parentElement || document.body;
  _strip = document.createElement('div');
  _strip.dataset.studioWorkbenches = '1';
  _strip.style.cssText = [
    'position:absolute', 'top:0', 'left:0', 'right:0',
    'height:32px',
    'background:rgba(28,28,32,0.92)',
    'border-bottom:1px solid #444',
    'display:flex',
    'align-items:center',
    'padding:0 8px',
    'gap:4px',
    'z-index:9997',
    'overflow-x:auto',
  ].join(';');
  for (const t of TABS) {
    const tab = document.createElement('button');
    tab.textContent = t.label;
    tab.style.cssText = [
      'background:transparent',
      'color:#bbb',
      'border:0',
      'padding:5px 14px',
      'cursor:pointer',
      'font:12px Arial',
      'border-radius:4px',
    ].join(';');
    tab.addEventListener('click', () => {
      _currentTab = t.label;
      _refresh();
    });
    tab.dataset.label = t.label;
    _strip.appendChild(tab);
  }
  host.appendChild(_strip);
  _refresh();
  return _strip;
}

function _refresh() {
  if (!_strip) return;
  // Highlight current tab.
  for (const tab of _strip.querySelectorAll('button')) {
    if (tab.dataset.label === _currentTab) {
      tab.style.background = '#3a5fc0';
      tab.style.color = '#fff';
    } else {
      tab.style.background = 'transparent';
      tab.style.color = '#bbb';
    }
  }
  // Could update slice-685 menubar to filter to current tab's categories.
  // We won't directly mutate that here — but we expose the current set.
}

export function enable() {
  _enabled = true;
  _mount();
  return { ok: true };
}

export function disable() {
  _enabled = false;
  if (_strip?.parentElement) _strip.parentElement.removeChild(_strip);
  _strip = null;
  return { ok: true };
}

export function setTab(name) {
  if (!TABS.some((t) => t.label === name)) return { ok: false };
  _currentTab = name;
  _refresh();
  return { ok: true };
}

export function getCurrentTab() { return { ok: true, tab: _currentTab }; }

export function getTabCategories(name) {
  const t = TABS.find((x) => x.label === name);
  return { ok: !!t, categories: t?.cats || [] };
}

export function listTabs() {
  return { ok: true, tabs: TABS.map((t) => ({ label: t.label, categoryCount: t.cats.length })) };
}
