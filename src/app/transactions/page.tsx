// Transactions — log a spend and review the full transaction history.
//
// Server Component (async). Fetches via the data layer (getTransactions /
// getCards / getCategories) and renders the list server-side; the add form is a
// Client Component (`_components/LogTransactionForm`) driven by a Server Action
// (`./actions`). This Server-Component-page + Client-form + Server-Action split
// is the app's first form and the template for future ones — see src/app/CLAUDE.md.

import { getTransactions } from "@/lib/data/transactions";
import { getCards } from "@/lib/data/cards";
import { getCategories } from "@/lib/data/categories";
import { formatINR } from "@/app/_lib/format";
import LogTransactionForm, {
  type CardOption,
} from "./_components/LogTransactionForm";
import EditTransactionButton from "./_components/EditTransactionModal";
import DeleteTransactionButton from "./_components/DeleteTransactionButton";

// Live financial data + a "today" default for the form — must render fresh, never
// a stale build-time snapshot. See src/app/CLAUDE.md frontend rule 6.
export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const [allCards, transactions, categories] = await Promise.all([
    getCards(),
    getTransactions(),
    getCategories(),
  ]);

  // Look up card names by id across ALL cards — a transaction may belong to a card
  // that has since been deactivated, so the history must still name it. The form
  // dropdown, by contrast, only offers active cards.
  const cardNameById = new Map(allCards.map((c) => [c.id, c.card_name]));

  // Pass only the non-sensitive fields the dropdown needs (frontend rule 4 —
  // never hand encrypted card numbers / contact details to a Client Component).
  const cardOptions: CardOption[] = allCards
    .filter((c) => c.active)
    .map((c) => ({ id: c.id, card_name: c.card_name, card_bank: c.card_bank }));

  // Category names for the inline "Edit category" dropdown (same master list the
  // create form offers).
  const categoryNames = categories.map((c) => c.name);

  // Newest first. Dates are ISO "YYYY-MM-DD" strings, so a lexical compare is a
  // correct chronological compare.
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));

  // YYYY-MM-DD for the form's date default (computed server-side to avoid a
  // hydration mismatch with a client-side new Date()).
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="flex-1 px-6 py-8 md:px-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary-dark">
          Transactions
        </h1>
        <p className="mt-1 text-sm text-text-secondary-dark">
          {transactions.length}{" "}
          {transactions.length === 1 ? "transaction" : "transactions"} logged
        </p>
      </header>

      {/* Form first so it's immediately visible without scrolling past the list. */}
      <section className="mb-10">
        <LogTransactionForm
          cards={cardOptions}
          categories={categories}
          today={today}
        />
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-text-primary-dark">
          History
        </h2>

        {sorted.length === 0 ? (
          <p className="text-text-secondary-dark">
            No transactions yet — log your first one above.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/5 bg-surface-dark shadow-lg shadow-black/20">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-text-secondary-dark">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Card</th>
                  <th className="px-4 py-3 font-medium">Merchant</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((txn) => (
                  <tr
                    key={txn.id}
                    className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]"
                  >
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-text-secondary-dark">
                      {txn.date}
                    </td>
                    <td className="px-4 py-3 text-text-primary-dark">
                      {cardNameById.get(txn.card_id) ?? (
                        <span className="text-text-secondary-dark">
                          Unknown card
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-primary-dark">
                      {txn.merchant}
                      {txn.notes && (
                        <span className="block text-xs text-text-secondary-dark">
                          {txn.notes}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {/* Display only — editing now happens in the full-field
                          modal (Actions column). The "original → override
                          (corrected)" treatment is unchanged. */}
                      <CategoryCell
                        originalCategory={txn.category}
                        overrideCategory={txn.manual_override_category}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-text-primary-dark">
                      {formatINR(txn.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <SourceBadge source={txn.source} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <EditTransactionButton
                          transaction={{
                            id: txn.id,
                            date: txn.date,
                            merchant: txn.merchant,
                            amount: txn.amount,
                            category: txn.category,
                            manual_override_category:
                              txn.manual_override_category,
                            notes: txn.notes,
                          }}
                          categories={categoryNames}
                        />
                        <DeleteTransactionButton transactionId={txn.id} />
                      </div>
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

/**
 * Read-only category display for a history row. When an override is set it renders
 * the original struck-through → the override in brand-yellow with "(corrected)"
 * (the "Shopping → Dining (corrected)" treatment); otherwise just the category.
 * Display only — the edit affordance now lives in the full-field modal. This is a
 * Server Component (no interactivity), unchanged from the visual the old inline
 * control produced.
 */
function CategoryCell({
  originalCategory,
  overrideCategory,
}: {
  originalCategory: string;
  overrideCategory: string | null;
}) {
  if (!overrideCategory) {
    return <span className="text-text-primary-dark">{originalCategory}</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="text-text-secondary-dark line-through">
        {originalCategory}
      </span>
      <span className="text-text-secondary-dark">→</span>
      <span className="font-medium text-brand-yellow">{overrideCategory}</span>
      <span className="text-xs text-text-secondary-dark">(corrected)</span>
    </span>
  );
}

/** Small pill distinguishing how a transaction entered the system. */
function SourceBadge({ source }: { source: "manual" | "pdf" }) {
  const isManual = source === "manual";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        isManual
          ? "bg-info/10 text-info"
          : "bg-brand-yellow/10 text-brand-yellow"
      }`}
    >
      {isManual ? "Manual" : "PDF"}
    </span>
  );
}
