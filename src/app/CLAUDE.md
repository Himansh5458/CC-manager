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
The `ComingSoon` stub pattern (a shared `_components/ComingSoon.tsx` "Coming soon"
card so a not-yet-built route returns 200 instead of 404, marked `THROWAWAY STUB`
at the top, replaced wholesale when the real page lands) is **no longer in use — all
sidebar routes are now real pages.** `/transactions` was the first stub promoted (see
Forms pattern), then `/payments`, `/milestones`, and finally `/assistant` (see
Assistant pattern). The convention is documented here in case a future route is added
as a stub first: a `ComingSoon` page renders genuinely static content (no DB/date
reads), so it intentionally **omits** `dynamic = "force-dynamic"` (documented inline)
— the one sanctioned exception to frontend rule 6. The Assistant page keeps that
same exception for the same reason (its shell reads nothing at render).

## Multi-marker progress bar pattern — `MilestoneProgressBar`
The Milestones page introduced the app's first **genuinely custom visual**: an
"XP bar with checkpoints" — ONE horizontal track whose fill represents an amount
against a maximum, with several threshold markers positioned along that single
axis (not one bar per threshold). It lives at
`src/app/milestones/_components/MilestoneProgressBar.tsx`. **Reuse / extend this
component if another page needs the same multi-threshold-on-one-axis treatment;
don't reinvent a second one.** Key conventions baked in:
- **Single axis, proportional markers.** The 0%→100% width maps to ₹0 → the
  **highest** threshold, so every lower tier lands at `threshold ÷ highest` and
  the top tier sits exactly at the right edge. The fill is `min(progress ÷
  highest, 100)%`. A zero/negative max is guarded (flat empty track, no divide
  by zero).
- **Stays a Server Component.** It has no interactivity — only positioned static
  markup — so it is NOT `"use client"`, matching the page that renders it. (The
  contrast with the Forms-pattern client components: those need React hooks;
  this needs none.)
- **Achieved vs computed vs manual.** The caller passes an **already
  override-resolved** `achieved` (from `recomputeMilestoneProgress`, which applies
  "manual override wins") plus a separate `isManualOverride` flag. Achieved
  markers are green with a check glyph; a manual override additionally gets a blue
  ring + a "Set manually" label so a hand-set status is never mistaken for a
  computed achievement (the established override-wins principle, made visible).
- **Edge-aware labels.** Marker labels are absolutely positioned under each
  marker; the **first** anchors left and the **last** anchors right (others
  centred) so the end labels never clip the track.
- Icons are **inline SVG** (the check glyph), per the design-system "no icon
  library" convention.

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

**Create-or-delete-only resources (no update) — the Payments variant.** Some
tabs are append-or-delete by schema design (Payments, Exclusions): the data layer
has `create*` + `delete*` but **no `update*`** (see `src/lib/data/payments.ts`).
Their page follows the Forms pattern for the create half, plus a **per-row delete
control** instead of any edit affordance:
- The delete is its own **bare `async (formData) => void` Server Action** in
  `actions.ts` — NOT wired through `useActionState` (there's no field-level error
  UI to show; a delete either happens or is a harmless no-op). It re-checks the id
  against the *live* DB so a stale/duplicate submit is ignored, then
  `revalidatePath`s. A `"use server"` file mixing a `useActionState` action and a
  bare void action is fine — both are async functions, the only thing the RSC
  boundary allows it to export.
- Because deletion is irreversible, the row's button is a small Client Component
  (`_components/DeletePaymentButton.tsx`) using a **two-click confirm** pattern
  (first click swaps in explicit Confirm / Cancel buttons; only Confirm submits the
  Server Action). A native `confirm()` is deliberately avoided — blocking a
  Server-Action form submit on a native dialog is fiddly/inconsistent across
  browsers. The confirm submit button reads `useFormStatus().pending` (so it must
  be a descendant of the `<form>`) to disable itself while the delete is in flight.

**Input styling on the dark theme:** form inputs use a darker fill than their
surface card (`bg-background-dark` inputs inside a `bg-surface-dark` card) plus a
`border-white/10` border and a `focus:ring-brand-yellow` ring, so they read
clearly instead of blending into the surface. Date inputs add `[color-scheme:dark]`
so the native picker chrome matches. Reuse the `fieldClass`/`labelClass`/
`errorClass` constants in `LogTransactionForm.tsx` as the reference.

## Assistant pattern (Server-Component shell + Client chat + AI Server Action)
Established by `/assistant` (the app's first LLM-backed screen). It reuses the Forms
pattern's machinery (`useActionState`, initial-state-defined-in-the-client) but adds
a few assistant-specific conventions:
1. **Page is a static Server-Component shell.** `assistant/page.tsx` reads **no DB and
   no date at render** — all data fetching and the Gemini calls happen inside the
   Server Action on submit — so it is the one real page that **omits**
   `dynamic = "force-dynamic"` (documented inline; the sanctioned frontend-rule-6
   exception, same as the old `ComingSoon` stub). It renders only the heading +
   `_components/AssistantChat`.
2. **The LLM never does arithmetic.** `rankCardsForPurchase` (calculations/) does 100%
   of the reward math; Gemini only (a) maps free text → one of our category names and
   (b) phrases the already-computed numbers. See `src/lib/ai/gemini.ts`.
3. **Two Server Actions in `actions.ts`** (both async, the only thing a `"use server"`
   file may export): `getCardRecommendation(desc, amount)` is the core routine
   (validate → `matchCategory` → `rankCardsForPurchase` → `explainRecommendation`,
   returns `{ category, results, explanation, error }`); `getRecommendationAction`
   is the `useActionState`-shaped wrapper the form binds to. **Validation is on the
   server** (non-empty description, amount > 0) and bad input returns an `error` state
   rather than throwing. No `revalidatePath` — this action computes, it doesn't mutate.
4. **Every Gemini payload goes through `security/sanitize.ts`** (rule 3) — the action
   builds an id→name map server-side and hands Gemini only card names + computed
   figures, never raw rows/ids.
5. **Client component accumulates conversation history.** `AssistantChat.tsx` is a
   Client Component for `useActionState`. Because `useActionState` only holds the
   LATEST result, each successful state is appended to a local `useState` history
   array in an effect, guarded by a `lastAppended` ref (append exactly once per state
   object — survives strict-mode effect replays). On success the form is reset; on a
   validation error it is not, and the error renders as a banner. A **"Thinking…"**
   bubble (animated dots + the optimistically-echoed question) shows while `pending`,
   since the two Gemini round-trips take a few seconds — the UI must never look frozen.
6. **UX choice — two inputs, not one.** A free-text "what are you buying?" plus a
   separate numeric amount, deliberately NOT a single "₹500 on Swiggy" box: the amount
   must stay an exact deterministic number, and parsing it out of free text would mean
   brittle regex or asking Gemini to read a figure (against the no-LLM-math law).
   Display: matched category pill → ranked cards (top highlighted) each showing
   direct + milestone + total → the conversational explanation below.

## Card Document View pattern — `cards/[id]/page.tsx`
Established by the per-card detail route. **The template for any future
single-record "document" view** (a full read-only dossier of one entity, reached by
clicking a row/card in a list). Conventions:
1. **Dynamic segment, Server Component, `force-dynamic`.** The folder is
   `cards/[id]/`. `params` is a **Promise** (Next.js 16) — the signature is
   `({ params }: { params: Promise<{ id: string }> })` and the first line is
   `const { id } = await params`. Never destructure `params` synchronously. Verified
   against `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md`.
2. **Fetch-the-root-first, then fan out.** It `await`s `getCardById(id)` alone first;
   a `null` result short-circuits to a **clean "Card not found" card** (with a link
   back to `/cards`) — it never throws/crashes on a bad id. Only once the card is
   known to exist does it `Promise.all` the related rows
   (`getRewardRulesByCardId`, `getMilestonesByCardId`, `getMilestoneTiers`,
   `getFeesByCardId`, `getExclusionsByCardId`).
3. **Stacked sections, each a `CARD_CLASS` panel**, each with its own **clean empty
   state** (never error on zero rows): Header (name, bank, holder, masked number,
   network, expiry, Active/Inactive badge, Edit link) → Reward Rates → Milestones →
   Fees & Charges → Exclusions → Account Details.
4. **Reward rate formatting branches on `rate_type`** (the two are different
   mechanics, not notations — see schema.ts): `"percentage"` → `"5% points"`,
   `"per_100_spend"` → `"5 miles per ₹100"`; `monthly_cap` shown only when non-null.
   Fee amounts branch too: `forex_markup`/`reward_redemption` render as `%`, all
   other fee types as `formatINR`.
5. **Milestones reuse `MilestoneProgressBar`** (imported from
   `@/app/milestones/_components/MilestoneProgressBar`) — **do not** build a second
   progress bar. The tracks are assembled exactly as the Milestones page does: read
   the **stored** tier values as-is (no live recompute — database as ledger of
   computed truth), sort tiers ascending, and let `manual_override_achieved` win over
   stored `achieved` (override-wins). Scoped to this one card's milestones.
6. **Edit affordance is a forward link only.** A small "Edit" button links to
   `/cards/[id]/edit` (now built — see the Card add/edit forms section); the document
   view itself is strictly read-only.
7. **SECURITY (frontend rule 4).** `card_number_encrypted` is **never read,
   rendered, or passed to any component** — only `card_number_last4` is displayed.
   This holds structurally because the page and `MilestoneProgressBar` are both
   **Server Components** (no `"use client"` anywhere on the route) and no child
   receives the `Card` object at all (only primitives/`ProgressTierMarker[]` cross
   any component boundary), so the encrypted field never enters client-rendered
   output. When extending this view, keep it a Server Component and never hand a full
   `Card` to a Client Component.

## Card add/edit forms — one shared `CardForm` for two routes
`/cards/new` (Add) and `/cards/[id]/edit` (Edit) are both the **Forms pattern**, but
they share a **single Client Component** `cards/_components/CardForm.tsx` because the
field set is identical — **do not fork a second card form.** Mode-specific behaviour
is prop-driven (`mode: "create" | "edit"`, the bound `action`, optional `card`
pre-fill, `cancelHref`). The two Server Actions live in `cards/actions.ts`
(`createCardAction`, `updateCardAction`). Conventions specific to these forms:
- **Server-derived fields are NEVER form inputs.** `card_number_last4` is sliced from
  the typed number, `parent_family` is computed `card_bank + " " + card_holder`, and
  for create `active=true` / balance / utilization / override default to `true/0/0/null`
  — all set in the action, never collected from the user (mirrors the
  Transactions action forcing `source`/`confidence_flag`).
- **Edit preserves computed/cached fields by OMISSION.** `updateCardAction` builds a
  `Partial<Card>` of only the editable fields and calls `updateCard` (a partial
  merge), so `current_outstanding_balance` / `current_utilization_pct` /
  `manual_override_utilization_pct` / `active` are left untouched — editing a card
  never resets its computed balance.
- **CARD-NUMBER PRESERVATION (the critical edit-form rule).** The edit form shows the
  number field **empty**, with the masked existing number (`•••• •••• •••• 4521`) only
  as a **placeholder hint** — the real/encrypted number is never sent to the client
  (rule 4; only `card_number_last4` crosses over). A blank submission means **"keep
  the stored number"**, NOT "wipe it": the action overwrites
  `card_number_encrypted` / `card_number_last4` **only when the user actually typed a
  new number** (`cardNumberDigits !== null`). Create requires the number; edit does not.
- **PLACEHOLDER ENCRYPTION — the TODO pattern.** `card_number_encrypted` does **not**
  yet hold an encrypted value — real AES-256-GCM encryption (`src/lib/security/
  encryption.ts`, src/lib rule 4) is the **next phase**. For now the raw typed digits
  are stored as-is. Each write site in `actions.ts` is marked **`TODO(encryption)`**
  and is a deliberate **ONE-LINE swap**: wrap the digits in `encrypt(...)` there and
  nothing else (UI, validation, last4 derivation) changes. When encryption lands,
  grep `TODO(encryption)` in `cards/actions.ts` — there are exactly two sites
  (create + the "number changed" branch of edit).
- **The `id` is bound, not posted.** The edit page binds it server-side
  (`updateCardAction.bind(null, card.id)`) so it never round-trips as a client form
  field; the bound action matches `CardForm`'s `(state, formData) => Promise<state>`
  prop. The action also re-checks the card still exists against the live db.
- **Validation is all server-side** (`parseCardForm`): required identity fields +
  network-in-enum + card number 13–19 digits (covers Amex 15 / Diners 14 / 16-digit
  networks) + expiry month 1–12 + expiry year ≥ current UTC year + statement_date
  1–31 + positive credit_limit + non-negative fee/deadline + email shape if provided.
  `renewal_date`/`issuance_date`/phone/care/benefits/email are optional (stored as
  typed or `""`). Reuses the same `fieldClass`/`labelClass`/`errorClass` input styling
  as `LogTransactionForm`.

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
copies — they were extracted when the Dashboard needed the same logic). Each card is
a `<Link href={/cards/${card.id}}>` (the article was wrapped in place — minimal
change) navigating to the detail view, with a hover border/shadow affordance. The
header carries a **"+ Add Card"** link to `/cards/new`.

### `/cards/new` — `src/app/cards/new/page.tsx`
Add a card. **Static Server-Component shell** (reads no db/date at render — the form
is static and all work happens in the Server Action on submit), so it **omits**
`dynamic = "force-dynamic"` (the sanctioned frontend-rule-6 exception, same as the
Assistant shell; documented inline). Renders the shared `CardForm` in `"create"` mode
wired to `createCardAction`. See the **Card add/edit forms** section above.

### `/cards/[id]/edit` — `src/app/cards/[id]/edit/page.tsx`
Edit an existing card. Server Component, `async`, `dynamic = "force-dynamic"` (reads
the live db); **dynamic segment with `params` as a Promise** (Next.js 16 — `await
params`), with a clean "Card not found" state for an unknown id. Maps the Card down to
a non-sensitive `CardFormValues` (rule 4 — never the encrypted number; only last4 for
the masked hint) and renders the shared `CardForm` in `"edit"` mode wired to
`updateCardAction` (id bound server-side). See the **Card add/edit forms** section
above for the card-number-preservation and placeholder-encryption details.

### `/cards/[id]` — `src/app/cards/[id]/page.tsx`
Per-card **Card Document View** — full read-only dossier of one card (header,
reward rates, milestones, fees & charges, exclusions, account details). Server
Component, `async`, `dynamic = "force-dynamic"`; **dynamic segment with `params` as
a Promise** (Next.js 16 — `await params`). Renders a clean "Card not found" state
(not a crash) for an unknown id. Reuses `MilestoneProgressBar` from the Milestones
page for its milestone section. Reads only `card_number_last4` — never the encrypted
number. Links to a not-yet-built `/cards/[id]/edit`. The template for the **Card
Document View pattern** (see above).

### `/transactions` — `src/app/transactions/page.tsx`
Log a spend + review full history. Server Component, `async`,
`dynamic = "force-dynamic"`. Renders the `LogTransactionForm` (Client) above a
newest-first history table; the form posts to `createTransactionAction`
(`actions.ts`). Card names in the table are looked up across **all** cards (a txn
may belong to a now-inactive card), while the form dropdown offers **active**
cards only. Corrected categories render `original → override (corrected)`. The
first screen built on the **Forms pattern** (see above).

### `/payments` — `src/app/payments/page.tsx`
Log a payment + review full history. Server Component, `async`,
`dynamic = "force-dynamic"`. Renders the `LogPaymentForm` (Client) above a
newest-first history table; each row carries a `DeletePaymentButton` (Client,
two-click confirm). The form posts to `createPaymentAction`; rows delete via
`deletePaymentAction` (both in `actions.ts`). Payments are **create-or-delete
only — no edit** (schema design — see the create-or-delete-only note in the Forms
pattern above). `source` is a **free-text** field (UPI, Bank Transfer, …), not a
constrained dropdown, because payment sources vary. Card names in the table are
looked up across **all** cards (a payment may belong to a now-inactive card),
while the form dropdown offers **active** cards only — same split as Transactions.

### `/milestones` — `src/app/milestones/page.tsx`
Read-only progress view of every active milestone track. Server Component,
`async`, `dynamic = "force-dynamic"`. Fetches active milestones, all tiers,
and active cards; **groups by card** (a card section header, then
one block per that card's milestone tracks) and **drops any card with zero active
milestones entirely** (no empty-section noise). It reads the **STORED** computed
fields straight off each record — the tier's `current_progress_amount` /
`achieved` / `manual_override_achieved` and the milestone's
`cycle_start_date`/`cycle_end_date` — and does **NOT** recompute on read
(`recomputeMilestoneProgress` / `calculateCurrentCycle` are deliberately not
called here). The database is the readable ledger of computed truth; recompute
happens on write (a recompute-on-write trigger is deferred — see
`/KNOWN_LIMITATIONS.md` and src/lib/CLAUDE.md "Deferred work"). `manual_override_achieved`
still wins over the stored `achieved` for display (override-wins principle). Each
track renders its cadence (`Quarterly · Calendar` etc.), stored cycle dates, and
the multi-marker progress bar (above). **Display only — no create/edit of
milestones or tiers** (a separate future page). Note: because the page shows
stored values, the bar reflects the last saved recompute, which can lag the raw
transactions until a recompute-on-write trigger exists.

### `/assistant` — `src/app/assistant/page.tsx`
Ask which card to use for a purchase; get a category match + ranked cards + a
conversational explanation. **Static Server-Component shell** (the one real page
without `force-dynamic` — no DB/date reads at render), rendering the
`AssistantChat` Client Component. Posts to `getRecommendationAction` (`actions.ts`),
which classifies the purchase via Gemini (`matchCategory`), ranks active cards
**deterministically** (`rankCardsForPurchase`), and phrases the result via Gemini
(`explainRecommendation`) — all Gemini payloads sanitized (`security/sanitize.ts`).
The app's first LLM-backed screen and the template for the **Assistant pattern**
(see above). Requires `GEMINI_API_KEY` in `.env.local`; degrades gracefully (category
→ "Other", explanation → template string) when Gemini is unavailable.

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
pattern; `/payments` is now a real page too (log form + history with per-row
delete — the first create-or-delete-only screen); `/milestones` is now a real
read-only page (live tier progress via the new multi-marker progress bar — the
app's first custom visual). `/assistant` is now a real page too — the app's first
LLM-backed screen (Gemini category-match + deterministic ranking + phrased
explanation), establishing the **Assistant pattern**. No `ComingSoon` stubs remain.

## Update this file
Whenever a new conventions or component pattern is established (e.g., "all forms use X library", "all tables use Y component"), add it here so future sessions follow the same pattern.
