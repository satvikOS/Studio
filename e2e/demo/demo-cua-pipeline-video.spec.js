// SHOWS modeling from scratch by CUAs: records the LIVE session as timed frames —
// empty viewport → Archie (cua-staged model) drives the UI step-by-step (each
// primitive appears as the model emits click-primitive), arranges, lights → render
// → camera orbit. ffmpeg stitches frames into an mp4 of the WHOLE pipeline. No imports.
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path'; import fs from 'fs'; import { execSync } from 'child_process';
const OUT = path.resolve(__dirname, 'shots', 'studio', 'cua-pipeline');
const FR = path.join(OUT, 'frames');
const PROMPTS = ['build a small living room — a sofa, a coffee table, two chairs, a shelf, a lamp and a plant',
  'set up a desk workspace — a desk, a chair, a monitor, a shelf and a lamp'];
const pick = PROMPTS[Date.now() % PROMPTS.length];
test('CUA pipeline video — empty → model builds step-by-step → light → render → orbit', async () => {
  test.setTimeout(14 * 60 * 1000);
  fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js')], slowMo: 30 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { try { window.localStorage.setItem('studio.v3.tour-seen','1'); window.sessionStorage.setItem('studio.v3.splash-shown','1'); } catch(_){} }).catch(()=>{});
  await win.reload().catch(()=>{});
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 25000 });
  await expect(win.locator('[data-studio-v3-cmdbar-input]')).toBeVisible({ timeout: 15000 });
  let fi = 0;
  const shot = async () => { await win.screenshot({ path: path.join(FR, `f-${String(fi++).padStart(4,'0')}.png`) }); };
  const bodyCount = () => win.evaluate(() => { const s=window.__archdiscScene; let n=0; if(s) s.traverse(o=>{if(o.isMesh&&o.userData&&o.userData.archdiscStudioPrimitive)n++;}); return n; });
  // empty viewport (hold a beat)
  for (let i=0;i<6;i++){ await shot(); await win.waitForTimeout(150); }
  // HUMAN types the prompt → Archie drives the UI; capture the build progression
  const input = win.locator('[data-studio-v3-cmdbar-input]'); await input.click(); await input.type(pick,{delay:12}); await shot();
  await input.press('Enter');
  let last=-1, stableMs=0;
  for (let i=0;i<140;i++){ // ~70s build window
    await win.waitForTimeout(500); await shot();
    const n = await bodyCount();
    if (n===last) stableMs+=500; else { stableMs=0; last=n; }
    if (n>=4 && stableMs>=10000) break;
  }
  const built = await last;
  // lighting (real stage preset) — the model often emits it; ensure a lit final
  await win.evaluate(()=>{ const b=document.querySelector('[data-studio-v3-stage-preset="sunset"]'); if(b) b.click(); }).catch(()=>{});
  for (let i=0;i<4;i++){ await shot(); await win.waitForTimeout(200); }
  // RENDER via the render control (CUA op), if present
  await win.evaluate(()=>{ window.__studioLastRender=null; const r=document.querySelector('[data-studio-v3-render]'); if(r) r.click(); }).catch(()=>{});
  for (let i=0;i<40;i++){ await win.waitForTimeout(700); await shot(); const done=await win.evaluate(()=>!!(window.__studioLastRender&&window.__studioLastRender.dataUrl)); if(done) break; }
  // camera orbit (light viewport) to close
  await win.evaluate(()=>{ const vp=window.__archdiscViewport; if(vp&&vp.controls) vp.controls.enabled=false; });
  for (let f=0; f<24; f++){
    await win.evaluate((frac)=>{ const s=window.__archdiscScene,TH=window.__archdiscTHREE,vp=window.__archdiscViewport; if(!s||!TH||!vp||!vp.camera)return; const box=new TH.Box3(); s.traverse(o=>{if(o.isMesh&&o.userData&&o.userData.archdiscStudioPrimitive)box.expandByObject(o);}); if(box.isEmpty())return; const c=box.getCenter(new TH.Vector3()); const sph=box.getBoundingSphere(new TH.Sphere()); const R=sph.radius||2; const cam=vp.camera; const fov=((cam.fov||50)*Math.PI)/180; const d=(R/Math.sin(fov/2))*0.95; const a=frac*Math.PI*2; cam.position.set(c.x+Math.cos(a)*d, c.y+R*0.35, c.z+Math.sin(a)*d); cam.lookAt(c.x,c.y,c.z); cam.updateProjectionMatrix(); cam.updateMatrixWorld(); }, f/24);
    await win.waitForTimeout(120); await shot();
  }
  console.log(`[cua-video] prompt="${pick}" built=${built} frames=${fi}`);
  await win.evaluate(()=>{ window.__studioV3Dirty=false; window.onbeforeunload=null; }).catch(()=>{});
  await app.close();
  // stitch frames → mp4 (12fps so the build is watchable)
  execSync(`ffmpeg -y -framerate 12 -i ${FR}/f-%04d.png -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" ${OUT}/cua-pipeline.mp4`, { stdio: 'ignore' });
  console.log(`[cua-video] mp4 → ${OUT}/cua-pipeline.mp4`);
  expect(built).toBeGreaterThanOrEqual(4);
  expect(fs.existsSync(path.join(OUT,'cua-pipeline.mp4'))).toBeTruthy();
});
