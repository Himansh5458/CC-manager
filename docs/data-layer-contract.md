# Data Layer Contract

This document is the authoritative contract for the data-access layer. All
reads/writes to the database (dev-phase: local JSON at `/data/database.json`;
production-phase: Google Sheets) go through functions documented here. It must
stay in sync with the actual code in `src/lib/data/`.

## Schema types

The canonical TypeScript definitions for the 13-tab data schema live in:

> **`src/lib/types/schema.ts`**

Field names in that file must stay in sync with the eventual Google Sheets
column names. The dev-phase JSON database mirrors this schema exactly. All date
fields are `string` (ISO 8601).

The file exports one interface per tab, plus a top-level `Database` interface
whose array properties hold each tab's rows:

| # | Interface | Tab / purpose |
|---|-----------|---------------|
| 1 | `Card` | Credit cards |
| 2 | `RewardRule` | Earning rules per card/category |
| 3 | `Transaction` | Individual spends |
| 4 | `Payment` | Payments made toward a card |
| 5 | `RecurringTransaction` | Scheduled/repeating spends |
| 6 | `Milestone` | Milestone tracks + cycle config |
| 7 | `MilestoneTier` | Reward tiers within a milestone |
| 8 | `FeeAndCharge` | Fees and charges per card |
| 9 | `Exclusion` | Categories excluded from rewards/milestones |
| 10 | `MonthlySnapshot` | Per-cycle aggregate snapshot for a card |
| 11 | `FamilyCapTracker` | Shared-cap tracking per family per FY |
| 12 | `CardTermsHistoryEntry` | Audit trail of detected term changes |
| 13 | `Category` | Canonical spend categories |

The top-level **`Database`** interface aggregates all 13 tabs as arrays:
`cards`, `rewardRules`, `transactions`, `payments`, `recurringTransactions`,
`milestones`, `milestoneTiers`, `feesAndCharges`, `exclusions`,
`monthlySnapshots`, `familyCapTracker`, `cardTermsHistory`, `categories`.

## Data-access function signatures

Functions live in `src/lib/data/`. The dev-phase implementation reads/writes the
local JSON file; the signatures below are the stable contract that will not change
when the backend swaps to Google Sheets.

### `src/lib/data/fileStore.ts` — low-level file access (internal)

The **only** module permitted to touch the database file path. Feature code must
not import this directly; it exists for the per-tab data modules to build on.

| Function | Signature | Notes |
|----------|-----------|-------|
| `readDatabase` | `() => Promise<Database>` | Reads and JSON-parses `/data/database.json`. |
| `writeDatabase` | `(db: Database) => Promise<void>` | Writes the whole object back, pretty-printed (2-space indent). |

### `src/lib/data/cards.ts` — Card tab

All functions go through `readDatabase`/`writeDatabase`; none touch the file path.

| Function | Signature | Behaviour |
|----------|-----------|-----------|
| `getCards` | `() => Promise<Card[]>` | Returns all cards. |
| `getCardById` | `(id: string) => Promise<Card \| null>` | Returns the matching card, or `null` if none. |
| `createCard` | `(card: Omit<Card, 'id'>) => Promise<Card>` | Generates an id via `crypto.randomUUID()`, persists, returns the created card. |
| `updateCard` | `(id: string, updates: Partial<Card>) => Promise<Card \| null>` | Applies a partial update (id is immutable), persists, returns the updated card; `null` if the id is not found. |

### `src/lib/data/rewardRules.ts` — RewardRule tab

All functions go through `readDatabase`/`writeDatabase`; none touch the file path.

| Function | Signature | Behaviour |
|----------|-----------|-----------|
| `getRewardRules` | `() => Promise<RewardRule[]>` | Returns all reward rules. |
| `getRewardRulesByCardId` | `(cardId: string) => Promise<RewardRule[]>` | Returns reward rules for that card; `[]` if none. |
| `createRewardRule` | `(r: Omit<RewardRule, 'id'>) => Promise<RewardRule>` | Generates an id via `crypto.randomUUID()`, persists, returns the created row. |
| `updateRewardRule` | `(id: string, updates: Partial<RewardRule>) => Promise<RewardRule \| null>` | Applies a partial update (id is immutable), persists, returns the updated row; `null` if the id is not found. |
| `deleteRewardRule` | `(id: string) => Promise<boolean>` | Removes the row, persists; returns `true` if deleted, `false` if the id is not found. |

### `src/lib/data/transactions.ts` — Transaction tab

All functions go through `readDatabase`/`writeDatabase`; none touch the file path.

| Function | Signature | Behaviour |
|----------|-----------|-----------|
| `getTransactions` | `() => Promise<Transaction[]>` | Returns all transactions. |
| `getTransactionsByCardId` | `(cardId: string) => Promise<Transaction[]>` | Returns transactions for that card; `[]` if none. |
| `createTransaction` | `(txn: Omit<Transaction, 'id'>) => Promise<Transaction>` | Generates an id via `crypto.randomUUID()`, persists, returns the created transaction. |
| `updateTransaction` | `(id: string, updates: Partial<Transaction>) => Promise<Transaction \| null>` | Applies a partial update (id is immutable), persists, returns the updated transaction; `null` if the id is not found. |
| `deleteTransaction` | `(id: string) => Promise<boolean>` | Removes the transaction, persists; returns `true` if deleted, `false` if the id is not found. |

### `src/lib/data/payments.ts` — Payment tab

All functions go through `readDatabase`/`writeDatabase`; none touch the file path.
Payments are append-or-delete only — there is intentionally **no** update function
(a payment is logged correctly or deleted and re-logged).

| Function | Signature | Behaviour |
|----------|-----------|-----------|
| `getPayments` | `() => Promise<Payment[]>` | Returns all payments. |
| `getPaymentsByCardId` | `(cardId: string) => Promise<Payment[]>` | Returns payments for that card; `[]` if none. |
| `createPayment` | `(payment: Omit<Payment, 'id'>) => Promise<Payment>` | Generates an id via `crypto.randomUUID()`, persists, returns the created payment. |
| `deletePayment` | `(id: string) => Promise<boolean>` | Removes the payment, persists; returns `true` if deleted, `false` if the id is not found. |

### `src/lib/data/recurringTransactions.ts` — RecurringTransaction tab

All functions go through `readDatabase`/`writeDatabase`; none touch the file path.

| Function | Signature | Behaviour |
|----------|-----------|-----------|
| `getRecurringTransactions` | `() => Promise<RecurringTransaction[]>` | Returns all recurring transactions. |
| `getActiveRecurringTransactions` | `() => Promise<RecurringTransaction[]>` | Returns only rows where `active === true` AND (`end_date` is null OR `end_date >= today`). ISO date strings compared lexicographically; end_date inclusive. |
| `createRecurringTransaction` | `(rt: Omit<RecurringTransaction, 'id'>) => Promise<RecurringTransaction>` | Generates an id via `crypto.randomUUID()`, persists, returns the created row. |
| `updateRecurringTransaction` | `(id: string, updates: Partial<RecurringTransaction>) => Promise<RecurringTransaction \| null>` | Applies a partial update (id is immutable), persists, returns the updated row; `null` if the id is not found. |

### `src/lib/data/milestones.ts` — Milestone tab

All functions go through `readDatabase`/`writeDatabase`; none touch the file path.

| Function | Signature | Behaviour |
|----------|-----------|-----------|
| `getMilestones` | `() => Promise<Milestone[]>` | Returns all milestones. |
| `getMilestonesByCardId` | `(cardId: string) => Promise<Milestone[]>` | Returns milestones for that card; `[]` if none. |
| `getActiveMilestones` | `() => Promise<Milestone[]>` | Returns only rows where `active === true`. |
| `createMilestone` | `(m: Omit<Milestone, 'id'>) => Promise<Milestone>` | Generates an id via `crypto.randomUUID()`, persists, returns the created milestone. |
| `updateMilestone` | `(id: string, updates: Partial<Milestone>) => Promise<Milestone \| null>` | Applies a partial update (id is immutable), persists, returns the updated milestone; `null` if the id is not found. |

### `src/lib/data/milestoneTiers.ts` — MilestoneTier tab

All functions go through `readDatabase`/`writeDatabase`; none touch the file path.

| Function | Signature | Behaviour |
|----------|-----------|-----------|
| `getMilestoneTiers` | `() => Promise<MilestoneTier[]>` | Returns all milestone tiers. |
| `getTiersByMilestoneId` | `(milestoneId: string) => Promise<MilestoneTier[]>` | Returns tiers for that milestone; `[]` if none. |
| `createMilestoneTier` | `(t: Omit<MilestoneTier, 'id'>) => Promise<MilestoneTier>` | Generates an id via `crypto.randomUUID()`, persists, returns the created tier. |
| `updateMilestoneTier` | `(id: string, updates: Partial<MilestoneTier>) => Promise<MilestoneTier \| null>` | Applies a partial update (id is immutable), persists, returns the updated tier; `null` if the id is not found. |

### `src/lib/data/feesAndCharges.ts` — FeeAndCharge tab

All functions go through `readDatabase`/`writeDatabase`; none touch the file path.

| Function | Signature | Behaviour |
|----------|-----------|-----------|
| `getFeesAndCharges` | `() => Promise<FeeAndCharge[]>` | Returns all fees and charges. |
| `getFeesByCardId` | `(cardId: string) => Promise<FeeAndCharge[]>` | Returns fees/charges for that card; `[]` if none. |
| `createFeeAndCharge` | `(f: Omit<FeeAndCharge, 'id'>) => Promise<FeeAndCharge>` | Generates an id via `crypto.randomUUID()`, persists, returns the created row. |
| `updateFeeAndCharge` | `(id: string, updates: Partial<FeeAndCharge>) => Promise<FeeAndCharge \| null>` | Applies a partial update (id is immutable), persists, returns the updated row; `null` if the id is not found. |
| `deleteFeeAndCharge` | `(id: string) => Promise<boolean>` | Removes the row, persists; returns `true` if deleted, `false` if the id is not found. |

### `src/lib/data/exclusions.ts` — Exclusion tab

All functions go through `readDatabase`/`writeDatabase`; none touch the file path.

| Function | Signature | Behaviour |
|----------|-----------|-----------|
| `getExclusions` | `() => Promise<Exclusion[]>` | Returns all exclusions. |
| `getExclusionsByCardId` | `(cardId: string) => Promise<Exclusion[]>` | Returns exclusions for that card; `[]` if none. |
| `createExclusion` | `(e: Omit<Exclusion, 'id'>) => Promise<Exclusion>` | Generates an id via `crypto.randomUUID()`, persists, returns the created row. |
| `deleteExclusion` | `(id: string) => Promise<boolean>` | Removes the row, persists; returns `true` if deleted, `false` if the id is not found. No update function by design — an exclusion is added or removed. |

### `src/lib/data/monthlySnapshots.ts` — MonthlySnapshot tab

All functions go through `readDatabase`/`writeDatabase`; none touch the file path.

| Function | Signature | Behaviour |
|----------|-----------|-----------|
| `getMonthlySnapshots` | `() => Promise<MonthlySnapshot[]>` | Returns all snapshots. |
| `getSnapshotsByCardId` | `(cardId: string) => Promise<MonthlySnapshot[]>` | Returns snapshots for that card; `[]` if none. |
| `getLatestSnapshotForCard` | `(cardId: string) => Promise<MonthlySnapshot \| null>` | Returns the card's snapshot with the most recent `cycle_end_date` (ISO strings compared lexicographically); `null` if the card has none. |
| `createMonthlySnapshot` | `(s: Omit<MonthlySnapshot, 'id'>) => Promise<MonthlySnapshot>` | Generates an id via `crypto.randomUUID()`, persists, returns the created row. |
| `updateMonthlySnapshot` | `(id: string, updates: Partial<MonthlySnapshot>) => Promise<MonthlySnapshot \| null>` | Applies a partial update (id is immutable), persists, returns the updated row; `null` if the id is not found. |

### `src/lib/data/familyCapTracker.ts` — FamilyCapTracker tab

All functions go through `readDatabase`/`writeDatabase`; none touch the file path.

**Structurally different from every other tab:** `FamilyCapTracker` has **no single `id` field**. Its primary key is the **composite of `family_key` + `financial_year`**. There is therefore no `randomUUID()` and no create/update pair — a single `upsert` keys on that pair.

| Function | Signature | Behaviour |
|----------|-----------|-----------|
| `getFamilyCapTrackers` | `() => Promise<FamilyCapTracker[]>` | Returns all rows. |
| `getFamilyCapTracker` | `(familyKey: string, financialYear: string) => Promise<FamilyCapTracker \| null>` | Returns the single row matching the composite key, or `null`. |
| `upsertFamilyCapTracker` | `(entry: FamilyCapTracker) => Promise<FamilyCapTracker>` | If a row with the same `family_key` + `financial_year` exists, replaces it in place (no duplicate); otherwise appends. Persists and returns the stored entry. |

### `src/lib/data/cardTermsHistory.ts` — CardTermsHistory tab

All functions go through `readDatabase`/`writeDatabase`; none touch the file path.

| Function | Signature | Behaviour |
|----------|-----------|-----------|
| `getCardTermsHistory` | `() => Promise<CardTermsHistoryEntry[]>` | Returns all entries. |
| `getTermsHistoryByCardId` | `(cardId: string) => Promise<CardTermsHistoryEntry[]>` | Returns entries for that card; `[]` if none. |
| `getPendingTermsHistory` | `() => Promise<CardTermsHistoryEntry[]>` | Returns only entries where `confirmed === false`. |
| `createTermsHistoryEntry` | `(e: Omit<CardTermsHistoryEntry, 'id'>) => Promise<CardTermsHistoryEntry>` | Generates an id via `crypto.randomUUID()`, persists, returns the created row. |
| `confirmTermsHistoryEntry` | `(id: string) => Promise<CardTermsHistoryEntry \| null>` | Sets `confirmed = true` (id immutable), persists, returns the updated row; `null` if the id is not found. |

### `src/lib/data/categories.ts` — Category tab

All functions go through `readDatabase`/`writeDatabase`; none touch the file path.

`Category` has **no `id` field** — its identity is its `name`. `addCategory` is therefore idempotent.

| Function | Signature | Behaviour |
|----------|-----------|-----------|
| `getCategories` | `() => Promise<Category[]>` | Returns all categories. |
| `addCategory` | `(name: string) => Promise<Category>` | If a category with the same `name` already exists (case-insensitive), returns the existing row without adding a duplicate; otherwise persists and returns the new category. |

## Calculations (business logic)

Business logic that derives values from the data lives in `src/lib/calculations/`,
**separate from the CRUD layer above**. These functions are pure — they take data
in and return computed results; they never read or write the database (see
`src/lib/CLAUDE.md` rule 2). API routes import them rather than recomputing inline.

### `src/lib/calculations/milestoneCycles.ts` — milestone cycle dates

All date math is done in **UTC** (ISO `YYYY-MM-DD` strings parsed as UTC midnight;
the `today` argument read via its UTC fields), so results never shift with the
server's local timezone. Output boundaries are inclusive `YYYY-MM-DD` strings.

| Function | Signature | Behaviour |
|----------|-----------|-----------|
| `calculateCurrentCycle` | `(milestone: Milestone, today: Date) => { cycleStartDate: string; cycleEndDate: string }` | Computes the milestone's current cycle window for `today`. See rules below. |

Cycle rules:
- **`cycle_frequency: "custom"`** (either anchor) — returns the milestone's stored `cycle_start_date`/`cycle_end_date` unchanged; custom cycles are author-defined and never auto-computed.
- **`cycle_anchor: "calendar"`** — `monthly`: 1st→last day of the current month; `quarterly`: standard calendar quarters (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec) containing `today`; `annual`: Jan 1→Dec 31 of the current year.
- **`cycle_anchor: "anniversary"`** — cycles step from `anchor_reference_date` (the card's issuance date) in 1/3/12-month increments for monthly/quarterly/annual. The start is the most recent `anchor + k*step` on or before `today`; the end is one day before `anchor + (k+1)*step`. `k*step` is always measured from the original anchor, so a Feb-29 anchor recovers Feb 29 in future leap years. Throws if `anchor_reference_date` is `null`.
- **Leap-year / short-month policy** — an anchor day that doesn't exist in the target month clamps *back* to that month's last day (Feb 29 → Feb 28 in non-leap years; Jan 31 → Feb 28/29). Consequence: a cycle starting on a leap day (e.g. 2028-02-29) can end on Feb 27 of a non-leap year, because the next anniversary clamps to Feb 28 and the end is one day before it.

### Status

**All 13 tabs now have complete data-access layers** documented above (cards,
rewardRules, transactions, payments, recurringTransactions, milestones,
milestoneTiers, feesAndCharges, exclusions, monthlySnapshots, familyCapTracker,
cardTermsHistory, categories). This finishes the core data-layer portion of Phase 1.

The next pending data-layer work is in later phases: the `calculations/` modules
(reward/FY math) build on top of these CRUD functions, and the JSON→Sheets backend
swap will touch only `fileStore.ts`.
