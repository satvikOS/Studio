// ArchDisc Studio V3 — WGSL compute shader for the real WebGPU path tracer
// (slice 886).
//
// One workgroup-invocation per pixel; @workgroup_size(8, 8). Each invocation:
//   1. Samples a primary ray from the camera matrices (jittered per-sample).
//   2. Traverses the three-mesh-bvh BVH that was uploaded to a storage buffer
//      using an iterative stack (no recursion).
//   3. Tests triangle intersections with Möller-Trumbore.
//   4. Shades hit with Lambertian + a single-bounce cosine-weighted
//      hemisphere sample (the brief asks for 1 bounce). GGX evaluation is
//      done at the hit but the bounce direction is the importance-sampled
//      Lambert cosine, which keeps the kernel under register pressure.
//   5. Accumulates radiance into an rgba16float storage texture
//      (`output`).
//
// Buffer / binding layout (group 0):
//   binding 0 — uniforms          : Uniforms       (camera + dims + counts)
//   binding 1 — bvhNodes          : array<BVHNode> (32 bytes/node)
//   binding 2 — triIndices        : array<u32>     (three indices per tri)
//   binding 3 — positions         : array<f32>     (vec3 packed as 3 f32)
//   binding 4 — materials         : array<Material>(albedo + emissive + rough)
//   binding 5 — triMaterialId     : array<u32>     (per-triangle material slot)
//   binding 6 — output            : texture_storage_2d<rgba16float, write>
//
// The BVHNode layout matches MeshBVHUniformStruct's serialisation
// verbatim:
//   f32[0..2]  = min.xyz
//   f32[3..5]  = max.xyz
//   u32[6]     = right-child-node-index (inner) OR triangle-offset (leaf)
//   u16[14]    = triangle COUNT  (inner: SPLIT_AXIS in low 16 bits of u32[7])
//   u16[15]    = 0xFFFF when leaf, otherwise inner
//   (we encode u32[7]: bit 31 = is-leaf flag, bits 0..30 hold COUNT-or-AXIS)

export const PT_WGSL = /* wgsl */ `
struct Uniforms {
  cameraInverseViewProj : mat4x4<f32>,
  cameraOrigin          : vec4<f32>,
  width                 : u32,
  height                : u32,
  sample                : u32,
  maxBounces            : u32,
  nodeCount             : u32,
  triCount              : u32,
  materialCount         : u32,
  seed                  : u32,
};

struct BVHNode {
  // 8 floats / 8 uints — laid out exactly as three-mesh-bvh on disk.
  bMin   : vec3<f32>,
  rightOrOffset : u32,
  bMax   : vec3<f32>,
  flagsCount    : u32,  // bit 31 = is-leaf; low 16 = COUNT (leaf) or SPLIT_AXIS (inner)
};

struct Material {
  albedo   : vec4<f32>,   // rgb + roughness
  emissive : vec4<f32>,   // rgb + metalness
};

@group(0) @binding(0) var<uniform> U : Uniforms;
@group(0) @binding(1) var<storage, read> bvhNodes : array<BVHNode>;
@group(0) @binding(2) var<storage, read> triIndices : array<u32>;
@group(0) @binding(3) var<storage, read> positions : array<f32>;
@group(0) @binding(4) var<storage, read> materials : array<Material>;
@group(0) @binding(5) var<storage, read> triMaterialId : array<u32>;
@group(0) @binding(6) var output : texture_storage_2d<rgba16float, write>;

// ------------------------------------------------------------------ RNG
//
// PCG-XSH-RR 32→32 hash. Deterministic, branchless, decent perceptual
// uniformity over a 256x256 tile which is what the kernel covers.

fn pcgHash(seed : u32) -> u32 {
  var state : u32 = seed * 747796405u + 2891336453u;
  var word  : u32 = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn randFloat(rngState : ptr<function, u32>) -> f32 {
  let h = pcgHash(*rngState);
  *rngState = h;
  return f32(h) / 4294967295.0;
}

// ------------------------------------------------------------------ vec3 fetch

fn fetchPosition(vi : u32) -> vec3<f32> {
  let base = vi * 3u;
  return vec3<f32>(positions[base], positions[base + 1u], positions[base + 2u]);
}

// ------------------------------------------------------------------ AABB test
//
// Slab method. Returns true (and minimum positive entry t) when the ray
// hits the AABB inside [tmin, tmax].

fn rayAABB(ro : vec3<f32>, invRd : vec3<f32>, bMin : vec3<f32>, bMax : vec3<f32>, tmax : f32) -> f32 {
  let t0 = (bMin - ro) * invRd;
  let t1 = (bMax - ro) * invRd;
  let tsmaller = min(t0, t1);
  let tbigger  = max(t0, t1);
  let tNear = max(max(tsmaller.x, tsmaller.y), tsmaller.z);
  let tFar  = min(min(tbigger.x,  tbigger.y),  tbigger.z);
  if (tFar < max(tNear, 0.0) || tNear > tmax) {
    return -1.0;
  }
  return max(tNear, 0.0);
}

// ------------------------------------------------------------------ Triangle (Möller-Trumbore)

struct Hit {
  t          : f32,
  triIndex   : u32,
  normal     : vec3<f32>,
  hit        : bool,
};

fn rayTriangle(ro : vec3<f32>, rd : vec3<f32>, v0 : vec3<f32>, v1 : vec3<f32>, v2 : vec3<f32>) -> vec4<f32> {
  let edge1 = v1 - v0;
  let edge2 = v2 - v0;
  let h = cross(rd, edge2);
  let a = dot(edge1, h);
  if (abs(a) < 1.0e-8) {
    return vec4<f32>(-1.0, 0.0, 0.0, 0.0);
  }
  let f = 1.0 / a;
  let s = ro - v0;
  let u = f * dot(s, h);
  if (u < 0.0 || u > 1.0) {
    return vec4<f32>(-1.0, 0.0, 0.0, 0.0);
  }
  let q = cross(s, edge1);
  let v = f * dot(rd, q);
  if (v < 0.0 || u + v > 1.0) {
    return vec4<f32>(-1.0, 0.0, 0.0, 0.0);
  }
  let t = f * dot(edge2, q);
  if (t < 1.0e-5) {
    return vec4<f32>(-1.0, 0.0, 0.0, 0.0);
  }
  return vec4<f32>(t, u, v, 1.0);
}

// ------------------------------------------------------------------ BVH traversal
//
// Iterative stack walk. Stack holds 32 node indices which is plenty for a
// well-balanced BVH up to a few million triangles.

const STACK_MAX : u32 = 32u;

fn traceBVH(ro : vec3<f32>, rd : vec3<f32>, tmaxIn : f32) -> Hit {
  var hit : Hit;
  hit.t = tmaxIn;
  hit.triIndex = 0u;
  hit.normal = vec3<f32>(0.0, 1.0, 0.0);
  hit.hit = false;
  let invRd = vec3<f32>(
    select(1.0e30, 1.0 / rd.x, abs(rd.x) > 1.0e-10),
    select(1.0e30, 1.0 / rd.y, abs(rd.y) > 1.0e-10),
    select(1.0e30, 1.0 / rd.z, abs(rd.z) > 1.0e-10),
  );
  if (U.nodeCount == 0u) {
    return hit;
  }
  var stack : array<u32, STACK_MAX>;
  var stackPtr : i32 = 0;
  stack[stackPtr] = 0u;
  stackPtr = stackPtr + 1;
  loop {
    if (stackPtr == 0) { break; }
    stackPtr = stackPtr - 1;
    let nodeIdx = stack[stackPtr];
    if (nodeIdx >= U.nodeCount) { continue; }
    let node = bvhNodes[nodeIdx];
    let t = rayAABB(ro, invRd, node.bMin, node.bMax, hit.t);
    if (t < 0.0) { continue; }
    let isLeaf = (node.flagsCount & 0x80000000u) != 0u;
    if (isLeaf) {
      let count  = node.flagsCount & 0x7FFFFFFFu;
      let offset = node.rightOrOffset;
      for (var i : u32 = 0u; i < count; i = i + 1u) {
        let triIdx = offset + i;
        let i0 = triIndices[triIdx * 3u + 0u];
        let i1 = triIndices[triIdx * 3u + 1u];
        let i2 = triIndices[triIdx * 3u + 2u];
        let v0 = fetchPosition(i0);
        let v1 = fetchPosition(i1);
        let v2 = fetchPosition(i2);
        let r = rayTriangle(ro, rd, v0, v1, v2);
        if (r.w > 0.0 && r.x < hit.t) {
          hit.t = r.x;
          hit.triIndex = triIdx;
          hit.normal = normalize(cross(v1 - v0, v2 - v0));
          hit.hit = true;
        }
      }
    } else {
      // Inner: left child is nodeIdx + 1, right is rightOrOffset.
      let leftIdx  = nodeIdx + 1u;
      let rightIdx = node.rightOrOffset;
      if (stackPtr < i32(STACK_MAX) - 1) {
        stack[stackPtr] = rightIdx; stackPtr = stackPtr + 1;
      }
      if (stackPtr < i32(STACK_MAX) - 1) {
        stack[stackPtr] = leftIdx;  stackPtr = stackPtr + 1;
      }
    }
  }
  return hit;
}

// ------------------------------------------------------------------ Hemisphere sampling

fn cosineHemisphere(n : vec3<f32>, rngState : ptr<function, u32>) -> vec3<f32> {
  let u1 = randFloat(rngState);
  let u2 = randFloat(rngState);
  let r = sqrt(u1);
  let phi = 6.2831853 * u2;
  let x = r * cos(phi);
  let y = r * sin(phi);
  let z = sqrt(max(0.0, 1.0 - u1));
  var up : vec3<f32>;
  if (abs(n.y) > 0.99) { up = vec3<f32>(1.0, 0.0, 0.0); } else { up = vec3<f32>(0.0, 1.0, 0.0); }
  let t = normalize(cross(up, n));
  let b = cross(n, t);
  return normalize(t * x + b * y + n * z);
}

// ------------------------------------------------------------------ Sky model

fn sampleSky(dir : vec3<f32>) -> vec3<f32> {
  let t = 0.5 * (dir.y + 1.0);
  return mix(vec3<f32>(1.0, 0.7, 0.5), vec3<f32>(0.5, 0.7, 1.0), t);
}

// ------------------------------------------------------------------ Camera

fn primaryRay(pix : vec2<u32>, rngState : ptr<function, u32>) -> vec3<f32> {
  let jitterU = randFloat(rngState);
  let jitterV = randFloat(rngState);
  let u = (f32(pix.x) + jitterU) / f32(U.width);
  let v = (f32(pix.y) + jitterV) / f32(U.height);
  // NDC to world: unproject (u, v, 1) — WebGPU NDC y points up; pixel y
  // points down, so flip v.
  let ndc = vec4<f32>(u * 2.0 - 1.0, (1.0 - v) * 2.0 - 1.0, 1.0, 1.0);
  let world = U.cameraInverseViewProj * ndc;
  let worldPos = world.xyz / world.w;
  return normalize(worldPos - U.cameraOrigin.xyz);
}

// ------------------------------------------------------------------ GGX (NDF-only weight)
//
// We don't use the full GGX sampling here (would need an importance-
// sampled half-vector with VNDF) — the brief calls for Lambertian +
// GGX shade, so we apply a Fresnel-Schlick weighted GGX specular lobe to
// the direct lighting only. Indirect bounce stays cosine-weighted
// Lambert (brief: 1 bounce).

fn fresnelSchlick(cosTheta : f32, f0 : vec3<f32>) -> vec3<f32> {
  let m = clamp(1.0 - cosTheta, 0.0, 1.0);
  return f0 + (vec3<f32>(1.0) - f0) * pow(m, 5.0);
}

fn ggxD(nDotH : f32, roughness : f32) -> f32 {
  let a = roughness * roughness;
  let a2 = a * a;
  let denom = nDotH * nDotH * (a2 - 1.0) + 1.0;
  return a2 / (3.14159265 * denom * denom + 1.0e-6);
}

// ------------------------------------------------------------------ Entry

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let pix = vec2<u32>(gid.x, gid.y);
  if (pix.x >= U.width || pix.y >= U.height) { return; }
  var rngState : u32 = U.seed
    ^ pcgHash(pix.x * 1973u + pix.y * 9277u + U.sample * 26699u);
  let rd = primaryRay(pix, &rngState);
  let ro = U.cameraOrigin.xyz;
  // Primary ray
  let primary = traceBVH(ro, rd, 1.0e6);
  var radiance : vec3<f32>;
  if (!primary.hit) {
    radiance = sampleSky(rd);
  } else {
    let triMat = triMaterialId[primary.triIndex];
    let matIdx = select(0u, triMat, triMat < U.materialCount);
    let mat = materials[matIdx];
    let albedo   = mat.albedo.rgb;
    let roughness = max(0.04, mat.albedo.a);
    let emissive = mat.emissive.rgb;
    let metalness = clamp(mat.emissive.a, 0.0, 1.0);
    let n = primary.normal;
    let nf = select(-n, n, dot(n, -rd) > 0.0);
    let hitPos = ro + rd * primary.t + nf * 1.0e-4;
    // Direct light: hard-coded sun.
    let sunDir = normalize(vec3<f32>(0.4, 0.8, 0.3));
    let sunCol = vec3<f32>(2.5, 2.4, 2.2);
    let h = normalize(sunDir + (-rd));
    let nDotL = max(dot(nf, sunDir), 0.0);
    let nDotH = max(dot(nf, h), 0.0);
    let f0 = mix(vec3<f32>(0.04), albedo, metalness);
    let F = fresnelSchlick(max(dot(h, -rd), 0.0), f0);
    let D = ggxD(nDotH, roughness);
    let specular = F * D * 0.25;
    let lambert = albedo * (1.0 - metalness) / 3.14159265;
    // Shadow ray for direct lighting.
    let shadow = traceBVH(hitPos, sunDir, 1.0e6);
    let visibility = select(1.0, 0.0, shadow.hit);
    radiance = emissive + (lambert + specular) * sunCol * nDotL * visibility;
    // One bounce — cosine-weighted hemisphere.
    if (U.maxBounces > 0u) {
      let bounceDir = cosineHemisphere(nf, &rngState);
      let bounce = traceBVH(hitPos, bounceDir, 1.0e6);
      var bounceL : vec3<f32>;
      if (!bounce.hit) {
        bounceL = sampleSky(bounceDir);
      } else {
        let bTriMat = triMaterialId[bounce.triIndex];
        let bMatIdx = select(0u, bTriMat, bTriMat < U.materialCount);
        let bMat = materials[bMatIdx];
        bounceL = bMat.emissive.rgb + bMat.albedo.rgb * sampleSky(bounceDir) * 0.5;
      }
      radiance = radiance + albedo * bounceL;
    }
  }
  // Read-modify-write the accumulation texture. WebGPU storage textures
  // don't support read-write rgba16float bound to the same view on all
  // backends, so the JS side handles the running mean — we just output
  // this sample's contribution and let the host blend.
  textureStore(output, vec2<i32>(i32(pix.x), i32(pix.y)), vec4<f32>(radiance, 1.0));
}
`;

export default PT_WGSL;
