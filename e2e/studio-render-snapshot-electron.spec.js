import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 5 — Studio Render Snapshot.
 *
 * "Empty viewport → fully rendered output" — the first concrete step.
 * The user composes a scene with a few primitives, then captures the
 * viewport state by clicking the Render Frame button. The captured
 * pixel buffer turns into a data-URL thumbnail in the Renders panel.
 * Multiple captures accumulate, each carrying its own engine + sample
 * metadata; Clear Renders empties the panel.
 *
 * Spec drives the entire workflow through real clicks in the headed
 * Electron app. Camera-orbit between captures so each render is
 * visually distinct.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-render-snapshot');

test('Studio render snapshot — three renders from three angles, then Clear Renders', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 350,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport && !!window.__archdiscViewport.renderer, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- Renders panel starts empty ----
  await expect(win.locator('[data-studio-section="renders"]')).toBeVisible();
  await expect(win.locator('[data-studio-render-count]')).toHaveText('0');
  await expect(win.locator('[data-studio-render-thumbs]')).toHaveCount(0);
  await win.screenshot({ path: path.join(OUT, '00-renders-panel-empty.png'), fullPage: false });

  // ---- Compose a small scene so renders show something visually ----
  for (const kind of ['cube', 'sphere', 'torus-knot']) {
    await win.locator(`[data-studio-primitive="${kind}"]`).click();
    await win.waitForTimeout(450);
  }
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('3 primitives in scene');
  await win.screenshot({ path: path.join(OUT, '01-composed-three.png'), fullPage: false });

  // ---- Render Frame #1 (default angle, default samples 128) ----
  await win.locator('[data-studio-action="render-frame"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-render-count]')).toHaveText('1');
  await expect(win.locator('[data-studio-render-thumb="0"]')).toBeVisible();
  // The img has a real data: URL with non-trivial length.
  const dataUrl0 = await win.locator('[data-studio-render-image="0"]').getAttribute('src');
  expect(dataUrl0).toMatch(/^data:image\/png;base64,/);
  expect(dataUrl0.length).toBeGreaterThan(1000);
  await win.screenshot({ path: path.join(OUT, '02-render-1-captured.png'), fullPage: false });

  // ---- Orbit, change samples to 64, Render Frame #2 ----
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(120, 30, 1));
  await win.waitForTimeout(400);
  await win.locator('[data-studio-render="samples"]').fill('64');
  await win.locator('[data-studio-action="render-frame"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-render-count]')).toHaveText('2');
  await expect(win.locator('[data-studio-render-thumb="1"]')).toBeVisible();
  const dataUrl1 = await win.locator('[data-studio-render-image="1"]').getAttribute('src');
  expect(dataUrl1).toMatch(/^data:image\/png;base64,/);
  // The second render captures a different camera angle, so the pixels
  // differ — data URLs must NOT match.
  expect(dataUrl1).not.toBe(dataUrl0);
  await win.screenshot({ path: path.join(OUT, '03-render-2-different-angle.png'), fullPage: false });

  // ---- Switch engine to EEVEE, orbit again, Render Frame #3 ----
  await win.locator('[data-studio-render="engine"]').selectOption('eevee');
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(240, 30, 1));
  await win.waitForTimeout(400);
  await win.locator('[data-studio-action="render-frame"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-render-count]')).toHaveText('3');
  await expect(win.locator('[data-studio-render-thumb="2"]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '04-render-3-eevee.png'), fullPage: false });

  // ---- Tight crop on the right panel showing all 3 thumbnails ----
  const rendersPanelBox = await win.locator('[data-studio-section="renders"]').boundingBox();
  if (rendersPanelBox) {
    await win.screenshot({
      path: path.join(OUT, '05-renders-panel-three-thumbs.png'),
      clip: rendersPanelBox,
    });
  }

  // ---- Clear Renders → empty state returns ----
  await win.locator('[data-studio-action="clear-renders"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-render-count]')).toHaveText('0');
  await expect(win.locator('[data-studio-render-thumbs]')).toHaveCount(0);
  await win.screenshot({ path: path.join(OUT, '06-renders-cleared.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log('  render snapshot workflow: 3 captures (different angles, engines, sample counts) → cleared');

  await app.close();
});
