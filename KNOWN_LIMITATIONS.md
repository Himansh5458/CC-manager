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

## Computed/cached UI figures are only as fresh as the last saved recompute — NO recompute-on-write yet (2026-06-21)
The Milestones page (and any page that reads stored computed fields) displays
**stored** values straight from the database — milestone tier
`current_progress_amount` / `achieved`, milestone `cycle_start_date` /
`cycle_end_date`, and likewise card `current_outstanding_balance` /
`current_utilization_pct` and the FamilyCapTracker totals. These are a **readable
ledger of computed truth**, refreshed only when something explicitly recomputes
and **saves** them.

**There is currently NO automatic recompute-on-write trigger.** Creating a
transaction or a payment writes the raw row only; it does **not** refresh the
downstream computed/cached fields. So after logging a spend, the Milestones page
(and stored balances) can lag until a recompute is run and persisted. For example,
the Atlas annual track shows its stored progress of **₹33,980**, not the
**₹34,036** a live recompute (including the later-added ₹56 EMI transaction) would
produce.

**Why this is deferred, not an oversight.** We deliberately reversed an earlier
approach where the Milestones page recomputed progress live on every page load.
That conflicted with our design intent: the database should be the readable ledger
of computed truth, with recompute happening on **write**, not on every **read**.
Recomputing on every read also does not translate to the eventual Google Sheets
backend — each read would burn Sheets API quota and be slow — whereas
recompute-on-write keeps reads cheap (just fetch stored rows). The recompute-on-
write trigger itself is real planned work (see the "Deferred work" section in
`src/lib/CLAUDE.md`); until it lands, treat stored figures as last-saved
snapshots. Decision and reasoning from the 2026-06-21 Milestones-page session.

## `parent_family` key is unnormalized — name variants silently fragment one person into two families (2026-06-23) — REAL BUG, not yet fixed
`parent_family` is built by **simple string concatenation** of bank + cardholder
name (`` `${card_bank} ${card_holder}` `` in `cards/actions.ts`) with **no
normalization** — no trimming, no whitespace collapsing, no case/punctuation
canonicalization. The dashboard groups families by raw string equality
(`src/app/page.tsx`). So **within the SAME bank**, the same real person entered
with even a slightly different name — "Rohit Singh" vs "Rohit  Singh" (double
space), "R. Singh", trailing whitespace, different casing — produces a **different
key** and is split into **two separate families, each measured against a full ₹8L
cap**. This silently fragments one person's real combined payments and can hide a
genuine cap breach (e.g. ₹5L + ₹4L = ₹9L real, shown as two comfortable sub-cap
rows). See `/BUSINESS_RULE_AUDIT.md` §3.1.

**This is a real bug to fix, NOT a deliberate simplification** (it is listed here
because that's where the audit cross-references it). The fix is to normalize the
key before grouping — trim, collapse internal whitespace, and canonicalize — so a
data-entry variation cannot split one person within a bank.

**Explicitly distinct from the per-bank-vs-per-individual cap-grain decision**
(`/DECISIONS.md` 2026-06-23), which is **settled**: the cap is intentionally
per-bank-relationship, so the same person across *different* banks getting separate
buckets is correct *by design*. This normalization bug is the *opposite* problem —
the same person at the *same* bank wrongly getting separate buckets — and is the
part that is still broken.

## ~~Milestone reward redemption value is inferred, not stored~~ — RESOLVED 2026-06-21
**No longer a limitation.** `MilestoneTier` now has a required
`redemption_value_per_unit` column, so the milestone-contribution math reads the
tier's per-unit value directly instead of inferring it from the card's reward
rules. No silent ₹1 fallback remains. See `/DECISIONS.md` 2026-06-21
("MilestoneTier.redemption_value_per_unit: stored, not inferred").
