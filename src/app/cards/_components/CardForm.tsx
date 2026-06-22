"use client";

// CardForm — the Client Component half of BOTH the Add Card (/cards/new) and Edit
// Card (/cards/[id]/edit) screens (Forms pattern, see src/app/CLAUDE.md). One form
// serves both modes because the field set is identical; the differences are small
// and prop-driven:
//   • `mode`   — "create" vs "edit" (button label, card-number hint/requirement)
//   • `action` — the bound Server Action passed in by each page (create or update)
//   • `card`   — pre-fill values for edit (a non-sensitive subset; see CardFormValues)
//
// It owns NO business logic: it collects input and hands it to the Server Action,
// which validates + persists + redirects. Client Component only for React 19's
// `useActionState` (pending/error state).
//
// Inputs are UNCONTROLLED (defaultValue): on a validation error the form is NOT
// reset, so the browser keeps the user's typed values. There is no success-reset
// effect because BOTH actions redirect() on success — navigation replaces the form.
//
// SECURITY (frontend rule 4): the page never hands this component a full Card. For
// edit it passes only CardFormValues — `card_number_last4` (for the masked hint),
// never `card_number_encrypted`. The real number is never present client-side.

import { useActionState, useId } from "react";
import type { CardFormState, CardFormValues } from "../actions";
import type { CardNetwork } from "@/lib/types/schema";

// Initial useActionState value. Defined HERE, not imported from the "use server"
// actions file — a non-function (value) export from that file arrives as a proxy
// across the RSC boundary and would leave `state.errors` undefined on first render.
// (A type-only import of CardFormState above is fine — types are erased.)
const INITIAL_STATE: CardFormState = { ok: false, message: null, errors: {} };

// Local copy of the dropdown options (the actions file re-validates against its own
// server-side copy — a value export from a "use server" file can't be shared safely).
const NETWORKS: CardNetwork[] = ["Visa", "Mastercard", "Amex", "Rupay", "Diners"];

const fieldClass =
  "w-full rounded-lg border border-white/10 bg-background-dark px-3 py-2 text-sm text-text-primary-dark placeholder:text-text-secondary-dark focus:border-brand-yellow focus:outline-none focus:ring-1 focus:ring-brand-yellow";
const labelClass =
  "mb-1 block text-xs font-medium uppercase tracking-wide text-text-secondary-dark";
const errorClass = "mt-1 text-xs text-danger";
const hintClass = "mt-1 text-xs text-text-secondary-dark";

/** "" for a falsy/empty numeric default so the input renders blank, not "0"/"NaN". */
function numDefault(v: number | undefined): number | string {
  return v === undefined || Number.isNaN(v) ? "" : v;
}

export default function CardForm({
  mode,
  action,
  card,
  cancelHref,
}: {
  mode: "create" | "edit";
  action: (
    state: CardFormState,
    formData: FormData,
  ) => Promise<CardFormState>;
  card?: CardFormValues | null;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const formId = useId();

  // Null-safe even though INITIAL_STATE guarantees a defined object (defends any
  // future path where the action returns a partial state — Forms-pattern guidance).
  const err = state?.errors ?? {};

  const isEdit = mode === "edit";

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-white/5 bg-surface-dark p-6 shadow-lg shadow-black/20"
      noValidate
    >
      {/* Form-level banner: success (green) or validation summary (red). On success
          the action redirects, so in practice this only ever shows the red error. */}
      {state?.message && (
        <p
          role="status"
          className={`mb-5 rounded-lg border px-3 py-2 text-sm ${
            state.ok
              ? "border-success/30 bg-success/10 text-success"
              : "border-danger/30 bg-danger/10 text-danger"
          }`}
        >
          {state.message}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Card holder */}
        <div>
          <label htmlFor={`${formId}-holder`} className={labelClass}>
            Card Holder
          </label>
          <input
            id={`${formId}-holder`}
            type="text"
            name="card_holder"
            defaultValue={card?.card_holder ?? ""}
            placeholder="e.g. Rohit Singh"
            autoComplete="off"
            aria-invalid={err.card_holder ? true : undefined}
            className={fieldClass}
          />
          {err.card_holder && <p className={errorClass}>{err.card_holder}</p>}
        </div>

        {/* Card name */}
        <div>
          <label htmlFor={`${formId}-name`} className={labelClass}>
            Card Name
          </label>
          <input
            id={`${formId}-name`}
            type="text"
            name="card_name"
            defaultValue={card?.card_name ?? ""}
            placeholder="e.g. HDFC Millennia"
            autoComplete="off"
            aria-invalid={err.card_name ? true : undefined}
            className={fieldClass}
          />
          {err.card_name && <p className={errorClass}>{err.card_name}</p>}
        </div>

        {/* Bank */}
        <div>
          <label htmlFor={`${formId}-bank`} className={labelClass}>
            Bank
          </label>
          <input
            id={`${formId}-bank`}
            type="text"
            name="card_bank"
            defaultValue={card?.card_bank ?? ""}
            placeholder="e.g. HDFC"
            autoComplete="off"
            aria-invalid={err.card_bank ? true : undefined}
            className={fieldClass}
          />
          {err.card_bank && <p className={errorClass}>{err.card_bank}</p>}
        </div>

        {/* Network */}
        <div>
          <label htmlFor={`${formId}-type`} className={labelClass}>
            Network
          </label>
          <select
            id={`${formId}-type`}
            name="card_type"
            defaultValue={card?.card_type ?? ""}
            aria-invalid={err.card_type ? true : undefined}
            className={fieldClass}
          >
            <option value="" disabled>
              Select a network…
            </option>
            {NETWORKS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {err.card_type && <p className={errorClass}>{err.card_type}</p>}
        </div>

        {/* Card number — full width */}
        <div className="sm:col-span-2">
          <label htmlFor={`${formId}-number`} className={labelClass}>
            Card Number
          </label>
          <input
            id={`${formId}-number`}
            type="text"
            name="card_number"
            inputMode="numeric"
            autoComplete="off"
            // Edit: empty field, masked existing number ONLY as a placeholder hint —
            // the real number is never sent to the client. Create: a format example.
            placeholder={
              isEdit
                ? `•••• •••• •••• ${card?.card_number_last4 ?? "••••"}`
                : "1234 5678 9012 3456"
            }
            aria-invalid={err.card_number ? true : undefined}
            className={`${fieldClass} font-mono tracking-wider`}
          />
          {err.card_number ? (
            <p className={errorClass}>{err.card_number}</p>
          ) : (
            <p className={hintClass}>
              {isEdit
                ? "Leave blank to keep the current number. Enter a new number only to replace it."
                : "Full card number. Only the last 4 digits are shown elsewhere."}
            </p>
          )}
        </div>

        {/* Expiry month */}
        <div>
          <label htmlFor={`${formId}-exp-month`} className={labelClass}>
            Expiry Month
          </label>
          <input
            id={`${formId}-exp-month`}
            type="number"
            name="expiry_month"
            min="1"
            max="12"
            step="1"
            inputMode="numeric"
            placeholder="MM (1–12)"
            defaultValue={numDefault(card?.expiry_month)}
            aria-invalid={err.expiry_month ? true : undefined}
            className={`${fieldClass} tabular-nums`}
          />
          {err.expiry_month && <p className={errorClass}>{err.expiry_month}</p>}
        </div>

        {/* Expiry year */}
        <div>
          <label htmlFor={`${formId}-exp-year`} className={labelClass}>
            Expiry Year
          </label>
          <input
            id={`${formId}-exp-year`}
            type="number"
            name="expiry_year"
            min="2000"
            step="1"
            inputMode="numeric"
            placeholder="YYYY"
            defaultValue={numDefault(card?.expiry_year)}
            aria-invalid={err.expiry_year ? true : undefined}
            className={`${fieldClass} tabular-nums`}
          />
          {err.expiry_year && <p className={errorClass}>{err.expiry_year}</p>}
        </div>

        {/* Credit limit */}
        <div>
          <label htmlFor={`${formId}-limit`} className={labelClass}>
            Credit Limit (₹)
          </label>
          <input
            id={`${formId}-limit`}
            type="number"
            name="credit_limit"
            min="0"
            step="1"
            inputMode="numeric"
            placeholder="0"
            defaultValue={numDefault(card?.credit_limit)}
            aria-invalid={err.credit_limit ? true : undefined}
            className={`${fieldClass} tabular-nums`}
          />
          {err.credit_limit && <p className={errorClass}>{err.credit_limit}</p>}
        </div>

        {/* Annual fee */}
        <div>
          <label htmlFor={`${formId}-fee`} className={labelClass}>
            Annual Fee (₹)
          </label>
          <input
            id={`${formId}-fee`}
            type="number"
            name="annual_fee"
            min="0"
            step="1"
            inputMode="numeric"
            placeholder="0"
            defaultValue={numDefault(card?.annual_fee)}
            aria-invalid={err.annual_fee ? true : undefined}
            className={`${fieldClass} tabular-nums`}
          />
          {err.annual_fee && <p className={errorClass}>{err.annual_fee}</p>}
        </div>

        {/* Statement date */}
        <div>
          <label htmlFor={`${formId}-stmt`} className={labelClass}>
            Statement Date (day of month)
          </label>
          <input
            id={`${formId}-stmt`}
            type="number"
            name="statement_date"
            min="1"
            max="31"
            step="1"
            inputMode="numeric"
            placeholder="1–31"
            defaultValue={numDefault(card?.statement_date)}
            aria-invalid={err.statement_date ? true : undefined}
            className={`${fieldClass} tabular-nums`}
          />
          {err.statement_date && (
            <p className={errorClass}>{err.statement_date}</p>
          )}
        </div>

        {/* Payment deadline days */}
        <div>
          <label htmlFor={`${formId}-deadline`} className={labelClass}>
            Payment Deadline (days after statement)
          </label>
          <input
            id={`${formId}-deadline`}
            type="number"
            name="payment_deadline_days"
            min="0"
            step="1"
            inputMode="numeric"
            placeholder="e.g. 20"
            defaultValue={numDefault(card?.payment_deadline_days)}
            aria-invalid={err.payment_deadline_days ? true : undefined}
            className={`${fieldClass} tabular-nums`}
          />
          {err.payment_deadline_days && (
            <p className={errorClass}>{err.payment_deadline_days}</p>
          )}
        </div>

        {/* Registered phone */}
        <div>
          <label htmlFor={`${formId}-phone`} className={labelClass}>
            Registered Phone
          </label>
          <input
            id={`${formId}-phone`}
            type="text"
            name="registered_phone"
            inputMode="tel"
            autoComplete="off"
            placeholder="e.g. +91-9876500001"
            defaultValue={card?.registered_phone ?? ""}
            className={fieldClass}
          />
        </div>

        {/* Registered email */}
        <div>
          <label htmlFor={`${formId}-email`} className={labelClass}>
            Registered Email
          </label>
          <input
            id={`${formId}-email`}
            type="email"
            name="registered_email"
            autoComplete="off"
            placeholder="e.g. you@example.com"
            defaultValue={card?.registered_email ?? ""}
            aria-invalid={err.registered_email ? true : undefined}
            className={fieldClass}
          />
          {err.registered_email && (
            <p className={errorClass}>{err.registered_email}</p>
          )}
        </div>

        {/* Customer care */}
        <div>
          <label htmlFor={`${formId}-care`} className={labelClass}>
            Customer Care Number
          </label>
          <input
            id={`${formId}-care`}
            type="text"
            name="customer_care_number"
            inputMode="tel"
            autoComplete="off"
            placeholder="e.g. 1800-202-6161"
            defaultValue={card?.customer_care_number ?? ""}
            className={fieldClass}
          />
        </div>

        {/* Renewal date */}
        <div>
          <label htmlFor={`${formId}-renewal`} className={labelClass}>
            Renewal Date
          </label>
          <input
            id={`${formId}-renewal`}
            type="date"
            name="renewal_date"
            defaultValue={card?.renewal_date ?? ""}
            className={`${fieldClass} [color-scheme:dark]`}
          />
        </div>

        {/* Issuance date */}
        <div>
          <label htmlFor={`${formId}-issuance`} className={labelClass}>
            Issuance Date
          </label>
          <input
            id={`${formId}-issuance`}
            type="date"
            name="issuance_date"
            defaultValue={card?.issuance_date ?? ""}
            className={`${fieldClass} [color-scheme:dark]`}
          />
        </div>

        {/* Benefits summary — full width */}
        <div className="sm:col-span-2">
          <label htmlFor={`${formId}-benefits`} className={labelClass}>
            Benefits Summary <span className="normal-case">(optional)</span>
          </label>
          <textarea
            id={`${formId}-benefits`}
            name="benefits_summary"
            rows={3}
            placeholder="Free-text summary of rewards, caps, perks…"
            defaultValue={card?.benefits_summary ?? ""}
            className={`${fieldClass} resize-y`}
          />
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand-yellow px-5 py-2.5 text-sm font-semibold text-charcoal transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending
            ? "Saving…"
            : isEdit
              ? "Save Changes"
              : "Add Card"}
        </button>
        <a
          href={cancelHref}
          className="rounded-lg border border-white/10 px-5 py-2.5 text-sm font-medium text-text-secondary-dark hover:border-white/20 hover:text-text-primary-dark"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
