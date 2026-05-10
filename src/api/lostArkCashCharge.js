import { CONFIG } from '../config.js';
import { apiRequest } from './request.js';

function getLostArkCashChargeConfig(overrides = {}) {
    return { ...CONFIG.lostArkCashCharge, ...overrides };
}

function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

export function extractBearerToken(headers) {
    const authorization = headers.Authorization || headers.authorization || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : authorization;
}

export function makeLostArkPaymentHeaders(headers) {
    return {
        'Content-Type': 'application/json',
        Authorization: headers.Authorization || headers.authorization,
        'X-Lang': headers['X-Lang'] || headers['x-lang'] || 'ko',
        'X-Nation': headers['X-Nation'] || headers['x-nation'] || 'KR',
        'caller-id': 'bill-payweb',
        'caller-detail': headers['caller-detail'] || headers['X-UUID'] || ''
    };
}

export function buildLostArkPointBalanceUrl(configOverrides = {}) {
    const config = getLostArkCashChargeConfig(configOverrides);
    const params = new URLSearchParams({
        client_id: config.pointClientId,
        use_rule_id: config.pointUseRuleId
    });

    return `${CONFIG.api.baseUrl}/point/v1.0/balance?${params.toString()}`;
}

export function buildLostArkCashChargeUrl(configOverrides = {}) {
    const config = getLostArkCashChargeConfig(configOverrides);
    return `${CONFIG.api.baseUrl}/pay/v1.0/payment/${config.gameCode}/request/direct`;
}

export function buildLostArkPaymentInfoUrl(orderNo) {
    return `${CONFIG.api.baseUrl}/pay/v1.0/payment/info/${orderNo}`;
}

export function buildLostArkPointCashChargePayload({ accessToken }, configOverrides = {}) {
    const config = getLostArkCashChargeConfig(configOverrides);

    return {
        speed_charge_flag: 'Y',
        access_token: accessToken,
        return_url: '',
        is_channeling: false,
        cp_item_id: 0,
        coupon_info: null,
        location_code: '1',
        prod_name: config.productName,
        sales_prod_name: config.productName,
        multi_pay_list: [
            {
                paytool_code: config.pointPaytoolCode,
                pg_code: config.pointPgCode,
                mall_id: config.pointMallId,
                cash_amt: config.cashAmount,
                pay_amt: 0
            }
        ],
        paytool_code: config.paytoolCode,
        pgp_code: config.pgpCode,
        pg_code: config.pgCode,
        mall_id: config.mallId,
        total_pay_amt: config.cashAmount,
        currency_code: 'KRW',
        pay_amt: 0,
        cash_amt: 0,
        cash_unit_price: 1,
        display_digit_num: -2,
        game_cash_unit_price: 1,
        min_pay_amt: 100,
        max_pay_amt: null,
        is_mobile: false,
        is_gift: false,
        request_url: 'https://pay.onstove.com',
        position: 'PCWEB',
        is_client: false,
        auth_confirm_order_no: '',
        game_point_use_flag: null
    };
}

export function extractStovePointBalance(response) {
    const balance = numberOrNull(response?.value?.mileage_amount);
    return balance === null ? null : balance;
}

export function extractLostArkOrderNo(response) {
    const orderNo = response?.value?.order_no;
    return orderNo == null || orderNo === '' ? null : String(orderNo);
}

export async function getLostArkPointBalance(headers) {
    return apiRequest(buildLostArkPointBalanceUrl(), 'GET', makeLostArkPaymentHeaders(headers));
}

export async function chargeLostArkCashWithPoints(headers) {
    const payload = buildLostArkPointCashChargePayload({
        accessToken: extractBearerToken(headers)
    });

    return apiRequest(
        buildLostArkCashChargeUrl(),
        'POST',
        makeLostArkPaymentHeaders(headers),
        payload
    );
}

export async function getLostArkPaymentInfo(headers, orderNo) {
    return apiRequest(buildLostArkPaymentInfoUrl(orderNo), 'GET', makeLostArkPaymentHeaders(headers));
}
