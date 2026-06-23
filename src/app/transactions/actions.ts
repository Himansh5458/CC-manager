// Server Actions for the Transactions page.
//
// This is the first form in the app, so the pattern established here is the one
// future data-entry pages (Payments, Milestone edits) should follow — see
// src/app/CLAUDE.md ("Forms pattern"):
//   Server Component page  →  Client form component  →  Server Action (here)  →  data layer
//
// "use server" marks every export as a Server Action — code that only ever runs
// on the server even though the client form invokes it. The action goes through
// the data layer (createTransaction); it never touches the JSON file directly
// (root CLAUDE.md data-access rule).

"use server";

import { revalidatePath } from "next/cache";
import {
  createTransaction,
  deleteTransaction,
  getTransactions,
  updateTransaction,
} from "@/lib/data/transactions";
import { getCards } from "@/lib/data/cards";
import { getCategories } from "@/lib/data/categories";

/**
 * Shape returned to the client form via React 19's `useActionState`. `errors` is
 * keyed by field name so the form can render each message inline; `message` is a
 * form-level banner (success text or a "fix the fields" summary).
 */
// NOTE: a "use server" file may export ONLY async Server Actions — a non-function
// export (like an initial-state constant) does not survive the RSC boundary when
// imported into a Client Component (it arrives as a server-reference proxy, not the
// real object), which silently breaks `useActionState`'s initial state. The type
// below is fine (types are erased at compile time); the initial-state *value* lives
// in the client component instead. See src/app/CLAUDE.md "Forms pattern".
export type TxnFormState = {
  ok: boolean;
  message: string | null;
  errors: Record<string, string>;
};

/**
 * Create a manually-entered transaction from the Log Transaction form.
 *
 * Validation is done here on the server (never trust the client): every field is
 * re-checked, and card_id / category are validated against the *live* database
 * lists rather than assuming the submitted value came from our own dropdown.
 * `source` is forced to "manual" and `confidence_flag` to "high" because this is
 * direct human entry, not statement extraction.
 */
export async function createTransactionAction(
  _prevState: TxnFormState,
  formData: FormData,
): Promise<TxnFormState> {
  const cardId = String(formData.get("card_id") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  const merchant = String(formData.get("merchant") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  const errors: Record<string, string> = {};

  // Card: required, and must be a real active card.
  const activeCards = (await getCards()).filter((c) => c.active);
  if (!cardId) {
    errors.card_id = "Select a card.";
  } else if (!activeCards.some((c) => c.id === cardId)) {
    errors.card_id = "Unknown or inactive card.";
  }

  // Date: required and parseable.
  if (!date) {
    errors.date = "Date is required.";
  } else if (Number.isNaN(Date.parse(date))) {
    errors.date = "Enter a valid date.";
  }

  // Merchant: required.
  if (!merchant) {
    errors.merchant = "Merchant is required.";
  }

  // Amount: required, finite, strictly positive.
  const amount = Number(amountRaw);
  if (!amountRaw) {
    errors.amount = "Amount is required.";
  } else if (!Number.isFinite(amount) || amount <= 0) {
    errors.amount = "Amount must be a positive number.";
  }

  // Category: required, and must be a known category.
  const categories = await getCategories();
  if (!category) {
    errors.category = "Category is required.";
  } else if (!categories.some((c) => c.name === category)) {
    errors.category = "Unknown category.";
  }

  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      message: "Couldn't save — please fix the highlighted fields.",
      errors,
    };
  }

  await createTransaction({
    card_id: cardId,
    date,
    merchant,
    amount,
    category,
    notes,
    source: "manual", // direct human entry, not a parsed statement
    statement_file_id: null,
    confidence_flag: "high", // human-entered, so no extraction uncertainty
    manual_override_category: null,
  });

  // The page is `force-dynamic` (uncached), but revalidatePath is still the
  // documented Next.js 16 way to tell the router to re-fetch this route's server
  // data after a mutation, so the new row appears without a manual browser
  // refresh. See node_modules/next/dist/docs/.../09-revalidating.md.
  revalidatePath("/transactions");

  return {
    ok: true,
    message: `Logged ${formatINRForMessage(amount)} at ${merchant}.`,
    errors: {},
  };
}

/**
 * Edit an existing transaction (full form: date / merchant / amount / category /
 * notes) from the per-row Edit modal.
 *
 * The `id` is BOUND server-side (`updateTransactionAction.bind(null, txn.id)` in
 * the modal) so it never round-trips as a client form field — the same pattern as
 * `updateCardAction`. After binding, the signature matches the
 * `(prevState, formData) => Promise<state>` shape `useActionState` expects. The
 * full multi-field `TxnFormState` is reused (not the old single-error shape) so
 * each field can show an inline error, exactly like the create form.
 *
 * Validation mirrors the create form (server-side, never trust the client):
 * date required + parseable, merchant required, amount finite & strictly
 * positive, category required & a known category in the *live* DB. The card is
 * NOT editable here, so it is neither collected nor revalidated.
 *
 * OVERRIDE SET/CLEAR LOGIC (the correctness-critical bit, unchanged from the old
 * category-only control): the modal's category select starts at the current
 * *effective* category (`manual_override_category ?? category`). On save we
 * compare the submitted selection against the transaction's ORIGINAL `category`
 * field (the extraction's guess, which we PRESERVE — never overwrite):
 *   - selection === original  → `manual_override_category = null` (an "override"
 *     equal to the original isn't an override; this is also the path that CLEARS
 *     a previously-set override when the user reverts to the original value).
 *   - selection !== original  → `manual_override_category = selection`.
 * The original `category` column is left untouched on every save.
 */
export async function updateTransactionAction(
  id: string,
  _prevState: TxnFormState,
  formData: FormData,
): Promise<TxnFormState> {
  const date = String(formData.get("date") ?? "").trim();
  const merchant = String(formData.get("merchant") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const selectedCategory = String(formData.get("category") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  const errors: Record<string, string> = {};

  // Date: required and parseable.
  if (!date) {
    errors.date = "Date is required.";
  } else if (Number.isNaN(Date.parse(date))) {
    errors.date = "Enter a valid date.";
  }

  // Merchant: required.
  if (!merchant) {
    errors.merchant = "Merchant is required.";
  }

  // Amount: required, finite, strictly positive.
  const amount = Number(amountRaw);
  if (!amountRaw) {
    errors.amount = "Amount is required.";
  } else if (!Number.isFinite(amount) || amount <= 0) {
    errors.amount = "Amount must be a positive number.";
  }

  // Category: required, and must be a known category (validated against the live
  // DB list, not trusted from the submitted dropdown).
  const categories = await getCategories();
  if (!selectedCategory) {
    errors.category = "Category is required.";
  } else if (!categories.some((c) => c.name === selectedCategory)) {
    errors.category = "Unknown category.";
  }

  // Transaction must still exist.
  const txn = (await getTransactions()).find((t) => t.id === id);
  if (!txn) {
    errors.merchant = errors.merchant ?? "Transaction not found.";
  }

  if (!txn || Object.keys(errors).length > 0) {
    return {
      ok: false,
      message: "Couldn't save — please fix the highlighted fields.",
      errors,
    };
  }

  // OVERRIDE SET/CLEAR: compare the selection to the ORIGINAL category. Equal →
  // clear the override (null); different → store it as the override. The original
  // `category` extraction is preserved (never written here).
  const override =
    selectedCategory === txn.category ? null : selectedCategory;

  await updateTransaction(id, {
    date,
    merchant,
    amount,
    notes,
    manual_override_category: override,
  });
  revalidatePath("/transactions");

  return {
    ok: true,
    message: `Updated ${merchant}.`,
    errors: {},
  };
}

/**
 * Delete a transaction by id. A bare `(formData) => void` Server Action (no
 * useActionState), matching the Payments delete: the row's client wrapper handles
 * the two-click confirm before this runs. The id is re-checked against the live
 * DB so a stale/duplicate submit is a harmless no-op rather than an error.
 */
export async function deleteTransactionAction(
  formData: FormData,
): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const exists = (await getTransactions()).some((t) => t.id === id);
  if (!exists) return;

  await deleteTransaction(id);
  revalidatePath("/transactions");
}

/** Tiny rupee formatter for the success banner (the view layer's formatINR is a
 *  client/_lib helper; the action only needs a plain string here). */
function formatINRForMessage(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}
