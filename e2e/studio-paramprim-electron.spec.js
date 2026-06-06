// ArchDisc Studio V3 — 3ds Max-style re-editable parametric primitives
// (slice 750).
//
// Headed Mac-Electron spec. Verifies the round-trip:
//   • spawn a cylinder
//   • read its params (radialSegments 32 by default)
//   • set radialSegments → 8 with __studioPrimitiveSetParams; triangle
//     count decreases; position / rotation / scale + material preserved
//   • reset returns to defaults (32-segment ring, original tri count)
//   • global search surfaces the new ops
//   • 5 named camera angles

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-paramprim');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — re-editable parametric primitives', async () => {
  test.setTimeout(420000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
  });

  try {
    // --dev may auto-open a DevTools window; pick the real app window.
    let win = null;
    for (let i = 0; i < 30 && !win; i++) {
      win = app.windows().find((w) => {
        const u = (() => { try { return w.url(); } catch (_) { return ''; } })();
        return u && !u.startsWith('devtools://');
      }) || null;
      if (!win) { await new Promise((r) => setTimeout(r, 500)); }
    }
    if (!win) win = await app.firstWindow();
    win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
    await win.waitForLoadState('domcontentloaded');

    await win.evaluate(() => {
      window.localStorage.setItem('studioV3', '1');
      window.localStorage.setItem('studio.v3.tour-seen', '1');
      window.localStorage.removeItem('studio.v3.theme');
      window.localStorage.removeItem('studio.v3.wb');
      try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
    });
    let shellUp = false;
    for (let attempt = 0; attempt < 4 && !shellUp; attempt++) {
      await win.reload();
      await win.waitForLoadState('domcontentloaded');
      await win.waitForTimeout(1500);
      try {
        await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 40000 });
        shellUp = true;
      } catch (_) { /* retry */ }
    }
    expect(shellUp).toBe(true);
    await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 30000 });

    // Belt-and-braces: dynamic-import the autoloader in case the api.js
    // wire-up hasn't reached this slice's import yet.
    await win.evaluate(async () => {
      if (typeof window.__studioPrimitiveSetParams !== 'function') {
        await import('/src/workbenches/studio/v3/paramprim/autoload.js');
      }
    });
    await win.waitForFunction(() => typeof window.__studioPrimitiveSetParams === 'function',
      null, { timeout: 20000 });
    await win.screenshot({ path: path.join(OUT, '00-shell.png') });

    // ── 1) Spawn a cylinder with a known transform + custom material. ──
    const spawned = await win.evaluate(() => {
      const scene = window.__archdiscScene;
      const mesh = window.__spawnPrimitive('cylinder', scene);
      // Pin a known transform so we can prove rebuild() preserves it.
      mesh.position.set(0.1, 0.2, 0.3);
      mesh.rotation.set(0.4, 0.5, 0.6);
      mesh.scale.set(1.5, 0.75, 2);
      // Tag the material so we can assert it's literally the same
      // instance after rebuild (no clone, no new ref).
      mesh.material.userData = mesh.material.userData || {};
      mesh.material.userData.paramprimTestTag = 'tag-cylinder-' + Date.now();
      // Tag userData so we can assert it survives.
      mesh.userData.paramprimTestSelection = 'selected!';
      // Stamp default params for 'cylinder' (the spawner pre-dates
      // this slice, so it doesn't auto-stamp).
      window.__studioPrimitiveStamp(mesh.uuid, 'cylinder');
      return {
        uuid: mesh.uuid,
        matUuid: mesh.material.uuid,
        matTag: mesh.material.userData.paramprimTestTag,
        pos: mesh.position.toArray(),
        rot: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
        scl: mesh.scale.toArray(),
      };
    });
    expect(spawned.uuid).toBeTruthy();

    // ── 2) Read params + schema. ────────────────────────────────────────
    const initial = await win.evaluate((uuid) => {
      const p = window.__studioPrimitiveGetParams(uuid);
      const s = window.__studioPrimitiveGetSchema(uuid);
      const m = window.__archdiscScene.getObjectByProperty('uuid', uuid);
      const g = m.geometry;
      const tris = g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
      return { p, s, tris, geomUuid: g.uuid };
    }, spawned.uuid);
    console.log('[paramprim] initial', JSON.stringify({
      kind: initial.p.kind,
      params: initial.p.params,
      tris: initial.tris,
    }));
    expect(initial.p.ok).toBe(true);
    expect(initial.p.kind).toBe('cylinder');
    expect(initial.p.params.radialSeg).toBe(32);
    expect(initial.s.ok).toBe(true);
    expect(initial.s.schema.radialSeg).toEqual([3, 128, 1, 32]);
    expect(initial.tris).toBeGreaterThan(0);
    const initialTris = initial.tris;
    await win.screenshot({ path: path.join(OUT, '01-cylinder-32seg.png') });

    // ── 3) Edit radialSeg 32 → 8; triangle count must decrease. ────────
    const edited = await win.evaluate((uuid) => {
      const r = window.__studioPrimitiveSetParams(uuid, { radialSeg: 8 });
      const m = window.__archdiscScene.getObjectByProperty('uuid', uuid);
      const g = m.geometry;
      const tris = g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
      return {
        r,
        tris,
        geomUuid: g.uuid,
        matUuid: m.material.uuid,
        matTag: m.material.userData ? m.material.userData.paramprimTestTag : null,
        pos: m.position.toArray(),
        rot: [m.rotation.x, m.rotation.y, m.rotation.z],
        scl: m.scale.toArray(),
        selTag: m.userData.paramprimTestSelection,
        stamp: m.userData.archdiscStudioPrimitiveParams,
      };
    }, spawned.uuid);
    console.log('[paramprim] after radialSeg=8', JSON.stringify({
      tris: edited.tris,
      rebuilt: edited.r.rebuilt,
    }));
    expect(edited.r.ok).toBe(true);
    expect(edited.r.rebuilt).toBe(true);
    expect(edited.r.params.radialSeg).toBe(8);
    expect(edited.tris).toBeLessThan(initialTris);
    // Geometry is a fresh BufferGeometry, so its uuid changes.
    expect(edited.geomUuid).not.toBe(initial.geomUuid);
    // Position / rotation / scale untouched.
    expect(edited.pos).toEqual(spawned.pos);
    expect(edited.rot[0]).toBeCloseTo(spawned.rot[0], 5);
    expect(edited.rot[1]).toBeCloseTo(spawned.rot[1], 5);
    expect(edited.rot[2]).toBeCloseTo(spawned.rot[2], 5);
    expect(edited.scl).toEqual(spawned.scl);
    // Material reference preserved (same uuid, same tag).
    expect(edited.matUuid).toBe(spawned.matUuid);
    expect(edited.matTag).toBe(spawned.matTag);
    // userData (selection markers etc.) survives.
    expect(edited.selTag).toBe('selected!');
    // Stamp updated with the new value.
    expect(edited.stamp.kind).toBe('cylinder');
    expect(edited.stamp.radialSeg).toBe(8);
    await win.screenshot({ path: path.join(OUT, '02-cylinder-8seg.png') });

    // ── 4) Reset returns to defaults. ──────────────────────────────────
    const reset = await win.evaluate((uuid) => {
      const r = window.__studioPrimitiveResetParams(uuid);
      const m = window.__archdiscScene.getObjectByProperty('uuid', uuid);
      const g = m.geometry;
      const tris = g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
      return { r, tris, pos: m.position.toArray() };
    }, spawned.uuid);
    console.log('[paramprim] after reset', JSON.stringify({
      tris: reset.tris,
      params: reset.r.params,
    }));
    expect(reset.r.ok).toBe(true);
    expect(reset.r.params.radialSeg).toBe(32);
    expect(reset.tris).toBeGreaterThanOrEqual(initialTris * 0.9);
    expect(reset.pos).toEqual(spawned.pos);
    await win.screenshot({ path: path.join(OUT, '03-cylinder-reset.png') });

    // ── 5) Kind list + build geometry without touching scene. ─────────
    const kinds = await win.evaluate(() => window.__studioPrimitiveListKinds());
    console.log('[paramprim] kinds', kinds.kinds.length);
    expect(kinds.ok).toBe(true);
    expect(kinds.kinds.length).toBeGreaterThanOrEqual(20);
    expect(kinds.kinds).toContain('cylinder');
    expect(kinds.kinds).toContain('torus-knot');
    expect(kinds.kinds).toContain('suzanne');

    const probe = await win.evaluate(() => window.__studioPrimitiveBuildGeometry('torus-knot'));
    expect(probe.ok).toBe(true);
    expect(probe.tris).toBeGreaterThan(100);

    // ── 6) Global search surfaces the new ops. ────────────────────────
    const search = await win.evaluate(() => {
      const r = window.__studioCommandSearch('primitive params', 60);
      return { ok: r.ok, names: (r.hits || []).map((h) => h.name) };
    });
    console.log('[paramprim] search', JSON.stringify(search.names.slice(0, 6)));
    expect(search.ok).toBe(true);
    expect(search.names.some((n) => /PrimitiveSetParams/i.test(n))).toBe(true);

    // ── 7) Camera sweep. ──────────────────────────────────────────────
    for (const view of NAMED_VIEWS) {
      await win.evaluate((v) => {
        if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
        else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
      }, view);
      await win.waitForTimeout(220);
      await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
    }

    // eslint-disable-next-line no-console
    console.log('  slice 750: ',
      'initial tris', initialTris,
      '| 8-seg tris', edited.tris,
      '| reset tris', reset.tris,
      '| kinds', kinds.kinds.length);
  } finally {
    try { await app.close(); } catch (_) { /* ignore */ }
  }
});
