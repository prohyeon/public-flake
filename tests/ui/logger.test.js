import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeHtmlEntities, formatLogEntry, timingText } from '../../src/ui/logger.js';

test('decodeHtmlEntities decodes named and numeric entities and leaves unknown ones', () => {
    assert.equal(decodeHtmlEntities('1,000 플레이크 &amp; 아우루 5,000'), '1,000 플레이크 & 아우루 5,000');
    assert.equal(decodeHtmlEntities('&lt;b&gt; &quot;a&quot; &#39;b&#39; &#x26;'), '<b> "a" \'b\' &');
    assert.equal(decodeHtmlEntities('&unknown; &#0; R&D'), '&unknown; &#0; R&D');
    assert.equal(decodeHtmlEntities(42), '42');
});

test('formatLogEntry shows plain text: no icon prefix, no emoji, timing markers removed', () => {
    assert.equal(formatLogEntry('완료', 'success'), '완료');
    assert.equal(formatLogEntry('✅ 데일리 미션 처리 완료!', 'success'), '데일리 미션 처리 완료!');
    assert.equal(formatLogEntry('  📋 리워드샵 페이지 방문 중...', 'info'), '  리워드샵 페이지 방문 중...');
    assert.equal(formatLogEntry('A &amp; B'), 'A & B');
    assert.equal(formatLogEntry(`그룹 완료: visits (4/4)${timingText(' · 0.1초')}`), '그룹 완료: visits (4/4) · 0.1초');
});
