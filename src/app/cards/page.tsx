// Cards list — identity & management view of every active card.
//
// Server Component (async, per Next.js 16 conventions): it fetches via the data
// layer (getCards) on the server and renders static markup. Each tile is a link
// through to the per-card detail/management view (/cards/[id]); the header carries
// the "+ Add Card" affordance.
//
// SCOPE: this page is deliberately limited to card IDENTITY (name, bank, network,
// masked number, credit limit, active status). All cross-card FINANCIAL SIGNALS —
// due dates, utilization, spend, insights, predictions, family cap — live solely on
// the Dashboard (/). They were previously duplicated here; that duplication was
// removed on purpose. See src/app/CLAUDE.md "Division of responsibility" before
// re-adding any computed financial figure to this page.

import Link from "next/link";
import { getCards } from "@/lib/data/cards";
import { formatINR } from "@/app/_lib/format";

// Render fresh on every request rather than prerendering at build time. The card
// list is read live from the database (a card may be added/edited/deactivated at
// any time), so a build-time snapshot would be stale. See src/app/CLAUDE.md.
export const dynamic = "force-dynamic";

export default async function CardsPage() {
  const cards = (await getCards()).filter((c) => c.active);

  return (
    <main className="flex-1 px-6 py-8 md:px-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary-dark">Cards</h1>
          <p className="mt-1 text-sm text-text-secondary-dark">
            {cards.length} active {cards.length === 1 ? "card" : "cards"} · due
            dates & utilization live on the{" "}
            <Link
              href="/"
              className="text-brand-yellow underline-offset-2 hover:underline"
            >
              Dashboard
            </Link>
          </p>
        </div>
        <Link
          href="/cards/new"
          className="shrink-0 rounded-lg bg-brand-yellow px-4 py-2 text-sm font-semibold text-charcoal transition-opacity hover:opacity-90"
        >
          + Add Card
        </Link>
      </header>

      {cards.length === 0 ? (
        <p className="text-text-secondary-dark">No active cards.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <Link
              key={card.id}
              href={`/cards/${card.id}`}
              className="block rounded-2xl border border-white/5 bg-surface-dark p-6 shadow-lg shadow-black/20 transition hover:border-brand-yellow/30 hover:shadow-black/40"
            >
              {/* Card identity */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-text-primary-dark">
                    {card.card_name}
                  </h2>
                  <p className="text-sm text-text-secondary-dark">
                    {card.card_bank} · {card.card_type}
                  </p>
                </div>
                <span className="rounded-full bg-brand-yellow/10 px-2.5 py-0.5 text-xs font-medium text-brand-yellow">
                  Active
                </span>
              </div>

              <p className="mt-3 font-mono text-sm tracking-wider text-text-secondary-dark">
                •••• {card.card_number_last4}
              </p>

              {/* Metric: credit limit (the raw sanctioned limit — NOT utilization
                  against it; utilization lives on the Dashboard). */}
              <div className="mt-6">
                <p className="text-xs uppercase tracking-wide text-text-secondary-dark">
                  Credit Limit
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary-dark">
                  {formatINR(card.credit_limit)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
