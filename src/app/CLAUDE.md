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
(+ unit test) extracted so both pages share due-date and colour logic.

## Update this file
Whenever a new conventions or component pattern is established (e.g., "all forms use X library", "all tables use Y component"), add it here so future sessions follow the same pattern.
