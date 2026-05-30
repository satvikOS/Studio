import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-curriculum-picker');

test('Studio — N-panel curriculum dropdown + Run button (slice 270)', async () => {
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
  await win.waitForFunction(() => !!window.__archieEngine, null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="View"]').click());
  await win.waitForTimeout(300);

  // Choose 2nd goal + run.
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-npanel-archie-goal]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    const opts = Array.from(el.options).map((o) => o.value);
    setter.call(el, opts[1]);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await win.evaluate(() => document.querySelector('[data-studio-npanel-run-archie]').click());
  await win.waitForFunction(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return n >= 3;
  }, null, { timeout: 30000 });
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '00-built.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 270: dropdown + run produced an Archie scene');

  await app.close();
});
