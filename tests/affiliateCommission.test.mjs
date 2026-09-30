import test from "node:test";
import assert from "node:assert/strict";

import {
  AFFILIATE_MAX_COMMISSION_USD,
  calculateCommissionReversal,
  calculatePartnerCommission,
  hasSuccessfulPaidAmount,
  isWithinRevenueShareWindow,
} from "../api/_lib/affiliateCommission.js";

test("monthly plan earns $5 per $10 payment up to $30 in the six-month window", () => {
  let earned = 0;

  for (let payment = 0; payment < 6; payment += 1) {
    const commission = calculatePartnerCommission({
      plan: "pro_monthly",
      amountUsd: 10,
      alreadyEarnedUsd: earned,
    });
    assert.equal(commission, 5);
    earned += commission;
  }

  assert.equal(earned, AFFILIATE_MAX_COMMISSION_USD);
  assert.equal(
    calculatePartnerCommission({
      plan: "pro_monthly",
      amountUsd: 10,
      alreadyEarnedUsd: earned,
    }),
    0,
  );

  assert.equal(
    isWithinRevenueShareWindow("2026-01-15T12:00:00.000Z", "2026-07-14T23:59:59.000Z"),
    true,
  );
  assert.equal(
    isWithinRevenueShareWindow("2026-01-15T12:00:00.000Z", "2026-07-15T12:00:00.000Z"),
    false,
  );
});

test("yearly plan pays $24 on a $96 annual payment", () => {
  assert.equal(
    calculatePartnerCommission({
      plan: "pro_yearly",
      amountUsd: 96,
      alreadyEarnedUsd: 0,
    }),
    24,
  );
});

test("lifetime plan is capped at $30", () => {
  assert.equal(
    calculatePartnerCommission({
      plan: "lifetime",
      amountUsd: 300,
      alreadyEarnedUsd: 0,
    }),
    30,
  );
});

test("India UPI monthly follows the monthly 50% revenue-share rule", () => {
  assert.equal(
    calculatePartnerCommission({
      plan: "india_upi_monthly",
      amountUsd: 10,
      alreadyEarnedUsd: 0,
    }),
    5,
  );
});

test("refunds reverse the corresponding commission proportionally and idempotently", () => {
  assert.equal(
    calculateCommissionReversal({
      commissionAmountUsd: 5,
      grossPaymentAmount: 1000,
      refundedPaymentAmount: 1000,
      alreadyReversedUsd: 0,
    }),
    -5,
  );

  assert.equal(
    calculateCommissionReversal({
      commissionAmountUsd: 5,
      grossPaymentAmount: 1000,
      refundedPaymentAmount: 500,
      alreadyReversedUsd: 0,
    }),
    -2.5,
  );

  assert.equal(
    calculateCommissionReversal({
      commissionAmountUsd: 5,
      grossPaymentAmount: 1000,
      refundedPaymentAmount: 1000,
      alreadyReversedUsd: 2.5,
    }),
    -2.5,
  );

  assert.equal(
    calculateCommissionReversal({
      commissionAmountUsd: 5,
      grossPaymentAmount: 1000,
      refundedPaymentAmount: 1000,
      alreadyReversedUsd: 5,
    }),
    0,
  );
});

test("free trial / zero-dollar invoice creates no paid commission and does not start a paid window", () => {
  assert.equal(hasSuccessfulPaidAmount(0), false);
  assert.equal(
    calculatePartnerCommission({
      plan: "pro_monthly",
      amountUsd: 0,
      alreadyEarnedUsd: 0,
    }),
    0,
  );

  const firstPaidAt = "2026-02-08T10:00:00.000Z";
  assert.equal(isWithinRevenueShareWindow(firstPaidAt, firstPaidAt), true);
});
