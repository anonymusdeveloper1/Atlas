import type { ReactNode } from 'react';

/**
 * The admin panel shows the same shape of information on almost every screen:
 * a header row of labels and a body of rows. Only the cells differ, so the
 * shell lives here and each page passes its own <tr> elements as children.
 *
 * No 'use client' directive: this module holds nothing but markup, so it works
 * unchanged inside a server page and inside a client component such as
 * DepartureManager.
 */

export interface DataTableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
}

export default function DataTable({
  columns,
  children,
}: {
  columns: DataTableColumn[];
  children: ReactNode;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={c.align === 'right' ? 'num' : undefined}
                scope="col"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------- helpers -- */

const BADGE_CLASS: Record<string, string> = {
  // tours
  published: 'badge-good',
  draft: 'badge-neutral',
  sold_out: 'badge-warn',
  retired: 'badge-neutral',
  // departures
  open: 'badge-accent',
  guaranteed: 'badge-good',
  cancelled: 'badge-danger',
  // bookings
  pending: 'badge-warn',
  confirmed: 'badge-accent',
  paid: 'badge-good',
  completed: 'badge-neutral',
  // promotions
  active: 'badge-good',
  paused: 'badge-warn',
  expired: 'badge-neutral',
  // inbox
  new: 'badge-warn',
  in_progress: 'badge-accent',
  closed: 'badge-neutral',
  rejected: 'badge-danger',
  approved: 'badge-good',
};

/** One badge component for every status enum in the schema. */
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${BADGE_CLASS[status] ?? 'badge-neutral'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

/**
 * Seats sold against seats available. Low occupancy is the bad case for a tour
 * operator — an under-filled departure either runs at a loss or gets cancelled
 * on the travellers — so the bar reads red when it is empty, not when it is
 * full. There is no bar class in the design system, so the two rules it needs
 * are inline.
 */
export function OccupancyBar({
  booked,
  total,
}: {
  booked: number;
  total: number;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((booked / total) * 100)) : 0;
  const colour =
    pct >= 70 ? 'var(--good)' : pct >= 40 ? 'var(--warn)' : 'var(--danger)';

  return (
    <div style={{ minWidth: '128px' }}>
      <div
        className="between"
        style={{ gap: 'var(--s3)', fontSize: '0.78rem' }}
      >
        <span className="tabular muted">
          {booked}/{total} seats
        </span>
        <span className="tabular" style={{ color: colour, fontWeight: 500 }}>
          {pct}%
        </span>
      </div>
      <div
        role="img"
        aria-label={`${pct} percent booked, ${booked} of ${total} seats`}
        style={{
          height: '6px',
          marginTop: '4px',
          borderRadius: '999px',
          background: 'var(--surface-3)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{ width: `${pct}%`, height: '100%', background: colour }}
        />
      </div>
    </div>
  );
}
