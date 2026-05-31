import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-subdivide');

test('Studio — __studioSubdivideSelectedFaces 1→4 split (slice 390)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 500,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => typeof window.__studioSubdivideSelectedFaces === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(400);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0, 0, 0); m.scale.set(1, 1, 1); m.updateMatrixWorld(true);
    window.__studioClearEditSelection();
  });

  // Empty → fail.
  let r = await win.evaluate(() => window.__studioSubdivideSelectedFaces());
  expect(r.ok).toBe(false);

  // 1 face → 24v→27v, 12t→15t (-1 + 4 = +3).
  await win.evaluate(() => window.__studioReplaceEditSelection('face', 0));
  r = await win.evaluate(() => window.__studioSubdivideSelectedFaces());
  expect(r.ok).toBe(true);
  expect(r.vertCount).toBe(27);
  expect(r.triCount).toBe(15);
  expect(r.addedTris).toBe(3);

  // 2 more faces → 27→33 verts, 15→21 tris (-2 + 8 = +6).
  await win.evaluate(() => {
    window.__studioReplaceEditSelection('face', 1);
    window.__studioAddToEditSelection('face', 2);
  });
  r = await win.evaluate(() => window.__studioSubdivideSelectedFaces());
  expect(r.ok).toBe(true);
  expect(r.vertCount).toBe(33);
  expect(r.triCount).toBe(21);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 390: subdivide grew cube to 33 verts / 21 tris');

  await app.close();
});
