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
- `calculations/dueDate.ts` — `daysUntilDue(card, today)` returns the whole number of days until a card's upcoming payment deadline (most recent `statement_date` occurrence ≤ today, via `mostRecentStatementDate`, plus `payment_deadline_days`), or `null` when that deadline has already passed (the caller decides the fallback presentation). Extracted from `src/app/cards/page.tsx` so the Cards list and the Dashboard share one source of truth. Same UTC date policy as the other calc modules; imports only `mostRecentStatementDate` from `cardBalance.ts`. Pure — never reads/writes the DB.
- `calculations/dueDate.test.ts` — unit test reproducing the seed cards' countdowns at 2026-06-21 (Millennia 4 days, Atlas 15 days), the exact-deadline-is-0-not-null boundary, a passed-deadline → null case, and a year-boundary statement step-back. No DB I/O.
- `calculations/milestoneProgress.ts` — `recomputeMilestoneProgress(milestone, tiers, transactions, today?)` recomputes a milestone's tiers for its current earning window: sums the card's in-window transactions into the shared `current_progress_amount` (written to every tier), then sets `achieved` per `tier_type` (`cumulative` = every crossed tier; `highest_only` = only the single highest crossed tier), with `manual_override_achieved` winning per tier (same "override wins" rule as `getEffectiveUtilization`). `achieved_date` is stamped `today` on first achievement, preserved while still achieved, and cleared when not achieved. The `earning_window_offset` look-back (-1 = previous cycle) is done by recomputing `calculateCurrentCycle` for the day before the current cycle's start, so it reuses that module's anchor/leap-year handling. Pure: returns new tier objects, never reads/writes the DB — the caller persists via `updateMilestoneTier`. Same UTC date policy as milestoneCycles. Imports `calculateCurrentCycle` from `milestoneCycles.ts`.
- `calculations/milestoneProgress.test.ts` — unit test against the seed milestones: Millennia quarterly (highest_only, 50k/100k/150k) at sums that cross tier 1, tier 1+2 (only tier 2 marked), and all three (only tier 3 marked); Atlas annual anniversary (cumulative) crossing tier 1+2 but not 3; manual override (true and false) affecting only its own tier; `achieved_date` set-on-first / not-overwritten / cleared-on-unachieve; input-not-mutated; a synthetic `earning_window_offset: -1` look-back proving the previous-cycle window is used (contrasted with offset 0); and foreign-tier pass-through. No DB I/O.
- `calculations/expectedCashback.ts` — `calculateExpectedCashback(card, amount, category, rewardRules, milestones, milestoneTiers, exclusions)` estimates a prospective purchase's value: a **direct** earn that branches on the rule's `rate_type` — `"percentage"` → `amount * (rate/100)` (redemption_value_per_unit **not** applied, the percent is already in rupees), `"per_100_spend"` → `(amount/100) * rate * redemption_value_per_unit` (a unit count needing conversion) — these are different mechanics, not two notations (see /DECISIONS.md 2026-06-21). Plus a **milestone-contribution** value summed over every active milestone's not-yet-achieved tiers (`reward_value * tier.redemption_value_per_unit / threshold * amount`; the tier carries its own redemption column — never inferred). Category match is case-insensitive with an `"Other"`-rule fallback. Exclusions on the card+category zero direct and/or milestone value per `applies_to`. `monthly_cap` is deliberately ignored (full headroom assumed). `rankCardsForPurchase(...)` filters to active cards, scores each, and returns the **top 5** sorted descending. Pure — never reads/writes the DB; the caller fetches rows via the data layer. Must never apply cap/history logic or read the file.
- `calculations/expectedCashback.test.ts` — unit test that (uniquely among the calc tests) reads the **committed seed read-only** so it also guards against seed drift: Millennia Dining 500 (percentage direct 25 + milestone 20.83), Atlas Travel 500 (per_100_spend direct 25 + milestone 10.83), an explicit **percentage-ignores-redemption** check (5% with redemption 99 still = 50) and a **percentage ≠ per_100_spend** check (same rate 5 + redemption 4 → 50 vs 200), `"Other"`-rule fallback, a synthetic `cashback`/percentage rule, all three exclusion scopes (synthetic `direct_rewards_only`/`milestones_only`/`all_rewards` + the real Atlas `Government` milestones_only seed row), already-achieved and `manual_override_achieved` tiers dropping out of the sum, and `rankCardsForPurchase` ordering / inactive-card filtering / top-5 cap (7 synthetic cards). Read-only, so no snapshot/restore.
- `calculations/insights.ts` — forward-looking dashboard guidance, three pure functions: `predictNextBill` (Σ active recurring charges + average non-recurring spend over the available completed statement cycles; recurring instances are matched by card+category+amount and excluded from the average so they aren't double-counted; honest about limited/zero history in both the number and the `breakdown` string), `detectSpendAnomalies` (current statement-cycle spend per category vs that category's prior-cycle average; returns only categories ≥30% above a **non-zero** average, so first-time categories are never flagged), and `getMilestoneProximityNudges` (next unachieved tier of each active milestone — `manual_override_achieved` wins — returned only when `amountRemaining` is positive and ≤50% of the tier threshold, a documented "is the nudge actually reachable" cutoff). **Reuses `cardBalance.mostRecentStatementDate`** for every statement-cycle boundary rather than reimplementing it; only the *completed* cycles before the current open one are averaged, and only cycles within the card's transaction-history span count (a cycle before the earliest txn is "no data", not "₹0"). Pure: takes rows in, never reads/writes the DB. Same UTC date policy as the other calc modules.
- `calculations/insights.test.ts` — unit test mixing committed-seed read-only cases with in-memory fixtures: `predictNextBill` on the real seed (recurring-only at 2026-06-21 since all seed txns are in the open cycle; the June spends becoming a 3-cycle average of 2730 at 2026-09-21), plus synthetic 1-cycle "limited history" honesty and a recurring-instance dedup case (₹500 recurring not double-counted); `detectSpendAnomalies` on a constructed scenario (Dining +400% flagged, Groceries +5% not, first-time Travel excluded, exact +30% boundary inclusive, seed→[] with no baseline); `getMilestoneProximityNudges` on seed (both tracks too far → []) plus synthetic close/achieved/override-true/override-false/too-far/inactive/non-positive-remaining cases. Read-only seed access, so no snapshot/restore.

## security/ — outbound-payload boundary (NOT data access)
`src/lib/security/` holds the hard boundaries from rule 3 / rule 4. Pure mappers;
no DB I/O.
- `security/sanitize.ts` — the **single** place any payload bound for an external AI
  service (Gemini) is built (rule 3). `sanitizeRankedForAI(results, cardNameById)`
  takes the raw `ExpectedCashback[]` (which carry only internal card ids) plus a
  server-side id→name lookup and emits the **whitelisted** `AIRankedResult` shape:
  card NAME + the three computed rupee figures, and **nothing else** — no UUID, no
  encrypted number/last-4, no phone/email/balance, not even the internal `breakdown`
  string. Whitelist, never blacklist, so a future sensitive schema field can't start
  leaking by omission. Any new AI feature adds one mapper here rather than handing a
  third party raw rows. (AES-256-GCM `encryption.ts` — rule 4 — is still to be added
  here when card-number encryption lands.)

## ai/ — external AI service wrappers (NOT data access, NOT math)
`src/lib/ai/` is the only place that talks to an LLM. **Design law: the LLM NEVER does
arithmetic** — `calculations/expectedCashback.ts` does 100% of the reward math
deterministically; the model only classifies and phrases.
- `ai/gemini.ts` — the sole module that calls the Gemini API (`@google/genai` v2.9.0,
  the current GA SDK — the older `@google/generative-ai` is legacy/deprecated). Two
  best-effort functions, each degrading to a SAFE deterministic fallback on ANY failure
  (missing key, network, rate limit, malformed reply) so the feature works even with
  Gemini down: `matchCategory(desc, availableCategories)` maps free text to one of OUR
  exact category names (re-validated against the list; falls back to `"Other"`), and
  `explainRecommendation(desc, category, ranked)` phrases an **already-computed**
  ranked result in 2–4 sentences (prompt forbids the model from recomputing; falls back
  to a template string built from the same numbers). It receives only the sanitized
  `AIRankedResult[]` (via `security/sanitize.ts`) — never raw rows or ids. The model id
  is a single constant `GEMINI_MODEL` (currently `"gemini-2.5-flash"`, a current
  free-tier Flash model; kept as a one-line swap; see /DECISIONS.md). The
  key is read lazily from `process.env.GEMINI_API_KEY` and throws a clear error only at
  call time (not module load), so `next build` never needs the key. **No unit test**
  (it does I/O against a live API, and contains no math to verify — the deterministic
  math it phrases is covered by `expectedCashback.test.ts`); requires real
  browser + API-key testing.

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
Phase 1 (in progress): seed `data/database.json` written (2 cards + related rows). fileStore + data-access layers for **all 13 tabs** done and tested — cards, rewardRules, transactions, payments, recurringTransactions, milestones, milestoneTiers, feesAndCharges, exclusions, monthlySnapshots, familyCapTracker, cardTermsHistory, categories — plus six `calculations/` modules (milestoneCycles, fyDates, cardBalance, milestoneProgress, expectedCashback, insights), each with its unit test (`npm test` auto-discovers and runs all suites; currently 20 suites, all passing). The core data-layer portion of Phase 1 is complete. Phase 4 added the AI Assistant backend: `security/sanitize.ts` (the AI-payload boundary) and `ai/gemini.ts` (Gemini wrapper) — see those sections above.

## Deferred work
Known work intentionally not done yet — listed so a future session implements it
on purpose rather than rediscovering the gap.
- **Recompute-on-write trigger** (deferred 2026-06-21). A recompute-on-write
  trigger for **milestone progress** (`recomputeMilestoneProgress`), **card
  balance/utilization** (`recomputeCardBalance`), and the **family cap tracker**
  needs to be added to the `createTransaction` and `createPayment` Server Actions
  (or to the data-access functions themselves). **Currently these write raw data
  only — downstream computed/cached fields are NOT automatically refreshed**, so
  stored figures (tier `current_progress_amount`/`achieved`, card
  `current_outstanding_balance`/`current_utilization_pct`, FamilyCapTracker
  totals) lag until something explicitly recomputes and saves them. UI pages now
  read these stored values rather than recomputing on read (database as readable
  ledger of computed truth; also avoids per-read Google Sheets API quota cost).
  See `/KNOWN_LIMITATIONS.md` (2026-06-21) for the full reasoning.

## Update this file
Whenever a new module is added to src/lib/, document its responsibility and what it must never do, here.
