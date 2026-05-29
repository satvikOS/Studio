import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — WebXR AR/VR (headed Electron).
 *
 * The web/Electron-native path for Unity AR Foundation / Unreal XR: a real
 * WebXR immersive session via three.js renderer.xr + the WebXR Device API.
 * On an XR-capable device it enters AR/VR; on a non-XR desktop it must DETECT
 * support and report unsupported GRACEFULLY (no crash). Verifies: the support
 * probe returns a structured boolean result, three's renderer.xr layer is
 * wired, the ribbon button reports a status, and entering returns a structured
 * (gracefully not-entered) result on desktop. Honest scope: session entry, not
 * full AR-Foundation plane-detection/anchors (need on-device AR APIs).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-webxr');

test('Studio — WebXR AR/VR detects support and degrades gracefully', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioEnterXR === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(400);

  // ── support probe returns a structured boolean result (real WebXR detection) ──
  const sup = await win.evaluate(() => window.__studioXRSupport('immersive-ar'));
  expect(typeof sup.hasXR, 'support probe returns hasXR boolean').toBe('boolean');
  expect(typeof sup.supported, 'support probe returns supported boolean').toBe('boolean');
  expect(sup.mode, 'probed the requested mode').toBe('immersive-ar');

  // ── three.js renderer.xr layer is actually wired ──
  const hasXrLayer = await win.evaluate(() => !!(window.__archdiscViewport && window.__archdiscViewport.renderer && window.__archdiscViewport.renderer.xr));
  expect(hasXrLayer, 'three renderer.xr layer present').toBe(true);

  // ── ribbon button runs the session entry and reports a status (graceful) ──
  await win.locator('[data-studio-ribbon-action="enter-xr"]').click();
  await win.waitForTimeout(400);
  const status = await win.locator('[data-studio-ribbon-action="enter-xr"]').getAttribute('data-studio-xr-status');
  expect(status && status.length > 0, 'AR/VR button reported a status (no silent failure)').toBe(true);

  // ── entering returns a structured result; on a non-XR desktop it does not crash ──
  const r = await win.evaluate(() => window.__studioEnterXR('immersive-vr'));
  expect(typeof r.entered, 'enterXR returns a structured result').toBe('boolean');

  await win.screenshot({ path: path.join(OUT, '01-webxr.png') });

  // eslint-disable-next-line no-console
  console.log(`  webxr: hasXR=${sup.hasXR} supported(ar)=${sup.supported}; rendererXr=${hasXrLayer}; status="${status}"; enterVR.entered=${r.entered}`);

  await app.close();
});
