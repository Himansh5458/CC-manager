// fyDates.ts — Indian financial-year date utilities.
//
// Part of src/lib/calculations/, the home for pure business logic (see
// src/lib/CLAUDE.md rule 2). This module derives financial-year strings and
// bounds from dates; it never reads or writes the database.
//
// India's financial year (FY) runs April 1 → March 31. We name an FY by its two
// calendar years in "2026-27" form: the year it STARTS, then the last two digits
// of the year it ENDS. So a spend on 2026-06-21 is in FY "2026-27", while one on
// 2026-02-15 is in FY "2025-26" (Jan–Mar belong to the FY that began the prior
// April).
//
// ── Timezone policy ──────────────────────────────────────────────────────────
// All date math is done in UTC, identical to calculations/milestoneCycles.ts.
// Inputs are either `Date` objects (read via their UTC calendar fields only) or
// ISO `YYYY-MM-DD` strings (parsed as UTC midnight). FY membership is a pure
// calendar fact, so it must never shift with the server's local timezone. The
// small UTC helpers below are intentionally duplicated from milestoneCycles.ts
// rather than shared, matching that module's self-contained convention.

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

/** April is month index 3 (0-indexed). FY starts in April. */
const FY_START_MONTH = 3;

/**
 * Return the Indian financial year containing `date`, formatted "2026-27"
 * (start calendar year, dash, last two digits of the end calendar year).
 *
 * April–December → FY starting this calendar year.
 * January–March  → FY starting the PREVIOUS calendar year.
 */
export function getFinancialYear(date: Date): string {
  const now = toUTCMidnight(date);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed; April = 3
  const startYear = month >= FY_START_MONTH ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYearShort}`;
}

/**
 * Given an FY string like "2026-27", return its inclusive ISO date bounds:
 * `{ start: "2026-04-01", end: "2027-03-31" }`.
 *
 * Only the leading start-year is parsed; the end year is derived as start + 1,
 * so a malformed suffix can never desynchronise the bounds.
 */
export function getFinancialYearBounds(fyString: string): {
  start: string;
  end: string;
} {
  const startYear = Number(fyString.slice(0, 4));
  if (!Number.isInteger(startYear)) {
    throw new Error(
      `getFinancialYearBounds: cannot parse start year from "${fyString}" ` +
        `(expected "YYYY-YY" form, e.g. "2026-27").`,
    );
  }
  const endYear = startYear + 1;
  return { start: `${startYear}-04-01`, end: `${endYear}-03-31` };
}

/**
 * True if `date` falls within the financial year named by `fyString`
 * (inclusive of both Apr 1 and Mar 31 boundaries).
 */
export function isDateInFinancialYear(date: Date, fyString: string): boolean {
  const { start, end } = getFinancialYearBounds(fyString);
  const t = toUTCMidnight(date).getTime();
  return t >= parseISODate(start).getTime() && t <= parseISODate(end).getTime();
}
