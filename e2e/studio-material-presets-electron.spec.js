import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 38 — Material Presets.
 *
 * One-click Substance-Painter / KeyShot-style PBR material library.
 * Nine named presets — Gold, Silver, Chrome, Copper, Glass, Plastic,
 * Rubber, Concrete, Wood — drop color + metalness + roughness +
 * opacity into the selected mesh's MeshStandardMaterial together,
 * and mirror their values into the slider controls.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-material-presets');

async function selectedMaterial(win) {
  return await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let mesh = null;
    vp.scene.traverse(o => {
      if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) mesh = o;
    });
    if (!mesh || !mesh.material) return null;
    return {
      hex: '#' + mesh.material.color.getHexString(),
      metalness: mesh.material.metalness,
      roughness: mesh.material.roughness,
      transparent: !!mesh.material.transparent,
      opacity: mesh.material.opacity,
    };
  });
}

test('Studio material presets — Gold / Silver / Chrome / Glass / Plastic etc.', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 2200,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- Add a sphere + select via the exposed API ----
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-selection="kind"]')).toHaveText('sphere');

  // Material panel shows the 9 preset buttons.
  await expect(win.locator('[data-studio-material-preset]')).toHaveCount(9);

  // ---- Walk each preset, verify material attributes match ----
  const presets = [
    { id: 'gold',     metal: 0.90, rough: 0.18, opaque: true  },
    { id: 'silver',   metal: 0.95, rough: 0.15, opaque: true  },
    { id: 'chrome',   metal: 0.98, rough: 0.05, opaque: true  },
    { id: 'copper',   metal: 0.85, rough: 0.28, opaque: true  },
    { id: 'glass',    metal: 0.00, rough: 0.05, opaque: false },
    { id: 'plastic',  metal: 0.00, rough: 0.40, opaque: true  },
    { id: 'rubber',   metal: 0.00, rough: 0.95, opaque: true  },
    { id: 'concrete', metal: 0.00, rough: 0.90, opaque: true  },
    { id: 'wood',     metal: 0.00, rough: 0.75, opaque: true  },
  ];

  for (const p of presets) {
    await win.locator(`[data-studio-material-preset="${p.id}"]`).click();
    await win.waitForTimeout(200);
    const m = await selectedMaterial(win);
    expect(m).not.toBeNull();
    expect(m.metalness).toBeCloseTo(p.metal, 2);
    expect(m.roughness).toBeCloseTo(p.rough, 2);
    if (p.opaque) {
      expect(m.opacity).toBe(1);
      expect(m.transparent).toBe(false);
    } else {
      expect(m.transparent).toBe(true);
      expect(m.opacity).toBeLessThan(1);
    }
    await win.screenshot({ path: path.join(OUT, `0-${p.id}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  material presets: ${presets.length} PBR presets applied + verified`);

  await app.close();
});
