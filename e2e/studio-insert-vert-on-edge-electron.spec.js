import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-insert-vert-on-edge');

test('Studio — insert vertex on edge subdivides triangle (slice 362)', async () => {
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
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioInsertVertexOnEdge === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  const uuid = await win.evaluate(() => window.__studioSelectedMesh().uuid);

  const before = await win.evaluate(({ u }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) m = o; });
    return { vertCount: m.geometry.attributes.position.count };
  }, { u: uuid });

  // Insert on edge 0.
  const r = await win.evaluate(({ u }) => window.__studioInsertVertexOnEdge(u, 0), { u: uuid });
  expect(r.ok).toBe(true);
  expect(r.splits).toBeGreaterThan(0);

  const after = await win.evaluate(({ u }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) m = o; });
    return {
      vertCount: m.geometry.attributes.position.count,
      counter: m.userData.archdiscStudioEdgeSplit,
    };
  }, { u: uuid });
  // Each split appends 3 new verts on top of any toNonIndexed expansion.
  expect(after.vertCount).toBeGreaterThanOrEqual(before.vertCount + 3 * r.splits);
  expect(after.counter).toBe(r.splits);

  // Bad index returns ok:false.
  const bad = await win.evaluate(({ u }) => window.__studioInsertVertexOnEdge(u, 99999), { u: uuid });
  expect(bad.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 362: split', r.splits, 'tri(s) on edge 0; vert count', before.vertCount, '→', after.vertCount);

  await app.close();
});
