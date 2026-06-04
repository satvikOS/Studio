import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-sculpt-apply');

test('Studio V3 — sculpt brush displaces vertices (slice 621)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.locator('[data-studio-v3-tool="ico"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(250);

  // Crank the brush so the delta is unmistakable.
  await win.evaluate(() => window.__studioSetSculptBrush({ kind: 'inflate', size: 5, strength: 0.5, falloff: 0.6 }));

  const before = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const a = m.geometry.attributes.position.array;
    // furthest vertex from origin in +Y
    let maxY = -Infinity;
    for (let i = 0; i < a.length; i += 3) if (a[i + 1] > maxY) maxY = a[i + 1];
    return maxY;
  });

  const r = await win.evaluate(() => window.__studioSculptBrushApply([0, 1, 0]));
  expect(r.ok).toBe(true);
  expect(r.touched).toBeGreaterThan(0);

  const after = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const a = m.geometry.attributes.position.array;
    let maxY = -Infinity;
    for (let i = 0; i < a.length; i += 3) if (a[i + 1] > maxY) maxY = a[i + 1];
    return maxY;
  });
  expect(after).toBeGreaterThan(before);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 621: sculpt maxY', before.toFixed(3), '→', after.toFixed(3), `(touched ${r.touched})`);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
