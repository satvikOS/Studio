import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-add-volume');

test('Studio — Houdini OpenVDB / C4D volume fog cube (slice 323)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioAddVolume === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  const res = await win.evaluate(() => window.__studioAddVolume({ size: 0.4, density: 0.7, color: 0xb0c4d8, steps: 48 }));
  expect(res.ok).toBe(true);
  expect(res.uuid).toBeTruthy();
  expect(res.steps).toBe(48);

  const probe = await win.evaluate(({ u }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) m = o; });
    return m ? {
      isMesh: m.isMesh,
      kind: m.userData.archdiscStudioPrimitiveKind,
      shader: m.material.isShaderMaterial === true,
      transparent: m.material.transparent,
      depthWrite: m.material.depthWrite,
      hasUniforms: !!m.material.uniforms && !!m.material.uniforms.uDensity,
      density: m.material.uniforms && m.material.uniforms.uDensity.value,
      steps: m.material.uniforms && m.material.uniforms.uSteps.value,
      box: m.geometry.type,
    } : null;
  }, { u: res.uuid });

  expect(probe).toBeTruthy();
  expect(probe.isMesh).toBe(true);
  expect(probe.kind).toBe('volume');
  expect(probe.shader).toBe(true);
  expect(probe.transparent).toBe(true);
  expect(probe.depthWrite).toBe(false);
  expect(probe.hasUniforms).toBe(true);
  expect(probe.density).toBeCloseTo(0.7, 5);
  expect(probe.steps).toBe(48);
  expect(probe.box).toBe('BoxGeometry');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 323: volume fog cube uuid=', res.uuid.slice(0, 8), 'steps=', res.steps);

  await app.close();
});
