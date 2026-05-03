import test from 'node:test';
import assert from 'node:assert/strict';

import {
    AUTOMATION_SIGNAL,
    buildAutomationSignalTitle,
    parseAutomationSignalTitle
} from '../../src/utils/automationSignal.js';

test('buildAutomationSignalTitle prefixes status and preserves base title', () => {
    const title = buildAutomationSignalTitle(
        AUTOMATION_SIGNAL.done,
        '전체 자동화 완료',
        'MY홈 | S1734612972108812'
    );

    assert.equal(
        title,
        '[SG_DONE] 전체 자동화 완료 | MY홈 | S1734612972108812'
    );
});

test('buildAutomationSignalTitle removes old signal before preserving base title', () => {
    const title = buildAutomationSignalTitle(
        AUTOMATION_SIGNAL.running,
        '전체 자동화 실행 중',
        '[SG_DONE] 전체 자동화 완료 | MY홈'
    );

    assert.equal(title, '[SG_RUNNING] 전체 자동화 실행 중 | MY홈');
});

test('parseAutomationSignalTitle detects done and error titles', () => {
    assert.deepEqual(
        parseAutomationSignalTitle('[SG_DONE] 전체 자동화 완료 | MY홈'),
        { status: 'done', message: '전체 자동화 완료' }
    );
    assert.deepEqual(
        parseAutomationSignalTitle('[SG_ERROR] network failed | MY홈'),
        { status: 'error', message: 'network failed' }
    );
});
