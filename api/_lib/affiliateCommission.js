export const AFFILIATE_TERMS_VERSION = "partner_50pct_6mo_v1";
export const LEGACY_AFFILIATE_TERMS_VERSION = "legacy_first_payment_5_v1";
export const AFFILIATE_REVENUE_SHARE_RATE = 0.5;
export const AFFILIATE_REVENUE_SHARE_MONTHS = 6;
export const AFFILIATE_MAX_COMMISSION_USD = 30;

export function roundUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

export function hasSuccessfulPaidAmount(amountUsd) {
  return Number.isFinite(Number(amountUsd)) && Number(amountUsd) > 0;
}

export function addUtcMonths(value, months) {
  const source = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(source.getTime())) return null;

  const wholeMonths = Math.trunc(Number(months) || 0);
  const targetMonthIndex = source.getUTCMonth() + wholeMonths;
  const targetYear = source.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(source.getUTCDate(), lastDay);

  return new Date(Date.UTC(
    targetYear,
    normalizedMonth,
    targetDay,
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
    source.getUTCMilliseconds(),
  ));
}

export function revenueShareWindowEnd(firstPaidAt) {
  return addUtcMonths(firstPaidAt, AFFILIATE_REVENUE_SHARE_MONTHS);
}

export function isWithinRevenueShareWindow(firstPaidAt, paidAt) {
  const start = firstPaidAt instanceof Date ? firstPaidAt : new Date(firstPaidAt);
  const payment = paidAt instanceof Date ? paidAt : new Date(paidAt);
  const end = revenueShareWindowEnd(start);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(payment.getTime()) ||
    !end
  ) {
    return false;
  }

  return payment.getTime() >= start.getTime() && payment.getTime() < end.getTime();
}

export function calculatePartnerCommission({
  plan,
  amountUsd,
  alreadyEarnedUsd = 0,
}) {
  if (!hasSuccessfulPaidAmount(amountUsd)) return 0;

  const normalizedPlan = String(plan || "").trim().toLowerCase();
  const gross = roundUsd(amountUsd);
  const alreadyEarned = Math.max(0, roundUsd(alreadyEarnedUsd));
  const remainingCap = Math.max(0, roundUsd(AFFILIATE_MAX_COMMISSION_USD - alreadyEarned));

  let commission = 0;

  if (normalizedPlan === "pro_yearly") {
    // 50% revenue share, prorated to the first 6 months of a 12-month payment.
    commission = gross * AFFILIATE_REVENUE_SHARE_RATE * (AFFILIATE_REVENUE_SHARE_MONTHS / 12);
  } else if (
    normalizedPlan === "pro_monthly" ||
    normalizedPlan === "india_upi_monthly" ||
    normalizedPlan === "lifetime"
  ) {
    commission = gross * AFFILIATE_REVENUE_SHARE_RATE;
  } else {
    return 0;
  }

  return roundUsd(Math.min(commission, remainingCap));
}

export function calculateCommissionReversal({
  commissionAmountUsd,
  grossPaymentAmount,
  refundedPaymentAmount,
  alreadyReversedUsd = 0,
}) {
  const commission = Math.max(0, roundUsd(commissionAmountUsd));
  const gross = Math.max(0, Number(grossPaymentAmount) || 0);
  const refunded = Math.max(0, Number(refundedPaymentAmount) || 0);
  const alreadyReversed = Math.max(0, roundUsd(alreadyReversedUsd));

  if (!commission || !gross || !refunded) return 0;

  const ratio = Math.min(1, refunded / gross);
  const targetReversal = roundUsd(commission * ratio);
  const additionalReversal = Math.max(0, roundUsd(targetReversal - alreadyReversed));

  return roundUsd(-additionalReversal);
}
