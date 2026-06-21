// Payments — log a payment toward a card balance and review payment history.
//
// Server Component (async). Fetches via the data layer (getPayments / getCards)
// and renders the history table server-side; the add form is a Client Component
// (`_components/LogPaymentForm`) driven by a Server Action (`./actions`). Same
// Server-Component-page + Client-form + Server-Action split as Transactions — the
// app's Forms pattern (see src/app/CLAUDE.md).
//
// Payments are CREATE-OR-DELETE ONLY (no edit) by schema design, so each history
// row carries a delete control (`_components/DeletePaymentButton`) instead of an
// edit affordance.

import { getPayments } from "@/lib/data/payments";
import { getCards } from "@/lib/data/cards";
import { formatINR } from "@/app/_lib/format";
import LogPaymentForm, {
  type CardOption,
} from "./_components/LogPaymentForm";
import DeletePaymentButton from "./_components/DeletePaymentButton";

// Live financial data + a "today" default for the form — must render fresh, never
// a stale build-time snapshot. See src/app/CLAUDE.md frontend rule 6.
export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const [allCards, payments] = await Promise.all([getCards(), getPayments()]);

  // Look up card names by id across ALL cards — a payment may belong to a card
  // that has since been deactivated, so the history must still name it. The form
  // dropdown, by contrast, only offers active cards.
  const cardNameById = new Map(allCards.map((c) => [c.id, c.card_name]));

  // Pass only the non-sensitive fields the dropdown needs (frontend rule 4 —
  // never hand encrypted card numbers / contact details to a Client Component).
  const cardOptions: CardOption[] = allCards
    .filter((c) => c.active)
    .map((c) => ({ id: c.id, card_name: c.card_name, card_bank: c.card_bank }));

  // Newest first. Dates are ISO "YYYY-MM-DD" strings, so a lexical compare is a
  // correct chronological compare.
  const sorted = [...payments].sort((a, b) => b.date.localeCompare(a.date));

  // YYYY-MM-DD for the form's date default (computed server-side to avoid a
  // hydration mismatch with a client-side new Date()).
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="flex-1 px-6 py-8 md:px-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary-dark">
          Payments
        </h1>
        <p className="mt-1 text-sm text-text-secondary-dark">
          {payments.length} {payments.length === 1 ? "payment" : "payments"}{" "}
          logged
        </p>
      </header>

      {/* Form first so it's immediately visible without scrolling past the list. */}
      <section className="mb-10">
        <LogPaymentForm cards={cardOptions} today={today} />
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-text-primary-dark">
          History
        </h2>

        {sorted.length === 0 ? (
          <p className="text-text-secondary-dark">
            No payments yet — log your first one above.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/5 bg-surface-dark shadow-lg shadow-black/20">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-text-secondary-dark">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Card</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((payment) => (
                  <tr
                    key={payment.id}
                    className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]"
                  >
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-text-secondary-dark">
                      {payment.date}
                    </td>
                    <td className="px-4 py-3 text-text-primary-dark">
                      {cardNameById.get(payment.card_id) ?? (
                        <span className="text-text-secondary-dark">
                          Unknown card
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-text-primary-dark">
                      {formatINR(payment.amount)}
                    </td>
                    <td className="px-4 py-3 text-text-primary-dark">
                      {payment.source}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <DeletePaymentButton paymentId={payment.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
