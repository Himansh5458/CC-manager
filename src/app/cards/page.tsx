// Cards list — read-only dashboard view of every active card.
//
// Server Component (async, per Next.js 16 conventions): it fetches via the data
// layer (getCards) on the server and renders static markup. No add/edit here —
// that's a separate step. Add/edit and per-card detail are intentionally absent.

import Link from "next/link";
import { getCards } from "@/lib/data/cards";
import {
  getEffectiveUtilization,
  type ComputedBalance,
} from "@/lib/calculations/cardBalance";
import { daysUntilDue } from "@/lib/calculations/dueDate";
import {
  formatINR,
  ordinal,
  utilizationColorClass,
  utilizationBarClass,
  dueColorClass,
} from "@/app/_lib/format";

// Render fresh on every request rather than prerendering at build time.
// "Due in X days" and utilization depend on the actual current date and the
// live database, so a build-time snapshot would be stale. See src/app/CLAUDE.md.
export const dynamic = "force-dynamic";

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
              <Link
                key={card.id}
                href={`/cards/${card.id}`}
                className="block rounded-2xl border border-white/5 bg-surface-dark p-6 shadow-lg shadow-black/20 transition hover:border-brand-yellow/30 hover:shadow-black/40"
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
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
