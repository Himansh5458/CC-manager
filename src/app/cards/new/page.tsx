// Add Card — the create half of the Cards add/edit forms (Forms pattern, see
// src/app/CLAUDE.md). Server Component shell that renders the shared CardForm in
// "create" mode and wires it to `createCardAction`.
//
// This page reads NO database and NO date at render — the form is static markup and
// all fetching/validation happens server-side inside the Server Action on submit.
// So, like the Assistant shell, it deliberately OMITS `dynamic = "force-dynamic"`
// (the sanctioned frontend-rule-6 exception — documented here). The companion Edit
// page DOES read the db, so it keeps force-dynamic.

import Link from "next/link";
import CardForm from "@/app/cards/_components/CardForm";
import { createCardAction } from "@/app/cards/actions";

export default function NewCardPage() {
  return (
    <main className="flex-1 px-6 py-8 md:px-10">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/cards"
          className="inline-block text-sm text-text-secondary-dark hover:text-text-primary-dark"
        >
          ← Cards
        </Link>
        <h1 className="mb-6 mt-4 text-2xl font-semibold text-text-primary-dark">
          Add a card
        </h1>
        <CardForm mode="create" action={createCardAction} cancelHref="/cards" />
      </div>
    </main>
  );
}
