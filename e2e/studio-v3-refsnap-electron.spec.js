import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-refsnap');

test('Studio V3 — refplane + reference + snap + BVH raycast (slice 417)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioAddRefPlane === 'function', null, { timeout: 15000 });

  // AddRefPlane — front, no image. Should land a refplane mesh.
  let r = await win.evaluate(() => window.__studioAddRefPlane('front', null, { size: 0.2 }));
  expect(r.ok).toBe(true);
  expect(r.axis).toBe('front');

  const refCount = await win.evaluate(() => {
    let n = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioRefPlane) n++; });
    return n;
  });
  expect(refCount).toBe(1);

  // Reference URL pin / clear cycle.
  r = await win.evaluate(() => window.__studioSetReference('http://example.com/blueprint.png', { visible: true }));
  expect(r.ok).toBe(true);
  expect(r.visible).toBe(true);
  r = await win.evaluate(() => window.__studioReferenceState());
  expect(r.url).toBe('http://example.com/blueprint.png');
  r = await win.evaluate(() => window.__studioClearReference());
  expect(r.ok).toBe(true);
  r = await win.evaluate(() => window.__studioReferenceState());
  expect(r.url).toBe(null);

  // FindSnapTarget — spawn a cube; ask for the nearest vert from a known pt.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    // De-select so the cube becomes a valid snap target.
    const vp = window.__archdiscViewport;
    if (vp && vp.transformControls && vp.transformControls.object) vp.transformControls.detach();
    if (window.__studioSelectMesh) window.__studioSelectMesh(null);
  });
  r = await win.evaluate(() => window.__studioFindSnapTarget({ fromPos: [0, 0, 0], kinds: ['vertex'], radius: 5 }));
  expect(r.ok).toBe(true);
  expect(r.distance).toBeGreaterThanOrEqual(0);
  expect(r.kind).toBe('vertex');

  // BVH raycast — aim from outside toward cube's actual position.
  const cubePos = await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    return m ? [m.position.x, m.position.y, m.position.z] : null;
  });
  expect(cubePos).toBeTruthy();
  r = await win.evaluate((p) => window.__studioRaycastBVH({
    origin: [p[0], p[1], p[2] + 0.2],
    direction: [0, 0, -1],
    far: 5,
  }), cubePos);
  expect(r.ok).toBe(true);
  expect(r.hit).toBe(true);
  expect(r.meshUuid).toBeTruthy();

  // Out-of-range hit returns hit: false.
  r = await win.evaluate(() => window.__studioRaycastBVH({ origin: [10, 10, 10], direction: [0, 0, 1], far: 0.001 }));
  expect(r.hit).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 417: refplane + ref pin + snap + BVH raycast all ok');

  await app.close();
});
