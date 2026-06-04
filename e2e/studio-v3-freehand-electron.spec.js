import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-freehand');

test('Studio V3 — freehand: start/point/end/list/clear/clearAll (slice 644)', async () => {
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

  // 1: start
  const s = await win.evaluate(() => window.__studioFreehandStart(0xffaa00, 3));
  expect(s.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '01-start.png') });

  // 2: points — sketch a square
  for (const [x, y, z] of [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 0, 0]]) {
    const r = await win.evaluate(([a, b, c]) => window.__studioFreehandPoint(a, b, c), [x, y, z]);
    expect(r.ok).toBe(true);
  }
  await win.screenshot({ path: path.join(OUT, '02-points.png') });

  // 3: end — creates a real Line in the scene
  const e = await win.evaluate(() => window.__studioFreehandEnd());
  expect(e.ok).toBe(true);
  expect(e.points).toBe(5);
  const exists = await win.evaluate((u) => !!window.__archdiscScene.getObjectByProperty('uuid', u), e.uuid);
  expect(exists).toBe(true);
  await win.screenshot({ path: path.join(OUT, '03-end.png') });

  // 4: another stroke + list
  await win.evaluate(() => {
    window.__studioFreehandStart(0x00aaff, 2);
    [[0, 1, 0], [1, 1.5, 0], [2, 1, 0]].forEach(([a, b, c]) => window.__studioFreehandPoint(a, b, c));
    window.__studioFreehandEnd();
  });
  const list = await win.evaluate(() => window.__studioFreehandList());
  expect(list.count).toBe(2);
  expect(list.strokes[0].length).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '04-list.png') });

  // 5: clear one
  const first = list.strokes[0].uuid;
  const cl = await win.evaluate((u) => window.__studioFreehandClear(u), first);
  expect(cl.ok).toBe(true);
  expect(cl.remaining).toBe(1);
  await win.screenshot({ path: path.join(OUT, '05-clear.png') });

  // 6: clearAll
  const all = await win.evaluate(() => window.__studioFreehandClearAll());
  expect(all.ok).toBe(true);
  expect(all.cleared).toBe(1);
  const empty = await win.evaluate(() => window.__studioFreehandList());
  expect(empty.count).toBe(0);
  await win.screenshot({ path: path.join(OUT, '06-clearAll.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 644: 6 freehand features verified');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
