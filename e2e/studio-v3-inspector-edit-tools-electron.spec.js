import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-inspector-edit-tools');

test('Studio V3 — inspector Edit Tools section (slice 433)', async () => {
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
  await win.waitForTimeout(400);

  // Inspector tab is default.
  await expect(win.locator('[data-studio-v3-right-tab="inspector"]'))
    .toHaveAttribute('data-active', 'true');

  // Object mode → Edit Tools section absent.
  await expect(win.locator('[data-studio-v3-edit-tools]')).toHaveCount(0);

  // Flip to face mode via window API.
  await win.evaluate(() => window.__studioSetEditMode('face'));
  await win.waitForTimeout(200);

  // Edit Tools section appears with 6 buttons.
  await expect(win.locator('[data-studio-v3-edit-tools]')).toBeVisible();
  for (const id of ['extrude', 'inset', 'subdivide', 'invert', 'all', 'clear']) {
    await expect(win.locator(`[data-studio-v3-edit-tool="${id}"]`)).toBeVisible();
  }

  // Spawn cube + select.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });

  // Pick face 0, then click Extrude — geometry should grow.
  await win.evaluate(() => window.__studioReplaceEditSelection('face', 0));
  await win.locator('[data-studio-v3-edit-tool="extrude"]').click();
  await win.waitForTimeout(300);
  const counts = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { v: m.geometry.attributes.position.count, t: Math.floor(m.geometry.index.array.length / 3) };
  });
  expect(counts.v).toBe(27);
  expect(counts.t).toBe(18);

  // Back to object mode → Edit Tools section disappears.
  await win.evaluate(() => window.__studioSetEditMode('object'));
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-edit-tools]')).toHaveCount(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 433: inspector Edit Tools buttons drive extrude (24→27 v / 12→18 t)');

  await app.close();
});
