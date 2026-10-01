export function updateReviewEventStatus(status) {
    const progress = document.getElementById('stove-status-review-event');
    const period = document.getElementById('stove-status-review-period');
    const target = document.getElementById('stove-status-review-target');
    if (!progress || !period || !target) return;
    for (const element of [progress, period, target]) {
        element.replaceChildren();
        element.title = '';
        element.style.color = '#9ca3af';
    }
    if (status.loading) {
        progress.textContent = '⏳ 확인 중...';
        period.textContent = target.textContent = '-';
        return;
    }
    if (!status.success) {
        progress.textContent = '⚠️ 확인 필요';
        progress.style.color = '#ef4444';
        progress.title = status.error || '이벤트 상태 확인 실패';
        period.textContent = target.textContent = '-';
        return;
    }
    const labels = { disabled: '비활성화', noEvent: '진행 중인 대상 없음', upcoming: '시작 전 · 건너뜀',
        expired: '기간 종료 · 건너뜀', inactive: '진행 중 아님 · 건너뜀', completed: '✅ 댓글 등록 완료',
        pending: '⏳ 등록 결과 확인 대기', noPermission: '댓글 작성 권한 없음', ready: '0/1 · 참여 전' };
    progress.textContent = labels[status.reason] || '⚠️ 확인 필요';
    progress.style.color = status.reason === 'completed' ? '#10b981' : status.reason === 'ready' || status.reason === 'pending' ? '#f59e0b' : '#9ca3af';
    if (status.reason === 'completed') progress.title = '댓글 등록을 확인했습니다. 플레이크 지급 여부는 별도 확인이 필요합니다.';
    if (status.reason === 'pending') progress.title = '이전 댓글 요청 결과가 불확실하여 추가 댓글을 작성하지 않습니다.';
    const event = status.event;
    period.textContent = event ? `${event.startDate} ~ ${event.endDate} (한국 시간)` : '-';
    period.title = event ? '이벤트 배너의 노출 기간을 자동화 실행 조건으로 사용합니다.' : '';
    if (event && /^https:\/\/page\.onstove\.com\/quarter\/kr\/view\/\d+$/.test(event.url)) {
        const link = document.createElement('a');
        link.href = event.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.color = '#93c5fd';
        link.textContent = status.articleTitle || '대상 게임 리뷰';
        target.appendChild(link);
    } else target.textContent = '-';
}
