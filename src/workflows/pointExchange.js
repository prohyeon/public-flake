import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { extractHeaders } from '../utils/auth.js';
import { log as defaultLog } from '../ui/logger.js';
import { setButtonState } from '../ui/progress.js';
import {
    createPointExchangePlan,
    exchangeFlakeForPoints,
    extractBillFlakeBalance,
    getBillFlakeBalance,
    getPointExchangeRate
} from '../api/pointExchange.js';

function formatNumber(value) {
    return Number(value).toLocaleString('ko-KR');
}

function getExchangeErrorMessage(code, fallback) {
    const messages = {
        55002: '플레이크 잔액이 부족합니다',
        55018: '최저 전환 금액보다 작습니다',
        55019: '최대 전환 금액을 초과했습니다',
        55021: '플레이크 사용 일일 한도를 초과했습니다',
        55022: '플레이크 사용 월간 한도를 초과했습니다',
        55024: '포인트 적립 일일 한도를 초과했습니다',
        55025: '포인트 적립 월간 한도를 초과했습니다'
    };

    return messages[code] || fallback || '알 수 없는 오류';
}

export async function exchangeConfiguredPoints(headers, deps = {}) {
    const {
        getBillFlakeBalance: fetchBalance = getBillFlakeBalance,
        getPointExchangeRate: fetchRate = getPointExchangeRate,
        exchangeFlakeForPoints: postExchange = exchangeFlakeForPoints,
        log = defaultLog
    } = deps;

    if (!CONFIG.pointExchange.enabled) {
        log('⏭️ 포인트 교환 기능이 비활성화되어 있습니다', 'info');
        return { success: false, reason: 'disabled' };
    }

    const targetPoints = CONFIG.pointExchange.pointAmount;
    const expectedFlake = CONFIG.pointExchange.requiredFlakeAmount;

    log(`💱 ${targetPoints} 포인트 교환 준비 중...`, 'info');

    const balanceResponse = await fetchBalance(headers);
    const availableFlake = extractBillFlakeBalance(balanceResponse);
    if (availableFlake !== null) {
        log(`  💎 현재 보유: ${formatNumber(availableFlake)} FLAKE`, 'info');
    }

    const rateResponse = await fetchRate(headers);
    if (!rateResponse || rateResponse.code !== 0 || !rateResponse.value) {
        const message = getExchangeErrorMessage(rateResponse?.code, rateResponse?.message);
        log(`✗ 전환 비율 조회 실패: ${message}`, 'error');
        return { success: false, reason: 'rateLookupFailed', message };
    }

    const plan = createPointExchangePlan(rateResponse.value, CONFIG.pointExchange);
    log(`  ✓ 필요 플레이크: ${formatNumber(plan.fromAmount)} FLAKE`, 'info');

    if (availableFlake !== null && availableFlake < plan.fromAmount) {
        log(
            `✗ 플레이크 부족: ${formatNumber(availableFlake)} / ${formatNumber(plan.fromAmount)} FLAKE`,
            'error'
        );
        return {
            success: false,
            reason: 'insufficientBalance',
            availableFlake,
            requiredFlake: expectedFlake
        };
    }

    const exchangeResult = await postExchange(headers, plan);
    if (!exchangeResult || exchangeResult.code !== 0) {
        const message = getExchangeErrorMessage(exchangeResult?.code, exchangeResult?.message);
        log(`✗ 포인트 교환 실패: ${message}`, 'error');
        return { success: false, reason: 'exchangeFailed', message, code: exchangeResult?.code };
    }

    const exchangedAmount = exchangeResult.value?.exchanged_amount ?? plan.pointAmount;
    const residueFlake = exchangeResult.value?.residue_mileage ?? exchangeResult.value?.residue_flake ?? null;

    log(
        `✓ ${formatNumber(exchangedAmount)} 포인트 교환 완료 (-${formatNumber(plan.fromAmount)} FLAKE)`,
        'success'
    );
    if (residueFlake !== null) {
        log(`  💰 잔여 FLAKE: ${formatNumber(residueFlake)}`, 'info');
    }

    return {
        success: true,
        pointAmount: plan.pointAmount,
        spentFlake: plan.fromAmount,
        exchangedAmount,
        residueFlake
    };
}

export async function runPointExchange() {
    if (state.isRunning) {
        defaultLog('⚠️ 이미 실행 중입니다', 'warning');
        return;
    }

    state.isRunning = true;
    setButtonState(true);

    try {
        const headers = extractHeaders();
        await exchangeConfiguredPoints(headers);
    } catch (error) {
        defaultLog(`✗ 포인트 교환 오류: ${error.message}`, 'error');
    } finally {
        state.isRunning = false;
        setButtonState(false);
    }
}
