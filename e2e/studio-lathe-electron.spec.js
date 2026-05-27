import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 14 — Lathe / NURBS-style hard-surface.
 *
 * Pick a profile (Vase / Goblet / Column), pick segment count, click
 * Add Lathe Surface — three.js LatheGeometry revolves the chosen 2D
 * profile around the Y axis. Studio primitive lifecycle (selection,
 * material, sculpt) carries through unchanged.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-lathe');

test('Studio lathe surface — Vase, Goblet, Column profiles revolve around Y', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 300,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await expect(win.locator('[data-studio-section="lathe"]')).toBeVisible();
  await expect(win.locator('[data-studio-lathe-readout="segments"]')).toHaveText('48');
  await win.screenshot({ path: path.join(OUT, '00-lathe-panel-default.png'), fullPage: false });

  // ---- Vase (default) at 48 segs ----
  await win.locator('[data-studio-action="add-lathe"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('1 primitive in scene');
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(40, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-vase-48seg.png'), fullPage: false });

  // ---- Goblet at higher segment count ----
  await win.locator('[data-studio-lathe="profile"]').selectOption('goblet');
  await win.locator('[data-studio-lathe="segments"]').fill('96');
  await win.dispatchEvent('[data-studio-lathe="segments"]', 'input');
  await expect(win.locator('[data-studio-lathe-readout="segments"]')).toHaveText('96');
  await win.locator('[data-studio-action="add-lathe"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('2 primitives in scene');
  await win.screenshot({ path: path.join(OUT, '02-goblet-96seg.png'), fullPage: false });

  // ---- Column at low segment count (visible faceting) ----
  await win.locator('[data-studio-lathe="profile"]').selectOption('column');
  await win.locator('[data-studio-lathe="segments"]').fill('12');
  await win.dispatchEvent('[data-studio-lathe="segments"]', 'input');
  await win.locator('[data-studio-action="add-lathe"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('3 primitives in scene');

  const kinds = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const set = new Set();
    vp.scene.traverse(o => {
      if (o.userData && /^lathe-/.test(o.userData.archdiscStudioPrimitiveKind || '')) {
        set.add(o.userData.archdiscStudioPrimitiveKind);
      }
    });
    return Array.from(set).sort();
  });
  expect(kinds).toEqual(['lathe-column', 'lathe-goblet', 'lathe-vase']);

  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(45, 20, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '03-three-lathes-az45.png'), fullPage: false });
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(225, 20, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '04-three-lathes-az225.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  lathe: vase(48) → goblet(96) → column(12). distinct kinds: ${kinds.join(', ')}`);

  await app.close();
});
