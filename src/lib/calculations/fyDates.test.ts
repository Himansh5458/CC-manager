// Standalone unit test for the Indian financial-year date utilities.
//
// Run with: npx tsx src/lib/calculations/fyDates.test.ts
//
// PURE logic (no database I/O), so — like milestoneCycles.test.ts — it does not
// snapshot/restore data/database.json. It builds Date fixtures in memory and
// asserts on getFinancialYear / getFinancialYearBounds / isDateInFinancialYear.

import {
  getFinancialYear,
  getFinancialYearBounds,
  isDateInFinancialYear,
} from "./fyDates";

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

// Parse YYYY-MM-DD as UTC midnight, mirroring the module's own date policy so the
// "date" we feed in is unambiguous regardless of the test runner's TZ.
function utc(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function main(): void {
  // ── getFinancialYear: a date in each part of an FY ──────────────────────────
  check(
    "getFinancialYear June (mid-FY) 2026-06-21 -> 2026-27",
    getFinancialYear(utc("2026-06-21")) === "2026-27",
  );
  check(
    "getFinancialYear December 2026-12-25 -> 2026-27",
    getFinancialYear(utc("2026-12-25")) === "2026-27",
  );
  check(
    "getFinancialYear January (next calendar yr, same FY) 2027-01-10 -> 2026-27",
    getFinancialYear(utc("2027-01-10")) === "2026-27",
  );
  check(
    "getFinancialYear February (Jan–Mar belongs to prior April's FY) 2026-02-15 -> 2025-26",
    getFinancialYear(utc("2026-02-15")) === "2025-26",
  );

  // ── getFinancialYear: the exact boundary days ───────────────────────────────
  check(
    "getFinancialYear FY first day 2026-04-01 -> 2026-27",
    getFinancialYear(utc("2026-04-01")) === "2026-27",
  );
  check(
    "getFinancialYear FY last day 2027-03-31 -> 2026-27",
    getFinancialYear(utc("2027-03-31")) === "2026-27",
  );
  check(
    "getFinancialYear day before FY 2026-03-31 -> 2025-26",
    getFinancialYear(utc("2026-03-31")) === "2025-26",
  );

  // Century-rollover formatting: end-year short part pads to two digits.
  check(
    "getFinancialYear 1999-26 -> end short '00' (1999-00)",
    getFinancialYear(utc("1999-06-01")) === "1999-00",
  );

  // ── getFinancialYearBounds: round to ISO bounds ─────────────────────────────
  const b2627 = getFinancialYearBounds("2026-27");
  check(
    'getFinancialYearBounds "2026-27" -> 2026-04-01 .. 2027-03-31',
    b2627.start === "2026-04-01" && b2627.end === "2027-03-31",
  );
  const b2526 = getFinancialYearBounds("2025-26");
  check(
    'getFinancialYearBounds "2025-26" -> 2025-04-01 .. 2026-03-31',
    b2526.start === "2025-04-01" && b2526.end === "2026-03-31",
  );

  // ── isDateInFinancialYear: inside, both boundaries, just outside both ends ───
  check(
    "isDateInFinancialYear mid-FY 2026-06-21 in 2026-27 -> true",
    isDateInFinancialYear(utc("2026-06-21"), "2026-27") === true,
  );
  check(
    "isDateInFinancialYear first day 2026-04-01 in 2026-27 -> true",
    isDateInFinancialYear(utc("2026-04-01"), "2026-27") === true,
  );
  check(
    "isDateInFinancialYear last day 2027-03-31 in 2026-27 -> true",
    isDateInFinancialYear(utc("2027-03-31"), "2026-27") === true,
  );
  check(
    "isDateInFinancialYear day before 2026-03-31 in 2026-27 -> false",
    isDateInFinancialYear(utc("2026-03-31"), "2026-27") === false,
  );
  check(
    "isDateInFinancialYear day after 2027-04-01 in 2026-27 -> false",
    isDateInFinancialYear(utc("2027-04-01"), "2026-27") === false,
  );

  // ── Round-trip consistency: FY(date) then bounds must contain the date ───────
  const roundTripDates = [
    "2026-04-01", // FY first day
    "2026-06-21", // mid
    "2026-12-31", // year-end inside FY
    "2027-01-01", // new calendar year, same FY
    "2027-03-31", // FY last day
    "2026-02-15", // Jan–Mar of prior FY
    "2024-02-29", // leap day
  ];
  for (const ds of roundTripDates) {
    const fy = getFinancialYear(utc(ds));
    check(
      `round-trip ${ds}: FY=${fy} and isDateInFinancialYear==true`,
      isDateInFinancialYear(utc(ds), fy) === true,
    );
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
