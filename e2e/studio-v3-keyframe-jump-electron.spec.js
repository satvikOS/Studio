import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-keyframe-jump');

test('Studio V3 — J/L jump to prev/next keyframe (slice 483)', async () => {
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
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Spawn + select cube + insert keyframes at 0, 10, 20.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
    window.__studioSetFrame(0);  window.__studioInsertKeyframeAt(0);
    window.__studioSetFrame(10); window.__studioInsertKeyframeAt(10);
    window.__studioSetFrame(20); window.__studioInsertKeyframeAt(20);
    window.__studioSetFrame(5);
  });

  // Press L → next is 10.
  await win.keyboard.press('l');
  await win.waitForTimeout(150);
  expect(await win.evaluate(() => window.__studioGetFrame())).toBe(10);

  // L again → 20.
  await win.keyboard.press('l');
  await win.waitForTimeout(150);
  expect(await win.evaluate(() => window.__studioGetFrame())).toBe(20);

  // L again → stays at 20 (no next).
  await win.keyboard.press('l');
  await win.waitForTimeout(150);
  expect(await win.evaluate(() => window.__studioGetFrame())).toBe(20);

  // J → 10.
  await win.keyboard.press('j');
  await win.waitForTimeout(150);
  expect(await win.evaluate(() => window.__studioGetFrame())).toBe(10);

  // J → 0.
  await win.keyboard.press('j');
  await win.waitForTimeout(150);
  expect(await win.evaluate(() => window.__studioGetFrame())).toBe(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 483: L → 10 → 20 → 20; J → 10 → 0');

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
