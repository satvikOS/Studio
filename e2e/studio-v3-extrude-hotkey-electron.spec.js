import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-extrude-hotkey');

test('Studio V3 — E extrudes face in face mode (slice 481)', async () => {
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

  // Spawn + select cube + flip to face mode + select face 0.
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

  // Pre-extrude: 24 v / 12 t.
  const before = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { v: m.geometry.attributes.position.count, t: Math.floor(m.geometry.index.array.length / 3) };
  });
  expect(before.v).toBe(24);
  expect(before.t).toBe(12);

  // Press E.
  await win.keyboard.press('e');
  await win.waitForTimeout(300);

  const after = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { v: m.geometry.attributes.position.count, t: Math.floor(m.geometry.index.array.length / 3) };
  });
  expect(after.v).toBe(27);
  expect(after.t).toBe(18);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 481: E extruded cube face — 24→27 v, 12→18 t');

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
