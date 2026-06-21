// MilestoneProgressBar — the "XP bar with checkpoints" visual for one milestone
// track (see src/app/CLAUDE.md, "Multi-marker progress bar pattern").
//
// Renders ONE horizontal track whose fill represents current_progress_amount
// against the HIGHEST tier's threshold, with every tier drawn as a checkpoint
// marker positioned along that same bar (threshold ÷ highest threshold). This is
// the first genuinely custom visual in the app — nothing else needed multiple
// thresholds on a single axis — so it lives in the page's own _components/ folder
// rather than the shared one.
//
// Not a Client Component: it has no interactivity, only static positioned markup,
// so it stays a Server Component like the page that renders it.

import { formatINR } from "@/app/_lib/format";

/** One checkpoint on the bar. `achieved` is already override-resolved by the
 *  caller (recomputeMilestoneProgress applies "manual override wins"); we keep
 *  `isManualOverride` only to flag visually that the status was SET, not computed,
 *  so a hand-set tier is never mistaken for a real achievement. */
export interface ProgressTierMarker {
  id: string;
  threshold: number;
  rewardValue: number;
  rewardUnit: string;
  achieved: boolean;
  isManualOverride: boolean;
}

/** Small check glyph drawn inside an achieved marker. Inline SVG per the
 *  design-system "icons are inline SVG, not a library" convention. */
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/**
 * Horizontal multi-marker progress bar for a milestone track.
 *
 * The bar's 0%→100% axis maps to ₹0 → the highest tier threshold, so every
 * lower tier lands at a proportional position and the highest tier sits exactly
 * at the right edge. Labels below each marker are edge-aware (the leftmost
 * anchors left, the rightmost anchors right) so they never overflow the track.
 */
export default function MilestoneProgressBar({
  currentProgress,
  tiers,
}: {
  currentProgress: number;
  tiers: ProgressTierMarker[];
}) {
  // Sort ascending so the highest threshold is the axis maximum / right edge.
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  const highest = sorted.length > 0 ? sorted[sorted.length - 1].threshold : 0;

  // Guard a zero/negative max (no tiers, or a malformed threshold) so we never
  // divide by zero — render a flat empty track instead.
  const pos = (amount: number) =>
    highest > 0 ? Math.min((amount / highest) * 100, 100) : 0;
  const fillPct = pos(currentProgress);

  return (
    <div>
      {/* Numeric progress readout above the bar. */}
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-text-secondary-dark">
          Progress
        </span>
        <span className="text-sm font-semibold tabular-nums text-text-primary-dark">
          {formatINR(currentProgress)}{" "}
          <span className="font-normal text-text-secondary-dark">
            / {formatINR(highest)}
          </span>
        </span>
      </div>

      {/* The bar itself, with generous bottom padding to hold the marker labels. */}
      <div className="relative pb-20 pt-2">
        {/* Track + fill. */}
        <div className="relative h-3 rounded-full bg-white/10">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-brand-yellow"
            style={{ width: `${fillPct}%` }}
          />

          {/* Checkpoint markers sitting on the track. */}
          {sorted.map((t) => {
            const left = pos(t.threshold);
            const dotColor = t.achieved
              ? "bg-success text-charcoal"
              : "bg-surface-dark text-transparent";
            // Manual override gets a blue ring so a hand-set status is visually
            // distinct from a computed one at the marker itself; computed states
            // use green (achieved) / muted (not) borders.
            const ringColor = t.isManualOverride
              ? "border-info"
              : t.achieved
                ? "border-success"
                : "border-white/30";
            return (
              <div
                key={t.id}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${left}%` }}
              >
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${dotColor} ${ringColor} shadow shadow-black/30`}
                >
                  <CheckIcon />
                </div>
              </div>
            );
          })}
        </div>

        {/* Marker labels, edge-aware so the first/last don't clip the track. */}
        {sorted.map((t, i) => {
          const left = pos(t.threshold);
          const isFirst = i === 0;
          const isLast = i === sorted.length - 1;
          // Anchor the end labels inward; center the rest over their marker.
          const transform = isFirst
            ? "translateX(0)"
            : isLast
              ? "translateX(-100%)"
              : "translateX(-50%)";
          const align = isFirst
            ? "text-left"
            : isLast
              ? "text-right"
              : "text-center";
          return (
            <div
              key={t.id}
              className={`absolute top-9 w-28 ${align}`}
              style={{ left: `${left}%`, transform }}
            >
              <p
                className={`text-xs font-semibold tabular-nums ${t.achieved ? "text-success" : "text-text-primary-dark"}`}
              >
                {formatINR(t.threshold)}
              </p>
              <p className="text-[11px] leading-tight text-text-secondary-dark">
                {t.rewardValue.toLocaleString("en-IN")} {t.rewardUnit}
              </p>
              {t.achieved && (
                <p className="text-[10px] font-medium text-success">Achieved</p>
              )}
              {t.isManualOverride && (
                <p className="text-[10px] font-medium text-info">
                  Set manually
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
