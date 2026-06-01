import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-context-menu');

test('Studio V3 — viewport right-click context menu (slice 447)', async () => {
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

  // Right-click in the viewport — open the menu.
  const vp = win.locator('[data-studio-v3-viewport]');
  const box = await vp.boundingBox();
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await win.waitForTimeout(200);

  const menu = win.locator('[data-studio-v3-context-menu]');
  await expect(menu).toBeVisible();
  for (const id of ['duplicate', 'hide', 'frame', 'delete']) {
    await expect(win.locator(`[data-studio-v3-context-item="${id}"]`)).toBeVisible();
  }

  // Right-click may clear the V3 selection (it triggers a pointerdown
  // that the viewport reads as an empty pick). Re-select before clicking.
  await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });

  // Click Duplicate → 1 → 2 primitives.
  await win.locator('[data-studio-v3-context-item="duplicate"]').click();
  await win.waitForTimeout(300);
  const n2 = await win.evaluate(() => {
    let c = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) c++; });
    return c;
  });
  expect(n2).toBe(2);

  // Right-click again, Esc to dismiss.
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await win.waitForTimeout(200);
  await expect(menu).toBeVisible();
  await win.keyboard.press('Escape');
  await win.waitForTimeout(200);
  await expect(menu).toHaveCount(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 447: right-click opens menu, Duplicate works, Esc dismisses');

  await app.close();
});
