// Standalone unit test for the expected-cashback / card-ranking logic.
//
// Run with: npx tsx src/lib/calculations/expectedCashback.test.ts
//
// Unlike the other calculations tests (which build in-memory fixtures), this one
// reads the COMMITTED seed database read-only and asserts against it directly, so
// it doubles as a guard that the documented reward math still matches the real
// seed rows (e.g. the rate_type assignments). It never writes, so — like the other
// pure-logic tests — it needs no snapshot/restore. Reading the JSON here (not via
// the data layer) is a deliberate test-only read; production calc code stays pure
// and DB-free.

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  calculateExpectedCashback,
  rankCardsForPurchase,
} from "./expectedCashback";
import type {
  Database,
  Card,
  RewardRule,
  MilestoneTier,
  Exclusion,
} from "../types/schema";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
  }
}

/** Float-tolerant equality for rupee figures. */
function approx(a: number, b: number, eps = 0.005): boolean {
  return Math.abs(a - b) <= eps;
}

const db = JSON.parse(
  readFileSync(path.join(process.cwd(), "data", "database.json"), "utf-8"),
) as Database;

const cards = db.cards;
const rewardRules = db.rewardRules;
const milestones = db.milestones;
const milestoneTiers = db.milestoneTiers;
const exclusions = db.exclusions;

const millennia = cards.find((c) => c.id === "card-millennia-001")!;
const atlas = cards.find((c) => c.id === "card-atlas-001")!;

function main(): void {
  // ── Millennia, Dining 500 ────────────────────────────────────────────────────
  // Direct: rr-mill-dining is rate_type "percentage" (from "5% CashPoints"), rate 5
  // → amount * 5/100 = 500 * 0.05 = 25. redemption_value_per_unit is NOT applied to
  // a percentage rule.
  // Milestone (highest_only quarterly, all 3 tiers un-achieved, each redemption 1):
  //   (500*1/50000)*500 + (1500*1/100000)*500 + (2500*1/150000)*500
  //   = 5 + 7.5 + 8.3333… = 20.8333 → 20.83.
  const mill = calculateExpectedCashback(
    millennia,
    500,
    "Dining",
    rewardRules,
    milestones,
    milestoneTiers,
    exclusions,
  );
  check("Millennia Dining 500: direct reward = 25 (percentage 5% of 500)", mill.directRewardValue === 25);
  const millExpectedMs =
    ((500 * 1) / 50000) * 500 + ((1500 * 1) / 100000) * 500 + ((2500 * 1) / 150000) * 500;
  check(
    `Millennia Dining 500: milestone contribution ≈ ${millExpectedMs.toFixed(4)} (got ${mill.milestoneContributionValue})`,
    approx(mill.milestoneContributionValue, millExpectedMs),
  );
  check("Millennia Dining 500: milestone contribution rounded to 20.83", mill.milestoneContributionValue === 20.83);
  check("Millennia Dining 500: total = direct + milestone (45.83)", mill.totalExpectedValue === 45.83);
  check("Millennia Dining 500: cardId echoed", mill.cardId === "card-millennia-001");
  check("Millennia Dining 500: breakdown shows the percentage + milestone parts",
    mill.breakdown.includes("5% points") && mill.breakdown.includes("milestone contribution"));

  // ── Atlas, Travel 500 ────────────────────────────────────────────────────────
  // Direct: rr-atlas-travel is rate_type "per_100_spend" (from "5 EDGE Miles per Rs
  // 100"), rate 5, redemption 1 → (500/100)*5*1 = 25.
  // Milestone (cumulative annual, 3 un-achieved tiers, each redemption 1):
  //   (2500/300000)*500 + (5000/750000)*500 + (10000/1500000)*500
  //   = 4.1667 + 3.3333 + 3.3333 = 10.8333 → 10.83.
  const atl = calculateExpectedCashback(
    atlas,
    500,
    "Travel",
    rewardRules,
    milestones,
    milestoneTiers,
    exclusions,
  );
  check("Atlas Travel 500: direct reward = 25 (per_100_spend 5 miles/₹100 × 1 redemption)", atl.directRewardValue === 25);
  const atlExpectedMs =
    ((2500 * 1) / 300000) * 500 + ((5000 * 1) / 750000) * 500 + ((10000 * 1) / 1500000) * 500;
  check(
    `Atlas Travel 500: milestone contribution ≈ ${atlExpectedMs.toFixed(4)} (got ${atl.milestoneContributionValue})`,
    approx(atl.milestoneContributionValue, atlExpectedMs),
  );
  check("Atlas Travel 500: milestone contribution rounded to 10.83", atl.milestoneContributionValue === 10.83);
  check("Atlas Travel 500: total = 35.83", atl.totalExpectedValue === 35.83);
  check("Atlas Travel 500: breakdown shows the per-₹100 part", atl.breakdown.includes("5 miles/₹100"));

  // ── rate_type "percentage" IGNORES redemption_value_per_unit ─────────────────
  // The corrected percentage formula is amount * (rate/100), full stop. Prove the
  // stored redemption value is irrelevant: a percentage rule with redemption 99 on
  // ₹1000 at rate 5 must still be exactly 1000 * 0.05 = 50, NOT 50*99.
  const pctRuleHugeRedemption: RewardRule = {
    id: "rr-pct-huge",
    card_id: millennia.id,
    category: "TestCat",
    reward_currency: "points",
    rate_type: "percentage",
    multiplier_or_rate: 5,
    redemption_value_per_unit: 99, // deliberately absurd — must be ignored
    monthly_cap: null,
    cap_unit: null,
    source_dump_text: "synthetic 5% percentage rule with absurd redemption",
    extracted_date: "2026-06-21",
  };
  const pctIgnores = calculateExpectedCashback(
    millennia,
    1000,
    "TestCat",
    [pctRuleHugeRedemption],
    [],
    [],
    [],
  );
  check("percentage ignores redemption: 5% of 1000 = 50 even with redemption 99", pctIgnores.directRewardValue === 50);

  // ── percentage vs per_100_spend produce DIFFERENT results (same multiplier) ──
  // SAME multiplier_or_rate (5), SAME redemption (4), SAME amount (1000), differing
  // ONLY in rate_type — and they diverge, because they model different mechanics:
  //   percentage:    amount * (rate/100)             = 1000 * (5/100)      = 50
  //                  (redemption NOT applied)
  //   per_100_spend: (amount/100) * rate * redemption = (1000/100) * 5 * 4 = 200
  // 50 ≠ 200 — the distinction is unambiguous and redemption (4) is the differentiator
  // that only the per_100_spend branch uses.
  const base = {
    card_id: millennia.id,
    category: "TestCat",
    reward_currency: "points" as const,
    multiplier_or_rate: 5,
    redemption_value_per_unit: 4,
    monthly_cap: null,
    cap_unit: null,
    source_dump_text: "",
    extracted_date: "2026-06-21",
  };
  const pctRule: RewardRule = { ...base, id: "rr-cmp-pct", rate_type: "percentage" };
  const per100Rule: RewardRule = { ...base, id: "rr-cmp-per100", rate_type: "per_100_spend" };
  const pctResult = calculateExpectedCashback(millennia, 1000, "TestCat", [pctRule], [], [], []);
  const per100Result = calculateExpectedCashback(millennia, 1000, "TestCat", [per100Rule], [], [], []);
  check("percentage branch: 1000 @ rate 5 = 50 (redemption 4 ignored)", pctResult.directRewardValue === 50);
  check("per_100_spend branch: 1000 @ rate 5 × redemption 4 = 200", per100Result.directRewardValue === 200);
  check("percentage ≠ per_100_spend for identical multiplier/redemption (50 ≠ 200)",
    pctResult.directRewardValue !== per100Result.directRewardValue);

  // ── Category with no matching rule → falls back to the card's "Other" rule ────
  // Millennia has no "Groceries" rule; Other is rate_type "percentage", rate 1 →
  // 1000 * 1/100 = 10.
  const fallback = calculateExpectedCashback(
    millennia,
    1000,
    "Groceries",
    rewardRules,
    milestones,
    milestoneTiers,
    exclusions,
  );
  check("Millennia Groceries 1000: falls back to Other rule → direct = 10", fallback.directRewardValue === 10);
  check("Millennia Groceries 1000: breakdown shows the 1% Other rate", fallback.breakdown.includes("1% points"));

  // No rule at all (no category match, no Other rule on this card) → direct 0.
  const noRules: RewardRule[] = [];
  const noRule = calculateExpectedCashback(
    millennia,
    1000,
    "Groceries",
    noRules,
    milestones,
    milestoneTiers,
    exclusions,
  );
  check("No reward rule on card → direct reward = 0", noRule.directRewardValue === 0);
  check("No reward rule → breakdown says so", noRule.breakdown.includes("no matching reward rule"));

  // ── cashback currency under rate_type percentage (no seed rule uses cashback) ─
  // 5% cashback, 500 → 500 * (5/100) = 25, with a percent breakdown labelled "cashback".
  const cashbackRule: RewardRule = {
    id: "rr-synth-cashback",
    card_id: millennia.id,
    category: "Dining",
    reward_currency: "cashback",
    rate_type: "percentage",
    multiplier_or_rate: 5,
    redemption_value_per_unit: 1,
    monthly_cap: null,
    cap_unit: null,
    source_dump_text: "synthetic 5% cashback",
    extracted_date: "2026-06-21",
  };
  const cashback = calculateExpectedCashback(
    millennia,
    500,
    "Dining",
    [cashbackRule],
    [], // no milestones — isolate the direct-reward branch
    [],
    [],
  );
  check("cashback percentage: 5% of 500 = 25", cashback.directRewardValue === 25);
  check("cashback percentage: breakdown uses '% cashback'", cashback.breakdown.includes("5% cashback"));

  // ── Exclusion logic ──────────────────────────────────────────────────────────
  // Synthetic "direct_rewards_only" on Millennia Dining: direct zeroes, milestone
  // still computes (20.83).
  const exclDirectOnly: Exclusion = {
    id: "excl-synth-direct",
    card_id: millennia.id,
    excluded_category: "Dining",
    applies_to: "direct_rewards_only",
    notes: "",
    source_dump_text: "",
    extracted_date: "2026-06-21",
  };
  const dOnly = calculateExpectedCashback(
    millennia,
    500,
    "dining", // case-insensitive match on purpose
    rewardRules,
    milestones,
    milestoneTiers,
    [exclDirectOnly],
  );
  check("exclusion direct_rewards_only: direct zeroed", dOnly.directRewardValue === 0);
  check("exclusion direct_rewards_only: milestone STILL computes (20.83)", dOnly.milestoneContributionValue === 20.83);
  check("exclusion direct_rewards_only: total = milestone only (20.83)", dOnly.totalExpectedValue === 20.83);

  // Synthetic "milestones_only" on Millennia Dining: milestone zeroes, direct computes.
  const exclMsOnly: Exclusion = { ...exclDirectOnly, id: "excl-synth-ms", applies_to: "milestones_only" };
  const mOnly = calculateExpectedCashback(
    millennia,
    500,
    "Dining",
    rewardRules,
    milestones,
    milestoneTiers,
    [exclMsOnly],
  );
  check("exclusion milestones_only: direct STILL computes (25)", mOnly.directRewardValue === 25);
  check("exclusion milestones_only: milestone zeroed", mOnly.milestoneContributionValue === 0);

  // Synthetic "all_rewards": both zero.
  const exclAll: Exclusion = { ...exclDirectOnly, id: "excl-synth-all", applies_to: "all_rewards" };
  const allEx = calculateExpectedCashback(
    millennia,
    500,
    "Dining",
    rewardRules,
    milestones,
    milestoneTiers,
    [exclAll],
  );
  check("exclusion all_rewards: direct zeroed", allEx.directRewardValue === 0);
  check("exclusion all_rewards: milestone zeroed", allEx.milestoneContributionValue === 0);
  check("exclusion all_rewards: total = 0", allEx.totalExpectedValue === 0);

  // Real seed exclusion: Atlas "Government" is milestones_only → direct via Other
  // rule (per_100_spend, 2 miles/₹100 → (1000/100)*2*1 = 20), milestone 0.
  const govt = calculateExpectedCashback(
    atlas,
    1000,
    "Government",
    rewardRules,
    milestones,
    milestoneTiers,
    exclusions,
  );
  check("seed exclusion (Atlas Government, milestones_only): direct = 20 via Other rule", govt.directRewardValue === 20);
  check("seed exclusion (Atlas Government, milestones_only): milestone = 0", govt.milestoneContributionValue === 0);

  // ── Already-achieved tier excluded from milestone contribution ───────────────
  // Mark Millennia tier mt-mill-1 (₹5 contribution at amount 500) achieved → the
  // milestone sum should drop by exactly that tier's 5.00 to 15.83.
  const tiersWithOneAchieved: MilestoneTier[] = milestoneTiers.map((t) =>
    t.id === "mt-mill-1" ? { ...t, achieved: true } : t,
  );
  const achievedExcl = calculateExpectedCashback(
    millennia,
    500,
    "Dining",
    rewardRules,
    milestones,
    tiersWithOneAchieved,
    exclusions,
  );
  check("achieved tier excluded: milestone drops by tier-1's 5.00 → 15.83", achievedExcl.milestoneContributionValue === 15.83);

  // manual_override_achieved:true is likewise skipped (same drop).
  const tiersWithOverride: MilestoneTier[] = milestoneTiers.map((t) =>
    t.id === "mt-mill-1" ? { ...t, manual_override_achieved: true } : t,
  );
  const overrideExcl = calculateExpectedCashback(
    millennia,
    500,
    "Dining",
    rewardRules,
    milestones,
    tiersWithOverride,
    exclusions,
  );
  check("manual_override_achieved:true tier excluded: milestone = 15.83", overrideExcl.milestoneContributionValue === 15.83);

  // ── rankCardsForPurchase: real 2-card seed, Travel 500 ───────────────────────
  // Atlas Travel total 35.83 vs Millennia (no Travel rule → Other percentage 1% =
  // 5 direct + 20.83 milestone = 25.83). Sorted desc → [Atlas, Millennia].
  const ranked = rankCardsForPurchase(
    cards,
    500,
    "Travel",
    rewardRules,
    milestones,
    milestoneTiers,
    exclusions,
  );
  check("rank (seed): returns both active cards (2, fewer than the top-5 cap)", ranked.length === 2);
  check("rank (seed): Atlas first (35.83 > 25.83)", ranked[0].cardId === "card-atlas-001");
  check("rank (seed): Millennia second", ranked[1].cardId === "card-millennia-001");
  check("rank (seed): sorted strictly descending", ranked[0].totalExpectedValue >= ranked[1].totalExpectedValue);

  // Inactive cards are excluded from ranking.
  const withInactive: Card[] = [...cards, { ...millennia, id: "card-inactive", active: false }];
  const rankedActive = rankCardsForPurchase(
    withInactive,
    500,
    "Travel",
    rewardRules,
    milestones,
    milestoneTiers,
    exclusions,
  );
  check("rank: inactive card excluded (still 2 results)", rankedActive.length === 2);

  // ── rankCardsForPurchase: top-5 cap with >5 synthetic active cards ────────────
  // Seven cards, each with one "Other" percentage rule at a distinct rate so totals
  // are strictly ordered; no milestones/exclusions. Expect top 5 by value.
  const synthCards: Card[] = [];
  const synthRules: RewardRule[] = [];
  for (let i = 1; i <= 7; i++) {
    const id = `card-synth-${i}`;
    synthCards.push({ ...millennia, id, active: true });
    synthRules.push({
      ...cashbackRule,
      id: `rr-synth-${i}`,
      card_id: id,
      category: "Other",
      multiplier_or_rate: i, // i% on 1000 → (i/100)*1000 = i*10 value
    });
  }
  const rankedCap = rankCardsForPurchase(
    synthCards,
    1000,
    "Anything", // no matching category → each card uses its Other rule
    synthRules,
    [],
    [],
    [],
  );
  check("rank (cap): capped at 5 even with 7 active cards", rankedCap.length === 5);
  check("rank (cap): top card is the 7% one (value 70)", rankedCap[0].cardId === "card-synth-7" && rankedCap[0].totalExpectedValue === 70);
  check("rank (cap): 5th card is the 3% one (value 30) — the 2 weakest dropped",
    rankedCap[4].cardId === "card-synth-3" && rankedCap[4].totalExpectedValue === 30);
  check("rank (cap): fully descending", rankedCap.every((r, i) => i === 0 || rankedCap[i - 1].totalExpectedValue >= r.totalExpectedValue));

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
