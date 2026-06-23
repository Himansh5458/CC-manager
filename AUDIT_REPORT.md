# CC-Manager — Comprehensive Application Audit

**Date:** 2026-06-23 · **Scope:** entire application, evidence-based, read-only (nothing was fixed).
**Method:** every finding below was verified by reading the actual code, running the actual
test/build commands, and re-deriving the actual numbers against the **current** `data/database.json`
— not assumed. Where a section found zero issues, that is stated explicitly with what was checked.

**Build/test state at audit time:** `npx tsc --noEmit` clean (exit 0); `npm run build` succeeds (exit 0);
`npm test` = **17/20 suites pass, 3 fail** (cards, transactions, expectedCashback — all data-drift, not logic).

---

## Section 1 — Data layer integrity (`src/lib/data/`, `src/lib/types/`)

Verified all 13 tab modules + `fileStore.ts` + `schema.ts` + `docs/data-layer-contract.md`.

| Issue | Location | Severity | Evidence | Suggested Fix |
|---|---|---|---|---|
| Read-modify-write has no locking/atomicity | `fileStore.ts:24-27`; every mutator (e.g. `transactions.ts` create, `familyCapTracker.ts` upsert) | Medium (Low in practice — single-user) | Each mutator does `readDatabase()` → mutate → `writeDatabase(db)` (full-file rewrite) with no mutex. Two concurrent Server Actions interleave as last-writer-wins, silently dropping a write. | Serialize writes via an in-process async queue in `fileStore.ts`, or document as a single-user limitation. |
| Create-spread puts generated id FIRST (`{ id: randomUUID(), ...card }`) | all 11 create fns, e.g. `cards.ts:25`, `transactions.ts:29` | Low (defense-in-depth) | Inverse of the safe update pattern. Today safe because input is typed `Omit<T,'id'>`, but an untyped object cast to the type (e.g. an API body) carrying `id` would overwrite the generated id. | Put id last: `{ ...card, id: randomUUID() }`, mirroring the update pattern. |
| `getActiveRecurringTransactions` reads the wall-clock internally | `recurringTransactions.ts:30` | Low | `new Date().toISOString().slice(0,10)` — every other date-aware fn in the app accepts an injectable `today`; this one can't be tested without mocking the clock and is the only data-layer fn reading time. | Accept optional `today?: string` for testability/consistency. |
| No referential-integrity enforcement on create | `createTransaction`/`createRewardRule`/etc. | Low (by design) | `card_id`/`milestone_id` accepted without checking the parent exists/active. Documented "CRUD only"; validation pushed to callers (the Server Actions DO re-check). | None required; noted for the record. |
| Trailing newline on write undocumented | `fileStore.ts:26` (`serialized + "\n"`) | Cosmetic | Contract says "pretty-printed (2-space indent)", silent on newline. Harmless. | Note in contract. |

**Verified CLEAN (with evidence):**
- **Path isolation** — `fileStore.ts:9-15` is the only module importing `node:fs`/`node:path` / defining `DB_PATH`. All 13 tab modules import only `{ readDatabase, writeDatabase }`. (The `fs` hits elsewhere in the grep are all `*.test.ts` snapshot/restore harnesses and the two read-only calc tests — not feature code.)
- **Signature fidelity** — every documented signature in `data-layer-contract.md` matches the code exactly, including the two structurally-special tabs (`familyCapTracker` composite-key upsert, `categories` name-identity idempotent add). **Zero drift.**
- **id immutability** — every `update*` uses the safe `{ ...row, ...updates, id: row.id }` (id pinned last), so `updates.id` can't overwrite. Verified `cards.ts:43`, `rewardRules.ts:44-48`, `transactions.ts:47-51`, `recurringTransactions.ts:59-63`, `milestones.ts:53-57`, `milestoneTiers.ts:47-51`, `feesAndCharges.ts:44-48`, `monthlySnapshots.ts:59-63`. UUIDs generated via `crypto.randomUUID()` everywhere (correctly absent on `familyCapTracker`/`categories`).
- **FK reads degrade gracefully** — all `get*ByCardId`/`getTiersByMilestoneId` are `filter()` → `[]` for an unknown/inactive id (never crash). `getLatestSnapshotForCard` guards `length === 0 → null` before `reduce`.
- **`database.json` type validity** — all 3 cards, 6 reward rules, 10 transactions, 3 payments, 2 milestones, 6 tiers, etc. conform to their interfaces; all required fields present with correct types (the 3rd card `8fa89604…`, added via the form this session, has all 24 `Card` fields). Empty `monthlySnapshots`/`familyCapTracker`/`cardTermsHistory` arrays are valid. **One content concern, not a type error:** that 3rd card's `card_number_encrypted` holds the literal plaintext `"6767676767676767"` (see Section 6).

---

## Section 2 — Calculation correctness (`src/lib/calculations/`)

### 2a. Stale stored values vs live recompute (hand-derived against CURRENT `data/database.json`)

Re-ran `recomputeCardBalance` and `recomputeMilestoneProgress` against the **actual current file** at `today = 2026-06-23`:

| Entity | Stored | Live recompute | Stale? |
|---|---|---|---|
| HDFC Millennia balance / util | ₹8,190 / 4.1% | ₹8,190 / 4.1% | ✅ in sync |
| **Axis Atlas balance / util** | **₹33,980 / 22.7%** | **₹34,180 / 22.8%** | ❌ **stale by ₹200 / 0.1pp** |
| Millennia quarterly milestone (all tiers) | ₹8,190 | ₹8,190 | ✅ in sync |
| **Atlas annual milestone (all 3 tiers)** | **₹33,980** | **₹34,180** | ❌ **stale by ₹200** |

| Issue | Location | Severity | Evidence | Suggested Fix |
|---|---|---|---|---|
| `/cards/[id]` and `/milestones` display a stale Atlas figure (₹33,980 not ₹34,180) | stored fields in `data/database.json`; read by `cards/[id]/page.tsx`, `milestones/page.tsx` | Medium (known limitation, but live on real data) | Atlas has 5 txns summing 34,180 in the open cycle/annual window; stored balance/tier progress = 33,980 (a ₹200 drift from a transaction edited this session). No recompute-on-write trigger exists, so the edit never refreshed the cached fields. Achievement flags unaffected (all still `false`). | Build the deferred recompute-on-write trigger in the create/update/delete Server Actions (already planned — `src/lib/CLAUDE.md` "Deferred work"). |

This is the **documented** no-recompute-on-write limitation (KNOWN_LIMITATIONS 2026-06-21) — verified genuinely manifesting. (Note: that doc's worked example cites a ₹56 EMI txn → ₹34,036, which no longer matches the current data; the real current drift is ₹33,980 vs ₹34,180 — the doc example is itself stale; see Section 9.)

### 2b. Other calculation checks — all CLEAN

| Check | Result | Evidence |
|---|---|---|
| `rate_type` branching still diverges correctly | ✅ Correct | `expectedCashback.ts:126-138`: `"percentage"` → `amount*(rate/100)`, redemption **NOT** applied; `"per_100_spend"` → `(amount/100)*rate*redemption`. Hand-check (amt 1000, rate 5, redemption 4): percentage = ₹50, per_100_spend = ₹200. Test asserts exactly this. Seed cards: Millennia Dining 500 → direct 25; Atlas Travel 500 → direct 25 (both with redemption 1). |
| Date objects crossing the RSC/Server-Action boundary | ✅ Clean | Every `new Date()` is **server-side only** (`page.tsx:93`, `milestones/page.tsx:42`, `cards/[id]/page.tsx:51`, `cards/actions.ts:156`). Pages that feed a client form pass `today` as an **ISO string** (`transactions/page.tsx:51`, `payments/page.tsx:45`) — no `Date` object is ever passed as a prop to a `"use client"` component, so no method/identity reliance can break across serialization. |
| Test-suite edge-case coverage | ✅ Sufficient (all 7) | fyDates, cardBalance, milestoneCycles, milestoneProgress, expectedCashback, insights, dueDate each test documented edges (leap-year clamps, short-month statement stepping, override=0, all 3 exclusion scopes, zero-credit-limit guard, achieved_date set/clear, earning-window offset, empty-history honesty). Minor untested branches: the unreachable-by-design `throw` paths (`stepMonths`, anniversary-null, `getFinancialYearBounds` malformed), the `tier_threshold_amount <= 0` guard, and the insights "cycle before earliest txn = no data vs in-span ₹0" distinction. None rise above Low. |

---

## Section 3 — UI pages (`src/app/`)

| Issue | Location | Severity | Evidence | Suggested Fix |
|---|---|---|---|---|
| Overdue card renders "Due in -N days" (no overdue branch) | `page.tsx:264-274` + `_lib/format.ts` `dueColorClass` | Low | The no-deadline branch only triggers on `days === null`; a negative `days` prints "Due in -2 days" (color/red is correct, wording is not). | Add a `days < 0` → "Overdue by N days" branch. |
| `expiry_year` input `min="2000"` looser than server rule (`< currentYear` rejected) | `CardForm.tsx:234` vs `cards/actions.ts:156-159` | Cosmetic | Native min misleads; server is authoritative (form is `noValidate`). | Align `min` to current year or drop it. |
| `fieldClass`/`labelClass`/`errorClass` copy-pasted across 4–5 form files | `CardForm.tsx:37-42`, `LogTransactionForm.tsx:38-42`, `LogPaymentForm.tsx:40-44`, `EditTransactionModal.tsx:50-54`, `AssistantChat.tsx:48-51` | Cosmetic | Byte-identical strings; conventions doc names `LogTransactionForm` the "reference" copy (deliberate but drift-prone). | Hoist into `src/app/_lib/`. |
| `formatINR` re-implemented instead of imported | `AssistantChat.tsx:53-59`, `transactions/actions.ts:260-266`, `payments/actions.ts:123-129` | Cosmetic (documented) | Three near-identical `Intl.NumberFormat` blocks; inline comments justify keeping a view-helper out of a server action. | Optional: move a framework-agnostic formatter into `src/lib/`. |

**Verified CLEAN (with evidence):**
- **`dynamic = "force-dynamic"`** present on every DB/date-reading page (`/`, `/cards`, `/cards/[id]`, `/cards/[id]/edit`, `/transactions`, `/payments`, `/milestones`). The only two omissions (`/cards/new`, `/assistant`) are the documented static-shell exceptions, justified inline.
- **GOTCHA A (no non-async export from `"use server"`):** all four `actions.ts` export only async fns + erased `type`s. Every `INITIAL_STATE` is defined inside its client component (`CardForm.tsx:31`, `LogTransactionForm.tsx:27`, `LogPaymentForm.tsx:25`, `EditTransactionModal.tsx:36`, `AssistantChat.tsx:28`) with null-safe `state?.errors ?? {}`.
- **GOTCHA B (Codespace CSRF):** `next.config.ts:25-28` `allowedOrigins`; no form bypasses it.
- **Server-side validation** re-checks everything and validates dropdowns against the **live** DB (active cards, live category list) — confirmed per action. Server-forced fields (`source`, `confidence_flag`, `parent_family`, `last4`) never trusted from client.
- **Destructive actions** use the two-click confirm pattern (`DeletePaymentButton`, `DeleteTransactionButton` with `useFormStatus` pending); no card-delete affordance exists.
- **`card_number_encrypted` never crosses to a client** (the critical check) — see Section 6 touch-point trace; only `card_number_last4` ever crosses. `cards/[id]/edit/page.tsx:56-74` maps Card→`CardFormValues` field-by-field (no spread); dropdowns map cards to `{id, card_name, card_bank}` only.
- **Color/empty-state consistency** — both `/` and `/cards`-family use the shared `_lib/format.ts` banding helpers; no ad-hoc duplicates of `utilizationColorClass`/`dueColorClass`/`capColorClass`.

---

## Section 4 — The Cards/Dashboard split

**Zero issues found.** Verified `cards/page.tsx` imports only `Link`, `getCards`, `formatINR` (`:15-17`) — **no `calculations/` import, no `new Date()` anywhere in the file**, shows raw `credit_limit` not utilization. The removed utilization/due-date logic is gone (no leftover dead code or unused imports). No logic is duplicated between `/cards` and `/` (Dashboard owns all financial signals via `calculations/`). The split is clean.

> **However** (see Section 10): this split is currently **uncommitted** in the working tree (`src/app/cards/page.tsx` + `src/app/CLAUDE.md` modified) — the code is correct but not yet committed.

---

## Section 5 — AI Assistant (`src/lib/ai/`, `src/app/assistant/`)

| Issue | Location | Severity | Evidence | Suggested Fix |
|---|---|---|---|---|
| Chat history grows unbounded | `AssistantChat.tsx:81` | Low | `const [history, setHistory] = useState<HistoryEntry[]>([])` appends every turn, never capped; a very long single session grows the array/DOM without bound (resets on reload). | Cap to last N turns (slice) if long sessions matter. |
| `security/sanitize.ts` has no test (the AI security boundary) | `src/lib/security/sanitize.ts` (no `.test.ts`) | High | The single whitelist that strips fields before Gemini is untested; a future field added to `AIRankedResult`/the mapper could leak silently with no guard. | Add a test asserting output keys are exactly {cardName + 3 figures} and UUID/encrypted/phone/email/balance/breakdown are absent. |

**Verified CLEAN (with evidence):**
- **`thinkingBudget: 0` on BOTH Gemini calls** — `gemini.ts:109` (`matchCategory`) and `gemini.ts:216` (`explainRecommendation`). Not regressed.
- **Error handling is graceful** — `getClient()` (`gemini.ts:38-46`) throws on missing/empty key, but both callers wrap in `try/catch` → deterministic fallback (`matchCategory` → `"Other"`; `explainRecommendation` → `templateExplanation` built from the same numbers). Invalid key / network / rate-limit → the user sees a correct template recommendation, never a crash or blank state. Errors logged server-side (`gemini.ts:123,225`).
- **Sanitize boundary is actually on the path** — `assistant/actions.ts:106` calls `sanitizeRankedForAI(results, cardNameById)` and `:107-110` passes only the sanitized shape to `explainRecommendation`. `matchCategory` receives only the category-name list. No raw row/UUID reaches Gemini. The LLM does zero arithmetic (`rankCardsForPurchase` is deterministic).

---

## Section 6 — Security (cross-referenced against SECURITY.md)

| Issue | Location | Severity | Evidence | Suggested Fix |
|---|---|---|---|---|
| **`SECURITY.md` is empty (0 bytes)** | `/SECURITY.md` | High | The root CLAUDE.md calls it a "living security checklist, updated every phase" and `gemini.ts:42` tells users to "see SECURITY.md", but the file has **no content**. The placeholder-encryption risk is documented only in KNOWN_LIMITATIONS, not in the security checklist that's supposed to track it. | Populate SECURITY.md with the encryption-pending item, the sanitize boundary, env-key handling, and a per-phase checklist. |
| Real plaintext card number stored in `card_number_encrypted` | `data/database.json` (3rd card, `"6767676767676767"`); write sites `cards/actions.ts:263,325` | High (by design, but now on real data) | The "encryption" is a placeholder: the raw typed digits are persisted as-is. The seed cards hold `"PLACEHOLDER_NOT_ENCRYPTED"`; the form-added card holds the actual 16 digits in plaintext. `src/lib/security/encryption.ts` does **not exist** yet (only `sanitize.ts`). | Implement AES-256-GCM `encryption.ts`; see the complete touch-point list below. |
| KNOWN_LIMITATIONS understates the placeholder risk | `KNOWN_LIMITATIONS.md` | Low | It documents the deferred encryption broadly but predates real plaintext numbers being stored via the form; doesn't note that live card numbers now sit unencrypted on disk. | Add an explicit line: "form-entered numbers are persisted in plaintext until encryption lands." |

**Complete list of places a real-encryption implementer must touch** (the audit asked for this in full):
1. **Create `src/lib/security/encryption.ts`** — AES-256-GCM `encrypt`/`decrypt`, the only file allowed to touch the key (src/lib rule 4). *Does not exist today.*
2. `src/app/cards/actions.ts:263` — `createCardAction` write (`TODO(encryption)`): wrap `cardNumberDigits!` in `encrypt(...)`.
3. `src/app/cards/actions.ts:325` — `updateCardAction` "number changed" branch (`TODO(encryption)`): same one-line wrap. *(These are the "exactly two" sites the docs promise — confirmed.)*
4. **A decrypt call site** — none exists yet (only `card_number_last4` is ever displayed). When the full number must be revealed (per explicit user action, server-side only — frontend rule 4), a `decrypt(...)` site must be added; ensure it never crosses to a client component.
5. **Data migration** — re-encrypt existing stored values: the 3rd card's plaintext `"6767676767676767"` and the seed cards' `"PLACEHOLDER_NOT_ENCRYPTED"` in `data/database.json`.
6. **Key management** — add an `ENCRYPTION_KEY` (or key-derivation) env var alongside `GEMINI_API_KEY` in `.env.local`, and **document it in SECURITY.md** (currently empty). Ensure it's read lazily (like `gemini.ts` does the API key) so `next build` doesn't need it.
7. **Test fixtures** using the placeholder string (`cards.test.ts:51`, `cardBalance.test.ts:51`, `dueDate.test.ts:37`, `insights.test.ts:54`) — harmless, but update if the field's shape changes.

**Verified CLEAN (with evidence):**
- **No secret leakage** — no hardcoded API-key-pattern strings in tracked files; `console.*` appears only in tests + `gemini.ts` error logs (which log the error object, not the key).
- **`.env.local`** is gitignored (`.gitignore` `.env*`) and was **never committed** at any point in history (`git log --all -- .env.local` empty; no sensitive filename ever added). Only `GEMINI_API_KEY` lives there.

---

## Section 7 — Test suite health

**`npm test`: 17/20 suites pass, 3 fail.** All 3 failures are **data drift, not logic bugs** (production code is correct).

| Issue | Location | Severity | Evidence | Suggested Fix |
|---|---|---|---|---|
| `cards.test.ts` fails — hardcoded card count | `cards.test.ts:35` (`=== 2`), `:76` (`=== 3` after create) | Medium | DB now has 3 cards (form-added test card), not the 2 seeds. | Capture `const seedCount = (await getCards()).length` and assert relative deltas. |
| `transactions.test.ts` fails — hardcoded txn counts | `transactions.test.ts:41` (`=== 11`), `:48` (atlas `=== 6`), `:77`, `:95` | Medium | Seed dropped 11→10 txns; atlas has 5 not 6. | Same relative-delta pattern. |
| `expectedCashback.test.ts` fails — hardcoded active-card count | `expectedCashback.test.ts:338,354` (`ranked.length === 2`) | Medium | 3rd card is `active:true`, so `rankCardsForPurchase` now returns 3. This suite reads the committed seed READ-ONLY, so any active-card change breaks it. | Derive expected count from the loaded data, not the literal `2`. |
| Latent count fragility (not yet failing) | `payments.test.ts:40,44,47,70,82`; `milestones.test.ts:41,54,80`; `milestoneTiers.test.ts:40,44,46,75`; `rewardRules.test.ts:42,46,53,79,82,97`; `recurringTransactions.test.ts:46,106`; `monthlySnapshots.test.ts:76` | Medium | Each hardcodes a seed-derived count; passes only because that tab's seed count is unchanged. Breaks on the next seed edit. | Adopt the resilient `seedCount + N` pattern already used by `exclusions`/`feesAndCharges`/`categories`/`familyCapTracker`/`cardTermsHistory`. |
| Coverage gap — `security/sanitize.ts` untested | n/a | High | Security boundary, no test (also Section 5). | Add `sanitize.test.ts`. |
| Coverage gap — `ai/gemini.ts` untested | n/a | Low (by design) | Live I/O, no math; but its pure fallback branches are testable. | Optional: test the deterministic fallbacks with a forced-failure stub. |
| Coverage gap — `fileStore.ts` no direct test | n/a | Low | Covered indirectly by all data tests. | Optional round-trip test. |

**Resilient pattern (the fix template):** `exclusions`/`feesAndCharges`/`categories`/`familyCapTracker`/`cardTermsHistory` already capture a `seedCount` baseline and assert deltas; `recurringTransactions.test.ts:51` computes `expectedActiveCount` from a date. Migrate the fragile suites to match.

---

## Section 8 — Build & type health

**Zero issues.**
- `npx tsc --noEmit`: **clean, exit 0, no errors or warnings.**
- `npm run build`: **succeeds, exit 0** — "Compiled successfully", TypeScript phase passes, all routes generated. Route table correct (`/` and the dynamic routes ƒ, `/cards/new` & `/assistant` ○ static — matching the documented `force-dynamic` exceptions).
- **No `any`** anywhere in `src/` (grep for `: any`, `as any`, `<any>`, `any[]`, `Array<any>` → none).
- **Dead code:** `_components/ComingSoon.tsx` is orphaned (only referenced in a comment in `assistant/page.tsx:2`) — this is the **documented** intentional stub convention, not accidental dead code. The duplicated `formatINR`/`fieldClass` constants (Section 3) are the only real duplication; cosmetic.

---

## Section 9 — Documentation accuracy

| Issue | Location | Severity | Evidence | Suggested Fix |
|---|---|---|---|---|
| Root CLAUDE.md "Current phase: Phase 0" | `/CLAUDE.md:33` | Medium | Actual state is Phase 6 (git log). | Update to Phase 6. |
| Root CLAUDE.md references non-existent `/frontend/CLAUDE.md` & `/backend/CLAUDE.md` | `/CLAUDE.md:21,24,25` | Medium | Those paths don't exist; the files are `src/app/CLAUDE.md` and `src/lib/CLAUDE.md` (the restructure is recorded in DECISIONS.md 2026-06-20, but root CLAUDE.md still points at the old paths). | Repoint to `src/app/CLAUDE.md` / `src/lib/CLAUDE.md`. |
| `STATUS.md` badly stale | `/STATUS.md` | Medium | Says "Phase 1: …IN PROGRESS", lists as "Pending" the calculation modules + encryption that are long since built/partially built, "14 suites" (now 20). Describes a Phase-1 world; app is at Phase 6. | Rewrite to reflect Phases 2–6. |
| `src/lib/CLAUDE.md` "Current state: Phase 1… 20 suites, all passing" | `src/lib/CLAUDE.md:110-111` | Low | 3 suites currently fail (data drift). | Update phase + note the seed-drift test state. |
| `src/app/CLAUDE.md` "Current state: Phase 3 (in progress)" | `src/app/CLAUDE.md:489-500` | Low | Actual Phase 6; all the pages it describes as just-built are done. | Update the Current-state blurb. |
| **`SECURITY.md` & `TESTING.md` are empty (0 bytes)** | `/SECURITY.md`, `/TESTING.md` | High | Both are referenced as living docs by root CLAUDE.md (and SECURITY.md by `gemini.ts:42`, src/lib rule 3/4). Neither has any content. | Populate both (security checklist; test-scenario log). |
| KNOWN_LIMITATIONS worked example is stale | `KNOWN_LIMITATIONS.md` (Atlas ₹34,036 / "₹56 EMI") | Low | Current data drift is ₹33,980 vs ₹34,180; the cited ₹56 EMI txn no longer exists. | Refresh the example numbers. |
| Deferred "recompute-on-write" lives in KNOWN_LIMITATIONS/src/lib CLAUDE, not DECISIONS.md | `DECISIONS.md` | Low | The cards/dashboard split decision is captured in `src/app/CLAUDE.md` but not DECISIONS.md either; some judgment calls aren't in the central decision log. | Add cross-references in DECISIONS.md. |

---

## Section 10 — Git hygiene

| Issue | Location | Severity | Evidence | Suggested Fix |
|---|---|---|---|---|
| Uncommitted Phase-6 work in the working tree | `src/app/cards/page.tsx`, `src/app/CLAUDE.md` (modified, unstaged) | Medium | The cards/dashboard-split (Section 4) is complete and correct but never committed; `git status` shows both as `M`. Risk of loss / unclear history. | Commit the split as its own Phase-6 commit. |
| Minor feature+fix bundling in two commits | `fad33bb`, `2b73c15` | Low | Each bundles a page feature with a `transactions.test.ts` seed-count fix — but the messages disclose it, so intent is traceable. | None required; noted. |

**Verified CLEAN:** the 19-commit history is otherwise well-structured (one coherent commit per phase step), and every message accurately describes its contents. No secrets were ever committed (Section 6).

---

## Prioritized Top-10 (across all sections)

Ordered by likelihood of real harm — data corruption, security exposure, silently-wrong numbers — over cosmetic/structural concerns.

| # | Severity | Finding | Where | Why it matters |
|---|---|---|---|---|
| 1 | **High** | Real card number stored as **plaintext** in `card_number_encrypted`; `encryption.ts` doesn't exist | `data/database.json` 3rd card; `cards/actions.ts:263,325` | Sensitive data at rest unprotected; the security control is a placeholder and now holds live input. |
| 2 | **High** | **`SECURITY.md` empty** — the living security checklist that's supposed to track #1 has no content | `/SECURITY.md` | The one doc meant to catch the encryption gap (and referenced by code) doesn't exist; risk goes untracked. |
| 3 | **High** | **`sanitize.ts` (AI-payload security boundary) has no test** | `src/lib/security/sanitize.ts` | A future field could silently leak to Gemini with no guard; whitelist boundaries must be test-pinned. |
| 4 | **Medium** | **Stale stored figures** — Atlas balance/util & annual milestone read ₹33,980 vs live ₹34,180 | `cards/[id]`, `/milestones` | The app shows users wrong numbers on real edited data (no recompute-on-write); financially misleading. |
| 5 | **Medium** | **3 test suites failing** + widespread hardcoded-count fragility | `cards`/`transactions`/`expectedCashback` `.test.ts` + ~8 more | A red suite hides real regressions; brittle counts break on every seed edit. |
| 6 | **Medium** | **Uncommitted Phase-6 work** (cards/dashboard split) | working tree | Correct code at risk of loss; muddies history. |
| 7 | **Medium** | **`TESTING.md` empty** + STATUS.md / root-CLAUDE.md / sub-CLAUDE.md all stale (Phase 0/1/3 vs actual 6); root CLAUDE.md points at non-existent `/frontend` `/backend` paths | docs | Onboarding/next-session docs actively mislead about state and file locations. |
| 8 | **Medium** | **JSON file writes have no locking** (last-writer-wins) | `fileStore.ts:24-27` | Concurrent Server Actions can silently drop a write; bounded today by single-user use. |
| 9 | **Low** | Overdue card renders "Due in **-N** days" (no overdue branch) | `page.tsx:264-274` | User-visible nonsensical wording for a passed deadline. |
| 10 | **Low** | Assistant chat history unbounded; create-spread id-ordering; `getActiveRecurringTransactions` reads clock internally | `AssistantChat.tsx:81`; data `create*`; `recurringTransactions.ts:30` | Minor robustness/defense-in-depth items. |

---

*End of audit. No code, data, or documentation was modified in producing this report.*
