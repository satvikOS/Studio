import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-mountain-ribbon');

test('Studio — Mountain ribbon button (slice 371)', async () => {
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

  await expect(win.locator('[data-studio-primitive="mountain"]')).toBeVisible();
  await win.locator('[data-studio-primitive="mountain"]').click();
  await win.waitForTimeout(500);

  const probe = await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'mountain') m = o; });
    return m ? { kind: m.userData.archdiscStudioPrimitiveKind, vertCount: m.geometry.attributes.position.count } : null;
  });
  expect(probe).toBeTruthy();
  expect(probe.kind).toBe('mountain');
  expect(probe.vertCount).toBeGreaterThan(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 371: Mountain ribbon spawned mesh with', probe.vertCount, 'verts');

  await app.close();
});
