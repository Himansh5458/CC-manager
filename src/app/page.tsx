// Dashboard — the app's home screen.
//
// Server Component (async, per Next.js 16 conventions): it fetches everything via
// the data layer on the server and renders static dark-dashboard markup. It is the
// densest page in the app — six stacked sections, each a different view onto the
// same live data — so it leans on the shared calculation modules in
// src/lib/calculations/ rather than recomputing anything inline (src/lib/CLAUDE.md
// rule 2) and on the shared presentational helpers in src/app/_lib/format.ts so its
// colour coding can never drift from the Cards page.
//
// Sections (see src/app/CLAUDE.md for the data-dependency table):
//   1. Due dates      — outstanding + days-to-deadline per card, soonest first.
//   2. Utilization    — every card's effective utilization, banded.
//   3. This month     — spend within each card's OWN open statement cycle, summed.
//   4. Insights       — anomaly + milestone-proximity nudges as one text list.
//   5. Predicted bill — next-statement forecast per card, with its breakdown.
//   6. Family cap     — payments-this-FY per parent_family against the ₹8L cap.

import { getCards } from "@/lib/data/cards";
import { getTransactions } from "@/lib/data/transactions";
import { getPayments } from "@/lib/data/payments";
import { getRecurringTransactions } from "@/lib/data/recurringTransactions";
import { getMilestones } from "@/lib/data/milestones";
import { getMilestoneTiers } from "@/lib/data/milestoneTiers";
import { getFamilyCapTrackers } from "@/lib/data/familyCapTracker";
import {
  recomputeCardBalance,
  getEffectiveUtilization,
  mostRecentStatementDate,
  type ComputedBalance,
} from "@/lib/calculations/cardBalance";
import { daysUntilDue } from "@/lib/calculations/dueDate";
import {
  predictNextBill,
  detectSpendAnomalies,
  getMilestoneProximityNudges,
} from "@/lib/calculations/insights";
import {
  getFinancialYear,
  getFinancialYearBounds,
} from "@/lib/calculations/fyDates";
import {
  formatINR,
  utilizationColorClass,
  utilizationBarClass,
  dueColorClass,
  capColorClass,
  capBarClass,
} from "@/app/_lib/format";

// Render fresh on every request rather than prerendering at build time. Every
// section depends on the current date and the live database, so a build-time
// snapshot would be stale. See src/app/CLAUDE.md.
export const dynamic = "force-dynamic";

// The family spend cap (₹8,00,000 per parent_family per financial year). A named
// constant so it is tunable in one place; the FamilyCapTracker tab may override it
// per row, but the cap is never *required* to be pre-populated there.
const FAMILY_CAP = 800000;

/** UTC YYYY-MM-DD for a UTC-midnight Date (cycle boundaries are UTC, see cardBalance). */
function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Section wrapper: a labelled heading plus its content, evenly spaced. */
function Section({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-primary-dark">{title}</h2>
        {caption && (
          <p className="mt-0.5 text-sm text-text-secondary-dark">{caption}</p>
        )}
      </div>
      {children}
    </section>
  );
}

const CARD_CLASS =
  "rounded-2xl border border-white/5 bg-surface-dark p-5 shadow-lg shadow-black/20";

export default async function DashboardPage() {
  const today = new Date();

  const [
    cards,
    transactions,
    payments,
    recurring,
    milestones,
    tiers,
    capTrackers,
  ] = await Promise.all([
    getCards(),
    getTransactions(),
    getPayments(),
    getRecurringTransactions(),
    getMilestones(),
    getMilestoneTiers(),
    getFamilyCapTrackers(),
  ]);

  const activeCards = cards.filter((c) => c.active);

  // Compute each card's current-cycle balance once and reuse across sections.
  const balances = new Map<string, ComputedBalance>(
    activeCards.map((c) => [
      c.id,
      recomputeCardBalance(c, transactions, payments, today),
    ]),
  );

  // ── 1. Due dates ────────────────────────────────────────────────────────────
  const dueRows = activeCards
    .map((card) => ({
      card,
      outstanding: balances.get(card.id)!.outstandingBalance,
      days: daysUntilDue(card, today),
    }))
    // Soonest deadline first; cards whose deadline has already passed (null) sort
    // last, since there is no upcoming countdown to rank them by.
    .sort(
      (a, b) =>
        (a.days ?? Number.POSITIVE_INFINITY) -
        (b.days ?? Number.POSITIVE_INFINITY),
    );

  // ── 2. Utilization ──────────────────────────────────────────────────────────
  const utilRows = activeCards.map((card) => ({
    card,
    util: getEffectiveUtilization(card, balances.get(card.id)!),
    overridden: card.manual_override_utilization_pct !== null,
  }));

  // ── 3. This month's spend (each card's OWN open statement cycle) ─────────────
  const categoryTotals = new Map<string, number>();
  let monthTotal = 0;
  for (const card of activeCards) {
    const cycleStartISO = toISODate(
      mostRecentStatementDate(card.statement_date, today),
    );
    for (const t of transactions) {
      if (t.card_id !== card.id) continue;
      if (t.date < cycleStartISO) continue; // before this card's cycle start
      monthTotal += t.amount;
      categoryTotals.set(
        t.category,
        (categoryTotals.get(t.category) ?? 0) + t.amount,
      );
    }
  }
  const categoryRows = [...categoryTotals.entries()].sort(
    (a, b) => b[1] - a[1],
  );

  // ── 4. Insights (anomalies + milestone-proximity nudges) ────────────────────
  const insights: string[] = [];
  for (const card of activeCards) {
    for (const a of detectSpendAnomalies(card, transactions, today)) {
      insights.push(
        `${a.category} spend is ${a.percentAboveAverage}% above its usual this cycle on ${card.card_name}.`,
      );
    }
    const cardMilestones = milestones.filter((m) => m.card_id === card.id);
    for (const n of getMilestoneProximityNudges(cardMilestones, tiers, today)) {
      insights.push(
        `${formatINR(n.amountRemaining)} more on ${card.card_name} unlocks your next ${n.trackName} tier — ${n.rewardDescription}.`,
      );
    }
  }

  // ── 5. Predicted next bill ──────────────────────────────────────────────────
  const predictions = activeCards.map((card) => ({
    card,
    prediction: predictNextBill(card, transactions, payments, recurring, today),
  }));

  // ── 6. Family cap tracker ───────────────────────────────────────────────────
  const fy = getFinancialYear(today);
  const { start: fyStart, end: fyEnd } = getFinancialYearBounds(fy);
  const families = [...new Set(activeCards.map((c) => c.parent_family))];
  const familyRows = families.map((family) => {
    const familyCardIds = new Set(
      activeCards.filter((c) => c.parent_family === family).map((c) => c.id),
    );
    // Compute fresh from raw payments within the FY — the FamilyCapTracker tab is a
    // cache, not a hard dependency, so a missing row must not break this section.
    const freshPaid = payments
      .filter(
        (p) =>
          familyCardIds.has(p.card_id) &&
          p.date >= fyStart &&
          p.date <= fyEnd,
      )
      .reduce((sum, p) => sum + p.amount, 0);
    const record = capTrackers.find(
      (t) => t.family_key === family && t.financial_year === fy,
    );
    // A manual override (when a cached row carries one) wins over the recomputed
    // figure, mirroring the "manual override always wins" rule used elsewhere.
    const totalPaid = record?.manual_override_total_paid ?? freshPaid;
    const cap = record?.cap_amount ?? FAMILY_CAP;
    const pct = cap > 0 ? (totalPaid / cap) * 100 : 0;
    return {
      family,
      totalPaid,
      cap,
      pct,
      remaining: Math.max(cap - totalPaid, 0),
    };
  });

  return (
    <main className="flex-1 space-y-12 px-6 py-8 md:px-10">
      <header>
        <h1 className="text-2xl font-semibold text-text-primary-dark">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-text-secondary-dark">
          {activeCards.length} active{" "}
          {activeCards.length === 1 ? "card" : "cards"} · FY {fy}
        </p>
      </header>

      {activeCards.length === 0 ? (
        <p className="text-text-secondary-dark">No active cards.</p>
      ) : (
        <>
          {/* ── 1. Due dates ──────────────────────────────────────────────── */}
          <Section
            title="Payment due dates"
            caption="Outstanding balance and days until each card's payment deadline, soonest first."
          >
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {dueRows.map(({ card, outstanding, days }) => (
                <article key={card.id} className={CARD_CLASS}>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-base font-semibold text-text-primary-dark">
                      {card.card_name}
                    </h3>
                    <span className="font-mono text-xs tracking-wider text-text-secondary-dark">
                      •••• {card.card_number_last4}
                    </span>
                  </div>
                  <div className="mt-4">
                    <p className="text-xs uppercase tracking-wide text-text-secondary-dark">
                      Outstanding
                    </p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary-dark">
                      {formatINR(outstanding)}
                    </p>
                  </div>
                  <div className="mt-4">
                    {days !== null ? (
                      <p
                        className={`text-lg font-semibold ${dueColorClass(days)}`}
                      >
                        Due in {days} {days === 1 ? "day" : "days"}
                      </p>
                    ) : (
                      <p className="text-lg font-semibold text-text-secondary-dark">
                        No upcoming deadline
                      </p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </Section>

          {/* ── 2. Utilization ────────────────────────────────────────────── */}
          <Section
            title="Utilization"
            caption="Effective utilization per card (manual overrides applied)."
          >
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {utilRows.map(({ card, util, overridden }) => (
                <article key={card.id} className={CARD_CLASS}>
                  <div className="flex items-baseline justify-between">
                    <p className="text-sm font-medium text-text-primary-dark">
                      {card.card_name}
                      {overridden && (
                        <span className="ml-1.5 text-xs text-info">
                          (manual)
                        </span>
                      )}
                    </p>
                    <p
                      className={`text-xl font-semibold tabular-nums ${utilizationColorClass(util)}`}
                    >
                      {util.toFixed(1)}%
                    </p>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full ${utilizationBarClass(util)}`}
                      style={{ width: `${Math.min(util, 100)}%` }}
                    />
                  </div>
                </article>
              ))}
            </div>
          </Section>

          {/* ── 3. This month's spend ─────────────────────────────────────── */}
          <Section
            title="This month's spend"
            caption="Spend within each card's own current statement cycle, summed across cards — not a calendar-month total (cards have different cycle boundaries)."
          >
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              <article className={`${CARD_CLASS} lg:col-span-1`}>
                <p className="text-xs uppercase tracking-wide text-text-secondary-dark">
                  Total across cards
                </p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-text-primary-dark">
                  {formatINR(monthTotal)}
                </p>
              </article>
              <article className={`${CARD_CLASS} lg:col-span-2`}>
                <p className="text-xs uppercase tracking-wide text-text-secondary-dark">
                  By category
                </p>
                {categoryRows.length === 0 ? (
                  <p className="mt-3 text-sm text-text-secondary-dark">
                    No spend in any current cycle yet.
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-white/5">
                    {categoryRows.map(([category, amount]) => (
                      <li
                        key={category}
                        className="flex items-center justify-between py-2 text-sm"
                      >
                        <span className="text-text-secondary-dark">
                          {category}
                        </span>
                        <span className="font-medium tabular-nums text-text-primary-dark">
                          {formatINR(amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </div>
          </Section>

          {/* ── 4. Insights ───────────────────────────────────────────────── */}
          <Section
            title="Insights"
            caption="Spend anomalies and milestone nudges across your active cards."
          >
            <article className={CARD_CLASS}>
              {insights.length === 0 ? (
                <p className="text-sm text-text-secondary-dark">
                  Nothing notable right now.
                </p>
              ) : (
                <ul className="space-y-3">
                  {insights.map((text, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span
                        aria-hidden
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-yellow"
                      />
                      <span className="text-text-primary-dark">{text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </Section>

          {/* ── 5. Predicted next bill ────────────────────────────────────── */}
          <Section
            title="Predicted next bill"
            caption="Forecast for each card's next statement, with how it was derived."
          >
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {predictions.map(({ card, prediction }) => (
                <article key={card.id} className={CARD_CLASS}>
                  <h3 className="text-base font-semibold text-text-primary-dark">
                    {card.card_name}
                  </h3>
                  <p className="mt-3 text-2xl font-semibold tabular-nums text-text-primary-dark">
                    {formatINR(prediction.predictedAmount)}
                  </p>
                  <p className="mt-2 text-sm text-text-secondary-dark">
                    {prediction.breakdown}
                  </p>
                </article>
              ))}
            </div>
          </Section>

          {/* ── 6. Family cap tracker ─────────────────────────────────────── */}
          <Section
            title="Family spend cap"
            caption={`Payments this financial year (${fy}) per family, against the ${formatINR(FAMILY_CAP)} cap.`}
          >
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {familyRows.map(({ family, totalPaid, cap, pct, remaining }) => (
                <article key={family} className={CARD_CLASS}>
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-base font-semibold text-text-primary-dark">
                      {family}
                    </h3>
                    <p
                      className={`text-sm font-semibold tabular-nums ${capColorClass(pct)}`}
                    >
                      {pct.toFixed(1)}%
                    </p>
                  </div>
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full ${capBarClass(pct)}`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="tabular-nums text-text-secondary-dark">
                      {formatINR(totalPaid)} / {formatINR(cap)}
                    </span>
                    <span className="tabular-nums text-text-secondary-dark">
                      {formatINR(remaining)} left
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </Section>
        </>
      )}
    </main>
  );
}
