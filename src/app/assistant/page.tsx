// AI Assistant — ask which card to use for a purchase and get a ranked, explained
// recommendation. Replaces the former ComingSoon stub (see src/app/CLAUDE.md
// "Assistant pattern").
//
// Server Component SHELL only: all data fetching + the Gemini calls happen inside the
// Server Action (./actions) on submit, and the interaction lives in the
// `_components/AssistantChat` Client Component. This page itself reads no database and
// no date at render, so it intentionally OMITS `dynamic = "force-dynamic"` — the same
// sanctioned exception to frontend rule 6 the stub used. (The live data is fetched
// per-request server-side in the action, not prerendered here.)

import AssistantChat from "./_components/AssistantChat";

export default function AssistantPage() {
  return (
    <main className="flex-1 px-6 py-8 md:px-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary-dark">
          AI Assistant
        </h1>
        <p className="mt-1 text-sm text-text-secondary-dark">
          Tell me what you’re about to buy — I’ll pick the best card. The reward
          math is computed exactly by the app; the assistant only reads the
          category and phrases the result.
        </p>
      </header>

      <section className="max-w-2xl">
        <AssistantChat />
      </section>
    </main>
  );
}
