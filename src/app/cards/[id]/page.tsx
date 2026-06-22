// Card detail — the "Card Document View" for a single card, reached by clicking a
// card on the /cards list.
//
// Server Component (async, per Next.js 16 conventions): it fetches via the data
// layer on the server and renders static dark-dashboard markup. This is a READ-ONLY
// document view — the only mutation affordance is an "Edit" link to a future
// /cards/[id]/edit route (not built yet).
//
// SECURITY (frontend rule 4 / SECURITY.md): the encrypted card number
// (card_number_encrypted) is NEVER read, rendered, or passed to any component on
// this page. Only card_number_last4 is ever displayed. See the explicit note at
// the masked-number render below.
//
// Next.js 16: `params` is a Promise — it MUST be awaited (see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md).

import Link from "next/link";
import { getCardById } from "@/lib/data/cards";
import { getRewardRulesByCardId } from "@/lib/data/rewardRules";
import { getMilestonesByCardId } from "@/lib/data/milestones";
import { getMilestoneTiers } from "@/lib/data/milestoneTiers";
import { getFeesByCardId } from "@/lib/data/feesAndCharges";
import { getExclusionsByCardId } from "@/lib/data/exclusions";
import { formatINR, ordinal } from "@/app/_lib/format";
import MilestoneProgressBar, {
  type ProgressTierMarker,
} from "@/app/milestones/_components/MilestoneProgressBar";
import type {
  RewardRule,
  FeeAndCharge,
  ExclusionScope,
} from "@/lib/types/schema";

// Render fresh on every request: the page reads live database rows, so a
// build-time snapshot would be stale. See src/app/CLAUDE.md frontend rule 6.
export const dynamic = "force-dynamic";

const CARD_CLASS =
  "rounded-2xl border border-white/5 bg-surface-dark p-6 shadow-lg shadow-black/20";
const SECTION_TITLE_CLASS =
  "mb-4 text-xs font-semibold uppercase tracking-wide text-text-secondary-dark";

/** Capitalise the first letter (for cadence / scope labels). */
function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Human-readable date for a UTC ISO (YYYY-MM-DD), e.g. "10 Jun 2026". */
function formatISODate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Format a reward rate per its rate_type — these are two DIFFERENT mechanics, not
 * two notations (see RewardRule.rate_type in schema.ts):
 *   "percentage"    → "5% points"  (percent of spend returned in the reward currency)
 *   "per_100_spend" → "5 miles per ₹100"  (a unit COUNT earned per ₹100 of spend)
 */
function formatRewardRate(r: RewardRule): string {
  if (r.rate_type === "percentage") {
    return `${r.multiplier_or_rate}% ${r.reward_currency}`;
  }
  return `${r.multiplier_or_rate} ${r.reward_currency} per ₹100`;
}

/** Humanise a fee_type enum value, e.g. "forex_markup" → "Forex markup". */
function humanizeFeeType(feeType: FeeAndCharge["fee_type"]): string {
  return titleCase(feeType.replace(/_/g, " "));
}

/**
 * Present a fee's amount_or_rate. forex_markup and reward_redemption are expressed
 * as percentage rates; every other fee_type is a rupee amount.
 */
function formatFeeAmount(f: FeeAndCharge): string {
  if (f.fee_type === "forex_markup" || f.fee_type === "reward_redemption") {
    return `${f.amount_or_rate}%`;
  }
  return formatINR(f.amount_or_rate);
}

/** Humanise an exclusion scope, e.g. "milestones_only" → "Milestones only". */
function humanizeScope(scope: ExclusionScope): string {
  return titleCase(scope.replace(/_/g, " "));
}

/** A label/value row for the account-details grid. */
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-text-secondary-dark">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-text-primary-dark">
        {value}
      </dd>
    </div>
  );
}

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Fetch the card first so a missing id short-circuits to the not-found state
  // before we bother loading any related rows.
  const card = await getCardById(id);

  if (!card) {
    return (
      <main className="flex-1 px-6 py-8 md:px-10">
        <div className={`${CARD_CLASS} mx-auto max-w-md text-center`}>
          <h1 className="text-lg font-semibold text-text-primary-dark">
            Card not found
          </h1>
          <p className="mt-2 text-sm text-text-secondary-dark">
            No card matches this link. It may have been removed.
          </p>
          <Link
            href="/cards"
            className="mt-5 inline-block rounded-lg bg-brand-yellow/10 px-4 py-2 text-sm font-medium text-brand-yellow hover:bg-brand-yellow/20"
          >
            ← Back to Cards
          </Link>
        </div>
      </main>
    );
  }

  // Related rows for the document sections. Fetched in parallel now that the card
  // is known to exist.
  const [rewardRules, milestones, allTiers, fees, exclusions] =
    await Promise.all([
      getRewardRulesByCardId(card.id),
      getMilestonesByCardId(card.id),
      getMilestoneTiers(),
      getFeesByCardId(card.id),
      getExclusionsByCardId(card.id),
    ]);

  // Build each milestone track the same way the Milestones page does: read STORED
  // tier values as-is (no live recompute — database as ledger of computed truth),
  // sort ascending so the highest threshold is the bar's right-edge maximum, and
  // let manual_override_achieved win over the stored `achieved` (override-wins).
  const milestoneTracks = milestones.map((milestone) => {
    const ownTiers = allTiers
      .filter((t) => t.milestone_id === milestone.id)
      .sort((a, b) => a.tier_threshold_amount - b.tier_threshold_amount);
    const progress = ownTiers[0]?.current_progress_amount ?? 0;
    const markers: ProgressTierMarker[] = ownTiers.map((t) => ({
      id: t.id,
      threshold: t.tier_threshold_amount,
      rewardValue: t.reward_value,
      rewardUnit: t.reward_unit,
      achieved:
        t.manual_override_achieved !== null
          ? t.manual_override_achieved
          : t.achieved,
      isManualOverride: t.manual_override_achieved !== null,
    }));
    return { milestone, markers, progress };
  });

  return (
    <main className="flex-1 space-y-8 px-6 py-8 md:px-10">
      {/* Breadcrumb back to the list */}
      <Link
        href="/cards"
        className="inline-block text-sm text-text-secondary-dark hover:text-text-primary-dark"
      >
        ← Cards
      </Link>

      {/* Header: identity, network, status, expiry, edit */}
      <header className={CARD_CLASS}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-text-primary-dark">
                {card.card_name}
              </h1>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  card.active
                    ? "bg-brand-yellow/10 text-brand-yellow"
                    : "bg-white/5 text-text-secondary-dark"
                }`}
              >
                {card.active ? "Active" : "Inactive"}
              </span>
            </div>
            <p className="mt-1 text-sm text-text-secondary-dark">
              {card.card_bank} · {card.card_holder}
            </p>

            {/* SECURITY: only card_number_last4 is read here. The encrypted number
                (card_number_encrypted) is deliberately never referenced on this
                page — see the file header note and frontend rule 4. */}
            <p className="mt-4 font-mono text-sm tracking-wider text-text-secondary-dark">
              •••• •••• •••• {card.card_number_last4}
            </p>
            <p className="mt-2 text-xs text-text-secondary-dark">
              {card.card_type} · Expires{" "}
              {String(card.expiry_month).padStart(2, "0")}/{card.expiry_year}
            </p>
          </div>

          <Link
            href={`/cards/${card.id}/edit`}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-text-primary-dark hover:border-brand-yellow/40 hover:text-brand-yellow"
          >
            Edit
          </Link>
        </div>
      </header>

      {/* Reward rates */}
      <section className={CARD_CLASS}>
        <h2 className={SECTION_TITLE_CLASS}>Reward Rates</h2>
        {rewardRules.length === 0 ? (
          <p className="text-sm text-text-secondary-dark">
            No reward rules recorded for this card.
          </p>
        ) : (
          <ul className="divide-y divide-white/5">
            {rewardRules.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
              >
                <div>
                  <p className="text-sm font-medium text-text-primary-dark">
                    {r.category}
                  </p>
                  {r.monthly_cap !== null && (
                    <p className="text-xs text-text-secondary-dark">
                      Capped at{" "}
                      {r.monthly_cap.toLocaleString("en-IN")}
                      {r.cap_unit ? ` ${r.cap_unit}` : ""}/month
                    </p>
                  )}
                </div>
                <span className="text-sm font-semibold tabular-nums text-brand-yellow">
                  {formatRewardRate(r)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Milestones — reuses MilestoneProgressBar from the Milestones page */}
      <section className={CARD_CLASS}>
        <h2 className={SECTION_TITLE_CLASS}>Milestones</h2>
        {milestoneTracks.length === 0 ? (
          <p className="text-sm text-text-secondary-dark">
            No milestone tracks on this card.
          </p>
        ) : (
          <div className="space-y-8">
            {milestoneTracks.map(({ milestone, markers, progress }) => (
              <div key={milestone.id}>
                <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="text-base font-semibold text-text-primary-dark">
                    {milestone.track_name}
                  </h3>
                  <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-xs font-medium text-text-secondary-dark">
                    {titleCase(milestone.cycle_frequency)} ·{" "}
                    {titleCase(milestone.cycle_anchor)}
                  </span>
                </div>
                <p className="-mt-3 mb-5 text-xs text-text-secondary-dark">
                  Cycle: {formatISODate(milestone.cycle_start_date)} —{" "}
                  {formatISODate(milestone.cycle_end_date)}
                </p>
                <MilestoneProgressBar
                  currentProgress={progress}
                  tiers={markers}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Fees & charges */}
      <section className={CARD_CLASS}>
        <h2 className={SECTION_TITLE_CLASS}>Fees &amp; Charges</h2>
        {fees.length === 0 ? (
          <p className="text-sm text-text-secondary-dark">
            No fees or charges recorded for this card.
          </p>
        ) : (
          <ul className="divide-y divide-white/5">
            {fees.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
              >
                <div className="max-w-md">
                  <p className="text-sm font-medium text-text-primary-dark">
                    {humanizeFeeType(f.fee_type)}
                  </p>
                  {f.waiver_condition && (
                    <p className="text-xs text-text-secondary-dark">
                      {f.waiver_condition}
                    </p>
                  )}
                </div>
                <span className="text-sm font-semibold tabular-nums text-text-primary-dark">
                  {formatFeeAmount(f)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Exclusions */}
      <section className={CARD_CLASS}>
        <h2 className={SECTION_TITLE_CLASS}>Exclusions</h2>
        {exclusions.length === 0 ? (
          <p className="text-sm text-text-secondary-dark">
            No exclusions recorded for this card.
          </p>
        ) : (
          <ul className="divide-y divide-white/5">
            {exclusions.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
              >
                <div className="max-w-md">
                  <p className="text-sm font-medium text-text-primary-dark">
                    {e.excluded_category}
                  </p>
                  {e.notes && (
                    <p className="text-xs text-text-secondary-dark">
                      {e.notes}
                    </p>
                  )}
                </div>
                <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-xs font-medium text-text-secondary-dark">
                  {humanizeScope(e.applies_to)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Account details */}
      <section className={CARD_CLASS}>
        <h2 className={SECTION_TITLE_CLASS}>Account Details</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          <DetailRow label="Credit Limit" value={formatINR(card.credit_limit)} />
          <DetailRow
            label="Statement Date"
            value={`${ordinal(card.statement_date)} of each month`}
          />
          <DetailRow
            label="Payment Deadline"
            value={`${card.payment_deadline_days} days after statement`}
          />
          <DetailRow
            label="Customer Care"
            value={card.customer_care_number}
          />
          <DetailRow label="Registered Phone" value={card.registered_phone} />
          <DetailRow label="Registered Email" value={card.registered_email} />
          <DetailRow label="Annual Fee" value={formatINR(card.annual_fee)} />
          <DetailRow
            label="Renewal Date"
            value={formatISODate(card.renewal_date)}
          />
          <DetailRow
            label="Issuance Date"
            value={formatISODate(card.issuance_date)}
          />
        </dl>
      </section>
    </main>
  );
}
