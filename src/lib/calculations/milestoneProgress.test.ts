// Standalone unit test for the milestone tier progress / achievement logic.
//
// Run with: npx tsx src/lib/calculations/milestoneProgress.test.ts
//
// PURE logic (no database I/O), so — like milestoneCycles.test.ts and
// cardBalance.test.ts — it does not snapshot/restore data/database.json. It builds
// Milestone / MilestoneTier / Transaction fixtures in memory (mirroring the real
// seed milestones) and asserts on recomputeMilestoneProgress.

import { recomputeMilestoneProgress } from "./milestoneProgress";
import type {
  Milestone,
  MilestoneTier,
  Transaction,
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

function utc(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
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

function makeTxn(overrides: Partial<Transaction>): Transaction {
  return {
    id: "txn-test",
    card_id: "card-test",
    date: "2026-05-10",
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

function makeExclusion(overrides: Partial<Exclusion>): Exclusion {
  return {
    id: "ex-test",
    card_id: "card-test",
    excluded_category: "Rent",
    applies_to: "milestones_only",
    notes: "",
    source_dump_text: "",
    extracted_date: "2026-06-01",
    ...overrides,
  };
}

const TODAY = utc("2026-06-21");

/** Convenience: build a single transaction summing to `amount` inside a window. */
function spend(cardId: string, date: string, amount: number): Transaction {
  return makeTxn({ id: `t-${date}-${amount}`, card_id: cardId, date, amount });
}

function byId(tiers: MilestoneTier[], id: string): MilestoneTier {
  const t = tiers.find((x) => x.id === id);
  if (!t) throw new Error(`tier ${id} not found in result`);
  return t;
}

function main(): void {
  // ── Millennia quarterly milestone: highest_only, 50k/100k/150k ──────────────
  // Calendar quarterly, today 2026-06-21 → window Apr 1–Jun 30 2026.
  const millMs = makeMilestone({
    id: "ms-millennia-q",
    card_id: "card-millennia-001",
    tier_type: "highest_only",
  });
  const millTiers: MilestoneTier[] = [
    makeTier({ id: "mt-mill-1", milestone_id: "ms-millennia-q", tier_threshold_amount: 50000 }),
    makeTier({ id: "mt-mill-2", milestone_id: "ms-millennia-q", tier_threshold_amount: 100000 }),
    makeTier({ id: "mt-mill-3", milestone_id: "ms-millennia-q", tier_threshold_amount: 150000 }),
  ];

  // Sum 60000 → crosses tier 1 only.
  const r1 = recomputeMilestoneProgress(
    millMs,
    millTiers,
    [spend("card-millennia-001", "2026-05-10", 60000)],
    [],
    TODAY,
  );
  check("highest_only sum 60k: progress recorded on all tiers (60000)",
    r1.every((t) => t.current_progress_amount === 60000));
  check("highest_only sum 60k: tier 1 achieved", byId(r1, "mt-mill-1").achieved === true);
  check("highest_only sum 60k: tier 2 NOT achieved", byId(r1, "mt-mill-2").achieved === false);
  check("highest_only sum 60k: tier 3 NOT achieved", byId(r1, "mt-mill-3").achieved === false);

  // Sum 120000 → crosses tier 1 AND tier 2, but highest_only marks ONLY tier 2.
  const r2 = recomputeMilestoneProgress(
    millMs,
    millTiers,
    [spend("card-millennia-001", "2026-05-10", 120000)],
    [],
    TODAY,
  );
  check("highest_only sum 120k: tier 1 NOT achieved (superseded)", byId(r2, "mt-mill-1").achieved === false);
  check("highest_only sum 120k: tier 2 achieved (the single highest crossed)", byId(r2, "mt-mill-2").achieved === true);
  check("highest_only sum 120k: tier 3 NOT achieved", byId(r2, "mt-mill-3").achieved === false);

  // Sum 160000 → crosses all three; highest_only marks ONLY tier 3.
  const r3 = recomputeMilestoneProgress(
    millMs,
    millTiers,
    [spend("card-millennia-001", "2026-05-10", 160000)],
    [],
    TODAY,
  );
  check("highest_only sum 160k: tier 1 NOT achieved", byId(r3, "mt-mill-1").achieved === false);
  check("highest_only sum 160k: tier 2 NOT achieved", byId(r3, "mt-mill-2").achieved === false);
  check("highest_only sum 160k: tier 3 achieved (single highest crossed)", byId(r3, "mt-mill-3").achieved === true);

  // ── Atlas anniversary annual milestone: cumulative, 300k/750k/1.5M ──────────
  // Anniversary annual, anchor 2025-03-15, today 2026-06-21 → window
  // 2026-03-15 … 2027-03-14. Sum 800000 crosses tier 1 & 2 but not tier 3.
  const atlasMs = makeMilestone({
    id: "ms-atlas-anniv",
    card_id: "card-atlas-001",
    cycle_frequency: "annual",
    cycle_anchor: "anniversary",
    anchor_reference_date: "2025-03-15",
    tier_type: "cumulative",
    cycle_start_date: "2026-03-15",
    cycle_end_date: "2027-03-14",
  });
  const atlasTiers: MilestoneTier[] = [
    makeTier({ id: "mt-atlas-1", milestone_id: "ms-atlas-anniv", tier_threshold_amount: 300000 }),
    makeTier({ id: "mt-atlas-2", milestone_id: "ms-atlas-anniv", tier_threshold_amount: 750000 }),
    makeTier({ id: "mt-atlas-3", milestone_id: "ms-atlas-anniv", tier_threshold_amount: 1500000 }),
  ];
  const ra = recomputeMilestoneProgress(
    atlasMs,
    atlasTiers,
    [spend("card-atlas-001", "2026-08-01", 800000)],
    [],
    TODAY,
  );
  check("cumulative sum 800k: tier 1 achieved", byId(ra, "mt-atlas-1").achieved === true);
  check("cumulative sum 800k: tier 2 ALSO achieved (cumulative marks every crossed tier)", byId(ra, "mt-atlas-2").achieved === true);
  check("cumulative sum 800k: tier 3 NOT achieved (threshold not crossed)", byId(ra, "mt-atlas-3").achieved === false);

  // ── Manual override wins, without affecting other tiers ─────────────────────
  // Same highest_only sum 120k case (computed: only tier 2 achieved), but force
  // tier 1 achieved via override and tier 3 stays computed.
  const overrideTiers: MilestoneTier[] = [
    makeTier({ id: "mt-mill-1", milestone_id: "ms-millennia-q", tier_threshold_amount: 50000, manual_override_achieved: true }),
    makeTier({ id: "mt-mill-2", milestone_id: "ms-millennia-q", tier_threshold_amount: 100000 }),
    makeTier({ id: "mt-mill-3", milestone_id: "ms-millennia-q", tier_threshold_amount: 150000 }),
  ];
  const ro = recomputeMilestoneProgress(
    millMs,
    overrideTiers,
    [spend("card-millennia-001", "2026-05-10", 120000)],
    [],
    TODAY,
  );
  check("override true on tier 1: tier 1 achieved (override wins over computed false)", byId(ro, "mt-mill-1").achieved === true);
  check("override on tier 1 does NOT affect tier 2 (still computed-achieved)", byId(ro, "mt-mill-2").achieved === true);
  check("override on tier 1 does NOT affect tier 3 (still computed not-achieved)", byId(ro, "mt-mill-3").achieved === false);

  // Override false suppresses a computed-achieved tier.
  const overrideFalseTiers: MilestoneTier[] = [
    makeTier({ id: "mt-mill-1", milestone_id: "ms-millennia-q", tier_threshold_amount: 50000 }),
    makeTier({ id: "mt-mill-2", milestone_id: "ms-millennia-q", tier_threshold_amount: 100000, manual_override_achieved: false }),
    makeTier({ id: "mt-mill-3", milestone_id: "ms-millennia-q", tier_threshold_amount: 150000 }),
  ];
  const rof = recomputeMilestoneProgress(
    millMs,
    overrideFalseTiers,
    [spend("card-millennia-001", "2026-05-10", 120000)],
    [],
    TODAY,
  );
  check("override false on tier 2: tier 2 NOT achieved despite crossing threshold", byId(rof, "mt-mill-2").achieved === false);
  check("override false on tier 2: achieved_date cleared to null", byId(rof, "mt-mill-2").achieved_date === null);

  // ── achieved_date: stamped on first achievement, then preserved ─────────────
  // First recompute: tier starts un-achieved, crosses → date should be TODAY.
  const firstAchieve = recomputeMilestoneProgress(
    makeMilestone({ id: "ms-millennia-q", card_id: "card-millennia-001", tier_type: "cumulative" }),
    [makeTier({ id: "mt-d", milestone_id: "ms-millennia-q", tier_threshold_amount: 50000 })],
    [spend("card-millennia-001", "2026-05-10", 60000)],
    [],
    TODAY,
  );
  check("achieved_date set to today (2026-06-21) on first achievement",
    byId(firstAchieve, "mt-d").achieved_date === "2026-06-21");

  // Second recompute on a LATER day, tier already carries its first achieved_date
  // and is still achieved → date must NOT be overwritten with the new today.
  const alreadyAchieved = byId(firstAchieve, "mt-d");
  const secondAchieve = recomputeMilestoneProgress(
    makeMilestone({ id: "ms-millennia-q", card_id: "card-millennia-001", tier_type: "cumulative" }),
    [alreadyAchieved],
    [spend("card-millennia-001", "2026-05-10", 70000)],
    [],
    utc("2026-06-25"), // later "today"
  );
  check("achieved_date NOT overwritten on a later recompute while still achieved (stays 2026-06-21)",
    byId(secondAchieve, "mt-d").achieved_date === "2026-06-21");

  // If a previously-achieved tier drops below threshold, achieved flips false and
  // the stale date is cleared (date stays consistent with achieved).
  const dropBelow = recomputeMilestoneProgress(
    makeMilestone({ id: "ms-millennia-q", card_id: "card-millennia-001", tier_type: "cumulative" }),
    [makeTier({ id: "mt-d", milestone_id: "ms-millennia-q", tier_threshold_amount: 50000, achieved: true, achieved_date: "2026-06-21" })],
    [spend("card-millennia-001", "2026-05-10", 10000)], // now below 50k
    [],
    utc("2026-06-25"),
  );
  check("un-achieved tier: achieved flips to false", byId(dropBelow, "mt-d").achieved === false);
  check("un-achieved tier: achieved_date cleared to null (no stale date)", byId(dropBelow, "mt-d").achieved_date === null);

  // ── Input array is not mutated (new objects returned) ───────────────────────
  const original = makeTier({ id: "mt-im", milestone_id: "ms-millennia-q", tier_threshold_amount: 50000 });
  const inputArr = [original];
  const out = recomputeMilestoneProgress(
    makeMilestone({ id: "ms-millennia-q", card_id: "card-millennia-001", tier_type: "cumulative" }),
    inputArr,
    [spend("card-millennia-001", "2026-05-10", 60000)],
    [],
    TODAY,
  );
  check("does not mutate the input tier object (original.achieved still false)", original.achieved === false);
  check("returns a new object (not the same reference)", out[0] !== original);

  // ── Look-back earning_window_offset = -1 (synthetic; no seed uses it) ────────
  // Calendar quarterly, today 2026-06-21 → current cycle Apr 1–Jun 30, so the
  // PREVIOUS cycle is Jan 1–Mar 31 2026. With offset -1, only the Jan–Mar spend
  // counts; a spend inside the current quarter must be ignored.
  const lookbackMs = makeMilestone({
    id: "ms-lookback",
    card_id: "card-lookback",
    tier_type: "cumulative",
    earning_window_offset: -1,
  });
  const lookbackTier = makeTier({ id: "mt-lb", milestone_id: "ms-lookback", tier_threshold_amount: 50000 });
  const lookbackTxns: Transaction[] = [
    spend("card-lookback", "2026-02-15", 60000),   // previous cycle → counts
    spend("card-lookback", "2026-05-10", 999999),  // current cycle → must be ignored
  ];
  const rl = recomputeMilestoneProgress(lookbackMs, [lookbackTier], lookbackTxns, [], TODAY);
  check("offset -1: progress comes from the PREVIOUS cycle only (60000, current-cycle spend ignored)",
    byId(rl, "mt-lb").current_progress_amount === 60000);
  check("offset -1: tier achieved from previous-cycle spend", byId(rl, "mt-lb").achieved === true);

  // Contrast: identical milestone/data with offset 0 counts the CURRENT cycle
  // spend instead, proving the look-back actually shifted the window.
  const sameButCurrent = makeMilestone({
    id: "ms-lookback",
    card_id: "card-lookback",
    tier_type: "cumulative",
    earning_window_offset: 0,
  });
  const rc = recomputeMilestoneProgress(sameButCurrent, [lookbackTier], lookbackTxns, [], TODAY);
  check("offset 0 (same data): progress comes from the CURRENT cycle (999999), confirming the window shift",
    byId(rc, "mt-lb").current_progress_amount === 999999);

  // ── Foreign tiers (wrong milestone_id) pass through untouched ───────────────
  const mixed = recomputeMilestoneProgress(
    makeMilestone({ id: "ms-millennia-q", card_id: "card-millennia-001", tier_type: "cumulative" }),
    [
      makeTier({ id: "mine", milestone_id: "ms-millennia-q", tier_threshold_amount: 50000 }),
      makeTier({ id: "foreign", milestone_id: "ms-other", tier_threshold_amount: 1, achieved: false }),
    ],
    [spend("card-millennia-001", "2026-05-10", 60000)],
    [],
    TODAY,
  );
  check("own tier updated", byId(mixed, "mine").achieved === true);
  check("foreign tier (different milestone_id) left unchanged — not achieved, progress untouched",
    byId(mixed, "foreign").achieved === false && byId(mixed, "foreign").current_progress_amount === 0);

  // ── Excluded categories are dropped from the milestone spend pool ────────────
  // BUSINESS-RULE-AUDIT fix: a category marked excluded from milestones must NOT
  // count toward progress, while a non-excluded category in the same window still
  // does. Cumulative milestone, window Apr 1–Jun 30 2026.
  const exclMs = makeMilestone({
    id: "ms-excl",
    card_id: "card-excl",
    tier_type: "cumulative",
  });
  const exclTier = makeTier({ id: "mt-excl", milestone_id: "ms-excl", tier_threshold_amount: 50000 });
  // 40000 in an excluded "Rent" category + 30000 in a counted "Dining" category.
  const exclTxns: Transaction[] = [
    makeTxn({ id: "t-rent", card_id: "card-excl", date: "2026-05-10", amount: 40000, category: "Rent" }),
    makeTxn({ id: "t-dining", card_id: "card-excl", date: "2026-05-12", amount: 30000, category: "Dining" }),
  ];

  // Baseline: no exclusions → both count, pool = 70000, tier crossed.
  const exclNone = recomputeMilestoneProgress(exclMs, [exclTier], exclTxns, [], TODAY);
  check("no exclusions: full pool counted (70000)", byId(exclNone, "mt-excl").current_progress_amount === 70000);
  check("no exclusions: tier achieved at 70000 ≥ 50000", byId(exclNone, "mt-excl").achieved === true);

  // milestones_only exclusion on "Rent" → 40000 dropped, pool = 30000, tier NOT crossed.
  const milestonesOnly = [makeExclusion({ card_id: "card-excl", excluded_category: "Rent", applies_to: "milestones_only" })];
  const exclMO = recomputeMilestoneProgress(exclMs, [exclTier], exclTxns, milestonesOnly, TODAY);
  check("milestones_only exclusion: excluded 'Rent' dropped, only 'Dining' counts (30000)",
    byId(exclMO, "mt-excl").current_progress_amount === 30000);
  check("milestones_only exclusion: tier NOT achieved (30000 < 50000)", byId(exclMO, "mt-excl").achieved === false);

  // all_rewards exclusion behaves identically for milestone progress (also drops Rent).
  const allRewards = [makeExclusion({ card_id: "card-excl", excluded_category: "Rent", applies_to: "all_rewards" })];
  const exclAll = recomputeMilestoneProgress(exclMs, [exclTier], exclTxns, allRewards, TODAY);
  check("all_rewards exclusion: 'Rent' also dropped from milestone pool (30000)",
    byId(exclAll, "mt-excl").current_progress_amount === 30000);

  // direct_rewards_only exclusion must NOT affect milestone progress (Rent still counts).
  const directOnly = [makeExclusion({ card_id: "card-excl", excluded_category: "Rent", applies_to: "direct_rewards_only" })];
  const exclDirect = recomputeMilestoneProgress(exclMs, [exclTier], exclTxns, directOnly, TODAY);
  check("direct_rewards_only exclusion: does NOT touch milestones, full pool still counts (70000)",
    byId(exclDirect, "mt-excl").current_progress_amount === 70000);

  // Case-insensitive matching: exclusion "rent" (lower) vs txn category "Rent".
  const caseExcl = [makeExclusion({ card_id: "card-excl", excluded_category: "rent", applies_to: "milestones_only" })];
  const exclCase = recomputeMilestoneProgress(exclMs, [exclTier], exclTxns, caseExcl, TODAY);
  check("exclusion match is case-insensitive ('rent' excludes 'Rent', pool = 30000)",
    byId(exclCase, "mt-excl").current_progress_amount === 30000);

  // Exclusion scoped to a DIFFERENT card must be ignored for this card's pool.
  const otherCardExcl = [makeExclusion({ card_id: "some-other-card", excluded_category: "Rent", applies_to: "milestones_only" })];
  const exclOther = recomputeMilestoneProgress(exclMs, [exclTier], exclTxns, otherCardExcl, TODAY);
  check("exclusion for a different card_id is ignored (full pool 70000)",
    byId(exclOther, "mt-excl").current_progress_amount === 70000);

  // Effective-category: a txn whose manual_override_category is the excluded one is
  // dropped even though its original `category` is not excluded.
  const overrideTxns: Transaction[] = [
    makeTxn({ id: "t-ov", card_id: "card-excl", date: "2026-05-10", amount: 40000, category: "Shopping", manual_override_category: "Rent" }),
    makeTxn({ id: "t-dining2", card_id: "card-excl", date: "2026-05-12", amount: 30000, category: "Dining" }),
  ];
  const exclOverride = recomputeMilestoneProgress(exclMs, [exclTier], overrideTxns, milestonesOnly, TODAY);
  check("exclusion matches the EFFECTIVE category (override 'Rent' dropped despite original 'Shopping', pool = 30000)",
    byId(exclOverride, "mt-excl").current_progress_amount === 30000);

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
