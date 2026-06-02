import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-inset-subdivide-hotkey');

test('Studio V3 — I insets / W subdivides selected face (slice 482)', async () => {
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

  // Cube + face mode + face 0 selected.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
    window.__studioSetEditMode('face');
    window.__studioReplaceEditSelection('face', 0);
  });

  // Press I → 24v/12t → 27v/18t.
  await win.keyboard.press('i');
  await win.waitForTimeout(300);
  const afterI = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { v: m.geometry.attributes.position.count, t: Math.floor(m.geometry.index.array.length / 3) };
  });
  expect(afterI.v).toBe(27);
  expect(afterI.t).toBe(18);

  // Reselect face 0, press W → subdivide adds 3 verts + 3 net triangles.
  await win.evaluate(() => window.__studioReplaceEditSelection('face', 0));
  await win.keyboard.press('w');
  await win.waitForTimeout(300);
  const afterW = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { v: m.geometry.attributes.position.count, t: Math.floor(m.geometry.index.array.length / 3) };
  });
  expect(afterW.v).toBe(30);
  expect(afterW.t).toBe(21);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 482: I → 27v/18t, W → 30v/21t');

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
