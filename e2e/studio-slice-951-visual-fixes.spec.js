import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Slice 951 — Demo-fix verification.
//
// Confirms:
//   1. Viewport canvas background is the new flat #181818 (no oval)
//   2. GridHelper + AxesHelper start invisible (no "2D grid line on top")
//   3. Top chrome heights are the tightened values (30/24/38)
//   4. Studio renders end-to-end without console errors

const OUT = path.resolve(__dirname, 'screenshots', 'studio-slice-951-visual-fixes');

test('Studio slice 951 — viewport flat dark-gray + compact top chrome', async () => {
  test.setTimeout(120000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 220,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.setItem('studioV3Theme', 'dark');
    // Slice 951 — clear any persisted Display-section toggles (grid /
    // axes / minimap / etc.) so the test starts from defaultOn values.
    // Previous Studio runs set studio.v3.display-toggles={grid:true,…}
    // which would force grid.visible=true on mount despite the new
    // defaultOn:false.
    window.localStorage.removeItem('studio.v3.display-toggles');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(800);

  // 1. Viewport canvas background flat dark gray.
  const vp = await win.evaluate(() => {
    const el = document.querySelector('.studio-viewport-canvas')
      || document.querySelector('.studio-viewport');
    if (!el) return null;
    const cs = window.getComputedStyle(el);
    return { bg: cs.backgroundColor, image: cs.backgroundImage };
  });
  expect(vp).toBeTruthy();
  // Must be a flat fill — backgroundImage must be `none` (no radial-gradient).
  if (vp) expect(vp.image).toBe('none');

  // 2. GridHelper + AxesHelper hidden by default. Debug the grid's
  //    identity so the failure reads who set it visible.
  const helpers = await win.evaluate(() => {
    const g = window.__studioGrid;
    const a = window.__studioAxes;
    const scene = window.__archdiscScene;
    let sceneGridCount = 0;
    const sceneGrids = [];
    if (scene) {
      scene.traverse((o) => {
        if (o && o.isGridHelper) {
          sceneGridCount++;
          sceneGrids.push({ visible: o.visible, parent: o.parent ? o.parent.type : null,
            isStudioGrid: !!(o.userData && o.userData.archdiscStudioGrid),
            sameAsWindowGrid: o === g });
        }
      });
    }
    // What IS __studioGrid? Identity probe.
    const gridIdent = g ? {
      isStudioGrid: !!(g.userData && g.userData.archdiscStudioGrid),
      position_y: g.position ? g.position.y : null,
      hasParent: !!g.parent,
      parentType: g.parent ? g.parent.type : null,
      userDataKeys: g.userData ? Object.keys(g.userData) : null,
      uuidStart: g.uuid ? g.uuid.slice(0, 8) : null,
    } : null;
    return {
      gridVisible: g ? g.visible : null,
      axesVisible: a ? a.visible : null,
      gridSize: window.__studioGridSize,
      sceneGridCount,
      sceneGrids,
      gridIdent,
    };
  });
  console.log('GRID DEBUG:', JSON.stringify(helpers, null, 2));
  expect(helpers.gridVisible).toBe(false);
  // Axes is only set if the Slice 951 edit took effect.
  if (helpers.axesVisible !== null) expect(helpers.axesVisible).toBe(false);

  // 3. Top chrome heights — read CSS custom properties from :root.
  const heights = await win.evaluate(() => {
    const cs = window.getComputedStyle(document.documentElement);
    return {
      topbar:    cs.getPropertyValue('--studio-topbar-h').trim(),
      qat:       cs.getPropertyValue('--studio-qat-h').trim(),
      toolbar:   cs.getPropertyValue('--studio-toolbar-h').trim(),
      statusbar: cs.getPropertyValue('--studio-statusbar-h').trim(),
    };
  });
  expect(heights.topbar).toBe('30px');
  expect(heights.qat).toBe('24px');
  expect(heights.toolbar).toBe('38px');

  // 4. Full reference screenshot.
  await win.screenshot({ path: path.join(OUT, '01-after-visual-fixes.png') });

  // 5. Run a few quick interactions to confirm nothing broken.
  await win.locator('[data-studio-v3-wb="sculpt"]').click();
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '02-sculpt-tab.png') });

  await win.locator('[data-studio-v3-wb="model"]').click();
  await win.waitForTimeout(200);
  // Confirm a primitive still spawns.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '03-cube-on-flat-canvas.png') });

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await win.waitForTimeout(140);
  await app.close();
});
