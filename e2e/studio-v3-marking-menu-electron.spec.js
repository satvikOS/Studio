import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-marking-menu');

test('Studio V3 — Shift+right-click radial marking menu (slice 456)', async () => {
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
  await win.waitForTimeout(400);

  // Spawn cube + select.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });

  // Shift+right-click in the viewport.
  const vp = win.locator('[data-studio-v3-viewport]');
  const box = await vp.boundingBox();
  await win.keyboard.down('Shift');
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await win.keyboard.up('Shift');
  await win.waitForTimeout(200);

  const menu = win.locator('[data-studio-v3-marking-menu]');
  await expect(menu).toHaveCount(1);

  // 8 items present.
  for (const id of ['frame', 'duplicate', 'move', 'rotate', 'scale', 'hide', 'delete', 'select-all']) {
    await expect(win.locator(`[data-studio-v3-marking-item="${id}"]`)).toBeVisible();
  }

  // Re-select before clicking Duplicate (right-click might've cleared sel).
  await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });

  await win.locator('[data-studio-v3-marking-item="duplicate"]').click();
  await win.waitForTimeout(300);
  await expect(menu).toHaveCount(0);

  const n = await win.evaluate(() => {
    let c = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) c++; });
    return c;
  });
  expect(n).toBe(2);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 456: Shift+right-click → 8-item radial menu; Duplicate adds primitive');

  await app.close();
});
