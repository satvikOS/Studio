import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 20 — Compositing: canvas-filter post-process of render captures.
 *
 * Take a Render Frame, then Post-Process Last Render through each of
 * the built-in filters (grayscale / sepia / invert / blur / contrast /
 * hue-rotate / saturate). Each filter pass adds a new thumbnail with
 * a "+filter" suffix in the engine label.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-compositing');

test('Studio compositing — render, then post-process through multiple filters', async () => {
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

  await expect(win.locator('[data-studio-section="compositing"]')).toBeVisible();
  // Post-process disabled with no renders to chew on.
  await expect(win.locator('[data-studio-action="post-process"]')).toBeDisabled();

  // ---- Compose a small scene so the render isn't blank ----
  for (const k of ['cube', 'torus-knot']) {
    await win.locator(`[data-studio-primitive="${k}"]`).click();
    await win.waitForTimeout(300);
  }
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(35, 25, 1));
  await win.waitForTimeout(300);

  // ---- Take a render — post-process button enables ----
  await win.locator('[data-studio-action="render-frame"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-render-count]')).toHaveText('1');
  await expect(win.locator('[data-studio-action="post-process"]')).toBeEnabled();
  await win.screenshot({ path: path.join(OUT, '00-one-render-baseline.png'), fullPage: false });

  // Helper: apply current filter, wait for thumbnail to append.
  async function applyFilter(filter) {
    await win.locator('[data-studio-compositing="filter"]').selectOption(filter);
    const before = Number(await win.locator('[data-studio-render-count]').textContent());
    await win.locator('[data-studio-action="post-process"]').click();
    // The filter pass uses an Image.onload — wait until the render
    // count increments before continuing.
    await expect.poll(
      async () => Number(await win.locator('[data-studio-render-count]').textContent()),
      { timeout: 5000, message: `render count never grew after filter ${filter}` },
    ).toBe(before + 1);
  }

  // ---- Grayscale ----
  await applyFilter('grayscale(100%)');
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '01-after-grayscale.png'), fullPage: false });

  // ---- Sepia ----
  await applyFilter('sepia(100%)');
  await win.screenshot({ path: path.join(OUT, '02-after-sepia.png'), fullPage: false });

  // ---- Invert ----
  await applyFilter('invert(100%)');
  await win.screenshot({ path: path.join(OUT, '03-after-invert.png'), fullPage: false });

  // ---- Blur ----
  await applyFilter('blur(3px)');
  await win.screenshot({ path: path.join(OUT, '04-after-blur.png'), fullPage: false });

  // Total count: baseline render + 4 filters = 5 thumbnails.
  await expect(win.locator('[data-studio-render-count]')).toHaveText('5');

  // ---- Validate the most recent thumbnail's data URL is non-trivial ----
  const lastDataLen = await win.evaluate(() => {
    const imgs = document.querySelectorAll('[data-studio-render-image]');
    if (imgs.length === 0) return 0;
    const last = imgs[imgs.length - 1];
    return (last.getAttribute('src') || '').length;
  });
  expect(lastDataLen).toBeGreaterThan(1000);

  // Final full-window screenshot — 5 thumbnails extend below the
  // viewport so the renders panel is scrollable; capture whole window
  // (a clip of the panel's bounding box overflows the screenshot area).
  await win.screenshot({ path: path.join(OUT, '05-five-thumbs-window.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log('  compositing: baseline → grayscale → sepia → invert → blur (5 thumbnails total)');

  await app.close();
});
