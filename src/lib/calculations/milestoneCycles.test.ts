// Standalone unit test for the milestone cycle-date business logic.
//
// Run with: npx tsx src/lib/calculations/milestoneCycles.test.ts
//
// This is PURE logic (no database I/O), so unlike the data-layer smoke tests it
// does not need to snapshot/restore data/database.json. It builds Milestone
// fixtures in memory and asserts on calculateCurrentCycle().

import { calculateCurrentCycle } from "./milestoneCycles";
import type { Milestone } from "../types/schema";

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

// Build a Milestone fixture, overriding only the fields a given test cares about.
function makeMilestone(overrides: Partial<Milestone>): Milestone {
  return {
    id: "ms-test",
    card_id: "card-test",
    track_name: "Test Track",
    cycle_frequency: "annual",
    cycle_anchor: "calendar",
    anchor_reference_date: null,
    tier_type: "cumulative",
    earning_window_offset: 0,
    cycle_start_date: "",
    cycle_end_date: "",
    active: true,
    ...overrides,
  };
}

// Parse a YYYY-MM-DD as UTC midnight, mirroring the module's own date policy so
// the "today" we feed in is unambiguous regardless of the test runner's TZ.
function utc(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function main(): void {
  // ── Calendar quarterly: one date in each of the four standard quarters ──────
  const q = makeMilestone({
    cycle_frequency: "quarterly",
    cycle_anchor: "calendar",
  });

  const q1 = calculateCurrentCycle(q, utc("2026-02-10"));
  check(
    "calendar quarterly Q1 (Feb) -> 2026-01-01..2026-03-31",
    q1.cycleStartDate === "2026-01-01" && q1.cycleEndDate === "2026-03-31",
  );

  const q2 = calculateCurrentCycle(q, utc("2026-05-20"));
  check(
    "calendar quarterly Q2 (May) -> 2026-04-01..2026-06-30",
    q2.cycleStartDate === "2026-04-01" && q2.cycleEndDate === "2026-06-30",
  );

  const q3 = calculateCurrentCycle(q, utc("2026-08-31"));
  check(
    "calendar quarterly Q3 (Aug) -> 2026-07-01..2026-09-30",
    q3.cycleStartDate === "2026-07-01" && q3.cycleEndDate === "2026-09-30",
  );

  const q4 = calculateCurrentCycle(q, utc("2026-11-15"));
  check(
    "calendar quarterly Q4 (Nov) -> 2026-10-01..2026-12-31",
    q4.cycleStartDate === "2026-10-01" && q4.cycleEndDate === "2026-12-31",
  );

  // Quarter boundary days (first and last day of a quarter) land correctly.
  const qStart = calculateCurrentCycle(q, utc("2026-04-01"));
  check(
    "calendar quarterly on first day of Q2 -> 2026-04-01..2026-06-30",
    qStart.cycleStartDate === "2026-04-01" &&
      qStart.cycleEndDate === "2026-06-30",
  );
  const qEnd = calculateCurrentCycle(q, utc("2026-06-30"));
  check(
    "calendar quarterly on last day of Q2 -> 2026-04-01..2026-06-30",
    qEnd.cycleStartDate === "2026-04-01" && qEnd.cycleEndDate === "2026-06-30",
  );

  // ── Calendar annual: Jan 1 .. Dec 31 of the current year ────────────────────
  const annual = makeMilestone({
    cycle_frequency: "annual",
    cycle_anchor: "calendar",
  });
  const a = calculateCurrentCycle(annual, utc("2026-06-21"));
  check(
    "calendar annual -> 2026-01-01..2026-12-31",
    a.cycleStartDate === "2026-01-01" && a.cycleEndDate === "2026-12-31",
  );

  // ── Calendar monthly (sanity check, incl. month-length) ─────────────────────
  const monthly = makeMilestone({
    cycle_frequency: "monthly",
    cycle_anchor: "calendar",
  });
  const feb = calculateCurrentCycle(monthly, utc("2026-02-15"));
  check(
    "calendar monthly Feb 2026 (non-leap) -> 2026-02-01..2026-02-28",
    feb.cycleStartDate === "2026-02-01" && feb.cycleEndDate === "2026-02-28",
  );
  const febLeap = calculateCurrentCycle(monthly, utc("2028-02-15"));
  check(
    "calendar monthly Feb 2028 (leap) -> 2028-02-01..2028-02-29",
    febLeap.cycleStartDate === "2028-02-01" &&
      febLeap.cycleEndDate === "2028-02-29",
  );

  // ── Anniversary annual: mirrors seed Axis Atlas (anchor 2025-03-15) ─────────
  const atlas = makeMilestone({
    id: "ms-atlas-anniv",
    card_id: "card-atlas-001",
    cycle_frequency: "annual",
    cycle_anchor: "anniversary",
    anchor_reference_date: "2025-03-15",
  });

  // today inside the cycle that starts on the 2026 anniversary -> matches seed.
  const atlasNow = calculateCurrentCycle(atlas, utc("2026-06-21"));
  check(
    "anniversary annual, today 2026-06-21 -> seed 2026-03-15..2027-03-14",
    atlasNow.cycleStartDate === "2026-03-15" &&
      atlasNow.cycleEndDate === "2027-03-14",
  );

  // today exactly ON the anniversary -> that day is the (inclusive) cycle start.
  const atlasOnAnniv = calculateCurrentCycle(atlas, utc("2026-03-15"));
  check(
    "anniversary annual, today == anniversary -> 2026-03-15..2027-03-14",
    atlasOnAnniv.cycleStartDate === "2026-03-15" &&
      atlasOnAnniv.cycleEndDate === "2027-03-14",
  );

  // today one day BEFORE the 2026 anniversary -> still the prior (2025) cycle.
  const atlasBefore = calculateCurrentCycle(atlas, utc("2026-03-14"));
  check(
    "anniversary annual, today 2026-03-14 -> prior cycle 2025-03-15..2026-03-14",
    atlasBefore.cycleStartDate === "2025-03-15" &&
      atlasBefore.cycleEndDate === "2026-03-14",
  );

  // today AFTER the next anniversary rolls forward to the 2027 cycle.
  const atlasAfter = calculateCurrentCycle(atlas, utc("2027-04-01"));
  check(
    "anniversary annual, today 2027-04-01 -> next cycle 2027-03-15..2028-03-14",
    atlasAfter.cycleStartDate === "2027-03-15" &&
      atlasAfter.cycleEndDate === "2028-03-14",
  );

  // ── Anniversary quarterly / monthly stepping from the anchor ────────────────
  const anivQ = makeMilestone({
    cycle_frequency: "quarterly",
    cycle_anchor: "anniversary",
    anchor_reference_date: "2025-03-15",
  });
  // 2025-03-15 + steps of 3 months: ...2026-03-15, 2026-06-15, 2026-09-15...
  // today 2026-06-21 sits in the 2026-06-15 cycle, ending day before 2026-09-15.
  const anivQNow = calculateCurrentCycle(anivQ, utc("2026-06-21"));
  check(
    "anniversary quarterly, today 2026-06-21 -> 2026-06-15..2026-09-14",
    anivQNow.cycleStartDate === "2026-06-15" &&
      anivQNow.cycleEndDate === "2026-09-14",
  );

  const anivM = makeMilestone({
    cycle_frequency: "monthly",
    cycle_anchor: "anniversary",
    anchor_reference_date: "2025-03-15",
  });
  // Monthly steps land on the 15th; today 2026-06-21 -> 2026-06-15..2026-07-14.
  const anivMNow = calculateCurrentCycle(anivM, utc("2026-06-21"));
  check(
    "anniversary monthly, today 2026-06-21 -> 2026-06-15..2026-07-14",
    anivMNow.cycleStartDate === "2026-06-15" &&
      anivMNow.cycleEndDate === "2026-07-14",
  );

  // ── Leap-year edge case: anchor Feb 29 of a leap year, computed in a non-leap year ──
  const leap = makeMilestone({
    cycle_frequency: "annual",
    cycle_anchor: "anniversary",
    anchor_reference_date: "2024-02-29",
  });
  // 2025 is not a leap year: the Feb-29 anchor clamps to Feb 28 for that cycle's
  // boundaries. today 2025-06-01 -> 2025-02-28 .. 2026-02-27.
  const leapNonLeapYear = calculateCurrentCycle(leap, utc("2025-06-01"));
  check(
    "anniversary annual leap anchor, today 2025-06-01 -> 2025-02-28..2026-02-27",
    leapNonLeapYear.cycleStartDate === "2025-02-28" &&
      leapNonLeapYear.cycleEndDate === "2026-02-27",
  );
  // In the next leap year (2028) the cycle START recovers Feb 29, because k*step
  // is always measured from the original anchor, never from a clamped value. The
  // cycle END is the day before the *next* anniversary, which falls in non-leap
  // 2029 and clamps to Feb 28 -> minus one day -> Feb 27.
  const leapLeapYear = calculateCurrentCycle(leap, utc("2028-06-01"));
  check(
    "anniversary annual leap anchor, today 2028-06-01 -> 2028-02-29..2029-02-27",
    leapLeapYear.cycleStartDate === "2028-02-29" &&
      leapLeapYear.cycleEndDate === "2029-02-27",
  );

  // ── Custom cycle: returns the milestone's stored dates unchanged ────────────
  const customCal = makeMilestone({
    cycle_frequency: "custom",
    cycle_anchor: "calendar",
    cycle_start_date: "2026-02-10",
    cycle_end_date: "2026-08-09",
  });
  const customCalOut = calculateCurrentCycle(customCal, utc("2026-06-21"));
  check(
    "custom (calendar) returns stored dates unchanged",
    customCalOut.cycleStartDate === "2026-02-10" &&
      customCalOut.cycleEndDate === "2026-08-09",
  );

  const customAniv = makeMilestone({
    cycle_frequency: "custom",
    cycle_anchor: "anniversary",
    anchor_reference_date: "2025-03-15",
    cycle_start_date: "2026-01-01",
    cycle_end_date: "2026-12-31",
  });
  const customAnivOut = calculateCurrentCycle(customAniv, utc("2026-06-21"));
  check(
    "custom (anniversary) returns stored dates unchanged",
    customAnivOut.cycleStartDate === "2026-01-01" &&
      customAnivOut.cycleEndDate === "2026-12-31",
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
