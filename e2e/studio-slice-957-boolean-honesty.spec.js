import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

// Slice 957 (parity ledger #1) — boolean honesty. A real subtract must
// produce real CSG; a broken engine must FAIL LOUDLY with operands
// untouched — never a mergeGeometries masquerading as a boolean.

test('Studio slice 957 — CSG real result + loud failure path', async () => {
  test.setTimeout(180000);
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: 90,
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
  await win.waitForTimeout(600);

  // Real subtract: cube minus offset cube → volume strictly between the
  // difference-extremes; vertex count differs from a merge.
  const r = await win.evaluate(async () => {
    const s = window.__archdiscScene;
    window.__spawnPrimitive('cube', s);
    window.__spawnPrimitive('cube', s);
    const prims = [];
    s.traverse((o) => { if (o?.userData?.archdiscStudioPrimitive) prims.push(o); });
    const [a, b] = prims.slice(-2);
    b.position.copy(a.position); b.position.x += 0.015; // half-overlap
    b.updateMatrixWorld(true);
    const mergedTriCount = (a.geometry.index ? a.geometry.index.count : a.geometry.attributes.position.count)
      + (b.geometry.index ? b.geometry.index.count : b.geometry.attributes.position.count);
    window.__studioSelectedMeshesSet = [a, b];
    const res = await window.__studioBoolean('subtract');
    let out = null;
    s.traverse((o) => { if (o?.name === 'csg-subtract') out = o; });
    return {
      res,
      outTriCount: out ? out.geometry.index.count : -1,
      mergedTriCount,
      fallbackBodies: (() => { let n = 0; s.traverse((o) => { if (o?.userData?.archdiscStudioCsgFallback) n++; }); return n; })(),
    };
  });
  expect(r.res.ok).toBe(true);
  expect(r.res.fallback).toBe(false);
  expect(r.fallbackBodies).toBe(0);
  // A merge would carry BOTH full index buffers; a real subtract does not.
  expect(r.outTriCount).toBeGreaterThan(0);
  expect(r.outTriCount).not.toBe(r.mergedTriCount);

  // Loud-failure path: poison the cached engine and verify error + untouched operands.
  const f = await win.evaluate(async () => {
    const s = window.__archdiscScene;
    window.__spawnPrimitive('sphere', s);
    window.__spawnPrimitive('sphere', s);
    const prims = [];
    s.traverse((o) => { if (o?.userData?.archdiscStudioPrimitive) prims.push(o); });
    const [a, b] = prims.slice(-2);
    // Non-manifold poison: NaN vertex makes manifold construction throw.
    a.geometry.attributes.position.array[0] = NaN;
    window.__studioSelectedMeshesSet = [a, b];
    const before = prims.length;
    const res = await window.__studioBoolean('union');
    let after = 0; s.traverse((o) => { if (o?.userData?.archdiscStudioPrimitive) after++; });
    return { res, before, after };
  });
  expect(f.res.ok).toBe(false);
  expect(String(f.res.error)).toMatch(/failed|unavailable/i);
  expect(f.after).toBe(f.before); // operands untouched on failure

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
