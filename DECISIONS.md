# Decision Log

## 2026-06-20 — Project structure
Standard Next.js layout chosen over custom frontend/backend folders. CLAUDE.md docs live at src/app/CLAUDE.md and src/lib/CLAUDE.md respectively, rather than restructuring into non-standard folders. Reasoning: fighting Next.js conventions costs more than it gains; all framework docs/examples assume standard structure.

## 2026-06-20 — Next.js version
Using Next.js 16.2.9 as scaffolded. This version has breaking changes from common training-data patterns (params/searchParams are now Promises, opt-in caching via "use cache"). All future routing/caching code must follow v16 syntax — verified against node_modules/next/dist/docs/ and official docs, not assumed from memory.

## 2026-06-20 — Database approach (dev phase)
Local JSON file mirrors the planned 13-tab Google Sheets schema exactly, accessed only through a single data-access layer (src/lib/data/). This makes the eventual swap to real Google Sheets API calls mechanical — same function signatures, different internals — rather than a rewrite touching every feature.

## 2026-06-21 — Expected-cashback: points/miles "per Rs 100" interpretation (SUPERSEDED same day by the `rate_type` decision below)
The first cut of `calculateExpectedCashback` interpreted `multiplier_or_rate` by `reward_currency` (cashback = percent, points/miles/vouchers = units per Rs 100), and noted that HDFC Millennia's "5% CashPoints" (stored under currency `points`, rate 5, redemption 1) and Axis Atlas's "5 EDGE Miles per Rs 100" only *coincidentally* produced equal numbers because 1 unit = ₹1. That framing was wrong in two ways, corrected below: (a) the two formulas as first written were algebraically identical, so the coincidence was actually a mathematical identity, not redemption-dependent; (b) currency is the wrong axis — the real axis is the *reward mechanic*, now captured by an explicit `rate_type` field.

## 2026-06-21 — RewardRule.rate_type: percentage vs per_100_spend are DIFFERENT mechanics
`RewardRule.multiplier_or_rate` was ambiguous between "a percent of spend" (HDFC CashPoints: `5` = 5%) and "units earned per Rs 100" (Axis EDGE Miles: `5` = 5 miles per ₹100). We added a **required** `rate_type: "percentage" | "per_100_spend"` field so every rule declares its interpretation explicitly, and a **required** `redemption_value_per_unit` on `MilestoneTier` (it previously had none).

The key insight that resolved the earlier "they're algebraically identical" problem: **`redemption_value_per_unit` applies to only one of the two mechanics.**
- **`"percentage"`** states a percent of spend returned *already in rupee-equivalent terms* — the percent IS the rupee conversion, there is no separate unit count to convert. Direct formula: `directRewardValue = amount * (multiplier_or_rate / 100)`. `redemption_value_per_unit` is **NOT applied**. (e.g. "5% CashPoints" on ₹1000 = ₹50, *regardless of whatever redemption value is stored on the rule*.)
- **`"per_100_spend"`** produces a *count of units* (points/miles) per ₹100, a different currency until converted. Direct formula: `directRewardValue = (amount / 100) * multiplier_or_rate * redemption_value_per_unit`. This is where `redemption_value_per_unit` earns its purpose.

Because the percentage branch drops the `redemption` factor while per_100_spend keeps it, the two now produce **genuinely different results** for the same `multiplier_or_rate` (verified in the test suite: rate 5, redemption 4, ₹1000 → percentage 50 vs per_100_spend 200). This is the real fix for the old "coincidentally correct" problem — the field is no longer notational.

The `redemption_value_per_unit` field stays on every `RewardRule` (even percentage rules) because it may be referenced elsewhere; the percentage *direct-reward* branch simply ignores it. Why drop it rather than keep it everywhere: keeping it made the two formulas identical and the `rate_type` flag meaningless; the alternative of *always* treating the rate as a direct percent would mis-value real per-Rs-100 miles cards. Splitting on whether a unit-count conversion is involved is the semantically correct cut.

**Seed `rate_type` assignment (from `source_dump_text`):** the three HDFC Millennia rules ("5%/1% CashPoints") → `"percentage"`; the three Axis Atlas rules ("X EDGE Miles per Rs 100") → `"per_100_spend"`. Seed redemption values are all `1`, so this change leaves every seed *number* unchanged (5% of 500 == 5 per-100 of 500 when the unit is worth ₹1) — only the breakdown wording changed (Millennia now shows "5% points" instead of "5 points/₹100"). The distinction now bites only when a unit is worth ≠ ₹1, which is exactly the future-proofing intent.

## 2026-06-21 — MilestoneTier.redemption_value_per_unit: stored, not inferred
The milestone-contribution formula needs `reward_value * redemption_value_per_unit`. The first cut inferred the per-unit value by matching the tier's `reward_unit` to one of the card's reward rules' `reward_currency`. That is now replaced by a **required `redemption_value_per_unit` column on `MilestoneTier`** — the rupee value is read directly off the tier, never inferred. Seed values were derived per the tier→milestone→card→reward-rule chain (Millennia points = 1, Atlas miles = 1); **every seed tier derived cleanly to `1` with no defaulting required.** This resolves the old KNOWN_LIMITATIONS note about milestone redemption being inferred.

## 2026-06-21 — Expected-cashback: ignore monthly_cap, show only top 5
Two explicit simplifications baked into the expected-cashback layer:
- **`monthly_cap` is ignored** — full cap headroom is always assumed; no month-to-date history lookup. Keeps the function pure and stateless (it would otherwise need transaction history to know remaining cap). Documented as a known limitation.
- **`rankCardsForPurchase` returns the top 5 only**, not every card — the recommendation UI shows the five best options. Returns fewer when fewer active cards exist.

## 2026-06-21 — AI Assistant: Gemini SDK, model, and architecture
Building the AI Assistant chat page (`/assistant`). Several judgment calls:

- **SDK: `@google/genai`, not `@google/generative-ai`.** The build instruction named `@google/generative-ai`, but that package is now **legacy/deprecated**; Google's current GA SDK is `@google/genai` (v2.9.0 installed). Confirmed via web search and surfaced to the user, who chose the current SDK. API shape verified against the installed type defs (`new GoogleGenAI({apiKey})` → `ai.models.generateContent({model, contents, config})` → `response.text`), not assumed from memory.
- **Model: `gemini-2.5-flash` (CORRECTED 2026-06-21).** The task's fallback was `gemini-2.0-flash`, which Google deprecated on 2026-06-01. An earlier revision of this entry recorded `gemini-2.0-flash` as "user-chosen", but that selection had **not actually been confirmed** by the user. On review the user explicitly chose **`gemini-2.5-flash`** — a current, stable, widely-available free-tier Flash model — precisely to avoid deliberately building on a deprecated model. Kept as a single constant `GEMINI_MODEL` in `gemini.ts` so a later move to a newer Flash tier (e.g. `gemini-3-flash`) is a one-line change.
- **The LLM never does arithmetic.** `rankCardsForPurchase` (calculations/) does 100% of the reward math; Gemini only (a) classifies free text → one of our category names and (b) phrases the already-computed numbers (prompt forbids recompute). Both calls degrade to deterministic fallbacks on any failure (category → "Other"; explanation → template string), so the feature works with Gemini fully unavailable.
- **Sanitize boundary created now (rule 3).** `src/lib/security/sanitize.ts` is the single point any AI-bound payload is built. It whitelists exactly card NAME + the three computed rupee figures; internal card ids/UUIDs, encrypted number, last-4, phone/email/balances, and even the internal `breakdown` string never reach Gemini. This was mandated by src/lib rule 3 / SECURITY.md even though the build instruction didn't mention it.
- **`explainRecommendation` takes the sanitized shape, not raw `ExpectedCashback[]`.** A documented deviation from the literal task signature: the raw results carry only card UUIDs (useless and id-leaking for a friendly explanation), and rule 3 forbids sending raw rows. So the function receives the name-resolved, sanitized `AIRankedResult[]`. Faithful to the intent ("send already-computed results, not raw data"), stricter on security.
- **UX: two inputs (description + amount), not one combined "₹500 on Swiggy" box.** The amount must stay an exact deterministic number; parsing it from free text would need brittle regex or asking Gemini to read a figure (against the no-LLM-math law). Two fields keep the amount exact and match the app's existing Forms pattern.
- **`ComingSoon.tsx` is now orphaned** (all routes are real pages) but left in place as the documented stub convention for any future route added stub-first.

## 2026-06-21 — matchCategory returned "Other" for obvious inputs: gemini-2.5-flash thinking-token starvation
**Symptom:** "Zomato" (and other clear inputs) classified as "Other" instead of "Dining".

**Diagnosis (live-API evidence, not theory).** Ran the byte-for-byte production prompt
against the real key. `gemini-2.5-flash` is a **thinking** model: by default it spends
output tokens on hidden reasoning *before* the visible answer, and those thinking tokens
count against `maxOutputTokens`. With our `maxOutputTokens: 20`, the entire budget was
consumed by thinking — the call returned `finishReason: MAX_TOKENS` with **empty visible
text** (`response.text === undefined`). Our `if (!raw) return fallback` then converted that
empty response into `"Other"`. Proof: same prompt at `maxOutputTokens: 100` returned
`"Dining"` with `finishReason: STOP`. So it was **never** a prompt-quality, casing, or
parse-strictness problem, and Gemini never actually "chose" Other — its answer was
truncated to nothing.

**Fix.** Add `thinkingConfig: { thinkingBudget: 0 }` to both Gemini calls in `gemini.ts`.
Classification and number-phrasing need no chain-of-thought, so disabling thinking gives
the full token budget to the answer. Verified live post-fix through the real
`matchCategory` export: Zomato/Swiggy → Dining, "uber ride" → Travel, gibberish → Other
(the genuine fallback still works). Applied to `explainRecommendation` too (same latent
risk: thinking could silently truncate the 200-token explanation).
