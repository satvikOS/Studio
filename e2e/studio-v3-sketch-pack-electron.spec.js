import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-sketch-pack');

test('Studio V3 — sketch: addPoint/close/get/extrude/revolve/clear (slice 635)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 250,
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

  // 1: addPoint × 4 — a square
  for (const [x, z] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const r = await win.evaluate(([a, b]) => window.__studioSketchAddPoint(a, b), [x, z]);
    expect(r.ok).toBe(true);
  }
  await win.screenshot({ path: path.join(OUT, '01-add.png') });

  // 2: close
  const close = await win.evaluate(() => window.__studioSketchClose());
  expect(close.closed).toBe(true);
  await win.screenshot({ path: path.join(OUT, '02-close.png') });

  // 3: getPoints
  const list = await win.evaluate(() => window.__studioSketchGetPoints());
  expect(list.points.length).toBe(4);
  expect(list.closed).toBe(true);
  await win.screenshot({ path: path.join(OUT, '03-list.png') });

  // 4: extrude
  const ext = await win.evaluate(() => window.__studioSketchExtrude(0.5));
  expect(ext.ok).toBe(true);
  expect(ext.depth).toBe(0.5);
  expect(ext.verts).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '04-extrude.png') });

  // 5: revolve — build a profile then revolve
  await win.evaluate(() => window.__studioSketchClear());
  // a vase profile (radius increases then decreases)
  for (const [x, z] of [[0.1, 0], [0.4, 0.2], [0.6, 0.5], [0.5, 0.8], [0.55, 1.1]]) {
    await win.evaluate(([a, b]) => window.__studioSketchAddPoint(a, b), [x, z]);
  }
  const rev = await win.evaluate(() => window.__studioSketchRevolve(64, 360));
  expect(rev.ok).toBe(true);
  expect(rev.segments).toBe(64);
  await win.screenshot({ path: path.join(OUT, '05-revolve.png') });

  // 6: clear
  const cl = await win.evaluate(() => window.__studioSketchClear());
  expect(cl.ok).toBe(true);
  const after = await win.evaluate(() => window.__studioSketchGetPoints());
  expect(after.points.length).toBe(0);
  expect(after.closed).toBe(false);
  await win.screenshot({ path: path.join(OUT, '06-clear.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 635: 6 features — sketch extrude/revolve verified');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
