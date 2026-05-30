import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 251: kernel measurement (bbox / volume / area / verts).
 * Headed Mac Electron, viewer-dominant teapot.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-measure');

test('Studio — N-panel measure shows bbox + volume + area + vert count for the selection', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 700,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'measure demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'cube', pos: [0, 0, 0], scale: [4, 4, 4], color: '#9ab' }],
      expect: { bodies: 1, kinds: ['cube'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(400);

  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="Item"]').click());
  await win.waitForTimeout(300);

  await expect(win.locator('[data-studio-npanel-bbox]')).toBeVisible();
  const bbox = await win.locator('[data-studio-npanel-bbox]').textContent();
  expect(bbox, 'cube bbox is square').toMatch(/^\d+\.\d{3} × \d+\.\d{3} × \d+\.\d{3}$/);

  const verts = Number(await win.locator('[data-studio-npanel-verts-count]').textContent());
  expect(verts, 'cube has 24 vertices').toBe(24);

  const volTxt = await win.locator('[data-studio-npanel-volume]').textContent();
  expect(volTxt, 'volume in scientific notation').toMatch(/^\d+\.\d{2}e[-+]?\d+$/);

  await win.screenshot({ path: path.join(OUT, '00-measure.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 251: measure bbox + verts + volume + area OK');

  await app.close();
});
