import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-vertex-group');

test('Studio V3 — vertex groups: create/setWeight/addIndex/get/list/remove (slice 676)', async () => {
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

  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // 1: create
  const c = await win.evaluate(() => window.__studioVertexGroupCreate('upper', 0));
  expect(c.ok).toBe(true);
  expect(c.vertices).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '01-create.png') });

  // 2: setWeight on idx 0
  const w = await win.evaluate(() => window.__studioVertexGroupSetWeight('upper', 0, 0.75));
  expect(w.ok).toBe(true);
  expect(w.weight).toBe(0.75);
  await win.screenshot({ path: path.join(OUT, '02-setW.png') });

  // 3: addIndex implies weight 1
  const a = await win.evaluate(() => window.__studioVertexGroupAddIndex('upper', 5));
  expect(a.weight).toBe(1);
  await win.screenshot({ path: path.join(OUT, '03-addIdx.png') });

  // 4: getWeights
  const g = await win.evaluate(() => window.__studioVertexGroupGetWeights('upper'));
  expect(g.ok).toBe(true);
  expect(g.nonZero).toBe(2);
  expect(g.sum).toBeCloseTo(1.75, 6);
  await win.screenshot({ path: path.join(OUT, '04-get.png') });

  // 5: list
  const l = await win.evaluate(() => window.__studioVertexGroupList());
  expect(l.count).toBe(1);
  await win.screenshot({ path: path.join(OUT, '05-list.png') });

  // 6: remove
  const r = await win.evaluate(() => window.__studioVertexGroupRemove('upper'));
  expect(r.removed).toBe(true);
  const after = await win.evaluate(() => window.__studioVertexGroupList());
  expect(after.count).toBe(0);
  await win.screenshot({ path: path.join(OUT, '06-remove.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 676: 6 vertex-group features verified — verts', c.vertices, 'nonZero', g.nonZero);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
