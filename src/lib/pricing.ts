import { query } from './db';
import type { Promotion, Tour, Departure } from './types';

/**
 * The promotions engine.
 *
 * The rule that makes this work: a promotion is a RULE stored separately from
 * the price. Staff never type a discounted price over the original one, so the
 * base price survives, "was / now" can be shown honestly, and a sale expires by
 * itself when its end date passes.
 *
 * Effective price is therefore always COMPUTED at read time, never stored.
 */

export interface PriceContext {
  tour: Pick<Tour, 'id' | 'destination_id' | 'base_price_cents'>;
  departure?: Pick<Departure, 'id' | 'price_cents' | 'start_date'> | null;
  travellers: number;
  /** Theme ids attached to the tour, needed for theme-scoped promotions. */
  themeIds?: number[];
  /** A code typed by the customer at checkout, if any. */
  code?: string | null;
  /** Defaults to now. Injectable so the logic is testable. */
  bookingDate?: Date;
}

export interface PriceBreakdown {
  /** Per-person list price before any promotion. */
  basePriceCents: number;
  travellers: number;
  baseTotalCents: number;
  /** The single winning promotion, or null when nothing applies. */
  promotion: Promotion | null;
  /** Every promotion that was eligible, best first. Useful for admin debugging. */
  candidates: Promotion[];
  discountCents: number;
  totalCents: number;
  perPersonCents: number;
  /** True when a code was supplied but matched no eligible promotion. */
  codeRejected: boolean;
}

/** Whole days between the booking date and the departure date. */
export function daysUntil(startDate: string, from: Date): number {
  const start = new Date(startDate + 'T00:00:00Z').getTime();
  const base = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  return Math.floor((start - base) / 86_400_000);
}

/** Loads every promotion that could currently be live. */
export function loadActivePromotions(now: Date = new Date()): Promotion[] {
  const iso = now.toISOString().slice(0, 19).replace('T', ' ');
  return query<Promotion>(
    `SELECT * FROM promotions
      WHERE status = 'active'
        AND starts_at <= ?
        AND ends_at   >= ?
      ORDER BY priority DESC, id ASC`,
    iso,
    iso,
  );
}

/**
 * Decides whether one promotion applies to one prospective booking.
 * Every condition is a separate early return so the reason is easy to trace.
 */
export function isEligible(
  promo: Promotion,
  ctx: PriceContext,
  baseTotalCents: number,
): boolean {
  const now = ctx.bookingDate ?? new Date();

  // Usage cap reached.
  if (promo.usage_limit !== null && promo.usage_count >= promo.usage_limit) {
    return false;
  }

  // Coded promotions require the customer to supply the matching code.
  // Promotions with no code apply automatically.
  if (promo.code) {
    const supplied = (ctx.code ?? '').trim().toUpperCase();
    if (supplied !== promo.code.trim().toUpperCase()) return false;
  }

  // Scope.
  switch (promo.scope) {
    case 'all':
      break;
    case 'tour':
      if (promo.scope_id !== ctx.tour.id) return false;
      break;
    case 'destination':
      if (promo.scope_id !== ctx.tour.destination_id) return false;
      break;
    case 'theme':
      if (!promo.scope_id) return false;
      if (!(ctx.themeIds ?? []).includes(promo.scope_id)) return false;
      break;
  }

  // Basket conditions.
  if (ctx.travellers < promo.min_travellers) return false;
  if (baseTotalCents < promo.min_booking_cents) return false;

  // Lead-time conditions: early bird needs a departure far enough away,
  // last minute needs one close enough.
  if (promo.min_days_before !== null || promo.max_days_before !== null) {
    if (!ctx.departure) return false;
    const lead = daysUntil(ctx.departure.start_date, now);
    if (promo.min_days_before !== null && lead < promo.min_days_before) return false;
    if (promo.max_days_before !== null && lead > promo.max_days_before) return false;
  }

  return true;
}

/** What one promotion is worth against a given basket total. */
export function discountFor(promo: Promotion, baseTotalCents: number): number {
  const raw =
    promo.type === 'percentage'
      ? Math.round((baseTotalCents * promo.value) / 100)
      : promo.value;
  // Never discount below zero, never exceed the basket.
  return Math.max(0, Math.min(raw, baseTotalCents));
}

/**
 * Computes the final price.
 *
 * Conflict resolution is BEST FOR THE CUSTOMER: when several promotions are
 * eligible, the one worth the most money wins, ties broken by priority.
 * Percentage discounts are deliberately never stacked, because 20% + 20% is 36%
 * and no member of staff has ever expected that number.
 */
export function priceFor(
  ctx: PriceContext,
  promotions?: Promotion[],
): PriceBreakdown {
  const now = ctx.bookingDate ?? new Date();
  const basePriceCents = ctx.departure?.price_cents ?? ctx.tour.base_price_cents;
  const travellers = Math.max(1, ctx.travellers);
  const baseTotalCents = basePriceCents * travellers;

  const pool = promotions ?? loadActivePromotions(now);

  const candidates = pool
    .filter((p) => isEligible(p, ctx, baseTotalCents))
    .sort((a, b) => {
      const d = discountFor(b, baseTotalCents) - discountFor(a, baseTotalCents);
      return d !== 0 ? d : b.priority - a.priority;
    });

  const winner = candidates[0] ?? null;
  const discountCents = winner ? discountFor(winner, baseTotalCents) : 0;
  const totalCents = baseTotalCents - discountCents;

  // A code was typed but nothing it could unlock was eligible.
  const suppliedCode = (ctx.code ?? '').trim();
  const codeRejected =
    suppliedCode.length > 0 &&
    !candidates.some(
      (p) => p.code && p.code.trim().toUpperCase() === suppliedCode.toUpperCase(),
    );

  return {
    basePriceCents,
    travellers,
    baseTotalCents,
    promotion: winner,
    candidates,
    discountCents,
    totalCents,
    perPersonCents: Math.round(totalCents / travellers),
    codeRejected,
  };
}

/**
 * The automatic promotion shown on a tour card or tour page, where there is no
 * customer, no traveller count and no code yet. Only codeless promotions can
 * ever appear here - a card must not advertise a discount that needs a code.
 */
export function bestAutomaticPromotion(
  ctx: Omit<PriceContext, 'travellers' | 'code'>,
  promotions?: Promotion[],
): { promotion: Promotion | null; discountCents: number; wasCents: number; nowCents: number } {
  const pool = (promotions ?? loadActivePromotions(ctx.bookingDate ?? new Date()))
    .filter((p) => !p.code);

  const result = priceFor({ ...ctx, travellers: 1, code: null }, pool);

  return {
    promotion: result.promotion,
    discountCents: result.discountCents,
    wasCents: result.baseTotalCents,
    nowCents: result.totalCents,
  };
}

/** The deposit a customer pays now: 20% of the total, rounded to whole euros. */
export function depositFor(totalCents: number): number {
  return Math.round((totalCents * 0.2) / 100) * 100;
}
