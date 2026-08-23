// Validation shared by POST /api/admin/promotions and PATCH on one promotion.
//
// A promotion is a rule the pricing engine evaluates, never a hand-edited
// price, so a malformed rule is far more dangerous than a malformed article:
// it silently mis-charges customers. Everything is checked before it is
// written, and the messages name the field so the admin form can point at it.

import { get } from '@/lib/db';
import type { PromotionScope, PromotionType } from '@/lib/types';
import { fail, int, intInRange, ok, readMoney, text } from './http';
import type { Parsed } from './http';

export const PROMO_TYPES = ['percentage', 'fixed'] as const;
export const PROMO_SCOPES = ['all', 'tour', 'destination', 'theme'] as const;
export const PROMO_STATUSES = ['draft', 'active', 'paused', 'expired'] as const;

/**
 * An empty code is stored as NULL, and NULL is what makes a promotion
 * automatic: the pricing engine applies it without anything to type. Codes are
 * uppercased because that is how isEligible() compares them.
 */
export function normaliseCode(raw: unknown): string | null {
  const code = text(raw).toUpperCase().replace(/\s+/g, '');
  return code === '' ? null : code;
}

/** Rejects a code already in use, case-insensitively. Excludes `exceptId`. */
export function codeIsTaken(code: string, exceptId?: number): boolean {
  const row = exceptId
    ? get<{ id: number }>(
        'SELECT id FROM promotions WHERE UPPER(code) = ? AND id <> ?',
        code,
        exceptId,
      )
    : get<{ id: number }>('SELECT id FROM promotions WHERE UPPER(code) = ?', code);
  return Boolean(row);
}

/**
 * A scoped promotion must point at a row that exists, otherwise it quietly
 * discounts nothing and nobody finds out until a customer complains.
 */
export function checkScopeTarget(
  scope: PromotionScope,
  scopeId: number | null,
): string | null {
  if (scope === 'all') return null;
  if (scopeId === null) {
    return `scope_id is required when scope is '${scope}'.`;
  }

  const table =
    scope === 'tour' ? 'tours' : scope === 'destination' ? 'destinations' : 'themes';
  const row = get<{ id: number }>(`SELECT id FROM ${table} WHERE id = ?`, scopeId);

  return row ? null : `No ${scope} with id ${scopeId} exists.`;
}

/**
 * Reads the discount amount, whose unit depends on the type: a percentage is
 * a whole 1-100, a fixed discount is money and therefore euro cents.
 */
export function readPromotionValue(
  body: Record<string, unknown>,
  type: PromotionType,
): Parsed<number> {
  if (type === 'percentage') {
    const percent = intInRange(body.value, 1, 100);
    if (percent === null) {
      return fail('A percentage promotion needs a value between 1 and 100.');
    }
    return ok(percent);
  }

  const cents = readMoney(body, 'value_cents');
  if (cents === undefined) {
    return fail('A fixed promotion needs a value in euros, such as "150.00".');
  }
  if (cents === null) {
    return fail('value must be an amount in euros, such as "150.00".');
  }
  if (cents <= 0) {
    return fail('A fixed promotion must be worth more than zero.');
  }
  return ok(cents);
}

/** Optional positive integer columns: usage_limit, per_customer_limit. */
export function readOptionalCount(
  body: Record<string, unknown>,
  key: string,
): Parsed<number | null> {
  const raw = body[key];
  if (raw === null || raw === undefined || raw === '') return ok(null);

  const n = int(raw);
  if (n === null || n < 1) return fail(`${key} must be a whole number of 1 or more.`);
  return ok(n);
}

/** Optional lead-time columns: min_days_before, max_days_before. */
export function readOptionalDays(
  body: Record<string, unknown>,
  key: string,
): Parsed<number | null> {
  const raw = body[key];
  if (raw === null || raw === undefined || raw === '') return ok(null);

  const n = int(raw);
  if (n === null || n < 0) return fail(`${key} must be 0 or more days.`);
  return ok(n);
}

/**
 * Early bird and last minute are opposite ends of the same window. If a
 * promotion demands "at least 90 days ahead" and "at most 30 days ahead" it
 * can never fire, which is a bug an admin would otherwise discover by seeing
 * a discount that never appears.
 */
export function checkLeadWindow(
  minDaysBefore: number | null,
  maxDaysBefore: number | null,
): string | null {
  if (minDaysBefore === null || maxDaysBefore === null) return null;
  if (minDaysBefore > maxDaysBefore) {
    return (
      'min_days_before cannot be greater than max_days_before - ' +
      'no departure could ever satisfy both.'
    );
  }
  return null;
}
