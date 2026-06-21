// Cards list — read-only dashboard view of every active card.
//
// Server Component (async, per Next.js 16 conventions): it fetches via the data
// layer (getCards) on the server and renders static markup. No add/edit here —
// that's a separate step. Add/edit and per-card detail are intentionally absent.

import { getCards } from "@/lib/data/cards";
import {
  getEffectiveUtilization,
  mostRecentStatementDate,
  type ComputedBalance,
} from "@/lib/calculations/cardBalance";
import type { Card } from "@/lib/types/schema";

// Render fresh on every request rather than prerendering at build time.
// "Due in X days" and utilization depend on the actual current date and the
// live database, so a build-time snapshot would be stale. See src/app/CLAUDE.md.
export const dynamic = "force-dynamic";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Format a rupee amount with the Indian grouping and no paise. */
function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Tailwind text-color utility for a utilization band (design-system semantic colors). */
function utilizationColorClass(pct: number): string {
  if (pct > 70) return "text-danger";
  if (pct >= 30) return "text-warning";
  return "text-success";
}

/** Matching fill color for the thin utilization track. */
function utilizationBarClass(pct: number): string {
  if (pct > 70) return "bg-danger";
  if (pct >= 30) return "bg-warning";
  return "bg-success";
}

/** Urgency text color for days-until-due (same banding pattern as utilization). */
function dueColorClass(days: number): string {
  if (days <= 3) return "text-danger";
  if (days <= 10) return "text-warning";
  return "text-text-primary-dark";
}

/**
 * Days until the upcoming payment deadline, computed simply: the most recent
 * statement date (≤ today) plus payment_deadline_days. Returns null when that
 * deadline has already passed — the caller then falls back to showing the raw
 * statement day rather than overbuilding next-cycle date logic on this list view.
 */
function daysUntilDue(card: Card, today: Date): number | null {
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

/** Ordinal suffix for a day-of-month (1st, 2nd, 3rd, 5th…). */
function ordinal(day: number): string {
  const v = day % 100;
  if (v >= 11 && v <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

export default async function CardsPage() {
  const today = new Date();
  const cards = (await getCards()).filter((c) => c.active);

  return (
    <main className="flex-1 px-6 py-8 md:px-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary-dark">Cards</h1>
        <p className="mt-1 text-sm text-text-secondary-dark">
          {cards.length} active {cards.length === 1 ? "card" : "cards"}
        </p>
      </header>

      {cards.length === 0 ? (
        <p className="text-text-secondary-dark">No active cards.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => {
            // "Manual override always wins" — feed the stored cycle value as the
            // computed input so getEffectiveUtilization applies the same rule the
            // recompute path uses, without refetching transactions/payments here.
            const computed: ComputedBalance = {
              outstandingBalance: card.current_outstanding_balance,
              utilizationPct: card.current_utilization_pct,
            };
            const utilization = getEffectiveUtilization(card, computed);
            const isOverridden = card.manual_override_utilization_pct !== null;
            const days = daysUntilDue(card, today);

            return (
              <article
                key={card.id}
                className="rounded-2xl border border-white/5 bg-surface-dark p-6 shadow-lg shadow-black/20"
              >
                {/* Card identity */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-text-primary-dark">
                      {card.card_name}
                    </h2>
                    <p className="text-sm text-text-secondary-dark">
                      {card.card_bank} · {card.card_type}
                    </p>
                  </div>
                  <span className="rounded-full bg-brand-yellow/10 px-2.5 py-0.5 text-xs font-medium text-brand-yellow">
                    Active
                  </span>
                </div>

                <p className="mt-3 font-mono text-sm tracking-wider text-text-secondary-dark">
                  •••• {card.card_number_last4}
                </p>

                {/* Metric: credit limit */}
                <div className="mt-6">
                  <p className="text-xs uppercase tracking-wide text-text-secondary-dark">
                    Credit Limit
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary-dark">
                    {formatINR(card.credit_limit)}
                  </p>
                </div>

                {/* Metric: utilization with colored indicator */}
                <div className="mt-5">
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs uppercase tracking-wide text-text-secondary-dark">
                      Utilization
                      {isOverridden && (
                        <span className="ml-1.5 normal-case text-info">
                          (manual)
                        </span>
                      )}
                    </p>
                    <p
                      className={`text-2xl font-semibold tabular-nums ${utilizationColorClass(utilization)}`}
                    >
                      {utilization.toFixed(1)}%
                    </p>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full ${utilizationBarClass(utilization)}`}
                      style={{ width: `${Math.min(utilization, 100)}%` }}
                    />
                  </div>
                </div>

                {/* Metric: payment due */}
                <div className="mt-5">
                  <p className="text-xs uppercase tracking-wide text-text-secondary-dark">
                    Payment Due
                  </p>
                  {days !== null ? (
                    <p
                      className={`mt-1 text-lg font-semibold ${dueColorClass(days)}`}
                    >
                      Due in {days} {days === 1 ? "day" : "days"}
                    </p>
                  ) : (
                    <p className="mt-1 text-lg font-semibold text-text-primary-dark">
                      Statement on the {ordinal(card.statement_date)}
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
