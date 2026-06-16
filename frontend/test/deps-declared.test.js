/**
 * deps-declared.test.js — guards the build-break class that took CI red on
 * runs #841–#848 (2026-06-16): `rtgpu/postStack.jsx` imported
 * `@react-three/postprocessing` + `postprocessing`, which were installed
 * LOCALLY but never added to the committed package.json. The lock is
 * gitignored, so CI resolves fresh from package.json and Rollup failed to
 * resolve the import — every commit after the offending one inherited it.
 *
 * This test scans frontend/src for BARE (package) imports and asserts every
 * one is declared in package.json (deps/devDeps/peer/optional) or is a Node
 * builtin. Run: `node test/deps-declared.test.js` (exit 1 on any undeclared).
 */
import fs from 'fs';
import path from 'path';
import { builtinModules } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const declared = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
]);
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

// package name from a specifier: '@scope/name/sub' -> '@scope/name'; 'name/sub' -> 'name'
function pkgName(spec) {
  const clean = spec.split('?')[0];
  if (clean.startsWith('@')) return clean.split('/').slice(0, 2).join('/');
  return clean.split('/')[0];
}
function isBare(spec) {
  return spec && !spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('\0') && !spec.startsWith('virtual:') && !spec.startsWith('data:');
}

// Statement-anchored patterns so the word "import" INSIDE a string literal
// (e.g. `id: 'import', label: '…'`) is never mistaken for an import.
const SPEC_RES = [
  /^\s*import\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gm,   // import x from 'pkg'
  /^\s*export\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gm,   // export … from 'pkg'
  /^\s*import\s*['"]([^'"]+)['"]/gm,                  // side-effect import 'pkg'
  /\bimport\s*\(\s*['"]([^'"]+)['"]/g,               // dynamic import('pkg')
  /\brequire\s*\(\s*['"]([^'"]+)['"]/g,              // require('pkg')
];
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(jsx?|mjs|cjs|tsx?)$/.test(e.name)) files.push(p);
  }
})(SRC);

const missing = new Map(); // pkg -> Set(files)
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  for (const re of SPEC_RES) {
    let m;
    while ((m = re.exec(text))) {
      const spec = m[1];
      if (!isBare(spec) || spec.startsWith('node:')) continue;
      const name = pkgName(spec);
      if (builtins.has(name) || declared.has(name)) continue;
      if (!missing.has(name)) missing.set(name, new Set());
      missing.get(name).add(path.relative(ROOT, f));
    }
  }
}

console.log(`🧪 deps-declared: scanned ${files.length} source files; ${declared.size} declared packages.`);
if (missing.size === 0) {
  console.log('✅ Every bare import is declared in package.json.');
  process.exit(0);
}
console.error(`\n❌ ${missing.size} imported package(s) NOT declared in package.json (CI will fail to resolve):`);
for (const [name, fset] of missing) {
  console.error(`   - "${name}"  ← ${[...fset].slice(0, 3).join(', ')}${fset.size > 3 ? ` (+${fset.size - 3} more)` : ''}`);
}
console.error('\nAdd each to frontend/package.json dependencies (pin exact, lock is gitignored), then re-run.');
process.exit(1);
