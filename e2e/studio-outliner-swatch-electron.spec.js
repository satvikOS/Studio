import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 228: Outliner per-entry colour swatch.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-outliner-swatch');

test('Studio — Outliner shows a per-entry colour swatch matching mesh material', async () => {
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

  // 2 distinct-coloured primitives.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'swatch demo',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'cube',   pos: [-0.06, 0, 0], scale: [1, 1, 1], color: '#3344aa' },
        { kind: 'sphere', pos: [ 0.06, 0, 0], scale: [1, 1, 1], color: '#aa3344' },
      ],
      expect: { bodies: 2, kinds: ['cube', 'sphere'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);

  // Each Outliner entry has a swatch attr matching the mesh's colour.
  const swatches = await win.evaluate(() => {
    const out = {};
    document.querySelectorAll('[data-studio-outliner-kind]').forEach((row) => {
      const kind = row.getAttribute('data-studio-outliner-kind');
      const swatch = row.querySelector('[data-studio-outliner-swatch]');
      if (swatch) out[kind] = swatch.getAttribute('data-studio-outliner-swatch');
    });
    return out;
  });
  expect(swatches.cube, 'cube swatch').toBe('#3344aa');
  expect(swatches.sphere, 'sphere swatch').toBe('#aa3344');
  await win.screenshot({ path: path.join(OUT, '00-swatches.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 228: Outliner colour swatches working');

  await app.close();
});
