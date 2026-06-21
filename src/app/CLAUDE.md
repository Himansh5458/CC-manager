# Frontend Context (src/app)

## Scope
Everything under `src/app/` — pages, layouts, UI components, client-side state. This is the "frontend" half of the project.

## Rules
1. **Never call the data layer's storage internals directly.** Pages and components call functions exported from `src/lib/data/*` (e.g., `getCards()`, `saveTransaction()`). Never `fs.readFile` a JSON path or construct a Sheets API call from inside `src/app/`.
2. **Next.js 16 syntax is mandatory.** `params`/`searchParams` in any page/layout are Promises — always `await` them. See root `/CLAUDE.md` for details. Check `node_modules/next/dist/docs/01-app/` if unsure about a routing pattern.
3. **Design system compliance.** All colors, type, spacing, and component patterns must follow `/docs/design-system.md` (derived from the Startify Behance reference: dark charcoal #262E3B + yellow #F0D400 accent, Urbanist font, metric-card pattern, gauge/radar chart style). Do not introduce ad-hoc colors or fonts outside this system.
4. **No sensitive data in client-rendered output.** Encrypted card numbers, raw OAuth tokens, and the encryption key must never be passed as props to client components or appear in any client-side state. Decryption happens server-side only, per explicit user action.
5. **Every form/data-entry screen needs a review-before-save step** where extraction/computation could be wrong (statement parsing, benefit-dump extraction). This is a hard product requirement, not optional polish — see /DECISIONS.md.
6. **Pages reading live data must opt out of static prerendering.** Any page that reads the database or depends on the current date/time must declare `export const dynamic = "force-dynamic"` so it renders fresh on every request instead of being prerendered into a stale build-time snapshot. This is the default for this app — nearly every page is a live financial dashboard ("Due in X days", utilization, balances). Only omit it when a page renders genuinely static content, and document that exception inline.

## Navigation & layout shell — `layout.tsx` + `src/app/_components/`
The root `layout.tsx` renders a persistent **app shell**: a fixed-width left
sidebar (`_components/Sidebar.tsx`) present on every page, plus an independently
scrollable content column that holds each page's own `<main>`.
- **Shell mechanics.** `<body class="flex h-full overflow-hidden">` pins the shell
  to the viewport; the sidebar stays put while only the right-hand
  `<div class="... flex-1 overflow-y-auto">` scrolls. Pages keep rendering their
  own `<main className="flex-1 ...">` inside that column — no page changes were
  needed to adopt the shell.
- **Sidebar is the one Client Component here.** `Sidebar.tsx` is `"use client"`
  *only* because it highlights the active route via `usePathname()`. Active state
  uses the brand-yellow accent (`bg-brand-yellow/10 text-brand-yellow`), matching
  design-system.md; `/` matches exactly, all other links match by prefix so future
  nested routes keep their parent highlighted. `layout.tsx` itself stays a Server
  Component.
- **Icons are inline SVG**, not a library — no icon dependency was added. Minimal
  geometric outline style per design-system.md (stroke=currentColor so they inherit
  the active/hover colour).
- **Responsive (intentionally minimal).** Collapses to an icon-only rail (`w-16`)
  below `md` and expands to icons + labels (`w-64`) at `md`+; labels are
  `hidden md:inline`. This is a "doesn't break on narrow viewports" treatment, not
  a polished mobile experience — that's a later concern.
- **`_components/` convention.** Shared **components** live in
  `src/app/_components/` — an underscore-prefixed private folder, excluded from
  routing, mirroring the existing `_lib/` (helpers) convention. Use it for UI shared
  across pages; keep money/date math out of it (that's `src/lib/calculations/`).

### Placeholder pages — INTENTIONAL STUBS, not forgotten work
`/payments`, `/milestones`, and `/assistant` exist in the sidebar
but their feature work is a future phase. Each `page.tsx` is a **deliberate
throwaway stub** that renders the shared `_components/ComingSoon.tsx` ("Coming
soon" card) so navigating to them returns 200 and looks consistent instead of
404ing. Every stub file is marked `THROWAWAY STUB` at the top. When you build the
real page, replace the stub body wholesale. Because they render genuinely static
content (no DB/date reads), they intentionally **omit** `dynamic = "force-dynamic"`
(documented inline in each) — the one sanctioned exception to frontend rule 6.
(`/transactions` was the first stub promoted to a real page — see Forms pattern.)

## Forms pattern (Server Component page + Client form + Server Action)
Established by `/transactions` (the app's first data-entry screen). **All future
forms (Payments, Milestone edits, etc.) follow this three-part split** so they
stay consistent and keep mutation logic on the server:
1. **Page is a Server Component** (`async`, `dynamic = "force-dynamic"`). It
   fetches via the data layer, renders the existing data (the list/table)
   server-side, and renders the form component. It maps DB rows down to the
   **minimal non-sensitive shape** the form needs before passing them as props
   (frontend rule 4 — never hand full `Card` objects, with their encrypted number
   / contact fields, to a Client Component). Date defaults (`today`) are computed
   **server-side** and passed as a prop to avoid a hydration mismatch.
2. **Form is a Client Component** in the page's `_components/` folder. It's a
   Client Component only for React 19's `useActionState` (pending/error/success
   state) — it holds no business logic. Inputs are **uncontrolled**
   (`defaultValue`): on a validation error the form is deliberately *not* reset,
   so the browser retains the user's typed values; only a successful submit calls
   `formRef.current.reset()` (which restores `defaultValue`s, including date →
   today). The action is wired via `<form action={formAction}>`.
3. **Server Action** lives in the page's `actions.ts` (`"use server"`). It
   **re-validates every field on the server** (never trust the client) — including
   checking dropdown values like `card_id`/`category` against the *live* DB lists —
   then calls the data layer to persist, calls **`revalidatePath("/route")`** so
   the freshly-rendered list reflects the new row without a manual browser refresh,
   and returns a `{ ok, message, errors }` state object. `errors` is keyed by field
   name for inline messages; `message` is the form-level success/summary banner.
   Forced field values that aren't user input (e.g. `source: "manual"`,
   `confidence_flag: "high"`) are set here, not in the client.

**GOTCHA — a `"use server"` file may export ONLY async functions.** Do NOT export
the `useActionState` initial-state constant (or any other plain value) from
`actions.ts`. A non-function export does **not** survive the RSC boundary into a
Client Component — it arrives as a server-reference proxy, not the real object, so
`useActionState`'s initial `state` ends up without a real `.errors` and the form
crashes on first render (`Cannot read properties of undefined`). **This is invisible
to `tsc`**: the constant is annotated with a fully-defined type, so TypeScript trusts
that the access is safe — the unsoundness is injected by the framework's module
transform at runtime, which the type system cannot see. Define the initial-state
constant **inside the client component** instead (a *type-only* import from the
`"use server"` file is fine — types are erased at compile time). As defence-in-depth,
read it null-safe in the component (`const err = state?.errors ?? {}`).

**Input styling on the dark theme:** form inputs use a darker fill than their
surface card (`bg-background-dark` inputs inside a `bg-surface-dark` card) plus a
`border-white/10` border and a `focus:ring-brand-yellow` ring, so they read
clearly instead of blending into the surface. Date inputs add `[color-scheme:dark]`
so the native picker chrome matches. Reuse the `fieldClass`/`labelClass`/
`errorClass` constants in `LogTransactionForm.tsx` as the reference.

## Shared view helpers — `src/app/_lib/`
Presentational helpers used by more than one page live in `src/app/_lib/` (an
underscore-prefixed **private folder**, excluded from Next.js routing). View
concerns only — never put money/date *math* here; that belongs in
`src/lib/calculations/`.
- `_lib/format.ts` — `formatINR` (Intl en-IN, no paise), `ordinal`, and the
  design-system colour-banding utilities: `utilizationColorClass` /
  `utilizationBarClass` (green <30, amber 30–70, red >70), `dueColorClass`
  (red ≤3d, amber ≤10d, default beyond), `capColorClass` / `capBarClass`
  (green normal, amber ≥70%, red ≥90% — a higher band than utilization because
  the ₹8L family cap is a hard ceiling). Both the Dashboard and Cards page import
  these so their colour coding can never drift.

## Pages

### `/cards` — `src/app/cards/page.tsx`
Read-only list of active cards (credit limit, effective utilization, payment due).
Server Component, `dynamic = "force-dynamic"`. Imports `daysUntilDue` from
`calculations/dueDate` and the colour/format helpers from `_lib/format` (no inline
copies — they were extracted when the Dashboard needed the same logic).

### `/transactions` — `src/app/transactions/page.tsx`
Log a spend + review full history. Server Component, `async`,
`dynamic = "force-dynamic"`. Renders the `LogTransactionForm` (Client) above a
newest-first history table; the form posts to `createTransactionAction`
(`actions.ts`). Card names in the table are looked up across **all** cards (a txn
may belong to a now-inactive card), while the form dropdown offers **active**
cards only. Corrected categories render `original → override (corrected)`. The
first screen built on the **Forms pattern** (see above).

### `/` — `src/app/page.tsx` (Dashboard, home screen)
Server Component, `async`, `dynamic = "force-dynamic"`. The densest page in the app:
six stacked sections, each rendered from the **shared `calculations/` modules** (no
inline business logic — src/lib rule 2) and the `_lib/format` helpers. Card balances
are computed **once** per card (`recomputeCardBalance`) and reused across sections.
Section structure and data dependencies:
1. **Payment due dates** — per active card: outstanding (`recomputeCardBalance`) +
   `daysUntilDue` (calculations/dueDate). Sorted soonest-first; a passed deadline
   (null) sorts last and renders "No upcoming deadline". Colour via `dueColorClass`.
   Data: cards, transactions, payments.
2. **Utilization** — `getEffectiveUtilization` per card (override wins), banded with
   `utilizationColorClass`/`Bar`. Data: cards (+ the reused balances).
3. **This month's spend** — sum of each card's transactions within **its own** open
   statement cycle (`mostRecentStatementDate`, per-card boundary), summed across
   cards, plus a category breakdown sorted descending. Caption states explicitly
   that this is per-cycle, **not** a calendar-month figure. Data: cards, transactions.
4. **Insights** — `detectSpendAnomalies` + `getMilestoneProximityNudges` per active
   card, flattened into one text list; empty → "Nothing notable right now". Data:
   cards, transactions, milestones, milestoneTiers.
5. **Predicted next bill** — `predictNextBill` per card; shows amount + breakdown
   string. Data: cards, transactions, payments, recurringTransactions.
6. **Family spend cap** — per distinct `parent_family` of active cards: payments
   within the current FY (`getFinancialYear`/`getFinancialYearBounds`) for that
   family's cards, against the ₹8,00,000 cap, with a progress bar. Computed **fresh
   from raw payments** — the FamilyCapTracker tab is a cache, not a hard dependency,
   so a missing row never breaks the section; a cached row's
   `manual_override_total_paid`/`cap_amount` win when present. Data: cards, payments,
   familyCapTracker.

## Current state
Phase 3 (in progress): `/cards` list and `/` Dashboard built (dark dashboard design
system). Shared `_lib/format.ts` view helpers and `calculations/dueDate.ts`
(+ unit test) extracted so both pages share due-date and colour logic. Persistent
left-sidebar nav shell added (`layout.tsx` + `_components/Sidebar.tsx`).
`/transactions` is now a real page (log form + history) and established the Forms
pattern; the three remaining routes (`/payments`, `/milestones`, `/assistant`) are
still intentional `ComingSoon` stubs.

## Update this file
Whenever a new conventions or component pattern is established (e.g., "all forms use X library", "all tables use Y component"), add it here so future sessions follow the same pattern.
