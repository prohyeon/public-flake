// Full pre-merge check: syntax, then every test. Bundle-level tests build the userscript from the
// current src (tests/helpers/bundle.js), so src/main.js and the panel are checked before any release.
// Finally report whether the committed, auto-updating bundle still matches src; it is expected to lag
// behind until the next release rebuilds it.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function run(label, args) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\n✗ ${label} failed`);
    process.exit(result.status ?? 1);
  }
}

run('syntax check', ['scripts/check-syntax.mjs']);
run('tests (bundle tests use a fresh build of src)', ['--test', 'tests/**/*.test.js']);

const outDir = mkdtempSync(join(tmpdir(), 'stove-verify-'));
try {
  run('release bundle comparison build', ['node_modules/vite/bin/vite.js', 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn']);
  // git may check the bundle out with CRLF (core.autocrlf); the served blob keeps LF like the build.
  const lf = text => text.replace(/\r\n/g, '\n');
  const fresh = lf(readFileSync(join(outDir, 'stove-quest-automation.user.js'), 'utf8'));
  const committed = lf(readFileSync('stove-quest-automation.user.js', 'utf8'));
  console.log(fresh === committed
    ? '\nℹ committed bundle matches src'
    : '\nℹ committed bundle differs from src (expected until the next release rebuilds it)');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
console.log('\n✓ verify passed');
