"use client";

// Log Payment form — the Client Component half of the Payments page's form
// pattern (see src/app/CLAUDE.md "Forms pattern"). It owns no business logic: it
// collects input and hands it to the `createPaymentAction` Server Action, which
// validates + persists. Client Component only because it uses React 19's
// `useActionState` for pending/error/success state and resets on success.
//
// Inputs are intentionally UNCONTROLLED (defaultValue, no per-field React state):
// on a validation error we deliberately do NOT reset, so the browser keeps the
// user's typed values — only a successful submit clears the form.
//
// Styling mirrors LogTransactionForm exactly (shared fieldClass/labelClass/
// errorClass below) so the two forms stay visually identical on the dark theme.

import { useActionState, useEffect, useId, useRef } from "react";
import { createPaymentAction, type PaymentFormState } from "../actions";

// Initial useActionState value. Defined HERE, not imported from the "use server"
// actions file: that file may only export async functions across the RSC
// boundary, so a constant exported from it would arrive as a proxy (not this
// object), leaving `state.errors` undefined on first render. (Type-only imports
// from a "use server" file are fine — erased at compile time.) See the GOTCHA in
// src/app/CLAUDE.md.
const INITIAL_STATE: PaymentFormState = {
  ok: false,
  message: null,
  errors: {},
};

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

export default function LogPaymentForm({
  cards,
  today,
}: {
  cards: CardOption[];
  today: string; // YYYY-MM-DD, computed on the server for the date default
}) {
  const [state, formAction, pending] = useActionState(
    createPaymentAction,
    INITIAL_STATE,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const formId = useId();

  // Clear the form after a successful save so it's ready for the next entry.
  // (The list itself is refreshed server-side via revalidatePath in the action.)
  // Uncontrolled inputs reset back to defaultValue — including date → today.
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
        Log a payment
      </h2>
      <p className="mt-1 text-sm text-text-secondary-dark">
        Record a payment made toward a card balance.
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

        {/* Source — free text, not a constrained dropdown (sources vary). */}
        <div>
          <label htmlFor={`${formId}-source`} className={labelClass}>
            Source
          </label>
          <input
            id={`${formId}-source`}
            type="text"
            name="source"
            placeholder="e.g. UPI, Bank Transfer"
            autoComplete="off"
            aria-invalid={err.source ? true : undefined}
            className={fieldClass}
          />
          {err.source && <p className={errorClass}>{err.source}</p>}
        </div>
      </div>

      <div className="mt-6">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand-yellow px-5 py-2.5 text-sm font-semibold text-charcoal transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving…" : "Log Payment"}
        </button>
      </div>
    </form>
  );
}
