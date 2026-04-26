import { delay } from './time.js';

export function openTabInBackground(url, active = false) {
    if (typeof GM_openInTab === 'undefined') {
        console.warn('[Tab] GM_openInTab not available, using window.open');
        return window.open(url, '_blank');
    }
    const tab = GM_openInTab(url, { active, insert: true, setParent: true });
    console.log(`[Tab] ${active ? '포커스' : '백그라운드'}로 탭 열림: ${url}`);
    return tab;
}

export function closeTab(tabs) {
    if (!tabs) {
        console.warn('[Tab] 닫을 탭이 없습니다');
        return 0;
    }

    const tabArray = Array.isArray(tabs) ? tabs : [tabs];
    let closedCount = 0;

    tabArray.forEach((tab, index) => {
        try {
            if (tab && typeof tab.close === 'function') {
                tab.close();
                closedCount++;
                console.log(`[Tab] 탭 ${index + 1} 닫힘`);
            } else if (tab && typeof tab === 'object') {
                console.warn(`[Tab] 탭 ${index + 1}은 close() 메서드가 없습니다`);
            }
        } catch (e) {
            console.error(`[Tab] 탭 ${index + 1} 닫기 실패:`, e.message);
        }
    });

    console.log(`[Tab] 총 ${closedCount}/${tabArray.length}개 탭 닫힘`);
    return closedCount;
}

export async function closeTabAfterDelay(tabs, delayMs = 3000) {
    console.log(`[Tab] ${delayMs}ms 후 탭 닫기 예약됨`);
    await delay(delayMs);
    return closeTab(tabs);
}
