// Money is stored as integer euro cents everywhere. Floating point euros are
// never persisted, because 0.1 + 0.2 !== 0.3 and rounding drift shows up in
// booking totals. Conversion to a human figure happens only at the edges.

const EUR = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const EUR_PRECISE = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 129900 -> "€1,299". Whole euros, for prices shown to customers. */
export function formatMoney(cents: number): string {
  return EUR.format(Math.round(cents) / 100);
}

/** 129950 -> "€1,299.50". Used on invoices and admin totals. */
export function formatMoneyPrecise(cents: number): string {
  return EUR_PRECISE.format(Math.round(cents) / 100);
}

/** Form input "1299.50" -> 129950. Returns null if not a valid amount. */
export function parseEurosToCents(input: string | number): number | null {
  const raw = String(input).trim().replace(/[€\s,]/g, '');
  if (raw === '' || !/^-?\d+(\.\d{1,2})?$/.test(raw)) return null;
  return Math.round(parseFloat(raw) * 100);
}

/** 129900 -> "1299.00", for pre-filling a number input in the admin forms. */
export function centsToEuroInput(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}
