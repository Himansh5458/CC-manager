// milestoneCycles.ts — cycle-date business logic for milestone tracks.
//
// This is the first module in src/lib/calculations/, the home for business logic
// (reward math, milestone math, FY date logic) that must never live inline in an
// API route (see src/lib/CLAUDE.md rule 2). CRUD for the Milestone tab lives
// separately in src/lib/data/milestones.ts; this file only computes, it never
// reads or writes the database.
//
// ── Timezone policy ──────────────────────────────────────────────────────────
// All date math is done in UTC. Inputs are ISO date strings (YYYY-MM-DD) which we
// parse as UTC midnight, and the `today` argument is read via its UTC calendar
// fields only. This makes results deterministic regardless of the server's local
// timezone: a cycle boundary is a pure calendar fact, never shifted by an offset.
// Output is always a YYYY-MM-DD string.

import type { Milestone } from "../types/schema";

export interface CycleWindow {
  cycleStartDate: string;
  cycleEndDate: string;
}

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

/** Strip any time-of-day from a Date, returning that calendar day at UTC midnight. */
function toUTCMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * Add `n` calendar months to a UTC date, clamping the day-of-month to the last
 * valid day of the target month rather than letting it overflow.
 *
 * LEAP-YEAR / SHORT-MONTH POLICY: an anchor day that does not exist in the target
 * month rolls *back* to that month's last day. So an anniversary anchored on
 * Feb 29 (a leap year) yields Feb 28 in non-leap years, and a Jan 31 anchor
 * yields Feb 28/29. We clamp instead of using JS's native overflow (which would
 * push Feb 29 forward to Mar 1) because the milestone cycle must stay inside the
 * intended month.
 */
function addMonths(date: Date, n: number): Date {
  const day = date.getUTCDate();
  // Date.UTC normalises month overflow/underflow (incl. negative n) into the
  // correct year+month; day 1 keeps us safely inside that month for now.
  const firstOfTarget = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, 1),
  );
  const ty = firstOfTarget.getUTCFullYear();
  const tm = firstOfTarget.getUTCMonth();
  // Day 0 of the *next* month == last day of the target month.
  const lastDayOfTarget = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ty, tm, Math.min(day, lastDayOfTarget)));
}

/** Subtract one day from a UTC date. */
function subOneDay(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - 1,
    ),
  );
}

/** Number of months in one cycle step for a given frequency (annual=12, etc.). */
function stepMonths(frequency: Milestone["cycle_frequency"]): number {
  switch (frequency) {
    case "monthly":
      return 1;
    case "quarterly":
      return 3;
    case "annual":
      return 12;
    default:
      // "custom" never reaches here — callers handle it before stepping.
      throw new Error(`stepMonths: unsupported frequency "${frequency}"`);
  }
}

/**
 * Compute the milestone's current cycle window for the given `today`.
 *
 * - cycle_anchor "calendar": cycles align to the calendar (months, standard
 *   Jan–Mar/Apr–Jun/… quarters, or Jan 1–Dec 31 years).
 * - cycle_anchor "anniversary": cycles align to `anchor_reference_date` (the
 *   card's issuance date), stepping in 1/3/12-month increments from it. The
 *   start is the most recent anchor multiple on or before `today`; the end is one
 *   day before the next one. Leap-year/short-month days are clamped — see
 *   addMonths().
 * - cycle_frequency "custom" (either anchor): returned unchanged — custom cycles
 *   are author-defined and never auto-computed.
 *
 * Both boundaries are inclusive YYYY-MM-DD strings.
 */
export function calculateCurrentCycle(
  milestone: Milestone,
  today: Date,
): CycleWindow {
  // Custom cycles are never auto-computed: echo back the stored boundaries.
  if (milestone.cycle_frequency === "custom") {
    return {
      cycleStartDate: milestone.cycle_start_date,
      cycleEndDate: milestone.cycle_end_date,
    };
  }

  const now = toUTCMidnight(today);

  if (milestone.cycle_anchor === "calendar") {
    return calculateCalendarCycle(milestone.cycle_frequency, now);
  }

  // anchor_reference_date is required for anniversary cycles.
  if (milestone.anchor_reference_date === null) {
    throw new Error(
      `calculateCurrentCycle: milestone "${milestone.id}" uses an anniversary ` +
        `anchor but has no anchor_reference_date.`,
    );
  }
  return calculateAnniversaryCycle(
    milestone.cycle_frequency,
    parseISODate(milestone.anchor_reference_date),
    now,
  );
}

/** Calendar-aligned cycle boundaries for `now` (already UTC midnight). */
function calculateCalendarCycle(
  frequency: Exclude<Milestone["cycle_frequency"], "custom">,
  now: Date,
): CycleWindow {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed

  switch (frequency) {
    case "monthly": {
      const start = new Date(Date.UTC(year, month, 1));
      const end = new Date(Date.UTC(year, month + 1, 0)); // day 0 of next month
      return { cycleStartDate: toISODate(start), cycleEndDate: toISODate(end) };
    }
    case "quarterly": {
      // Standard calendar quarters: Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec.
      const quarterStartMonth = Math.floor(month / 3) * 3;
      const start = new Date(Date.UTC(year, quarterStartMonth, 1));
      const end = new Date(Date.UTC(year, quarterStartMonth + 3, 0));
      return { cycleStartDate: toISODate(start), cycleEndDate: toISODate(end) };
    }
    case "annual": {
      const start = new Date(Date.UTC(year, 0, 1));
      const end = new Date(Date.UTC(year, 11, 31));
      return { cycleStartDate: toISODate(start), cycleEndDate: toISODate(end) };
    }
  }
}

/** Anniversary-aligned cycle boundaries stepping from `anchor` in fixed increments. */
function calculateAnniversaryCycle(
  frequency: Exclude<Milestone["cycle_frequency"], "custom">,
  anchor: Date,
  now: Date,
): CycleWindow {
  const step = stepMonths(frequency);
  const anchorMid = toUTCMidnight(anchor);

  // Find integer k such that  anchor+(k*step) <= now < anchor+((k+1)*step).
  // We always measure k*step from the ORIGINAL anchor (not by accumulating
  // clamped steps), so a Feb-29 anchor still lands on Feb 29 in future leap
  // years rather than being permanently pinned to Feb 28 after the first
  // short-month clamp.
  let k = 0;
  // Advance while the *next* boundary is still on or before today.
  while (addMonths(anchorMid, (k + 1) * step).getTime() <= now.getTime()) {
    k++;
  }
  // Retreat in case `now` falls before the anchor entirely (k goes negative).
  while (addMonths(anchorMid, k * step).getTime() > now.getTime()) {
    k--;
  }

  const cycleStart = addMonths(anchorMid, k * step);
  const cycleEnd = subOneDay(addMonths(anchorMid, (k + 1) * step));

  return {
    cycleStartDate: toISODate(cycleStart),
    cycleEndDate: toISODate(cycleEnd),
  };
}
