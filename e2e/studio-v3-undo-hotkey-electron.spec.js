import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-undo-hotkey');

test('Studio V3 — Cmd+Z undo / Cmd+Shift+Z redo (slice 437)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioPushUndo === 'function', null, { timeout: 15000 });

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Spawn cube + select.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });

  // Mutate position then push undo BEFORE the change so undo restores.
  await win.evaluate(() => {
    if (window.__studioPushUndo) window.__studioPushUndo();
    const m = window.__studioSelectedMesh();
    m.position.set(0.1, 0.2, 0.3);
    m.updateMatrixWorld(true);
  });

  // Confirm position is 0.1, 0.2, 0.3.
  let pos = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return [m.position.x, m.position.y, m.position.z];
  });
  expect(pos[0]).toBeCloseTo(0.1, 5);

  // Cmd+Z → undo → restores to pre-mutate position (likely near origin).
  await win.keyboard.press('Meta+z');
  await win.waitForTimeout(200);
  pos = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return [m.position.x, m.position.y, m.position.z];
  });
  expect(Math.abs(pos[0] - 0.1)).toBeGreaterThan(0.001);

  // Cmd+Shift+Z → redo → back to 0.1, 0.2, 0.3.
  await win.keyboard.press('Meta+Shift+z');
  await win.waitForTimeout(200);
  pos = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return [m.position.x, m.position.y, m.position.z];
  });
  expect(pos[0]).toBeCloseTo(0.1, 4);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 437: Cmd+Z restores, Cmd+Shift+Z redoes — pos round-trip ok');

  await app.close();
});
