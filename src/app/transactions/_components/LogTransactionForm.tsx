"use client";

// Log Transaction form — the Client Component half of the Transactions page's
// form pattern (see src/app/CLAUDE.md "Forms pattern"). It owns no business
// logic: it collects input and hands it to the `createTransactionAction` Server
// Action, which validates + persists. This is a Client Component only because it
// uses React 19's `useActionState` for pending/error/success state and resets
// the form on success.
//
// Inputs are intentionally UNCONTROLLED (defaultValue, no React state per field):
// on a validation error we deliberately do NOT reset, so the browser keeps the
// user's typed values in place — only a successful submit clears the form.
//
// Design system: dark surface card with inputs on the darker background tone so
// their borders read clearly against the surface (design-system.md — inputs must
// not blend into the dark surface).

import { useActionState, useEffect, useId, useRef } from "react";
import { createTransactionAction, type TxnFormState } from "../actions";
import type { Category } from "@/lib/types/schema";

// Initial useActionState value. Defined HERE, not imported from the "use server"
// actions file: that file may only export async functions across the RSC boundary,
// so a constant exported from it arrives as a proxy (not this object) and would
// leave `state.errors` undefined on first render. (Type-only imports from a
// "use server" file are fine — they're erased at compile time.)
const INITIAL_STATE: TxnFormState = { ok: false, message: null, errors: {} };

// Minimal, non-sensitive card shape. The page must NOT pass full Card objects
// here — encrypted card numbers / contact fields never reach a Client Component
// (src/app/CLAUDE.md frontend rule 4). Only what the dropdown needs.
export type CardOption = {
  id: string;
  card_name: string;
  card_bank: string;
};

const fieldClass =
  "w-full rounded-lg border border-white/10 bg-background-dark px-3 py-2 text-sm text-text-primary-dark placeholder:text-text-secondary-dark focus:border-brand-yellow focus:outline-none focus:ring-1 focus:ring-brand-yellow";
const labelClass =
  "mb-1 block text-xs font-medium uppercase tracking-wide text-text-secondary-dark";
const errorClass = "mt-1 text-xs text-danger";

export default function LogTransactionForm({
  cards,
  categories,
  today,
}: {
  cards: CardOption[];
  categories: Category[];
  today: string; // YYYY-MM-DD, computed on the server for the date default
}) {
  const [state, formAction, pending] = useActionState(
    createTransactionAction,
    INITIAL_STATE,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const formId = useId();

  // Clear the form after a successful save so it's ready for the next entry.
  // (The list itself is refreshed server-side via revalidatePath in the action.)
  // Uncontrolled inputs reset back to their defaultValue — including date → today.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  // Null-safe even though INITIAL_STATE guarantees a defined object — defends
  // against any future path where the action returns a partial/undefined state.
  const err = state?.errors ?? {};

  return (
    <form
      ref={formRef}
      action={formAction}
      className="rounded-2xl border border-white/5 bg-surface-dark p-6 shadow-lg shadow-black/20"
      noValidate
    >
      <h2 className="text-lg font-semibold text-text-primary-dark">
        Log a transaction
      </h2>
      <p className="mt-1 text-sm text-text-secondary-dark">
        Manually record a spend. Saved as a high-confidence manual entry.
      </p>

      {/* Form-level banner: success (green) or validation summary (red). */}
      {state?.message && (
        <p
          role="status"
          className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
            state.ok
              ? "border-success/30 bg-success/10 text-success"
              : "border-danger/30 bg-danger/10 text-danger"
          }`}
        >
          {state.message}
        </p>
      )}

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Card */}
        <div>
          <label htmlFor={`${formId}-card`} className={labelClass}>
            Card
          </label>
          <select
            id={`${formId}-card`}
            name="card_id"
            defaultValue=""
            aria-invalid={err.card_id ? true : undefined}
            className={fieldClass}
          >
            <option value="" disabled>
              Select a card…
            </option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.card_name} · {c.card_bank}
              </option>
            ))}
          </select>
          {err.card_id && <p className={errorClass}>{err.card_id}</p>}
        </div>

        {/* Date */}
        <div>
          <label htmlFor={`${formId}-date`} className={labelClass}>
            Date
          </label>
          <input
            id={`${formId}-date`}
            type="date"
            name="date"
            defaultValue={today}
            aria-invalid={err.date ? true : undefined}
            className={`${fieldClass} [color-scheme:dark]`}
          />
          {err.date && <p className={errorClass}>{err.date}</p>}
        </div>

        {/* Merchant */}
        <div>
          <label htmlFor={`${formId}-merchant`} className={labelClass}>
            Merchant
          </label>
          <input
            id={`${formId}-merchant`}
            type="text"
            name="merchant"
            placeholder="e.g. Zomato"
            autoComplete="off"
            aria-invalid={err.merchant ? true : undefined}
            className={fieldClass}
          />
          {err.merchant && <p className={errorClass}>{err.merchant}</p>}
        </div>

        {/* Amount */}
        <div>
          <label htmlFor={`${formId}-amount`} className={labelClass}>
            Amount (₹)
          </label>
          <input
            id={`${formId}-amount`}
            type="number"
            name="amount"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="0"
            aria-invalid={err.amount ? true : undefined}
            className={`${fieldClass} tabular-nums`}
          />
          {err.amount && <p className={errorClass}>{err.amount}</p>}
        </div>

        {/* Category */}
        <div>
          <label htmlFor={`${formId}-category`} className={labelClass}>
            Category
          </label>
          <select
            id={`${formId}-category`}
            name="category"
            defaultValue=""
            aria-invalid={err.category ? true : undefined}
            className={fieldClass}
          >
            <option value="" disabled>
              Select a category…
            </option>
            {categories.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          {err.category && <p className={errorClass}>{err.category}</p>}
        </div>

        {/* Notes (optional) */}
        <div>
          <label htmlFor={`${formId}-notes`} className={labelClass}>
            Notes <span className="normal-case">(optional)</span>
          </label>
          <input
            id={`${formId}-notes`}
            type="text"
            name="notes"
            placeholder="Anything to remember"
            autoComplete="off"
            className={fieldClass}
          />
        </div>
      </div>

      <div className="mt-6">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand-yellow px-5 py-2.5 text-sm font-semibold text-charcoal transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving…" : "Log Transaction"}
        </button>
      </div>
    </form>
  );
}
