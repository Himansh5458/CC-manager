// dueDate.ts — days-until-payment-deadline for a card.
//
// Part of src/lib/calculations/, the home for pure business logic (see
// src/lib/CLAUDE.md rule 2). Extracted from src/app/cards/page.tsx now that both
// the Cards list and the Dashboard need the same "when is this card's payment
// due" math — a single source of truth so the two views can never disagree.
//
// ── What "due" means here ─────────────────────────────────────────────────────
// A card stores `statement_date` as a bare day-of-month and a `payment_deadline_days`
// offset. The upcoming deadline is the most recent statement occurrence (≤ today,
// via cardBalance.mostRecentStatementDate) plus that many days. We return the whole
// number of days from today until that deadline, or null when it has already passed —
// the caller decides how to present a passed deadline (the Cards list falls back to
// showing the raw statement day rather than projecting the next cycle).
//
// ── Timezone policy ──────────────────────────────────────────────────────────
// All date math is UTC, identical to cardBalance.ts: `today` is read via its UTC
// calendar fields only and the statement anchor is a UTC-midnight Date, so the
// day count never shifts with the server's local timezone.

import type { Card } from "../types/schema";
import { mostRecentStatementDate } from "./cardBalance";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days from `today` until the card's upcoming payment deadline: the most
 * recent statement date (≤ today) plus `payment_deadline_days`. Returns null when
 * that deadline has already passed, leaving the fallback presentation to the caller.
 */
export function daysUntilDue(card: Card, today: Date): number | null {
  const statement = mostRecentStatementDate(card.statement_date, today);
  const due = statement.getTime() + card.payment_deadline_days * MS_PER_DAY;
  const todayMidnight = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const diffDays = Math.round((due - todayMidnight) / MS_PER_DAY);
  return diffDays >= 0 ? diffDays : null;
}
