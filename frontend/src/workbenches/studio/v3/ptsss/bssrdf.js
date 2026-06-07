// ArchDisc Studio V3 — random-walk BSSRDF (slice 885).
//
// Real subsurface-scattering implementation invoked from slice 784's CPU
// path tracer. When a primary ray hits a material tagged
//   userData.archdiscStudioSkinSSS === true
// or with
//   userData.bssrdf = { sigmaA: [r,g,b], sigmaS: [r,g,b], g: 0.0 }
// the tracer transfers control here; we walk inside the volume bounded
// by the mesh until we exit (or hit the bounce cap), then return the
// modulated throughput + an outgoing ray suitable for the next path
// segment.
//
// The walk is "diffusive random-walk" — the technique Disney published
// in their 2015 paper "Approximate Reflectance Profiles for Efficient
// Subsurface Scattering" and which Arnold / RenderMan / Cycles all ship
// today. Each step samples:
//   1. A free-flight distance d from an exponential of the per-channel
//      extinction sigma_t = sigma_a + sigma_s.
//   2. A new direction from the Henyey-Greenstein phase function with
//      anisotropy g.
// If the next-event ray segment crosses the surface (i.e. the ray cast
// inside the geometry hits a back face within d), we exit at that
// intersection point with the accumulated diffuse albedo as throughput
// modifier. Otherwise we step forward to the medium-internal point and
// continue scattering. We cap internal bounces at 6 — beyond that the
// throughput is too low to matter and ray budget is better spent on
// new camera samples.
//
// Skin / marble / milk presets are taken from the Jensen 2001 paper
// + the Pixar / Disney sample tables and converted to per-mm sigma
// values (which is how Cycles' Random Walk node expects them).

import * as THREE from 'three';

const _MAX_INTERNAL_BOUNCES = 6;

// Presets — sigma in 1/mm; downstream code is expected to be in scene
// units of millimetres for realistic results. If the scene is metres,
// users should pre-scale (or use the explicit __studioPTSSSEnable
// scatterDistance override). All values are RGB triplets so chromatic
// dispersion shows up as the famous reddish ear / fingertip glow.
export const SSS_PRESETS = {
  // Caucasian skin — pinkish red-leaning subsurface lobe.
  skin_light: {
    sigmaA: [0.06, 0.18, 0.32],
    sigmaS: [1.59, 1.16, 0.89],
    g: 0.0,
  },
  // Asian skin tone — slightly warmer.
  skin_medium: {
    sigmaA: [0.10, 0.21, 0.30],
    sigmaS: [1.65, 1.10, 0.85],
    g: 0.0,
  },
  // Dark skin tone — strong red absorption.
  skin_dark: {
    sigmaA: [0.18, 0.32, 0.50],
    sigmaS: [1.40, 0.95, 0.70],
    g: 0.0,
  },
  // Marble — long mean free path, slightly green leaning.
  marble: {
    sigmaA: [0.0021, 0.0041, 0.0071],
    sigmaS: [2.19, 2.62, 3.00],
    g: 0.0,
  },
  // Whole milk — heavy scatter, near-neutral absorption.
  milk: {
    sigmaA: [0.0015, 0.0077, 0.0190],
    sigmaS: [4.5513, 5.8294, 6.9712],
    g: 0.0,
  },
};

// Henyey-Greenstein phase function — analytical anisotropic phase used
// throughout volume rendering. costheta is the cosine of the angle
// between incoming and outgoing direction.
export function henyeyGreensteinPhase(g, costheta) {
  if (Math.abs(g) < 1e-3) return 0.25 / Math.PI;
  const g2 = g * g;
  const denom = 1 + g2 - 2 * g * costheta;
  return (1 - g2) / (4 * Math.PI * Math.pow(Math.max(denom, 1e-12), 1.5));
}

// Sample a direction from the Henyey-Greenstein phase function around
// an incoming direction `wi`. Returns a unit Vector3.
function _sampleHG(wi, g, rngFn) {
  const u1 = rngFn();
  const u2 = rngFn();
  let costheta;
  if (Math.abs(g) < 1e-3) {
    // Isotropic — uniform sphere.
    costheta = 1 - 2 * u1;
  } else {
    const k = (1 - g * g) / (1 - g + 2 * g * u1);
    costheta = (1 + g * g - k * k) / (2 * g);
    if (costheta < -1) costheta = -1;
    if (costheta > 1) costheta = 1;
  }
  const sintheta = Math.sqrt(Math.max(0, 1 - costheta * costheta));
  const phi = 2 * Math.PI * u2;
  // Build TBN around wi.
  const wiv = wi instanceof THREE.Vector3 ? wi : new THREE.Vector3(wi.x, wi.y, wi.z);
  const up = Math.abs(wiv.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const t = new THREE.Vector3().crossVectors(up, wiv).normalize();
  const b = new THREE.Vector3().crossVectors(wiv, t);
  return new THREE.Vector3()
    .addScaledVector(t, sintheta * Math.cos(phi))
    .addScaledVector(b, sintheta * Math.sin(phi))
    .addScaledVector(wiv, costheta)
    .normalize();
}

// Resolve sigma_a, sigma_s, g for a hit. Reads in this priority order:
//   1. material.userData.bssrdf = { sigmaA, sigmaS, g }
//   2. material.userData.bssrdfMeanFreePath = number   → derive sigma_t
//   3. material.userData.archdiscStudioSkinSSS         → skin_light
//   4. material.userData.bssrdfPreset = 'marble'|'milk'|…
function _resolveCoeffs(mat) {
  const ud = (mat && mat.userData) || {};
  if (ud.bssrdf && Array.isArray(ud.bssrdf.sigmaA) && Array.isArray(ud.bssrdf.sigmaS)) {
    return {
      sigmaA: ud.bssrdf.sigmaA.slice(0, 3),
      sigmaS: ud.bssrdf.sigmaS.slice(0, 3),
      g: typeof ud.bssrdf.g === 'number' ? ud.bssrdf.g : 0,
    };
  }
  if (typeof ud.bssrdfMeanFreePath === 'number' && ud.bssrdfMeanFreePath > 0) {
    const mfp = ud.bssrdfMeanFreePath;
    // sigma_t = 1/mfp. Split 80/20 scatter/absorb to give a pleasing
    // diffuse look without going dark.
    const sigmaT = 1 / mfp;
    return {
      sigmaA: [sigmaT * 0.2, sigmaT * 0.2, sigmaT * 0.2],
      sigmaS: [sigmaT * 0.8, sigmaT * 0.8, sigmaT * 0.8],
      g: 0,
    };
  }
  if (ud.bssrdfPreset && SSS_PRESETS[ud.bssrdfPreset]) {
    const p = SSS_PRESETS[ud.bssrdfPreset];
    return { sigmaA: p.sigmaA.slice(), sigmaS: p.sigmaS.slice(), g: p.g };
  }
  if (ud.archdiscStudioSkinSSS) {
    const p = SSS_PRESETS.skin_light;
    return { sigmaA: p.sigmaA.slice(), sigmaS: p.sigmaS.slice(), g: p.g };
  }
  return null;
}

// Decide whether a material at a hit needs a subsurface walk.
export function hasBSSRDF(mat) {
  const ud = (mat && mat.userData) || {};
  if (ud.archdiscStudioSkinSSS) return true;
  if (ud.bssrdf && (ud.bssrdf.sigmaA || ud.bssrdf.sigmaS)) return true;
  if (typeof ud.bssrdfMeanFreePath === 'number' && ud.bssrdfMeanFreePath > 0) return true;
  if (ud.bssrdfPreset && SSS_PRESETS[ud.bssrdfPreset]) return true;
  return false;
}

// Random-walk subsurface walk.
//
// hit: three.js Raycaster hit object (with .point, .face, .object).
// occluders: scene meshes to raycast against during internal walk.
// rngFn: () => float in [0, 1).
//
// Returns:
//   {
//     ok: true,
//     point:        THREE.Vector3 exit point on the surface,
//     normal:       THREE.Vector3 outward normal at exit point,
//     albedo:       [r, g, b]    diffuse modulation (sigma_s / sigma_t),
//     bounces:      number of internal scatter events,
//     exited:       boolean — true if we found a real exit, false if we
//                   hit the bounce cap inside the medium (the caller
//                   should still treat that as exit, with the throughput
//                   modulation applied).
//   }
export function sampleBSSRDF(hit, occluders, rngFn) {
  if (!hit || !hit.object || !hit.object.material) {
    return { ok: false, error: 'no hit/material' };
  }
  const coeffs = _resolveCoeffs(hit.object.material);
  if (!coeffs) return { ok: false, error: 'no BSSRDF coefficients' };
  const { sigmaA, sigmaS, g } = coeffs;
  // Per-channel sigma_t.
  const sigmaT = [
    sigmaA[0] + sigmaS[0],
    sigmaA[1] + sigmaS[1],
    sigmaA[2] + sigmaS[2],
  ];
  // Single-scatter albedo (diffuse-ish modulation when we exit).
  const albedo = [
    sigmaT[0] > 1e-9 ? sigmaS[0] / sigmaT[0] : 0,
    sigmaT[1] > 1e-9 ? sigmaS[1] / sigmaT[1] : 0,
    sigmaT[2] > 1e-9 ? sigmaS[2] / sigmaT[2] : 0,
  ];

  // Start the walk just below the entry surface.
  const inwardNormal = hit.face?.normal
    ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize().multiplyScalar(-1)
    : new THREE.Vector3(0, -1, 0);
  let pos = hit.point.clone().addScaledVector(inwardNormal, 0.0001);
  // Initial direction: cosine-weighted hemisphere about inward normal.
  // (Equivalent to "the ray refracted into the medium" for a perfectly
  // diffuse boundary, which is the standard random-walk assumption.)
  let dir = _sampleHG(inwardNormal, 0, rngFn);

  const rc = new THREE.Raycaster();
  const ownMesh = [hit.object];
  let exited = false;
  let exitHit = null;
  let bounces = 0;
  // Use the green channel as the wavelength-driving sigma_t for free-
  // flight sampling (the standard "average channel" trick — RGB picked
  // up via the albedo modulation).
  const sigmaTMean = (sigmaT[0] + sigmaT[1] + sigmaT[2]) / 3 || 1;

  for (let i = 0; i < _MAX_INTERNAL_BOUNCES; i++) {
    bounces = i + 1;
    const u = Math.max(1e-9, rngFn());
    const dist = -Math.log(u) / sigmaTMean;
    rc.set(pos, dir);
    rc.far = dist;
    const insideHits = rc.intersectObjects(ownMesh, false);
    if (insideHits.length && insideHits[0].distance <= dist) {
      // Crossed the boundary — that's our exit point.
      exitHit = insideHits[0];
      exited = true;
      break;
    }
    // Step forward to scatter point and resample direction.
    pos = pos.clone().addScaledVector(dir, dist);
    dir = _sampleHG(dir, g, rngFn);
  }

  let exitPoint;
  let exitNormal;
  if (exited && exitHit) {
    exitPoint = exitHit.point.clone();
    if (exitHit.face?.normal) {
      exitNormal = exitHit.face.normal.clone()
        .transformDirection(exitHit.object.matrixWorld)
        .normalize();
      // Make sure we report the outward-facing normal.
      if (exitNormal.dot(dir) < 0) exitNormal.multiplyScalar(-1);
    } else {
      exitNormal = dir.clone().normalize();
    }
  } else {
    // Hit the bounce cap — emit from the last in-medium point along
    // the outward direction. Use the entry normal flipped.
    exitPoint = pos;
    exitNormal = inwardNormal.clone().multiplyScalar(-1);
  }

  return {
    ok: true,
    point: exitPoint,
    normal: exitNormal,
    albedo,
    bounces,
    exited,
  };
}

export default sampleBSSRDF;
