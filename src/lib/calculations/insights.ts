// insights.ts — predictive / advisory derivations for the dashboard.
//
// Part of src/lib/calculations/, the home for pure business logic (see
// src/lib/CLAUDE.md rule 2). These three functions turn a card's transaction,
// payment, recurring-charge and milestone rows into forward-looking guidance:
//   1. predictNextBill            — what the next statement is likely to total.
//   2. detectSpendAnomalies       — categories spiking versus their own history.
//   3. getMilestoneProximityNudges— milestone tiers close enough to be worth a push.
// Like every module here they are PURE: rows come in, computed results go out;
// nothing is ever read from or written to the database (the caller fetches via the
// data layer).
//
// ── Statement-cycle reuse ────────────────────────────────────────────────────
// "Statement cycle" means exactly what cardBalance.ts means by it — everything
// dated on/after the most recent occurrence of the card's `statement_date`
// (a bare day-of-month) that is ≤ a reference day. We REUSE
// cardBalance.mostRecentStatementDate rather than reimplement that anchor/clamp
// logic, so the cycle boundary can never drift between the two modules.
//
// ── Timezone policy ──────────────────────────────────────────────────────────
// All date math is UTC, identical to cardBalance.ts / milestoneCycles.ts: ISO
// YYYY-MM-DD strings are parsed as UTC midnight and `today` is read via its UTC
// calendar fields only. The small UTC helpers below are intentionally duplicated
// from those modules rather than shared, matching their self-contained convention.

import type {
  Card,
  Transaction,
  Payment,
  RecurringTransaction,
  Milestone,
  MilestoneTier,
} from "../types/schema";
import { mostRecentStatementDate } from "./cardBalance";

export interface BillPrediction {
  predictedAmount: number;
  breakdown: string;
}

export interface SpendAnomaly {
  category: string;
  currentCycleAmount: number;
  historicalAverage: number;
  percentAboveAverage: number;
}

export interface MilestoneNudge {
  milestoneId: string;
  trackName: string;
  nextTierThreshold: number;
  amountRemaining: number;
  rewardDescription: string;
}

// How many completed statement cycles of history the bill prediction / anomaly
// baselines look back over (fewer are used when fewer are available — see the
// "honesty" handling in each function).
const HISTORY_CYCLES = 3;

// ── small UTC date helpers (duplicated per module convention) ────────────────

/** Parse a YYYY-MM-DD string as a UTC-midnight Date. */
function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Strip any time-of-day, returning that calendar day at UTC midnight. */
function toUTCMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** Format a Date as a UTC YYYY-MM-DD string. */
function toISODate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Subtract one day from a UTC date. */
function subOneDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - 1),
  );
}

/** Round to `dp` decimal places without binary-float drift. */
function roundTo(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/**
 * Format a number as Indian-grouped rupees for human-readable breakdown strings
 * (e.g. 3200 → "₹3,200", 150000 → "₹1,50,000"). Rounded to whole rupees — these
 * strings are advisory, not accounting figures.
 */
function formatINR(n: number): string {
  const rounded = Math.round(n);
  const digits = Math.abs(rounded).toString();
  let grouped: string;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    grouped = `${rest},${last3}`;
  }
  return `${rounded < 0 ? "-" : ""}₹${grouped}`;
}

interface CycleWindow {
  startMs: number;
  endMs: number;
}

/**
 * The last `count` COMPLETED statement cycles ending before today's (still-open)
 * cycle, most-recent first. Each cycle runs from one `statement_date` occurrence
 * up to the day before the next — the current open cycle starts at
 * mostRecentStatementDate(statementDay, today) and is deliberately excluded, since
 * a partial in-progress cycle would understate the average.
 */
function completedCycles(
  statementDay: number,
  today: Date,
  count: number,
): CycleWindow[] {
  const windows: CycleWindow[] = [];
  // Upper edge = start of the next-newer cycle; first iteration's is the open cycle.
  let nextCycleStart = mostRecentStatementDate(statementDay, today);
  for (let i = 0; i < count; i++) {
    const end = subOneDay(nextCycleStart);
    const start = mostRecentStatementDate(statementDay, end);
    windows.push({ startMs: start.getTime(), endMs: end.getTime() });
    nextCycleStart = start;
  }
  return windows;
}

/**
 * Keep only cycles for which we actually have transaction history — i.e. cycles
 * that end on/after the card's earliest recorded transaction. A cycle entirely
 * before any recorded spend isn't "a cycle with ₹0 spend", it's a cycle we have
 * no data for, and averaging over it would invent false precision (the honesty
 * rule in the task). A newer empty cycle that sits *within* the data span is a
 * genuine ₹0 and is kept. Returns [] when the card has no transactions at all.
 */
function availableCycles(
  windows: CycleWindow[],
  earliestTxnMs: number | null,
): CycleWindow[] {
  if (earliestTxnMs === null) return [];
  return windows.filter((w) => w.endMs >= earliestTxnMs);
}

/**
 * Predict the next statement total for a card:
 *   predictedAmount = Σ(active recurring charges on this card)
 *                   + average non-recurring spend over the available completed cycles.
 *
 * "Active recurring" respects each row's `active` flag and its start_date/end_date
 * against `today` (start ≤ today ≤ end, end_date null = indefinite) — only charges
 * that will actually post next cycle are added. Those same recurring charges are
 * EXCLUDED from the historical average (matched by card + category + amount) so a
 * recurring charge that was also logged as a one-off transaction in a past cycle
 * is never counted twice — once forward and once in the baseline.
 *
 * History honesty: the average is taken over however many of the last 3 completed
 * cycles we actually have transaction history for (a card month old has 1, not a
 * pretend 3), and the breakdown string says how many cycles it used. With no
 * completed-cycle history at all, only the recurring portion is predicted and the
 * breakdown says so rather than implying a ₹0 spend forecast.
 *
 * `today` defaults to the current date; tests inject a fixed value for determinism.
 */
export function predictNextBill(
  card: Card,
  transactions: Transaction[],
  payments: Payment[],
  recurringTransactions: RecurringTransaction[],
  today: Date = new Date(),
): BillPrediction {
  void payments; // not needed for the prediction; part of the documented signature.
  const now = toUTCMidnight(today);
  const todayISO = toISODate(now);

  // Active recurring charges for this card that will post next cycle.
  const activeRecurring = recurringTransactions.filter(
    (r) =>
      r.card_id === card.id &&
      r.active &&
      r.start_date <= todayISO &&
      (r.end_date === null || r.end_date >= todayISO),
  );
  const recurringSum = activeRecurring.reduce((sum, r) => sum + r.amount, 0);

  // A transaction is treated as a recurring instance (and excluded from the
  // variable baseline) if it matches an active recurring charge on this card by
  // category + amount — the only join available without a foreign key.
  const isRecurringInstance = (t: Transaction): boolean =>
    activeRecurring.some(
      (r) => r.category === t.category && r.amount === t.amount,
    );

  const cardTxns = transactions.filter((t) => t.card_id === card.id);
  const earliestTxnMs = cardTxns.length
    ? Math.min(...cardTxns.map((t) => parseISODate(t.date).getTime()))
    : null;

  const windows = availableCycles(
    completedCycles(card.statement_date, now, HISTORY_CYCLES),
    earliestTxnMs,
  );

  // Average non-recurring spend per available completed cycle.
  let variableTotal = 0;
  for (const w of windows) {
    variableTotal += cardTxns
      .filter((t) => {
        if (isRecurringInstance(t)) return false;
        const ms = parseISODate(t.date).getTime();
        return ms >= w.startMs && ms <= w.endMs;
      })
      .reduce((sum, t) => sum + t.amount, 0);
  }
  const cycleCount = windows.length;
  const averageVariable = cycleCount > 0 ? variableTotal / cycleCount : 0;

  const predictedAmount = roundTo(recurringSum + averageVariable, 2);

  // ── human-readable breakdown ────────────────────────────────────────────────
  const recurringPart =
    recurringSum > 0 ? `${formatINR(recurringSum)} recurring` : null;

  let variablePart: string | null;
  if (cycleCount === 0) {
    variablePart = null;
  } else {
    const cyclesLabel = cycleCount === 1 ? "1 cycle" : `last ${cycleCount} cycles`;
    const qualifier =
      cycleCount < HISTORY_CYCLES
        ? `(only ${cyclesLabel} of history)`
        : `(${cyclesLabel})`;
    variablePart = `${formatINR(averageVariable)} avg spend ${qualifier}`;
  }

  let breakdown: string;
  if (recurringPart && variablePart) {
    breakdown = `${recurringPart} + ${variablePart}`;
  } else if (recurringPart) {
    breakdown = `${recurringPart} (no prior cycle spend data yet)`;
  } else if (variablePart) {
    breakdown = `no recurring charges + ${variablePart}`;
  } else {
    breakdown = "no recurring charges and no prior cycle spend data yet";
  }

  return { predictedAmount, breakdown };
}

/**
 * Flag categories whose CURRENT statement-cycle spend is running meaningfully hot
 * versus their own recent history.
 *
 * Current cycle = transactions dated on/after mostRecentStatementDate(statement_date,
 * today) up to today (inclusive), grouped by category. Each category's current sum
 * is compared against its average over the available prior completed cycles (same
 * "only cycles we have history for" honesty rule as predictNextBill). A category is
 * returned only when BOTH:
 *   • currentCycleAmount ≥ 1.30 × historicalAverage (at least 30% above), and
 *   • historicalAverage > 0.
 * The second guard deliberately drops first-time categories: a category with no
 * prior spend isn't an "anomaly", it's just a new kind of purchase, and flagging
 * every first purchase would make the signal useless.
 *
 * Recurring charges are NOT specially excluded here — a stable recurring amount
 * sits at ~0% above its own average and is naturally filtered out by the 30% gate.
 *
 * `today` defaults to the current date; tests inject a fixed value for determinism.
 */
export function detectSpendAnomalies(
  card: Card,
  transactions: Transaction[],
  today: Date = new Date(),
): SpendAnomaly[] {
  const now = toUTCMidnight(today);
  const todayMs = now.getTime();
  const cardTxns = transactions.filter((t) => t.card_id === card.id);

  const currentCycleStartMs = mostRecentStatementDate(
    card.statement_date,
    now,
  ).getTime();

  // Current-cycle spend per category.
  const currentByCategory = new Map<string, number>();
  for (const t of cardTxns) {
    const ms = parseISODate(t.date).getTime();
    if (ms >= currentCycleStartMs && ms <= todayMs) {
      currentByCategory.set(
        t.category,
        (currentByCategory.get(t.category) ?? 0) + t.amount,
      );
    }
  }

  const earliestTxnMs = cardTxns.length
    ? Math.min(...cardTxns.map((t) => parseISODate(t.date).getTime()))
    : null;
  const windows = availableCycles(
    completedCycles(card.statement_date, now, HISTORY_CYCLES),
    earliestTxnMs,
  );
  const cycleCount = windows.length;

  const anomalies: SpendAnomaly[] = [];
  for (const [category, currentCycleAmount] of currentByCategory) {
    if (cycleCount === 0) continue; // no baseline to compare against.

    // This category's total across every available cycle (cycles where it had no
    // spend contribute 0, which is the correct "usual" baseline).
    let historicalTotal = 0;
    for (const w of windows) {
      historicalTotal += cardTxns
        .filter((t) => {
          if (t.category !== category) return false;
          const ms = parseISODate(t.date).getTime();
          return ms >= w.startMs && ms <= w.endMs;
        })
        .reduce((sum, t) => sum + t.amount, 0);
    }
    const historicalAverage = historicalTotal / cycleCount;

    if (historicalAverage <= 0) continue; // first-time category — not an anomaly.
    if (currentCycleAmount < 1.3 * historicalAverage) continue; // within normal range.

    anomalies.push({
      category,
      currentCycleAmount: roundTo(currentCycleAmount, 2),
      historicalAverage: roundTo(historicalAverage, 2),
      percentAboveAverage: roundTo(
        ((currentCycleAmount - historicalAverage) / historicalAverage) * 100,
        1,
      ),
    });
  }

  return anomalies;
}

/**
 * Surface milestone tiers the user is close enough to reaching that a nudge is
 * actually useful.
 *
 * For each ACTIVE milestone, the "next tier" is the lowest-threshold tier that is
 * not yet achieved — where achievement respects `manual_override_achieved` (a
 * non-null override wins over the computed `achieved` flag, mirroring the
 * milestoneProgress / getEffectiveUtilization rule). `amountRemaining` uses the
 * tier's own `current_progress_amount` as-is (assumed already current — this
 * function nudges, it does not recompute progress).
 *
 * ── Proximity cutoff (documented judgment call) ──────────────────────────────
 * A tier is only returned when `amountRemaining > 0` AND
 * `amountRemaining ≤ 50% of the tier threshold` — i.e. the user is at least
 * halfway there. Rationale: a "nudge" should be motivating and reachable. Telling
 * someone they're ₹2.66 lakh short of a ₹3 lakh tier (9% of the way) is noise, not
 * encouragement; once they're past the halfway mark the remaining spend is
 * plausibly closeable within the cycle, which is exactly when a reminder changes
 * behaviour. 50% is the cutoff; it's a single named constant so it can be tuned.
 *
 * `today` is accepted for signature symmetry with the other insight functions and
 * future cycle-aware filtering; tier progress is taken as already-current, so the
 * current implementation does not branch on it.
 */
export function getMilestoneProximityNudges(
  milestones: Milestone[],
  tiers: MilestoneTier[],
  today: Date = new Date(),
): MilestoneNudge[] {
  void today; // progress assumed current; reserved for future cycle-aware logic.
  const PROXIMITY_FRACTION = 0.5; // within 50% of the threshold still to go.

  const nudges: MilestoneNudge[] = [];

  for (const milestone of milestones) {
    if (!milestone.active) continue;

    const milestoneTiers = tiers.filter(
      (t) => t.milestone_id === milestone.id,
    );

    // Next tier = lowest threshold not yet achieved (override wins).
    let nextTier: MilestoneTier | null = null;
    for (const tier of milestoneTiers) {
      const achieved =
        tier.manual_override_achieved !== null
          ? tier.manual_override_achieved
          : tier.achieved;
      if (achieved) continue;
      if (
        nextTier === null ||
        tier.tier_threshold_amount < nextTier.tier_threshold_amount
      ) {
        nextTier = tier;
      }
    }

    if (nextTier === null) continue; // every tier already achieved.

    const amountRemaining = roundTo(
      nextTier.tier_threshold_amount - nextTier.current_progress_amount,
      2,
    );
    if (amountRemaining <= 0) continue; // already crossed, just not flagged.
    if (amountRemaining > PROXIMITY_FRACTION * nextTier.tier_threshold_amount) {
      continue; // too far away to be a useful nudge.
    }

    const rewardValueINR = nextTier.reward_value * nextTier.redemption_value_per_unit;
    const rewardDescription = `${nextTier.reward_value} ${nextTier.reward_unit} (worth ${formatINR(rewardValueINR)})`;

    nudges.push({
      milestoneId: milestone.id,
      trackName: milestone.track_name,
      nextTierThreshold: nextTier.tier_threshold_amount,
      amountRemaining,
      rewardDescription,
    });
  }

  return nudges;
}
