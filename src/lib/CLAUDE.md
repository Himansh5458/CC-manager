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
- `data/rewardRules.ts` — RewardRule tab data access: `getRewardRules`, `getRewardRulesByCardId`, `createRewardRule`, `updateRewardRule`, `deleteRewardRule`. Goes through fileStore only; never touches the file path. CRUD only — reward/cashback math lives in `calculations/`, never here.
- `data/rewardRules.test.ts` — standalone smoke test for rewardRules.ts; snapshots/restores the JSON file.
- `data/transactions.ts` — Transaction tab data access: `getTransactions`, `getTransactionsByCardId`, `createTransaction`, `updateTransaction`, `deleteTransaction`. Goes through fileStore only; never touches the file path. Signatures in `/docs/data-layer-contract.md`.
- `data/transactions.test.ts` — standalone smoke test for transactions.ts; snapshots/restores the JSON file.
- `data/payments.ts` — Payment tab data access: `getPayments`, `getPaymentsByCardId`, `createPayment`, `deletePayment`. Append-or-delete only — no update function by design. Goes through fileStore only.
- `data/payments.test.ts` — standalone smoke test for payments.ts; snapshots/restores the JSON file.
- `data/recurringTransactions.ts` — RecurringTransaction tab data access: `getRecurringTransactions`, `getActiveRecurringTransactions` (filters `active===true` AND end_date null-or-future), `createRecurringTransaction`, `updateRecurringTransaction`. Goes through fileStore only.
- `data/recurringTransactions.test.ts` — standalone smoke test for recurringTransactions.ts; snapshots/restores the JSON file.
- `data/milestones.ts` — Milestone tab data access: `getMilestones`, `getMilestonesByCardId`, `getActiveMilestones` (filters `active===true`), `createMilestone`, `updateMilestone`. Goes through fileStore only. CRUD only — cycle-date math lives in `calculations/milestoneCycles.ts`, never here.
- `data/milestones.test.ts` — standalone smoke test for milestones.ts; snapshots/restores the JSON file.
- `data/milestoneTiers.ts` — MilestoneTier tab data access: `getMilestoneTiers`, `getTiersByMilestoneId`, `createMilestoneTier`, `updateMilestoneTier`. Goes through fileStore only.
- `data/milestoneTiers.test.ts` — standalone smoke test for milestoneTiers.ts; snapshots/restores the JSON file.
- `data/feesAndCharges.ts` — FeeAndCharge tab data access: `getFeesAndCharges`, `getFeesByCardId`, `createFeeAndCharge`, `updateFeeAndCharge`, `deleteFeeAndCharge`. Goes through fileStore only.
- `data/feesAndCharges.test.ts` — standalone smoke test for feesAndCharges.ts; snapshots/restores the JSON file.
- `data/exclusions.ts` — Exclusion tab data access: `getExclusions`, `getExclusionsByCardId`, `createExclusion`, `deleteExclusion`. Add-or-delete only — no update function by design. Goes through fileStore only.
- `data/exclusions.test.ts` — standalone smoke test for exclusions.ts; snapshots/restores the JSON file.
- `data/monthlySnapshots.ts` — MonthlySnapshot tab data access: `getMonthlySnapshots`, `getSnapshotsByCardId`, `getLatestSnapshotForCard` (most recent by `cycle_end_date`), `createMonthlySnapshot`, `updateMonthlySnapshot`. Goes through fileStore only.
- `data/monthlySnapshots.test.ts` — standalone smoke test for monthlySnapshots.ts; snapshots/restores the JSON file.
- `data/familyCapTracker.ts` — FamilyCapTracker tab data access: `getFamilyCapTrackers`, `getFamilyCapTracker`, `upsertFamilyCapTracker`. **Structurally unique: this tab has no `id` field — its primary key is the composite `family_key` + `financial_year`.** No `randomUUID()` and no create/update pair; a single `upsert` keys on that pair (replaces in place when the pair matches, appends otherwise). Goes through fileStore only.
- `data/familyCapTracker.test.ts` — standalone smoke test for familyCapTracker.ts; explicitly tests that upsert creates when no matching composite key exists and updates-in-place (no duplicate) when called again with the same `family_key`+`financial_year`. Snapshots/restores the JSON file.
- `data/cardTermsHistory.ts` — CardTermsHistory tab data access: `getCardTermsHistory`, `getTermsHistoryByCardId`, `getPendingTermsHistory` (`confirmed === false`), `createTermsHistoryEntry`, `confirmTermsHistoryEntry` (sets `confirmed = true`). Goes through fileStore only.
- `data/cardTermsHistory.test.ts` — standalone smoke test for cardTermsHistory.ts; snapshots/restores the JSON file.
- `data/categories.ts` — Category tab data access: `getCategories`, `addCategory`. **Category has no `id` — its identity is its `name`.** `addCategory` is idempotent: it will not add a duplicate when a same-name category already exists (case-insensitive), returning the existing row instead. Goes through fileStore only.
- `data/categories.test.ts` — standalone smoke test for categories.ts; explicitly tests duplicate-prevention (exact and case-variant). Snapshots/restores the JSON file.

## calculations/ — business logic (NOT data access)
`src/lib/calculations/` holds pure business logic that derives values from schema
data: it takes data in and returns computed results, and must **never** read or
write the database (that is the data/ layer's job — see rule 2). API routes import
these functions instead of recomputing inline. Every calculation function gets a
unit test (rule 5); the test runner auto-discovers `*.test.ts` here too.
- `calculations/milestoneCycles.ts` — `calculateCurrentCycle(milestone, today)` computes a milestone's current cycle window (`{ cycleStartDate, cycleEndDate }`). Handles calendar vs anniversary anchors, monthly/quarterly/annual stepping, `custom` pass-through, and leap-year/short-month clamping. **All date math is UTC** (ISO strings as UTC midnight, `today` read via UTC fields) to avoid timezone drift — documented at the top of the file. Pure: imports only the `Milestone` type, touches no file.
- `calculations/milestoneCycles.test.ts` — unit test for the cycle math (calendar quarters/annual, anniversary annual matching seed data, leap-year edge cases, custom pass-through). No DB I/O, so no snapshot/restore needed.
- `calculations/fyDates.ts` — Indian financial-year date math: `getFinancialYear` (Apr–Mar FY, "2026-27" naming), `getFinancialYearBounds`, `isDateInFinancialYear`. Same UTC date policy as milestoneCycles (documented at the top). Pure: imports nothing from the data layer, touches no file. The "2026-27" format matches `FamilyCapTracker.financial_year`.
- `calculations/fyDates.test.ts` — unit test for the FY utilities (a date in each part of an FY, the exact Apr 1 / Mar 31 boundaries, century-rollover formatting, and round-trip consistency between `getFinancialYear` and the bounds). No DB I/O.
- `calculations/cardBalance.ts` — current-cycle balance/utilization: `recomputeCardBalance(card, transactions, payments, today?)` sums spends minus payments dated on/after the card's most recent `statement_date` occurrence ≤ today (same "most recent anchor ≤ today" pattern as the anniversary cycle, one-month step, short-month clamp-back), and `getEffectiveUtilization` which returns `manual_override_utilization_pct` when non-null else the computed value ("manual override always wins"). Also exports `mostRecentStatementDate`. Pure: takes rows in, never reads/writes the DB. Same UTC date policy as milestoneCycles.
- `calculations/cardBalance.test.ts` — unit test reproducing the seed cards' balances (HDFC Millennia statement_date 5 → 8190/4.1%, Axis Atlas statement_date 18 → 33980/22.7%) for today=2026-06-21, plus statement-cycle edge inclusion/exclusion, short-month/year-boundary statement-date stepping, the credit_limit-0 guard, and the override (including an override of 0). No DB I/O.
- `calculations/milestoneProgress.ts` — `recomputeMilestoneProgress(milestone, tiers, transactions, today?)` recomputes a milestone's tiers for its current earning window: sums the card's in-window transactions into the shared `current_progress_amount` (written to every tier), then sets `achieved` per `tier_type` (`cumulative` = every crossed tier; `highest_only` = only the single highest crossed tier), with `manual_override_achieved` winning per tier (same "override wins" rule as `getEffectiveUtilization`). `achieved_date` is stamped `today` on first achievement, preserved while still achieved, and cleared when not achieved. The `earning_window_offset` look-back (-1 = previous cycle) is done by recomputing `calculateCurrentCycle` for the day before the current cycle's start, so it reuses that module's anchor/leap-year handling. Pure: returns new tier objects, never reads/writes the DB — the caller persists via `updateMilestoneTier`. Same UTC date policy as milestoneCycles. Imports `calculateCurrentCycle` from `milestoneCycles.ts`.
- `calculations/milestoneProgress.test.ts` — unit test against the seed milestones: Millennia quarterly (highest_only, 50k/100k/150k) at sums that cross tier 1, tier 1+2 (only tier 2 marked), and all three (only tier 3 marked); Atlas annual anniversary (cumulative) crossing tier 1+2 but not 3; manual override (true and false) affecting only its own tier; `achieved_date` set-on-first / not-overwritten / cleared-on-unachieve; input-not-mutated; a synthetic `earning_window_offset: -1` look-back proving the previous-cycle window is used (contrasted with offset 0); and foreign-tier pass-through. No DB I/O.

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
Phase 1 (in progress): seed `data/database.json` written (2 cards + related rows). fileStore + data-access layers for **all 13 tabs** done and tested — cards, rewardRules, transactions, payments, recurringTransactions, milestones, milestoneTiers, feesAndCharges, exclusions, monthlySnapshots, familyCapTracker, cardTermsHistory, categories — plus four `calculations/` modules (milestoneCycles, fyDates, cardBalance, milestoneProgress), each with its unit test (`npm test` auto-discovers and runs all suites; currently 17 suites, all passing). The core data-layer portion of Phase 1 is complete.

## Update this file
Whenever a new module is added to src/lib/, document its responsibility and what it must never do, here.
