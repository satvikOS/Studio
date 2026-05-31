import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-clone-along-axis');

test('Studio — 3ds Max Array / Plasticity Replicate (slice 353)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioCloneAlongAxis === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  const beforeUuid = await win.evaluate(() => window.__studioSelectedMesh().uuid);

  const r = await win.evaluate(() => window.__studioCloneAlongAxis({ count: 4, axis: 'x', spacing: 0.06 }));
  expect(r.ok).toBe(true);
  expect(r.count).toBe(4);
  expect(r.created.length).toBe(4);

  // Verify each clone exists in scene with the link back to source.
  const probe = await win.evaluate(({ src }) => {
    let linked = 0;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioClonedFrom === src) linked++;
    });
    return { linked };
  }, { src: beforeUuid });
  expect(probe.linked).toBe(4);

  // Bad axis rejected.
  const bad = await win.evaluate(() => window.__studioCloneAlongAxis({ count: 2, axis: 'q' }));
  expect(bad.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 353: array along X spawned 4 clones linked to source uuid');

  await app.close();
});
