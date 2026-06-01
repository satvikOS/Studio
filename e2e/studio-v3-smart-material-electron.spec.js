import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-smart-material');

test('Studio V3 — Smart Material preset buttons (slice 467)', async () => {
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
  await win.waitForTimeout(400);

  // Spawn + select cube.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(700);

  // At least one smart material button is visible.
  const presets = await win.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-studio-v3-smart-material]'))
      .map((el) => el.getAttribute('data-studio-v3-smart-material'));
  });
  expect(presets.length).toBeGreaterThan(0);

  // Record the material type before clicking a preset.
  const before = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return m && m.material && m.material.type;
  });

  // Click 'glass' (or first non-basic) — should switch to MeshPhysicalMaterial.
  const glass = presets.includes('glass') ? 'glass' : presets[0];
  await win.locator(`[data-studio-v3-smart-material="${glass}"]`).click();
  await win.waitForTimeout(400);

  const after = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return m && m.material && m.material.type;
  });
  // Material type changed (glass = MeshPhysicalMaterial, others =
  // MeshStandardMaterial unless cube already was).
  if (glass === 'glass') {
    expect(after).toBe('MeshPhysicalMaterial');
  } else {
    expect(after).toBeTruthy();
  }

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 467: presets =', presets, before, '→', after);

  await app.close();
});
