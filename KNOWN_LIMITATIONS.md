# Known Limitations

Deliberate simplifications, documented here so they are not "fixed" by accident
later. Each entry says what we simplified and why, so a future change is a
conscious decision rather than a surprise.

## Expected-cashback ignores `monthly_cap` (2026-06-21)
`calculateExpectedCashback` (`src/lib/calculations/expectedCashback.ts`) assumes
**full cap headroom** for every reward rule — it never reads month-to-date spend to
see how much of a `monthly_cap` is already used. A purchase that would actually
breach the cap is still valued at the full accelerated rate. This keeps the
function pure and stateless (no transaction-history dependency). Revisit if/when
cap-aware recommendations are needed; that will require feeding month-to-date
spend in. See `/DECISIONS.md` 2026-06-21.

## Expected-cashback shows only the top 5 cards (2026-06-21)
`rankCardsForPurchase` returns at most the 5 highest-value active cards, not the
full ranked list. Intentional — the recommendation UI surfaces the best handful.
Returns fewer when fewer active cards exist. See `/DECISIONS.md` 2026-06-21.

## ~~Milestone reward redemption value is inferred, not stored~~ — RESOLVED 2026-06-21
**No longer a limitation.** `MilestoneTier` now has a required
`redemption_value_per_unit` column, so the milestone-contribution math reads the
tier's per-unit value directly instead of inferring it from the card's reward
rules. No silent ₹1 fallback remains. See `/DECISIONS.md` 2026-06-21
("MilestoneTier.redemption_value_per_unit: stored, not inferred").
