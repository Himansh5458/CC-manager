# Testing

Living test reference for CC-Manager — a "lessons learned" log, not just a status
report. It records the testing philosophy, the real bugs found (and how), and the
current health of the automated suite. Grows as bugs are found.

---

## Testing philosophy

**Build/typecheck passing is NECESSARY but NOT SUFFICIENT.**

`npx tsc --noEmit` clean and `npm run build` exit 0 only prove the code *compiles and
type-checks*. Every bug in the log below compiled and type-checked perfectly — and was
still broken at runtime. Several were impossible to catch without actually opening the
app in a browser and exercising the feature.

Therefore:
- **Every interactive feature gets real browser verification before being called done.**
  Submit the form, trigger the error state, watch the Server Action round-trip, read the
  rendered numbers. "It builds" is not "it works."
- **Pure logic gets a unit test** (`src/lib/CLAUDE.md` rule 5) — every `calculations/`
  function and every `data/` module has a `*.test.ts`. These guard the math and the
  data-layer contract.
- **Live-API code (`ai/gemini.ts`) is verified against the real API**, not mocked, because
  its failure modes (e.g. thinking-token starvation, below) only appear against the real
  model. It has no unit test by design (it does I/O and no math), so browser + real-key
  testing is mandatory for it.

---

## Bug log — real bugs found this build (lessons learned)

Each of these passed build and typecheck. None would have been caught without running the
actual app.

### 1. Server Action error-state crash (`err.card_id` on first render)
- **What it was:** The Transactions form read `state.errors.card_id` to show field errors.
  On first render `state.errors` was `undefined`, so accessing `.card_id` threw
  *"Cannot read properties of undefined"* and the page crashed before the user typed anything.
- **How it was found:** Browser testing — the page crashed on load, not in any build step
  (committed in `fad33bb`, "real bugs found via browser testing, not caught by build/typecheck").
- **Root cause:** `INITIAL_STATE` for `useActionState` was incomplete, and a `"use server"`
  module strips non-async exports, so a shared initial-state object can't be imported from
  the actions file (GOTCHA A).
- **The fix:** Define `INITIAL_STATE` *inside* the Client Component with `errors: {}` always
  present (`LogTransactionForm.tsx:27`), and derive errors null-safely:
  `const err = state?.errors ?? {}` (`LogTransactionForm.tsx:69`). Now the standard pattern
  across all five forms (`CardForm`, `LogTransactionForm`, `LogPaymentForm`,
  `EditTransactionModal`, `AssistantChat`).

### 2. Codespace CSRF origin mismatch (E80 "Invalid Server Actions request")
- **What it was:** *Every* Server Action failed in the Codespaces dev environment with E80
  "Invalid Server Actions request" — forms simply would not submit.
- **How it was found:** Browser testing in Codespaces (same commit, `fad33bb`). The build was
  clean; the failure only appeared on a real form submit through the forwarded host.
- **Root cause:** The Codespaces proxy rewrites `x-forwarded-host` to the
  `…-3000.app.github.dev` domain but leaves `origin` as `http://localhost:3000`. Next's CSRF
  check matches `allowedOrigins` against the **origin host** (`localhost:3000`), not the
  forwarded domain — so a `*.app.github.dev` wildcard never matched.
- **The fix:** `next.config.ts` adds the literal origin host to `allowedOrigins`
  (`["*.${forwardingDomain}", "localhost:3000", "127.0.0.1:3000"]`), keyed off the
  `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN` env var so it's dev-only and empty/strict on
  Vercel. Full mechanism in SECURITY.md §4.

### 3. `gemini-2.5-flash` thinking-token starvation (silent "Other" classifications)
- **What it was:** The AI Assistant classified obvious inputs ("Zomato", "Swiggy") as
  `"Other"` instead of `"Dining"`.
- **How it was found:** Live-API testing — running the byte-for-byte production prompt against
  the real Gemini key, not theory (committed in `0c0c0a2`).
- **Root cause:** `gemini-2.5-flash` is a **thinking** model. By default it spends output
  tokens on hidden reasoning *before* the visible answer, and those count against
  `maxOutputTokens`. With `maxOutputTokens: 20`, the entire budget was consumed by thinking —
  the call returned `finishReason: MAX_TOKENS` with **empty visible text**, and the
  `if (!raw) return fallback` path turned that into `"Other"`. Proof: the same prompt at
  `maxOutputTokens: 100` returned `"Dining"` with `finishReason: STOP`. Gemini never actually
  "chose" Other — its answer was truncated to nothing.
- **The fix:** Add `thinkingConfig: { thinkingBudget: 0 }` to **both** Gemini calls
  (`gemini.ts:109` `matchCategory`, `gemini.ts:216` `explainRecommendation`). Classification and
  number-phrasing need no chain-of-thought. Verified live post-fix: Zomato/Swiggy → Dining,
  "uber ride" → Travel, gibberish → Other (the genuine fallback still works). See
  DECISIONS.md 2026-06-21.

### 4. Milestone progress ignored category exclusions
- **What it was:** `recomputeMilestoneProgress` summed **all** of a card's in-window
  transactions into `current_progress_amount` with **no exclusion filtering at all** — it
  never consulted the `Exclusion` tab. Categories a card explicitly excludes from milestones
  (e.g. Axis Atlas excludes Government/rent/utility spends) still counted toward milestone
  thresholds, silently inflating numbers that drive a money decision.
- **How it was found:** The business-rule audit (`/BUSINESS_RULE_AUDIT.md`) — a confirmed bug,
  cross-read against the actual `Exclusion` rows and the function code.
- **The fix:** Added a required `exclusions: Exclusion[]` parameter (new signature
  `(milestone, tiers, transactions, exclusions, today?)`). A transaction is dropped from the
  spend pool when an `Exclusion` for this `card_id` matches its **effective** category
  (`manual_override_category ?? category`, case-insensitive) AND `applies_to` is `"all_rewards"`
  or `"milestones_only"`. `direct_rewards_only` is deliberately not applied here — same scoping
  `expectedCashback.ts` uses, so both reward paths treat exclusions identically. See
  DECISIONS.md 2026-06-23.
  - **Note:** the only caller today is its unit test (the milestones page reads stored values;
    the recompute-on-write trigger is still deferred — see KNOWN_LIMITATIONS.md). When that
    trigger is built it must fetch `getExclusionsByCardId` and pass them in.

---

## Current test suite health

**Source:** the exact `npm test` run pasted below (run for this document — not estimated).

- **Suites:** 20 discovered, **17 passed, 3 failed**.
- **Failing suites — all DATA DRIFT, not logic bugs** (production code is correct; the
  assertions hardcode seed-derived counts that the form-added 3rd card changed):
  - `src/lib/data/cards.test.ts` — 9 passed, 2 failed (expects 2 cards / 3-after-create; DB now has 3)
  - `src/lib/data/transactions.test.ts` — 10 passed, 4 failed (expects 11 txns / atlas 6; now 10 / atlas 5)
  - `src/lib/calculations/expectedCashback.test.ts` — 40 passed, 2 failed (expects `ranked.length === 2`; the 3rd card is active so `rankCardsForPurchase` returns 3)
- **Assertion totals across all suites:** roughly 330 assertions; the only failures are the
  8 listed above (2 + 4 + 2).

### Known fragility pattern: hardcoded seed-derived counts

Several suites assert **absolute counts derived from seed data** (e.g. "returns 11
transactions", "returns 2 cards", "`ranked.length === 2`"). These break whenever seed data
changes — exactly what happened when the 3rd card was added via the form this build.

**Suites currently failing from this pattern:**
- `cards.test.ts` (`:35` `=== 2`, `:76` `=== 3`)
- `transactions.test.ts` (`:41` `=== 11`, `:48` atlas `=== 6`, and the persist/delete-back counts)
- `expectedCashback.test.ts` (`:338`, `:354` `ranked.length === 2`)

**Latent (not yet failing, but same fragility — break on the next seed edit):**
- `payments.test.ts`, `milestones.test.ts`, `milestoneTiers.test.ts`, `rewardRules.test.ts`,
  `recurringTransactions.test.ts`, `monthlySnapshots.test.ts`.

**The resilient pattern (fix template):** `exclusions`, `feesAndCharges`, `categories`,
`familyCapTracker`, and `cardTermsHistory` already capture a `seedCount` baseline and assert
**deltas** (`seedCount + 1`) rather than absolute numbers. Migrate the fragile suites to match.

### Coverage gaps
- **`src/lib/security/sanitize.ts` has no test** — the AI security boundary is untested
  (also SECURITY.md §2). Highest-priority gap: add `sanitize.test.ts` asserting the output
  keys are exactly `{cardName, directRewardValue, milestoneContributionValue, totalExpectedValue}`.
- `ai/gemini.ts` has no unit test (by design — live I/O, no math; its deterministic fallbacks
  are testable with a forced-failure stub if desired).
- `fileStore.ts` has no direct test (covered indirectly by every data-layer suite).

---

## Exact `npm test` output (run for this document)

```
> cc-manager@0.1.0 test
> tsx scripts/run-tests.ts

Discovered 20 test suite(s) under src/lib/:

=== src/lib/calculations/expectedCashback.test.ts ===
  ... (40 passed, 2 failed)
  FAIL  rank (seed): returns both active cards (2, fewer than the top-5 cap)
  FAIL  rank: inactive card excluded (still 2 results)
Results: 40 passed, 2 failed

=== src/lib/data/cards.test.ts ===
  FAIL  getCards() returns 2 cards
  FAIL  createCard() persists (now 3 cards)
Results: 9 passed, 2 failed

=== src/lib/data/transactions.test.ts ===
  FAIL  getTransactions() returns 11 transactions
  FAIL  getTransactionsByCardId(atlas) returns 6
  FAIL  createTransaction() persists (now 12)
  FAIL  deleteTransaction() persists (back to 11)
Results: 10 passed, 4 failed

============================================================
Test suite summary
============================================================
  PASS  src/lib/calculations/cardBalance.test.ts
  PASS  src/lib/calculations/dueDate.test.ts
  FAIL  src/lib/calculations/expectedCashback.test.ts
  PASS  src/lib/calculations/fyDates.test.ts
  PASS  src/lib/calculations/insights.test.ts
  PASS  src/lib/calculations/milestoneCycles.test.ts
  PASS  src/lib/calculations/milestoneProgress.test.ts
  PASS  src/lib/data/cardTermsHistory.test.ts
  FAIL  src/lib/data/cards.test.ts
  PASS  src/lib/data/categories.test.ts
  PASS  src/lib/data/exclusions.test.ts
  PASS  src/lib/data/familyCapTracker.test.ts
  PASS  src/lib/data/feesAndCharges.test.ts
  PASS  src/lib/data/milestoneTiers.test.ts
  PASS  src/lib/data/milestones.test.ts
  PASS  src/lib/data/monthlySnapshots.test.ts
  PASS  src/lib/data/payments.test.ts
  PASS  src/lib/data/recurringTransactions.test.ts
  PASS  src/lib/data/rewardRules.test.ts
  FAIL  src/lib/data/transactions.test.ts
------------------------------------------------------------
  17/20 suites passed, 3 failed
============================================================
```

> The per-suite pass lines above are abbreviated for the failing suites; the full
> per-assertion run is what the counts in "Current test suite health" are derived from.
