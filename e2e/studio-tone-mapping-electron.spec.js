import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-tone-mapping');

test('Studio — tone-map dropdown sets renderer.toneMapping (slice 256)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSetToneMapping === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  for (const tone of ['none', 'reinhard', 'aces']) {
    await win.evaluate((t) => window.__studioSetToneMapping(t), tone);
    expect(await win.evaluate(() => window.__studioToneMapping)).toBe(tone);
  }
  await win.screenshot({ path: path.join(OUT, '00-aces.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 256: tone-map cycle working');

  await app.close();
});
