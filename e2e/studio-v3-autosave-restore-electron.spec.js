import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-autosave-restore');

test('Studio V3 — autosave restore prompt on app load (slice 466)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  // Seed V3 mode then spawn a cube + capture saveScene output as the
  // synthetic autosave payload. This way the restore actually goes
  // through __studioLoadScene's full code path.
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

  // Spawn cube, capture saveScene, then clear scene + write to autosave +
  // reload so V3 boots fresh with the autosave + empty scene.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  await win.evaluate(() => {
    const json = window.__studioSaveScene();
    window.localStorage.setItem('archdisc.studio.autosave', json);
    window.localStorage.setItem('archdisc.studio.autosave.ts', String(Date.now() - 12_000));
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });

  // Restore prompt appears (after the 500ms defer + scene-empty check).
  const banner = win.locator('[data-studio-v3-autosave-restore]');
  await expect(banner).toBeVisible({ timeout: 5000 });
  await expect(banner).toContainText(/Autosave found/);

  // Click Restore → scene grows, prompt dismisses.
  await win.locator('[data-studio-v3-autosave-restore-btn]').click();
  await win.waitForTimeout(800);
  await expect(banner).toHaveCount(0);

  // Scene should now have 1 primitive.
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
  console.log('  slice 466: autosave restore prompt → Restore → scene has', n, 'primitives');

  await app.close();
});
