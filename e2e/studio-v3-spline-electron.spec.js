import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-spline');

test('Studio V3 — spline: create/sample/list/length/attach/delete (slice 677)', async () => {
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

  // 1: create spline (loops)
  const c = await win.evaluate(() => window.__studioSplineCreate([
    [0, 0, 0], [2, 1, 0], [3, 0, 2], [1, 0, 3], [-1, 0, 1],
  ], { closed: true, color: 0xff88aa }));
  expect(c.ok).toBe(true);
  expect(c.length).toBeGreaterThan(5);
  await win.screenshot({ path: path.join(OUT, '01-create.png') });

  // 2: sample at midpoint
  const sp = await win.evaluate((u) => window.__studioSplineSampleAt(u, 0.5), c.uuid);
  expect(sp.ok).toBe(true);
  expect(sp.position.length).toBe(3);
  await win.screenshot({ path: path.join(OUT, '02-sample.png') });

  // 3: list
  const l = await win.evaluate(() => window.__studioSplineList());
  expect(l.count).toBe(1);
  await win.screenshot({ path: path.join(OUT, '03-list.png') });

  // 4: length
  const len = await win.evaluate((u) => window.__studioSplineLength(u), c.uuid);
  expect(len.length).toBeGreaterThan(5);
  await win.screenshot({ path: path.join(OUT, '04-length.png') });

  // 5: attach a sphere and verify position changes after a tick
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(150);
  const mUuid = await win.evaluate(() => window.__studioSelectedMesh().uuid);
  const att = await win.evaluate(([mu, su]) => window.__studioSplineAttachMesh(mu, su, 2), [mUuid, c.uuid]);
  expect(att.ok).toBe(true);
  const before = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    return [m.position.x, m.position.y, m.position.z];
  }, mUuid);
  await win.waitForTimeout(450);
  const after = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    return [m.position.x, m.position.y, m.position.z];
  }, mUuid);
  // pos drifted along the loop
  expect(after.some((v, i) => Math.abs(v - before[i]) > 0.01)).toBe(true);
  await win.screenshot({ path: path.join(OUT, '05-attach.png') });

  // 6: delete spline
  const d = await win.evaluate((u) => window.__studioSplineDelete(u), c.uuid);
  expect(d.remaining).toBe(0);
  await win.screenshot({ path: path.join(OUT, '06-delete.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 677: 6 spline features verified — length', c.length.toFixed(2), 'drift', after.map((v, i) => (v - before[i]).toFixed(3)).join(','));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
