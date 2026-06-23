"use client";

// Per-row "Edit transaction" control: a button that opens a full-field edit
// MODAL DIALOG (overlay on top of the page — not a navigation, not an inline row
// expansion). Replaces the old narrow category-only inline control: the modal now
// edits date / merchant / amount / category / notes in one form.
//
// Two pieces:
//   • EditTransactionButton — the per-row "Edit" button, owns only open/closed
//     state. It renders <EditTransactionDialog> ONLY while open, with a `key` tied
//     to the open count, so every open remounts the dialog: fresh `useActionState`
//     (no stale errors from a prior cancelled attempt) and fresh uncontrolled
//     defaultValues pre-filled from the row.
//   • EditTransactionDialog — the actual modal. Client Component for React 19's
//     `useActionState` (pending/error/success) + the overlay UI state; all
//     validation and the override set/clear logic live server-side in
//     `updateTransactionAction`.
//
// Accessible, no library: a fixed full-screen backdrop + centered panel,
// role="dialog" aria-modal, labelled by its heading. Closeable THREE ways — the
// Cancel button, the ✕ button, and a backdrop click (clicks inside the panel are
// not propagated). Escape also closes; background scroll is locked while open.

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { updateTransactionAction, type TxnFormState } from "../actions";

// Initial useActionState value — defined HERE, not imported from the "use server"
// actions file (a non-function export doesn't survive the RSC boundary; a
// type-only import is fine). See src/app/CLAUDE.md "Forms pattern" GOTCHA.
const INITIAL_STATE: TxnFormState = { ok: false, message: null, errors: {} };

// Minimal, non-sensitive shape the modal needs to pre-fill. (Transactions carry
// no encrypted/sensitive fields, but we still pass only what the form edits.)
export type EditableTransaction = {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  category: string; // the ORIGINAL extracted category (override-comparison anchor)
  manual_override_category: string | null;
  notes: string;
};

const fieldClass =
  "w-full rounded-lg border border-white/10 bg-background-dark px-3 py-2 text-sm text-text-primary-dark placeholder:text-text-secondary-dark focus:border-brand-yellow focus:outline-none focus:ring-1 focus:ring-brand-yellow";
const labelClass =
  "mb-1 block text-xs font-medium uppercase tracking-wide text-text-secondary-dark";
const errorClass = "mt-1 text-xs text-danger";

export default function EditTransactionButton({
  transaction,
  categories,
}: {
  transaction: EditableTransaction;
  categories: string[];
}) {
  const [open, setOpen] = useState(false);
  // Bumped on every open so the dialog remounts fresh (see file header).
  const [openCount, setOpenCount] = useState(0);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpenCount((n) => n + 1);
          setOpen(true);
        }}
        className="rounded-md px-2.5 py-1 text-xs font-medium text-text-secondary-dark transition-colors hover:bg-white/5 hover:text-brand-yellow"
      >
        Edit
      </button>
      {open && (
        <EditTransactionDialog
          key={openCount}
          transaction={transaction}
          categories={categories}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function EditTransactionDialog({
  transaction,
  categories,
  onClose,
}: {
  transaction: EditableTransaction;
  categories: string[];
  onClose: () => void;
}) {
  // Bind the id server-side so it never round-trips as a client form field — same
  // pattern as updateCardAction. After binding, the shape matches what
  // useActionState expects: (prevState, formData) => Promise<state>.
  const boundAction = updateTransactionAction.bind(null, transaction.id);
  const [state, formAction, pending] = useActionState(
    boundAction,
    INITIAL_STATE,
  );
  const formId = useId();
  const headingId = `${formId}-heading`;

  // Pre-fill the category select with the current EFFECTIVE category (override if
  // set, else the original) — same starting selection as the old control.
  const effectiveCategory =
    transaction.manual_override_category ?? transaction.category;

  // Close on a successful save. The row is refreshed server-side (revalidatePath
  // in the action), so the table already reflects the change when we close.
  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  // Escape closes; lock background scroll while the modal is mounted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const err = state?.errors ?? {};
  const dialogRef = useRef<HTMLDivElement>(null);

  return (
    <div
      // Backdrop: a click here closes; a click that originated inside the panel is
      // stopped at the panel (stopPropagation), so only true backdrop clicks fire.
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:items-center"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-lg rounded-2xl border border-white/10 bg-surface-dark p-6 shadow-2xl shadow-black/40"
      >
        <div className="flex items-start justify-between">
          <h2
            id={headingId}
            className="text-lg font-semibold text-text-primary-dark"
          >
            Edit transaction
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-md p-1 text-text-secondary-dark transition-colors hover:bg-white/5 hover:text-text-primary-dark"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        {/* Form-level banner: only the validation summary is shown (a success
            closes the modal before this would render). */}
        {state?.message && !state.ok && (
          <p
            role="status"
            className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {state.message}
          </p>
        )}

        <form action={formAction} className="mt-5" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Date */}
            <div>
              <label htmlFor={`${formId}-date`} className={labelClass}>
                Date
              </label>
              <input
                id={`${formId}-date`}
                type="date"
                name="date"
                defaultValue={transaction.date}
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
                defaultValue={transaction.amount}
                aria-invalid={err.amount ? true : undefined}
                className={`${fieldClass} tabular-nums`}
              />
              {err.amount && <p className={errorClass}>{err.amount}</p>}
            </div>

            {/* Merchant */}
            <div className="sm:col-span-2">
              <label htmlFor={`${formId}-merchant`} className={labelClass}>
                Merchant
              </label>
              <input
                id={`${formId}-merchant`}
                type="text"
                name="merchant"
                autoComplete="off"
                defaultValue={transaction.merchant}
                aria-invalid={err.merchant ? true : undefined}
                className={fieldClass}
              />
              {err.merchant && <p className={errorClass}>{err.merchant}</p>}
            </div>

            {/* Category — pre-selected to the current EFFECTIVE category. Changing
                it away from the original sets the override; reverting clears it
                (logic lives server-side in updateTransactionAction). */}
            <div>
              <label htmlFor={`${formId}-category`} className={labelClass}>
                Category
              </label>
              <select
                id={`${formId}-category`}
                name="category"
                defaultValue={effectiveCategory}
                aria-invalid={err.category ? true : undefined}
                className={fieldClass}
              >
                {categories.map((name) => (
                  <option key={name} value={name}>
                    {name}
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
                autoComplete="off"
                defaultValue={transaction.notes}
                className={fieldClass}
              />
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-text-secondary-dark transition-colors hover:bg-white/5 hover:text-text-primary-dark"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-brand-yellow px-5 py-2 text-sm font-semibold text-charcoal transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
