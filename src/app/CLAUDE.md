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
`/transactions`, `/payments`, `/milestones`, and `/assistant` exist in the sidebar
but their feature work is a future phase. Each `page.tsx` is a **deliberate
throwaway stub** that renders the shared `_components/ComingSoon.tsx` ("Coming
soon" card) so navigating to them returns 200 and looks consistent instead of
404ing. Every stub file is marked `THROWAWAY STUB` at the top. When you build the
real page, replace the stub body wholesale. Because they render genuinely static
content (no DB/date reads), they intentionally **omit** `dynamic = "force-dynamic"`
(documented inline in each) — the one sanctioned exception to frontend rule 6.

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
left-sidebar nav shell added (`layout.tsx` + `_components/Sidebar.tsx`); the four
not-yet-built routes (`/transactions`, `/payments`, `/milestones`, `/assistant`) are
intentional `ComingSoon` stubs.

## Update this file
Whenever a new conventions or component pattern is established (e.g., "all forms use X library", "all tables use Y component"), add it here so future sessions follow the same pattern.
