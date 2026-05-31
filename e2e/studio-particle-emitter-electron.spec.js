import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-particle-emitter');

test('Studio — Niagara continuous particle emitter (slice 292)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioParticleEmitter === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Spawn the emitter and stash the handle.
  await win.evaluate(() => {
    window.__testEmitter = window.__studioParticleEmitter({
      position: [0, 0.2, 0],
      rate: 400,
      lifetime: 0.7,
      gravity: [0, -1.2, 0],
      initialVelocity: [0, 1.2, 0],
    });
  });
  // Let it tick for ~250ms — should accumulate ~100 particles.
  await win.waitForTimeout(300);
  const state1 = await win.evaluate(() => window.__testEmitter.state());
  expect(state1.alive).toBeGreaterThan(10);

  // Take a screenshot while it's emitting.
  await win.screenshot({ path: path.join(OUT, '00-emitting.png') });

  // Stop and assert no further tick.
  await win.evaluate(() => window.__testEmitter.stop());
  await win.waitForTimeout(200);
  const probe = await win.evaluate(() => {
    let foundEmitter = false;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioParticleEmitter) foundEmitter = true; });
    return { foundEmitter, stopped: window.__testEmitter.state().stopped };
  });
  expect(probe.foundEmitter).toBe(false);
  expect(probe.stopped).toBe(true);

  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 292: particle emitter spawned', state1.alive, 'live particles, then cleanly stopped');

  await app.close();
});
