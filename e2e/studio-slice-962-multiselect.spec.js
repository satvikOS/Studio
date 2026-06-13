import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

// Slice 962 — parity ledger #17 (Studio half): modifier-key multi-select.
// Shift extends the set, Ctrl/Cmd toggles, plain click replaces, empty
// click clears. Set ops live in selectionops.js (window layer, no
// setState); the viewport routes pointer modifiers into them; the gizmo
// follows the ACTIVE mesh (Blender semantics).

test('Studio slice 962 — modifier-key multi-select', async () => {
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
  await win.waitForFunction(() => typeof window.__studioMultiSelectAdd === 'function',
    null, { timeout: 10000 });

  const result = await win.evaluate(() => {
    const events = [];
    window.addEventListener('studio-selection-changed', (e) => {
      if (e.detail && Array.isArray(e.detail.set)) events.push(e.detail.set.length);
    });

    // Three primitives to play with.
    for (const k of ['cube', 'sphere', 'cylinder']) {
      window.__spawnPrimitive(k, window.__archdiscScene);
      window.__studioSelectNewest();
    }
    const scene = window.__archdiscScene;
    const prims = [];
    scene.traverse((o) => { if (o?.userData?.archdiscStudioPrimitive) prims.push(o); });
    const [a, b, c] = prims.slice(-3);

    // Shift-extend twice.
    window.__studioSelectedMeshesSet = [];
    window.__studioMultiSelectAdd(a);
    window.__studioMultiSelectAdd(b);
    const afterAdd = {
      count: window.__studioSelectedMeshesSet.length,
      active: window.__studioSelectedMesh()?.uuid,
      expectActive: b.uuid,
    };

    // Ctrl-toggle: off then on.
    window.__studioMultiSelectToggle(a);
    const afterToggleOff = window.__studioSelectedMeshesSet.length;
    window.__studioMultiSelectToggle(c);
    const afterToggleOn = {
      count: window.__studioSelectedMeshesSet.length,
      active: window.__studioSelectedMesh()?.uuid,
      expectActive: c.uuid,
    };

    // Toggle everything off → selection nulls.
    window.__studioMultiSelectToggle(c);
    window.__studioMultiSelectToggle(b);
    const afterEmpty = {
      count: window.__studioSelectedMeshesSet.length,
      active: window.__studioSelectedMesh(),
    };

    return { afterAdd, afterToggleOff, afterToggleOn, afterEmpty, events };
  });

  expect(result.afterAdd.count).toBe(2);
  expect(result.afterAdd.active).toBe(result.afterAdd.expectActive);
  expect(result.afterToggleOff).toBe(1);
  expect(result.afterToggleOn.count).toBe(2);
  expect(result.afterToggleOn.active).toBe(result.afterToggleOn.expectActive);
  expect(result.afterEmpty.count).toBe(0);
  expect(result.afterEmpty.active).toBeFalsy();
  expect(result.events.length).toBeGreaterThanOrEqual(6);

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
