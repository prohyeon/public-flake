import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildLostArkPointBalanceUrl,
    buildLostArkPointCashChargePayload,
    extractBearerToken,
    extractLostArkOrderNo,
    extractStovePointBalance,
    makeLostArkPaymentHeaders
} from '../../src/api/lostArkCashCharge.js';

test('buildLostArkPointCashChargePayload matches the captured 7700 point direct charge body', () => {
    assert.deepEqual(
        buildLostArkPointCashChargePayload({ accessToken: 'token' }),
        {
            speed_charge_flag: 'Y',
            access_token: 'token',
            return_url: '',
            is_channeling: false,
            cp_item_id: 0,
            coupon_info: null,
            location_code: '1',
            prod_name: '7,700 로열 크리스탈',
            sales_prod_name: '7,700 로열 크리스탈',
            multi_pay_list: [
                {
                    paytool_code: 99,
                    pg_code: 'STOVE_MILEAGE',
                    mall_id: 'STOVE_MILEAGE',
                    cash_amt: 7700,
                    pay_amt: 0
                }
            ],
            paytool_code: 58,
            pgp_code: 'POQ',
            pg_code: 'SP_CREDITCARD_PLCC',
            mall_id: 'spay_la6',
            total_pay_amt: 7700,
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
        }
    );
});

test('makeLostArkPaymentHeaders uses bill-payweb headers', () => {
    assert.deepEqual(
        makeLostArkPaymentHeaders({
            Authorization: 'Bearer token',
            'X-UUID': 'uuid-1',
            'x-lang': 'ko',
            'x-nation': 'KR'
        }),
        {
            'Content-Type': 'application/json',
            Authorization: 'Bearer token',
            'X-Lang': 'ko',
            'X-Nation': 'KR',
            'caller-id': 'bill-payweb',
            'caller-detail': 'uuid-1'
        }
    );
});

test('extractBearerToken returns the raw SUAT token for the payment body', () => {
    assert.equal(extractBearerToken({ Authorization: 'Bearer token-1' }), 'token-1');
    assert.equal(extractBearerToken({ authorization: 'token-2' }), 'token-2');
});

test('buildLostArkPointBalanceUrl targets paid STOVE points', () => {
    assert.equal(
        buildLostArkPointBalanceUrl(),
        'https://api.onstove.com/point/v1.0/balance?client_id=M_STOVE_PC&use_rule_id=ML_STOVE_PC_MILE_PAID'
    );
});

test('extractStovePointBalance reads point balance responses', () => {
    assert.equal(extractStovePointBalance({ code: 0, value: { mileage_amount: 7700 } }), 7700);
    assert.equal(extractStovePointBalance({ code: 0, value: { mileage_amount: '7700' } }), 7700);
    assert.equal(extractStovePointBalance({ code: 0, value: {} }), null);
});

test('extractLostArkOrderNo reads the direct charge order number', () => {
    assert.equal(extractLostArkOrderNo({ code: 0, value: { order_no: 2605101202375031 } }), '2605101202375031');
    assert.equal(extractLostArkOrderNo({ code: 0, value: {} }), null);
});
