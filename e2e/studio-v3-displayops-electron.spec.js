import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-displayops');

test('Studio V3 — display / view toggles (slice 424)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioToggleCheatSheet === 'function', null, { timeout: 15000 });

  // ToggleCheatSheet flips + fires event.
  const evHeard = await win.evaluate(() => new Promise((resolve) => {
    const h = (ev) => { window.removeEventListener('studio-cheatsheet-toggle', h); resolve(ev.detail); };
    window.addEventListener('studio-cheatsheet-toggle', h);
    window.__studioToggleCheatSheet();
  }));
  expect(typeof evHeard.open).toBe('boolean');

  // SetBgColor accepts hex.
  let r = await win.evaluate(() => window.__studioSetBgColor(0x222244));
  expect(r.ok).toBe(true);
  expect(r.color).toBe('#222244');
  r = await win.evaluate(() => window.__studioSetBgColor('#aabbcc'));
  expect(r.color).toBe('#aabbcc');

  // ToggleLocalView — needs a selection.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(150);
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });

  r = await win.evaluate(() => window.__studioToggleLocalView());
  expect(r.ok).toBe(true);
  expect(r.on).toBe(true);
  expect(r.revealed).toBeGreaterThan(0);
  // Now only the selected primitive is visible.
  const visCount = await win.evaluate(() => {
    let n = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive && o.visible) n++; });
    return n;
  });
  expect(visCount).toBe(1);

  r = await win.evaluate(() => window.__studioToggleLocalView());
  expect(r.on).toBe(false);

  // SyncDisplay broadcasts.
  const sync = await win.evaluate(() => new Promise((resolve) => {
    const h = (ev) => { window.removeEventListener('studio-display-sync', h); resolve(!!ev); };
    window.addEventListener('studio-display-sync', h);
    window.__studioSyncDisplay();
  }));
  expect(sync).toBe(true);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 424: cheat-sheet + bg color + local view + sync all ok');

  await app.close();
});
