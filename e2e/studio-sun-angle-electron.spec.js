import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-sun-angle');

test('Studio — sun-angle azimuth/elevation control (slice 307)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSetSunAngle === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Noon (elevation π/2 = straight up).
  const noon = await win.evaluate(() => window.__studioSetSunAngle({ azimuth: 0, elevation: Math.PI / 2 }));
  expect(noon.ok).toBe(true);
  expect(noon.position[1]).toBeCloseTo(24, 1);
  // Sun position should match the key light's actual position.
  const lightPos = await win.evaluate(() => {
    const k = window.__archdiscViewport.keyLight;
    return [k.position.x, k.position.y, k.position.z];
  });
  expect(lightPos[1]).toBeCloseTo(24, 1);
  await win.screenshot({ path: path.join(OUT, '00-noon.png') });
  await win.waitForTimeout(400);

  // Sunset (low elevation, eastern azimuth).
  const sunset = await win.evaluate(() => window.__studioSetSunAngle({ azimuth: 0, elevation: 0.15 }));
  expect(sunset.ok).toBe(true);
  expect(sunset.position[1]).toBeLessThan(5);
  expect(sunset.position[0]).toBeGreaterThan(20); // east
  await win.screenshot({ path: path.join(OUT, '01-sunset.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 307: sun moved noon→sunset, light y=', sunset.position[1].toFixed(2));

  await app.close();
});
