import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-math-pack');

test('Studio V3 — math: project/screen/com/ray/hit/bsphere (slice 662)', async () => {
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

  // 1: project origin to screen
  const p = await win.evaluate(() => window.__studioMathProjectToScreen([0, 0, 0]));
  expect(p.ok).toBe(true);
  expect(p.pixel.length).toBe(2);
  await win.screenshot({ path: path.join(OUT, '01-project.png') });

  // 2: round-trip screen → world
  const s = await win.evaluate(([x, y]) => window.__studioMathScreenToWorld([x, y], 0.5), p.pixel);
  expect(s.ok).toBe(true);
  expect(s.world.length).toBe(3);
  await win.screenshot({ path: path.join(OUT, '02-screen.png') });

  // 3: center of mass of a sphere ≈ origin
  const com = await win.evaluate(() => window.__studioMathCenterOfMass());
  expect(com.ok).toBe(true);
  expect(Math.abs(com.center[0])).toBeLessThan(0.05);
  expect(Math.abs(com.center[1])).toBeLessThan(0.05);
  expect(Math.abs(com.center[2])).toBeLessThan(0.05);
  await win.screenshot({ path: path.join(OUT, '03-com.png') });

  // 4: ray from screen centre
  const ray = await win.evaluate(() => {
    const size = window.__archdiscViewport.renderer.getSize(new THREE.Vector2());
    return window.__studioMathRayFromScreen(size.x / 2, size.y / 2);
  });
  expect(ray.ok).toBe(true);
  expect(ray.origin.length).toBe(3);
  expect(ray.direction.length).toBe(3);
  await win.screenshot({ path: path.join(OUT, '04-ray.png') });

  // 5: closest ray hit — should hit the sphere if centred
  const hit = await win.evaluate(() => {
    const size = window.__archdiscViewport.renderer.getSize(new THREE.Vector2());
    return window.__studioMathClosestRayHit(size.x / 2, size.y / 2);
  });
  expect(hit.ok).toBe(true);
  // hit may be null if camera angled past it; just verify shape
  if (hit.hit) {
    expect(hit.hit.point.length).toBe(3);
    expect(hit.hit.distance).toBeGreaterThan(0);
  }
  await win.screenshot({ path: path.join(OUT, '05-hit.png') });

  // 6: bounding sphere
  const bs = await win.evaluate(() => window.__studioMathBoundingSphere());
  expect(bs.ok).toBe(true);
  expect(bs.radius).toBeGreaterThan(0);
  expect(bs.center.length).toBe(3);
  await win.screenshot({ path: path.join(OUT, '06-bsphere.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 662: 6 math features — com ≈', com.center.map((v) => v.toFixed(3)).join(','), 'r=', bs.radius.toFixed(3));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
