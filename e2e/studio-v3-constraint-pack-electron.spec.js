import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-constraint-pack');

test('Studio V3 — constraints: follow/lookAt/track/copyRot/copyScale/clear (slice 634)', async () => {
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

  // Two cubes — A will be constrained to B.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const aUuid = await win.evaluate(() => { const m = window.__studioSelectedMesh(); m.name = 'A'; m.position.set(0, 0, 0); return m.uuid; });
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const bUuid = await win.evaluate(() => { const m = window.__studioSelectedMesh(); m.name = 'B'; m.position.set(3, 1, -2); m.scale.set(2, 2, 2); return m.uuid; });

  // 1: follow
  const f = await win.evaluate(([a, b]) => window.__studioConstraintFollow(a, b, [0, 0.5, 0]), [aUuid, bUuid]);
  expect(f.ok).toBe(true);
  await win.waitForTimeout(150);
  const aPos = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    return [m.position.x, m.position.y, m.position.z];
  }, aUuid);
  expect(aPos[0]).toBeCloseTo(3, 1);
  expect(aPos[1]).toBeCloseTo(1.5, 1);
  await win.screenshot({ path: path.join(OUT, '01-follow.png') });

  // 2: lookAt — clear first, add a new lookAt
  await win.evaluate(() => window.__studioConstraintClear());
  await win.evaluate(([a, b]) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', a);
    m.position.set(0, 0, 0); m.quaternion.identity();
  }, [aUuid, bUuid]);
  const la = await win.evaluate(([a, b]) => window.__studioConstraintLookAt(a, b), [aUuid, bUuid]);
  expect(la.ok).toBe(true);
  await win.waitForTimeout(150);
  const aQuat = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    return [m.quaternion.x, m.quaternion.y, m.quaternion.z, m.quaternion.w];
  }, aUuid);
  expect(aQuat[3]).not.toBe(1);
  await win.screenshot({ path: path.join(OUT, '02-lookat.png') });

  // 3: track (Y axis of A points at B)
  await win.evaluate(() => window.__studioConstraintClear());
  const tr = await win.evaluate(([a, b]) => window.__studioConstraintTrack(a, [0, 1, 0], b), [aUuid, bUuid]);
  expect(tr.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '03-track.png') });

  // 4: copyRot
  await win.evaluate(() => window.__studioConstraintClear());
  await win.evaluate((b) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', b);
    m.quaternion.setFromEuler(new (window.THREE || window.__archdiscViewport.THREE || Object).Euler ? new (window.THREE || window.__archdiscViewport.THREE).Euler(0.5, 0.7, 0) : null);
  }, bUuid).catch(() => {});
  // ensure via THREE on viewport
  await win.evaluate((b) => {
    const T = window.__archdiscViewport && window.__archdiscViewport.THREE ? window.__archdiscViewport.THREE : null;
    const m = window.__archdiscScene.getObjectByProperty('uuid', b);
    m.rotation.set(0.5, 0.7, 0);
    m.updateMatrixWorld(true);
  }, bUuid);
  const cr = await win.evaluate(([a, b]) => window.__studioConstraintCopyRotation(a, b), [aUuid, bUuid]);
  expect(cr.ok).toBe(true);
  await win.waitForTimeout(150);
  const eq = await win.evaluate(([a, b]) => {
    const A = window.__archdiscScene.getObjectByProperty('uuid', a);
    const B = window.__archdiscScene.getObjectByProperty('uuid', b);
    return Math.abs(A.quaternion.x - B.quaternion.x) < 1e-3 && Math.abs(A.quaternion.w - B.quaternion.w) < 1e-3;
  }, [aUuid, bUuid]);
  expect(eq).toBe(true);
  await win.screenshot({ path: path.join(OUT, '04-copyRot.png') });

  // 5: copyScale
  await win.evaluate(() => window.__studioConstraintClear());
  const cs = await win.evaluate(([a, b]) => window.__studioConstraintCopyScale(a, b), [aUuid, bUuid]);
  expect(cs.ok).toBe(true);
  await win.waitForTimeout(150);
  const sx = await win.evaluate((a) => window.__archdiscScene.getObjectByProperty('uuid', a).scale.x, aUuid);
  expect(sx).toBeCloseTo(2, 2);
  await win.screenshot({ path: path.join(OUT, '05-copyScale.png') });

  // 6: clear
  const cl = await win.evaluate(() => window.__studioConstraintClear());
  expect(cl.ok).toBe(true);
  const remain = await win.evaluate(() => window.__studioConstraints.length);
  expect(remain).toBe(0);
  await win.screenshot({ path: path.join(OUT, '06-clear.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 634: 6 constraint features verified');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
