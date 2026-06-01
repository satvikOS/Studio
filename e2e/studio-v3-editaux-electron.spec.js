import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-editaux');

test('Studio V3 — edit-mode auxiliary family (slice 418)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioPickVertexAt === 'function', null, { timeout: 15000 });

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // Select cube programmatically.
  await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });

  // ─── listEdges ─ cube has 30 unique edges. ────────────────────────────
  const edgeCount = await win.evaluate(() => window.__studioListEdges().length);
  expect(edgeCount).toBe(30);

  // ─── pickVertexAt — query origin, expect a vertex with nonzero distance. ──
  let r = await win.evaluate(() => window.__studioPickVertexAt([0, 0, 0]));
  expect(r.ok).toBe(true);
  expect(r.vertIdx).toBeGreaterThanOrEqual(0);

  // ─── pickEdge + clearEdgeSelection. ───────────────────────────────────
  r = await win.evaluate(() => window.__studioPickEdge(null, 0));
  expect(r.ok).toBe(true);
  expect(r.length).toBeGreaterThan(0);
  r = await win.evaluate(() => window.__studioClearEdgeSelection());
  expect(r.cleared).toBe(true);

  // ─── markEdgeSeam + listSeams + clearSeams cycle. ─────────────────────
  r = await win.evaluate(() => window.__studioMarkEdgeSeam(null, 0, true));
  expect(r.ok).toBe(true);
  let seams = await win.evaluate(() => window.__studioListSeams());
  expect(seams.length).toBe(1);
  r = await win.evaluate(() => window.__studioMarkEdgeSeam(null, 0, false));
  expect(r.marked).toBe(false);
  seams = await win.evaluate(() => window.__studioListSeams());
  expect(seams.length).toBe(0);
  r = await win.evaluate(() => window.__studioMarkEdgeSeam(null, 5));
  expect(r.ok).toBe(true);
  r = await win.evaluate(() => window.__studioClearSeams());
  expect(r.cleared).toBe(1);

  // ─── moveVertex — translate vert 0 by world +X = 0.01. ───────────────
  const before = await win.evaluate(() => {
    const m = window.__archdiscViewport.getSelected();
    const p = m.geometry.attributes.position;
    return [p.getX(0), p.getY(0), p.getZ(0)];
  });
  r = await win.evaluate(() => window.__studioMoveVertex(null, 0, [0.01, 0, 0]));
  expect(r.ok).toBe(true);
  const after = await win.evaluate(() => {
    const m = window.__archdiscViewport.getSelected();
    const p = m.geometry.attributes.position;
    return [p.getX(0), p.getY(0), p.getZ(0)];
  });
  expect(Math.abs(after[0] - before[0] - 0.01)).toBeLessThan(1e-5);

  // ─── pushFace — translate face 0 along its normal. ───────────────────
  r = await win.evaluate(() => window.__studioPushFace(window.__archdiscViewport.getSelected().uuid, 0, 0.005));
  expect(r.ok).toBe(true);
  expect(r.normal.length).toBe(3);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 418: 10 edit-mode aux ops cycle ok (edges=30)');

  await app.close();
});
