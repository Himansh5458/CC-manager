// Server Actions for the Cards add/edit forms.
//
// Follows the established Forms pattern (src/app/CLAUDE.md):
//   Server Component page → Client form (CardForm) → Server Action (here) → data layer
//
// Two actions, both async (the only thing a "use server" file may export across the
// RSC boundary): `createCardAction` (new card) and `updateCardAction` (edit existing).
// Both re-validate every field on the server, then go through the data layer
// (createCard / updateCard) — never the JSON file directly (root CLAUDE.md).
//
// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDER ENCRYPTION (the next phase replaces this):
//   `card_number_encrypted` does NOT yet hold an encrypted value. Real AES-256-GCM
//   encryption (src/lib/security/encryption.ts — src/lib rule 4) is not implemented.
//   For now the RAW digits the user typed are stored as-is. This is deliberate and
//   isolated: each write site is marked `TODO(encryption)` and is a ONE-LINE swap —
//   wrap the digits in `encrypt(...)` there and nothing else (UI, validation,
//   last4 derivation) has to change.
// ─────────────────────────────────────────────────────────────────────────────

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createCard, getCardById, updateCard } from "@/lib/data/cards";
import type { Card, CardNetwork } from "@/lib/types/schema";

/**
 * Shape returned to the client form via React 19's `useActionState`. `errors` is
 * keyed by field name (inline messages); `message` is the form-level banner.
 *
 * NOTE (Forms-pattern gotcha): a "use server" file may export ONLY async functions
 * as VALUES — a non-function export arrives at a Client Component as a server-
 * reference proxy, not the real object, which breaks `useActionState`'s initial
 * state. A *type* export like this is fine (erased at compile time); the initial-
 * state VALUE is defined inside CardForm.tsx, not here.
 */
export type CardFormState = {
  ok: boolean;
  message: string | null;
  errors: Record<string, string>;
};

/**
 * Non-sensitive subset used to PRE-FILL the edit form. It deliberately does NOT
 * include `card_number_encrypted` (frontend rule 4 — encrypted numbers never reach
 * a Client Component); only `card_number_last4` crosses over, purely for the masked
 * hint. Also omits the computed/cached fields the form doesn't edit
 * (current_outstanding_balance / current_utilization_pct /
 * manual_override_utilization_pct / active) so they can never be wiped via the form.
 */
export type CardFormValues = {
  card_holder: string;
  card_name: string;
  card_bank: string;
  card_type: CardNetwork;
  card_number_last4: string;
  expiry_month: number;
  expiry_year: number;
  registered_phone: string;
  registered_email: string;
  annual_fee: number;
  statement_date: number;
  payment_deadline_days: number;
  customer_care_number: string;
  credit_limit: number;
  renewal_date: string;
  issuance_date: string;
  benefits_summary: string;
};

// Local copy of the allowed networks for SERVER-SIDE re-validation. Not exported to
// the client (a value export from a "use server" file would arrive as a proxy — the
// gotcha above); CardForm.tsx keeps its own copy for the dropdown.
const NETWORKS: CardNetwork[] = ["Visa", "Mastercard", "Amex", "Rupay", "Diners"];

/** The editable, non-number fields after parsing, plus parent_family (computed). */
type ParsedFields = Omit<
  Card,
  | "id"
  | "card_number_encrypted"
  | "card_number_last4"
  | "current_outstanding_balance"
  | "current_utilization_pct"
  | "manual_override_utilization_pct"
  | "active"
>;

type ParsedCardForm = {
  fields: ParsedFields;
  // null  ⟺  the card-number field was left blank. The CALLER decides what blank
  // means: an error on create (required), "keep the existing number" on edit.
  // Non-null is the cleaned digit string (validated 13–19 digits).
  cardNumberDigits: string | null;
  errors: Record<string, string>;
};

/**
 * Parse + validate every shared field from the submitted FormData. Re-runs ALL
 * validation server-side (never trust the client). Card-number presence is NOT
 * judged here — the field is parsed to digits-or-null and the caller applies the
 * create-vs-edit rule.
 */
function parseCardForm(formData: FormData): ParsedCardForm {
  const get = (k: string) => String(formData.get(k) ?? "").trim();

  const card_holder = get("card_holder");
  const card_name = get("card_name");
  const card_bank = get("card_bank");
  const card_typeRaw = get("card_type");
  const cardNumberRaw = get("card_number");
  const expiryMonthRaw = get("expiry_month");
  const expiryYearRaw = get("expiry_year");
  const registered_phone = get("registered_phone");
  const registered_email = get("registered_email");
  const annualFeeRaw = get("annual_fee");
  const statementDateRaw = get("statement_date");
  const paymentDeadlineRaw = get("payment_deadline_days");
  const customer_care_number = get("customer_care_number");
  const creditLimitRaw = get("credit_limit");
  const renewal_date = get("renewal_date");
  const issuance_date = get("issuance_date");
  const benefits_summary = get("benefits_summary");

  const errors: Record<string, string> = {};

  // Required identity fields.
  if (!card_holder) errors.card_holder = "Card holder is required.";
  if (!card_name) errors.card_name = "Card name is required.";
  if (!card_bank) errors.card_bank = "Bank is required.";

  // Network: required, must be one of ours.
  const card_type = card_typeRaw as CardNetwork;
  if (!card_typeRaw) errors.card_type = "Select a card network.";
  else if (!NETWORKS.includes(card_type))
    errors.card_type = "Unknown card network.";

  // Card number: strip spaces/dashes to digits. Blank is allowed at this layer.
  // 13–19 digits covers Amex (15) / Diners (14) / Visa·MC·Rupay (16), per ISO/IEC 7812.
  const cardNumberDigits = cardNumberRaw.replace(/\D/g, "");
  if (
    cardNumberRaw &&
    (cardNumberDigits.length < 13 || cardNumberDigits.length > 19)
  ) {
    errors.card_number = "Enter a valid card number (13–19 digits).";
  }

  // Expiry month: 1–12.
  const expiry_month = Number(expiryMonthRaw);
  if (!expiryMonthRaw) errors.expiry_month = "Expiry month is required.";
  else if (!Number.isInteger(expiry_month) || expiry_month < 1 || expiry_month > 12)
    errors.expiry_month = "Month must be 1–12.";

  // Expiry year: required, not in the past, and not absurdly far ahead.
  const expiry_year = Number(expiryYearRaw);
  const currentYear = new Date().getUTCFullYear();
  if (!expiryYearRaw) errors.expiry_year = "Expiry year is required.";
  else if (!Number.isInteger(expiry_year) || expiry_year < currentYear)
    errors.expiry_year = `Year can't be before ${currentYear}.`;
  else if (expiry_year > currentYear + 30)
    errors.expiry_year = "Year is too far in the future.";

  // Email: optional, but validate shape if provided.
  if (
    registered_email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registered_email)
  ) {
    errors.registered_email = "Enter a valid email address.";
  }

  // Annual fee: optional, defaults to 0; must be >= 0 if provided.
  let annual_fee = 0;
  if (annualFeeRaw) {
    annual_fee = Number(annualFeeRaw);
    if (!Number.isFinite(annual_fee) || annual_fee < 0)
      errors.annual_fee = "Annual fee can't be negative.";
  }

  // Statement date: required, 1–31 (drives due-date / balance math).
  const statement_date = Number(statementDateRaw);
  if (!statementDateRaw) errors.statement_date = "Statement date is required.";
  else if (
    !Number.isInteger(statement_date) ||
    statement_date < 1 ||
    statement_date > 31
  )
    errors.statement_date = "Statement date must be a day 1–31.";

  // Payment deadline (days after statement): required, whole number >= 0.
  const payment_deadline_days = Number(paymentDeadlineRaw);
  if (!paymentDeadlineRaw)
    errors.payment_deadline_days = "Payment deadline is required.";
  else if (
    !Number.isInteger(payment_deadline_days) ||
    payment_deadline_days < 0
  )
    errors.payment_deadline_days = "Must be a whole number of days.";

  // Credit limit: required, strictly positive.
  const credit_limit = Number(creditLimitRaw);
  if (!creditLimitRaw) errors.credit_limit = "Credit limit is required.";
  else if (!Number.isFinite(credit_limit) || credit_limit <= 0)
    errors.credit_limit = "Credit limit must be a positive number.";

  // parent_family is COMPUTED, never user-entered (card_bank + " " + card_holder),
  // matching the seed convention ("HDFC Rohit Singh").
  const parent_family = `${card_bank} ${card_holder}`;

  return {
    fields: {
      card_holder,
      card_name,
      card_bank,
      card_type,
      expiry_month,
      expiry_year,
      registered_phone,
      registered_email,
      annual_fee,
      statement_date,
      payment_deadline_days,
      customer_care_number,
      credit_limit,
      renewal_date,
      issuance_date,
      benefits_summary,
      parent_family,
    },
    cardNumberDigits: cardNumberRaw ? cardNumberDigits : null,
    errors,
  };
}

/**
 * Create a new card from the Add Card form. Card number is REQUIRED here. On
 * success, redirects to the new card's detail page.
 */
export async function createCardAction(
  _prevState: CardFormState,
  formData: FormData,
): Promise<CardFormState> {
  const { fields, cardNumberDigits, errors } = parseCardForm(formData);

  // Card number is REQUIRED on create (unlike edit, where blank = "keep existing").
  if (cardNumberDigits === null) {
    errors.card_number = "Card number is required.";
  }

  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      message: "Couldn't save — please fix the highlighted fields.",
      errors,
    };
  }

  // TODO(encryption): store the RAW number as-is for now — real AES-256-GCM
  // encryption is not implemented yet. When it lands this is the ONE-LINE swap:
  //     card_number_encrypted: encrypt(cardNumberDigits!),
  // Nothing else in this action / the form / the validation changes.
  const created = await createCard({
    ...fields,
    card_number_encrypted: cardNumberDigits!, // RAW placeholder — NOT encrypted yet
    card_number_last4: cardNumberDigits!.slice(-4), // auto-derived, never a separate input
    current_outstanding_balance: 0, // new card: nothing computed yet
    current_utilization_pct: 0,
    manual_override_utilization_pct: null,
    active: true, // new cards default to active
  });

  // Refresh the cached list; the detail page itself is force-dynamic.
  revalidatePath("/cards");
  // redirect() throws NEXT_REDIRECT, so this never returns normally — that's fine,
  // useActionState handles an action that navigates instead of returning a state.
  redirect(`/cards/${created.id}`);
}

/**
 * Update an existing card from the Edit Card form. `id` is bound server-side by the
 * edit page (`updateCardAction.bind(null, card.id)`), so it never round-trips as a
 * client form field. On success, redirects back to the card's detail page.
 *
 * CARD-NUMBER PRESERVATION (the critical correctness detail): the edit form shows
 * the number field EMPTY with the masked existing number only as a placeholder hint.
 * A blank submission therefore means "keep the stored number", NOT "wipe it":
 * `cardNumberDigits === null` ⟹ we omit card_number_encrypted / card_number_last4
 * from the update, and updateCard's partial merge preserves the existing values. The
 * stored number is overwritten ONLY when the user actually types a new one.
 */
export async function updateCardAction(
  id: string,
  _prevState: CardFormState,
  formData: FormData,
): Promise<CardFormState> {
  // Re-check the target exists against the LIVE db (a stale link shouldn't crash).
  const existing = await getCardById(id);
  if (!existing) {
    return {
      ok: false,
      message: "That card no longer exists — it may have been removed.",
      errors: {},
    };
  }

  const { fields, cardNumberDigits, errors } = parseCardForm(formData);
  // NOTE: no required-card_number check here — blank is valid on edit (= keep existing).

  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      message: "Couldn't save — please fix the highlighted fields.",
      errors,
    };
  }

  // Editable fields only. Computed/cached fields (balance, utilization, override,
  // active) are intentionally absent, so updateCard's partial merge leaves them as
  // they were — editing a card never resets its computed balance.
  const updates: Partial<Card> = { ...fields };

  if (cardNumberDigits !== null) {
    // The user typed a NEW number — overwrite both the stored number and last4.
    // TODO(encryption): same ONE-LINE swap point as createCardAction —
    //     updates.card_number_encrypted = encrypt(cardNumberDigits);
    updates.card_number_encrypted = cardNumberDigits; // RAW placeholder — NOT encrypted yet
    updates.card_number_last4 = cardNumberDigits.slice(-4);
  }
  // else: field left blank → leave card_number_encrypted / card_number_last4 untouched.

  await updateCard(id, updates);

  revalidatePath("/cards");
  revalidatePath(`/cards/${id}`);
  redirect(`/cards/${id}`);
}
