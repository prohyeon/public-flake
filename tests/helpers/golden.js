// Golden recordings of current behavior. A refactor must not change them; regenerate only for an
// intentional behavior change with `UPDATE_GOLDEN=1 npm test` and review the diff.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GOLDEN_DIR = new URL('../golden/', import.meta.url);

export function assertGolden(name, actual) {
    const fileUrl = new URL(`${name}.json`, GOLDEN_DIR);
    const filePath = fileURLToPath(fileUrl);
    const normalized = JSON.parse(JSON.stringify(actual));

    if (process.env.UPDATE_GOLDEN === '1') {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
        return;
    }

    assert.ok(existsSync(filePath), `golden ${name}.json is missing; create it with UPDATE_GOLDEN=1`);
    const expected = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.deepEqual(normalized, expected, `behavior differs from golden ${name}.json`);
}
