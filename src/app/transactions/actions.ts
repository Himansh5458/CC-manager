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
import { createTransaction } from "@/lib/data/transactions";
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

/** Tiny rupee formatter for the success banner (the view layer's formatINR is a
 *  client/_lib helper; the action only needs a plain string here). */
function formatINRForMessage(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}
