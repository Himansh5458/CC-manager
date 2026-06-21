// Milestones — read-only progress view of every active milestone track.
//
// Server Component (async, per Next.js 16 conventions): it fetches via the data
// layer on the server and renders static dark-dashboard markup.
//
// DATA SOURCE: this page reads the STORED computed fields straight off each
// record — the tier's current_progress_amount / achieved / manual_override_achieved
// and the milestone's cycle_start_date / cycle_end_date — and does NOT recompute
// anything on read. The database is treated as the readable ledger of computed
// truth; recompute happens only on write (a recompute-on-write trigger is deferred
// future work — see /KNOWN_LIMITATIONS.md and src/lib/CLAUDE.md "Deferred work").
// This is a deliberate reversal of the earlier live-recompute-on-read approach.
// Consequently the numbers shown are only as fresh as the last saved recompute.
//
// This is a DISPLAY page only — no create/edit of milestones or tiers here (that
// is a separate future page). The one custom visual, the multi-marker progress
// bar, lives in ./_components/MilestoneProgressBar.tsx (see src/app/CLAUDE.md).

import { getActiveMilestones } from "@/lib/data/milestones";
import { getMilestoneTiers } from "@/lib/data/milestoneTiers";
import { getCards } from "@/lib/data/cards";
import MilestoneProgressBar, {
  type ProgressTierMarker,
} from "./_components/MilestoneProgressBar";

// Render fresh on every request: the page reads live database rows (the stored
// computed fields), so a build-time snapshot would be stale. See src/app/CLAUDE.md
// frontend rule 6.
export const dynamic = "force-dynamic";

const CARD_CLASS =
  "rounded-2xl border border-white/5 bg-surface-dark p-6 shadow-lg shadow-black/20";

/** Capitalise the first letter (for the cycle_frequency / cycle_anchor labels). */
function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Human-readable date for a UTC ISO (YYYY-MM-DD) cycle boundary, e.g. "1 Apr 2026". */
function formatCycleDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export default async function MilestonesPage() {
  const [milestones, tiers, cards] = await Promise.all([
    getActiveMilestones(),
    getMilestoneTiers(),
    getCards(),
  ]);

  const activeCards = cards.filter((c) => c.active);

  // One section per active card that actually has ≥1 active milestone. Cards with
  // none are dropped entirely (no empty "no milestones" noise — task requirement).
  const sections = activeCards
    .map((card) => {
      const cardMilestones = milestones.filter((m) => m.card_id === card.id);
      const tracks = cardMilestones.map((milestone) => {
        // Read STORED tier values as-is — no live recompute. Sort ascending so the
        // highest threshold is the bar's right-edge maximum.
        const ownTiers = tiers
          .filter((t) => t.milestone_id === milestone.id)
          .sort((a, b) => a.tier_threshold_amount - b.tier_threshold_amount);

        // current_progress_amount is the same shared pool on every tier; read one.
        const progress = ownTiers[0]?.current_progress_amount ?? 0;

        const markers: ProgressTierMarker[] = ownTiers.map((t) => ({
          id: t.id,
          threshold: t.tier_threshold_amount,
          rewardValue: t.reward_value,
          rewardUnit: t.reward_unit,
          // Manual override still wins over the stored computed `achieved` (the
          // established override-wins principle — the component styles a manual
          // status distinctly via isManualOverride).
          achieved:
            t.manual_override_achieved !== null
              ? t.manual_override_achieved
              : t.achieved,
          isManualOverride: t.manual_override_achieved !== null,
        }));

        return { milestone, markers, progress };
      });
      return { card, tracks };
    })
    .filter((s) => s.tracks.length > 0);

  return (
    <main className="flex-1 space-y-10 px-6 py-8 md:px-10">
      <header>
        <h1 className="text-2xl font-semibold text-text-primary-dark">
          Milestones
        </h1>
        <p className="mt-1 text-sm text-text-secondary-dark">
          Stored progress toward each card&apos;s milestone tiers for the current
          cycle.
        </p>
      </header>

      {sections.length === 0 ? (
        <p className="text-text-secondary-dark">
          No active milestones on any active card.
        </p>
      ) : (
        <div className="space-y-12">
          {sections.map(({ card, tracks }) => (
            <section key={card.id}>
              {/* Card section header */}
              <div className="mb-5 flex items-baseline justify-between gap-3 border-b border-white/5 pb-3">
                <h2 className="text-lg font-semibold text-text-primary-dark">
                  {card.card_name}
                </h2>
                <span className="font-mono text-xs tracking-wider text-text-secondary-dark">
                  {card.card_bank} · •••• {card.card_number_last4}
                </span>
              </div>

              {/* One block per milestone track on this card */}
              <div className="space-y-6">
                {tracks.map(({ milestone, markers, progress }) => (
                  <article key={milestone.id} className={CARD_CLASS}>
                    <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <h3 className="text-base font-semibold text-text-primary-dark">
                        {milestone.track_name}
                      </h3>
                      <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-xs font-medium text-text-secondary-dark">
                        {titleCase(milestone.cycle_frequency)} ·{" "}
                        {titleCase(milestone.cycle_anchor)}
                      </span>
                    </div>

                    <p className="-mt-4 mb-6 text-xs text-text-secondary-dark">
                      Cycle: {formatCycleDate(milestone.cycle_start_date)} —{" "}
                      {formatCycleDate(milestone.cycle_end_date)}
                    </p>

                    <MilestoneProgressBar
                      currentProgress={progress}
                      tiers={markers}
                    />
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
