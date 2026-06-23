"use client";

// Per-row delete control for the Transactions history table.
//
// Deletion is irreversible, so this uses the same two-click confirm pattern as
// the Payments page's DeletePaymentButton: the first click ("Delete") swaps in an
// explicit "Confirm" / "Cancel" pair; only "Confirm" actually submits the
// `deleteTransactionAction` Server Action. (A two-click swap is used instead of a
// native `confirm()` dialog because intercepting a Server-Action form submit to
// block on a native dialog is fiddly and inconsistent across browsers.)
//
// Client Component because it holds the confirming/pending UI state. The actual
// delete still runs server-side via the Server Action + revalidatePath.

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteTransactionAction } from "../actions";

export default function DeleteTransactionButton({
  transactionId,
}: {
  transactionId: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md px-2.5 py-1 text-xs font-medium text-text-secondary-dark transition-colors hover:bg-danger/10 hover:text-danger"
      >
        Delete
      </button>
    );
  }

  return (
    <form
      action={deleteTransactionAction}
      className="inline-flex items-center gap-1"
    >
      <input type="hidden" name="id" value={transactionId} />
      <ConfirmButton />
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-md px-2.5 py-1 text-xs font-medium text-text-secondary-dark transition-colors hover:bg-white/5 hover:text-text-primary-dark"
      >
        Cancel
      </button>
    </form>
  );
}

/** Submit button for the confirm step. Separated so `useFormStatus` can read the
 *  parent form's pending state and disable the button while the delete is in
 *  flight (it must be a descendant of the <form> to see that status). */
function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-danger/10 px-2.5 py-1 text-xs font-semibold text-danger transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Deleting…" : "Confirm"}
    </button>
  );
}
