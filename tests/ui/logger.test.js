import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeHtmlEntities, formatLogEntry } from '../../src/ui/logger.js';

test('decodeHtmlEntities decodes named and numeric entities and leaves unknown ones', () => {
    assert.equal(decodeHtmlEntities('1,000 플레이크 &amp; 아우루 5,000'), '1,000 플레이크 & 아우루 5,000');
    assert.equal(decodeHtmlEntities('&lt;b&gt; &quot;a&quot; &#39;b&#39; &#x26;'), '<b> "a" \'b\' &');
    assert.equal(decodeHtmlEntities('&unknown; &#0; R&D'), '&unknown; &#0; R&D');
    assert.equal(decodeHtmlEntities(42), '42');
});

test('formatLogEntry adds the type icon only when the message has no icon of its own', () => {
    assert.equal(formatLogEntry('완료', 'success'), '✓ 완료');
    assert.equal(formatLogEntry('✓ 헤더 정보 추출 완료', 'success'), '✓ 헤더 정보 추출 완료');
    assert.equal(formatLogEntry('✅ 데일리 미션 처리 완료!', 'success'), '✅ 데일리 미션 처리 완료!');
    assert.equal(formatLogEntry('⏳ 경품 응모 진행 중...', 'info'), '⏳ 경품 응모 진행 중...');
    assert.equal(formatLogEntry('⚠️ 점검 모드', 'warning'), '⚠️ 점검 모드');
    assert.equal(formatLogEntry('🎰 룰렛', 'info'), '⏳ 🎰 룰렛');
    assert.equal(formatLogEntry('A &amp; B'), '⏳ A & B');
});
