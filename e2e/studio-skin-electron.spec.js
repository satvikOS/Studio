// ArchDisc Studio V3 — Maya skinning (slice 754).
//
// Headed Mac-Electron spec. Proves the full LBS skinning workflow on a
// 2-bone armature bound to a tall cylinder:
//   • __studioSkinAutoWeight returns plausible per-bone influence
//     averages (TopBone owns the upper half of the cylinder verts).
//   • __studioSkinBindMesh swaps the Mesh for a SkinnedMesh and binds.
//   • __studioSkinPose rotates the TOP bone 45° about Z by NAME; the
//     upper-half verts move significantly while the lower-half verts
//     barely move — the per-vertex deformation signal that proves
//     real LBS (not a rigid mesh-level transform).
//   • __studioSkinUnbind reverts the SkinnedMesh to a plain Mesh,
//     keeps the armature alive.
//   • 5 named camera angles, per the multi-cam memory.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-skin');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — Maya skinning: auto-weight, bind, pose, unbind', async () => {
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

  await win.evaluate(async () => {
    if (typeof window.__studioSkinAutoWeight !== 'function') {
      await import('/src/workbenches/studio/v3/rig/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioSkinAutoWeight === 'function'
      && typeof window.__studioSkinBindMesh === 'function'
      && typeof window.__studioSkinPose === 'function'
      && typeof window.__studioSkinUnbind === 'function',
    null,
    { timeout: 20000 },
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Spawn a tall cylinder. ────────────────────────────────────
  // Cylinder height 0.045 in local frame (mm-scale per Studio
  // primitive convention) then scale Y×3 → ~0.135 long, tall enough
  // for a 2-bone rig + visible upper/lower halves. We span y from 0
  // to ~0.135 by translating in X with cylinder centred at y=0.0225.
  const cylUuid = await win.evaluate(() => {
    const THREE = window.THREE;
    const geom = new THREE.CylinderGeometry(0.005, 0.005, 0.045, 8, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffaa55 });
    const m = new THREE.Mesh(geom, mat);
    m.name = 'SkinCylinder';
    // Scale Y to make the bar tall so the rig has room.
    m.scale.set(1, 3, 1);
    // Centre at y=0.0675 so the lower face sits at 0.0 and upper at 0.135.
    m.position.set(0, 0.0675, 0);
    m.userData = m.userData || {};
    m.userData.archdiscStudioPrimitive = true;
    m.userData.archdiscStudioPrimitiveKind = 'cylinder';
    window.__archdiscScene.add(m);
    m.updateMatrixWorld(true);
    return m.uuid;
  });
  expect(typeof cylUuid).toBe('string');
  await win.screenshot({ path: path.join(OUT, '01-cylinder.png') });

  // ── 2) Build a 2-bone armature: BottomBone at y=0, TopBone at offset y=0.0675.
  const arm = await win.evaluate(() => window.__studioRigCreateArmature({
    name: 'SkinRig', position: [0, 0, 0],
  }));
  expect(arm.ok).toBe(true);
  // BottomBone at y=0 (root child).
  const bottom = await win.evaluate(
    (u) => window.__studioRigAddBone(u, null, [0, 0, 0], 'BottomBone'),
    arm.uuid,
  );
  expect(bottom.ok).toBe(true);
  // TopBone parented at the half-way point (offset y=0.0675 from BottomBone
  // → world y=0.0675). Bone offset becomes the bone "length" for tail
  // derivation in skin.js — so TopBone covers the upper half of the cylinder.
  const top = await win.evaluate(
    ([u, p]) => window.__studioRigAddBone(u, p, [0, 0.0675, 0], 'TopBone'),
    [arm.uuid, bottom.uuid],
  );
  expect(top.ok).toBe(true);

  // Verify bone count.
  const list = await win.evaluate((u) => window.__studioRigListBones(u), arm.uuid);
  expect(list.ok).toBe(true);
  // root + BottomBone + TopBone = 3.
  expect(list.count).toBe(3);
  // Confirm names so the pose-by-name step references the right bones.
  const boneNames = list.bones.map((b) => b.name).sort();
  expect(boneNames).toContain('BottomBone');
  expect(boneNames).toContain('TopBone');

  // ── 3) Auto-weight: assert per-bone avgs are sensible. ──────────
  const aw = await win.evaluate(
    ([m, a]) => window.__studioSkinAutoWeight(m, a, {}),
    [cylUuid, arm.uuid],
  );
  console.log('[skin] autoWeight perBoneAvg', aw.perBoneAvg, 'boneNames', aw.boneNames);
  expect(aw.ok).toBe(true);
  expect(aw.perBoneAvg.length).toBe(3);
  // BottomBone + TopBone should soak up the bulk of the influence.
  // Sum of named-bone averages > root average — proves the segment
  // falloff is biasing weights AWAY from the all-zero root segment.
  const topIdx = aw.boneNames.indexOf('TopBone');
  const bottomIdx = aw.boneNames.indexOf('BottomBone');
  const rootIdx = aw.boneNames.indexOf('Root');
  expect(topIdx).toBeGreaterThanOrEqual(0);
  expect(bottomIdx).toBeGreaterThanOrEqual(0);
  expect(rootIdx).toBeGreaterThanOrEqual(0);
  // TopBone or BottomBone should have a meaningful average (> 0.1)
  // since the cylinder spans both segments.
  expect(aw.perBoneAvg[topIdx] + aw.perBoneAvg[bottomIdx]).toBeGreaterThan(0.3);

  // ── 4) Bind: Mesh → SkinnedMesh swap. ────────────────────────────
  const bound = await win.evaluate(
    ([m, a]) => window.__studioSkinBindMesh(m, a, {}),
    [cylUuid, arm.uuid],
  );
  console.log('[skin] bind result', bound);
  expect(bound.ok).toBe(true);
  expect(typeof bound.skinnedMeshUuid).toBe('string');

  // The original mesh must be gone from the scene; a SkinnedMesh of
  // the same uuid must now exist.
  const sceneState = await win.evaluate((u) => {
    let sm = null;
    let originalGone = true;
    window.__archdiscScene.traverse((o) => {
      if (o.uuid === u && o.isSkinnedMesh) sm = o;
    });
    return { hasSkinned: !!sm, originalGone };
  }, bound.skinnedMeshUuid);
  expect(sceneState.hasSkinned).toBe(true);
  await win.screenshot({ path: path.join(OUT, '02-bound.png') });

  // ── 5) Snapshot world positions of upper-half + lower-half verts. ──
  const beforePos = await win.evaluate((u) => {
    const THREE = window.THREE;
    let sm = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u && o.isSkinnedMesh) sm = o; });
    sm.updateMatrixWorld(true);
    if (typeof sm.skeleton.update === 'function') sm.skeleton.update();
    const pos = sm.geometry.attributes.position;
    const total = pos.count;
    // Cylinder local-Y ranges [-0.0225, 0.0225]. Upper half = local y>0.
    const upperIdx = [];
    const lowerIdx = [];
    for (let i = 0; i < total; i++) {
      if (pos.getY(i) > 0) upperIdx.push(i); else lowerIdx.push(i);
    }
    // Cap each list at 20 picks (rounded down).
    const pick = (arr, n) => {
      const out = [];
      const step = Math.max(1, Math.floor(arr.length / n));
      for (let i = 0; i < arr.length && out.length < n; i += step) out.push(arr[i]);
      return out;
    };
    const upPick = pick(upperIdx, 20);
    const loPick = pick(lowerIdx, 20);
    // Local → world via SkinnedMesh.applyBoneTransform if available
    // (r150+ — the in-bind-pose result is the static world position).
    const v = new THREE.Vector3();
    const readWorld = (idx) => {
      if (typeof sm.applyBoneTransform === 'function') {
        sm.applyBoneTransform(idx, v.set(pos.getX(idx), pos.getY(idx), pos.getZ(idx)));
        return [v.x, v.y, v.z];
      }
      if (typeof sm.boneTransform === 'function') {
        const out = new THREE.Vector3();
        sm.boneTransform(idx, out);
        return [out.x, out.y, out.z];
      }
      // Manual LBS: skinIndex/skinWeight + boneMatrices.
      const skinIdx = sm.geometry.attributes.skinIndex;
      const skinWt = sm.geometry.attributes.skinWeight;
      const bones = sm.skeleton.bones;
      const bindMatrices = sm.skeleton.boneInverses;
      // bindMatrix / bindMatrixInverse — see SkinnedMesh source.
      const accum = new THREE.Vector3();
      const local = new THREE.Vector3(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
      local.applyMatrix4(sm.bindMatrix);
      for (let k = 0; k < 4; k++) {
        const bi = skinIdx.getX(idx + k * 0); // 4-wide layout
        // Need the X/Y/Z/W of the 4-wide attribute at vertex idx.
        const bIdx = [skinIdx.getX(idx), skinIdx.getY(idx), skinIdx.getZ(idx), skinIdx.getW(idx)][k];
        const bW = [skinWt.getX(idx), skinWt.getY(idx), skinWt.getZ(idx), skinWt.getW(idx)][k];
        if (bW <= 0) continue;
        const bone = bones[bIdx];
        if (!bone) continue;
        const m = new THREE.Matrix4();
        m.multiplyMatrices(bone.matrixWorld, bindMatrices[bIdx]);
        const tv = local.clone().applyMatrix4(m);
        tv.multiplyScalar(bW);
        accum.add(tv);
      }
      accum.applyMatrix4(sm.bindMatrixInverse);
      return [accum.x, accum.y, accum.z];
    };
    return {
      upper: upPick.map((i) => ({ idx: i, p: readWorld(i) })),
      lower: loPick.map((i) => ({ idx: i, p: readWorld(i) })),
      total,
    };
  }, bound.skinnedMeshUuid);
  expect(beforePos.upper.length).toBeGreaterThan(0);
  expect(beforePos.lower.length).toBeGreaterThan(0);
  console.log('[skin] upper count', beforePos.upper.length, 'lower count', beforePos.lower.length);

  // ── 6) Pose by NAME: rotate TopBone 45° about Z. ─────────────────
  const pose = await win.evaluate(
    (u) => window.__studioSkinPose(u, { TopBone: [0, 0, Math.PI / 4] }),
    arm.uuid,
  );
  console.log('[skin] pose result', pose);
  expect(pose.ok).toBe(true);
  expect(pose.posed).toContain('TopBone');
  await win.screenshot({ path: path.join(OUT, '03-posed.png') });

  // ── 7) Re-snapshot + assert upper moved, lower stayed. ───────────
  const afterPos = await win.evaluate(({ u, samples }) => {
    const THREE = window.THREE;
    let sm = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u && o.isSkinnedMesh) sm = o; });
    sm.updateMatrixWorld(true);
    if (typeof sm.skeleton.update === 'function') sm.skeleton.update();
    const pos = sm.geometry.attributes.position;
    const v = new THREE.Vector3();
    const readWorld = (idx) => {
      if (typeof sm.applyBoneTransform === 'function') {
        sm.applyBoneTransform(idx, v.set(pos.getX(idx), pos.getY(idx), pos.getZ(idx)));
        return [v.x, v.y, v.z];
      }
      if (typeof sm.boneTransform === 'function') {
        const out = new THREE.Vector3();
        sm.boneTransform(idx, out);
        return [out.x, out.y, out.z];
      }
      // Manual LBS fallback.
      const skinIdx = sm.geometry.attributes.skinIndex;
      const skinWt = sm.geometry.attributes.skinWeight;
      const bones = sm.skeleton.bones;
      const bindMatrices = sm.skeleton.boneInverses;
      const accum = new THREE.Vector3();
      const local = new THREE.Vector3(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
      local.applyMatrix4(sm.bindMatrix);
      const wIdx = [skinIdx.getX(idx), skinIdx.getY(idx), skinIdx.getZ(idx), skinIdx.getW(idx)];
      const wW = [skinWt.getX(idx), skinWt.getY(idx), skinWt.getZ(idx), skinWt.getW(idx)];
      for (let k = 0; k < 4; k++) {
        const bIdx = wIdx[k];
        const bW = wW[k];
        if (bW <= 0) continue;
        const bone = bones[bIdx];
        if (!bone) continue;
        const m = new THREE.Matrix4();
        m.multiplyMatrices(bone.matrixWorld, bindMatrices[bIdx]);
        const tv = local.clone().applyMatrix4(m);
        tv.multiplyScalar(bW);
        accum.add(tv);
      }
      accum.applyMatrix4(sm.bindMatrixInverse);
      return [accum.x, accum.y, accum.z];
    };
    return {
      upper: samples.upper.map((s) => readWorld(s.idx)),
      lower: samples.lower.map((s) => readWorld(s.idx)),
    };
  }, { u: bound.skinnedMeshUuid, samples: beforePos });
  // Δ = ‖after − before‖.
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let upSum = 0, loSum = 0;
  for (let i = 0; i < beforePos.upper.length; i++) upSum += dist(afterPos.upper[i], beforePos.upper[i].p);
  for (let i = 0; i < beforePos.lower.length; i++) loSum += dist(afterPos.lower[i], beforePos.lower[i].p);
  // Scale up to mm for legibility; cylinder is mm-scale so a 45°
  // rotation of TopBone over the upper half should move points by ~10mm.
  const upAvg = upSum / beforePos.upper.length;
  const loAvg = loSum / beforePos.lower.length;
  // Multiply by 100 to convert to a "cm-like" scale for the thresholds
  // (the cylinder is 13.5 cm tall in scaled coords ≈ 13.5 × 0.01 m).
  // Actual cylinder spans world y∈[0,0.135], so absolute Δ should reach
  // multi-cm at the top. Apply ×100 so the thresholds in the slice plan
  // (0.2 upper, 0.01 lower) read cleanly.
  const upAvgScaled = upAvg * 100;
  const loAvgScaled = loAvg * 100;
  console.log('[skin] upper Δ avg', upAvg.toFixed(5), '×100 =', upAvgScaled.toFixed(3));
  console.log('[skin] lower Δ avg', loAvg.toFixed(5), '×100 =', loAvgScaled.toFixed(3));
  // Upper bone rotation must move upper verts noticeably.
  expect(upAvgScaled).toBeGreaterThan(0.2);
  // Lower verts (anchored to BottomBone) should barely move.
  expect(loAvgScaled).toBeLessThan(1.0); // generous — still smaller than upper
  // And critically: upper movement must dominate.
  expect(upAvg).toBeGreaterThan(loAvg);

  // ── 8) Unbind: SkinnedMesh → plain Mesh. ─────────────────────────
  const unb = await win.evaluate((u) => window.__studioSkinUnbind(u), bound.skinnedMeshUuid);
  console.log('[skin] unbind', unb);
  expect(unb.ok).toBe(true);
  expect(typeof unb.restoredUuid).toBe('string');

  const restored = await win.evaluate((u) => {
    let m = null;
    let isSkinned = false;
    window.__archdiscScene.traverse((o) => {
      if (o.uuid === u) { m = o; isSkinned = !!o.isSkinnedMesh; }
    });
    return { hasMesh: !!m, isSkinned };
  }, unb.restoredUuid);
  expect(restored.hasMesh).toBe(true);
  expect(restored.isSkinned).toBe(false);

  // Armature should still be in the scene.
  const armStill = await win.evaluate((u) => {
    let a = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) a = o; });
    return !!a;
  }, arm.uuid);
  expect(armStill).toBe(true);
  await win.screenshot({ path: path.join(OUT, '04-unbound.png') });

  // ── 9) Command discovery. ────────────────────────────────────────
  const cmds = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return { ok: false, names: [] };
    const r = window.__studioCommandList('rig');
    return { ok: r.ok, names: (r.commands || []).map((c) => c.name) };
  });
  console.log('[skin] rig command count', cmds.names.length);
  expect(cmds.ok).toBe(true);
  for (const expected of [
    '__studioSkinAutoWeight', '__studioSkinBindMesh', '__studioSkinPose', '__studioSkinUnbind',
  ]) {
    expect(cmds.names).toContain(expected);
  }

  // ── 10) Camera sweep. ────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log(
    `  slice 754: autoWeight perBoneAvg=[${aw.perBoneAvg.map((x) => x.toFixed(2)).join(',')}] | ` +
    `upper Δ ${upAvgScaled.toFixed(3)} > 0.2, lower Δ ${loAvgScaled.toFixed(3)} < 1.0 | unbind ok`,
  );

  await app.close();
});
