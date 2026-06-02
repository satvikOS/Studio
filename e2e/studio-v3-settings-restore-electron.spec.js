import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-settings-restore');

test('Studio V3 — Settings Restore Last Autosave button (slice 475)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    window.localStorage.removeItem('archdisc.studio.autosave');
    window.localStorage.removeItem('archdisc.studio.autosave.ts');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // Spawn + save scene + write to autosave, then clear scene.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    const json = window.__studioSaveScene();
    window.localStorage.setItem('archdisc.studio.autosave', json);
    window.localStorage.setItem('archdisc.studio.autosave.ts', String(Date.now() - 10_000));
    // Clear the scene.
    const s = window.__archdiscScene;
    const doomed = [];
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) doomed.push(o); });
    for (const o of doomed) {
      if (o.geometry) o.geometry.dispose();
      s.remove(o);
    }
  });

  // Open settings.
  await win.locator('[data-studio-v3-qat-btn="settings"]').click();
  await win.waitForTimeout(1100);

  const restore = win.locator('[data-studio-v3-settings-restore]');
  await expect(restore).toBeVisible();
  await restore.click();
  await win.waitForTimeout(400);

  // Scene should now have at least 1 primitive again.
  const n = await win.evaluate(() => {
    let c = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) c++; });
    return c;
  });
  expect(n).toBeGreaterThanOrEqual(1);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 475: settings restore button → scene has', n, 'primitives');

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
