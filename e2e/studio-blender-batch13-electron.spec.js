import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 110 — Blender batch 13: 15 UV + paint + decimate + shading ops.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-batch13');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

async function meshCounter(win, kind, key) {
  return await win.evaluate(({ k, ck }) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    return m ? (m.userData[ck] || 0) : 0;
  }, { k: kind, ck: key });
}

test('Studio Blender batch 13 — 15 UV / paint / decimate / shading ops', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 100,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(300);

  // ---- UV Texture tab — 7 UV ops + 1 tex paint commit ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="uv-texture"]').click();
  await win.waitForTimeout(280);

  const uvOps = [
    ['uv-pack',          'archdiscStudioUvPacked'],
    ['uv-reset',         'archdiscStudioUvReset'],
    ['uv-cube-proj',     'archdiscStudioUvCubeProj'],
    ['uv-cyl-proj',      'archdiscStudioUvCylProj'],
    ['uv-sph-proj',      'archdiscStudioUvSphProj'],
    ['uv-from-view',     'archdiscStudioUvFromView'],
    ['tex-paint-commit', 'archdiscStudioTexturePaintCommit'],
  ];
  for (const [action, key] of uvOps) {
    await win.locator(`[data-studio-ribbon-action="${action}"]`).click();
    await win.waitForTimeout(220);
    expect(await meshCounter(win, 'sphere', key), `op ${action}`).toBeGreaterThan(0);
  }
  await win.screenshot({ path: path.join(OUT, '01-uv-ops.png'), fullPage: false });

  // ---- Sculpting tab — 3 new brushes (Mask / Clay / Scrape) ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="sculpting"]').click();
  await win.waitForTimeout(280);

  const sculptOps = [
    ['sculpt-mask',   'archdiscStudioBrushMask'],
    ['sculpt-clay',   'archdiscStudioBrushClay'],
    ['sculpt-scrape', 'archdiscStudioBrushScrape'],
  ];
  for (const [action, key] of sculptOps) {
    await win.locator(`[data-studio-ribbon-action="${action}"]`).click();
    await win.waitForTimeout(220);
    expect(await meshCounter(win, 'sphere', key), `op ${action}`).toBeGreaterThan(0);
  }

  // ---- Modeling tab — set smooth/flat + 3 decimate variants ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="modeling"]').click();
  await win.waitForTimeout(280);

  const editOps = [
    ['set-smooth-face',  'archdiscStudioFaceSmoothSet'],
    ['set-flat-face',    'archdiscStudioFaceFlatSet'],
    ['decimate-collapse','archdiscStudioDecimateCollapse'],
    ['decimate-unsub',   'archdiscStudioDecimateUnsub'],
    ['decimate-planar',  'archdiscStudioDecimatePlanar'],
  ];
  for (const [action, key] of editOps) {
    await win.locator(`[data-studio-ribbon-action="${action}"]`).click();
    await win.waitForTimeout(220);
    expect(await meshCounter(win, 'sphere', key), `op ${action}`).toBeGreaterThan(0);
  }
  await win.screenshot({ path: path.join(OUT, '02-after-15-ops.png'), fullPage: false });

  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `03-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender batch 13: 15 ops (7 UV + 1 tex-paint + 3 sculpt brushes + 2 shading + 3 decimate variants)`);

  await app.close();
});
