import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-z-shading-cycle');

test('Studio — Z cycles shading mode (slice 322)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSetShadingMode === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Force start at 'material' so the cycle is deterministic.
  await win.evaluate(() => window.__studioSetShadingMode('material'));
  await win.waitForTimeout(150);

  // Press Z four times — should cycle through wireframe → solid → material → rendered.
  // Cycle goes (material → rendered → wireframe → solid → material).
  const expected = ['rendered', 'wireframe', 'solid', 'material'];
  const got = [];
  for (const _ of expected) {
    await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true })));
    await win.waitForTimeout(150);
    got.push(await win.evaluate(() => window.__studioShadingMode));
  }
  expect(got).toEqual(expected);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 322: Z cycled', got.join(' → '));

  await app.close();
});
