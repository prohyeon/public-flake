// Full pre-merge check: syntax, unit/characterization tests, then a fresh build whose bundle is
// run through the bundle-level tests. src/main.js is only exercised through the bundle, so this
// catches regressions there before the committed (auto-updating) bundle is touched.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BUNDLE_TESTS = [
  'tests/releaseMetadata.test.js',
  'tests/userscriptMetadata.test.js',
  'tests/ui/userscriptMount.test.js',
  'tests/ui/boostUserscript.test.js',
  'tests/ui/panel.characterization.test.js'
];

function run(label, args, env = process.env) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env });
  if (result.status !== 0) {
    console.error(`\n✗ ${label} failed`);
    process.exit(result.status ?? 1);
  }
}

const outDir = mkdtempSync(join(tmpdir(), 'stove-verify-'));
try {
  run('syntax check', ['scripts/check-syntax.mjs']);
  run('tests (committed bundle)', ['--test', 'tests/**/*.test.js']);
  run('fresh build', ['node_modules/vite/bin/vite.js', 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn']);
  run('bundle tests (fresh build)', ['--test', ...BUNDLE_TESTS], {
    ...process.env,
    BUNDLE_PATH: join(outDir, 'stove-quest-automation.user.js')
  });
  console.log('\n✓ verify passed');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
