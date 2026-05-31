import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-mirror-ribbon');

test('Studio — Mirror ribbon button (slice 319)', async () => {
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

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);

  // Move cube off-origin so mirror lands visibly elsewhere.
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0.05, 0, 0); m.scale.set(4, 4, 4); m.updateMatrixWorld(true);
  });
  const beforeUuid = await win.evaluate(() => window.__studioSelectedMesh().uuid);

  await expect(win.locator('[data-studio-ribbon-action="mirror-x"]')).toBeEnabled();
  await win.locator('[data-studio-ribbon-action="mirror-x"]').click();
  await win.waitForTimeout(400);

  const mirror = await win.evaluate(({ src }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioMirrorOf === src) m = o; });
    return m ? { uuid: m.uuid, sx: m.scale.x, sy: m.scale.y, sz: m.scale.z, px: m.position.x } : null;
  }, { src: beforeUuid });
  expect(mirror).toBeTruthy();
  expect(mirror.sx).toBeCloseTo(-4, 4);
  expect(mirror.sy).toBeCloseTo(4, 4);
  expect(mirror.px).toBeCloseTo(0.05, 4);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 319: Mirror X ribbon spawned clone with scale=(-4,4,4)');

  await app.close();
});
