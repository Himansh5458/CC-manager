// cardBalance.ts — current-cycle outstanding balance & utilization for a card.
//
// Part of src/lib/calculations/, the home for pure business logic (see
// src/lib/CLAUDE.md rule 2). This module derives a card's current outstanding
// balance and utilization from its transactions and payments; it never reads or
// writes the database — the caller supplies the rows.
//
// ── What "current cycle" means here ──────────────────────────────────────────
// A card's `statement_date` is stored as a bare day-of-month number (e.g. 5 or
// 18), not a full date. The current statement cycle is everything posted on or
// after the MOST RECENT occurrence of that day-of-month that is on or before
// today. This is the same "find the most recent anchor multiple ≤ today" shape
// solved for anniversary milestone cycles in calculations/milestoneCycles.ts —
// here the step is exactly one month and the anchor is a day-of-month.
//
// ── Timezone policy ──────────────────────────────────────────────────────────
// All date math is done in UTC, identical to calculations/milestoneCycles.ts:
// ISO `YYYY-MM-DD` strings are parsed as UTC midnight and `today` is read via its
// UTC calendar fields only, so a cycle boundary never shifts with the server's
// local timezone. The small UTC helpers below are intentionally duplicated from
// milestoneCycles.ts rather than shared, matching that module's self-contained
// convention.
//
// ── Short-month policy ───────────────────────────────────────────────────────
// If the statement day doesn't exist in a given month (e.g. day 31 in February),
// it clamps BACK to that month's last day — the same clamp direction used by
// addMonths() in milestoneCycles.ts. A real statement on a 31st simply lands on
// the 28th/30th in shorter months.

import type { Card, Transaction, Payment } from "../types/schema";

export interface ComputedBalance {
  outstandingBalance: number;
  utilizationPct: number;
}

/** Parse a YYYY-MM-DD string as a UTC-midnight Date. */
function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Strip any time-of-day from a Date, returning that calendar day at UTC midnight. */
function toUTCMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * The calendar date for `statementDay` in the given UTC year/month, clamping the
 * day back to the month's last day when it doesn't exist (e.g. 31 → 28 in Feb).
 * `month` is 0-indexed and may be out of range — Date.UTC normalises it (so -1
 * rolls into the previous December), which is how we step back a month.
 */
function statementDateForMonth(
  year: number,
  month: number,
  statementDay: number,
): Date {
  // Day 0 of the *next* month == last day of the target month.
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(statementDay, lastDayOfMonth)));
}

/**
 * The most recent calendar date matching `statementDay` (day-of-month) that is on
 * or before `today`. Exported for testability and reuse — the statement-cycle
 * boundary is the trickiest bit of this module.
 *
 * The candidate in `today`'s own month is checked first; if it's still in the
 * future (today is before this month's statement date), we step back exactly one
 * month. The previous month's clamped statement date is always ≤ today, so one
 * step back is sufficient.
 */
export function mostRecentStatementDate(statementDay: number, today: Date): Date {
  const now = toUTCMidnight(today);
  const thisMonth = statementDateForMonth(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    statementDay,
  );
  if (thisMonth.getTime() <= now.getTime()) {
    return thisMonth;
  }
  return statementDateForMonth(
    now.getUTCFullYear(),
    now.getUTCMonth() - 1,
    statementDay,
  );
}

/** Round to `dp` decimal places without binary-float drift (e.g. 22.65→22.7). */
function roundTo(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/**
 * Recompute a card's current-cycle outstanding balance and utilization from its
 * transactions and payments.
 *
 * Only rows dated on or after the card's most recent statement date (≤ today) are
 * counted. outstandingBalance = Σ(transaction amounts) − Σ(payment amounts) in
 * that window, rounded to 2 dp. utilizationPct = outstanding / credit_limit ×
 * 100, rounded to 1 dp (0 when credit_limit is 0, to avoid a NaN/∞ result).
 *
 * `today` defaults to the current date so callers match the documented 3-arg
 * signature; tests inject a fixed `today` for determinism. (Judgment call — see
 * docs/data-layer-contract.md.)
 */
export function recomputeCardBalance(
  card: Card,
  transactions: Transaction[],
  payments: Payment[],
  today: Date = new Date(),
): ComputedBalance {
  const cycleStart = mostRecentStatementDate(card.statement_date, today);
  const cycleStartMs = cycleStart.getTime();

  const inCycle = (dateStr: string): boolean =>
    parseISODate(dateStr).getTime() >= cycleStartMs;

  const spend = transactions
    .filter((t) => t.card_id === card.id && inCycle(t.date))
    .reduce((sum, t) => sum + t.amount, 0);

  const paid = payments
    .filter((p) => p.card_id === card.id && inCycle(p.date))
    .reduce((sum, p) => sum + p.amount, 0);

  const outstandingBalance = roundTo(spend - paid, 2);
  const utilizationPct =
    card.credit_limit > 0
      ? roundTo((outstandingBalance / card.credit_limit) * 100, 1)
      : 0;

  return { outstandingBalance, utilizationPct };
}

/**
 * The utilization the rest of the app should trust: the manual override when one
 * is set, otherwise the freshly computed value. Encodes the "manual override
 * always wins" principle from /CLAUDE.md — a value the user typed by hand is
 * never silently replaced by a recompute.
 */
export function getEffectiveUtilization(
  card: Card,
  computed: ComputedBalance,
): number {
  return card.manual_override_utilization_pct !== null
    ? card.manual_override_utilization_pct
    : computed.utilizationPct;
}
