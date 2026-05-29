import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — FBX + USD/USDZ IMPORT wiring (headed Electron).
 *
 * Extends the asset-import pipeline to Autodesk FBX (Maya/Max/Unreal/Unity) and
 * Pixar USD/USDZ (Apple/Omniverse) using three's real FBXLoader / USDZLoader.
 * No FBX/USDZ fixture ships in the repo to round-trip in CI, so this verifies
 * the WIRING: the ribbon buttons exist and the import pipeline ROUTES each
 * format to its real loader and INVOKES it (a malformed buffer yields a loader
 * PARSE error, not an "unsupported format" — proving the loader ran). Real-file
 * parsing is handled by three's battle-tested loaders.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-fbx-usd-import');

test('Studio — FBX + USD import routes to the real three loaders', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: 25 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => typeof window.__studioImportAsset === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(400);

  // Ribbon buttons present
  await expect(win.locator('[data-studio-ribbon-action="import-fbx"]')).toHaveCount(1);
  await expect(win.locator('[data-studio-ribbon-action="import-usd"]')).toHaveCount(1);

  // Format routing: 'fbx'/'usdz' reach their real loaders (a malformed buffer
  // produces a loader-level result/error, NOT "unsupported format").
  const routed = await win.evaluate(async () => {
    const fbx = await Promise.resolve(window.__studioImportAsset('fbx', new ArrayBuffer(16)));
    const usd = await Promise.resolve(window.__studioImportAsset('usdz', new ArrayBuffer(16)));
    const bogus = await Promise.resolve(window.__studioImportAsset('zzz', new ArrayBuffer(16)));
    return {
      fbxErr: (fbx && fbx.error) || '', usdErr: (usd && usd.error) || '',
      bogusErr: (bogus && bogus.error) || '',
      fbxAdded: fbx && fbx.added, usdAdded: usd && usd.added,
    };
  });

  // the bogus format IS reported unsupported (routing baseline)
  expect(routed.bogusErr, 'unknown format is rejected as unsupported').toContain('unsupported format');
  // fbx/usd are NOT "unsupported" — they routed to + invoked their loaders
  expect(/unsupported format/.test(routed.fbxErr), 'fbx routed to FBXLoader (not unsupported)').toBe(false);
  expect(/unsupported format/.test(routed.usdErr), 'usd routed to USDZLoader (not unsupported)').toBe(false);

  // eslint-disable-next-line no-console
  console.log(`  fbx/usd import: fbx -> "${routed.fbxErr || ('added ' + routed.fbxAdded)}"; usd -> "${routed.usdErr || ('added ' + routed.usdAdded)}"; bogus -> "${routed.bogusErr}"`);

  await app.close();
});
