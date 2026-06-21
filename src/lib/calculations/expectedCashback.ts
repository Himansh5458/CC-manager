// expectedCashback.ts — expected reward value of a prospective purchase.
//
// Part of src/lib/calculations/, the home for pure business logic (see
// src/lib/CLAUDE.md rule 2). Given a hypothetical purchase (amount + category),
// this estimates how much value a card would return — both its direct earn rate
// and the marginal pull the spend gives toward each milestone tier — so the UI
// can rank cards for "which card should I swipe for this?". It NEVER reads or
// writes the database; the caller supplies every row (same pure-function contract
// as cardBalance.ts / milestoneProgress.ts).
//
// ── Direct reward value ──────────────────────────────────────────────────────
// Branches on rate_type, which encodes two GENUINELY DIFFERENT reward mechanics
// (not two notations for one rate — see /DECISIONS.md 2026-06-21):
//   "percentage"    → the rate is a percent of spend returned directly as
//                     rupee-equivalent value. value = amount * (rate / 100).
//                     redemption_value_per_unit is NOT applied — the percent is
//                     already the rupee conversion (e.g. "5% CashPoints" on ₹1000
//                     = ₹50 regardless of whatever per-unit value is stored).
//   "per_100_spend" → the rate is a COUNT of units (points/miles) earned per Rs
//                     100 of spend, a separate currency until converted. value =
//                     (amount / 100) * rate * redemption_value_per_unit.
//
// rate_type was assigned from the seed source_dump_text: HDFC Millennia's "5%
// CashPoints" is percentage; Axis Atlas's "5 EDGE Miles per Rs 100" is
// per_100_spend (/DECISIONS.md 2026-06-21).
//
// monthly_cap is deliberately IGNORED here — full cap headroom is always assumed,
// no history lookup (explicit design decision, /DECISIONS.md 2026-06-20 cap note
// / 2026-06-21).
//
// ── Milestone contribution value ─────────────────────────────────────────────
// Each rupee of spend nudges every not-yet-achieved tier toward its threshold; the
// marginal value of this purchase toward a tier is its reward (in rupees) scaled by
// the fraction of the threshold this amount represents:
//   contribution = (reward_value * redemption_value_per_unit / threshold) * amount
// summed over every active milestone's not-yet-achieved tiers. Each tier carries
// its OWN redemption_value_per_unit (schema field), so the reward's rupee value is
// read directly off the tier — never inferred.
//
// ── Rounding ─────────────────────────────────────────────────────────────────
// directRewardValue and milestoneContributionValue are each rounded to 2 dp, and
// totalExpectedValue is their (already-rounded) sum, so the parts always add up to
// the total shown.

import type {
  Card,
  RewardRule,
  Milestone,
  MilestoneTier,
  Exclusion,
} from "../types/schema";

export interface ExpectedCashback {
  cardId: string;
  directRewardValue: number;
  milestoneContributionValue: number;
  totalExpectedValue: number;
  breakdown: string;
}

/** Round to `dp` decimal places without binary-float drift (e.g. 8.3349→8.33). */
function roundTo(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/** Case-insensitive string equality (trimmed), for category/currency matching. */
function eqIgnoreCase(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Format a rupee figure for the human-readable breakdown string. */
function rupees(value: number): string {
  return `₹${roundTo(value, 2).toFixed(2)}`;
}

/**
 * Estimate the value a single card returns for a prospective `amount` spent in
 * `category`: its direct earn plus the marginal pull toward every active
 * milestone tier. Pure — every row is supplied by the caller.
 *
 * Exclusions for this card whose excluded_category matches `category` zero out
 * the direct value (applies_to "all_rewards" | "direct_rewards_only") and/or the
 * milestone value (applies_to "all_rewards" | "milestones_only").
 */
export function calculateExpectedCashback(
  card: Card,
  amount: number,
  category: string,
  rewardRules: RewardRule[],
  milestones: Milestone[],
  milestoneTiers: MilestoneTier[],
  exclusions: Exclusion[],
): ExpectedCashback {
  const cardRules = rewardRules.filter((r) => r.card_id === card.id);

  // ── 1. Exclusions ──────────────────────────────────────────────────────────
  // A card can be excluded from direct rewards, milestones, or both for this
  // category, depending on each matching exclusion's applies_to.
  let directExcluded = false;
  let milestoneExcluded = false;
  for (const ex of exclusions) {
    if (ex.card_id !== card.id) continue;
    if (!eqIgnoreCase(ex.excluded_category, category)) continue;
    if (ex.applies_to === "all_rewards" || ex.applies_to === "direct_rewards_only") {
      directExcluded = true;
    }
    if (ex.applies_to === "all_rewards" || ex.applies_to === "milestones_only") {
      milestoneExcluded = true;
    }
  }

  // ── 2. Direct reward value ───────────────────────────────────────────────────
  let directRewardValue = 0;
  let directBreakdown: string;
  if (directExcluded) {
    directBreakdown = "no direct reward (category excluded)";
  } else {
    // Exact category match, else fall back to the card's "Other" rule.
    const rule =
      cardRules.find((r) => eqIgnoreCase(r.category, category)) ??
      cardRules.find((r) => eqIgnoreCase(r.category, "Other")) ??
      null;
    if (!rule) {
      directBreakdown = "no matching reward rule";
    } else if (rule.rate_type === "percentage") {
      // Percent of spend, already in rupee-equivalent terms — redemption_value_per_unit
      // is NOT applied (the percent IS the conversion).
      directRewardValue = amount * (rule.multiplier_or_rate / 100);
      const label =
        rule.reward_currency === "cashback" ? "cashback" : rule.reward_currency;
      directBreakdown = `${rule.multiplier_or_rate}% ${label} (${rupees(directRewardValue)})`;
    } else {
      // per_100_spend: units earned per Rs 100, converted to rupees via redemption.
      directRewardValue =
        (amount / 100) * rule.multiplier_or_rate * rule.redemption_value_per_unit;
      directBreakdown = `${rule.multiplier_or_rate} ${rule.reward_currency}/₹100 (${rupees(directRewardValue)})`;
    }
  }
  directRewardValue = roundTo(directRewardValue, 2);

  // ── 3. Milestone contribution value ──────────────────────────────────────────
  let milestoneContributionValue = 0;
  let milestoneBreakdown: string;
  if (milestoneExcluded) {
    milestoneBreakdown = "no milestone contribution (category excluded)";
  } else {
    const activeMilestones = milestones.filter(
      (m) => m.card_id === card.id && m.active,
    );
    for (const ms of activeMilestones) {
      const tiers = milestoneTiers.filter((t) => t.milestone_id === ms.id);
      for (const tier of tiers) {
        // No point counting contribution toward an already-achieved tier, or one
        // the user has manually flagged achieved.
        if (tier.achieved) continue;
        if (tier.manual_override_achieved === true) continue;
        if (tier.tier_threshold_amount <= 0) continue;
        milestoneContributionValue +=
          ((tier.reward_value * tier.redemption_value_per_unit) /
            tier.tier_threshold_amount) *
          amount;
      }
    }
    milestoneContributionValue = roundTo(milestoneContributionValue, 2);
    milestoneBreakdown =
      milestoneContributionValue > 0
        ? `milestone contribution (${rupees(milestoneContributionValue)})`
        : "no milestone contribution";
  }

  // ── 4. Total (parts already rounded, so they add up to the displayed total) ──
  const totalExpectedValue = roundTo(
    directRewardValue + milestoneContributionValue,
    2,
  );

  return {
    cardId: card.id,
    directRewardValue,
    milestoneContributionValue,
    totalExpectedValue,
    breakdown: `${directBreakdown} + ${milestoneBreakdown}`,
  };
}

/**
 * Rank the user's active cards for a prospective purchase, best first.
 *
 * Filters to active cards, scores each with calculateExpectedCashback, sorts
 * descending by totalExpectedValue, and returns only the TOP 5 (explicit design
 * decision — the UI shows the five best options, not every card; /DECISIONS.md
 * 2026-06-21). Returns fewer than 5 when fewer active cards exist.
 */
export function rankCardsForPurchase(
  cards: Card[],
  amount: number,
  category: string,
  allRewardRules: RewardRule[],
  allMilestones: Milestone[],
  allMilestoneTiers: MilestoneTier[],
  allExclusions: Exclusion[],
): ExpectedCashback[] {
  return cards
    .filter((c) => c.active)
    .map((c) =>
      calculateExpectedCashback(
        c,
        amount,
        category,
        allRewardRules,
        allMilestones,
        allMilestoneTiers,
        allExclusions,
      ),
    )
    .sort((a, b) => b.totalExpectedValue - a.totalExpectedValue)
    .slice(0, 5);
}
