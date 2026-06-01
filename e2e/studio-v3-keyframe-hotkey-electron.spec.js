import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-keyframe-hotkey');

test('Studio V3 — K inserts keyframe at current frame (slice 442)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioInsertKeyframeAt === 'function', null, { timeout: 15000 });

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Need a selected mesh — keyframes hang off the mesh's transform.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const uuid = await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
    return m && m.uuid;
  });

  // Frame 0, press K.
  await win.evaluate(() => window.__studioSetFrame(0));
  await win.keyboard.press('k');
  await win.waitForTimeout(150);

  // Move to frame 5, K.
  await win.evaluate(() => window.__studioSetFrame(5));
  await win.keyboard.press('k');
  await win.waitForTimeout(150);

  // Keyframes should now contain frames 0 and 5.
  const frames = await win.evaluate((u) => {
    const r = window.__studioGetKeyframes && window.__studioGetKeyframes(u);
    const arr = (r && r.keyframes) || [];
    return arr.map((k) => k.frame);
  }, uuid);
  expect(frames).toContain(0);
  expect(frames).toContain(5);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 442: K inserted keyframes at', frames);

  await app.close();
});
