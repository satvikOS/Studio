import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-weather');

test('Studio V3 — weather/time: time/fog/wind/clouds/dayCycle/stop (slice 679)', async () => {
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

  // 1: time of day = 14:30 (afternoon)
  const t = await win.evaluate(() => window.__studioSetTimeOfDay(14.5));
  expect(t.ok).toBe(true);
  expect(t.hour).toBe(14.5);
  expect(t.elevation).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '01-time.png') });

  // 2: fog
  const f = await win.evaluate(() => window.__studioSetWeatherFog(0.03, 0xc4d0e6));
  expect(f.ok).toBe(true);
  expect(f.density).toBe(0.03);
  const sceneFog = await win.evaluate(() => !!window.__archdiscScene.fog);
  expect(sceneFog).toBe(true);
  await win.screenshot({ path: path.join(OUT, '02-fog.png') });

  // 3: wind affects flagged meshes
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(150);
  await win.evaluate(() => { window.__studioSelectedMesh().userData.archdiscStudioWindAffected = true; });
  const w = await win.evaluate(() => window.__studioSetWindStrength(0.8));
  expect(w.strength).toBe(0.8);
  await win.waitForTimeout(400);
  const rz = await win.evaluate(() => window.__studioSelectedMesh().rotation.z);
  expect(Math.abs(rz)).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '03-wind.png') });

  // 4: clouds increase fog density
  const c = await win.evaluate(() => window.__studioCloudOverlay(0.7));
  expect(c.coverage).toBe(0.7);
  await win.screenshot({ path: path.join(OUT, '04-clouds.png') });

  // 5: day cycle starts an interval
  const dc = await win.evaluate(() => window.__studioSetDayCycle(2));
  expect(dc.speed).toBe(2);
  const idActive = await win.evaluate(() => window.__studioDayCycle.id);
  expect(idActive).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '05-dayCycle.png') });

  // 6: stop
  const s = await win.evaluate(() => window.__studioStopDayCycle());
  expect(s.ok).toBe(true);
  const idStopped = await win.evaluate(() => window.__studioDayCycle.id);
  expect(idStopped).toBe(0);
  // cleanup wind so subsequent specs aren't disturbed
  await win.evaluate(() => window.__studioSetWindStrength(0));
  await win.evaluate(() => window.__studioSetWeatherFog(0));
  await win.screenshot({ path: path.join(OUT, '06-stop.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 679: 6 weather features verified — elev', t.elevation.toFixed(2), 'fog', f.density);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
