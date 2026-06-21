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

### Pending (later phases)

Equivalent data-access modules for the remaining 9 tabs (rewardRules, milestones,
milestoneTiers, feesAndCharges, exclusions, monthlySnapshots, familyCapTracker,
cardTermsHistory, categories).
