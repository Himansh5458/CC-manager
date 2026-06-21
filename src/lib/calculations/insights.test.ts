// Standalone unit test for the predictive insights logic (insights.ts).
//
// Run with: npx tsx src/lib/calculations/insights.test.ts
//
// Mixed strategy, mirroring the rest of calculations/: the seed-data cases read the
// COMMITTED database.json read-only (so they also guard against seed drift, like
// expectedCashback.test.ts), while the averaging / anomaly / nudge edge cases use
// in-memory fixtures with an injected `today` for determinism. Pure logic, no DB
// writes, so no snapshot/restore is needed.

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  predictNextBill,
  detectSpendAnomalies,
  getMilestoneProximityNudges,
} from "./insights";
import type {
  Database,
  Card,
  Transaction,
  RecurringTransaction,
  Milestone,
  MilestoneTier,
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

function utc(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// ── fixture builders (only the fields each function reads are meaningful) ──────

function makeCard(overrides: Partial<Card>): Card {
  return {
    id: "card-test",
    card_holder: "Test Holder",
    card_name: "Test Card",
    card_bank: "TestBank",
    card_type: "Visa",
    card_number_encrypted: "PLACEHOLDER_NOT_ENCRYPTED",
    card_number_last4: "0000",
    expiry_month: 1,
    expiry_year: 2030,
    registered_phone: "+91-0000000000",
    registered_email: "test@example.com",
    annual_fee: 0,
    statement_date: 10,
    payment_deadline_days: 20,
    customer_care_number: "0000",
    credit_limit: 100000,
    renewal_date: "2030-01-01",
    issuance_date: "2024-01-01",
    benefits_summary: "",
    parent_family: "TestBank Test Holder",
    current_outstanding_balance: 0,
    current_utilization_pct: 0,
    manual_override_utilization_pct: null,
    active: true,
    ...overrides,
  };
}

function makeTxn(overrides: Partial<Transaction>): Transaction {
  return {
    id: "txn-test",
    card_id: "card-test",
    date: "2026-01-01",
    merchant: "Test Merchant",
    amount: 0,
    category: "Other",
    notes: "",
    source: "manual",
    statement_file_id: null,
    confidence_flag: "high",
    manual_override_category: null,
    ...overrides,
  };
}

function makeRecurring(
  overrides: Partial<RecurringTransaction>,
): RecurringTransaction {
  return {
    id: "rec-test",
    nickname: "Test Recurring",
    card_id: "card-test",
    amount: 0,
    category: "Other",
    billing_day: 1,
    start_date: "2024-01-01",
    end_date: null,
    active: true,
    ...overrides,
  };
}

function makeMilestone(overrides: Partial<Milestone>): Milestone {
  return {
    id: "ms-test",
    card_id: "card-test",
    track_name: "Test Track",
    cycle_frequency: "quarterly",
    cycle_anchor: "calendar",
    anchor_reference_date: null,
    tier_type: "highest_only",
    earning_window_offset: 0,
    cycle_start_date: "2026-04-01",
    cycle_end_date: "2026-06-30",
    active: true,
    ...overrides,
  };
}

function makeTier(overrides: Partial<MilestoneTier>): MilestoneTier {
  return {
    id: "mt-test",
    milestone_id: "ms-test",
    tier_threshold_amount: 50000,
    reward_value: 500,
    reward_unit: "points",
    redemption_value_per_unit: 1,
    is_cumulative_payout: false,
    unlocks_in_cycle: "same",
    current_progress_amount: 0,
    achieved: false,
    achieved_date: null,
    manual_override_achieved: null,
    ...overrides,
  };
}

// ── committed seed (read-only) ────────────────────────────────────────────────
const db = JSON.parse(
  readFileSync(path.join(process.cwd(), "data", "database.json"), "utf-8"),
) as Database;
const seedMillennia = db.cards.find((c) => c.id === "card-millennia-001")!;
const seedAtlas = db.cards.find((c) => c.id === "card-atlas-001")!;

function main(): void {
  // ════════════════════════════════════════════════════════════════════════════
  // 1. predictNextBill
  // ════════════════════════════════════════════════════════════════════════════

  // ── Seed, today 2026-06-21: every seed txn sits in the OPEN cycle, so there is
  // no completed-cycle history → recurring-only prediction + honest note. ───────
  const seedToday = utc("2026-06-21");

  const millPred = predictNextBill(
    seedMillennia,
    db.transactions,
    db.payments,
    db.recurringTransactions,
    seedToday,
  );
  // Netflix (rec-001) is the only active recurring on Millennia: ₹649.
  check(
    "predictNextBill seed Millennia: ₹649 recurring only (no completed history)",
    millPred.predictedAmount === 649,
  );
  check(
    "predictNextBill seed Millennia: breakdown notes no prior cycle data",
    millPred.breakdown === "₹649 recurring (no prior cycle spend data yet)",
  );

  const atlasPred = predictNextBill(
    seedAtlas,
    db.transactions,
    db.payments,
    db.recurringTransactions,
    seedToday,
  );
  // Term Insurance EMI (rec-002) is the only active recurring on Atlas: ₹2,500.
  check(
    "predictNextBill seed Atlas: ₹2,500 recurring only (no completed history)",
    atlasPred.predictedAmount === 2500,
  );
  check(
    "predictNextBill seed Atlas: breakdown notes no prior cycle data",
    atlasPred.breakdown === "₹2,500 recurring (no prior cycle spend data yet)",
  );

  // ── Seed, today 2026-09-21: now the June seed spends fall in a completed cycle.
  // Millennia stmt day 5 → completed cycles [08-05..09-04], [07-05..08-04],
  // [06-05..07-04]; the last holds all 5 June txns (₹8,190). All three are within
  // the data span (end ≥ first txn 06-06) → avg = 8190/3 = 2730. +₹649 Netflix. ─
  const millLater = predictNextBill(
    seedMillennia,
    db.transactions,
    db.payments,
    db.recurringTransactions,
    utc("2026-09-21"),
  );
  check(
    "predictNextBill seed Millennia @2026-09-21: 649 + 8190/3 = 3379",
    millLater.predictedAmount === 3379,
  );
  check(
    "predictNextBill seed Millennia @2026-09-21: breakdown shows recurring + 3-cycle avg",
    millLater.breakdown === "₹649 recurring + ₹2,730 avg spend (last 3 cycles)",
  );

  // ── Synthetic insufficient-history honesty: spend in exactly ONE completed
  // cycle, today 2026-03-15 (stmt day 10 → completed [02-10..03-09],
  // [01-10..02-09], [12-10..01-09]). Only the first has data → "1 cycle". ───────
  const histCard = makeCard({ id: "hist", statement_date: 10 });
  const oneCycleTxns: Transaction[] = [
    makeTxn({ id: "h1", card_id: "hist", date: "2026-02-15", amount: 1000, category: "Dining" }),
    makeTxn({ id: "h2", card_id: "hist", date: "2026-02-20", amount: 2000, category: "Shopping Online" }),
  ];
  const onePred = predictNextBill(histCard, oneCycleTxns, [], [], utc("2026-03-15"));
  check(
    "predictNextBill 1-cycle history: avg = 3000 (no false precision over 3)",
    onePred.predictedAmount === 3000,
  );
  check(
    "predictNextBill 1-cycle history: breakdown is honest about limited history",
    onePred.breakdown === "no recurring charges + ₹3,000 avg spend (only 1 cycle of history)",
  );

  // ── Recurring instances are NOT double-counted: a ₹500 Entertainment recurring
  // also appears as a logged txn in the history cycle; it must be excluded from
  // the variable average (added once, forward). avg variable = 2000, +500 = 2500.
  const dedupCard = makeCard({ id: "dedup", statement_date: 10 });
  const dedupTxns: Transaction[] = [
    makeTxn({ id: "d1", card_id: "dedup", date: "2026-02-12", amount: 500, category: "Entertainment" }),
    makeTxn({ id: "d2", card_id: "dedup", date: "2026-02-20", amount: 2000, category: "Dining" }),
  ];
  const dedupRec: RecurringTransaction[] = [
    makeRecurring({ id: "dr", card_id: "dedup", amount: 500, category: "Entertainment", start_date: "2025-01-01" }),
  ];
  const dedupPred = predictNextBill(dedupCard, dedupTxns, [], dedupRec, utc("2026-03-15"));
  check(
    "predictNextBill excludes recurring instances from the variable avg (500 + 2000, not 500 + 2500)",
    dedupPred.predictedAmount === 2500,
  );
  check(
    "predictNextBill dedup breakdown: ₹500 recurring + ₹2,000 avg (1 cycle)",
    dedupPred.breakdown === "₹500 recurring + ₹2,000 avg spend (only 1 cycle of history)",
  );

  // ── No data at all: zero recurring, zero history → 0 and a fully honest note. ─
  const emptyPred = predictNextBill(
    makeCard({ id: "empty" }),
    [],
    [],
    [],
    utc("2026-03-15"),
  );
  check(
    "predictNextBill with no data at all: 0 and honest breakdown",
    emptyPred.predictedAmount === 0 &&
      emptyPred.breakdown === "no recurring charges and no prior cycle spend data yet",
  );

  // ════════════════════════════════════════════════════════════════════════════
  // 2. detectSpendAnomalies
  // ════════════════════════════════════════════════════════════════════════════

  // ── Constructed scenario, today 2026-04-15 (stmt day 10 → current cycle starts
  // 04-10; completed [03-10..04-09], [02-10..03-09], [01-10..02-09]).
  //   Dining:    1000/cycle history (avg 1000), current 5000  → anomaly (+400%).
  //   Groceries: 2000/cycle history (avg 2000), current 2100  → normal (+5%, drop).
  //   Travel:    no history, current 3000                     → first-time (drop).
  const anomCard = makeCard({ id: "anom", statement_date: 10 });
  const anomTxns: Transaction[] = [
    // history — Dining 1000 each completed cycle
    makeTxn({ id: "a1", card_id: "anom", date: "2026-03-15", amount: 1000, category: "Dining" }),
    makeTxn({ id: "a2", card_id: "anom", date: "2026-02-15", amount: 1000, category: "Dining" }),
    makeTxn({ id: "a3", card_id: "anom", date: "2026-01-15", amount: 1000, category: "Dining" }),
    // history — Groceries 2000 each completed cycle
    makeTxn({ id: "a4", card_id: "anom", date: "2026-03-16", amount: 2000, category: "Groceries" }),
    makeTxn({ id: "a5", card_id: "anom", date: "2026-02-16", amount: 2000, category: "Groceries" }),
    makeTxn({ id: "a6", card_id: "anom", date: "2026-01-16", amount: 2000, category: "Groceries" }),
    // current cycle (≥ 04-10)
    makeTxn({ id: "a7", card_id: "anom", date: "2026-04-12", amount: 5000, category: "Dining" }),
    makeTxn({ id: "a8", card_id: "anom", date: "2026-04-13", amount: 2100, category: "Groceries" }),
    makeTxn({ id: "a9", card_id: "anom", date: "2026-04-14", amount: 3000, category: "Travel" }),
  ];
  const anomalies = detectSpendAnomalies(anomCard, anomTxns, utc("2026-04-15"));
  check(
    "detectSpendAnomalies: exactly one category flagged",
    anomalies.length === 1,
  );
  const dining = anomalies.find((a) => a.category === "Dining");
  check(
    "detectSpendAnomalies: Dining flagged with correct numbers (5000 vs avg 1000, +400%)",
    !!dining &&
      dining.currentCycleAmount === 5000 &&
      dining.historicalAverage === 1000 &&
      dining.percentAboveAverage === 400,
  );
  check(
    "detectSpendAnomalies: Groceries NOT flagged (only +5%, under the 30% gate)",
    !anomalies.some((a) => a.category === "Groceries"),
  );
  check(
    "detectSpendAnomalies: first-time Travel NOT flagged (historicalAverage 0 excluded)",
    !anomalies.some((a) => a.category === "Travel"),
  );

  // ── 30% boundary is inclusive: current exactly 1.3× average is flagged. ───────
  const boundCard = makeCard({ id: "bound", statement_date: 10 });
  const boundTxns: Transaction[] = [
    makeTxn({ id: "b1", card_id: "bound", date: "2026-03-15", amount: 1000, category: "Fuel" }),
    makeTxn({ id: "b2", card_id: "bound", date: "2026-02-15", amount: 1000, category: "Fuel" }),
    makeTxn({ id: "b3", card_id: "bound", date: "2026-01-15", amount: 1000, category: "Fuel" }),
    makeTxn({ id: "b4", card_id: "bound", date: "2026-04-12", amount: 1300, category: "Fuel" }),
  ];
  const boundAnoms = detectSpendAnomalies(boundCard, boundTxns, utc("2026-04-15"));
  check(
    "detectSpendAnomalies: exactly +30% is flagged (boundary inclusive)",
    boundAnoms.length === 1 && boundAnoms[0].percentAboveAverage === 30,
  );

  // ── Seed @2026-06-21: no completed-cycle history → nothing can be flagged. ────
  check(
    "detectSpendAnomalies seed Millennia: [] (no baseline, honest)",
    detectSpendAnomalies(seedMillennia, db.transactions, seedToday).length === 0,
  );
  check(
    "detectSpendAnomalies seed Atlas: [] (no baseline, honest)",
    detectSpendAnomalies(seedAtlas, db.transactions, seedToday).length === 0,
  );

  // ════════════════════════════════════════════════════════════════════════════
  // 3. getMilestoneProximityNudges
  // ════════════════════════════════════════════════════════════════════════════

  // ── Seed: both tracks are far from their first tier (Millennia 8190/50000 = 16%,
  // Atlas 33980/300000 = 11%) → excluded as too-far per the 50%-remaining cutoff. ─
  const seedNudges = getMilestoneProximityNudges(
    db.milestones,
    db.milestoneTiers,
    seedToday,
  );
  check(
    "getMilestoneProximityNudges seed: [] (both tracks too far from next tier)",
    seedNudges.length === 0,
  );

  // ── Close enough: progress 45000 toward a 50000 tier (₹5,000 ≤ 50% of 50000). ─
  const closeMs = makeMilestone({ id: "ms-close" });
  const closeTiers: MilestoneTier[] = [
    makeTier({ id: "ct1", milestone_id: "ms-close", tier_threshold_amount: 50000, current_progress_amount: 45000, reward_value: 500, reward_unit: "points" }),
    makeTier({ id: "ct2", milestone_id: "ms-close", tier_threshold_amount: 100000, current_progress_amount: 45000 }),
  ];
  const closeNudges = getMilestoneProximityNudges([closeMs], closeTiers, seedToday);
  check(
    "getMilestoneProximityNudges: close tier surfaced (next=50000, remaining=5000)",
    closeNudges.length === 1 &&
      closeNudges[0].nextTierThreshold === 50000 &&
      closeNudges[0].amountRemaining === 5000 &&
      closeNudges[0].milestoneId === "ms-close" &&
      closeNudges[0].trackName === "Test Track" &&
      closeNudges[0].rewardDescription === "500 points (worth ₹500)",
  );

  // ── Already-achieved tier is skipped; the NEXT unachieved tier is identified. ─
  const achievedMs = makeMilestone({ id: "ms-ach" });
  const achievedTiers: MilestoneTier[] = [
    makeTier({ id: "at1", milestone_id: "ms-ach", tier_threshold_amount: 50000, current_progress_amount: 48000, achieved: true }),
    makeTier({ id: "at2", milestone_id: "ms-ach", tier_threshold_amount: 60000, current_progress_amount: 48000, achieved: false }),
  ];
  const achievedNudges = getMilestoneProximityNudges([achievedMs], achievedTiers, seedToday);
  check(
    "getMilestoneProximityNudges: achieved tier skipped, next tier (60000, remaining 12000) chosen",
    achievedNudges.length === 1 &&
      achievedNudges[0].nextTierThreshold === 60000 &&
      achievedNudges[0].amountRemaining === 12000,
  );

  // ── manual_override_achieved=true masks an otherwise-unachieved tier. ─────────
  const ovTrueMs = makeMilestone({ id: "ms-ovt" });
  const ovTrueTiers: MilestoneTier[] = [
    makeTier({ id: "ot1", milestone_id: "ms-ovt", tier_threshold_amount: 50000, current_progress_amount: 49000, achieved: false, manual_override_achieved: true }),
    makeTier({ id: "ot2", milestone_id: "ms-ovt", tier_threshold_amount: 70000, current_progress_amount: 49000, achieved: false }),
  ];
  const ovTrueNudges = getMilestoneProximityNudges([ovTrueMs], ovTrueTiers, seedToday);
  check(
    "getMilestoneProximityNudges: override=true masks tier1, next=70000 (remaining 21000)",
    ovTrueNudges.length === 1 && ovTrueNudges[0].nextTierThreshold === 70000,
  );

  // ── manual_override_achieved=false forces an 'achieved' tier back into play. ──
  const ovFalseMs = makeMilestone({ id: "ms-ovf" });
  const ovFalseTiers: MilestoneTier[] = [
    makeTier({ id: "of1", milestone_id: "ms-ovf", tier_threshold_amount: 50000, current_progress_amount: 48000, achieved: true, manual_override_achieved: false }),
  ];
  const ovFalseNudges = getMilestoneProximityNudges([ovFalseMs], ovFalseTiers, seedToday);
  check(
    "getMilestoneProximityNudges: override=false un-achieves tier1, surfaced (remaining 2000)",
    ovFalseNudges.length === 1 && ovFalseNudges[0].amountRemaining === 2000,
  );

  // ── Too far: 10000/100000 = 90% remaining → excluded. ────────────────────────
  const farMs = makeMilestone({ id: "ms-far" });
  const farTiers: MilestoneTier[] = [
    makeTier({ id: "ft1", milestone_id: "ms-far", tier_threshold_amount: 100000, current_progress_amount: 10000 }),
  ];
  check(
    "getMilestoneProximityNudges: too-far tier excluded ([] )",
    getMilestoneProximityNudges([farMs], farTiers, seedToday).length === 0,
  );

  // ── Inactive milestone is never nudged, even when close. ──────────────────────
  const inactiveMs = makeMilestone({ id: "ms-inact", active: false });
  const inactiveTiers: MilestoneTier[] = [
    makeTier({ id: "it1", milestone_id: "ms-inact", tier_threshold_amount: 50000, current_progress_amount: 49000 }),
  ];
  check(
    "getMilestoneProximityNudges: inactive milestone excluded",
    getMilestoneProximityNudges([inactiveMs], inactiveTiers, seedToday).length === 0,
  );

  // ── Non-positive remaining (progress already past threshold, flag stale) skip. ─
  const overMs = makeMilestone({ id: "ms-over" });
  const overTiers: MilestoneTier[] = [
    makeTier({ id: "ovr1", milestone_id: "ms-over", tier_threshold_amount: 50000, current_progress_amount: 55000, achieved: false }),
  ];
  check(
    "getMilestoneProximityNudges: non-positive amountRemaining excluded",
    getMilestoneProximityNudges([overMs], overTiers, seedToday).length === 0,
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
