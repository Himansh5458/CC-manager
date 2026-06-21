// milestoneProgress.ts — tier progress & achievement for a milestone track.
//
// Part of src/lib/calculations/, the home for pure business logic (see
// src/lib/CLAUDE.md rule 2). Given a milestone, its tiers, and the relevant
// transactions, this derives each tier's current_progress_amount / achieved /
// achieved_date for the milestone's current earning window. It NEVER reads or
// writes the database — the caller supplies the rows and is responsible for
// persisting the returned tiers via updateMilestoneTier (same pure-function /
// caller-persists contract as recomputeCardBalance in cardBalance.ts).
//
// ── How the earning window is chosen ─────────────────────────────────────────
// The window is the milestone's cycle as computed by calculateCurrentCycle
// (calculations/milestoneCycles.ts). `earning_window_offset` then shifts it:
//   0  → the current cycle (default).
//   -1 → the PREVIOUS cycle (a "spend in cycle N earns the benefit in cycle N+1"
//        look-back pattern). -2 → two cycles back, and so on.
// Rather than re-derive month arithmetic, we step back by recomputing the cycle
// for "one day before the current cycle's start": that day is, by definition,
// inside the previous cycle, so calculateCurrentCycle returns the previous
// cycle's bounds — reusing all of its anchor / leap-year / short-month handling.
//
// ── Tier achievement ─────────────────────────────────────────────────────────
// All tiers under a milestone share ONE spend pool (the windowed sum), stored as
// current_progress_amount on every tier. Which tiers count as achieved depends on
// the milestone's tier_type:
//   "cumulative"   → every tier whose threshold ≤ the spend pool is achieved.
//   "highest_only" → only the single highest tier whose threshold ≤ the pool is
//                    achieved; lower crossed tiers are NOT (the top reward
//                    supersedes them).
// manual_override_achieved (when non-null) wins over the computed value, mirroring
// getEffectiveUtilization's "manual override always wins" principle.
//
// ── Timezone policy ──────────────────────────────────────────────────────────
// All date math is UTC, identical to milestoneCycles.ts / cardBalance.ts: ISO
// YYYY-MM-DD strings are parsed as UTC midnight and `today` is read via its UTC
// fields only. The small UTC helpers below are intentionally duplicated from
// those modules rather than shared, matching their self-contained convention.

import type { Milestone, MilestoneTier, Transaction } from "../types/schema";
import { calculateCurrentCycle } from "./milestoneCycles";

/** Format a Date as a UTC YYYY-MM-DD string. */
function toISODate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parse a YYYY-MM-DD string as a UTC-midnight Date. */
function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Subtract one day from a UTC date. */
function subOneDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - 1),
  );
}

/**
 * The earning window for this milestone given `today` and its
 * `earning_window_offset`. offset 0 is the current cycle; each negative step
 * walks one cycle further back by recomputing the cycle for the day before the
 * prior window's start (which always lands inside the previous cycle). Positive
 * offsets are not part of the schema and are treated as 0.
 *
 * For `cycle_frequency: "custom"`, calculateCurrentCycle echoes the stored
 * boundaries regardless of `today`, so the look-back cannot move the window —
 * custom cycles have no auto-computed "previous" cycle and return their stored
 * window unchanged. (Judgment call — see docs/data-layer-contract.md.)
 */
function earningWindow(
  milestone: Milestone,
  today: Date,
): { cycleStartDate: string; cycleEndDate: string } {
  let window = calculateCurrentCycle(milestone, today);
  const stepsBack = milestone.earning_window_offset < 0
    ? -milestone.earning_window_offset
    : 0;
  for (let i = 0; i < stepsBack; i++) {
    const dayBeforeStart = subOneDay(parseISODate(window.cycleStartDate));
    window = calculateCurrentCycle(milestone, dayBeforeStart);
  }
  return window;
}

/**
 * Recompute every tier of a milestone for its current earning window.
 *
 * Returns NEW tier objects (never mutates the input array) with refreshed
 * current_progress_amount, achieved, and achieved_date. Pure — the caller
 * persists each changed tier via data/milestoneTiers.updateMilestoneTier.
 *
 * achieved_date is kept consistent with achieved: it is set to `today` the first
 * time a tier becomes achieved, preserved (not overwritten) on later recomputes
 * while it stays achieved, and cleared to null whenever the tier is not achieved —
 * so a stale date never sits beside achieved:false. `today` defaults to the
 * current date; tests inject a fixed value for determinism.
 *
 * Tiers whose milestone_id does not match `milestone.id` are passed through as
 * unchanged copies and ignored for the highest_only computation, so a caller that
 * over-supplies rows can't corrupt the result (mirrors recomputeCardBalance
 * filtering transactions to the card it was asked about).
 */
export function recomputeMilestoneProgress(
  milestone: Milestone,
  tiers: MilestoneTier[],
  transactions: Transaction[],
  today: Date = new Date(),
): MilestoneTier[] {
  const { cycleStartDate, cycleEndDate } = earningWindow(milestone, today);
  const startMs = parseISODate(cycleStartDate).getTime();
  const endMs = parseISODate(cycleEndDate).getTime();

  // Single shared spend pool: this card's transactions dated within the window
  // (both boundaries inclusive).
  const progress = transactions
    .filter((t) => {
      if (t.card_id !== milestone.card_id) return false;
      const ms = parseISODate(t.date).getTime();
      return ms >= startMs && ms <= endMs;
    })
    .reduce((sum, t) => sum + t.amount, 0);

  const ownTiers = tiers.filter((t) => t.milestone_id === milestone.id);

  // For highest_only, only the single highest crossed threshold counts. Compute
  // it once; null means no tier is crossed yet.
  let highestCrossed: number | null = null;
  if (milestone.tier_type === "highest_only") {
    for (const t of ownTiers) {
      if (
        t.tier_threshold_amount <= progress &&
        (highestCrossed === null || t.tier_threshold_amount > highestCrossed)
      ) {
        highestCrossed = t.tier_threshold_amount;
      }
    }
  }

  const todayISO = toISODate(today);

  return tiers.map((tier) => {
    // Pass foreign tiers through untouched (as a fresh copy).
    if (tier.milestone_id !== milestone.id) {
      return { ...tier };
    }

    const crossed = tier.tier_threshold_amount <= progress;
    const computedAchieved =
      milestone.tier_type === "cumulative"
        ? crossed
        : tier.tier_threshold_amount === highestCrossed;

    // Manual override always wins over the computed status.
    const achieved =
      tier.manual_override_achieved !== null
        ? tier.manual_override_achieved
        : computedAchieved;

    // Keep achieved_date in lock-step with achieved: stamp `today` on the first
    // achievement, preserve an existing stamp while it stays achieved, clear it
    // when not achieved.
    let achievedDate: string | null;
    if (achieved) {
      achievedDate = tier.achieved_date ?? todayISO;
    } else {
      achievedDate = null;
    }

    return {
      ...tier,
      current_progress_amount: progress,
      achieved,
      achieved_date: achievedDate,
    };
  });
}
