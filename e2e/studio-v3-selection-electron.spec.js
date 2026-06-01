import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-selection');

test('Studio V3 — object selection + pivot mode (slice 421)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioSelectAll === 'function', null, { timeout: 15000 });

  // Spawn 3 primitives.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(150);
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(150);
  await win.locator('[data-studio-v3-tool="cone"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // SelectAll → 3.
  let r = await win.evaluate(() => window.__studioSelectAll());
  expect(r.ok).toBe(true);
  expect(r.count).toBe(3);
  let m = await win.evaluate(() => window.__studioSelectedMeshes().length);
  expect(m).toBe(3);

  // SelectInverse → 0 (everything was selected).
  r = await win.evaluate(() => window.__studioSelectInverse());
  expect(r.count).toBe(0);

  // SelectInverse again → all 3 back.
  r = await win.evaluate(() => window.__studioSelectInverse());
  expect(r.count).toBe(3);

  // Deselect.
  r = await win.evaluate(() => window.__studioDeselect());
  expect(r.ok).toBe(true);
  m = await win.evaluate(() => window.__studioSelectedMeshes().length);
  expect(m).toBe(0);

  // Pivot mode.
  for (const mode of ['median', 'individual', 'cursor', 'origin', 'active']) {
    r = await win.evaluate((m) => window.__studioSetPivotMode(m), mode);
    expect(r.ok).toBe(true);
    expect(r.mode).toBe(mode);
    const got = await win.evaluate(() => window.__studioGetPivotMode());
    expect(got).toBe(mode);
  }

  // Bad pivot rejected.
  r = await win.evaluate(() => window.__studioSetPivotMode('weird'));
  expect(r.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 421: selectAll / inverse / deselect + 5 pivot modes ok');

  await app.close();
});
