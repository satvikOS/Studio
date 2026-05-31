import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-hdri-environment');

test('Studio — PMREM HDRI environment lighting (slice 288)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSetHDRIEnvironment === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'hdri demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'sphere', pos: [0, 0, 0], scale: [4, 4, 4], color: '#fff' }],
      expect: { bodies: 1, kinds: ['sphere'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    if (m) { m.material.metalness = 1; m.material.roughness = 0.1; m.material.needsUpdate = true; }
  });
  await win.waitForTimeout(300);

  // Initially scene.environment may be null.
  // Apply 'studio' preset.
  const r1 = await win.evaluate(() => window.__studioSetHDRIEnvironment('studio'));
  expect(r1.preset).toBe('studio');
  expect(r1.uuid).toBeTruthy();
  const envOn = await win.evaluate(() => !!window.__archdiscViewport.scene.environment && window.__archdiscViewport.scene.environment.isTexture === true);
  expect(envOn).toBe(true);
  await win.screenshot({ path: path.join(OUT, '01-studio.png') });
  await win.waitForTimeout(400);

  // Switch to 'sunset'.
  const r2 = await win.evaluate(() => window.__studioSetHDRIEnvironment('sunset'));
  expect(r2.preset).toBe('sunset');
  await win.screenshot({ path: path.join(OUT, '02-sunset.png') });
  await win.waitForTimeout(400);

  // Re-apply 'studio' — cached uuid must equal r1.uuid.
  const r1b = await win.evaluate(() => window.__studioSetHDRIEnvironment('studio'));
  expect(r1b.uuid).toBe(r1.uuid);
  expect(await win.evaluate(() => window.__studioHDRIPreset)).toBe('studio');

  // Switch off.
  const r3 = await win.evaluate(() => window.__studioSetHDRIEnvironment('off'));
  expect(r3.preset).toBe('off');
  const envNull = await win.evaluate(() => window.__archdiscViewport.scene.environment);
  expect(envNull).toBeNull();
  await win.screenshot({ path: path.join(OUT, '03-off.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 288: PMREM HDRI environment toggled studio/sunset/off');

  await app.close();
});
