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
