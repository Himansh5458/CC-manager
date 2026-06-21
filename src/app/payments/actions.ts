// Server Actions for the Payments page.
//
// Follows the app's "Forms pattern" (see src/app/CLAUDE.md), the same one the
// Transactions page established:
//   Server Component page → Client form component → Server Action (here) → data layer
//
// Payments are create-or-delete ONLY by schema design (src/lib/data/payments.ts
// has no update). So this file has two actions: a create driven by useActionState
// and a fire-once delete. Both go through the data layer (createPayment /
// deletePayment) and never touch the JSON file directly (root CLAUDE.md rule).

"use server";

import { revalidatePath } from "next/cache";
import { createPayment, deletePayment, getPayments } from "@/lib/data/payments";
import { getCards } from "@/lib/data/cards";

/**
 * Shape returned to the client form via React 19's `useActionState`. `errors` is
 * keyed by field name for inline messages; `message` is the form-level banner.
 */
// NOTE: a "use server" file may export ONLY async Server Actions — a non-function
// export (like an initial-state constant) does not survive the RSC boundary into a
// Client Component (it arrives as a server-reference proxy, not the real object),
// silently breaking `useActionState`'s initial state. The type below is fine
// (types are erased at compile time); the initial-state *value* lives in the
// client component. See src/app/CLAUDE.md "Forms pattern" GOTCHA.
export type PaymentFormState = {
  ok: boolean;
  message: string | null;
  errors: Record<string, string>;
};

/**
 * Create a payment from the Log Payment form.
 *
 * Validation is done here on the server (never trust the client): every field is
 * re-checked, and card_id is validated against the *live* active-card list rather
 * than assuming the submitted value came from our own dropdown. `source` is a free
 * text field (UPI, Bank Transfer, etc.) because payment sources vary — it's only
 * trimmed + required, not constrained to an enum.
 */
export async function createPaymentAction(
  _prevState: PaymentFormState,
  formData: FormData,
): Promise<PaymentFormState> {
  const cardId = String(formData.get("card_id") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const source = String(formData.get("source") ?? "").trim();

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

  // Amount: required, finite, strictly positive.
  const amount = Number(amountRaw);
  if (!amountRaw) {
    errors.amount = "Amount is required.";
  } else if (!Number.isFinite(amount) || amount <= 0) {
    errors.amount = "Amount must be a positive number.";
  }

  // Source: required free text (UPI, Bank Transfer, …). Not enum-constrained.
  if (!source) {
    errors.source = "Source is required.";
  }

  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      message: "Couldn't save — please fix the highlighted fields.",
      errors,
    };
  }

  await createPayment({ card_id: cardId, date, amount, source });

  // The page is `force-dynamic` (uncached), but revalidatePath is still the
  // documented Next.js 16 way to tell the router to re-fetch this route's server
  // data after a mutation, so the new row appears without a manual refresh.
  revalidatePath("/payments");

  return {
    ok: true,
    message: `Logged ${formatINRForMessage(amount)} payment.`,
    errors: {},
  };
}

/**
 * Delete a payment by id. A bare `(formData) => void` Server Action (no
 * useActionState) — the row's small client wrapper handles the confirm step
 * before this is ever invoked. The id is re-checked against the live DB so a
 * stale/duplicate submit is a harmless no-op rather than an error.
 */
export async function deletePaymentAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const exists = (await getPayments()).some((p) => p.id === id);
  if (!exists) return;

  await deletePayment(id);
  revalidatePath("/payments");
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
