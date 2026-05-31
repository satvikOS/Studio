import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-mospline-ribbon');

test('Studio — MoSpline ribbon button (slice 309)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioMoSpline === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  const before = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'mospline') n++; });
    return n;
  });
  expect(before).toBe(0);

  await expect(win.locator('[data-studio-primitive="mospline"]')).toBeVisible();
  await win.locator('[data-studio-primitive="mospline"]').click();
  await win.waitForTimeout(500);

  const after = await win.evaluate(() => {
    let line = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'mospline') line = o; });
    return line ? {
      isLine: line.isLine === true,
      count: line.geometry.attributes.position.count,
      type: line.userData.archdiscMoSpline.type,
    } : null;
  });
  expect(after).toBeTruthy();
  expect(after.isLine).toBe(true);
  expect(after.count).toBe(80);
  expect(after.type).toBe('helix');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 309: MoSpline ribbon spawned a', after.type, 'with', after.count, 'points');

  await app.close();
});
