import { spawnSync } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const projectRoot = process.cwd();
const syntaxExtensions = new Set(['.js', '.mjs', '.cjs']);
const roots = ['src', 'tests', 'scripts'];
const rootFiles = ['vite.config.js'];

function hasSyntaxExtension(filePath) {
  return syntaxExtensions.has(filePath.slice(filePath.lastIndexOf('.')));
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function collectSyntaxFiles(dirPath, files = []) {
  let entries;

  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return files;
    throw error;
  }

  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name);

    if (entry.isDirectory()) {
      await collectSyntaxFiles(entryPath, files);
    } else if (entry.isFile() && hasSyntaxExtension(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

const files = [];

for (const root of roots) {
  await collectSyntaxFiles(join(projectRoot, root), files);
}

for (const rootFile of rootFiles) {
  const filePath = join(projectRoot, rootFile);
  if (await pathExists(filePath)) files.push(filePath);
}

const uniqueFiles = [...new Set(files)].sort((a, b) => a.localeCompare(b));
const failures = [];

for (const filePath of uniqueFiles) {
  const result = spawnSync(process.execPath, ['--check', filePath], {
    cwd: projectRoot,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    failures.push({
      filePath,
      output: `${result.stdout}${result.stderr}`.trim()
    });
  }
}

if (failures.length > 0) {
  console.error(`Syntax check failed: ${failures.length} of ${uniqueFiles.length} files failed.`);

  for (const failure of failures) {
    console.error(`\n${relative(projectRoot, failure.filePath)}`);
    if (failure.output) console.error(failure.output);
  }

  process.exit(1);
}

console.log(`Syntax check passed: ${uniqueFiles.length} files checked.`);
