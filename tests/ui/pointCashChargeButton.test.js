import test from 'node:test';
import assert from 'node:assert/strict';

import {
    isPointCashChargeAvailable,
    updatePointCashChargeButtonAvailability
} from '../../src/ui/pointCashCharge.js';

test('isPointCashChargeAvailable requires at least 192500 flake', () => {
    assert.equal(isPointCashChargeAvailable(192499), false);
    assert.equal(isPointCashChargeAvailable(192500), true);
    assert.equal(isPointCashChargeAvailable(250000), true);
});

test('updatePointCashChargeButtonAvailability toggles the all-in-one charge button', () => {
    const button = {
        disabled: false,
        style: {},
        title: ''
    };
    const status = {
        textContent: '',
        style: {}
    };

    const originalDocument = global.document;
    global.document = {
        getElementById(id) {
            if (id === 'stove-btn-point-cash-charge') return button;
            if (id === 'stove-btn-point-cash-charge-status') return status;
            return null;
        }
    };

    try {
        updatePointCashChargeButtonAvailability(100000);
        assert.equal(button.disabled, true);
        assert.match(button.title, /192,500/);
        assert.match(status.textContent, /부족/);

        updatePointCashChargeButtonAvailability(192500);
        assert.equal(button.disabled, false);
        assert.match(button.title, /충전 가능/);
        assert.match(status.textContent, /충전 가능/);
    } finally {
        global.document = originalDocument;
    }
});
