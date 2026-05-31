import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-swatch-picker');

test('Studio — Outliner swatch click + change updates mesh color (slice 274)', async () => {
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

  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'swatch picker demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'cube', pos: [0, 0, 0], scale: [4, 4, 4], color: '#9ab' }],
      expect: { bodies: 1, kinds: ['cube'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);

  // Drive the swatch click handler — synthetically inject a colour
  // change without actually opening the native picker (which would
  // block the test on a system modal).
  await win.evaluate(() => {
    const row = document.querySelector('[data-studio-outliner-kind="cube"]');
    const sw = row && row.querySelector('[data-studio-outliner-swatch]');
    if (!sw) return;
    // Stub document.createElement to intercept the colour input,
    // dispatch a change immediately with our chosen value, then
    // restore the real createElement.
    const origCreate = document.createElement.bind(document);
    document.createElement = (tag) => {
      const el = origCreate(tag);
      if (tag === 'input') {
        // Auto-fire change on .click() with a known colour.
        const origClick = el.click.bind(el);
        el.click = () => {
          el.value = '#22cc66';
          el.dispatchEvent(new Event('change', { bubbles: true }));
          origClick();
        };
      }
      return el;
    };
    sw.click();
    document.createElement = origCreate;
  });
  await win.waitForTimeout(400);

  const col = await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    return m && m.material && m.material.color && m.material.color.getHexString();
  });
  expect(col).toBe('22cc66');
  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 274: swatch picker updated mesh color to #' + col);

  await app.close();
});
