import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-hud-counts');

test('Studio V3 — viewport HUD sub-object selection counts (slice 426)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSetEditMode === 'function', null, { timeout: 15000 });

  // Object mode → counts badge hidden.
  await expect(win.locator('[data-studio-v3-edit-counts]')).toHaveCount(0);

  // Spawn + select cube.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });

  // Flip to vertex mode → counts badge appears at 0/0/0.
  await win.evaluate(() => window.__studioSetEditMode('vertex'));
  await win.waitForTimeout(200);
  const badge = win.locator('[data-studio-v3-edit-counts]');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute('data-studio-v3-edit-v', '0');

  // Dispatch a pick → vert count grows.
  await win.evaluate(() => {
    window.dispatchEvent(new CustomEvent('studio-pick', { detail: { mode: 'vertex', result: { ok: true, vertIdx: 0 } } }));
  });
  await expect(badge).toHaveAttribute('data-studio-v3-edit-v', '1');

  // Additive 2nd pick → 2.
  await win.evaluate(() => {
    window.dispatchEvent(new CustomEvent('studio-pick', { detail: { mode: 'vertex', result: { ok: true, vertIdx: 5 }, additive: true } }));
  });
  await expect(badge).toHaveAttribute('data-studio-v3-edit-v', '2');

  // Switch to edge mode + pick → edge count = 1.
  await win.evaluate(() => window.__studioSetEditMode('edge'));
  await win.evaluate(() => {
    window.dispatchEvent(new CustomEvent('studio-pick', { detail: { mode: 'edge', result: { ok: true, vertIdx: [0, 1] } } }));
  });
  await expect(badge).toHaveAttribute('data-studio-v3-edit-e', '1');

  // Back to object mode → badge gone.
  await win.evaluate(() => window.__studioSetEditMode('object'));
  await expect(win.locator('[data-studio-v3-edit-counts]')).toHaveCount(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 426: V3 HUD counts badge appears in sub-object modes, hides in object');

  await app.close();
});
