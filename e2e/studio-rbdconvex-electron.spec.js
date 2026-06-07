// ArchDisc Studio V3 — Houdini-tier convex RBD (slice 778).
//
// Headed Mac-Electron spec. Verifies the GJK + EPA + impulse-response
// pipeline:
//
//   • boot the V3 shell, install the rbdconvex autoload
//   • spawn TWO stacked unit cubes — bottom static at Y=0, top dynamic
//     at Y=2.5 (gap so the top cube falls under gravity)
//   • create convex RBD bodies for both:
//        - bottom: mass=0 (static, infinite mass — acts like a floor)
//        - top:    mass=1 (dynamic), restitution=0.05 (low so it
//                  doesn't bounce back into the air)
//   • step 60 frames at dt=1/60 with gravity [0,-9.81,0]
//   • assert the top cube has FALLEN onto the bottom (Y dropped from 2.5
//     toward 1.0) and NO inter-penetration: top.Y - top.aabbMin should
//     be >= bottom.Y + bottom.aabbMax (within a 1 cm slop)
//   • assert at least one collision was reported during the step
//   • 5 cam angles (front/iso/right/top/close)
//
// e2e DOES NOT run during this slice (per the slice brief — port
// conflict). This file just has to compile cleanly and pass when the
// autoload + ops are wired correctly.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-rbdconvex');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — Houdini-tier convex RBD: GJK + EPA + impulse response (slice 778)', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
  });
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

  // ── Ensure the convex RBD module is installed. ─────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioConvexRBDCreate !== 'function') {
      await import('/src/workbenches/studio/v3/rbdconvex/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioConvexRBDCreate === 'function'
       && typeof window.__studioConvexRBDStep === 'function'
       && typeof window.__studioConvexRBDList === 'function'
       && typeof window.__studioConvexRBDRemove === 'function'
       && typeof window.__studioConvexRBDSetGravity === 'function'
       && typeof window.__studioConvexRBDClearSet === 'function',
    null, { timeout: 20000 },
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // Reset any state from a previous run.
  await win.evaluate(() => window.__studioConvexRBDClearSet({ setKey: 'stack' }));

  // ── Spawn two cubes. Bottom is the "floor"; top falls onto it. ────
  // Note the gap: top centre at Y=2.5 with half-extent 0.5 → its bottom
  // face is at Y=2.0, well above the top cube's top face at Y=0.5. The
  // 1.5-unit gap closes under gravity within ~0.55 s = 33 frames.
  const setup = await win.evaluate(() => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    const matA = new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.7 });
    const matB = new THREE.MeshStandardMaterial({ color: 0xbb6633, roughness: 0.7 });
    const bot = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), matA);
    bot.position.set(0, 0, 0);
    bot.userData.archdiscStudioPrimitive = true;
    bot.userData.archdiscStudioPrimitiveKind = 'cube';
    scene.add(bot);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), matB);
    top.position.set(0, 2.5, 0);
    top.userData.archdiscStudioPrimitive = true;
    top.userData.archdiscStudioPrimitiveKind = 'cube';
    scene.add(top);
    return { botUuid: bot.uuid, topUuid: top.uuid };
  });
  expect(typeof setup.botUuid).toBe('string');
  expect(typeof setup.topUuid).toBe('string');
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-stacked.png') });

  // ── 1) Create bodies. Bottom is static (mass=0), top is dynamic. ─
  const bot = await win.evaluate((uuid) => window.__studioConvexRBDCreate({
    meshUuid: uuid, mass: 0, setKey: 'stack', restitution: 0.05, friction: 0.7,
  }), setup.botUuid);
  console.log('[crbd] bot', JSON.stringify(bot));
  expect(bot.ok).toBe(true);
  expect(typeof bot.bodyKey).toBe('string');
  expect(bot.vertexCount).toBe(8);

  const top = await win.evaluate((uuid) => window.__studioConvexRBDCreate({
    meshUuid: uuid, mass: 1, setKey: 'stack', restitution: 0.05, friction: 0.7,
  }), setup.topUuid);
  console.log('[crbd] top', JSON.stringify(top));
  expect(top.ok).toBe(true);
  expect(typeof top.bodyKey).toBe('string');
  expect(top.vertexCount).toBe(8);

  // Sanity: List should have 1 set with 2 bodies.
  const list0 = await win.evaluate(() => window.__studioConvexRBDList());
  expect(list0.ok).toBe(true);
  expect(list0.totalBodies).toBe(2);
  const stackSet = list0.sets.find((s) => s.setKey === 'stack');
  expect(stackSet).toBeTruthy();
  expect(stackSet.bodyCount).toBe(2);

  // ── 2) Step 60 frames at dt=1/60. Top should fall and land on bot.
  let anyCollision = false;
  let lastTopY = 2.5;
  for (let i = 0; i < 60; i++) {
    const r = await win.evaluate(() => window.__studioConvexRBDStep({
      setKey: 'stack', dt: 1 / 60,
    }));
    if (r.collisions && r.collisions.length > 0) anyCollision = true;
    if ((i + 1) % 15 === 0) {
      const ty = await win.evaluate(({ uuid }) => {
        const m = window.__archdiscScene.getObjectByProperty('uuid', uuid);
        return m ? m.position.y : null;
      }, { uuid: setup.topUuid });
      console.log(`[crbd] frame ${i + 1} topY=${ty}`);
      lastTopY = ty;
    }
  }
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '02-settled.png') });

  // ── 3) Verify: top has fallen onto bottom, no interpenetration. ──
  const final = await win.evaluate(({ botUuid, topUuid }) => {
    const scene = window.__archdiscScene;
    const bo = scene.getObjectByProperty('uuid', botUuid);
    const to = scene.getObjectByProperty('uuid', topUuid);
    return {
      botY: bo ? bo.position.y : null,
      topY: to ? to.position.y : null,
    };
  }, { botUuid: setup.botUuid, topUuid: setup.topUuid });
  console.log('[crbd] final', JSON.stringify(final), 'anyCollision=', anyCollision);
  expect(anyCollision).toBe(true);
  expect(final.botY).toBe(0);                    // static stays put
  expect(final.topY).toBeLessThan(2.0);          // top fell substantially
  expect(final.topY).toBeGreaterThan(0.95);      // … but didn't pass through
  // No interpenetration: top's bottom face (topY-0.5) should be ≥ bot's
  // top face (botY+0.5) within a 1 cm tolerance.
  const topBottom = final.topY - 0.5;
  const botTop    = final.botY + 0.5;
  expect(topBottom).toBeGreaterThanOrEqual(botTop - 0.01);

  // ── 4) Camera sweep. ──────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport;
      const c = vp && vp.camera;
      if (c) {
        if (v === 'front') c.position.set(0, 1.5, 6);
        else if (v === 'top') c.position.set(0, 8, 0.001);
        else if (v === 'right') c.position.set(6, 1.5, 0);
        else if (v === 'iso') c.position.set(4, 4, 4);
        else if (v === 'close') c.position.set(2, 2, 2);
        c.lookAt(0, 1, 0);
      } else if (typeof window.__studioSetView === 'function') {
        window.__studioSetView(v);
      } else if (typeof window.__archdiscSetView === 'function') {
        window.__archdiscSetView(v);
      }
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // ── 5) Remove + clear sanity. ────────────────────────────────────
  const rm = await win.evaluate((k) => window.__studioConvexRBDRemove({
    bodyKey: k, setKey: 'stack',
  }), top.bodyKey);
  expect(rm.ok).toBe(true);
  expect(rm.removed).toBe(true);

  const list1 = await win.evaluate(() => window.__studioConvexRBDList());
  const stackAfter = list1.sets.find((s) => s.setKey === 'stack');
  expect(stackAfter.bodyCount).toBe(1);

  const cleared = await win.evaluate(() => window.__studioConvexRBDClearSet({
    setKey: 'stack',
  }));
  expect(cleared.ok).toBe(true);
  const list2 = await win.evaluate(() => window.__studioConvexRBDList());
  expect(list2.sets.find((s) => s.setKey === 'stack')).toBeFalsy();

  // eslint-disable-next-line no-console
  console.log('  slice 778: convex RBD final topY=%f botY=%f collisions=%s',
    final.topY, final.botY, anyCollision);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
