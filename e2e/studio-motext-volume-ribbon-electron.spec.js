import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-motext-volume-ribbon');

test('Studio — MoText + Volume ribbon buttons (slice 326)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioMoText === 'function', null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioAddVolume === 'function', null, { timeout: 30000 });
  // Font for MoText loads async.
  await win.waitForFunction(() => {
    const r = window.__studioMoText({ text: 'ping' });
    return r && r.ok;
  }, null, { timeout: 10000 });
  // The ping spawned a motext; remove it to keep state clean.
  await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscMoText && o.userData.archdiscMoText.text === 'ping') m = o; });
    if (m && m.parent) m.parent.remove(m);
  });

  await expect(win.locator('[data-studio-primitive="motext"]')).toBeVisible();
  await expect(win.locator('[data-studio-primitive="volume"]')).toBeVisible();

  await win.locator('[data-studio-primitive="motext"]').click();
  await win.waitForTimeout(400);
  const textCount = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'motext') n++; });
    return n;
  });
  expect(textCount).toBeGreaterThanOrEqual(1);

  await win.locator('[data-studio-primitive="volume"]').click();
  await win.waitForTimeout(400);
  const volCount = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'volume') n++; });
    return n;
  });
  expect(volCount).toBeGreaterThanOrEqual(1);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 326: MoText + Volume ribbon spawned', textCount, 'text and', volCount, 'volumes');

  await app.close();
});
