import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

// Slice 958 — parity ledger #8 (shortcut discoverability) + the two new
// material presets (foliage, brass) that back the staged15 corpus round.
// Hovering a transform tool shows a Blender-style tooltip with the LIVE
// key hint; tools without a real binding show the name alone (no
// fabricated shortcuts). Presets must produce physical materials.

test('Studio slice 958 — toolbar key-hint tooltips + foliage/brass presets', async () => {
  test.setTimeout(120000);
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: 100,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => {
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });

  // 1. Hover "move" → tooltip with the G key chip.
  await win.locator('[data-studio-v3-tool="move"]').hover();
  const tip = win.locator('[data-studio-v3-tooltip]');
  await expect(tip).toBeVisible({ timeout: 3000 });
  await expect(tip).toContainText('move');
  await expect(tip.locator('.studio-tool-tip-key')).toHaveText('G');

  // 2. Hover an unhinted tool → name only, no key chip (honest hints).
  await win.locator('[data-studio-v3-tool="select"]').hover();
  await expect(tip).toBeVisible();
  await expect(tip.locator('.studio-tool-tip-key')).toHaveCount(0);

  // 3. Tooltip disappears on mouse-out.
  await win.locator('[data-studio-v3-shell]').hover({ position: { x: 400, y: 400 } });
  await expect(tip).toHaveCount(0);

  // 4. New presets are real physical materials with the spec'd hues.
  const mats = await win.evaluate(async () => {
    const out = {};
    for (const preset of ['foliage', 'brass']) {
      window.__spawnPrimitive('cube', window.__archdiscScene);
      window.__studioSelectNewest();
      window.__studioMaterialPresetApply(preset);
      const sel = window.__studioSelectedMesh();
      const m = Array.isArray(sel.material) ? sel.material[0] : sel.material;
      out[preset] = {
        phys: !!m.isMeshPhysicalMaterial,
        color: m.color.getHexString(),
        metalness: m.metalness,
      };
    }
    return out;
  });
  expect(mats.foliage.phys).toBe(true);
  expect(mats.foliage.color).toBe('2d5a27');
  expect(mats.foliage.metalness).toBe(0);
  expect(mats.brass.phys).toBe(true);
  expect(mats.brass.color).toBe('c9a227');
  expect(mats.brass.metalness).toBe(1);

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
