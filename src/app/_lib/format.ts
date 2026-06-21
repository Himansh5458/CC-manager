// format.ts — shared presentational helpers for the dashboard views.
//
// Pure formatting + design-system colour banding used by more than one page
// (the Cards list and the Dashboard). Lives in `_lib` — an underscore-prefixed
// folder is a Next.js "private folder", excluded from routing, so it is a safe
// home for non-route modules under src/app/. These are view concerns only; any
// money/date *math* belongs in src/lib/calculations/, not here.
//
// All colour utilities return Tailwind classes built from the design-system
// semantic tokens (see /docs/design-system.md): success/warning/danger green,
// amber, red. Centralising them here is what keeps the Cards and Dashboard
// colour coding from drifting apart.

/** Format a rupee amount with Indian digit grouping and no paise. */
export function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Ordinal suffix for a day-of-month (1st, 2nd, 3rd, 5th…). */
export function ordinal(day: number): string {
  const v = day % 100;
  if (v >= 11 && v <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/** Text colour for a utilization band (green <30, amber 30–70, red >70). */
export function utilizationColorClass(pct: number): string {
  if (pct > 70) return "text-danger";
  if (pct >= 30) return "text-warning";
  return "text-success";
}

/** Matching fill colour for a utilization track. */
export function utilizationBarClass(pct: number): string {
  if (pct > 70) return "bg-danger";
  if (pct >= 30) return "bg-warning";
  return "bg-success";
}

/** Urgency text colour for days-until-due (red ≤3, amber ≤10, default beyond). */
export function dueColorClass(days: number): string {
  if (days <= 3) return "text-danger";
  if (days <= 10) return "text-warning";
  return "text-text-primary-dark";
}

/**
 * Family-cap progress banding (green normal, amber ≥70%, red ≥90%). A separate
 * scale from utilization: the ₹8L family cap is a hard regulatory-style ceiling,
 * so the warning/danger thresholds sit higher and closer to the limit than the
 * "keep utilization low" guidance bands.
 */
export function capColorClass(pct: number): string {
  if (pct >= 90) return "text-danger";
  if (pct >= 70) return "text-warning";
  return "text-success";
}

/** Matching fill colour for the family-cap track. */
export function capBarClass(pct: number): string {
  if (pct >= 90) return "bg-danger";
  if (pct >= 70) return "bg-warning";
  return "bg-success";
}
