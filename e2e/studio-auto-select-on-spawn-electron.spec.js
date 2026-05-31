import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-auto-select-on-spawn');

test('Studio — addPrimitive auto-selects new mesh (slice 313)', async () => {
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

  // Before: no selection.
  const before = await win.evaluate(() => ({
    sel: !!window.__studioSelectedMesh && !!window.__studioSelectedMesh(),
  }));
  expect(before.sel).toBe(false);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);

  // After: cube exists AND is the selected mesh.
  const after = await win.evaluate(() => {
    const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
    return {
      hasSel: !!m,
      kind: m && m.userData && m.userData.archdiscStudioPrimitiveKind,
    };
  });
  expect(after.hasSel).toBe(true);
  expect(after.kind).toBe('cube');

  // Selection-gated ribbon buttons should now be enabled.
  await expect(win.locator('[data-studio-ribbon-action="smart-rust"]')).toBeEnabled();
  await expect(win.locator('[data-studio-ribbon-action="fillet"]')).toBeEnabled();

  // Clicking SM Rust now works end-to-end (regression-proves slice 311 too).
  await win.locator('[data-studio-ribbon-action="smart-rust"]').click();
  await win.waitForTimeout(500);
  const stamp = await win.evaluate(() => window.__studioSelectedMesh().userData.archdiscStudioSmartMat);
  expect(stamp).toBe('rust');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 313: addPrimitive auto-selects — SM Rust applied via ribbon end-to-end');

  await app.close();
});
