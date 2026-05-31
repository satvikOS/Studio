import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-merge-ribbon');

test('Studio — Merge ribbon button (slice 367)', async () => {
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
  await win.waitForTimeout(800);

  // Spawn 2 + select all.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await win.evaluate(() => window.__studioSelectAll && window.__studioSelectAll());
  await win.waitForTimeout(200);

  await expect(win.locator('[data-studio-ribbon-action="merge-selected"]')).toBeEnabled();
  await win.locator('[data-studio-ribbon-action="merge-selected"]').click();
  await win.waitForTimeout(500);

  // A merged mesh should now exist.
  const merged = await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'merged') m = o; });
    return m ? { uuid: m.uuid, vertCount: m.geometry.attributes.position.count } : null;
  });
  expect(merged).toBeTruthy();
  expect(merged.vertCount).toBeGreaterThan(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 367: Merge ribbon button created merged mesh with', merged.vertCount, 'verts');

  await app.close();
});
