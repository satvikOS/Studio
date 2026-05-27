import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 83 — Full Blender editor / sculpt-paint / animation suite.
 *
 * 6 new sculpt brushes (Pinch, Flatten, Crease, Layer, Polish, Grab)
 * from blender/source/blender/editors/sculpt_paint/sculpt_brush_types.cc
 * + 3 animation constraints (Track-To, Copy-Location, Limit-Distance)
 * from blender/source/blender/blenkernel/constraint.cc + 1 Driver
 * from blender/source/blender/blenkernel/fcurve_driver.cc.
 *
 * 10 new tools total. Each cites its Blender source path in its
 * ribbon button's `title` attribute.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-full-suite');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

async function meshCounter(win, kind, counterKey) {
  return await win.evaluate(({ k, key }) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    return m ? (m.userData[key] || 0) : 0;
  }, { k: kind, key: counterKey });
}

test('Studio Blender full suite — 6 sculpt brushes + 3 constraints + 1 driver', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 150,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // === SCULPT BRUSHES === (Sculpting tab)
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(300);

  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="sculpting"]').click();
  await win.waitForTimeout(300);

  const brushCounters = [
    ['sculpt-pinch',   'archdiscStudioBrushPinch'],
    ['sculpt-flatten', 'archdiscStudioBrushFlatten'],
    ['sculpt-crease',  'archdiscStudioBrushCrease'],
    ['sculpt-layer',   'archdiscStudioBrushLayer'],
    ['sculpt-polish',  'archdiscStudioBrushPolish'],
    ['sculpt-grab',    'archdiscStudioBrushGrab'],
  ];
  for (const [action, key] of brushCounters) {
    await win.locator(`[data-studio-ribbon-action="${action}"]`).click();
    await win.waitForTimeout(250);
    const counter = await meshCounter(win, 'sphere', key);
    expect(counter, `brush ${action} counter`).toBeGreaterThan(0);
  }
  await win.screenshot({ path: path.join(OUT, '01-after-6-brushes.png'), fullPage: false });

  // === CONSTRAINTS + DRIVER === (Animation tab)
  // Need a second mesh for Copy-Location target. Spawn a sphere first
  // (so the constraint can copy from it), then spawn a cube and
  // select it.
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="modeling"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-action="clear-scene-ribbon"]').click();
  await win.waitForTimeout(300);

  await win.locator('[data-studio-primitive="sphere"]').click();   // target
  await win.waitForTimeout(250);
  await win.locator('[data-studio-primitive="cube"]').click();      // subject
  await win.waitForTimeout(250);
  await selectByKind(win, 'cube');
  await win.waitForTimeout(300);

  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="animation"]').click();
  await win.waitForTimeout(300);

  const animOps = [
    ['track-to',       'archdiscStudioTrackTo'],
    ['copy-location',  'archdiscStudioCopyLocation'],
    ['limit-distance', 'archdiscStudioLimitDistance'],
    ['driver-scale',   'archdiscStudioDriverApplied'],
  ];
  for (const [action, key] of animOps) {
    await win.locator(`[data-studio-ribbon-action="${action}"]`).click();
    await win.waitForTimeout(250);
    const counter = await meshCounter(win, 'cube', key);
    expect(counter, `anim op ${action} counter`).toBeGreaterThan(0);
  }
  await win.screenshot({ path: path.join(OUT, '02-after-4-anim-ops.png'), fullPage: false });

  // 4-angle showcase.
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `03-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender full suite: 6 sculpt brushes (pinch/flatten/crease/layer/polish/grab) + 4 anim ops (track-to/copy-loc/limit-dist/driver) all fired`);

  await app.close();
});
