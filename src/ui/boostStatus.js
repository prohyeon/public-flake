export function updateBoostStatus(status) {
    const progress = document.getElementById('stove-status-boost');
    const reward = document.getElementById('stove-status-boost-reward');
    const selected = document.getElementById('stove-status-boost-target');
    if (!progress || !reward || !selected) return;
    for (const element of [progress, reward, selected]) {
        element.replaceChildren();
        element.title = '';
        element.style.color = '#9ca3af';
    }
    if (status.loading) {
        for (const element of [progress, reward, selected]) element.textContent = '⏳ 확인 중...';
        return;
    }
    if (!status.success) {
        for (const element of [progress, reward, selected]) {
            element.textContent = '⚠️ 확인 실패';
            element.style.color = '#ef4444';
            element.title = status.error || '서버 상태 확인 실패';
        }
        return;
    }
    if (status.notAvailable) {
        progress.textContent = `미션 없음 · 잔여 ${status.remainingCount}회`;
        reward.textContent = '-';
        selected.textContent = '-';
        return;
    }
    const { mission } = status;
    progress.textContent = `${mission.current}/${mission.required} · 잔여 ${status.remainingCount}회`;
    progress.style.color = mission.current >= mission.required ? '#10b981' : '#f59e0b';
    if (status.nextChargeAt) {
        progress.title = `다음 충전: ${new Date(status.nextChargeAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' })}`;
    }
    const amount = mission.rewardAmount.toLocaleString('ko-KR');
    if (mission.rewarded) {
        reward.textContent = `✅ ${amount} F 수령 완료`;
        reward.style.color = '#10b981';
    } else if (status.record?.reward) {
        reward.textContent = '⏳ 보상 수령 상태 확인 대기';
        reward.style.color = '#f59e0b';
    } else if (mission.allCompleted) {
        reward.textContent = `🎁 ${amount} F 수령 가능`;
        reward.style.color = '#f59e0b';
    } else {
        reward.textContent = `조건 진행 중 · ${amount} F`;
    }
    reward.title = mission.details.map(detail => `${detail.label}: ${detail.current_count}/${detail.required_count}`).join('\n');
    if (status.record?.boost && mission.current < mission.required) {
        progress.textContent += ' · 반영 확인 대기';
    }
    if (status.selectedArticle) {
        const article = status.selectedArticle;
        const link = document.createElement('a');
        link.href = `https://lounge.onstove.com/view/${article.articleId}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.color = '#93c5fd';
        link.textContent = `${article.title || article.articleId} · ${article.score}℃`;
        selected.appendChild(link);
        selected.title = status.verificationPending ? '실행 결과 반영 확인 대기' : '마지막 자동화에서 선택한 글과 선택 당시 온도';
    } else {
        selected.textContent = '자동화 실행 후 표시';
    }
}
