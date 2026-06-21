# Backend / Data Layer Context (src/lib)

## Scope
Everything under `src/lib/` — the data-access layer, business logic (reward calculations, milestone math, FY date logic), and anything API routes in `src/app/api/` call into. This is the "backend" half of the project.

## Rules
1. **Single data-access layer.** All reads/writes to the database (currently local JSON at `/data/database.json`, later Google Sheets) go through functions defined in `src/lib/data/`. Exact function signatures are documented in `/docs/data-layer-contract.md` — this contract must stay in sync with actual code.
2. **No business logic duplicated across routes.** Reward/milestone/cap calculations live in `src/lib/calculations/`, imported wherever needed, never recomputed inline in an API route.
3. **Sensitive field boundary.** Any function that builds a payload for the AI assistant (Gemini) or any export feature MUST go through a single explicit "sanitize" function (`src/lib/security/sanitize.ts`, to be created) that strips encrypted/sensitive fields. This is a hard security boundary — see /SECURITY.md.
4. **Encryption isolated to one module.** AES-256-GCM encrypt/decrypt logic lives only in `src/lib/security/encryption.ts`. No other file touches the raw encryption key.
5. **Every calculation function gets a unit test** before being considered done — especially FY date math, milestone tier math, and the expected-cashback formula. See /TESTING.md.

## Modules in src/lib/
- `types/schema.ts` — the 13-tab schema interfaces + top-level `Database`. Field names mirror the eventual Sheets columns; do not rename casually.
- `data/fileStore.ts` — low-level file access. **The only file allowed to touch `/data/database.json`'s path.** Exposes `readDatabase()` / `writeDatabase(db)`. Feature code must not import this directly; per-tab modules build on it. This is the single seam for the future JSON→Sheets swap.
- `data/cards.ts` — Card tab data access: `getCards`, `getCardById`, `createCard`, `updateCard`. Goes through fileStore only; never touches the file path. Signatures documented in `/docs/data-layer-contract.md`.
- `data/cards.test.ts` — standalone smoke test for cards.ts (run `npm test` / `npx tsx`). Snapshots and restores the JSON file so it never mutates committed seed data.
- `data/transactions.ts` — Transaction tab data access: `getTransactions`, `getTransactionsByCardId`, `createTransaction`, `updateTransaction`, `deleteTransaction`. Goes through fileStore only; never touches the file path. Signatures in `/docs/data-layer-contract.md`.
- `data/transactions.test.ts` — standalone smoke test for transactions.ts; snapshots/restores the JSON file.
- `data/payments.ts` — Payment tab data access: `getPayments`, `getPaymentsByCardId`, `createPayment`, `deletePayment`. Append-or-delete only — no update function by design. Goes through fileStore only.
- `data/payments.test.ts` — standalone smoke test for payments.ts; snapshots/restores the JSON file.
- `data/recurringTransactions.ts` — RecurringTransaction tab data access: `getRecurringTransactions`, `getActiveRecurringTransactions` (filters `active===true` AND end_date null-or-future), `createRecurringTransaction`, `updateRecurringTransaction`. Goes through fileStore only.
- `data/recurringTransactions.test.ts` — standalone smoke test for recurringTransactions.ts; snapshots/restores the JSON file.

## How `npm test` works
`npm test` runs `scripts/run-tests.ts`, which **auto-discovers** every `*.test.ts`
file under `src/lib/` (recursively), runs each in its own `tsx` subprocess, and
prints a per-suite pass/fail summary table at the end. It is **not** fail-fast:
all suites always run even if an earlier one fails, and the process exits non-zero
only if at least one suite failed (CI-friendly). **To add a new test suite, just
create a `*.test.ts` file under `src/lib/` — do not edit `package.json` or the
runner; it is found automatically.** Each suite must snapshot/restore
`data/database.json` itself (see the existing tests for the pattern).

## Current state
Phase 1 (in progress): seed `data/database.json` written (2 cards + related rows). fileStore + data-access layers for cards, transactions, payments, and recurringTransactions done and tested (`npm test` auto-discovers and runs all suites). Data-access modules for the other 9 tabs (rewardRules, milestones, milestoneTiers, feesAndCharges, exclusions, monthlySnapshots, familyCapTracker, cardTermsHistory, categories) still pending.

## Update this file
Whenever a new module is added to src/lib/, document its responsibility and what it must never do, here.
