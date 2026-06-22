import { test, _electron as electron } from '@playwright/test';
import path from 'path';
test('diag', async () => {
  test.setTimeout(180000);
  const app = await electron.launch({ args: [path.join('/Users/account_clawteam1/archdisc-Studio','electron','main.js')], slowMo: 0 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w)=>!w.url().startsWith('devtools://')) || await app.waitForEvent('window',{predicate:(w)=>!w.url().startsWith('devtools://')});
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(()=>{try{localStorage.setItem('studio.v3.tour-seen','1');sessionStorage.setItem('studio.v3.splash-shown','1');}catch(_){}});
  await win.reload().catch(()=>{});
  await win.waitForFunction(()=>typeof window.__studioBuildNature==='function'&&typeof window.__studioBuildHumanoid==='function'&&typeof window.__studioHumanoidWalkPath==='function'&&!!window.__archdiscViewport,{timeout:30000});
  const r = await win.evaluate(async ()=>{
    const TH=window.__archdiscTHREE;
    if(window.__studioClearScene)window.__studioClearScene();
    const nat=await window.__studioConstructSubject('nature',{forest:true,terrainSize:120,treeCount:460,relief:4.5,species:['conifer','broadleaf','birch','shrub'],season:'summer',seed:653,fog:true,path:true,wind:true,hdri:'golden'});
    const hum=await window.__studioConstructSubject('humanoid',{height:1.8,build:'average',pose:'relaxed-stand'});
    const fp=window.__studioForestPath;
    // path points
    let pts=[];
    if(fp&&fp.pathAt){const zA=fp.zMin*0.92,zB=fp.zMax*0.92;for(let k=0;k<=7;k++){const z=zA+(zB-zA)*(k/7);const p=fp.pathAt(z);pts.push([p.x,0,p.z]);}}
    const walk=window.__studioHumanoidWalkPath({path:pts,speed:1.4,strideMeters:0.78,plant:true});
    // sample advance at a few u
    const samples=[0,0.25,0.5,0.75,1].map(u=>{const a=window.__studioHumanoidWalkAdvance(u);return{u,x:+a.x.toFixed(1),y:+a.y.toFixed(1),z:+a.z.toFixed(1),heading:+a.heading.toFixed(2)};});
    // figure bbox at u=0.5
    window.__studioHumanoidWalkAdvance(0.5);
    const scene=window.__archdiscScene;
    const figBox=new TH.Box3();let nSkin=0;
    scene.traverse(o=>{if(o.isSkinnedMesh){nSkin++;o.updateMatrixWorld(true);o.skeleton&&o.skeleton.update&&o.skeleton.update();figBox.expandByObject(o);}});
    // count trees within 12m of the path midpoint
    const mid=pts[Math.floor(pts.length/2)];
    let near=0,treeBodies=0;
    scene.traverse(o=>{if(o.isMesh&&o.userData&&o.userData.archdiscStudioNature){treeBodies++;o.updateMatrixWorld(true);const c=new TH.Vector3();new TH.Box3().setFromObject(o).getCenter(c);if(Math.hypot(c.x-mid[0],c.z-mid[2])<14)near++;}});
    return{pts,samples,nSkin,fig:{min:figBox.min,max:figBox.max,empty:figBox.isEmpty()},mid,near,treeBodies,clearing:fp&&fp.clearing,halfWidth:fp&&fp.halfWidth,zMin:fp&&fp.zMin,zMax:fp&&fp.zMax,pathLen:walk.pathLength};
  });
  console.log('DIAG '+JSON.stringify(r,null,1));
  await app.close();
});
