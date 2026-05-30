import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 224: F2 renames active mesh (Blender F2).
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-f2-rename');

test('Studio — F2 triggers Outliner rename flow on active mesh', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 700,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Spawn a sphere + select it.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'f2 rename demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'sphere', pos: [0, 0, 0], scale: [1, 1, 1], color: '#c9a' }],
      expect: { bodies: 1, kinds: ['sphere'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.evaluate(() => {
    const s = window.__archdiscScene;
    let m = null;
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(300);

  // F2 + edit + blur in one evaluate (slice 200 contenteditable flow).
  const renamed = await win.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    const label = document.querySelector('[data-studio-outliner-label]');
    if (!label || label.contentEditable !== 'true') return { ok: false };
    label.textContent = 'HeroSphere';
    label.dispatchEvent(new Event('blur'));
    let n = null;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') n = o.name;
    });
    return { ok: true, name: n };
  });
  expect(renamed.ok, 'F2 entered edit mode').toBe(true);
  expect(renamed.name, 'name updated').toBe('HeroSphere');
  await win.screenshot({ path: path.join(OUT, '00-renamed.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 224: F2 rename working');

  await app.close();
});
