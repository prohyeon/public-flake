import { state } from '../state.js';

function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function emptyState(panel, tone, title, description) {
    const box = element('div', `stove-sf-empty stove-sf-empty--${tone}`);
    const icon = element('span', 'stove-sf-empty-icon', tone === 'error' ? '!' : tone === 'loading' ? '↻' : '◇');
    icon.setAttribute('aria-hidden', 'true');
    const content = element('div', 'stove-sf-empty-content');
    content.append(element('strong', '', title));
    if (description) content.append(element('p', '', description));
    box.append(icon, content);
    panel.append(box);
}

function metric(label, value, accent = '') {
    const box = element('div', `stove-sf-metric ${accent}`);
    box.append(element('span', 'stove-sf-metric-label', label), document.createTextNode(' '),
        element('strong', 'stove-sf-metric-value', value));
    return box;
}

function rewardState(reward, status) {
    if (reward.is_received) return { tone: 'received', label: '수령 완료', icon: '✓' };
    if (reward.sold_out) return { tone: 'unavailable', label: '품절', icon: '—' };
    if (status.claimable.some(item => item.item_no === reward.item_no)) return { tone: 'claimable', label: '수령 가능', icon: '↓' };
    if (status.ended) return { tone: 'unavailable', label: '행사 종료', icon: '—' };
    if (status.notStarted) return { tone: 'locked', label: '시작 전', icon: '◇' };
    if (reward.eligible) return { tone: 'unavailable', label: reward.item_type === 'FLAKE' ? '교환 조건 확인' : '상점에서 확인', icon: '!' };
    const remaining = Math.max(0, reward.rewardable_days - status.totalPlayDays);
    return { tone: 'locked', label: remaining > 0 ? `${remaining}일 더 플레이` : '플레이 반영 대기', icon: '◇' };
}

export function renderSpecialForce(status) {
    const panel = document.getElementById('stove-special-force-data');
    const claim = document.getElementById('stove-btn-special-force-claim');
    if (!panel) return;
    panel.replaceChildren();
    if (claim) claim.disabled = true;
    panel.setAttribute('aria-busy', String(Boolean(status.loading)));
    if (status.loading) { emptyState(panel, 'loading', '스페셜포스 서버 상태 확인 중…', '누적 플레이와 보상 수령 현황을 불러오고 있습니다.'); return; }
    if (!status.success) { emptyState(panel, 'error', '확인 실패', status.error || '상태를 불러오지 못했습니다. 새로고침해 주세요.'); return; }
    if (status.notAvailable) { emptyState(panel, 'idle', '현재 공개된 스페셜포스 행사가 없습니다', '새 행사가 공개되면 이곳에서 보상을 확인할 수 있습니다.'); return; }

    const date = value => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul',
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)).replace(/\.\s*/g, '.').replace(/\.$/, '');
    const period = element('div', 'stove-sf-period');
    const dates = element('div', 'stove-sf-dates');
    dates.append(element('span', 'stove-sf-period-label', '행사 기간'),
        element('span', '', `${date(status.start)} ~ ${date(status.end)}`),
        element('span', 'stove-sf-period-length', `${status.periodDays}일 행사`));
    period.append(dates, element('span', `stove-sf-period-badge${status.active ? ' is-active' : ''}`,
        status.notStarted ? '시작 전' : status.ended ? '종료' : `${status.remainingDays}일 남음`));
    panel.append(period);

    const summary = element('div', 'stove-sf-summary');
    const play = metric('누적 플레이', `${status.totalPlayDays}/${status.targetDays}일`);
    const progress = element('div', 'stove-sf-progress');
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-label', '누적 플레이 달성률');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', String(status.targetDays || 1));
    progress.setAttribute('aria-valuenow', String(Math.min(status.totalPlayDays, status.targetDays || 1)));
    progress.setAttribute('aria-valuetext', `${status.totalPlayDays}일 플레이 / 목표 ${status.targetDays}일`);
    const fill = element('span', 'stove-sf-progress-fill');
    fill.style.width = `${status.targetDays > 0 ? Math.min(100, status.totalPlayDays / status.targetDays * 100) : 0}%`;
    progress.append(fill);
    play.append(progress);
    summary.append(play, metric('수령한 보상', `${status.receivedCount}/${status.rewardCount}개`),
        metric('수령 가능', `${status.claimable.length}개`, status.claimable.length > 0 ? 'is-claimable' : ''));
    panel.append(summary);

    const grid = element('div', 'stove-sf-rewards');
    grid.setAttribute('role', 'list');
    grid.setAttribute('aria-label', '누적 플레이 일차별 보상');
    for (const reward of status.rewards) {
        // Decode entity text without inserting server-provided markup into the page.
        const decoder = document.createElement('textarea');
        decoder.innerHTML = String(reward.item_name || '보상').replace(/</g, '&lt;');
        const display = rewardState(reward, status);
        const card = element('div', `stove-sf-reward is-${display.tone}`);
        card.setAttribute('role', 'listitem');
        card.title = decoder.value;
        const heading = element('div', 'stove-sf-reward-heading');
        const icon = element('span', 'stove-sf-reward-icon', display.icon);
        icon.setAttribute('aria-hidden', 'true');
        heading.append(element('span', 'stove-sf-day', `${reward.rewardable_days}일차`), icon);
        const flake = reward.item_type === 'FLAKE' && Number.isFinite(reward.flake_amount);
        const amount = element('strong', 'stove-sf-reward-amount', flake ? reward.flake_amount.toLocaleString('ko-KR') : '게임 아이템');
        if (flake) amount.append(element('span', 'stove-sf-reward-unit', ' F'));
        const bonus = flake ? decoder.value.replace(/^\s*[\d,]+\s*플레이크\s*(?:&|\+|및)\s*/, '') : decoder.value;
        card.append(heading, amount, element('p', 'stove-sf-reward-detail', bonus),
            element('span', 'stove-sf-reward-state', display.label));
        grid.append(card);
    }
    panel.append(grid);
    const note = element('div', 'stove-sf-note');
    note.append(element('span', '', '정상 게임 종료 후 기록 반영에 최대 5분이 걸릴 수 있습니다.'),
        element('span', 'stove-sf-checked', `최근 확인 ${new Date(status.checkedAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' })}`));
    panel.append(note);
    const link = document.getElementById('stove-special-force-link');
    if (link && /^\d{6}$/.test(status.month)) link.href = `https://event.onstove.com/ko/dailyshop/specialforce/${status.month}`;
    if (claim) claim.disabled = status.claimable.length === 0 || state.isRunning;
}
