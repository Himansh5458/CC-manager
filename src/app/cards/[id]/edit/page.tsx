// Edit Card — the edit half of the Cards add/edit forms (Forms pattern, see
// src/app/CLAUDE.md). Server Component that fetches the existing card, maps it down
// to the non-sensitive pre-fill shape, and renders the shared CardForm in "edit"
// mode wired to `updateCardAction` (with the card id bound server-side).
//
// Next.js 16: `params` is a Promise — it MUST be awaited (same convention as the
// /cards/[id] detail page). This page reads the live database, so it declares
// `dynamic = "force-dynamic"` (frontend rule 6).
//
// SECURITY (frontend rule 4): the full Card (with card_number_encrypted) is NEVER
// handed to the Client form. We build a CardFormValues subset — only
// `card_number_last4` crosses the boundary, purely for the masked placeholder hint.

import Link from "next/link";
import { getCardById } from "@/lib/data/cards";
import CardForm from "@/app/cards/_components/CardForm";
import { updateCardAction, type CardFormValues } from "@/app/cards/actions";

export const dynamic = "force-dynamic";

const CARD_CLASS =
  "rounded-2xl border border-white/5 bg-surface-dark p-6 shadow-lg shadow-black/20";

export default async function EditCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const card = await getCardById(id);

  // Unknown id → clean not-found state (never crash), matching the detail page.
  if (!card) {
    return (
      <main className="flex-1 px-6 py-8 md:px-10">
        <div className={`${CARD_CLASS} mx-auto max-w-md text-center`}>
          <h1 className="text-lg font-semibold text-text-primary-dark">
            Card not found
          </h1>
          <p className="mt-2 text-sm text-text-secondary-dark">
            No card matches this link. It may have been removed.
          </p>
          <Link
            href="/cards"
            className="mt-5 inline-block rounded-lg bg-brand-yellow/10 px-4 py-2 text-sm font-medium text-brand-yellow hover:bg-brand-yellow/20"
          >
            ← Back to Cards
          </Link>
        </div>
      </main>
    );
  }

  // Non-sensitive pre-fill subset (rule 4 — no card_number_encrypted, no computed
  // balance/utilization fields). Only last4 is exposed, for the masked hint.
  const values: CardFormValues = {
    card_holder: card.card_holder,
    card_name: card.card_name,
    card_bank: card.card_bank,
    card_type: card.card_type,
    card_number_last4: card.card_number_last4,
    expiry_month: card.expiry_month,
    expiry_year: card.expiry_year,
    registered_phone: card.registered_phone,
    registered_email: card.registered_email,
    annual_fee: card.annual_fee,
    statement_date: card.statement_date,
    payment_deadline_days: card.payment_deadline_days,
    customer_care_number: card.customer_care_number,
    credit_limit: card.credit_limit,
    renewal_date: card.renewal_date,
    issuance_date: card.issuance_date,
    benefits_summary: card.benefits_summary,
  };

  // Bind the id server-side so it never round-trips as a client form field; the
  // bound action matches CardForm's (state, formData) => Promise<CardFormState> prop.
  const boundAction = updateCardAction.bind(null, card.id);

  return (
    <main className="flex-1 px-6 py-8 md:px-10">
      <div className="mx-auto max-w-3xl">
        <Link
          href={`/cards/${card.id}`}
          className="inline-block text-sm text-text-secondary-dark hover:text-text-primary-dark"
        >
          ← {card.card_name}
        </Link>
        <h1 className="mb-6 mt-4 text-2xl font-semibold text-text-primary-dark">
          Edit card
        </h1>
        <CardForm
          mode="edit"
          action={boundAction}
          card={values}
          cancelHref={`/cards/${card.id}`}
        />
      </div>
    </main>
  );
}
