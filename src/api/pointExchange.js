import { CONFIG } from '../config.js';
import { apiRequest } from './request.js';

function getPointExchangeConfig(overrides = {}) {
    return { ...CONFIG.pointExchange, ...overrides };
}

function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

export function makePointExchangeHeaders(headers) {
    return {
        Authorization: headers.Authorization || headers.authorization,
        'caller-id': 'billuser',
        Accept: 'application/json',
        'Content-Type': 'application/json'
    };
}

export function buildPointExchangeRateUrl(configOverrides = {}) {
    const config = getPointExchangeConfig(configOverrides);
    const params = new URLSearchParams({
        from_use_rule_id: config.fromUseRuleId,
        to_deposit_rule_id: config.toDepositRuleId,
        client_id: config.clientId
    });

    return `${CONFIG.api.baseUrl}/mileage/v1.0/exchange?${params.toString()}`;
}

export function buildBillFlakeBalanceUrl(configOverrides = {}) {
    const config = getPointExchangeConfig(configOverrides);
    const params = new URLSearchParams({
        client_id: config.clientId,
        use_rule_id: config.fromUseRuleId
    });

    return `${CONFIG.api.baseUrl}/mileage/v1.0/balance?${params.toString()}`;
}

export function calculateRequiredFlake(pointAmount, exchangeRate) {
    const fromAmount = numberOrNull(exchangeRate?.from_amount);
    const toAmount = numberOrNull(exchangeRate?.to_amount);
    const targetPoints = numberOrNull(pointAmount);

    if (!targetPoints || !fromAmount || !toAmount) {
        throw new Error('Invalid point exchange rate');
    }

    const requiredFlake = targetPoints * (fromAmount / toAmount);
    if (!Number.isInteger(requiredFlake)) {
        throw new Error('Point exchange amount must resolve to a whole flake amount');
    }

    return requiredFlake;
}

export function createPointExchangePlan(exchangeRate, configOverrides = {}) {
    const config = getPointExchangeConfig(configOverrides);
    const pointAmount = numberOrNull(config.pointAmount);
    const minAmount = numberOrNull(exchangeRate?.min_exchange_amount);
    const maxAmount = numberOrNull(exchangeRate?.max_exchange_amount);
    const exchangeId = numberOrNull(exchangeRate?.exchange_id);

    if (!pointAmount || !exchangeId) {
        throw new Error('Invalid point exchange target');
    }
    if (minAmount !== null && pointAmount < minAmount) {
        throw new Error(`Target point amount is below minimum exchange amount ${minAmount}`);
    }
    if (maxAmount !== null && pointAmount > maxAmount) {
        throw new Error(`Target point amount exceeds maximum exchange amount ${maxAmount}`);
    }

    const fromAmount = calculateRequiredFlake(pointAmount, exchangeRate);
    const expectedFlake = numberOrNull(config.requiredFlakeAmount);
    if (expectedFlake !== null && fromAmount !== expectedFlake) {
        throw new Error(`Expected ${expectedFlake} flake but exchange rate requires ${fromAmount}`);
    }

    return { exchangeId, pointAmount, fromAmount };
}

export function buildPointExchangePayload({ exchangeId, fromAmount }, configOverrides = {}) {
    const config = getPointExchangeConfig(configOverrides);

    return {
        client_id: config.clientId,
        exchange_id: Number(exchangeId),
        from_amount: Number(fromAmount),
        descriptions: config.description
    };
}

export function extractBillFlakeBalance(response) {
    const balance = numberOrNull(response?.value?.mileage_amount);
    return balance === null ? null : balance;
}

export async function getPointExchangeRate(headers) {
    return apiRequest(buildPointExchangeRateUrl(), 'GET', makePointExchangeHeaders(headers));
}

export async function getBillFlakeBalance(headers) {
    return apiRequest(buildBillFlakeBalanceUrl(), 'GET', makePointExchangeHeaders(headers));
}

export async function exchangeFlakeForPoints(headers, plan) {
    const url = `${CONFIG.api.baseUrl}/mileage/v1.0/exchange/point`;
    const payload = buildPointExchangePayload(plan);

    return apiRequest(url, 'POST', makePointExchangeHeaders(headers), payload);
}
