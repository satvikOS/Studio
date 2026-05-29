/*
 * Studio solid B-rep booleans (Rhino / Maya / Plasticity / SolidWorks). Real
 * exact NURBS-trimmed B-rep cut/fuse/common via the OCCT kernel
 * (opencascade.js — prebuilt WASM build of OpenCASCADE). The kernel is loaded
 * LAZILY: a dynamic import + ?url-emitted wasm asset, so the main bundle stays
 * small (the kernel only downloads + initialises the first time a B-rep tool is
 * invoked) — preserving the viewport de-CAD bundle win for everything else.
 *
 * Verification: the box-minus-cylinder cut yields 7 faces (6 box faces + 1
 * cylindrical inner wall = a real through-hole), not the 6 of a plain box.
 */

let _ocPromise = null;
export async function getOC() {
  if (_ocPromise) return _ocPromise;
  _ocPromise = (async () => {
    const [glueMod, wasmMod] = await Promise.all([
      import('opencascade.js/dist/opencascade.full.js'),
      import('opencascade.js/dist/opencascade.full.wasm?url'),
    ]);
    const Module = glueMod.default || glueMod;
    const wasmUrl = wasmMod.default || wasmMod;
    return await new Module({ locateFile: (p) => p.endsWith('.wasm') ? wasmUrl : p });
  })();
  return _ocPromise;
}

function buildShape(oc, spec) {
  const s = spec || {};
  if (s.kind === 'cylinder') {
    const p = s.position || [0, 0, 0];
    const ax = s.axis || [0, 0, 1];
    const a2 = new oc.gp_Ax2_3(new oc.gp_Pnt_3(p[0], p[1], p[2]), new oc.gp_Dir_4(ax[0], ax[1], ax[2]));
    return new oc.BRepPrimAPI_MakeCylinder_3(a2, s.r || 0.3, s.h || 1).Shape();
  }
  if (s.kind === 'sphere') {
    const p = s.position || [0, 0, 0];
    const pnt = new oc.gp_Pnt_3(p[0], p[1], p[2]);
    return new oc.BRepPrimAPI_MakeSphere_4(pnt, s.r || 0.5).Shape();
  }
  // default: box at origin
  return new oc.BRepPrimAPI_MakeBox_2(s.sx || 1, s.sy || 1, s.sz || 1).Shape();
}

/**
 * occtBoolean({op, a, b, linDef}) -> { positions, indices, faces, verts, tris, op }
 *   op: 'cut' (default), 'fuse', 'common'
 *   a, b: { kind: 'box'|'cylinder'|'sphere', ...params }
 */
export async function occtBoolean(opts = {}) {
  const oc = await getOC();
  const op = opts.op || 'cut';
  const a = opts.a || { kind: 'box', sx: 1, sy: 1, sz: 1 };
  const b = opts.b || { kind: 'cylinder', position: [0.5, 0.5, -0.25], r: 0.3, h: 1.5 };
  const sA = buildShape(oc, a);
  const sB = buildShape(oc, b);
  const pr = new oc.Message_ProgressRange_1();
  let algo;
  if (op === 'fuse') algo = new oc.BRepAlgoAPI_Fuse_3(sA, sB, pr);
  else if (op === 'common') algo = new oc.BRepAlgoAPI_Common_3(sA, sB, pr);
  else algo = new oc.BRepAlgoAPI_Cut_3(sA, sB, pr);
  algo.Build(new oc.Message_ProgressRange_1());
  const shape = algo.Shape();
  new oc.BRepMesh_IncrementalMesh_2(shape, opts.linDef || 0.04, false, 0.5, false);

  const positions = [], indices = []; let faces = 0;
  const exp = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; exp.More(); exp.Next()) {
    faces++;
    const face = oc.TopoDS.Face_1(exp.Current());
    const loc = new oc.TopLoc_Location_1();
    const h = oc.BRep_Tool.Triangulation(face, loc, 0);
    if (h.IsNull()) continue;
    const t = h.get();
    const trsf = loc.Transformation();
    const base = positions.length / 3;
    const nb = t.NbNodes();
    for (let i = 1; i <= nb; i++) { const p = t.Node(i).Transformed(trsf); positions.push(p.X(), p.Y(), p.Z()); }
    const nt = t.NbTriangles();
    for (let i = 1; i <= nt; i++) {
      const tri = t.Triangle(i);
      indices.push(base + tri.Value(1) - 1, base + tri.Value(2) - 1, base + tri.Value(3) - 1);
    }
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    faces, verts: positions.length / 3, tris: indices.length / 3, op,
  };
}
